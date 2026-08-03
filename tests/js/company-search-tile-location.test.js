/**
 * TWO-25326 §7.1, ruling 2026-08-03 (hardened after adversarial review the
 * same day). The `company_search_location` admin setting relocates the ONE
 * company-search control between the address area and the payment tile.
 *
 * The round-1 adversarial review (Leia, Han, Yoda, Vader — all four,
 * independently) found the same real bug in the first version of this
 * feature: the relocated fields were re-parented directly into
 * `.twoinc-company-search-tile-slot`, which lives inside
 * `.woocommerce-checkout-payment` — the exact fragment WooCommerce's
 * `update_order_review` AJAX replaces wholesale (`replaceWith`) on a
 * shipping-method change, a coupon apply, a quantity change, not only a
 * payment-method or country switch. A live `<select>`/`<input>` sitting
 * inside that fragment at the moment of a fragment swap is destroyed
 * outright, with nothing to resurrect it.
 *
 * The fix pairs `detachCompanySearchTileWrapperToSafety()` (bound to
 * WooCommerce's own PRESENT-tense `update_checkout` trigger — fired
 * synchronously, before the AJAX call that eventually replaces the
 * fragment) with `syncCompanySearchTileLocation()` (bound to the
 * PAST-tense `updated_checkout`, after the fragment is already back). This
 * suite drives that pair directly, simulating the fragment-replace with a
 * real DOM `replaceWith()` on `.twoinc-company-search-tile-slot`'s parent —
 * the same operation WooCommerce performs — and asserts the company fields
 * survive it.
 */

"use strict";

const harness = require("./wc-harness");

const GATEWAY_ID = "woocommerce-gateway-tillit";

