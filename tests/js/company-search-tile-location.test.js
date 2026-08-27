/**
 * TWO-25326 §7.1 / TWO-25503. `window.twoinc.company_search_location` decides
 * WHERE the one company-capture control renders: the address area, or a row
 * this plugin builds inside Two's payment tile.
 *
 * Outcomes, not mechanism. The tile row is rebuilt from state on every
 * `updated_checkout` rather than dragged in and out of the fragment, so what
 * these assertions read is what the buyer ends up looking at: exactly one
 * company-name field in the tile, WooCommerce's own address rows left where
 * WooCommerce put them, and the slot hidden whenever it has nothing to show.
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
    if (ctx) harness.releasePanel(ctx.helper);
    document.body.innerHTML = "";
  });

  /**
   * The payment tile `get_pay_box_description()` server-renders: an empty,
   * hidden slot inside `.woocommerce-checkout-payment`, with Two checked.
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

  /** @returns {Object} the row this plugin builds inside that slot */
  function tileRow() {
    return $("#twoinc_tile_company_row");
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
      helper = ctx.helper;
      buildTileSlot();
    });

    /**
     * Every way a capture can come into being has to reach the visibility
     * rule, not just the one that happens to re-toggle (TWO-25503). Driven
     * through the callback the plugin hands the panel, not by calling the rule:
     * a direct call passes even when nothing is wired to it.
     */
    test("an ordinary registry pick hides the native field, same as an adoption", () => {
      const ajax = harness.stubAjax($);
      dom.toggleBusinessFields();

      helper.panel.onSelect({
        id: "ACME Widgets Ltd",
        text: "ACME Widgets Ltd",
        company_id: "12345678"
      });
      ajax.restore();

      expect($("#billing_company").val()).toBe("ACME Widgets Ltd");
      expect($("#billing_company_field").hasClass("hidden")).toBe(true);
      expect(helper.isOnScreen(tileRow())).toBe(true);
    });

    /**
     * The control lives inside Two's payment box, which WooCommerce collapses
     * for every other method — so hiding the address row while another method
     * is selected leaves the buyer no company surface at all. That is the
     * "never neither" invariant (Doug 2026-08-19), and it outranks the
     * narrowing: a capture alone is not enough to take the row away.
     */
    test("keeps the native field when Two is not the selected method, capture or no capture", () => {
      ctx.capture.write("ACME Widgets Ltd", "12345678");
      $("input[name=payment_method]").prop("checked", false);

      dom.toggleBusinessFields();

      expect(ctx.capture.hasCapture()).toBe(true);
      expect($("#billing_company_field").hasClass("hidden")).toBe(false);
    });

    test("the tile shows exactly one company-name field, and the address search row is not it", () => {
      helper.syncCompanySearchTileLocation();

      // The panel's own query box is not a company-name field.
      expect(tileSlot().find("input:not(.two-company-dropdown__query)").length).toBe(1);
      expect(tileRow().find("#twoinc_tile_company_name").length).toBe(1);
      expect(tileSlot().hasClass("hidden")).toBe(false);

      const $display = $("#billing_company_display_field");
      expect($display.length).toBe(1);
      expect($display.closest(".twoinc-company-search-tile-slot").length).toBe(0);
    });

    /**
     * Bugs found by Doug + adversarial review (Vader), live-verified
     * 2026-08-04: neither WooCommerce's OWN native `#billing_company_field`
     * NOR `#company_id_field` are part of this plugin's control, and neither
     * may end up in the tile. `#billing_company_field` is the plain,
     * unenhanced fallback the buyer types into when manual entry or
     * sole-trader mode takes over. `#company_id_field` is a plain hidden input
     * with no visible home to move to — a bare, unlabelled, REQUIRED "Company
     * ID" box floating in the payment tile is checkout-blocking confusion.
     */
    test("never puts #billing_company_field or #company_id_field in the tile — both stay in the address form, editable", () => {
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

    /**
     * `updated_checkout` fires far more often than the fragment is actually
     * replaced, and a row rebuilt on an untouched slot discards whatever the
     * buyer had typed into it.
     */
    test("re-syncing an untouched slot keeps the same row and one panel", () => {
      helper.syncCompanySearchTileLocation();
      const first = tileRow()[0];

      helper.syncCompanySearchTileLocation();
      helper.syncCompanySearchTileLocation();

      expect(tileRow()[0]).toBe(first);
      expect($("#twoinc_tile_company_name").length).toBe(1);
      expect($(".two-company-dropdown").length).toBe(1);
    });

    /**
     * Manual entry hands the name to the plain address field, so the tile has
     * nothing to show — and an unhidden empty slot renders as an unexplained
     * gap (its own `margin: 12px 0`) between the sole-trader toggle and the
     * intent message.
     */
    test("the slot stays hidden in manual entry, where the tile has nothing to show", () => {
      ctx.capture.mode = "manual";

      helper.syncCompanySearchTileLocation();

      expect(tileSlot().hasClass("hidden")).toBe(true);
      expect(helper.isOnScreen(tileRow())).toBe(false);
      expect($("#billing_company_field").hasClass("hidden")).toBe(false);
    });

    /**
     * The control must be FUNCTIONAL in the tile, not just present in the DOM.
     * Drives the real checkout-page wiring (`Twoinc.initialize()`) so a
     * regression in what bootstrap calls fails here rather than only in a
     * narrower unit test.
     */
    test("the tile field is a live, bound panel after the real bootstrap", () => {
      const ajax = harness.stubAjax($);
      $("form[name='checkout']").after('<div id="order_review"></div>');

      ctx.Twoinc.getInstance().initialize(false);
      ajax.restore();

      expect(tileSlot().hasClass("hidden")).toBe(false);
      expect(helper.panel.isBound()).toBe(true);
      expect(helper.panel.getField()[0]).toBe($("#twoinc_tile_company_name")[0]);
      expect(tileRow().find(".two-company-field-wrap > .two-company-dropdown").length).toBe(1);

      $(document.body).off();
    });

    /**
     * Bug found live by Doug 2026-08-04: the read-only company-number summary
     * anchored itself against `#company_id_field`, which never leaves the
     * address area — so in tile placement it rendered nowhere anyone had put
     * it deliberately. It follows `companyNameSurface()` now.
     */
    test("the read-only company summary renders beside the tile field, not orphaned in the address area", () => {
      ctx.capture.write("ACME Widgets Ltd", "12345678");

      dom.toggleBusinessFields();

      const $summary = $("#" + helper.companySummaryId);
      expect($summary.length).toBe(1);
      expect($summary.closest(".twoinc-company-search-tile-slot").length).toBe(1);
      expect($summary.closest("#billing_company_field, #company_id_field").length).toBe(0);
    });

    /**
     * Bug found live by Doug 2026-08-04: tile placement was silently removing
     * WooCommerce's OWN native `#billing_company_field` from the address area
     * entirely, leaving nothing there. The two are independent concerns —
     * where this plugin's control renders is `company_search_location`'s job,
     * and WooCommerce's native field renders as WooCommerce defines it.
     */
    test("keeps WooCommerce's native #billing_company_field in the address area while the tile is live", () => {
      dom.toggleBusinessFields();

      expect($("#billing_company_field").hasClass("hidden")).toBe(false);
      expect($("#billing_company_field").closest(".twoinc-company-search-tile-slot").length).toBe(
        0
      );

      expect(helper.isOnScreen(tileRow())).toBe(true);
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

    test("builds nothing in the tile — the slot stays hidden and empty", () => {
      helper.syncCompanySearchTileLocation();

      expect(tileRow().length).toBe(0);
      expect(tileSlot().hasClass("hidden")).toBe(true);
      expect($("#billing_company_display_field").closest('form[name="checkout"]').length).toBe(1);
    });

    test("the address search row is the company-name surface", () => {
      dom.toggleBusinessFields();

      expect(helper.isOnScreen($("#billing_company_display_field"))).toBe(true);
      expect($("#billing_company_field").hasClass("hidden")).toBe(true);
    });
  });

  describe("address_area setting, no tile slot rendered", () => {
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
      // Deliberately no buildTileSlot(): the slot renders inside Two's
      // payment-box description, so a checkout not offering Two has none.
    });

    test.each([
      { mode: "search", rebinds: true, description: "the panel follows the replaced field" },
      { mode: "sole_trader", rebinds: true, description: "an adopted company's panel follows too" },
      { mode: "manual", rebinds: false, description: "manual entry gets no panel back" }
    ])("$mode capture mode: $description", ({ mode, rebinds }) => {
      // Given a bound panel, when WooCommerce replaces the billing fragment...
      helper.attach();
      const $row = $("#billing_company_display_field");
      $row.replaceWith($row.prop("outerHTML"));
      const live = $("#billing_company_display")[0];
      expect(helper.panel.getField()[0]).not.toBe(live);

      // ...then the `updated_checkout` sync decides on capture mode alone.
      ctx.capture.mode = mode;
      helper.syncCompanySearchTileLocation();

      expect(helper.panel.getField()[0] === live).toBe(rebinds);
      expect($("#billing_company_display_field .two-company-dropdown").length).toBe(
        rebinds ? 1 : 0
      );
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
      expect(tileRow().length).toBe(0);
      expect($("#billing_company_field").length).toBeGreaterThan(0);
    });
  });

  describe("the tile keeps a company surface in every country (TWO-25232)", () => {
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
      buildTileSlot();
    });

    /**
     * @param {string} country
     * @returns {void}
     */
    function selectCountry(country) {
      $("#billing_country").append('<option value="' + country + '">x</option>');
      $("#billing_country").val(country);
    }

    // Asserted on the slot and the row it builds, never on a country list:
    // a gate reintroduced anywhere in the placement path fails here.
    test.each([
      { country: "GB", description: "a country with a registry" },
      { country: "NO", description: "another country with a registry" },
      { country: "ES", description: "a country with no registry" },
      { country: "US", description: "a country the checkout has never offered" }
    ])("$description leaves the tile slot showing a company row", ({ country }) => {
      selectCountry(country);

      dom.toggleBusinessFields();

      expect(tileSlot().hasClass("hidden")).toBe(false);
      expect(helper.isOnScreen(tileRow())).toBe(true);
      expect(helper.panel.getField()[0]).toBe($("#twoinc_tile_company_name")[0]);
    });

    // See the `requiredTargets` rule in `toggleBusinessFields()` (TWO-25232).
    test.each([
      { country: "GB", description: "a country with a registry" },
      { country: "US", description: "a country with no registry" }
    ])("$description requires the native field, not the tile input", ({ country }) => {
      selectCountry(country);

      dom.toggleBusinessFields();

      expect($("#billing_company").attr("required")).toBe("required");
      expect($("#twoinc_tile_company_name").attr("required")).toBeUndefined();
    });
  });

  describe("the address area still requires the search control (TWO-25232)", () => {
    test("required-ness stays on the display field when the control is in the address area", () => {
      ctx = harness.loadTwoinc({
        gateway_id: GATEWAY_ID,
        enable_company_search: "yes",
        company_search_location: "address_area",
        text: {}
      });
      $ = ctx.$;
      dom = ctx.dom;
      $('form[name="checkout"]').append(
        '<input type="radio" name="payment_method" value="' + GATEWAY_ID + '" checked />'
      );

      dom.toggleBusinessFields();

      expect($("#billing_company_display").attr("required")).toBe("required");
    });
  });

  describe("the tile keeps a company surface in every country (TWO-25232)", () => {
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
      buildTileSlot();
    });

    /**
     * @param {string} country
     * @returns {void}
     */
    function selectCountry(country) {
      $("#billing_country").append('<option value="' + country + '">x</option>');
      $("#billing_country").val(country);
    }

    // Asserted on the SLOT and on whatever row it holds, not on
    // `#billing_company_display_field` by name: the slot class is the one
    // anchor the tile keeps across the panel rewrite, so a country gate
    // reintroduced in either structure fails here.
    test.each([
      { country: "GB", description: "a country with a registry" },
      { country: "NO", description: "another country with a registry" },
      { country: "ES", description: "a country with no registry" },
      { country: "US", description: "a country the checkout has never offered" }
    ])("$description leaves the tile slot showing a company row", ({ country }) => {
      selectCountry(country);

      dom.toggleBusinessFields();

      expect(tileSlot().hasClass("hidden")).toBe(false);
      expect(tileSlot().find(":input").closest(".form-row").not(".hidden").length).toBeGreaterThan(
        0
      );
    });

    // selectWoo clips the original `<select>` instead of hiding it, so a
    // `required` the buyer cannot satisfy blocks submit with no visible
    // message. In the tile config the required-ness belongs on the native
    // field, which is on screen.
    test.each([
      { country: "GB", description: "a country with a registry" },
      { country: "US", description: "a country with no registry" }
    ])("$description requires the native field, not the clipped select", ({ country }) => {
      selectCountry(country);

      dom.toggleBusinessFields();

      expect($("#billing_company").attr("required")).toBe("required");
      expect($("#billing_company_display").attr("required")).toBeUndefined();
    });
  });

  describe("the address area still requires the search control (TWO-25232)", () => {
    test("required-ness stays on the display field when the control is in the address area", () => {
      ctx = harness.loadTwoinc({
        gateway_id: GATEWAY_ID,
        enable_company_search: "yes",
        company_search_location: "address_area",
        text: {}
      });
      $ = ctx.$;
      dom = ctx.dom;
      $('form[name="checkout"]').append(
        '<input type="radio" name="payment_method" value="' + GATEWAY_ID + '" checked />'
      );

      dom.toggleBusinessFields();

      expect($("#billing_company_display").attr("required")).toBe("required");
    });
  });
});
