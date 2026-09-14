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

/**
 * The style rules of one sheet, `@media`/`@supports` descendants included — a
 * string scan reads an at-rule prelude as the selector and misses what it
 * wraps. `@import` is not followed; nothing in this plugin uses one.
 *
 * @param {CSSStyleSheet} sheet
 * @returns {CSSStyleRule[]}
 */
function styleRulesOf(sheet) {
  const out = [];
  const walk = (rules) => {
    Array.prototype.forEach.call(rules || [], (rule) => {
      if (rule.cssRules) {
        walk(rule.cssRules);
      } else if (rule.selectorText) {
        out.push(rule);
      }
    });
  };
  walk(sheet.cssRules);
  return out;
}

/** The plugin's own sheet, as injected by the active test. */
let sheet;

/**
 * Does one of this rule's selectors name `needle` — as the subject or as an
 * ancestor, since bottom padding on a wrapper inside the row adds the same
 * gap — and not merely prefix a longer id?
 *
 * @param {string} selectorText
 * @param {string} needle
 * @returns {boolean}
 */
function targets(selectorText, needle) {
  // Attribute values and `:not()` arguments are stripped first: a value can
  // hold the separators this splits on, and a negated needle is not reached.
  const cleaned = selectorText.replace(/\[[^\]]*\]/g, "").replace(/:not\([^)]*\)/g, "");
  return cleaned.split(",").some((part) =>
    part
      .trim()
      .split(/[\s>+~]+/)
      .some((compound) => {
        const at = compound.indexOf(needle);
        if (at < 0) return false;
        // Not a longer id the needle merely prefixes.
        return !/[A-Za-z0-9_-]/.test(compound.charAt(at + needle.length));
      })
  );
}

/**
 * @param {string} needle a whole simple selector — an id or a class
 * @param {RegExp} property what may not be declared
 * @returns {string[]} the selectors of the offending rules
 */
function rulesDeclaring(needle, property) {
  return styleRulesOf(sheet)
    .filter((rule) => targets(rule.selectorText, needle))
    .filter((rule) => property.test(rule.style.cssText))
    .map((rule) => rule.selectorText);
}

/** Bottom padding, longhand or via the shorthand. Horizontal padding is fine. */
const BOTTOM_PADDING = /padding-bottom|padding\s*:/;

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
    sheet = harness.injectStylesheet().sheet;
  });

  afterEach(() => {
    harness.releasePanel(helper);
    document.body.innerHTML = "";
  });

  // The scan's own contract, against a sheet written for the purpose — the
  // plugin's sheet carries no at-rule, so nothing else here would notice the
  // walk stopping at one, or the needle matching a longer id.
  describe("what the stylesheet scan can see", () => {
    let injected;

    afterEach(() => {
      // Left in <head>, these rules would reach the computed-style cases below.
      if (injected) injected.remove();
      injected = null;
    });

    /** @param {string} css @returns {CSSStyleSheet} */
    function inject(css) {
      injected = document.createElement("style");
      injected.textContent = css;
      document.head.appendChild(injected);
      return injected.sheet;
    }

    test.each([
      {
        css: "@media (max-width: 600px) { #billing_company_field { padding-bottom: 15px } }",
        offenders: ["#billing_company_field"],
        description: "a rule wrapped in an at-rule"
      },
      {
        css: "#billing_company_field { padding: 0 0 15px }",
        offenders: ["#billing_company_field"],
        description: "bottom padding via the shorthand"
      },
      {
        css: "#billing_company_field { padding-left: 3px; padding-right: 3px }",
        offenders: [],
        description: "horizontal padding, which is deliberate elsewhere"
      },
      {
        // `#billing_company_field .woocommerce-input-wrapper` is a live rule;
        // bottom padding there is the gap this file forbids.
        css: "#billing_company_field .child { padding-bottom: 15px }",
        offenders: ["#billing_company_field .child"],
        description: "bottom padding on a wrapper inside the row"
      },
      {
        css: '#billing_company_field[data-x="a b"] { padding-bottom: 15px }',
        offenders: ['#billing_company_field[data-x="a b"]'],
        description: "an attribute value holding a space"
      },
      {
        css: ".other:not(#billing_company_field) { padding-bottom: 15px }",
        offenders: [],
        description: "a selector that negates the row"
      },
      {
        css: "#billing_company_field_extra { padding-bottom: 15px }",
        offenders: [],
        description: "a longer id the row's name is a prefix of"
      },
      {
        css: "#other, #billing_company_field { padding-bottom: 15px }",
        offenders: ["#other, #billing_company_field"],
        description: "the row as one of a grouped selector's subjects"
      }
    ])("$description", ({ css, offenders }) => {
      sheet = inject(css);

      expect(rulesDeclaring("#billing_company_field", BOTTOM_PADDING)).toEqual(offenders);
    });
  });

  test("no rule anywhere gives .billing_company_search bottom padding", () => {
    // Requirement 3.1's third name: the CLASS on the search row, so a rule
    // reaching it has to be absent.
    expect(rulesDeclaring(".billing_company_search", BOTTOM_PADDING)).toEqual([]);
  });

  test.each([
    { selector: "#billing_company_display_field", description: "the search row" },
    { selector: "#billing_company_field", description: "the native company row" }
  ])("$description declares no bottom padding", ({ selector }) => {
    // A renamed or deleted rule reads as null here and fails the match, so
    // this also pins the rule still existing.
    expect(ruleBody(selector)).toMatch(/position:\s*relative/);
    expect(rulesDeclaring(selector, BOTTOM_PADDING)).toEqual([]);
  });

  test("the number label pulls nothing up over the row above it", () => {
    // A negative top margin here is what the deleted row padding needed
    // cancelling; with the padding gone it would pull the number into the input.
    const named = styleRulesOf(sheet).filter((rule) =>
      targets(rule.selectorText, ".twoinc-company-summary")
    );
    expect(named.length).toBeGreaterThan(0);
    // Read off cssText: the typed `style.marginTop` is undefined in this jsdom.
    expect(
      named.filter((rule) => /margin-top:\s*-/.test(rule.style.cssText)).map((r) => r.selectorText)
    ).toEqual([]);
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
