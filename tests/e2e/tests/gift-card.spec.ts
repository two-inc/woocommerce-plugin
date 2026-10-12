import { test, expect, type Page } from "@playwright/test";

import { getOrder, triggerFulfilBatch, waitForOrderState } from "../two-api.js";
import { checkout } from "../pages/renderer.js";
import * as store from "../pages/store.js";
import * as wpAdmin from "../pages/wp-admin.js";
import { resetCartShapes, setOption, wp } from "../wp-cli.js";

// TWO-26309. A gift card redeemed at checkout pays part of the order outside its lines. The plugin sends the
// order's full lines and declares the card as prepaid, so Two invoices the lines and funds only the rest.
// docker/mu-plugins/two-e2e-carts.php applies the card to the cart; PW Gift Cards is installed by
// docker/wpcli.sh and active only for these tests.
const GIFT_CARD_PLUGIN = "pw-woocommerce-gift-cards";

test.describe.configure({ mode: "serial" });

test.beforeEach(() => {
  wp("plugin", "activate", GIFT_CARD_PLUGIN);
});

test.afterEach(() => {
  // Deactivated even when the reset fails, so the plugin never reaches a later spec.
  try {
    resetCartShapes();
  } finally {
    wp("plugin", "deactivate", GIFT_CARD_PLUGIN);
  }
});

function armGiftCard(amount: string) {
  setOption("two_e2e_gift_card_amount", amount);
  setOption("two_e2e_cart_shape", "giftcard");
}

/** Retries while staging answers with a gateway error (429, 524), as the order reads below do. */
async function untilItWorks(what: string, action: () => Promise<void>, timeout = 120_000) {
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

async function readTwoOrder(twoOrderId: string): Promise<Record<string, unknown>> {
  let order: Record<string, unknown> = {};
  await untilItWorks(`reading Two order ${twoOrderId}`, async () => {
    order = await getOrder(twoOrderId);
  });
  return order;
}

/** Only the amount fields, so a failure never logs the buyer. */
const amounts = (order: Record<string, unknown>) => ({
  invoice_amount: order.invoice_amount,
  payable_amount: order.payable_amount,
  prepaid_amount: order.prepaid_amount
});

test("an order part paid by a gift card is sent, updated and refunded with the card as prepaid", async ({
  page
}) => {
  test.setTimeout(480_000);
  armGiftCard("10");
  const lastName = `E2EGiftCard${Date.now().toString(36)}`;
  await store.addProductToCart(page, "Product 1");
  await checkout.goto(page);
  await checkout.completeCheckoutForm(page, "Test", lastName);
  const wcOrderId = Number(await checkout.placeOrder(page));
  expect(wcOrderId, "the order is placed").toBeTruthy();

  const order = (expression: string) =>
    wp("eval", `echo wc_get_order(${wcOrderId})->${expression};`).trim();
  const twoOrderId = order("get_meta('twoinc_order_id')");
  expect(twoOrderId, "Two accepted the order").toBeTruthy();
  const total = Number(order("get_total()")).toFixed(2);
  const expected = {
    invoice_amount: (Number(total) + 10).toFixed(2),
    payable_amount: total,
    prepaid_amount: "10.00"
  };
  expect(amounts(await readTwoOrder(twoOrderId)), "create").toEqual(expected);

  // An admin save the plugin sends as an order update: the address changes from WP-CLI, the save from the
  // order's admin screen.
  wp("eval", `$o = wc_get_order(${wcOrderId}); $o->set_billing_city('E2E Gift Card'); $o->save();`);
  await wpAdmin.login(page);
  await wpAdmin.navigateToOrders(page);
  await wpAdmin.openOrder(page, lastName);
  await page.locator("button.save_order").click();
  await page.waitForLoadState("load");
  const notes = wp(
    "eval",
    `echo implode(' | ', wp_list_pluck(wc_get_order_notes(['order_id' => ${wcOrderId}, 'limit' => 3]), 'content'));`
  );
  expect(notes, "update sent and accepted").toContain("order edit request has been accepted");
  expect(amounts(await readTwoOrder(twoOrderId)), "update").toEqual(expected);

  // Fulfil, then refund every line: WooCommerce refunds the order total, the rest of the lines is the card.
  await waitForOrderState(twoOrderId, "CONFIRMED");
  await wpAdmin.openOrder(page, lastName);
  await wpAdmin.changeOrderStatus(page, "Completed");
  await untilItWorks("the fulfilment batch", triggerFulfilBatch, 180_000);
  await waitForOrderState(twoOrderId, "FULFILLED", 60_000);
  const refunded = wp(
    "eval",
    `$o = wc_get_order(${wcOrderId}); $lines = [];
     foreach ($o->get_items(['line_item', 'shipping', 'fee']) as $id => $item) {
       $lines[$id] = ['qty' => $item->get_quantity(), 'refund_total' => $item->get_total(), 'refund_tax' => $item->get_taxes()['total']];
     }
     $r = wc_create_refund(['order_id' => ${wcOrderId}, 'amount' => $o->get_total(), 'line_items' => $lines, 'refund_payment' => true]);
     echo is_wp_error($r) ? 'refused: ' . $r->get_error_code() : 'refunded';`
  ).trim();
  expect(refunded, "Two accepted the refund").toBe("refunded");
  await waitForOrderState(twoOrderId, "REFUNDED", 60_000);
  const refunds = ((await readTwoOrder(twoOrderId)).refunds ?? []) as Record<string, string>[];
  const sum = (field: string) =>
    Math.abs(refunds.reduce((total, refund) => total + Number(refund[field] ?? 0), 0)).toFixed(2);
  expect([sum("payable_amount"), sum("prepaid_amount")], "refund").toEqual([total, "10.00"]);
});

test("a gift card covering the whole order leaves nothing to pay, so Two is not offered", async ({
  page
}) => {
  armGiftCard("100000");
  await store.addProductToCart(page, "Product 1");
  await checkout.goto(page);
  // Rendered once the place order button is: WooCommerce then lists no payment method for an order with nothing
  // to pay, where it would otherwise list Two.
  const placeOrder = page.locator("#place_order, .wc-block-components-checkout-place-order-button");
  await expect(placeOrder).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.locator(checkout.paymentRadio)).toHaveCount(0);
});
