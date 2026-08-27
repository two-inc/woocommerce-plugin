/**
 * TWO-25326 §7.1, ruling 2026-08-03 (hardened after adversarial review the
 * same day; corrected 2026-08-04 to derive the location from the existing
 * `enable_company_search` checkbox rather than a standalone location
 * setting). `window.twoinc.company_search_location` relocates the ONE
 * company-search control between the address area and the payment tile —
 * this suite drives that JS-side signal directly, so it is unaffected by
 * where the PHP side derives its value from.
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
  let helper;

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
  /** @returns {boolean} whether Two currently holds a capture */
  function twoincHasCapture() {
    return ctx.capture.hasCapture();
  }

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
        supported_buyer_countries: ["GB"],
        text: {}
      });
      $ = ctx.$;
      dom = ctx.dom;
      helper = ctx.helper;
      buildTileSlot();
      // The fixture ships the server's markup, where this row is `hidden`;
      // `toggleBusinessFields()` clears it on a real page once Two is selected
      // and the country is supported. This suite is about RELOCATION, not that
      // decision, so it states the precondition rather than inheriting a
      // fixture that pretends the server never set it.
      $("#billing_company_display_field").removeClass("hidden");
    });

    /**
     * Every way a capture can come into being has to reach the visibility
     * rule, not just the one that happens to re-toggle (TWO-25503). The
     * sole-trader path re-evaluates through `setCompany()`; the registry pick
     * writes the capture and previously re-read nothing, so the address row
     * kept the picked company on screen beside the tile that owns it.
     *
     * Driven through the real `select2:select` binding, not by calling the
     * rule: a direct call passes even when nothing is wired to it.
     */
    test("an ordinary registry pick hides the native field, same as an adoption", () => {
      const ajax = harness.stubAjax($);
      ctx.Twoinc.getInstance().enableCompanySearch();
      $("#billing_company_display").append(
        '<option value="ACME Widgets Ltd" selected>ACME Widgets Ltd</option>'
      );

      $("#billing_company_display").trigger({
        type: "select2:select",
        params: { data: { id: "ACME Widgets Ltd", company_id: "12345678" } }
      });
      ajax.restore();

      expect($("#billing_company").val()).toBe("ACME Widgets Ltd");
      expect($("#billing_company_field").hasClass("hidden")).toBe(true);
    });

    /**
     * The relocated control lives inside Two's payment box, which WooCommerce
     * collapses for every other method — so hiding the address row while
     * another method is selected leaves the buyer no company surface at all.
     * That is the "never neither" invariant (Doug 2026-08-19), and it outranks
     * the narrowing: a capture alone is not enough to take the row away.
     */
    test("keeps the native field when Two is not the selected method, capture or no capture", () => {
      ctx.capture.write("ACME Widgets Ltd", "12345678");
      $("input[name=payment_method]").prop("checked", false);

      dom.toggleBusinessFields();

      expect(twoincHasCapture()).toBe(true);
      expect($("#billing_company_field").hasClass("hidden")).toBe(false);
    });

    test("moves the search widget into the tile slot, not a clone", () => {
      helper.syncCompanySearchTileLocation();

      const $display = $("#billing_company_display_field");
      expect($display.length).toBe(1);
      expect($display.closest(".twoinc-company-search-tile-slot").length).toBe(1);
      expect(tileSlot().hasClass("hidden")).toBe(false);

      // Not a clone: exactly one #billing_company_display_field in the
      // whole document.
      expect($("#billing_company_display_field").length).toBe(1);
    });

    /**
     * Bugs found by Doug + adversarial review (Vader), live-verified
     * 2026-08-04: neither WooCommerce's OWN native `#billing_company_field`
     * NOR `#company_id_field` are part of this plugin's search control, and
     * neither may be relocated into the tile. `#billing_company_field` is
     * the plain, unenhanced fallback the buyer types into when manual entry
     * or sole-trader mode takes over (Hyvä companyName.phtml parity:
     * degrade to a plain field for the same entity attribute, never remove
     * it). `#company_id_field` is a plain hidden input with no visible home
     * to move to — it is submitted with the rest of the form regardless of
     * where inside it it physically sits, and moving it ALONE, without the
     * search widget behind it, would leave a bare, unlabelled, REQUIRED
     * "Company ID" box floating in the payment tile — checkout-blocking
     * confusion. A version of this function that folds either field back
     * into its move-set fails this test loudly.
     */
    test("never relocates #billing_company_field or #company_id_field — both stay in the address form, visible and editable", () => {
      helper.syncCompanySearchTileLocation();

      const $billingCompany = $("#billing_company_field");
      expect($billingCompany.length).toBe(1);
      expect($billingCompany.closest(".twoinc-company-search-tile-slot").length).toBe(0);
      expect($billingCompany.closest('form[name="checkout"]').length).toBe(1);
      expect($("#billing_company").prop("disabled")).toBeFalsy();

      const $companyId = $("#company_id_field");
      expect($companyId.length).toBe(1);
      expect($companyId.closest(".twoinc-company-search-tile-slot").length).toBe(0);
      expect($companyId.closest('form[name="checkout"]').length).toBe(1);
    });

    test("is idempotent — a second call does not physically re-detach nodes that are already in place", () => {
      helper.syncCompanySearchTileLocation();

      const appendToSpy = jest.spyOn($.fn, "appendTo");
      helper.syncCompanySearchTileLocation();

      expect(appendToSpy).not.toHaveBeenCalled();
      appendToSpy.mockRestore();
    });

    /**
     * Bug found in adversarial review round 2 (Han, 2026-08-04), widened in
     * the 2026-08-04 correction round 3: the field now always exists
     * server-side (`WC_Twoinc_Checkout::update_company_fields()` no longer
     * gates its registration on the checkbox), but manual entry and
     * sole-trader mode still hide it with the `hidden` class rather than
     * removing it from the DOM (see toggleBusinessFields). The move loop
     * moves it into the wrapper regardless of that class, so checking mere
     * presence would unhide the slot around a `display: none` field —
     * leaving the buyer a bare, unexplained gap
     * (`.twoinc-company-search-tile-slot`'s own `margin: 12px 0`) between
     * the sole-trader toggle and the intent message. This test hides the
     * display field the way toggleBusinessFields does in that state and
     * asserts the slot stays hidden even though the field itself did move.
     */
    test("stays hidden when the only thing moved in is a hidden field (manual entry / sole-trader mode)", () => {
      $("#billing_company_display_field").addClass("hidden");

      helper.syncCompanySearchTileLocation();

      expect(
        $("#billing_company_display_field").closest(".twoinc-company-search-tile-slot").length
      ).toBe(1);
      expect(tileSlot().hasClass("hidden")).toBe(true);
    });

    /**
     * TWO-25326 §7.1, correction 2026-08-04 round 3 (Doug's ruling): the
     * whole point of this correction is that the search control is
     * FUNCTIONAL once relocated, not just present in the DOM — the earlier
     * bug this ticket closes shipped the relocation mechanism with nothing
     * for it to move, because `update_company_fields()` skipped registering
     * the field whenever the checkbox was unchecked. Drives the real
     * checkout-page wiring (`Twoinc.initialize()`, not the helper directly)
     * so a regression that reintroduces that gate, or that leaves
     * `enableCompanySearch()` gated on the admin's raw checkbox value again,
     * fails here rather than only in a narrower unit test.
     */
    test("the relocated control is a live, initialized selectWoo widget — not just a moved DOM node", () => {
      // isCountrySupported() (called from toggleBusinessFields, which
      // initialize() reaches) reads this — absent from the fixture above,
      // which never exercises that branch itself.
      ctx.twoinc.supported_buyer_countries = ["GB"];

      ctx.$("form[name='checkout']").after('<div id="order_review"></div>');
      ctx
        .$("form[name='checkout']")
        .append(
          "<input type='radio' id='payment_method_" +
            GATEWAY_ID +
            "' name='payment_method' value='" +
            GATEWAY_ID +
            "' checked />"
        );

      ctx.Twoinc.getInstance().initialize(false);

      expect(
        $("#billing_company_display_field").closest(".twoinc-company-search-tile-slot").length
      ).toBe(1);
      expect(tileSlot().hasClass("hidden")).toBe(false);
      expect($("#billing_company_display").data("select2")).toBeTruthy();

      harness.releaseWidgets($);
      $(document.body).off();
    });

    test("detach-to-safety is also idempotent — a second call in a row does not re-move an already-parked wrapper (round 2 review — Vader)", () => {
      helper.syncCompanySearchTileLocation();

      helper.detachCompanySearchTileWrapperToSafety();
      const appendToSpy = jest.spyOn($.fn, "appendTo");
      helper.detachCompanySearchTileWrapperToSafety();

      expect(appendToSpy).not.toHaveBeenCalled();
      appendToSpy.mockRestore();
    });

    test("a wrapper detached to the pen while the tile slot is absent stays parked there, not orphaned (round 2 review — Vader)", () => {
      helper.syncCompanySearchTileLocation();
      helper.detachCompanySearchTileWrapperToSafety();

      // Simulate the slot genuinely not existing yet when `updated_checkout`
      // fires — e.g. the gateway hasn't rendered on this particular refresh.
      tileSlot().remove();

      expect(() => helper.syncCompanySearchTileLocation()).not.toThrow();

      const $wrapper = $("#twoinc-company-search-tile-wrapper");
      expect($wrapper.length).toBe(1);
      expect($wrapper.closest("#twoinc-company-search-tile-holding-pen").length).toBe(1);
      expect($("#billing_company_display_field").length).toBe(1);
    });

    test("survives a WooCommerce-style fragment replace of .woocommerce-checkout-payment", () => {
      helper.syncCompanySearchTileLocation();
      expect(
        $("#billing_company_display_field").closest(".twoinc-company-search-tile-slot").length
      ).toBe(1);

      // The bug this whole mechanism exists to close: WooCommerce's
      // `update_checkout` trigger fires synchronously BEFORE the AJAX call
      // that eventually calls `.replaceWith()` on this fragment.
      helper.detachCompanySearchTileWrapperToSafety();

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
      helper.syncCompanySearchTileLocation();

      expect(
        $("#billing_company_display_field").closest(".twoinc-company-search-tile-slot").length
      ).toBe(1);
      expect(tileSlot().hasClass("hidden")).toBe(false);
    });

    test("a captured company value survives the fragment replace", () => {
      helper.syncCompanySearchTileLocation();
      $("#billing_company").val("ACME Widgets Ltd");
      $("#company_id").val("12345678");

      helper.detachCompanySearchTileWrapperToSafety();
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
      helper.syncCompanySearchTileLocation();

      expect($("#billing_company").val()).toBe("ACME Widgets Ltd");
      expect($("#company_id").val()).toBe("12345678");
    });

    test("detach-to-safety is a no-op when nothing has been relocated yet", () => {
      // Never called syncCompanySearchTileLocation() — no wrapper exists.
      expect(() => helper.detachCompanySearchTileWrapperToSafety()).not.toThrow();
      expect($("#twoinc-company-search-tile-holding-pen").length).toBe(0);
    });

    test("the holding pen lives inside the checkout form, not detached from it", () => {
      helper.syncCompanySearchTileLocation();
      helper.detachCompanySearchTileWrapperToSafety();

      const $pen = $("#twoinc-company-search-tile-holding-pen");
      expect($pen.length).toBe(1);
      expect($pen.closest('form[name="checkout"]').length).toBe(1);
    });

    /**
     * Bug found live by Doug 2026-08-04: the read-only company-number
     * summary (`getCompanySummaryNode()`, TWO-25288) used to anchor itself
     * against `#company_id_field`, which — like `#billing_company_field` —
     * is deliberately never relocated into the tile. So relocating the
     * search control left the summary orphaned in the address area,
     * rendering nothing anyone had put there deliberately. The fix anchors
     * the summary against `#billing_company_display_field` itself — the one
     * field that DOES relocate — so it travels with the control instead of
     * being a second, independently-positioned element.
     */
    test("the read-only company summary follows the search control into the tile, not left orphaned in the address area", () => {
      $("#billing_company").val("ACME Widgets Ltd");
      $("#company_id").val("12345678");

      helper.syncCompanySearchTileLocation();
      helper.renderCompanySummary();

      const $summary = $("#" + helper.companySummaryId);
      expect($summary.length).toBe(1);
      expect($summary.closest(".twoinc-company-search-tile-slot").length).toBe(1);
      // Not left behind as a stray sibling in the address form.
      expect($summary.closest("#billing_company_field, #company_id_field").length).toBe(0);
    });

    /**
     * Bug found live by Doug 2026-08-04: unchecking "Enable Company Search
     * In Address Entry" (payment_tile mode) was silently removing
     * WooCommerce's OWN native `#billing_company_field` from the address
     * area entirely, leaving nothing there. Root cause:
     * `toggleBusinessFields()` decided whether to show the search field or
     * the native field using the RUNTIME `window.twoinc.enable_company_search`
     * flag — which `WC_Twoinc_Checkout::prepare_twoinc_object()` hardcodes to
     * "yes" unconditionally (TWO-25326 §7.1 correction 2026-08-04; see its
     * own doc comment) precisely so the relocated search widget stays live —
     * so that flag can no longer distinguish "checkbox on" from "checkbox
     * off". The two fields are independent concerns: the search control's
     * location (address area vs tile) is `company_search_location`'s job,
     * and WooCommerce's own native field must render exactly as WooCommerce
     * defines it regardless of that setting.
     */
    test("does not remove WooCommerce's native #billing_company_field when the search control is relocated to the tile", () => {
      // isCountrySupported() is what toggleBusinessFields() gates the
      // display-field branch on; absent from this describe block's own
      // fixture, which never exercises that branch directly.
      ctx.twoinc.supported_buyer_countries = ["GB"];

      dom.toggleBusinessFields();

      expect($("#billing_company_field").hasClass("hidden")).toBe(false);
      expect($("#billing_company_field").closest('form[name="checkout"]').length).toBe(1);
      expect($("#billing_company_field").closest(".twoinc-company-search-tile-slot").length).toBe(
        0
      );

      // The search control itself is still live, just relocated.
      expect(
        $("#billing_company_display_field").closest(".twoinc-company-search-tile-slot").length
      ).toBe(1);
      expect(tileSlot().hasClass("hidden")).toBe(false);
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
      helper = ctx.helper;
      buildTileSlot();
    });

    test("is a no-op — the control never moves, the slot stays hidden", () => {
      const appendToSpy = jest.spyOn($.fn, "appendTo");

      helper.syncCompanySearchTileLocation();

      expect(
        $("#billing_company_display_field").closest(".twoinc-company-search-tile-slot").length
      ).toBe(0);
      expect(tileSlot().hasClass("hidden")).toBe(true);
      expect(appendToSpy).not.toHaveBeenCalled();
      appendToSpy.mockRestore();
    });

    test("detach-to-safety is also a no-op on this setting", () => {
      const appendToSpy = jest.spyOn($.fn, "appendTo");
      helper.detachCompanySearchTileWrapperToSafety();
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
      helper = ctx.helper;
      // Deliberately no buildTileSlot() — the Two gateway markup (and so the
      // tile slot) has not rendered yet.
    });

    test("is a safe no-op, not a throw", () => {
      expect(() => helper.syncCompanySearchTileLocation()).not.toThrow();
      expect($("#billing_company_field").length).toBeGreaterThan(0);
      expect($("#billing_company_field").closest(".twoinc-company-search-tile-slot").length).toBe(
        0
      );
    });
  });
});
