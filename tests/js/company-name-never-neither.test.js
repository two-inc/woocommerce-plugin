/**
 * TWO-25503, Doug's "never neither" invariant.
 *
 * A company-name surface is visible in all twelve cells of
 * {address_area, payment_tile} x {capture, no capture} x
 * {Two selected, other method, none selected}. A buyer with nowhere to see or
 * enter the company name is the regression this exists to catch, and it has
 * reached staging twice.
 *
 * The second half of the ruling narrows it: once Two holds a capture AND is
 * the selected method in tile placement, the address area shows NEITHER the
 * captured name nor the sole-trader affordance — the tile is the surface.
 */

"use strict";

const harness = require("./wc-harness");

const NAME_SURFACES = [
  "#billing_company_display_field",
  "#billing_company_field",
  "#twoinc_tile_company_row"
];

/**
 * location, capture, method, the surfaces that must be on screen after the
 * toggle, and what the cell is for.
 */
const CASES = [
  ["address_area", true, "two", ["#billing_company_display_field"], "search control carries the capture"],
  ["address_area", true, "other", ["#billing_company_display_field"], "the control outlives the method"],
  ["address_area", true, "none", ["#billing_company_display_field"], "no method chosen yet"],
  ["address_area", false, "two", ["#billing_company_display_field"], "empty control is still the surface"],
  ["address_area", false, "other", ["#billing_company_display_field"], "another method, control stays"],
  ["address_area", false, "none", ["#billing_company_display_field"], "cold checkout"],
  ["payment_tile", true, "two", ["#twoinc_tile_company_row"], "the narrowing: tile is the only surface"],
  ["payment_tile", true, "other", ["#billing_company_field"], "tile collapsed, native row carries it"],
  ["payment_tile", true, "none", ["#billing_company_field"], "no tile open, native row carries it"],
  [
    "payment_tile",
    false,
    "two",
    ["#billing_company_field", "#twoinc_tile_company_row"],
    "no capture: address row stays beside the tile"
  ],
  ["payment_tile", false, "other", ["#billing_company_field"], "tile collapsed, nothing captured"],
  ["payment_tile", false, "none", ["#billing_company_field"], "cold checkout in tile placement"]
];

describe("company-name surface: never neither", () => {
  let ctx;

  const buildPaymentBox = () => {
    const $ = ctx.$;
    $("form[name='checkout']").append(
      [
        '<div id="payment">',
        '  <ul class="payment_methods">',
        '    <li class="wc_payment_method payment_method_woocommerce-gateway-tillit">',
        '      <input type="radio" name="payment_method" value="woocommerce-gateway-tillit" />',
        '      <div class="payment_box">',
        '        <div class="twoinc-company-search-tile-slot hidden"></div>',
        "      </div>",
        "    </li>",
        '    <li class="wc_payment_method payment_method_cod">',
        '      <input type="radio" name="payment_method" value="cod" />',
        "    </li>",
        "  </ul>",
        "</div>"
      ].join("\n")
    );
  };

  /**
   * Select a method the way WooCommerce leaves the DOM: the chosen radio
   * checked and every other method's `.payment_box` collapsed by an inline
   * `display: none`. Without the collapse a relocated tile row reads as on
   * screen under every method and the tile cells cannot fail.
   */
  const selectMethod = (method) => {
    const $ = ctx.$;
    $('input[name="payment_method"]').prop("checked", false);
    $(".payment_box").css("display", "none");
    if (method === "two") {
      $('input[value="woocommerce-gateway-tillit"]').prop("checked", true);
      $(".payment_method_woocommerce-gateway-tillit .payment_box").css("display", "");
    }
    if (method === "other") $('input[value="cod"]').prop("checked", true);
  };

  const visibleNameSurfaces = () =>
    NAME_SURFACES.filter((selector) => ctx.helper.isOnScreen(ctx.$(selector))).sort();

  beforeEach(() => {
    ctx = harness.loadTwoinc();
    harness.buildCheckoutForm();
    buildPaymentBox();
    // Every name surface starts hidden, so a cell passes only on a reveal the
    // code under test performed. `toggleBusinessFields()` hides all of them
    // before revealing any, so a fixture that ships one revealed asserts
    // itself.
    ctx.$("#billing_company_display_field, #billing_company_field").addClass("hidden");
  });

  afterEach(() => {
    harness.releasePanel(ctx.helper);
    document.body.innerHTML = "";
  });

  test.each(CASES)(
    "%s / capture=%s / %s shows %j — %s",
    (location, hasCapture, method, expected) => {
      ctx.twoinc.company_search_location = location;
      selectMethod(method);
      if (hasCapture) ctx.capture.write("Acme Ltd", "12345678");

      ctx.dom.toggleBusinessFields();

      expect(visibleNameSurfaces()).toEqual(expected.slice().sort());
    }
  );

  test("the search control mounts in the tile, never in the address area", () => {
    ctx.twoinc.company_search_location = "payment_tile";
    selectMethod("two");

    ctx.dom.toggleBusinessFields();

    expect(ctx.$("#twoinc_tile_company_row .two-company-field-wrap").length).toBe(1);
    expect(ctx.$("#billing_company_display_field .two-company-field-wrap").length).toBe(0);
  });

  test("#billing_company carries the captured name whatever is on screen", () => {
    ctx.twoinc.company_search_location = "payment_tile";
    selectMethod("two");
    ctx.capture.write("Acme Ltd", "12345678");
    ctx.dom.toggleBusinessFields();

    // Serialised, not read off the input: the POST is what the order carries.
    const posted = new URLSearchParams(ctx.$("form[name='checkout']").serialize());
    expect(posted.get("billing_company")).toBe("Acme Ltd");
    expect(posted.get("company_id")).toBe("12345678");
  });
});
