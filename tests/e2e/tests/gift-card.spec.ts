import { test, expect, type Page } from "@playwright/test";

import { getOrder } from "../two-api.js";
import { checkout } from "../pages/renderer.js";
import * as store from "../pages/store.js";
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
  resetCartShapes();
  wp("plugin", "deactivate", GIFT_CARD_PLUGIN);
});

function armGiftCard(amount: string) {
  setOption("two_e2e_gift_card_amount", amount);
  setOption("two_e2e_cart_shape", "giftcard");
}

/** Two's order as its API returns it, read again while staging answers with a gateway error. */
async function readTwoOrder(twoOrderId: string): Promise<Record<string, unknown>> {
  let order: Record<string, unknown> | null = null;
  await expect
    .poll(
      async () => {
        try {
          order = await getOrder(twoOrderId);
          return true;
        } catch {
          return false;
        }
      },
      { message: `Two order ${twoOrderId} could not be read`, timeout: 60_000, intervals: [2_000] }
    )
    .toBe(true);
  return order as unknown as Record<string, unknown>;
}

async function placeWithGiftCard(page: Page) {
  await store.addProductToCart(page, "Product 1");
  await checkout.goto(page);
  await checkout.completeCheckoutForm(page, "Test", `E2EGiftCard${Date.now().toString(36)}`);
  return checkout.placeOrder(page);
}

test("an order part paid by a gift card is sent with the card as prepaid", async ({ page }) => {
  armGiftCard("10");
  const wcOrderId = Number(await placeWithGiftCard(page));
  expect(wcOrderId, "the order is placed").toBeTruthy();

  const order = (expression: string) =>
    wp("eval", `echo wc_get_order(${wcOrderId})->${expression};`).trim();
  const twoOrderId = order("get_meta('twoinc_order_id')");
  expect(twoOrderId, "Two accepted the order").toBeTruthy();
  const total = Number(order("get_total()")).toFixed(2);

  const twoOrder = await readTwoOrder(twoOrderId);
  expect(
    [twoOrder.prepaid_amount, twoOrder.payable_amount],
    `prepaid and payable: ${JSON.stringify(twoOrder)}`
  ).toEqual(["10.00", total]);
  expect(Number(twoOrder.invoice_amount), "the invoice covers the card too").toBeCloseTo(
    Number(total) + 10,
    2
  );
});

test("a gift card covering the whole order leaves nothing to pay, so Two is not offered", async ({
  page
}) => {
  armGiftCard("100000");
  await store.addProductToCart(page, "Product 1");
  await checkout.goto(page);
  // WooCommerce shows no payment methods for an order with nothing to pay; the place order button stays.
  await page.waitForLoadState("networkidle");
  await expect(
    page.locator("#place_order, .wc-block-components-checkout-place-order-button")
  ).toBeVisible();
  await expect(page.locator(checkout.paymentRadio)).toHaveCount(0);
});
