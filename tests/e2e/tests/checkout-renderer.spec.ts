import { test, expect } from "@playwright/test";

import { checkout, expectConfiguredRenderer } from "../pages/renderer.js";
import * as store from "../pages/store.js";

/** Only that the shop's configured renderer took: ordering under each is order-flow.spec.ts per matrix leg. */
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
