import { type Page, expect } from "@playwright/test";

export async function addProductToCart(page: Page, productName = "Product 1", quantity = 1) {
  const slug = productName.toLowerCase().replace(/\s+/g, "-");
  await page.goto(`/product/${slug}/`);
  await page.waitForLoadState("load");

  if (quantity !== 1) {
    await page.locator("input.qty").fill(String(quantity));
  }

  await page.locator("button.single_add_to_cart_button").click();
  await expect(page.locator(".woocommerce-message")).toBeVisible();
}

export async function goToCheckout(page: Page) {
  // The query arg pins the renderer for the rest of the run: without it the
  // shop's Blocks default bounces this request to /blocks/checkout/.
  await page.goto("/classic/checkout/?two-checkout=classic");
  await page.waitForLoadState("load");
}
