/**
 * TWO-25469, re-pinned for TWO-25503. A company field can be discarded outright
 * — WooCommerce's checkout-AJAX fragment `replaceWith()` is the documented
 * trigger — with no teardown call ever reaching the control attached to it.
 *
 * A body-appended dropdown outlives the field it belonged to, so the replace
 * leaves it orphaned and the next open renders a second one alongside it. The
 * panel is a child of the field's own wrapper, so it goes with the field.
 *
 * The panel closes that whole class of defect structurally — it is a child of
 * the field's own wrapper, so a fragment replace takes it with the field, and
 * `_releaseWrap` retires the wrapper when the panel re-points at a new host.
 * What has to stay true is unchanged and is what these assert: after any
 * re-attach there is exactly ONE panel in the document, anchored to the field
 * the buyer can actually see, and none loose in `<body>`.
 */

"use strict";

const harness = require("./wc-harness");

describe("company-search panel orphan sweep (TWO-25469)", () => {
  let ctx;

  beforeEach(() => {
    // `clearSelectedCompany()` arms a 3s deferred re-read that would otherwise
    // outlive the test and run against a torn-down DOM.
    jest.useFakeTimers();
    ctx = harness.loadTwoinc();
    harness.buildCheckoutForm();
  });

  afterEach(() => {
    harness.releasePanel(ctx.helper);
    document.body.innerHTML = "";
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  /** @returns {number} every panel anywhere in the document */
  function panelCount() {
    return document.querySelectorAll(".two-company-dropdown").length;
  }

  /** @returns {number} every panel currently showing */
  function openPanelCount() {
    return document.querySelectorAll(".two-company-dropdown:not([hidden])").length;
  }

  /** @returns {number} wrappers anywhere in the document */
  function wrapCount() {
    return document.querySelectorAll(".two-company-field-wrap").length;
  }

  /** Discard the company row wholesale and render a fresh, un-attached one. */
  function replaceCompanyFragment() {
    ctx.$("#billing_company_display_field").remove();
    ctx
      .$("form[name='checkout']")
      .append(
        '<p id="billing_company_display_field"><span class="woocommerce-input-wrapper">' +
          '<input type="text" id="billing_company_display" autocomplete="off" /></span></p>'
      );
  }

  test("an ordinary attach + open renders exactly one open panel", () => {
    harness.openCompanyPanel(ctx.$, ctx.helper);

    expect(panelCount()).toBe(1);
    expect(openPanelCount()).toBe(1);
    expect(document.body.querySelector(":scope > .two-company-dropdown")).toBeNull();
  });

  test("re-attaching after the field was discarded while open leaves no orphan behind", () => {
    harness.openCompanyPanel(ctx.$, ctx.helper);
    expect(openPanelCount()).toBe(1);

    replaceCompanyFragment();

    // The panel went with the field, because it was inside it — the whole
    // difference from the body-appended dropdown this defect was about.
    expect(panelCount()).toBe(0);

    // The re-attach every retry / mode-switch / manual-entry-exit path performs.
    ctx.helper.attach();

    expect(panelCount()).toBe(1);
    expect(wrapCount()).toBe(1);
    expect(openPanelCount()).toBe(0);

    ctx.helper.openCompanySearchDropdown();
    expect(openPanelCount()).toBe(1);
    expect(document.querySelector(".two-company-dropdown").parentElement).toBe(
      document.querySelector("#billing_company_display").parentElement
    );
  });

  test("clearSelectedCompany, the other re-attach site, sweeps the same way", () => {
    // `clearSelectedCompany()` re-attaches directly rather than through
    // `enableCompanySearch()` — reachable post-fragment-replace from
    // `onUpdatedCheckout` via `clearCompanyIfCountryStale`.
    harness.openCompanyPanel(ctx.$, ctx.helper);
    replaceCompanyFragment();

    ctx.helper.clearSelectedCompany();

    expect(panelCount()).toBe(1);
    expect(wrapCount()).toBe(1);
    expect(openPanelCount()).toBe(0);
  });

  test("the ordinary re-attach path (panel still live on the SAME field) is unaffected", () => {
    // Guards the adoption branch: re-attaching to the field the panel is
    // already on must adopt what is there rather than tear it down and rebuild,
    // which would drop the buyer's open panel on every `updated_checkout`.
    harness.openCompanyPanel(ctx.$, ctx.helper);
    const panel = document.querySelector(".two-company-dropdown");

    ctx.helper.attach();

    expect(panelCount()).toBe(1);
    expect(wrapCount()).toBe(1);
    expect(document.querySelector(".two-company-dropdown")).toBe(panel);
    expect(openPanelCount()).toBe(1);
  });

  test("moving the panel to the payment tile retires the address-form wrapper", () => {
    // The other way a host is abandoned: the mount moves rather than the
    // fragment being replaced. Two wrappers would be two anchors, and the
    // sole-trader fallback note would render against the one the buyer left.
    ctx.helper.attach();
    ctx.$("form[name='checkout']").append('<div class="twoinc-company-search-tile-slot"></div>');
    ctx.twoinc.company_search_location = "payment_tile";

    ctx.helper.syncCompanySearchTileLocation();

    expect(panelCount()).toBe(1);
    expect(wrapCount()).toBe(1);
    expect(
      document
        .querySelector(".two-company-field-wrap")
        .contains(document.querySelector(ctx.helper.tileFieldSelector))
    ).toBe(true);
  });
});
