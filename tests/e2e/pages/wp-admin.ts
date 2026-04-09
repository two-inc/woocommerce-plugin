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

export async function openOrder(page: Page, searchTerm: string) {
  await page.locator(`a.order-view:has-text("${searchTerm}")`).first().click();
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
