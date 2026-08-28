/**
 * #486 — the two company surfaces the buyer actually sees (Doug, 2026-08-19).
 *
 * NAME: always on screen, as exactly one of two elements — the search control
 * (`#billing_company_display_field`) or WooCommerce's native
 * `#billing_company`. Never both in the address area, never neither. The
 * regression this pins down had a third state: on a billing country with no
 * supported registry the search control was hidden and a bare, editable
 * "Company ID" box was shown in its place, so the checkout captured a company
 * NUMBER with no name field anywhere on the page.
 *
 * NUMBER: no longer a field at all. `#company_id` stays in the DOM as a real,
 * named, permanently hidden input — it is what WooCommerce posts and what the
 * order intent is authorised against — and the value reaches the buyer only as
 * the read-only label `renderCompanySummary()` renders below the name field,
 * under exactly two conditions: registered-company mode (`search`), and a
 * number that is not internally minted.
 *
 * Neither surface is gated on Two being the selected payment method. That is
 * the point of the pair: a buyer Two rejects, or one who switches to another
 * method mid-checkout, must not watch the company they captured disappear.
 */

"use strict";

const harness = require("./wc-harness");

const GATEWAY_ID = "woocommerce-gateway-tillit";
const SYNTHETIC = "TWO:ST:GB:0f8c2b1a";

const SOLE_TRADER_CONFIG = {
  availability_url: "/?wc-ajax=two_sole_trader_availability",
  tokens_url: "/?wc-ajax=two_sole_trader_tokens",
  nonce: "nonce",
  text: {
    registered_business: "Registered company",
    sole_trader: "Sole trader",
    popup_prompt: "Click here to login or sign up as a sole trader.",
    select_different: "Select a different sole trader",
    error: "Something went wrong"
  }
};

