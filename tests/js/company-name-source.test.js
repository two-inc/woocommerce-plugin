/**
 * #486 — which field `getCompanyName()` reads.
 *
 * `#billing_company` is the single source, in every capture mode: it is what
 * WooCommerce posts, and every path that can create a capture writes it
 * through `twoincCompanyCapture.write()`. A mode-dependent source is what this
 * pins against — the name read back would then agree with the order only for
 * as long as two writers happened to mirror each other, and an empty
 * `company_name` is what stops `isReadyApprovalCheck()` ever firing an order
 * intent.
 *
 * The displayed name is a separate surface, painted by `setDisplayName()`. The
 * tests below blank it deliberately to prove the read does not depend on it.
 *
 * The second describe block pins the invariant the refactor buys: the
 * merchant's admin setting must never be written at runtime, by any mode
 * transition.
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

describe("getCompanyName reads the posted field (#486)", () => {
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
    ctx.helper.attach();
    ctx.soleTrader.availabilityByCountry = { GB: true };
    ctx.Twoinc.getInstance();
  });

  afterEach(() => {
    harness.releasePanel(ctx.helper);
    sessionStorage.clear();
    document.body.innerHTML = "";
  });

  /** The name the buyer can see, as opposed to the one the checkout posts. */
  function displayed() {
    return $(ctx.helper.companyFieldSelector()).val();
  }

  test.each([
    {
      description: "a registry pick",
      act: () => ctx.helper.onPick({ id: "ACME Widgets Ltd", company_id: "12345678" }),
      mode: "search",
      name: "ACME Widgets Ltd"
    },
    {
      description: "a sole-trader adoption",
      act: () => {
        ctx.soleTrader.setMode("sole_trader");
        ctx.soleTrader.setCompany("TWO:ST:GB:0f8c2b1a", "A Sole Trader");
      },
      mode: "sole_trader",
      name: "A Sole Trader"
    },
    {
      description: "manual entry",
      act: () => {
        ctx.helper.enterManualCompanyEntry();
        $("#billing_company").val("Sole Proprietor Bakery");
      },
      mode: "manual",
      name: "Sole Proprietor Bakery"
    },
    {
      description: "the user-meta echo",
      act: () => {
        ctx.twoinc.billing_company = "Returning Buyer Ltd";
        ctx.twoinc.company_id = "912345678";
        ctx.dom.loadUserMetaInputs();
      },
      mode: "search",
      name: "Returning Buyer Ltd"
    },
    {
      description: "a capture restored from the DOM alone",
      act: () => {
        $("#billing_company").val("Guest Restored Ltd");
        $("#company_id").val("912345678");
        ctx.dom.restoreCapturedCompany();
      },
      mode: "search",
      name: "Guest Restored Ltd"
    }
  ])("$description is read back off #billing_company", ({ act, mode, name }) => {
    act();

    expect(ctx.capture.mode).toBe(mode);
    expect($("#billing_company").val()).toBe(name);
    expect(ctx.helper.getCompanyName()).toBe(name);
  });

  test("the displayed name is not the source — blanking it does not move the answer", () => {
    ctx.soleTrader.setMode("sole_trader");
    ctx.soleTrader.setCompany("TWO:ST:GB:0f8c2b1a", "A Sole Trader");

    expect(displayed()).toBe("A Sole Trader");
    ctx.helper.setDisplayName("");

    expect(ctx.helper.getCompanyName()).toBe("A Sole Trader");
  });

  test("the adopted name reaches customerCompany, so an intent check can fire at all", () => {
    // `isReadyApprovalCheck()` refuses to fire while any value on
    // `customerCompany` is empty, so this is the record the whole flow hangs on.
    ctx.soleTrader.setMode("sole_trader");
    ctx.soleTrader.setCompany("TWO:ST:GB:0f8c2b1a", "A Sole Trader");

    const company = ctx.dom.getCompanyData();

    expect(company.company_name).toBe("A Sole Trader");
    expect(company.organization_number).toBe("TWO:ST:GB:0f8c2b1a");
    expect(company.country_prefix).toBe("GB");
  });

  test("manual entry keeps the buyer's typed name, not the company they rejected", () => {
    ctx.helper.onPick({ id: "ACME Widgets Ltd", company_id: "12345678" });

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
