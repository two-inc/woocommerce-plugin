/**
 * TWO-40 — the shipping/delivery `TwoCompanySearch` instance must actually be
 * MOUNTED, not merely constructed.
 *
 * `twoincSelectWooHelperShipping` shipped fully configured while every
 * `attach()` call site named the billing instance alone, so the shipping
 * company field stayed a bare input: no popover, no chips, no results list.
 * These tests fail against that shape.
 *
 * The panel is what owns `.two-company-dropdown` inside the input's
 * `.two-company-field-wrap`, so its presence around a given input is the
 * mounted/not-mounted signal throughout.
 */

"use strict";

const { loadTwoinc, releasePanel } = require("./wc-harness");

/**
 * A checkout carrying both roles' company rows, a shipping country (so the
 * shipping form counts as rendered) and the tile slot the primary control
 * relocates into.
 *
 * @returns {void}
 */
function buildForm() {
  const rows = function (prefix) {
    return [
      '  <p id="' + prefix + '_company_display_field" class="form-row">',
      '    <label for="' + prefix + '_company_display">Company name</label>',
      '    <span class="woocommerce-input-wrapper">',
      '      <input type="text" id="' +
        prefix +
        '_company_display" name="' +
        prefix +
        '_company_display" autocomplete="off" />',
      "    </span>",
      "  </p>",
      '  <p id="' + prefix + '_company_field" class="form-row">',
      '    <label for="' + prefix + '_company">Company name</label>',
      '    <span class="woocommerce-input-wrapper">',
      '      <input type="text" id="' + prefix + '_company" name="' + prefix + '_company" />',
      "    </span>",
      "  </p>"
    ].join("\n");
  };
  document.body.innerHTML = [
    '<form name="checkout" class="checkout woocommerce-checkout">',
    '  <select id="billing_country" name="billing_country">',
    '    <option value="GB" selected>United Kingdom</option>',
    "  </select>",
    rows("billing"),
    '  <p id="company_name_field" class="form-row">',
    '    <input type="text" id="company_name" name="company_name" />',
    "  </p>",
    '  <p id="company_id_field" class="form-row">',
    '    <input type="text" id="company_id" name="company_id" />',
    "  </p>",
    '  <div class="woocommerce-shipping-fields" id="shipping-host">',
    '  <select id="shipping_country" name="shipping_country">',
    '    <option value="GB" selected>United Kingdom</option>',
    "  </select>",
    rows("shipping"),
    '  <p id="shipping_company_id_field" class="form-row">',
    '    <input type="text" id="shipping_company_id" name="shipping_company_id" />',
    "  </p>",
    "  </div>",
    '  <div id="order_review">',
    '    <div class="woocommerce-checkout-payment">',
    '      <div class="twoinc-company-search-tile-slot"></div>',
    "    </div>",
    "  </div>",
    "</form>"
  ].join("\n");
}

/**
 * Whether a control is mounted on `selector` — the panel builds its dropdown
 * as a direct child of the wrapper it puts around the input it binds to.
 *
 * @param {string} selector company-name input
 * @returns {boolean}
 */
function isMountedOn(selector) {
  const input = document.querySelector(selector);
  if (!input) return false;
  const wrap = input.closest(".two-company-field-wrap");
  return Boolean(wrap && wrap.querySelector(":scope > .two-company-dropdown"));
}

