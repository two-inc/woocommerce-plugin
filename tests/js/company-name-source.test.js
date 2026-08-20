/**
 * #486 — which field `getCompanyName()` reads, and the invariant that decides it.
 *
 * `window.twoinc.enable_company_search` used to carry two unrelated meanings:
 * the merchant's "Enable company search in address entry" checkbox (which only
 * ever RELOCATES the one search control — PHP hardcodes it to 'yes',
 * TWO-25326 §7.1) and, mutated at runtime, "is the search widget the buyer's
 * active surface". `getCompanyName()` branched on the second meaning, so in
 * sole-trader mode it read WooCommerce's native `#billing_company` rather than
 * the picker the adopted company is actually rendered in — the wrong source,
 * agreeing with the right one only for as long as `twoincCompanyCapture.write()`
 * happens to mirror the same name into that field.
 *
 * The name now follows `twoincCompanyCapture.mode`: the picker's rendered
 * container for `search` and `sole_trader` alike, the native field only for
 * `manual`. Pinned in all three modes, because a fix keyed on sole-trader mode
 * alone would break manual entry the other way round.
 *
 * The second describe block is the one that would actually catch a regression of
 * the refactor itself: the merchant's setting must never be written at runtime
 * again, by any mode transition.
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

describe("getCompanyName follows the capture mode (#486)", () => {
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
    // The picker has to be live for its rendered container to exist at all —
    // that container is the node `saveCheckoutInputs()` snapshots and the node
    // `getCompanyName()` reads back.
    $("#billing_company_display").selectWoo(ctx.helper.genSelectWooParams());
    ctx.Twoinc.getInstance();
  });

  afterEach(() => {
    harness.releaseWidgets($);
    sessionStorage.clear();
    document.body.innerHTML = "";
  });

  /**
   * Refresh the snapshot `getCompanyName()` reads. Production does this on a
   * 3-second interval; every test here has to do it explicitly, or it reads a
   * snapshot taken before the capture it is asserting on.
   *
   * @returns {void}
   */
  function snapshot() {
    ctx.dom.saveCheckoutInputs();
  }

  test("search mode reads the picked company out of the picker", () => {
    $("#billing_company_display")
      .append('<option value="ACME Widgets Ltd">ACME Widgets Ltd</option>')
      .val("ACME Widgets Ltd")
      .trigger("change");
    snapshot();

    expect(ctx.capture.mode).toBe("search");
    expect(ctx.helper.getCompanyName()).toBe("ACME Widgets Ltd");
  });

  test("sole-trader mode reads the ADOPTED company out of the picker, not the native field", () => {
    // Driven through the real adoption path rather than by assigning the mode:
    // `setCompany()` → `lockCapturedFields()` is what seeds the picker with the
    // adopted company and selects it (TWO-40 §7 direction (a)), and that seeding
    // is precisely what makes the picker the right thing to read here.
    ctx.soleTrader.availabilityByCountry = { GB: true };
    ctx.soleTrader.setMode("sole_trader");
    ctx.soleTrader.setCompany("TWO:ST:GB:0f8c2b1a", "A Sole Trader");
    snapshot();

    expect(ctx.capture.mode).toBe("sole_trader");
    expect(ctx.helper.getCompanyName()).toBe("A Sole Trader");

    // The picker is genuinely the source, not the native mirror agreeing with
    // it: blank the native field and the answer must not move. Under the old
    // `enable_company_search` branch this returned "" here, and an empty
    // `company_name` is what stops `isReadyApprovalCheck()` ever firing an
    // order intent — the buyer then gets the generic unavailability fallback
    // instead of the message naming their own business.
    $("#billing_company").val("");

    expect(ctx.helper.getCompanyName()).toBe("A Sole Trader");
  });

  test("the adopted name reaches customerCompany, so an intent check can fire at all", () => {
    // `isReadyApprovalCheck()` refuses to fire while any value on
    // `customerCompany` is empty, so this is the record the whole flow hangs on.
    ctx.soleTrader.availabilityByCountry = { GB: true };
    ctx.soleTrader.setMode("sole_trader");
    ctx.soleTrader.setCompany("TWO:ST:GB:0f8c2b1a", "A Sole Trader");
    snapshot();

    const company = ctx.dom.getCompanyData();

    expect(company.company_name).toBe("A Sole Trader");
    expect(company.organization_number).toBe("TWO:ST:GB:0f8c2b1a");
    expect(company.country_prefix).toBe("GB");
  });

  test("manual entry reads the buyer's own typed field, NOT the picker", () => {
    // The counterweight: a company picked before the buyer said "my company
    // isn't in the registry" is still sitting on the picker's <select>, so a fix
    // that simply always read the picker would post the company they had just
    // rejected.
    $("#billing_company_display")
      .append('<option value="ACME Widgets Ltd">ACME Widgets Ltd</option>')
      .val("ACME Widgets Ltd")
      .trigger("change");
    snapshot();

    ctx.helper.enterManualCompanyEntry();
    $("#billing_company").val("Sole Proprietor Bakery");

    expect(ctx.capture.mode).toBe("manual");
    expect(ctx.helper.getCompanyName()).toBe("Sole Proprietor Bakery");
  });

  describe("the merchant's admin setting is never mutated at runtime", () => {
    // The invariant the whole refactor buys, and the one a regression would
    // quietly undo: `enable_company_search` reaching JS is merchant
    // configuration. Every mode transition below used to write to it.
    test.each([
      {
        description: "entering manual entry",
        act: (c) => c.helper.enterManualCompanyEntry(),
        mode: "manual"
      },
      {
        description: "leaving manual entry",
        act: (c) => {
          c.helper.enterManualCompanyEntry();
          c.helper.exitManualCompanyEntry();
        },
        mode: "search"
      },
      {
        description: "entering sole-trader mode",
        act: (c) => c.soleTrader.setMode("sole_trader"),
        mode: "sole_trader"
      },
      {
        description: "a round trip through sole-trader mode",
        act: (c) => {
          c.soleTrader.setMode("sole_trader");
          c.soleTrader.setMode("business");
        },
        mode: "search"
      },
      {
        description: "a round trip through sole-trader mode from manual entry",
        act: (c) => {
          c.helper.enterManualCompanyEntry();
          c.soleTrader.setMode("sole_trader");
          c.soleTrader.setMode("business");
        },
        mode: "manual"
      }
    ])("$description leaves it alone and moves the capture mode instead", ({ act, mode }) => {
      ctx.soleTrader.availabilityByCountry = { GB: true };

      act(ctx);

      expect(ctx.twoinc.enable_company_search).toBe("yes");
      expect(ctx.capture.mode).toBe(mode);
    });
  });

  describe("field visibility follows the capture mode, in all three states", () => {
    test.each([
      { mode: "search", search: false, native: true, description: "search shows the picker" },
      {
        mode: "sole_trader",
        search: false,
        native: true,
        description: "sole trader shows the picker too — the adopted name renders there"
      },
      {
        mode: "manual",
        search: true,
        native: false,
        description: "manual entry shows WooCommerce's own field"
      }
    ])("$description", ({ mode, search, native }) => {
      ctx.capture.mode = mode;

      ctx.dom.toggleBusinessFields();

      expect($("#billing_company_display_field").hasClass("hidden")).toBe(search);
      expect($("#billing_company_field").hasClass("hidden")).toBe(native);
    });
  });
});
