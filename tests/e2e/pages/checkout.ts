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

export const SOLE_TRADER_TOGGLE = ".two-company-mode-chips";
export const MODE_CHIP = ".two-company-mode-chip";

/** The company-capture popover, a child of the company field's own wrapper. */
export const COMPANY_PANEL = ".two-company-dropdown";

/** The company-name field the popover anchors to. */
export const COMPANY_FIELD = "#billing_company_display";

/**
 * The pay box renders a "Registered company / Sole trader" chooser whenever
 * the registry says the billing country supports sole traders — GB does, and
 * since TWO-25163 there is no merchant toggle left to suppress it. A business
 * buyer picks Registered company; do the same before driving the company
 * search.
 *
 * The chips live inside the popover, so it has to be open first. A no-op with
 * no address-area field (payment-tile placement) or no chip (country without
 * sole traders), so every spec can call it.
 */
export async function selectRegisteredCompany(page: Page) {
  try {
    await page.locator(COMPANY_FIELD).waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT });
  } catch {
    return;
  }
  await openCompanySearch(page);
  const chip = page.locator(`${COMPANY_PANEL} ${MODE_CHIP}[data-two-chip="registered"]`);
  try {
    await chip.waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT });
  } catch {
    return;
  }
  const selected = await chip.evaluate((el) =>
    el.classList.contains("two-company-mode-chip--selected")
  );
  if (!selected) {
    await chip.click();
  }
  await expect(chip).toHaveClass(/two-company-mode-chip--selected/);
}

/**
 * Open the company-capture popover without typing or picking a result — the
 * chips are inside it, so specs asserting on them need this rather than the
 * full `fillCompanySearch` flow.
 */
export async function openCompanySearch(page: Page) {
  const field = page.locator(COMPANY_FIELD);
  await field.waitFor({ state: "visible" });
  await field.click();
  await page
    .locator(`${COMPANY_PANEL} .two-company-dropdown__query`)
    .waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT });
}

export async function fillCompanySearch(page: Page, companyName = BUYER_COMPANY, retries = 3) {
  // Never "networkidle": the autofill prefetch's 404 is never drained by the
  // browser, so the in-flight count never reaches zero. Wait on the UI the next
  // step needs instead.
  await selectRegisteredCompany(page);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await openCompanySearch(page);

      const searchInput = page.locator(`${COMPANY_PANEL} .two-company-dropdown__query`);
      await searchInput.waitFor({ state: "visible", timeout: 5_000 });
      await searchInput.pressSequentially(companyName, { delay: 50 });

      const result = page.locator(`${COMPANY_PANEL} .two-company-dropdown__row`).first();
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
