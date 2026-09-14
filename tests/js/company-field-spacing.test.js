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
    expect(stylesheetSource()).not.toMatch(/margin-top:\s*-/);
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

    test("the stylesheet drops the bottom margin for a marked row", () => {
      ctx.dom.toggleBusinessFields();
      const before = ROWS.map(
        (selector) => window.getComputedStyle($(selector)[0]).marginBottom
      );

      helper.enterManualCompanyEntry();

      expect(
        ROWS.map((selector) => window.getComputedStyle($(selector)[0]).marginBottom)
      ).toEqual(["0px", "0px"]);
      expect(before).not.toEqual(["0px", "0px"]);
    });
  });
});
