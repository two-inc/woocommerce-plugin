/**
 * Doug 2026-08-31 §2 — a COMPLETE second `TwoCompanySearch` instance on the
 * delivery/shipping role, and the billing-first/shipping-fallback rule for
 * which role's captured company reaches the order intent / order creation.
 *
 * The rule, Doug's own words: "where billing address is primary, use it
 * first and fall back to shipping only if no company number is available
 * from the billing address (either if the user just didn't provide a
 * company at all, or if they entered manually)." — manual-entry STATUS is
 * irrelevant to the decision; only whether a number was actually captured.
 */

"use strict";

const { loadTwoinc } = require("./wc-harness");

function buildForm() {
  document.body.innerHTML = [
    '<form name="checkout" class="checkout woocommerce-checkout">',
    '  <select id="billing_country" name="billing_country">',
    '    <option value="GB" selected>United Kingdom</option>',
    '    <option value="NO">Norway</option>',
    "  </select>",
    '  <input type="text" id="billing_company" name="billing_company" value="" />',
    '  <input type="text" id="billing_company_display" name="billing_company_display" value="" />',
    '  <input type="text" id="company_id" name="company_id" value="" />',
    '  <select id="shipping_country" name="shipping_country">',
    '    <option value="" selected></option>',
    '    <option value="GB">United Kingdom</option>',
    '    <option value="NO">Norway</option>',
    "  </select>",
    '  <input type="text" id="shipping_company" name="shipping_company" value="" />',
    '  <input type="text" id="shipping_company_display" name="shipping_company_display" value="" />',
    '  <input type="text" id="shipping_company_id" name="shipping_company_id" value="" />',
    '  <input type="checkbox" id="ship-to-different-address-checkbox" />',
    "</form>"
  ].join("\n");
}

describe("TWO-40 §2 — billing-first, shipping-fallback company resolution", () => {
  let ctx;
  let $;
  let capture;
  let roles;

  beforeEach(() => {
    ctx = loadTwoinc();
    $ = ctx.$;
    capture = ctx.capture;
    roles = ctx.roles;
    buildForm();
    ctx.Twoinc.getInstance();
    // The shipping form is "in play" for every test here unless a test says
    // otherwise — same convention `deliveryFormIsInPlay()` itself documents
    // (no checkbox at all reads as always in play; present-and-checked is
    // the other in-play state).
    $("#ship-to-different-address-checkbox").prop("checked", true);
  });

  function customerCompany() {
    return ctx.Twoinc.getInstance().customerCompany;
  }

  test("billing captured, shipping empty: billing feeds the order intent", () => {
    capture.write("Acme Ltd", "11111111", { role: roles.invoice() });
    expect(customerCompany().organization_number).toBe("11111111");
    expect(customerCompany().company_name).toBe("Acme Ltd");
  });

  test("shipping captured, billing empty, checkbox checked: shipping is the fallback", () => {
    capture.write("Ship Co", "22222222", { role: roles.delivery() });
    expect(customerCompany().organization_number).toBe("22222222");
    expect(customerCompany().company_name).toBe("Ship Co");
  });

  test("shipping captured, billing empty, checkbox UNCHECKED: neither source feeds the order intent", () => {
    capture.write("Ship Co", "22222222", { role: roles.delivery() });
    expect(customerCompany().organization_number).toBe("22222222");

    // Unchecking drops the shipping capture from RESOLUTION without erasing
    // it from the DOM (mirrors `twoincAddressMirror`'s own retain-but-ignore
    // shape) — re-checking would bring it back with no re-search needed.
    // Unchecking fires WooCommerce's own `updated_checkout`, simulated here
    // the same way other tests in this suite do.
    $("#ship-to-different-address-checkbox").prop("checked", false);
    ctx.Twoinc.getInstance().onUpdatedCheckout();

    expect($("#shipping_company_id").val()).toBe("22222222");
    expect(customerCompany().organization_number).toBeFalsy();
  });

  test("both captured: billing always wins regardless of capture order", () => {
    capture.write("Ship Co", "22222222", { role: roles.delivery() });
    capture.write("Acme Ltd", "11111111", { role: roles.invoice() });
    expect(customerCompany().organization_number).toBe("11111111");
    expect(customerCompany().company_name).toBe("Acme Ltd");
  });

  test("billing retyped away after shipping already had a capture: falls back to shipping", () => {
    capture.write("Acme Ltd", "11111111", { role: roles.invoice() });
    capture.write("Ship Co", "22222222", { role: roles.delivery() });
    expect(customerCompany().organization_number).toBe("11111111");

    // Clears billing's own number (the retype guard's own shape: name kept,
    // number dropped).
    capture.write("Acme Ltd", "", { role: roles.invoice() });
    expect(customerCompany().organization_number).toBe("22222222");
    expect(customerCompany().company_name).toBe("Ship Co");
  });

  test("shipping manual entry (name, no number): does not count as captured on either side", () => {
    // Manual entry writes a name with NO number, same shape guardCompanyRetype
    // and enterManualCompanyEntry both produce — never through write() with a
    // truthy id.
    capture.write("Ship Co (typed)", "", { role: roles.delivery() });
    expect($("#shipping_company").val()).toBe("Ship Co (typed)");
    expect(customerCompany().organization_number).toBeFalsy();
  });

  test("a synthetic sole-trader number on shipping counts as captured, same as a registry number", () => {
    // `TWO:`-prefixed ids are what sole-trader adoption mints
    // (`twoincUtilHelper.SYNTHETIC_NUMBER_PREFIX`) — the fallback rule cares
    // only that a number exists, not its shape.
    capture.write("Jane Trader", "TWO:ST99999", { role: roles.delivery() });
    expect(customerCompany().organization_number).toBe("TWO:ST99999");
  });

  test("no shipping country field at all (virtual/no-shipping cart): shipping is never a source", () => {
    $("#shipping_country").remove();
    capture.write("Ship Co", "22222222", { role: roles.delivery() });
    expect(customerCompany().organization_number).toBeFalsy();
  });
});

