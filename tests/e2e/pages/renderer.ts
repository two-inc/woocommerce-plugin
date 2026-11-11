import { type Locator, type Page, expect, test } from "@playwright/test";

import { BUYER_COMPANY, CHECKOUT_RENDERER } from "../config.js";
import * as blocks from "./checkout-blocks.js";
import * as classic from "./checkout.js";
import { wooCommerceBelow } from "../wp-cli.js";

/** Renderer-independent: Blocks is a skin over the classic controller's chips. */
export const MODE_CHIP = classic.MODE_CHIP;

/** The shop has one checkout page, shaped for one renderer, so one spec covers both legs of the CI matrix. */
export type CheckoutDriver = {
  readonly renderer: "blocks" | "classic";
  /** Rendered only by this renderer, so it identifies which one the page ran. */
  readonly root: string;
  readonly paymentRadio: string;
  goto(page: Page): Promise<void>;
  selectTwoPayment(page: Page): Promise<void>;
  fillBuyerDetails(page: Page, firstName: string, lastName: string): Promise<void>;
  fillCompanySearch(page: Page, companyName?: string): Promise<void>;
  /** Buyer details and company capture, in the order this renderer needs them. */
  completeCheckoutForm(page: Page, firstName: string, lastName: string): Promise<void>;
  openCompanySearch(page: Page): Promise<void>;
  modeChips(page: Page): Locator;
  setBillingCountry(page: Page, countryName: string): Promise<void>;
  placeOrder(page: Page): Promise<string>;
  /** Places the order without waiting for the order-received page. */
  submitOrder(page: Page): Promise<void>;
  expectRejection(page: Page): Promise<void>;
};

const classicDriver: CheckoutDriver = {
  renderer: "classic",
  root: "form.woocommerce-checkout",
  paymentRadio: "#payment_method_woocommerce-gateway-tillit",
  goto: async (page) => {
    await page.goto("/checkout/");
    await page.locator(classicDriver.root).waitFor({ state: "visible" });
  },
  selectTwoPayment: classic.selectTwoPayment,
  fillBuyerDetails: classic.fillBillingDetails,
  fillCompanySearch: (page, companyName = BUYER_COMPANY) =>
    classic.fillCompanySearch(page, companyName),
  completeCheckoutForm: async (page, firstName, lastName) => {
    await classic.fillBillingDetails(page, firstName, lastName);
    await classic.selectTwoPayment(page);
    await classic.fillCompanySearch(page);
  },
  openCompanySearch: classic.openCompanySearch,
  modeChips: (page) => page.locator(classic.SOLE_TRADER_TOGGLE),
  setBillingCountry: classic.setBillingCountry,
  placeOrder: classic.placeOrder,
  submitOrder: classic.submitOrder,
  expectRejection: classic.expectRejection
};

const blocksDriver: CheckoutDriver = {
  renderer: "blocks",
  root: blocks.CHECKOUT_ROOT,
  paymentRadio: blocks.PAYMENT_RADIO,
  goto: async (page) => {
    await page.goto("/checkout/");
    await page.locator(blocksDriver.root).waitFor({ state: "visible" });
    // TWO-27177: before WooCommerce 11.4 the Checkout block can mount its
    // shipping form before the cart store holds the country, validate the
    // County as required, and keep that hidden error once the country turns
    // out to make it optional, so the order is refused at submit
    // (https://github.com/woocommerce/woocommerce/pull/69652). A buyer
    // reopening checkout has the country known on mount, so do the same.
    // Remove once the support window starts at WooCommerce 11.4.
    if (wooCommerceBelow(11, 4)) {
      await page.waitForFunction(
        () =>
          !!window.wp?.data?.select("wc/store/cart")?.getCustomerData?.()?.shippingAddress?.country
      );
      await page.reload();
      await page.locator(blocksDriver.root).waitFor({ state: "visible" });
    }
  },
  selectTwoPayment: blocks.selectTwoPayment,
  fillBuyerDetails: blocks.fillContactDetails,
  fillCompanySearch: (page, companyName = BUYER_COMPANY) =>
    blocks.fillCompanySearch(page, companyName),
  completeCheckoutForm: async (page, firstName, lastName) => {
    await blocks.selectTwoPayment(page);
    await blocks.fillOrderDetails(page, firstName, lastName);
  },
  openCompanySearch: blocks.openCompanySearch,
  modeChips: blocks.modeChips,
  setBillingCountry: blocks.setBillingCountry,
  placeOrder: blocks.placeOrder,
  submitOrder: blocks.submitOrder,
  // The pay box error is the gateway's own description markup, which the Blocks tile renders whole.
  expectRejection: classic.expectRejection
};

export const checkout: CheckoutDriver =
  CHECKOUT_RENDERER === "blocks" ? blocksDriver : classicDriver;

/**
 * TWO-27171: before WooCommerce 9.5.2 recalculating an order taxes its shipping lines whatever their tax status
 * (WC_Order_Item_Shipping::calculate_taxes()), and the Blocks checkout recalculates the order it builds from the
 * cart, so shipping the cart leaves untaxed is ordered taxed. The classic checkout keeps the cart's shipping tax.
 * Call from a test whose cart ships untaxed. Remove once the support window starts at WooCommerce 9.5.2.
 */
export function skipWhereCheckoutTaxesUntaxedShipping(): void {
  test.skip(
    checkout.renderer === "blocks" && wooCommerceBelow(9, 5, 2),
    "WooCommerce before 9.5.2 taxes untaxed shipping when the Blocks checkout recalculates the order: WC_Order_Item_Shipping::calculate_taxes() ignores the line's tax status"
  );
}

/** The renderer the shop was NOT configured for must not render at all. */
export async function expectConfiguredRenderer(page: Page) {
  const other = checkout.renderer === "blocks" ? classicDriver : blocksDriver;
  await expect(page).toHaveURL(/\/checkout\/$/);
  await expect(page.locator(checkout.root)).toBeVisible();
  await expect(page.locator(other.root)).toHaveCount(0);
}
