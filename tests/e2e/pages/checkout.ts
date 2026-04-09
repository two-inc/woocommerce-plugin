import { type Page, expect } from "@playwright/test";

import { BUYER_COMPANY, LONG_TIMEOUT, PHONE_NUMBER, RECIPIENT_EMAIL } from "../config.js";

export async function selectTwoPayment(page: Page) {
  const radio = page.locator("#payment_method_woocommerce-gateway-tillit");
  await radio.waitFor({ state: "attached" });
  if (!(await radio.isChecked())) {
    await radio.check({ force: true });
  }
}

export async function fillCompanySearch(page: Page, companyName = BUYER_COMPANY, retries = 3) {
  await page.waitForLoadState("networkidle");

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const container = page.locator("#select2-billing_company_display-container");
      await container.waitFor({ state: "visible" });
      await container.click();

      const searchInput = page.locator(".select2-search__field");
      await searchInput.waitFor({ state: "visible", timeout: 5_000 });
      await searchInput.pressSequentially(companyName, { delay: 50 });

      const result = page
        .locator(".select2-results__option:not(.select2-results__message)")
        .first();
      await result.waitFor({ state: "visible", timeout: 10_000 });
      await page.waitForTimeout(500);
      await result.click();

      await expect(page.locator("#billing_address_1")).not.toBeEmpty({ timeout: LONG_TIMEOUT });
      return;
    } catch (e) {
      if (attempt === retries) throw e;
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1_000);
    }
  }
}

export async function fillBillingDetails(page: Page, firstName: string, lastName: string) {
  await page.locator("#billing_first_name").fill(firstName);
  await page.locator("#billing_last_name").fill(lastName);
  await page.locator("#billing_email").fill(RECIPIENT_EMAIL);
  await page.locator("#billing_phone").fill(PHONE_NUMBER);
}

export async function placeOrder(page: Page): Promise<string> {
  await page.locator("#place_order").click();

  await expect(page).toHaveURL(/\/checkout\/order-received\/(\d+)\//, {
    timeout: LONG_TIMEOUT
  });

  const match = page.url().match(/\/order-received\/(\d+)\//);
  return match?.[1] ?? "";
}

export async function expectRejection(page: Page) {
  await expect(page.locator(".twoinc-err-payment-default")).toBeVisible({
    timeout: LONG_TIMEOUT
  });
}
