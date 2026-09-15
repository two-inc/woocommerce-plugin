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
const COMPANY_WRAP = ".two-company-field-wrap";

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

export async function fillCompanySearch(page: Page, companyName = BUYER_COMPANY) {
  const wrap = page.locator(COMPANY_WRAP).first();
  await wrap.locator("input").first().click();

  const query = wrap.locator(".two-company-dropdown__query");
  await query.waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT });
  await query.pressSequentially(companyName, { delay: 50 });

  const result = wrap.locator(".two-company-dropdown__row").first();
  await result.waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT });
  await result.click();

  const prefix = await addressPrefix(page);
  await expect(page.locator(`#${prefix}-address_1`)).not.toBeEmpty({ timeout: LONG_TIMEOUT });
}

/** After the company pick: its address reaches the fields through the cart store, clearing these. */
export async function fillContactDetails(page: Page, firstName: string, lastName: string) {
  const prefix = await addressPrefix(page);
  await page.locator("#email").fill(RECIPIENT_EMAIL);
  await page.locator(`#${prefix}-first_name`).fill(firstName);
  await page.locator(`#${prefix}-last_name`).fill(lastName);
  await page.locator(`#${prefix}-phone`).fill(PHONE_NUMBER);
  await page.locator(`#${prefix}-phone`).blur();

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
