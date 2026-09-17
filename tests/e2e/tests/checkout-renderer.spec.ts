import { test, expect } from "@playwright/test";

import { checkout, expectConfiguredRenderer } from "../pages/renderer.js";
import * as store from "../pages/store.js";

/**
 * The shop is shaped for one renderer before the suite runs
 * (tests/e2e/provision/checkout-renderer.php) and the whole suite runs once
 * per renderer. These assert that configuration took; placing an order under
 * each renderer is order-flow.spec.ts on each leg of that matrix.
 */
test(`the shop's checkout renders the ${checkout.renderer} renderer`, async ({ page }) => {
  // Given a shop configured for one renderer; When following its own checkout link
  await store.addProductToCart(page, "Product 1");
  await page.goto("/checkout/");

  // Then that renderer, and no trace of the other
  await expectConfiguredRenderer(page);
});

test(`the Two payment method is selectable in the ${checkout.renderer} renderer`, async ({
  page
}) => {
  await store.addProductToCart(page, "Product 1");
  await checkout.goto(page);
  await checkout.selectTwoPayment(page);

  await expect(
    page.locator(checkout.paymentRadio),
    `Two is offered and selectable in the ${checkout.renderer} renderer`
  ).toBeChecked();
});
