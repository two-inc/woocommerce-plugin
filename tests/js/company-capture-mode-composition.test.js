/**
 * #486 — the states only a SEQUENCE of capture-mode changes reaches.
 *
 * Every individual transition in this file is covered elsewhere
 * (company-name-source, sole-trader-flow, company-name-and-number-surfaces).
 * What is only reachable by composing them is the pair of defects below, each
 * one an invariant that two separately-correct rounds disagree about:
 *
 *  1. `toggleBusinessFields()` makes the SEARCH control the visible
 *     company-name surface for sole-trader mode — but manual entry RELEASES
 *     the field to the buyer, and the Sole trader chip is not hidden there, so
 *     an adoption can land with no panel bound to it. The adoption has to
 *     re-take the field, or the buyer is left looking at a plain input holding
 *     nothing.
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
    harness.releasePanel(ctx.helper);
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

    test("is rendered through a LIVE panel, not the field manual entry released", () => {
      ctx.helper.enterManualCompanyEntry();

      // Given: manual entry really did release the field — otherwise this test
      // proves nothing about re-binding it. `role` is what the panel stamps on
      // a field it owns, and releasing takes it back off.
      expect($("#billing_company_display").attr("role")).toBeUndefined();

      ctx.soleTrader.setMode("sole_trader");
      ctx.soleTrader.setCompany(
        MATCHED_BUYER.organization_number,
        MATCHED_BUYER.company_name,
        MATCHED_BUYER
      );

      expect($("#billing_company_display").attr("role")).toBe("combobox");
      expect($("#billing_company_display").val()).toBe("A Sole Trader");
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
      expect($("#billing_company_display").attr("role")).toBeUndefined();
    });

    test("puts the adopted name where toggleBusinessFields has just pointed the buyer", () => {
      adoptFromManualEntry();

      // The two halves of the same invariant: the search control is the shown
      // one of the two company-name elements in this mode, and it is a control
      // that actually renders the name.
      expect($("#billing_company_display_field").hasClass("hidden")).toBe(false);
      expect($("#billing_company_field").hasClass("hidden")).toBe(true);
      expect($("#billing_company_display").val()).toBe("A Sole Trader");
    });

    test("reads the adopted name back, so an order intent can fire", () => {
      adoptFromManualEntry();

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

    /**
     * The class of whatever the "select a different sole trader" link currently
     * hangs in — the panel's own field wrapper while it is inside a field.
     *
     * @returns {string|undefined}
     */
    function linkParent() {
      return $("#select_different_sole_trader_btn").parent().attr("class");
    }

    test("leaves the slot free in sole-trader mode — the LINK sits inside the field", () => {
      ctx.soleTrader.setMode("sole_trader");
      ctx.soleTrader.setCompany(MATCHED_BUYER.organization_number, MATCHED_BUYER.company_name);

      expect(linkParent()).toBe("two-company-field-wrap");

      // When: anything re-runs the field toggle — a payment-method switch, a
      // country change, `updated_checkout`.
      ctx.dom.toggleBusinessFields();

      expect(linkParent()).toBe("two-company-field-wrap");
      expect(slotAfterSearchField()).not.toBe("select_different_sole_trader_btn");
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

    test("paints the restored company into the field the buyer reads", () => {
      restore();

      expect($("#billing_company_display").val()).toBe(MATCHED_BUYER.company_name);
    });

    /**
     * The only state where the two mode axes disagree about which chip is
     * selected: `restore()` sets sole-trader mode directly, bypassing the
     * `setMode()` that would otherwise have taken the capture mode with it.
     * An `updated_checkout` re-running `loadUserMetaInputs()` is what reaches
     * it while the buyer is mid-manual-entry.
     */
    test("a restore landing mid-manual-entry leaves manual the selected mode", () => {
      ctx.helper.enterManualCompanyEntry();

      restore();

      expect(ctx.capture.mode).toBe("manual");
      expect(ctx.soleTrader.mode).toBe("sole_trader");
      expect(ctx.helper.selectedMode()).toBe("manual");

      // The chip repaint every availability check and `updated_checkout` runs.
      ctx.helper.syncModeChips();

      expect($(".two-company-mode-chip[data-two-chip='manual']").attr("aria-pressed")).toBe("true");
      expect($(".two-company-mode-chip[data-two-chip='sole_trader']").attr("aria-pressed")).toBe(
        "false"
      );
    });

    test("and the re-attach that follows leaves the buyer's own field released", () => {
      ctx.helper.enterManualCompanyEntry();
      restore();

      // Every `updated_checkout` re-attaches; an adoption does too, before it
      // paints. Manual entry owns the field until the buyer leaves it.
      ctx.helper.attach();

      expect($("#billing_company_display").attr("role")).toBeUndefined();
      expect($("#billing_company_display").attr("aria-expanded")).toBeUndefined();
    });
  });

  describe("a capture restored from the DOM alone, with no user-meta echo", () => {
    // The guest case `restoreCapturedCompany()`'s own docblock names as
    // live-confirmed: WooCommerce's rendered value (or loadStorageInputs') is
    // the only source, so `window.twoinc.billing_company`/`company_id` are both
    // undefined. Round 4 taught this function to CAPTURE such a pair; the
    // search field is now the surface that has to SHOW it, and only the echo
    // path was ever painted into it.
    test.each([
      ["a sole trader", "TWO:ST:GB:0f8c2b1a", "A Sole Trader"],
      ["a registry company", "912345678", "ACME Widgets Ltd"]
    ])("%s is painted into the search field, not left blank", (_label, id, name) => {
      $("#billing_company").val(name);
      $("#company_id").val(id);

      ctx.dom.restoreCapturedCompany();

      // Given the native field is the hidden one of the two, an unpainted
      // search field leaves the buyer no company name on screen at all.
      expect($("#billing_company_field").hasClass("hidden")).toBe(true);
      expect($("#billing_company_display").val()).toBe(name);
      expect(ctx.helper.getCompanyName()).toBe(name);
    });

    test("a second restore pass paints the same company the first captured", () => {
      // `initialize()` runs this twice — once from `loadUserMetaInputs()` and
      // once after `loadStorageInputs()` — and the field is painted from the
      // captured pair each time, so the two passes cannot disagree.
      $("#billing_company").val("ACME Widgets Ltd");
      $("#company_id").val("912345678");

      ctx.dom.restoreCapturedCompany();
      ctx.dom.restoreCapturedCompany();

      expect($("#billing_company_display").val()).toBe("ACME Widgets Ltd");
      expect($("#billing_company").val()).toBe("ACME Widgets Ltd");
    });
  });

  describe("every path that can create a capture leaves the right surface on screen", () => {
    /**
     * Exactly one of the two company-name rows is on screen (TWO-25503), so
     * naming the visible one names the hidden one too.
     *
     * @param {string} id the row expected to be the visible one
     * @returns {void}
     */
    function expectVisibleCompanyRow(id) {
      const rows = ["#billing_company_field", "#billing_company_display_field"];
      expect($(id).hasClass("hidden")).toBe(false);
      expect($(rows[rows[0] === id ? 1 : 0]).hasClass("hidden")).toBe(true);
    }

    test.each([
      [
        "a registry pick",
        () => ctx.helper.onPick({ id: "ACME Widgets Ltd", company_id: "912345678" }),
        "#billing_company_display_field",
        "ACME Widgets Ltd"
      ],
      [
        "a sole-trader adoption",
        () => {
          ctx.soleTrader.setMode("sole_trader");
          ctx.soleTrader.setCompany(
            MATCHED_BUYER.organization_number,
            MATCHED_BUYER.company_name,
            MATCHED_BUYER
          );
        },
        "#billing_company_display_field",
        MATCHED_BUYER.company_name
      ],
      [
        "the user-meta echo",
        () => {
          ctx.twoinc.billing_company = MATCHED_BUYER.company_name;
          ctx.twoinc.company_id = MATCHED_BUYER.organization_number;
          ctx.dom.loadUserMetaInputs();
        },
        "#billing_company_display_field",
        MATCHED_BUYER.company_name
      ],
      [
        "the DOM restore",
        () => {
          $("#billing_company").val("ACME Widgets Ltd");
          $("#company_id").val("912345678");
          ctx.dom.restoreCapturedCompany();
        },
        "#billing_company_display_field",
        "ACME Widgets Ltd"
      ]
    ])("%s leaves the search control showing it", (_label, act, visible, name) => {
      act();

      expectVisibleCompanyRow(visible);
      expect(ctx.helper.getCompanyName()).toBe(name);
      expect($("#billing_company").val()).toBe(name);
    });

    test("manual entry hands the surface back to the native field, cleared", () => {
      ctx.helper.onPick({ id: "ACME Widgets Ltd", company_id: "912345678" });
      expectVisibleCompanyRow("#billing_company_display_field");

      ctx.helper.enterManualCompanyEntry();

      expectVisibleCompanyRow("#billing_company_field");
      expect($("#billing_company").val()).toBe("");
      expect($("#company_id").val()).toBe("");
    });
  });
});
