import { type Page, expect } from "@playwright/test";

import { ADMIN_PASSWORD, ADMIN_URL, ADMIN_USER } from "../config.js";

export async function login(page: Page) {
  await page.goto(`${ADMIN_URL}/`);
  await page.locator("#user_login").fill(ADMIN_USER);
  await page.locator("#user_pass").fill(ADMIN_PASSWORD);
  await page.locator("#wp-submit").click();
  await page.waitForLoadState("load");
}

export async function navigateToOrders(page: Page) {
  await page.goto(`${ADMIN_URL}/edit.php?post_type=shop_order`);
  await page.waitForLoadState("load");
}

/**
 * Open an order from the WP admin order list.
 *
 * The list renders whatever the order query returned at page load, so an order
 * placed moments earlier is not guaranteed to be listed on the first render.
 * Reload until the row appears instead of clicking a locator that is not there
 * yet and relying on the click timeout plus a test retry.
 */
export async function openOrder(page: Page, searchTerm: string) {
  const orderLink = page.locator(`a.order-view:has-text("${searchTerm}")`).first();

  await expect(async () => {
    if ((await orderLink.count()) === 0) {
      await page.reload();
      await page.waitForLoadState("load");
    }
    await expect(orderLink).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000, intervals: [1_000, 2_000, 5_000] });

  await orderLink.click();
  await page.waitForLoadState("load");
}

export async function getTwoOrderId(page: Page): Promise<string> {
  const field = page.locator('textarea:right-of(input[value="twoinc_order_id"])').first();
  await field.waitFor({ state: "visible" });
  const value = await field.inputValue();
  return value.trim();
}

export async function changeOrderStatus(page: Page, status: string) {
  await page.locator("#order_status").selectOption({ label: status });
  await page.locator("button.save_order").click();
  await page.waitForLoadState("load");
}

export async function refundOrder(page: Page, quantity: number) {
  await page.locator("button.refund-items").click();

  const refundQty = page.locator(".refund_order_item_qty").first();
  await refundQty.waitFor({ state: "visible" });
  await refundQty.fill(String(quantity));

  page.once("dialog", (dialog: { accept: () => Promise<void> }) => dialog.accept());
  await page.locator(".do-api-refund").click();

  await expect(page.locator(".refund").first()).toBeVisible();
}