describe("company-search tile location (TWO-25326 §7.1)", () => {
  let ctx;
  let $;
  let dom;

  beforeEach(() => {
    harness.buildCheckoutForm();
  });

  afterEach(() => {
    if ($) harness.releaseWidgets($);
    document.body.innerHTML = "";
  });

  /**
   * Append the minimal payment-tile markup `get_pay_box_description()`
   * server-renders: the tile slot, hidden and empty, inside
   * `.woocommerce-checkout-payment` — the exact WooCommerce container the
   * AJAX fragment-replace bug is about. Wrapped in the real checkout form so
   * `getCompanySearchTileHoldingPen()` finds a real `form[name="checkout"]`.
   *
   * @returns {void}
   */
  function buildTileSlot() {
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
        '<div class="twoinc-company-search-tile-slot hidden"></div>' +
        "</div>" +
        "</li>" +
        "</ul>" +
        "</div>"
    );
  }

  /** @returns {Object} the current `.twoinc-company-search-tile-slot` */
  function tileSlot() {
    return $(".twoinc-company-search-tile-slot");
  }

  /** @returns {Object} the current `.woocommerce-checkout-payment` container */
  function paymentFragment() {
    return $(".woocommerce-checkout-payment");
  }

  describe("payment_tile setting", () => {
    beforeEach(() => {
      ctx = harness.loadTwoinc({
        gateway_id: GATEWAY_ID,
        enable_company_search: "yes",
        company_search_location: "payment_tile",
        text: {}
      });
      $ = ctx.$;
      dom = ctx.dom;
      buildTileSlot();
    });

    test("moves the real fields into the tile slot, not a clone", () => {
      dom.syncCompanySearchTileLocation();

      const $display = $("#billing_company_display_field");
      expect($display.length).toBe(1);
      expect($display.closest(".twoinc-company-search-tile-slot").length).toBe(1);
      expect($("#billing_company_field").closest(".twoinc-company-search-tile-slot").length).toBe(
        1
      );
      expect($("#company_id_field").closest(".twoinc-company-search-tile-slot").length).toBe(1);
      expect(tileSlot().hasClass("hidden")).toBe(false);

      // Not a clone: exactly one #billing_company_display_field in the
      // whole document, and the address-area wrapper it used to sit in is
      // now empty.
      expect($("#billing_company_display_field").length).toBe(1);
      expect($(".woocommerce-billing-fields__field-wrapper #billing_company_field").length).toBe(
        0
      );
    });

    test("is idempotent — a second call does not physically re-detach nodes that are already in place", () => {
      dom.syncCompanySearchTileLocation();

      const appendToSpy = jest.spyOn($.fn, "appendTo");
      dom.syncCompanySearchTileLocation();

      expect(appendToSpy).not.toHaveBeenCalled();
      appendToSpy.mockRestore();
    });

    test("detach-to-safety is also idempotent — a second call in a row does not re-move an already-parked wrapper (round 2 review — Vader)", () => {
      dom.syncCompanySearchTileLocation();

      dom.detachCompanySearchTileWrapperToSafety();
      const appendToSpy = jest.spyOn($.fn, "appendTo");
      dom.detachCompanySearchTileWrapperToSafety();

      expect(appendToSpy).not.toHaveBeenCalled();
      appendToSpy.mockRestore();
    });

    test("a wrapper detached to the pen while the tile slot is absent stays parked there, not orphaned (round 2 review — Vader)", () => {
      dom.syncCompanySearchTileLocation();
      dom.detachCompanySearchTileWrapperToSafety();

      // Simulate the slot genuinely not existing yet when `updated_checkout`
      // fires — e.g. the gateway hasn't rendered on this particular refresh.
      tileSlot().remove();

      expect(() => dom.syncCompanySearchTileLocation()).not.toThrow();

      const $wrapper = $("#twoinc-company-search-tile-wrapper");
      expect($wrapper.length).toBe(1);
      expect($wrapper.closest("#twoinc-company-search-tile-holding-pen").length).toBe(1);
      expect($("#billing_company_display_field").length).toBe(1);
    });

    test("survives a WooCommerce-style fragment replace of .woocommerce-checkout-payment", () => {
      dom.syncCompanySearchTileLocation();
      expect($("#billing_company_display_field").closest(".twoinc-company-search-tile-slot").length).toBe(
        1
      );

      // The bug this whole mechanism exists to close: WooCommerce's
      // `update_checkout` trigger fires synchronously BEFORE the AJAX call
      // that eventually calls `.replaceWith()` on this fragment.
      dom.detachCompanySearchTileWrapperToSafety();

      // Simulate WooCommerce's own AJAX success handler: wholesale-replace
      // the payment fragment with a FRESH server render (an empty tile slot,
      // no company fields — exactly what `get_pay_box_description()`
      // produces on every render).
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
          '<div class="twoinc-company-search-tile-slot hidden"></div>' +
          "</div>" +
          "</li>" +
          "</ul>" +
          "</div>"
      );

      // The real company fields must have survived the replace — held safely
      // in the holding pen, not destroyed along with the old fragment.
      expect($("#billing_company_display_field").length).toBe(1);
      expect($("#billing_company").val).toBeDefined();

      // WooCommerce's own past-tense trigger, fired after the fragments are
      // back — this is what moves the surviving fields back into the FRESH
      // slot.
      dom.syncCompanySearchTileLocation();

      expect(
        $("#billing_company_display_field").closest(".twoinc-company-search-tile-slot").length
      ).toBe(1);
      expect(tileSlot().hasClass("hidden")).toBe(false);
    });

    test("a captured company value survives the fragment replace", () => {
      dom.syncCompanySearchTileLocation();
      $("#billing_company").val("ACME Widgets Ltd");
      $("#company_id").val("12345678");

      dom.detachCompanySearchTileWrapperToSafety();
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
          '<div class="twoinc-company-search-tile-slot hidden"></div>' +
          "</div>" +
          "</li>" +
          "</ul>" +
          "</div>"
      );
      dom.syncCompanySearchTileLocation();

      expect($("#billing_company").val()).toBe("ACME Widgets Ltd");
      expect($("#company_id").val()).toBe("12345678");
    });

    test("detach-to-safety is a no-op when nothing has been relocated yet", () => {
      // Never called syncCompanySearchTileLocation() — no wrapper exists.
      expect(() => dom.detachCompanySearchTileWrapperToSafety()).not.toThrow();
      expect($("#twoinc-company-search-tile-holding-pen").length).toBe(0);
    });

    test("the holding pen lives inside the checkout form, not detached from it", () => {
      dom.syncCompanySearchTileLocation();
      dom.detachCompanySearchTileWrapperToSafety();

      const $pen = $("#twoinc-company-search-tile-holding-pen");
      expect($pen.length).toBe(1);
      expect($pen.closest('form[name="checkout"]').length).toBe(1);
    });
  });

  describe("address_area setting (default)", () => {
    beforeEach(() => {
      ctx = harness.loadTwoinc({
        gateway_id: GATEWAY_ID,
        enable_company_search: "yes",
        company_search_location: "address_area",
        text: {}
      });
      $ = ctx.$;
      dom = ctx.dom;
      buildTileSlot();
    });

    test("is a no-op — the control never moves, the slot stays hidden", () => {
      const appendToSpy = jest.spyOn($.fn, "appendTo");

      dom.syncCompanySearchTileLocation();

      expect($("#billing_company_display_field").closest(".twoinc-company-search-tile-slot").length).toBe(
        0
      );
      expect(tileSlot().hasClass("hidden")).toBe(true);
      expect(appendToSpy).not.toHaveBeenCalled();
      appendToSpy.mockRestore();
    });

    test("detach-to-safety is also a no-op on this setting", () => {
      const appendToSpy = jest.spyOn($.fn, "appendTo");
      dom.detachCompanySearchTileWrapperToSafety();
      expect(appendToSpy).not.toHaveBeenCalled();
      appendToSpy.mockRestore();
    });
  });

  describe("no gateway/tile present yet", () => {
    beforeEach(() => {
      ctx = harness.loadTwoinc({
        gateway_id: GATEWAY_ID,
        enable_company_search: "yes",
        company_search_location: "payment_tile",
        text: {}
      });
      $ = ctx.$;
      dom = ctx.dom;
      // Deliberately no buildTileSlot() — the Two gateway markup (and so the
      // tile slot) has not rendered yet.
    });

    test("is a safe no-op, not a throw", () => {
      expect(() => dom.syncCompanySearchTileLocation()).not.toThrow();
      expect($("#billing_company_field").length).toBeGreaterThan(0);
      expect($("#billing_company_field").closest(".twoinc-company-search-tile-slot").length).toBe(
        0
      );
    });
  });
});
