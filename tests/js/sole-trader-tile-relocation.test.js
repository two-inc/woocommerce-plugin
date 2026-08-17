/**
 * TWO-40 (follow-up to TWO-25326 §7.1). The sole-trader mode chip
 * (`.twoinc-sole-trader-toggle`) is hardcoded into the payment tile's HTML
 * by `get_pay_box_description()`, immediately before
 * `.twoinc-company-search-tile-slot` — with NO relocation logic of its own,
 * unlike the company-search control that slot exists for.
 *
 * In the common/default admin configuration ("Enable Company Search In
 * Address Entry" checked, `company_search_location: 'address_area'`), the
 * search control lives in the address area but the chip stays stuck in the
 * tile — disconnected from the control it is supposed to be part of, per
 * the porting guide's §1 (chips are structurally part of the same search
 * control, not a separate widget bolted onto one fixed location).
 *
 * `discardStaleSoleTraderToggle()` + `relocateSoleTraderToggle()` close that
 * gap, called from `twoincSoleTrader.refresh()`/`apply()` — see their own
 * doc comments in twoinc.js for why the toggle needs different handling
 * than the search control: PHP re-emits a fresh, empty copy of the toggle
 * inside the tile on EVERY checkout AJAX refresh, unconditionally of
 * `company_search_location`, so a naive permanent move would leave two
 * live copies matching the same selector after the second refresh.
 */

"use strict";

const harness = require("./wc-harness");

const GATEWAY_ID = "woocommerce-gateway-tillit";

const SOLE_TRADER_CONFIG = {
  availability_url: "/?wc-ajax=twoinc_sole_trader_availability",
  tokens_url: "/?wc-ajax=twoinc_sole_trader_tokens",
  nonce: "nonce",
  text: {
    registered_business: "Registered business",
    sole_trader: "Sole trader",
    popup_prompt: "Register",
    change_prompt: "Select a different sole trader",
    checking: "Checking your details",
    error: "Something went wrong"
  }
};

