import { type Page, expect } from "@playwright/test";

import {
  BUYER_COMPANY,
  DEFAULT_TIMEOUT,
  LONG_TIMEOUT,
  PHONE_NUMBER,
  RECIPIENT_EMAIL
} from "../config.js";

declare global {
  interface Window {
    wp?: { data?: { select: (store: string) => any } };
  }
}

export const CHECKOUT_ROOT = ".wp-block-woocommerce-checkout";
export const PAYMENT_RADIO = "#radio-control-wc-payment-method-options-woocommerce-gateway-tillit";
export const PLACE_ORDER_BUTTON = ".wc-block-components-checkout-place-order-button";

/** Both address forms carry a popover; the control adopts the first Blocks renders. */
export const COMPANY_WRAP = ".two-company-field-wrap";

export async function selectTwoPayment(page: Page) {
  const radio = page.locator(PAYMENT_RADIO);
  await radio.waitFor({ state: "attached", timeout: DEFAULT_TIMEOUT });
  if (!(await radio.isChecked())) {
    await radio.check({ force: true });
  }
  await expect(radio).toBeChecked();
}

/** Blocks names the address fields after the one form it renders: shipping only when the cart needs it. */
async function addressPrefix(page: Page): Promise<"shipping" | "billing"> {
  return (await page.locator("#shipping-address_1").count()) > 0 ? "shipping" : "billing";
}

/** The mode chips are a DOM child of the popover, so it has to be open first. */
export function modeChips(page: Page) {
  return page.locator(COMPANY_WRAP).first().locator(".two-company-mode-chips");
}

export async function openCompanySearch(page: Page) {
  const wrap = page.locator(COMPANY_WRAP).first();
  await wrap.locator("input").first().click();
  await wrap
    .locator(".two-company-dropdown__query")
    .waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT });
}

/** Blocks renders the country as a plain select, so it can be driven directly. */
export async function setBillingCountry(page: Page, countryName: string) {
  const prefix = await addressPrefix(page);
  const select = page.locator(`#${prefix}-country`);
  await select.waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT });
  const before = await select.inputValue();
  await select.selectOption({ label: countryName });
  await expect(select).not.toHaveValue(before, { timeout: DEFAULT_TIMEOUT });
}

export async function fillCompanySearch(page: Page, companyName = BUYER_COMPANY) {
  const wrap = page.locator(COMPANY_WRAP).first();
  await openCompanySearch(page);

  const query = wrap.locator(".two-company-dropdown__query");
  await query.pressSequentially(companyName, { delay: 50 });

  const result = wrap.locator(".two-company-dropdown__row").first();
  await result.waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT });
  await result.click();

  const prefix = await addressPrefix(page);
  await expect(page.locator(`#${prefix}-address_1`)).not.toBeEmpty({ timeout: LONG_TIMEOUT });

  // Typing before the store has taken the company address pushes its older,
  // empty copy back over it.
  await page.waitForFunction(
    (addressKey) => {
      const customer = window.wp?.data?.select("wc/store/cart")?.getCustomerData?.();
      return !!customer && !!customer[addressKey]?.address_1;
    },
    `${prefix}Address`,
    { timeout: LONG_TIMEOUT }
  );
}

export async function fillContactDetails(page: Page, firstName: string, lastName: string) {
  const prefix = await addressPrefix(page);
  const fields: Array<[string, string]> = [
    ["#email", RECIPIENT_EMAIL],
    [`#${prefix}-first_name`, firstName],
    [`#${prefix}-last_name`, lastName],
    [`#${prefix}-phone`, PHONE_NUMBER]
  ];

  // Blocks re-renders these from the cart store, so a value only holds once
  // the store has stopped overwriting it.
  await expect(async () => {
    for (const [selector, value] of fields) {
      const field = page.locator(selector);
      if ((await field.inputValue()) !== value) {
        await field.fill(value);
      }
    }
    await page.locator(`#${prefix}-phone`).blur();
    for (const [selector, value] of fields) {
      await expect(page.locator(selector)).toHaveValue(value, { timeout: DEFAULT_TIMEOUT });
    }
  }).toPass({ timeout: LONG_TIMEOUT, intervals: [1_000, 2_000, 5_000] });

  await page.waitForFunction(
    ([last, email, addressKey]) => {
      const customer = window.wp?.data?.select("wc/store/cart")?.getCustomerData?.();
      return (
        !!customer &&
        customer[addressKey]?.last_name === last &&
        customer.billingAddress?.email === email
      );
    },
    [lastName, RECIPIENT_EMAIL, `${prefix}Address`],
    { timeout: LONG_TIMEOUT }
  );
}

/** Together, and retried: each of the pair can push the cart store back over the other's writes. */
export async function fillOrderDetails(page: Page, firstName: string, lastName: string) {
  const prefix = await addressPrefix(page);
  const addressKey = `${prefix}Address`;

  await expect(async () => {
    await fillCompanySearch(page);
    await fillContactDetails(page, firstName, lastName);

    // The order is built from the cart store, not from the inputs, so a filled
    // field proves nothing about what would be submitted.
    const address = await page.evaluate(
      (key) => window.wp?.data?.select("wc/store/cart")?.getCustomerData?.()?.[key],
      addressKey
    );
    expect(address?.company, `cart store ${addressKey}.company`).toBeTruthy();
    expect(address?.address_1, `cart store ${addressKey}.address_1`).toBeTruthy();
    // Under the 180s per-test timeout, so this reports what did not hold rather
    // than dying as a bare test timeout, and placeOrder is left budget.
  }).toPass({ timeout: 90_000, intervals: [1_000, 2_000, 5_000] });
}

export async function acceptTerms(page: Page) {
  const checkbox = page.locator("#twoinc_terms_accepted");
  await checkbox.waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT });
  await checkbox.check();
  await expect(checkbox).toBeChecked();
}

export async function placeOrder(page: Page): Promise<string> {
  await acceptTerms(page);
  // A click while the pay box is still resolving the order intent is dropped.
  await page
    .locator(".twoinc-pay-box.twoinc-loader")
    .waitFor({ state: "hidden", timeout: LONG_TIMEOUT });
  await page.locator(PLACE_ORDER_BUTTON).click();

  await expect(page).toHaveURL(/\/checkout\/order-received\/(\d+)\//, { timeout: LONG_TIMEOUT });

  return page.url().match(/\/order-received\/(\d+)\//)?.[1] ?? "";
}
