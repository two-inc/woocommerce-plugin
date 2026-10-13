import { test, expect } from "@playwright/test";

import { getOrder, triggerFulfilBatch, waitForOrderState } from "../two-api.js";
import { checkout } from "../pages/renderer.js";
import * as store from "../pages/store.js";
import * as wpAdmin from "../pages/wp-admin.js";
import { resetCartShapes, setOption, wp } from "../wp-cli.js";

// TWO-26340. With "Validate tax subtotals" on (the default), a refund sends a subtotal for every rate its lines
// carry. A quantity-only refund of a line leaves its rate's subtotal at zero, and Two must accept that.
// docker/mu-plugins/two-e2e-carts.php: "taxes" charges products 20%, "untaxed" ships at 0%.

test.afterEach(() => {
  resetCartShapes();
});

/** Retries while staging answers with a gateway error (429, 524). */
async function untilItWorks(what: string, action: () => Promise<void>, timeout = 180_000) {
  await expect
    .poll(
      async () => {
        try {
          await action();
          return true;
        } catch {
          return false;
        }
      },
      { message: `${what} kept failing`, timeout, intervals: [5_000] }
    )
    .toBe(true);
}

test("a refund with a rate refunding nothing sends its zero subtotal and is accepted", async ({
  page
}) => {
  test.setTimeout(480_000);
  setOption("two_e2e_cart_shape", "taxes,untaxed");
  const lastName = `E2EZeroBucket${Date.now().toString(36)}`;
  await store.addProductToCart(page, "Product 1");
  await checkout.goto(page);
  await checkout.completeCheckoutForm(page, "Test", lastName);
  const wcOrderId = Number(await checkout.placeOrder(page));
  expect(wcOrderId, "the order is placed").toBeTruthy();
  const twoOrderId = wp(
    "eval",
    `echo wc_get_order(${wcOrderId})->get_meta('twoinc_order_id');`
  ).trim();
  expect(twoOrderId, "Two accepted the order").toBeTruthy();

  await waitForOrderState(twoOrderId, "CONFIRMED");
  await wpAdmin.login(page);
  await wpAdmin.navigateToOrders(page);
  await wpAdmin.openOrder(page, lastName);
  await wpAdmin.changeOrderStatus(page, "Completed");
  await untilItWorks("the fulfilment batch", triggerFulfilBatch);
  await waitForOrderState(twoOrderId, "FULFILLED", 60_000);

  // The product is refunded by quantity only (its 20% subtotal is zero), the 0% shipping in full.
  const refunded = wp(
    "eval",
    `$o = wc_get_order(${wcOrderId}); $lines = []; $amount = 0;
     foreach ($o->get_items(['line_item', 'shipping']) as $id => $item) {
       $full = $item->get_type() === 'shipping';
       $lines[$id] = ['qty' => $full ? 0 : 1, 'refund_total' => $full ? $item->get_total() : 0, 'refund_tax' => $full ? $item->get_taxes()['total'] : []];
       $amount += $full ? $item->get_total() + $item->get_total_tax() : 0;
     }
     $r = wc_create_refund(['order_id' => ${wcOrderId}, 'amount' => $amount, 'line_items' => $lines, 'refund_payment' => true]);
     echo is_wp_error($r) ? 'refused: ' . $r->get_error_message() : 'refunded';`
  ).trim();
  expect(refunded, "Two accepted the refund").toBe("refunded");

  let refunds: { tax_subtotals?: Record<string, string>[] }[] = [];
  await untilItWorks(`reading Two order ${twoOrderId}`, async () => {
    refunds = ((await getOrder(twoOrderId)).refunds ?? []) as typeof refunds;
  });
  const subtotals = refunds.flatMap((refund) => refund.tax_subtotals ?? []);
  const zero = subtotals.find(
    (s) =>
      Number(s.tax_rate) === 0.2 && Number(s.taxable_amount) === 0 && Number(s.tax_amount) === 0
  );
  expect(zero, `the refund kept its zero 20% subtotal: ${JSON.stringify(subtotals)}`).toBeTruthy();
});
