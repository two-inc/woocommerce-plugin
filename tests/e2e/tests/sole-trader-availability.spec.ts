import { test, expect } from "@playwright/test";

import { LONG_TIMEOUT } from "../config.js";
import * as checkout from "../pages/checkout.js";
import * as store from "../pages/store.js";

/**
 * Sole trader checkout is gated on the registry's answer for the billing
 * country alone (TWO-25163 removed the merchant `enable_sole_trader`
 * toggle). That gate had no e2e coverage at all, which is how the flow
 * stayed broken in production for two weeks (TWO-25170). This asserts the
 * chooser appears exactly where the registry supports it — GB yes, NO no —
 * without driving the cross-origin hosted-signup popup.
 *
 * The mode-chips group is a DOM child of the company-search dropdown, not a
 * standalone widget (TWO-40 §0): it only exists in the document while the
 * dropdown is open. "Registered company" and "Enter manually" render
 * unconditionally; only the "Sole trader" chip is added/removed per country,
 * so the group itself never disappears — only that one chip does.
 */
test("sole trader mode chooser follows registry country support", async ({ page }) => {
  await store.addProductToCart(page, "Product 1");
  await store.goToCheckout(page);

  await checkout.fillBillingDetails(page, "Test", "E2ESoleTrader");
  await checkout.selectTwoPayment(page);

  const chips = page.locator(checkout.SOLE_TRADER_TOGGLE);
  const businessChip = chips.locator(`${checkout.MODE_CHIP}[data-mode="business"]`);
  const soleTraderChip = chips.locator(`${checkout.MODE_CHIP}[data-mode="sole_trader"]`);

  // GB is the store's default country and is sole-trader capable.
  await checkout.openCompanySearch(page);
  await expect(chips).toBeVisible({ timeout: LONG_TIMEOUT });
  await expect(businessChip).toHaveText("Registered company");
  await expect(soleTraderChip).toHaveText("Sole trader");
  // Registered company is the default mode, so an unattended business
  // checkout is unaffected by the chooser being present.
  await expect(businessChip).toHaveClass(/twoinc-mode-chip--selected/);
  await expect(soleTraderChip).not.toHaveClass(/twoinc-mode-chip--selected/);
  await page.keyboard.press("Escape");

  // Norway is not sole-trader capable: the group stays (business + manual
  // entry are always offered), only the sole-trader chip drops out of it.
  await checkout.setBillingCountry(page, "Norway");
  await checkout.openCompanySearch(page);
  await expect(chips).toBeVisible({ timeout: LONG_TIMEOUT });
  await expect(businessChip).toBeVisible();
  await expect(soleTraderChip).toHaveCount(0);
});