describe("the company name and number surfaces (#486)", () => {
  let ctx;
  let $;

  /**
   * @param {string} [country] the billing country the fixture selects; "GB" is
   *   in `supported_buyer_countries`, "US" deliberately is not
   * @returns {void}
   */
  function load(country) {
    ctx = harness.loadTwoinc({
      gateway_id: GATEWAY_ID,
      supported_buyer_countries: ["GB"],
      enable_order_intent: "no",
      enable_address_lookup: "no",
      company_search_location: "address_area",
      sole_trader: SOLE_TRADER_CONFIG
    });
    $ = ctx.$;
    harness.buildCheckoutForm({ country: country || "GB" });
    // Two selected by default: every assertion below is about behaviour that
    // must NOT depend on this, so the tests that care flip it explicitly.
    $("form[name='checkout']").append(
      [
        '<div id="payment"><ul class="payment_methods">',
        '<li class="wc_payment_method payment_method_woocommerce-gateway-tillit">',
        '<input type="radio" name="payment_method" value="' + GATEWAY_ID + '" checked />',
        '<div class="payment_box">',
        '<div class="twoinc-company-search-tile-slot hidden"></div>',
        "</div></li></ul></div>"
      ].join("")
    );
    ctx.Twoinc.getInstance();
  }

  afterEach(() => {
    harness.releasePanel(ctx.helper);
    sessionStorage.clear();
    document.body.innerHTML = "";
  });

  /**
   * @param {string} selector
   * @returns {boolean}
   */
  function isVisible(selector) {
    const $el = $(selector);
    return $el.length > 0 && !$el.hasClass("hidden");
  }

  /** @returns {Object} the read-only number label */
  function label() {
    return $("#" + ctx.helper.companySummaryId);
  }

  /** @returns {boolean} */
  function labelShown() {
    return label().length > 0 && !label().hasClass("hidden");
  }

  /** @returns {string} */
  function labelText() {
    return label().find(".twoinc-company-summary-id").text();
  }

  describe("the company NAME is always exactly one of the two elements", () => {
    // The whole matrix in one table: three capture modes crossed with
    // supported/unsupported billing country. `search` and `sole_trader` both
    // render the name through the picker (TWO-40 §7 direction (a) seeds the
    // adopted sole trader into it as its own selection); manual entry and an
    // unsupported country both hand the name to the native field.
    test.each([
      { mode: "search", country: "GB", picker: true, description: "search on a supported country" },
      {
        mode: "sole_trader",
        country: "GB",
        picker: true,
        description: "sole trader on a supported country — the adopted name renders in the picker"
      },
      {
        mode: "manual",
        country: "GB",
        picker: false,
        description: "manual entry hands the name to WooCommerce's own field"
      },
      {
        mode: "search",
        country: "US",
        picker: false,
        description: "search on a country with no registry falls back to the native field"
      },
      {
        mode: "sole_trader",
        country: "US",
        picker: false,
        description: "sole trader on a country with no registry does too"
      },
      {
        mode: "manual",
        country: "US",
        picker: false,
        description: "manual entry on a country with no registry stays on the native field"
      }
    ])("$description", ({ mode, country, picker }) => {
      load(country);
      ctx.capture.mode = mode;

      ctx.dom.toggleBusinessFields();

      expect(isVisible("#billing_company_display_field")).toBe(picker);
      expect(isVisible("#billing_company_field")).toBe(!picker);
    });

    test.each([
      { mode: "search", country: "GB", description: "search, supported country" },
      { mode: "search", country: "US", description: "search, no registry" },
      { mode: "sole_trader", country: "GB", description: "sole trader, supported country" },
      { mode: "sole_trader", country: "US", description: "sole trader, no registry" },
      { mode: "manual", country: "GB", description: "manual entry, supported country" },
      { mode: "manual", country: "US", description: "manual entry, no registry" }
    ])(
      "$description shows a name element whichever payment method is selected",
      ({ mode, country }) => {
        // The regression guard for the carve-outs #486 removed: a buyer Two
        // rejects, or one who simply chooses another method, kept the company
        // they captured on screen or they did not, depending on a flag that had
        // nothing to do with either question.
        load(country);
        ctx.capture.mode = mode;
        $('input[name="payment_method"]').prop("checked", false);

        ctx.dom.toggleBusinessFields();

        const shown =
          Number(isVisible("#billing_company_display_field")) +
          Number(isVisible("#billing_company_field"));
        expect(shown).toBe(1);
      }
    );

    test("the tile row and the native field share the page when the control lives in the tile", () => {
      // The ONE documented exception to "exactly one" (Doug 2026-08-04,
      // live-verified): unchecking "Enable company search in address entry"
      // RELOCATES the search control into the payment tile rather than turning
      // it off, so the two are no longer competing for the same position and
      // the address area still needs WooCommerce's own field. The address
      // search row is never the relocated control — the tile builds its own.
      load("GB");
      ctx.twoinc.company_search_location = "payment_tile";

      ctx.dom.toggleBusinessFields();

      expect(isVisible("#billing_company_display_field")).toBe(false);
      expect(isVisible("#twoinc_tile_company_row")).toBe(true);
      expect(isVisible("#billing_company_field")).toBe(true);
    });
  });

  describe("the company NUMBER is a read-only label, not a field", () => {
    // Two independent mechanisms, so `shown` and `text` are tabled separately:
    // the capture mode decides whether the label is DISPLAYED, and
    // `formatCompanyNumber()` decides whether the number reaches the DOM as
    // text at all (it returns "" for an internally minted one, TWO-25326 §12).
    // A minted number therefore fails on both counts, which is what stops a
    // `TWO:…` string sitting in the markup of a hidden node waiting for a
    // future mode switch to reveal it.
    test.each([
      {
        mode: "search",
        value: "12345678",
        shown: true,
        text: "12345678",
        description: "search mode, registry number"
      },
      {
        mode: "search",
        value: SYNTHETIC,
        shown: false,
        text: "",
        description: "search mode, internally minted number — TWO-25326 §12 forbids showing it"
      },
      {
        mode: "search",
        value: "",
        shown: false,
        text: "",
        description: "search mode, nothing captured — no empty block under the field"
      },
      {
        mode: "manual",
        value: "12345678",
        shown: false,
        text: "12345678",
        description: "manual entry captures a name only, so no number label"
      },
      {
        mode: "sole_trader",
        value: "12345678",
        shown: false,
        text: "12345678",
        description: "sole trader is not registered-company mode, even holding a registry number"
      },
      {
        mode: "sole_trader",
        value: SYNTHETIC,
        shown: false,
        text: "",
        description: "sole trader holding a minted number fails both conditions"
      }
    ])("$description", ({ mode, value, shown, text }) => {
      load("GB");
      ctx.capture.mode = mode;
      $("#company_id").val(value);

      ctx.dom.toggleBusinessFields();

      expect(labelShown()).toBe(shown);
      expect(labelText()).toBe(text);
    });

    test("shown whichever payment method is selected", () => {
      // Deliberately NOT gated on Two: the number belongs to the company the
      // buyer captured, not to Two's tile. This inverts the pre-#486 rule, so a
      // regression back to it fails here.
      load("GB");
      $("#company_id").val("12345678");
      $('input[name="payment_method"]').prop("checked", false);

      ctx.dom.toggleBusinessFields();

      expect(labelShown()).toBe(true);
      expect(labelText()).toBe("12345678");
    });

    test("mirrors #company_id when the value is written AFTER the fields were toggled", () => {
      // The ordering that matters: production toggles the fields first and the
      // picker/sole-trader/user-meta writes land afterwards, so a label that
      // only ever rendered from toggleBusinessFields() would stay empty through
      // every real capture.
      load("GB");
      ctx.dom.toggleBusinessFields();
      expect(labelShown()).toBe(false);

      ctx.capture.write("ACME Widgets Ltd", "99887766");
      ctx.helper.renderCompanySummary();

      expect(labelShown()).toBe(true);
      expect(labelText()).toBe("99887766");
    });

    test("is a plain text node — nothing to type into and nothing to focus", () => {
      load("GB");
      $("#company_id").val("12345678");

      ctx.dom.toggleBusinessFields();

      expect(label().length).toBe(1);
      expect(label().find("input, select, textarea, [contenteditable]").length).toBe(0);
      expect(label().find(".twoinc-company-summary-id").prop("tagName")).toBe("SPAN");
    });

    test("sits immediately below whichever name element is the visible one", () => {
      // Right-alignment is CSS's job; the DOM guarantee this asserts is
      // adjacency, which is also what the gap-cancelling
      // `+ .twoinc-company-summary` rules in twoinc.css key on.
      load("GB");
      $("#company_id").val("12345678");
      ctx.dom.toggleBusinessFields();

      expect(label().prev()[0]).toBe($("#billing_company_display_field")[0]);

      // Manual entry moves the name to the native field, and the label follows
      // it — anchoring against the now-hidden picker would strand it.
      ctx.capture.mode = "manual";
      ctx.dom.toggleBusinessFields();
      ctx.helper.renderCompanySummary();

      expect(label().prev()[0]).toBe($("#billing_company_field")[0]);
    });

    test("follows the name into the payment tile when that is where the control lives", () => {
      // The label anchors on `companyNameSurface()`, so tile placement moves it
      // out of the address area entirely — left behind it would sit under a row
      // that is no longer showing the company it describes (TWO-25503).
      load("GB");
      ctx.twoinc.company_search_location = "payment_tile";
      ctx.capture.write("ACME Widgets Ltd", "12345678");

      ctx.dom.toggleBusinessFields();

      expect(labelShown()).toBe(true);
      expect(labelText()).toBe("12345678");
      expect(label().prev()[0]).toBe($("#twoinc_tile_company_row")[0]);
    });

    test("comes back to the address area when the tile collapses under another method", () => {
      // The tile row goes off screen with its payment box, and the label has to
      // leave with it rather than stay anchored to something invisible.
      load("GB");
      ctx.twoinc.company_search_location = "payment_tile";
      ctx.capture.write("ACME Widgets Ltd", "12345678");
      ctx.dom.toggleBusinessFields();

      $(".payment_box").css("display", "none");
      ctx.dom.toggleBusinessFields();

      expect(label().prev()[0]).toBe($("#billing_company_field")[0]);
    });
  });

  describe("#company_id itself stays a real, posted, hidden input", () => {
    test.each([
      { mode: "search", value: "12345678", description: "search mode, registry number" },
      { mode: "search", value: SYNTHETIC, description: "search mode, minted number" },
      { mode: "manual", value: "", description: "manual entry, no number" },
      { mode: "sole_trader", value: SYNTHETIC, description: "sole trader, minted number" }
    ])("$description", ({ mode, value }) => {
      load("GB");
      ctx.capture.mode = mode;
      $("#company_id").val(value);

      ctx.dom.toggleBusinessFields();

      // Never a visible field again, in any mode.
      expect(isVisible("#company_id_field")).toBe(false);
      // Hidden is not the same as gone: `disabled` or a stripped `name` would
      // drop it from the POST, and the order intent is authorised against it.
      expect($("#company_id").attr("name")).toBe("company_id");
      expect($("#company_id").prop("disabled")).toBe(false);
      expect($("#company_id").val()).toBe(value);
      // And no required cue on a field nobody can fill in — that is how a
      // checkout becomes unsubmittable with no visible reason why.
      expect($("#company_id").attr("required")).toBeFalsy();
      expect($("#company_id_field").find("label .twoinc-required").length).toBe(0);
    });
  });

  describe("the required cue lands on whichever company-name row is on screen", () => {
    /**
     * @param {string} rowSelector
     * @returns {{required: boolean, asterisks: number}}
     */
    function cue(rowSelector) {
      const $row = $(rowSelector);
      return {
        required: Boolean($row.find(":input").attr("required")),
        asterisks: $row.find("label .twoinc-required").length
      };
    }

    const CUED = { required: true, asterisks: 1 };
    const UNCUED = { required: false, asterisks: 0 };

    test.each([
      {
        location: "address_area",
        capture: false,
        twoSelected: true,
        display: CUED,
        native: UNCUED,
        description: "address area: the search row"
      },
      {
        location: "address_area",
        capture: true,
        twoSelected: true,
        display: CUED,
        native: UNCUED,
        description: "address area with a capture: still the search row"
      },
      {
        location: "payment_tile",
        capture: false,
        twoSelected: true,
        display: UNCUED,
        native: CUED,
        description: "tile placement: the native row core still renders"
      },
      {
        location: "payment_tile",
        capture: true,
        twoSelected: true,
        display: UNCUED,
        native: UNCUED,
        description: "tile placement showing the capture: no address row to require"
      },
      {
        location: "address_area",
        capture: true,
        twoSelected: false,
        display: UNCUED,
        native: UNCUED,
        description: "another method selected: nothing of Two's is required"
      }
    ])("$description", ({ location, capture, twoSelected, display, native }) => {
      load("GB");
      ctx.twoinc.company_search_location = location;
      if (capture) ctx.capture.write("ACME Widgets Ltd", "12345678");
      $("input[name=payment_method]").prop("checked", twoSelected);

      ctx.dom.toggleBusinessFields();

      expect(cue("#billing_company_display_field")).toEqual(display);
      expect(cue("#billing_company_field")).toEqual(native);
    });
  });
});
