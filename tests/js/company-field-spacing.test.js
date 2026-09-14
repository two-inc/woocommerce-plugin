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
    // Every rule reaching the row, and the `padding` shorthand too.
    const offenders = stylesheetSource()
      .split("}")
      .filter((block) => block.split("{")[0].includes(selector))
      .filter((block) => /padding-bottom|padding:/.test(block));
    expect(offenders).toEqual([]);
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
    const LINKS = "#search_company_btn, #select_different_sole_trader_btn";

    /** @returns {string[]} the rows carrying the CSS mark */
    function markedRows() {
      return ROWS.filter((selector) => $(selector).hasClass("twoinc-affordance-shown"));
    }

    /** @returns {string[]} the rows that actually contain a visible link */
    function hostRows() {
      return ROWS.filter(
        (selector) =>
          $(selector)
            .find(LINKS)
            .filter(function () {
              return $(this).css("display") !== "none";
            }).length > 0
      );
    }

    /** The mark is on exactly the rows hosting a visible link, and nowhere else. */
    function expectMarkFollowsHosts() {
      expect(markedRows()).toEqual(hostRows());
    }

    test("no link shown leaves the rows unmarked", () => {
      ctx.dom.toggleBusinessFields();

      expect(markedRows()).toEqual([]);
      expect(hostRows()).toEqual([]);
    });

    test("the search-for-a-company link marks the row it hangs in", () => {
      helper.enterManualCompanyEntry();

      expect(hostRows()).toEqual(["#billing_company_field"]);
      expectMarkFollowsHosts();
    });

    test("leaving manual entry unmarks it again", () => {
      helper.enterManualCompanyEntry();
      expect(markedRows()).not.toEqual([]);

      helper.exitManualCompanyEntry();

      expect(markedRows()).toEqual([]);
    });

    test("the select-a-different-sole-trader link marks the row it hangs in", () => {
      const soleTrader = helper.soleTrader;
      soleTrader.mode = "sole_trader";
      soleTrader.soleTraderAdopted = true;
      soleTrader.tokens = { delegation_token: "d", autofill_token: "a" };

      soleTrader.syncDifferentSoleTraderLink();

      expect($("#select_different_sole_trader_btn").css("display")).not.toBe("none");
      expect(hostRows()).toEqual(["#billing_company_display_field"]);
      expectMarkFollowsHosts();
    });

    // A link mounted outside both address rows — tile placement hangs the
    // sole-trader link in the tile row — must mark neither of them.
    test("a link outside the address rows marks neither", () => {
      const soleTrader = helper.soleTrader;
      soleTrader.mode = "sole_trader";
      soleTrader.soleTraderAdopted = true;
      soleTrader.tokens = { delegation_token: "d", autofill_token: "a" };
      soleTrader.syncDifferentSoleTraderLink();
      $("form[name='checkout']").append('<p id="elsewhere"></p>');
      $("#elsewhere").append($("#select_different_sole_trader_btn"));

      ctx.dom.syncCompanyAffordanceSpacing();

      expect($("#select_different_sole_trader_btn").css("display")).not.toBe("none");
      expect(markedRows()).toEqual([]);
    });

    // A teardown mid-flight skips the mode revert that would otherwise re-sync,
    // so this is the one path that needs the mark cleared where it hides the link.
    test("a sole-trader teardown mid-flight unmarks the row", () => {
      const soleTrader = helper.soleTrader;
      soleTrader.mode = "sole_trader";
      soleTrader.soleTraderAdopted = true;
      soleTrader.tokens = { delegation_token: "d", autofill_token: "a" };
      soleTrader.syncDifferentSoleTraderLink();
      expect(markedRows()).not.toEqual([]);
      soleTrader.flightDepth = 1;

      soleTrader.hide();

      expect(soleTrader.mode).toBe("sole_trader");
      expect($("#select_different_sole_trader_btn").css("display")).toBe("none");
      expect(markedRows()).toEqual([]);
    });

    // Given manual entry, then a sole trader adopted (which hides the link and
    // clears the mark); when Registered company reverts the mode, the link is
    // re-shown after the revert's own syncs have already run.
    test("reverting to registered company re-marks the row", () => {
      const soleTrader = helper.soleTrader;
      helper.enterManualCompanyEntry();
      soleTrader.mode = "sole_trader";
      soleTrader.setCompany("TWO:ST:GB:1", "A Sole Trader");
      expect(markedRows()).toEqual([]);

      soleTrader.setMode("business");

      expect($("#search_company_btn").css("display")).not.toBe("none");
      expectMarkFollowsHosts();
      expect(markedRows()).not.toEqual([]);
    });

    test("locking an adopted capture unmarks the row it hides the link in", () => {
      const soleTrader = helper.soleTrader;
      helper.enterManualCompanyEntry();
      expect(markedRows()).not.toEqual([]);

      soleTrader.lockCapturedFields("TWO:ST:GB:1", "A Sole Trader");

      expect($("#search_company_btn").css("display")).toBe("none");
      expect(markedRows()).toEqual([]);
    });

    test("the stylesheet drops the bottom margin for a marked row", () => {
      helper.enterManualCompanyEntry();

      expect(window.getComputedStyle($("#billing_company_field")[0]).marginBottom).toBe("0px");
    });
  });
});
