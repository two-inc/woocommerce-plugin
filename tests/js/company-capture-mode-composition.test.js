/**
 * #486 — the states only a SEQUENCE of capture-mode changes reaches.
 *
 * Every individual transition in this file is covered elsewhere
 * (company-name-source, sole-trader-flow, company-name-and-number-surfaces).
 * What is only reachable by composing them is the pair of defects below, each
 * one an invariant that two separately-correct rounds disagree about:
 *
 *  1. `toggleBusinessFields()` makes the SEARCH control the visible
 *     company-name surface for sole-trader mode, and `getCompanyName()` reads
 *     that control's rendered container — but manual entry DESTROYS the
 *     control, and the Sole trader chip is not hidden there, so an adoption
 *     can land with no picker attached. Adoption from manual entry therefore
 *     showed the buyer a bare unstyled `<select>` and read the captured name
 *     back empty, which stops an order intent firing at all.
 *
 *  2. The read-only number label and the "select a different sole trader" link
 *     both anchor themselves directly after the visible company-name field,
 *     both only move when they are not already there, and only one of them is
 *     re-anchored on every `toggleBusinessFields()`. So they traded that one
 *     slot back and forth, and whichever lost it lost its `+`-selector gap
 *     cancellation in twoinc.css with it.
 */

"use strict";

const harness = require("./wc-harness");

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

const MATCHED_BUYER = {
  email: "buyer@example.test",
  organization_number: "TWO:ST:GB:0f8c2b1a",
  company_name: "A Sole Trader"
};