describe("TWO-40 §2 — the shipping instance is a genuine second TwoCompanySearch", () => {
  test("owns its own role, DOM ids and sole-trader controller, independent of billing's", () => {
    const ctx = loadTwoinc();
    buildForm();

    expect(ctx.shippingHelper).not.toBe(ctx.helper);
    expect(ctx.shippingHelper.role).toBe(ctx.roles.delivery());
    expect(ctx.helper.role).toBe(ctx.roles.invoice());

    expect(ctx.shippingHelper.addressFieldSelector).toBe("#shipping_company_display");
    expect(ctx.shippingHelper.addressFieldSelector).not.toBe(ctx.helper.addressFieldSelector);

    // Own sole-trader controller — not the same object, not the same mode.
    expect(ctx.shippingHelper.soleTrader).not.toBe(ctx.helper.soleTrader);
    ctx.helper.soleTrader.mode = "sole_trader";
    expect(ctx.shippingHelper.soleTrader.mode).toBe("business");

    // Own DOM ids, so a second mounted panel cannot collide with the first's.
    expect(ctx.shippingHelper.differentSoleTraderBtnId).not.toBe(ctx.helper.differentSoleTraderBtnId);
    expect(ctx.shippingHelper.soleTraderNoteSlotClass).not.toBe(ctx.helper.soleTraderNoteSlotClass);
    expect(ctx.shippingHelper.companySummaryId).not.toBe(ctx.helper.companySummaryId);
  });

  test("attach() builds an independent CompanySearchPanel with its own results id", () => {
    const ctx = loadTwoinc();
    buildForm();
    ctx.Twoinc.getInstance();

    ctx.helper.attach(ctx.Twoinc.getInstance());
    ctx.shippingHelper.attach(ctx.Twoinc.getInstance());

    expect(ctx.helper.panel).not.toBe(ctx.shippingHelper.panel);
    expect(ctx.helper.panel.isBound()).toBe(true);
    expect(ctx.shippingHelper.panel.isBound()).toBe(true);
    expect(ctx.helper.panel.getBindToken()).not.toBe(ctx.shippingHelper.panel.getBindToken());
  });
});