describe("sole-trader toggle follows the search control (TWO-40)", () => {
  let ctx;
  let $;
  let helper;
  let soleTrader;

  beforeEach(() => {
    harness.buildCheckoutForm({ country: "GB" });
  });

  afterEach(() => {
    if ($) harness.releaseWidgets($);
    document.body.innerHTML = "";
  });

  /**
   * Append the payment tile markup `get_pay_box_description()` renders:
   * the sole-trader toggle immediately before the (unrelated) company-search
   * tile slot, both inside `.payment_box.payment_method_<gateway_id>` — the
   * same fragment WooCommerce's `update_order_review` AJAX replaces
   * wholesale.
   *
   * @returns {void}
   */
  function buildTile() {
    $('form[name="checkout"]').append(
      '<div class="woocommerce-checkout-payment">' +
        '<ul class="wc_payment_methods payment_methods methods">' +
        '<li class="wc_payment_method payment_method_' +
        GATEWAY_ID +
        '">' +
        '<input type="radio" name="payment_method" value="' +
        GATEWAY_ID +
        '" checked />' +
        '<div class="payment_box payment_method_' +
        GATEWAY_ID +
        '">' +
        '<div class="twoinc-sole-trader-toggle hidden" role="radiogroup"></div>' +
        '<div class="twoinc-company-search-tile-slot hidden"></div>' +
        "</div>" +
        "</li>" +
        "</ul>" +
        "</div>"
    );
  }

  /** @returns {Object} the current `.woocommerce-checkout-payment` container */
  function paymentFragment() {
    return $(".woocommerce-checkout-payment");
  }

  describe("address_area setting (default — the common config)", () => {
    beforeEach(() => {
      ctx = harness.loadTwoinc({
        gateway_id: GATEWAY_ID,
        enable_company_search: "yes",
        company_search_location: "address_area",
        supported_buyer_countries: ["GB"],
        text: {},
        sole_trader: SOLE_TRADER_CONFIG
      });
      $ = ctx.$;
      helper = ctx.helper;
      soleTrader = ctx.soleTrader;
      buildTile();
      soleTrader.availabilityByCountry.GB = true;
    });

    test("moves the chip out of the tile to sit right after the search control, not a clone", () => {
      soleTrader.refresh();

      const $toggle = $(".twoinc-sole-trader-toggle");
      expect($toggle.length).toBe(1);
      expect($toggle.closest(".payment_box").length).toBe(0);
      expect($toggle.prev()[0]).toBe($("#billing_company_display_field")[0]);
    });

    test("survives a WooCommerce-style fragment replace of .woocommerce-checkout-payment without duplicating", () => {
      soleTrader.refresh();
      expect($(".twoinc-sole-trader-toggle").length).toBe(1);

      // Simulate WooCommerce's own AJAX success handler: wholesale-replace
      // the payment fragment with a fresh server render — a brand new,
      // empty `.twoinc-sole-trader-toggle`, exactly what
      // `get_pay_box_description()` produces on every render, regardless of
      // the copy already parked in the address area from the cycle above.
      paymentFragment().replaceWith(
        '<div class="woocommerce-checkout-payment">' +
          '<ul class="wc_payment_methods payment_methods methods">' +
          '<li class="wc_payment_method payment_method_' +
          GATEWAY_ID +
          '">' +
          '<input type="radio" name="payment_method" value="' +
          GATEWAY_ID +
          '" checked />' +
          '<div class="payment_box payment_method_' +
          GATEWAY_ID +
          '">' +
          '<div class="twoinc-sole-trader-toggle hidden" role="radiogroup"></div>' +
          "</div>" +
          "</li>" +
          "</ul>" +
          "</div>"
      );

      // Two elements briefly match the bare class at this point (the stale
      // parked one and the fresh in-tile one) — exactly the state
      // `discardStaleSoleTraderToggle()` must clear before refresh() acts.
      expect($(".twoinc-sole-trader-toggle").length).toBe(2);

      soleTrader.refresh();

      const $toggle = $(".twoinc-sole-trader-toggle");
      expect($toggle.length).toBe(1);
      expect($toggle.prev()[0]).toBe($("#billing_company_display_field")[0]);
    });

    test("is idempotent — a second refresh in a row does not re-detach an already-parked chip", () => {
      soleTrader.refresh();

      const insertAfterSpy = jest.spyOn($.fn, "insertAfter");
      soleTrader.refresh();

      expect(insertAfterSpy).not.toHaveBeenCalled();
      insertAfterSpy.mockRestore();
    });

    test("unavailable in the buyer's country: still relocated (empty, hidden) rather than left behind in the tile", () => {
      soleTrader.availabilityByCountry.GB = false;

      soleTrader.refresh();

      const $toggle = $(".twoinc-sole-trader-toggle");
      expect($toggle.length).toBe(1);
      expect($toggle.hasClass("hidden")).toBe(true);
      expect($toggle.prev()[0]).toBe($("#billing_company_display_field")[0]);
    });
  });

  describe("payment_tile setting (checkbox unchecked)", () => {
    beforeEach(() => {
      ctx = harness.loadTwoinc({
        gateway_id: GATEWAY_ID,
        enable_company_search: "yes",
        company_search_location: "payment_tile",
        supported_buyer_countries: ["GB"],
        text: {},
        sole_trader: SOLE_TRADER_CONFIG
      });
      $ = ctx.$;
      helper = ctx.helper;
      soleTrader = ctx.soleTrader;
      buildTile();
      soleTrader.availabilityByCountry.GB = true;
    });

    test("is a no-op: the chip stays in the tile, already adjacent to the search slot", () => {
      soleTrader.refresh();

      const $toggle = $(".twoinc-sole-trader-toggle");
      expect($toggle.length).toBe(1);
      expect($toggle.closest(".payment_box.payment_method_" + GATEWAY_ID).length).toBe(1);
      expect($toggle.next().hasClass("twoinc-company-search-tile-slot")).toBe(true);
    });
  });
});