describe("capture modes composed, not taken one at a time (#486)", () => {
  let ctx;
  let $;

  beforeEach(() => {
    ctx = harness.loadTwoinc({
      supported_buyer_countries: ["GB"],
      enable_order_intent: "no",
      enable_address_lookup: "no",
      sole_trader: SOLE_TRADER_CONFIG
    });
    $ = ctx.$;
    harness.buildCheckoutForm({ country: "GB" });
    ctx.Twoinc.getInstance().enableCompanySearch();
    ctx.soleTrader.availabilityByCountry = { GB: true };
    ctx.soleTrader.tokens = {
      signup_url: "https://signup.example.test/",
      delegation_token: "d",
      autofill_token: "a"
    };
  });

  afterEach(() => {
    ctx.soleTrader.stopAllPopupWatchers();
    harness.releaseWidgets($);
    sessionStorage.clear();
    document.body.innerHTML = "";
  });

  describe("a sole trader adopted while the buyer sits in manual entry", () => {
    /**
     * The realistic sequence: the buyer says "my company isn't in the
     * registry", starts typing, then clicks the Sole trader chip — which is
     * not hidden during manual entry — and completes the hosted signup, whose
     * ACCEPTED handler writes through `setCompany()`.
     *
     * @returns {void}
     */
    function adoptFromManualEntry() {
      ctx.helper.enterManualCompanyEntry();
      $("#billing_company").val("Whatever They Typed");
      ctx.soleTrader.setMode("sole_trader");
      ctx.soleTrader.setCompany(
        MATCHED_BUYER.organization_number,
        MATCHED_BUYER.company_name,
        MATCHED_BUYER
      );
    }

    test("is rendered through a LIVE picker, not the bare <select> manual entry left behind", () => {
      ctx.helper.enterManualCompanyEntry();

      // Given: manual entry really did tear the picker down — otherwise this
      // test proves nothing about re-attaching it.
      expect($("#billing_company_display").data("select2")).toBeFalsy();

      ctx.soleTrader.setMode("sole_trader");
      ctx.soleTrader.setCompany(
        MATCHED_BUYER.organization_number,
        MATCHED_BUYER.company_name,
        MATCHED_BUYER
      );

      expect($("#billing_company_display").data("select2")).toBeTruthy();
      expect($("#select2-billing_company_display-container").text()).toBe("A Sole Trader");
    });

    /**
     * The INVERSION of what #486 pinned here. That test asserted the buyer's
     * hand-typed company name being overwritten, and the picker re-attached
     * over it, by a background email-driven autofill match — the behaviour
     * Doug's 2026-08-21 architectural ruling removes: a company may only ever
     * be filled in by the buyer's own interaction with the company field, so
     * nothing an email change starts may touch what they typed.
     */
    test("is NEVER adopted by an email change alone — a hand-typed name survives it", () => {
      // Through the REAL checkout wiring — `initialize()` is where an
      // email-driven handler would be bound.
      $("form[name='checkout']").after('<div id="order_review"></div>');
      ctx.Twoinc.getInstance().initialize(false);
      ctx.helper.enterManualCompanyEntry();
      $("#billing_company").val("Whatever They Typed");

      $("#billing_email").val(MATCHED_BUYER.email).trigger("change");

      expect($("#billing_company").val()).toBe("Whatever They Typed");
      expect($("#company_id").val()).toBe("");
      expect(ctx.soleTrader.mode).toBe("business");
      expect(ctx.capture.mode).toBe("manual");
      expect($("#billing_company_display").data("select2")).toBeFalsy();
    });

    test("puts the adopted name where toggleBusinessFields has just pointed the buyer", () => {
      adoptFromManualEntry();

      // The two halves of the same invariant: the search control is the shown
      // one of the two company-name elements in this mode, and it is a control
      // that actually renders the name.
      expect($("#billing_company_display_field").hasClass("hidden")).toBe(false);
      expect($("#billing_company_field").hasClass("hidden")).toBe(true);
      expect($("#select2-billing_company_display-container").length).toBe(1);
    });

    test("reads the adopted name back, so an order intent can fire", () => {
      adoptFromManualEntry();
      ctx.dom.saveCheckoutInputs();

      expect(ctx.capture.mode).toBe("sole_trader");
      expect(ctx.helper.getCompanyName()).toBe("A Sole Trader");
      // `isReadyApprovalCheck()` refuses to fire while any value on this record
      // is empty — an empty `company_name` here is the whole defect.
      expect(ctx.dom.getCompanyData()).toMatchObject({
        company_name: "A Sole Trader",
        organization_number: MATCHED_BUYER.organization_number
      });
    });

    test("abandoning it afterwards still lands the buyer back in manual entry", () => {
      // The counterweight to re-attaching a picker mid-manual-entry: the
      // snapshot/restore around the sole-trader detour must still win.
      adoptFromManualEntry();

      ctx.soleTrader.setMode("business");

      expect(ctx.capture.mode).toBe("manual");
      expect($("#billing_company_field").hasClass("hidden")).toBe(false);
      expect($("#billing_company_display_field").hasClass("hidden")).toBe(true);
    });
  });

  describe("the slot directly after the visible company-name field", () => {
    /**
     * The id of whatever element currently sits immediately after the search
     * field — the slot twoinc.css's two `+` gap cancellations are keyed on.
     *
     * @returns {string|undefined}
     */
    function slotAfterSearchField() {
      return $("#billing_company_display_field").next().attr("id");
    }

    test("goes to the LINK in sole-trader mode, and survives a re-toggle", () => {
      ctx.soleTrader.setMode("sole_trader");
      ctx.soleTrader.setCompany(MATCHED_BUYER.organization_number, MATCHED_BUYER.company_name);

      expect(slotAfterSearchField()).toBe("select_different_sole_trader_btn");

      // When: anything re-runs the field toggle — a payment-method switch, a
      // country change, `updated_checkout`. The number label used to take the
      // slot back here, leaving the link with the ~33px gap above it that
      // twoinc.css cancels only for a direct sibling.
      ctx.dom.toggleBusinessFields();

      expect(slotAfterSearchField()).toBe("select_different_sole_trader_btn");
    });

    test("goes to the number LABEL in registered-search mode, link or no link", () => {
      // Given: the link exists, because the buyer passed through sole-trader
      // mode before picking a registered company.
      ctx.soleTrader.setMode("sole_trader");
      ctx.soleTrader.setCompany(MATCHED_BUYER.organization_number, MATCHED_BUYER.company_name);
      ctx.soleTrader.setMode("business");
      expect($("#select_different_sole_trader_btn").length).toBe(1);

      ctx.capture.write("ACME Widgets Ltd", "912345678");
      ctx.helper.renderCompanySummary("ACME Widgets Ltd", "912345678");
      ctx.dom.toggleBusinessFields();

      expect($("#twoinc_company_summary").hasClass("hidden")).toBe(false);
      expect(slotAfterSearchField()).toBe("twoinc_company_summary");
    });

    test("hands the link back to the native field's own slot when THAT is the visible one", () => {
      ctx.soleTrader.setMode("sole_trader");
      ctx.soleTrader.setCompany(MATCHED_BUYER.organization_number, MATCHED_BUYER.company_name);

      // When: manual entry — the one mode that makes the native field the
      // visible company-name surface while the link may still be on screen.
      ctx.capture.mode = "manual";
      ctx.dom.toggleBusinessFields();

      expect($("#select_different_sole_trader_btn").closest("#billing_company_field").length).toBe(
        1
      );
    });
  });

  describe("a sole trader restored onto a fresh page load", () => {
    /**
     * What `loadUserMetaInputs()` sees for a returning buyer whose last order
     * used a sole trader: a `TWO:…` id already in the DOM.
     *
     * @returns {void}
     */
    function restore() {
      ctx.twoinc.billing_company = MATCHED_BUYER.company_name;
      ctx.twoinc.company_id = MATCHED_BUYER.organization_number;
      ctx.dom.loadUserMetaInputs();
    }

    test("shows its link beside the picker, never inside the hidden native field", () => {
      restore();

      expect(ctx.soleTrader.mode).toBe("sole_trader");
      expect($("#select_different_sole_trader_btn").css("display")).not.toBe("none");
      // The defect this pins: the link was appended into
      // `#billing_company_field`'s affordance slot, and that field is the
      // hidden one of the two in this mode — a button inside a `display: none`
      // row never renders, however its own `.toggle(show)` reads.
      expect($("#select_different_sole_trader_btn").closest("#billing_company_field").length).toBe(
        0
      );
    });

    test("opens its dropdown with the free-text query row suppressed, on the FIRST open", () => {
      restore();
      harness.openCompanyWidget($, ctx.helper);

      const $row = ctx.helper.getCompanySearchFieldContainer();

      expect($row.attr("hidden")).toBe("hidden");
      expect($row.find(".select2-search__field").prop("readonly")).toBe(true);
    });

    test("gives the query row back on the way out through the Registered company chip", () => {
      restore();
      harness.openCompanyWidget($, ctx.helper);

      ctx.soleTrader.setMode("business");
      harness.openCompanyWidget($, ctx.helper);
      const $row = ctx.helper.getCompanySearchFieldContainer();

      expect($row.attr("hidden")).toBeUndefined();
      expect($row.find(".select2-search__field").prop("readonly")).toBe(false);
    });
  });

  describe("a capture restored from the DOM alone, with no user-meta echo", () => {
    // The guest case `restoreCapturedCompany()`'s own docblock names as
    // live-confirmed: WooCommerce's rendered value (or loadStorageInputs') is
    // the only source, so `window.twoinc.billing_company`/`company_id` are both
    // undefined. Round 4 taught this function to CAPTURE such a pair; the
    // picker is now the surface that has to SHOW it, and only the echo path was
    // ever seeded into it.
    test.each([
      ["a sole trader", "TWO:ST:GB:0f8c2b1a", "A Sole Trader"],
      ["a registry company", "912345678", "ACME Widgets Ltd"]
    ])("%s is rendered in the picker, not left as its placeholder", (_label, id, name) => {
      $("#billing_company").val(name);
      $("#company_id").val(id);

      ctx.dom.restoreCapturedCompany();
      ctx.dom.saveCheckoutInputs();

      // Given the native field is the hidden one of the two, an unrendered
      // picker leaves the buyer no company name on screen at all.
      expect($("#billing_company_field").hasClass("hidden")).toBe(true);
      expect($("#select2-billing_company_display-container").text()).toBe(name);
      expect(ctx.helper.getCompanyName()).toBe(name);
    });

    test("never overrides a selection an earlier restore pass already made", () => {
      // `initialize()` runs this twice — once from `loadUserMetaInputs()` and
      // once after `loadStorageInputs()` — and both of those seed the picker
      // themselves.
      $("#billing_company_display")
        .append('<option value="Seeded By The Echo">Seeded By The Echo</option>')
        .val("Seeded By The Echo")
        .trigger("change");
      $("#billing_company").val("ACME Widgets Ltd");
      $("#company_id").val("912345678");

      ctx.dom.restoreCapturedCompany();

      expect($("#billing_company_display").val()).toBe("Seeded By The Echo");
    });
  });
});
