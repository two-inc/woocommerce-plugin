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

const LOCATIONS = ["address_area", "payment_tile"];
const CAPTURES = [true, false];
const METHODS = ["two", "other", "none"];

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

  const selectMethod = (method) => {
    const $ = ctx.$;
    $('input[name="payment_method"]').prop("checked", false);
    if (method === "two") $('input[value="woocommerce-gateway-tillit"]').prop("checked", true);
    if (method === "other") $('input[value="cod"]').prop("checked", true);
  };

  /** Every row that can carry the company name, in either placement. */
  const visibleNameSurfaces = () => {
    const $ = ctx.$;
    return ["#billing_company_display_field", "#billing_company_field", "#twoinc_tile_company_row"]
      .filter((selector) => ctx.helper.isOnScreen($(selector)))
      .sort();
  };

  beforeEach(() => {
    ctx = harness.loadTwoinc();
    harness.buildCheckoutForm();
    buildPaymentBox();
  });

  afterEach(() => {
    harness.releasePanel(ctx.helper);
    document.body.innerHTML = "";
  });

  LOCATIONS.forEach((location) => {
    CAPTURES.forEach((hasCapture) => {
      METHODS.forEach((method) => {
        const cell = `${location} / ${hasCapture ? "capture" : "no capture"} / ${method}`;

        test(`a company-name surface is visible: ${cell}`, () => {
          ctx.twoinc.company_search_location = location;
          selectMethod(method);
          if (hasCapture) ctx.capture.write("Acme Ltd", "12345678");

          ctx.dom.toggleBusinessFields();

          expect(visibleNameSurfaces().length).toBeGreaterThan(0);
        });
      });
    });
  });

  test("tile placement with a capture and Two selected shows neither address row", () => {
    ctx.twoinc.company_search_location = "payment_tile";
    selectMethod("two");
    ctx.capture.write("Acme Ltd", "12345678");

    ctx.dom.toggleBusinessFields();

    expect(ctx.helper.isOnScreen(ctx.$("#billing_company_display_field"))).toBe(false);
    expect(ctx.helper.isOnScreen(ctx.$("#billing_company_field"))).toBe(false);
    expect(ctx.helper.isOnScreen(ctx.$("#twoinc_tile_company_row"))).toBe(true);
  });

  test("the search row never renders in the address area under tile placement", () => {
    ctx.twoinc.company_search_location = "payment_tile";
    selectMethod("two");
    ctx.dom.toggleBusinessFields();

    expect(ctx.$("#billing_company_display_field").hasClass("hidden")).toBe(true);
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
