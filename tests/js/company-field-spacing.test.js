/**
 * ABN-554. The vertical spacing around the billing company-name rows.
 *
 * Three rules, and they are one design: the rows carry no bottom padding of
 * the plugin's own, the number label below them carries no negative top margin
 * to cancel one, and the row's bottom margin is dropped while an affordance
 * link ("Search for a company", "Select a different sole trader") is the thing
 * sitting under the input.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const harness = require("./wc-harness");

function stylesheetSource() {
  return fs.readFileSync(path.join(harness.REPO_ROOT, harness.STYLESHEET_PATH), "utf8");
}

/**
 * @param {string} selector a rule's selector, verbatim
 * @returns {string|null} the rule body, or null when no such rule exists
 */
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp("^" + escaped + "\\s*\\{([^}]*)\\}", "m").exec(stylesheetSource());
  return m === null ? null : m[1];
}

const ROWS = ["#billing_company_display_field", "#billing_company_field"];

describe("billing company-row spacing", () => {
  let ctx;
  let $;
  let helper;

  beforeEach(() => {
    ctx = harness.loadTwoinc({
      enable_company_search: "yes",
      enable_address_lookup: "no",
      text: { enter_manually: "Enter manually", search_company: "Search for company" }
    });
    $ = ctx.$;
    helper = ctx.helper;
    harness.buildCheckoutForm();
    $("#billing_company_display_field").removeClass("hidden");
    harness.injectStylesheet();
  });

  afterEach(() => {
    harness.releasePanel(helper);
    document.body.innerHTML = "";
  });

  test("no rule anywhere gives .billing_company_search bottom padding", () => {
    // Requirement 3.1's third name. It is the CLASS on the search row on the
    // checkout page and on the input itself on the pay-for-order view, so a
    // rule reaching it from either shape has to be absent.
    const offenders = stylesheetSource()
      .split("}")
      .filter((block) => /\.billing_company_search\b/.test(block.split("{")[0] || ""))
      .filter((block) => /padding-bottom|padding:/.test(block));
    expect(offenders).toEqual([]);
  });

  test.each([
    { selector: "#billing_company_display_field", description: "the search row" },
    { selector: "#billing_company_field", description: "the native company row" }
  ])("$description declares no bottom padding", ({ selector }) => {
    // A renamed or deleted rule reads as null here and fails the match, so
    // this also pins the rule still existing.
    expect(ruleBody(selector)).toMatch(/position:\s*relative/);
    expect(ruleBody(selector)).not.toMatch(/padding-bottom/);
  });

  test("the number label pulls nothing up over the row above it", () => {
    // A negative top margin here is what the deleted row padding needed
    // cancelling; with the padding gone it would pull the number into the input.
    const summaryRules = stylesheetSource()
      .split("}")
      .filter((block) => /\.twoinc-company-summary\b/.test(block.split("{")[0] || ""));
    expect(summaryRules.length).toBeGreaterThan(0);
    summaryRules.forEach((block) => expect(block).not.toMatch(/margin-top:\s*-/));
  });

  describe("the row's bottom margin gives way to the affordance link", () => {
    /** @returns {boolean} whether both rows are marked for the CSS rule */
    function marked() {
      return ROWS.every((selector) => $(selector).hasClass("twoinc-affordance-shown"));
    }

    test("no link shown leaves the rows unmarked", () => {
      ctx.dom.toggleBusinessFields();

      expect(marked()).toBe(false);
    });

    test("the search-for-a-company link marks both rows", () => {
      helper.enterManualCompanyEntry();

      expect(marked()).toBe(true);
    });

    test("leaving manual entry unmarks them again", () => {
      helper.enterManualCompanyEntry();
      expect(marked()).toBe(true);

      helper.exitManualCompanyEntry();

      expect(marked()).toBe(false);
    });

    test("the select-a-different-sole-trader link marks both rows", () => {
      const soleTrader = helper.soleTrader;
      soleTrader.mode = "sole_trader";
      soleTrader.soleTraderAdopted = true;
      soleTrader.tokens = { delegation_token: "d", autofill_token: "a" };

      soleTrader.syncDifferentSoleTraderLink();

      expect($("#select_different_sole_trader_btn").css("display")).not.toBe("none");
      expect(marked()).toBe(true);
    });

    // A teardown mid-flight skips the mode revert that would otherwise re-sync,
    // so this is the one path that needs the mark cleared where it hides the link.
    test("a sole-trader teardown mid-flight unmarks the rows", () => {
      const soleTrader = helper.soleTrader;
      soleTrader.mode = "sole_trader";
      soleTrader.soleTraderAdopted = true;
      soleTrader.tokens = { delegation_token: "d", autofill_token: "a" };
      soleTrader.syncDifferentSoleTraderLink();
      expect(marked()).toBe(true);
      soleTrader.flightDepth = 1;

      soleTrader.hide();

      expect(soleTrader.mode).toBe("sole_trader");
      expect($("#select_different_sole_trader_btn").css("display")).toBe("none");
      expect(marked()).toBe(false);
    });

    // Given manual entry, then a sole trader adopted (which hides the link and
    // clears the mark); when Registered company reverts the mode, the link is
    // re-shown after the revert's own syncs have already run.
    test("reverting to registered company re-marks the rows", () => {
      const soleTrader = helper.soleTrader;
      helper.enterManualCompanyEntry();
      soleTrader.mode = "sole_trader";
      soleTrader.setCompany("TWO:ST:GB:1", "A Sole Trader");
      expect(marked()).toBe(false);

      soleTrader.setMode("business");

      expect($("#search_company_btn").css("display")).not.toBe("none");
      expect(marked()).toBe(true);
    });

    test("locking an adopted capture unmarks the rows it hides the link on", () => {
      const soleTrader = helper.soleTrader;
      helper.enterManualCompanyEntry();
      expect(marked()).toBe(true);

      soleTrader.lockCapturedFields("TWO:ST:GB:1", "A Sole Trader");

      expect($("#search_company_btn").css("display")).toBe("none");
      expect(marked()).toBe(false);
    });

    test("the stylesheet drops the bottom margin for a marked row", () => {
      helper.enterManualCompanyEntry();

      expect(ROWS.map((selector) => window.getComputedStyle($(selector)[0]).marginBottom)).toEqual([
        "0px",
        "0px"
      ]);
    });
  });
});
