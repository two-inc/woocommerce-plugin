/**
 * TWO-25503. WooCommerce replaces the whole `#payment` fragment on
 * every payment-method, coupon, shipping or quantity change, and once on every
 * page load. The tile's company-name row is rebuilt from state rather than
 * dragged out and back, so a replace costs nothing.
 *
 * The defect this pins: a row MOVED into that fragment is destroyed with it,
 * leaving the buyer with a present-but-empty tile wrapper, a hidden native
 * field, and no company field at all.
 */

"use strict";

const harness = require("./wc-harness");

const PAYMENT_FRAGMENT = [
  '<div id="payment">',
  '  <ul class="payment_methods">',
  '    <li class="wc_payment_method payment_method_woocommerce-gateway-tillit">',
  '      <input type="radio" name="payment_method" value="woocommerce-gateway-tillit" checked />',
  '      <div class="payment_box">',
  '        <div class="twoinc-company-search-tile-slot hidden"></div>',
  "      </div>",
  "    </li>",
  "  </ul>",
  "</div>"
].join("\n");

describe("payment-tile company search across a fragment replace", () => {
  let ctx;

  const replacePaymentFragment = () => {
    ctx.$("#payment").replaceWith(PAYMENT_FRAGMENT);
  };

  beforeEach(() => {
    ctx = harness.loadTwoinc({ company_search_location: "payment_tile" });
    harness.buildCheckoutForm();
    ctx.$("form[name='checkout']").append(PAYMENT_FRAGMENT);
    // The two bindings `initialize()` makes for these events, reproduced
    // because the harness deliberately leaves the bootstrap unrun.
    ctx.$(document.body).on("updated_checkout", ctx.Twoinc.getInstance().onUpdatedCheckout);
    ctx.$(document.body).on("change", 'input[name="payment_method"]', function () {
      ctx.dom.toggleBusinessFields();
    });
    ctx.dom.toggleBusinessFields();
  });

  afterEach(() => {
    harness.releasePanel(ctx.helper);
    document.body.innerHTML = "";
  });

  test("the tile carries a company-name field and its panel", () => {
    const row = document.querySelector(".twoinc-company-search-tile-slot #twoinc_tile_company_row");
    expect(row).not.toBeNull();
    expect(row.querySelector("#twoinc_tile_company_name")).not.toBeNull();
    expect(row.querySelector(".two-company-field-wrap > .two-company-dropdown")).not.toBeNull();
  });

  test("the tile label reuses the address row's, without core's optional marker", () => {
    const label = document.querySelector("#twoinc_tile_company_row label");
    expect(label.textContent).toBe("Company name");
    expect(label.getAttribute("for")).toBe("twoinc_tile_company_name");
  });

  test("the tile field posts nothing — #billing_company is the posted company", () => {
    ctx.capture.write("Acme Ltd", "12345678");
    ctx.dom.toggleBusinessFields();

    expect(document.querySelector("#twoinc_tile_company_name").hasAttribute("name")).toBe(false);
    const posted = new URLSearchParams(ctx.$("form[name='checkout']").serialize());
    expect(posted.get("billing_company")).toBe("Acme Ltd");
  });

  test("a fragment replace leaves the rebuilt tile holding the captured name", () => {
    ctx.capture.write("Acme Ltd", "12345678");
    ctx.dom.toggleBusinessFields();

    replacePaymentFragment();
    ctx.$(document.body).trigger("updated_checkout");

    const field = document.querySelector("#twoinc_tile_company_name");
    expect(field).not.toBeNull();
    expect(ctx.helper.isOnScreen(ctx.$("#twoinc_tile_company_row"))).toBe(true);
    expect(document.querySelectorAll("#twoinc_tile_company_name")).toHaveLength(1);
    expect(field.value).toBe("Acme Ltd");
  });

  test("the panel re-binds to the rebuilt field, never to the discarded one", () => {
    const before = document.querySelector("#twoinc_tile_company_name");

    replacePaymentFragment();
    ctx.$(document.body).trigger("updated_checkout");

    const after = document.querySelector("#twoinc_tile_company_name");
    expect(after).not.toBe(before);
    expect(ctx.helper.panel.getField()[0]).toBe(after);
    expect(document.querySelectorAll(".two-company-dropdown")).toHaveLength(1);
  });

  test("switching away from Two and back leaves the field on screen", () => {
    ctx.capture.write("Acme Ltd", "12345678");
    ctx.dom.toggleBusinessFields();

    // The two-click path that reproduced the empty tile deterministically.
    ctx.$('input[name="payment_method"]').prop("checked", false);
    ctx.$(document.body).trigger("update_checkout");
    replacePaymentFragment();
    ctx.$(document.body).trigger("updated_checkout");
    ctx.$('input[value="woocommerce-gateway-tillit"]').prop("checked", true).trigger("change");

    expect(ctx.helper.isOnScreen(ctx.$("#twoinc_tile_company_row"))).toBe(true);
    expect(document.querySelector("#twoinc_tile_company_name").value).toBe("Acme Ltd");
  });
});
