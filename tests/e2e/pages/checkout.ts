import { type Page, expect } from "@playwright/test";

import {
  BUYER_COMPANY,
  DEFAULT_TIMEOUT,
  LONG_TIMEOUT,
  PHONE_NUMBER,
  RECIPIENT_EMAIL
} from "../config.js";

export async function selectTwoPayment(page: Page) {
  const radio = page.locator("#payment_method_woocommerce-gateway-tillit");
  await radio.waitFor({ state: "attached" });
  if (!(await radio.isChecked())) {
    await radio.check({ force: true });
  }
}

export const SOLE_TRADER_TOGGLE = ".twoinc-sole-trader-toggle";
export const MODE_CHIP = ".twoinc-mode-item";

/**
 * The pay box renders a "Registered company / Sole trader" chooser whenever
 * the registry says the billing country supports sole traders — GB does, and
 * since TWO-25163 there is no merchant toggle left to suppress it. A business
 * buyer picks Registered company; do the same before driving the company
 * search, so the specs exercise the real GB checkout instead of assuming a
 * checkout with no mode chooser at all.
 *
 * The chip is only clicked when Registered company is not already the live
 * mode: clicking re-initialises the company-search select2 from scratch, so a
 * redundant click would be a source of flakiness rather than fidelity.
 *
 * No-op when the chooser is absent (country not sole-trader capable), so the
 * helper is safe to call from every spec.
 */
export async function selectRegisteredCompany(page: Page) {
  const chip = page.locator(`${SOLE_TRADER_TOGGLE} ${MODE_CHIP}[data-mode="business"]`);
  try {
    await chip.waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT });
  } catch {
    return;
  }
  const selected = await chip.evaluate((el) => el.classList.contains("twoinc-mode-item--selected"));
  if (!selected) {
    await chip.click();
  }
  await expect(chip).toHaveClass(/twoinc-mode-item--selected/);
}

export async function fillCompanySearch(page: Page, companyName = BUYER_COMPANY, retries = 3) {
  // Waiting for "networkidle" here used to stand in for "the checkout has
  // settled", and it deadlocked the whole suite once the sole-trader chooser
  // started rendering on GB: the autofill prefetch's 404 from
  // /autofill/v1/buyer/current is never drained by the browser, so Chromium's
  // in-flight request count never drops to zero and the wait can only time
  // out. Playwright discourages networkidle for exactly this reason — wait on
  // the UI that the next step needs instead, which is what the chooser and
  // the select2 container waits below do.
  await selectRegisteredCompany(page);

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

/**
 * Pick a billing country through the select2 the checkout actually renders
 * (the underlying <select> is hidden, so it cannot be driven directly).
 */
export async function setBillingCountry(page: Page, countryName: string) {
  const container = page.locator("#select2-billing_country-container");
  await container.waitFor({ state: "visible" });
  await container.click();

  const search = page.locator(".select2-container--open .select2-search__field");
  await search.waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT });
  await search.pressSequentially(countryName, { delay: 50 });

  const option = page
    .locator(".select2-container--open .select2-results__option:not(.select2-results__message)")
    .first();
  await option.waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT });
  await option.click();

  await expect(container).toHaveText(countryName, { timeout: DEFAULT_TIMEOUT });
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
