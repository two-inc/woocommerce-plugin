/**
 * #486, live bug (Doug, 2026-08-19): changing the checkout email to one that
 * resolves to a different business makes Two reject the order ("Two is not
 * available for this order by <other business>"). `toggleBusinessFields()`
 * used to gate `#billing_company_display_field`'s own visibility on
 * `isTwoincSelected` — a leftover from the removed
 * `enable_company_search_for_others` admin setting (TWO-25326). Once Two
 * stopped being the selected/eligible method, that gate fell through to the
 * plain manual field, silently downgrading a registered-company or
 * sole-trader buyer into manual-entry territory they never asked for —
 * manual entry is reachable ONLY via `enterManualCompanyEntry` (TWO-25288),
 * never as a side effect of Two being unavailable.
 *
 * The fix: the search-vs-plain decision is the buyer's own capture mode alone
 * (`twoincCompanyCapture.mode`), regardless of which payment method is selected
 * or available, and regardless of any admin setting. This suite pins that
 * directly, with no payment-method radio checked at all — the same effective
 * state as Two being unavailable.
 */

"use strict";

const harness = require("./wc-harness");

describe("company-field visibility is payment-method-agnostic (#486)", () => {
  let ctx;
  let $;

  beforeEach(() => {
    ctx = harness.loadTwoinc({
      enable_company_search: "yes",
      supported_buyer_countries: ["GB"]
    });
    harness.buildCheckoutForm({ country: "GB" });
    $ = ctx.$;
  });

  afterEach(() => {
    harness.releasePanel(ctx.helper);
    document.body.innerHTML = "";
  });

  test("search stays visible with no payment method selected (Two unavailable)", () => {
    // Sanity check on the fixture: no `payment_method` radio exists here at
    // all, so `isTwoincSelected()` reads false — the same state Two being
    // rejected for this order leaves the page in.
    expect($('input[name="payment_method"]:checked').length).toBe(0);

    ctx.dom.toggleBusinessFields();

    expect($("#billing_company_display_field").hasClass("hidden")).toBe(false);
    expect($("#billing_company_field").hasClass("hidden")).toBe(true);
  });

  test("a buyer already using the search widget is not knocked into the plain field when Two becomes unavailable", () => {
    // Two is selected and the search widget is the active input, same as a
    // buyer mid-checkout who has already started typing a company name.
    document.body
      .querySelector("form[name='checkout']")
      .insertAdjacentHTML(
        "beforeend",
        '<input type="radio" name="payment_method" value="woocommerce-gateway-tillit" checked />'
      );
    ctx.dom.toggleBusinessFields();
    expect($("#billing_company_display_field").hasClass("hidden")).toBe(false);

    // Two rejects the order (e.g. the email now resolves to a different
    // business) — the buyer's payment-method radio is unchecked to reflect
    // that Two is no longer a usable/selected option.
    $('input[name="payment_method"]').prop("checked", false);
    ctx.dom.toggleBusinessFields();

    expect($("#billing_company_display_field").hasClass("hidden")).toBe(false);
    expect($("#billing_company_field").hasClass("hidden")).toBe(true);
  });
});
