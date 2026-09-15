import { test, expect, type Page } from "@playwright/test";

import * as blocks from "../pages/checkout-blocks.js";
import * as classic from "../pages/checkout.js";
import * as store from "../pages/store.js";

type Renderer = {
  variant: string;
  path: RegExp;
  paymentRadio: string;
  goTo: (page: Page) => Promise<void>;
  fill: (page: Page, lastName: string) => Promise<void>;
  placeOrder: (page: Page) => Promise<string>;
  description: string;
};

const RENDERERS: Renderer[] = [
  {
    variant: "blocks",
    path: /\/blocks\/checkout\/$/,
    paymentRadio: blocks.PAYMENT_RADIO,
    goTo: async (page) => {
      await page.goto("/blocks/checkout/?two-checkout=blocks");
      await page.locator(blocks.CHECKOUT_ROOT).waitFor({ state: "visible" });
    },
    fill: async (page, lastName) => {
      await blocks.selectTwoPayment(page);
      await blocks.fillCompanySearch(page);
      await blocks.fillContactDetails(page, "Test", lastName);
    },
    placeOrder: blocks.placeOrder,
    description: "Blocks renderer"
  },
  {
    variant: "classic",
    path: /\/classic\/checkout\/$/,
    paymentRadio: "#payment_method_woocommerce-gateway-tillit",
    goTo: store.goToCheckout,
    fill: async (page, lastName) => {
      await classic.fillBillingDetails(page, "Test", lastName);
      await classic.selectTwoPayment(page);
      await classic.fillCompanySearch(page);
    },
    placeOrder: classic.placeOrder,
    description: "classic renderer"
  }
];

test("a buyer with no renderer cookie lands on the Blocks checkout", async ({ page }) => {
  // Given a fresh browser; When following the shop's own checkout link
  await store.addProductToCart(page, "Product 1");
  await page.goto("/checkout/");

  // Then Blocks, not the classic shortcode page
  await expect(page, "Blocks is the shop's default renderer").toHaveURL(/\/blocks\/checkout\/$/);
  await expect(page.locator(blocks.CHECKOUT_ROOT)).toBeVisible();
});

for (const renderer of RENDERERS) {
  test(`the Two payment method is selectable in the ${renderer.description}`, async ({ page }) => {
    await store.addProductToCart(page, "Product 1");
    await renderer.goTo(page);

    const radio = page.locator(renderer.paymentRadio);
    await radio.waitFor({ state: "attached" });
    if (!(await radio.isChecked())) {
      await radio.check({ force: true });
    }

    await expect(
      radio,
      `Two is offered and selectable in the ${renderer.description}`
    ).toBeChecked();
  });

  test(`an order can be placed through the ${renderer.description}`, async ({ page }) => {
    const lastName = `E2E${renderer.variant}${Date.now().toString(36)}`;

    await store.addProductToCart(page, "Product 1");
    await renderer.goTo(page);
    await renderer.fill(page, lastName);
    const orderId = await renderer.placeOrder(page);

    expect(orderId, `an order placed through the ${renderer.description}`).toBeTruthy();
  });

  test(`the selector pins the ${renderer.description} across a page load`, async ({ page }) => {
    // Blocks sends an empty cart to /cart/, which would mask the renderer choice.
    await store.addProductToCart(page, "Product 1");
    await page
      .locator(`#two-checkout-selector a[href*="two-checkout=${renderer.variant}"]`)
      .click();

    await page.goto("/");
    await page.goto("/checkout/");

    await expect(page, `the ${renderer.description} survives a fresh page load`).toHaveURL(
      renderer.path
    );
  });
}