describe("TWO-40 — the shipping company-search control is mounted", () => {
  let ctx;

  beforeEach(() => {
    ctx = loadTwoinc();
    buildForm();
  });

  afterEach(() => {
    releasePanel();
  });

  test.each([
    ["#billing_company_display", "billing"],
    ["#shipping_company_display", "shipping"]
  ])("enableCompanySearch() mounts a control on %s (%s role)", (selector) => {
    ctx.Twoinc.getInstance().enableCompanySearch();
    expect(isMountedOn(selector)).toBe(true);
  });

  test("billing sitting in manual entry does not keep shipping unmounted", () => {
    // Independent per-role capture mode: the old gate read billing's mode for
    // both controls, so manual entry on the invoice address suppressed the
    // shipping control entirely.
    ctx.capture.setModeFor(ctx.roles.invoice(), "manual");

    ctx.Twoinc.getInstance().enableCompanySearch();

    expect(isMountedOn("#billing_company_display")).toBe(false);
    expect(isMountedOn("#shipping_company_display")).toBe(true);
  });

  test("shipping manual entry releases shipping's field, leaving billing mounted", () => {
    ctx.capture.setModeFor(ctx.roles.delivery(), "manual");

    ctx.Twoinc.getInstance().enableCompanySearch();

    expect(isMountedOn("#billing_company_display")).toBe(true);
    expect(isMountedOn("#shipping_company_display")).toBe(false);
  });

  test("toggleBusinessFields() mounts the shipping control", () => {
    ctx.dom.toggleBusinessFields();
    expect(isMountedOn("#shipping_company_display")).toBe(true);
  });

  test("toggleBusinessFields() stays a no-op where no shipping form is rendered", () => {
    // Given: a virtual cart — no shipping country field, so no shipping form.
    document.querySelector("#shipping-host").remove();

    ctx.dom.toggleBusinessFields();

    expect(isMountedOn("#billing_company_display")).toBe(true);
    expect(document.querySelectorAll(".two-company-dropdown")).toHaveLength(1);
  });

  test("updated_checkout re-mounts shipping after WooCommerce replaces its fields", () => {
    ctx.Twoinc.getInstance().enableCompanySearch();
    expect(isMountedOn("#shipping_company_display")).toBe(true);

    // WooCommerce re-renders the shipping fields on this refresh — the old
    // host, its wrapper and the panel inside it all go with it.
    const host = document.querySelector("#shipping-host");
    host.innerHTML = host.innerHTML.replace(/two-company-field-wrap/g, "");
    document.querySelectorAll(".two-company-dropdown").forEach((node) => node.remove());
    expect(isMountedOn("#shipping_company_display")).toBe(false);

    ctx.Twoinc.getInstance().onUpdatedCheckout();

    expect(isMountedOn("#shipping_company_display")).toBe(true);
  });

  test("in tile placement the shipping control stays on the shipping address input", () => {
    // The tile row and its input are built under one shared id, so a shipping
    // instance that answered `isTileLocation()` yes would bind its panel to
    // the PRIMARY role's tile input.
    ctx.twoinc.company_search_location = "payment_tile";

    ctx.dom.toggleBusinessFields();

    expect(ctx.shippingHelper.isTileLocation()).toBe(false);
    expect(ctx.shippingHelper.companyFieldSelector()).toBe("#shipping_company_display");
    expect(isMountedOn("#shipping_company_display")).toBe(true);
    expect(isMountedOn("#twoinc_tile_company_name")).toBe(true);
  });
});

describe("TWO-40 — the sole-trader controller resolves its own instance", () => {
  let ctx;

  beforeEach(() => {
    ctx = loadTwoinc();
    buildForm();
  });

  afterEach(() => {
    releasePanel();
  });

  test.each([
    ["billing", "helper", "#billing_company", "#company_id"],
    ["shipping", "shippingHelper", "#shipping_company", "#shipping_company_id"]
  ])(
    "%s adoption locks its own captured pair, not the other role's",
    (label, helperKey, nameSelector, numberSelector) => {
      const helper = ctx[helperKey];
      ctx.Twoinc.getInstance().enableCompanySearch();

      helper.soleTrader.lockCapturedFields("99999999", "Sole Trader Co");

      expect(document.querySelector(nameSelector).readOnly).toBe(true);
      expect(document.querySelector(numberSelector).readOnly).toBe(true);
    }
  );

  test("shipping adoption leaves billing's captured pair editable", () => {
    ctx.Twoinc.getInstance().enableCompanySearch();

    ctx.shippingHelper.soleTrader.lockCapturedFields("99999999", "Sole Trader Co");

    expect(document.querySelector("#billing_company").readOnly).toBe(false);
    expect(document.querySelector("#company_id").readOnly).toBe(false);
  });
});
