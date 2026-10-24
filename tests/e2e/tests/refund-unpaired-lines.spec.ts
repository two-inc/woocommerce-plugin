import { test, expect, type Page } from "@playwright/test";

import { checkout } from "../pages/renderer.js";
import * as store from "../pages/store.js";
import * as wpAdmin from "../pages/wp-admin.js";
import { resetCartShapes, setOption, wp } from "../wp-cli.js";

// TWO-26541, TWO-26638. A refund line typed in the admin refund form with its net but no tax, or its tax but no net,
// is refused by name before anything is sent, and WooCommerce creates no refund.
// docker/mu-plugins/two-e2e-carts.php: "taxes" charges products and shipping 20%.

test.afterEach(() => {
  resetCartShapes();
});

/** Fills the admin refund form, submits it as a gateway refund and returns the error WooCommerce alerts. */
async function refuseRefund(page: Page, fill: (page: Page) => Promise<void>): Promise<string> {
  await page.reload();
  await page.locator("button.refund-items").click();
  await fill(page);
  const alerts: string[] = [];
  const onDialog = async (dialog: {
    type: () => string;
    message: () => string;
    accept: () => Promise<void>;
  }) => {
    if (dialog.type() === "alert") {
      alerts.push(dialog.message());
    }
    await dialog.accept();
  };
  page.on("dialog", onDialog);
  await page.locator(".do-api-refund").click();
  await expect.poll(() => alerts.length, { message: "the refund was answered" }).toBeGreaterThan(0);
  page.off("dialog", onDialog);
  return alerts[0];
}

/** Types an amount into a refund input the way an admin does, so the form sums it on change. */
async function type(page: Page, selector: string, amount: string) {
  const input = page.locator(selector).first();
  await input.fill(amount);
  await input.press("Tab");
}

test("refund lines with only a net or only a tax are refused by name and not created", async ({
  page
}) => {
  test.setTimeout(240_000);
  setOption("two_e2e_cart_shape", "taxes");
  const lastName = `E2EUnpaired${Date.now().toString(36)}`;
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

  await wpAdmin.login(page);
  await wpAdmin.navigateToOrders(page);
  await wpAdmin.openOrder(page, lastName);

  // Shipping rows have no quantity box, so a shipping refund is always typed: its tax stays empty.
  const netOnly = await refuseRefund(page, (p) =>
    type(p, "#order_shipping_line_items tr.shipping input.refund_line_total", "10")
  );
  expect(netOnly, "the net-only shipping line is refused by name").toMatch(
    /^"E2E courier" has no tax entered: .+ refunds a line's net amount only together with its tax\. Enter the tax refunded for this line as well\.$/
  );

  const taxOnly = await refuseRefund(page, (p) =>
    type(p, "#order_line_items tr.item input.refund_line_tax", "1")
  );
  expect(taxOnly, "the tax-only product line is refused by name").toMatch(
    /^"Product 1" cannot be refunded as tax alone: /
  );

  const refunds = wp("eval", `echo count(wc_get_order(${wcOrderId})->get_refunds());`).trim();
  expect(refunds, "no refund was created").toBe("0");
});
