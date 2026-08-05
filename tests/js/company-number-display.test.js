/**
 * TWO-25326 §12. Internally minted organisation numbers are never displayed.
 *
 * Sole-trader enrollment mints an identifier of the form `TWO:…` for a buyer
 * with no registry number of their own. It is a protocol value the backend
 * derives the company type from — not a number the buyer's own authorities
 * would recognise — so it must not reach any surface a human reads, while
 * still being posted and sent to the API, because Two's payment method cannot
 * authorise an order without it.
 *
 * The interesting assertions are therefore paired: suppressed on the display
 * AND still present on the submitted field. A test that only checked the
 * former would pass just as happily against a fix that dropped the value.
 *
 * The second half of the file is about the brackets. Two of the display sites
 * wrote `" (" + number + ")"` as literal text around a value that can now come
 * back empty, so "no number" has to mean no parens rather than an empty pair —
 * `Example Ltd`, never `Example Ltd ()`.
 */

"use strict";

const harness = require("./wc-harness");

const GATEWAY_ID = "woocommerce-gateway-tillit";

/** A minted sole-trader identifier, in the shape the autofill endpoint returns. */
const SYNTHETIC = "TWO:ST:GB:0f8c2b1a";

describe("TWO:-prefixed organisation numbers", () => {
  let ctx;
  let $;
  let util;

  beforeEach(() => {
    ctx = harness.loadTwoinc({
      gateway_id: GATEWAY_ID,
      supported_buyer_countries: ["GB"],
      enable_company_search: "yes",
      enable_address_lookup: "no",
      text: {}
    });
    $ = ctx.$;
    util = ctx.util;
  });

  afterEach(() => {
    harness.releaseWidgets($);
    document.body.innerHTML = "";
  });

  describe("isSyntheticCompanyNumber", () => {
    test("recognises the minted prefix", () => {
      expect(util.isSyntheticCompanyNumber(SYNTHETIC)).toBe(true);
      expect(util.isSyntheticCompanyNumber("TWO:")).toBe(true);
    });

    test("leading whitespace does not smuggle one past", () => {
      // blankToEmpty trims first, so a value that arrives padded is still
      // recognised. Worth pinning: the check is a prefix match, and an
      // untrimmed one would be defeated by a single leading space.
      expect(util.isSyntheticCompanyNumber("  " + SYNTHETIC)).toBe(true);
    });

    test("a real registry number is not synthetic", () => {
      expect(util.isSyntheticCompanyNumber("11111111")).toBe(false);
      expect(util.isSyntheticCompanyNumber("NO 918 234 567")).toBe(false);
    });

    test("matches the prefix only at the start, and only in that case", () => {
      // Deliberately literal and case-sensitive: this is a value the plugin's
      // own backend mints, never something a buyer or registry types, so there
      // is no variant to be liberal about — and being liberal here would start
      // hiding real numbers that happen to contain the letters.
      expect(util.isSyntheticCompanyNumber("12345TWO:678")).toBe(false);
      expect(util.isSyntheticCompanyNumber("two:st:gb:1")).toBe(false);
    });

    test("no number at all is not a number that must be hidden", () => {
      // These two states are different: "nothing captured yet" must not
      // suppress a field the buyer is supposed to type into.
      expect(util.isSyntheticCompanyNumber("")).toBe(false);
      expect(util.isSyntheticCompanyNumber("   ")).toBe(false);
      expect(util.isSyntheticCompanyNumber(null)).toBe(false);
      expect(util.isSyntheticCompanyNumber(undefined)).toBe(false);
    });
  });

  describe("formatCompanyNumber", () => {
    test("passes a registry number through, collapsed", () => {
      expect(util.formatCompanyNumber("  11111111 ")).toBe("11111111");
    });

    test("resolves a minted identifier to empty, never to the prefixed value", () => {
      expect(util.formatCompanyNumber(SYNTHETIC)).toBe("");
    });

    test("blank input resolves to empty", () => {
      expect(util.formatCompanyNumber(null)).toBe("");
      expect(util.formatCompanyNumber(undefined)).toBe("");
      expect(util.formatCompanyNumber(" ")).toBe("");
    });
  });

  describe("formatCompanyLabel — the brackets belong to the number", () => {
    test("name and registry number compose with parens", () => {
      expect(util.formatCompanyLabel("Example Ltd", "11111111")).toBe("Example Ltd (11111111)");
    });

    test("a minted number leaves the bare name, with NO empty parens", () => {
      const out = util.formatCompanyLabel("Example Ltd", SYNTHETIC);

      expect(out).toBe("Example Ltd");
      expect(out).not.toContain("(");
      expect(out).not.toContain(SYNTHETIC);
    });

    test("a missing number leaves the bare name too", () => {
      expect(util.formatCompanyLabel("Example Ltd", "")).toBe("Example Ltd");
      expect(util.formatCompanyLabel("Example Ltd", null)).toBe("Example Ltd");
    });

    test("no name yields nothing, rather than orphan parens", () => {
      expect(util.formatCompanyLabel("", "11111111")).toBe("");
      expect(util.formatCompanyLabel(" ", "11111111")).toBe("");
    });
  });

  describe("composeCompanyLabel — the pre-escaped-fragment caller", () => {
    test("passes its label through untouched", () => {
      // The search dropdown's label is the response's highlight markup, so
      // this must not re-encode or trim it — the plain-text callers collapse
      // their own name before calling in.
      expect(util.composeCompanyLabel("<em>Example</em> Ltd", "11111111")).toBe(
        "<em>Example</em> Ltd (11111111)"
      );
    });

    test("drops a minted number and its brackets", () => {
      expect(util.composeCompanyLabel("<em>Example</em> Ltd", SYNTHETIC)).toBe(
        "<em>Example</em> Ltd"
      );
    });
  });

  describe("the search-results dropdown", () => {
    /** @returns {Function} the plugin's processResults callback */
    function processResults() {
      return ctx.helper.genSelectWooParams().ajax.processResults;
    }

    /**
     * One search hit in the shape the companies endpoint returns.
     *
     * @param {string} name company name
     * @param {string} id national identifier
     * @returns {Object}
     */
    function hit(name, id) {
      return {
        name: name,
        highlight: "<em>" + name + "</em>",
        national_identifier: { id: id },
        lookup_id: "lookup-" + id
      };
    }

    test("renders a minted identifier nowhere in the row", () => {
      const out = processResults()({ items: [hit("Example Trading Co", SYNTHETIC)] }, {});

      expect(out.results[0].html).toBe("<em>Example Trading Co</em>");
      expect(out.results[0].html).not.toContain("TWO:");
      expect(out.results[0].html).not.toContain("(");
    });

    test("still carries the raw value as the row's company_id", () => {
      // Selecting this row has to be able to capture the company. The
      // identifier is what the picker writes to the submitted field, so
      // filtering it out of the DATA as well would break sole-trader
      // checkout in the name of a display rule.
      const out = processResults()({ items: [hit("Example Trading Co", SYNTHETIC)] }, {});

      expect(out.results[0].company_id).toBe(SYNTHETIC);
    });

    test("a registry number is untouched", () => {
      const out = processResults()({ items: [hit("Example Trading Co", "11111111")] }, {});

      expect(out.results[0].html).toBe("<em>Example Trading Co</em> (11111111)");
      expect(out.results[0].company_id).toBe("11111111");
    });
  });

  describe("the company summary label under the field", () => {
    beforeEach(() => {
      harness.buildCheckoutForm();
      selectTwo();
    });

    /**
     * Put the checkout in the state where Two is the chosen method.
     *
     * The harness form carries no payment_method radio of its own, so this
     * appends one — without it `isTwoincSelected()` reads false and every
     * company display is hidden for that reason instead of the one under
     * test, which makes the suppression assertions pass vacuously.
     */
    function selectTwo() {
      $("form[name='checkout']").append(
        '<input type="radio" name="payment_method" value="' + GATEWAY_ID + '" checked />'
      );
    }

    test("shows a registry number", () => {
      ctx.helper.renderCompanySummary("Example Ltd", "11111111");

      const $summary = $("#" + ctx.helper.companySummaryId);
      expect($summary.find(".twoinc-company-summary-id").text()).toBe("11111111");
      expect($summary.hasClass("hidden")).toBe(false);
    });

    test("renders no number and hides the block for a minted identifier", () => {
      ctx.helper.renderCompanySummary("Example Ltd", SYNTHETIC);

      const $summary = $("#" + ctx.helper.companySummaryId);
      expect($summary.find(".twoinc-company-summary-id").text()).toBe("");
      // The block is keyed on the number, and the number is now empty, so it
      // must leave no empty strip of vertical space behind under the field.
      expect($summary.hasClass("hidden")).toBe(true);
      expect($summary.text()).not.toContain("TWO:");
    });
  });

  describe("the order-intent notices", () => {
    beforeEach(() => {
      harness.buildCheckoutForm();
    });

    /**
     * Stand up an intent notice box carrying the company template the PHP
     * side serves, plus the captured company in the submitted fields that
     * togglePaySubtitleDesc reads back.
     *
     * @param {string} extraClass the notice's own class
     * @param {string} number the captured organisation number
     * @returns {Object} the notice element, as jQuery
     */
    function stageNotice(extraClass, number) {
      $("#billing_company").val("Example Ltd");
      $("#company_id").val(number);
      const $box = $(
        '<div class="twoinc-pay-box ' +
          extraClass +
          ' hidden" data-company-template="Order approved for {company}.">' +
          "Order approved." +
          "</div>"
      );
      $("body").append($box);
      return $box;
    }

    test("approved notice names the company with its registry number", () => {
      const $box = stageNotice("twoinc-intent-approved", "11111111");

      ctx.dom.togglePaySubtitleDesc("intent-approved");

      expect($box.text()).toBe("Order approved for Example Ltd (11111111).");
    });

    test("approved notice names the company with NO brackets for a minted one", () => {
      const $box = stageNotice("twoinc-intent-approved", SYNTHETIC);

      ctx.dom.togglePaySubtitleDesc("intent-approved");

      // The §12 case the brackets rule exists for: not "Example Ltd ()", and
      // not the served fallback sentence either — the company is still known,
      // so it is still named.
      expect($box.text()).toBe("Order approved for Example Ltd.");
      expect($box.text()).not.toContain("TWO:");
      expect($box.text()).not.toContain("()");
    });

    test("declined notice omits the brackets the same way", () => {
      const $box = stageNotice("twoinc-err-payment-default", SYNTHETIC);

      ctx.dom.togglePaySubtitleDesc("errored", ".twoinc-err-payment-default");

      expect($box.text()).toBe("Order approved for Example Ltd.");
      expect($box.text()).not.toContain("TWO:");
      expect($box.text()).not.toContain("()");
    });

    test("the submitted field still holds the raw identifier throughout", () => {
      stageNotice("twoinc-intent-approved", SYNTHETIC);

      ctx.dom.togglePaySubtitleDesc("intent-approved");

      expect($("#company_id").val()).toBe(SYNTHETIC);
    });
  });

  describe("the visible #company_id field", () => {
    /**
     * The one configuration that shows `#company_id` to the buyer: company
     * search off, so the plain name+id fallback is what captures the company.
     */
    function loadWithSearchOff() {
      ctx = harness.loadTwoinc({
        gateway_id: GATEWAY_ID,
        supported_buyer_countries: ["GB"],
        enable_company_search: "no",
        enable_address_lookup: "no",
        text: {}
      });
      $ = ctx.$;
      util = ctx.util;
      harness.buildCheckoutForm();
      // See the note on selectTwo() above: without a checked radio the field
      // is hidden because Two is not the selected method, and the minted-value
      // assertion below would hold no matter what the filter did.
      $("form[name='checkout']").append(
        '<input type="radio" name="payment_method" value="' + GATEWAY_ID + '" checked />'
      );
    }

    test("is shown when the buyer has a registry number to type", () => {
      loadWithSearchOff();
      $("#company_id").val("11111111");

      ctx.dom.toggleBusinessFields();

      expect($("#company_id_field").hasClass("hidden")).toBe(false);
    });

    test("is shown when nothing has been captured yet", () => {
      loadWithSearchOff();
      $("#company_id").val("");

      ctx.dom.toggleBusinessFields();

      expect($("#company_id_field").hasClass("hidden")).toBe(false);
    });

    test("is hidden when it holds a minted identifier", () => {
      loadWithSearchOff();
      $("#company_id").val(SYNTHETIC);

      ctx.dom.toggleBusinessFields();

      // An enrolled sole trader in a search-off shop is how `TWO:…` ends up
      // in a visible text box. Hiding the field is the fix rather than
      // blanking it: the value is what WooCommerce posts.
      expect($("#company_id_field").hasClass("hidden")).toBe(true);
      expect($("#company_id").val()).toBe(SYNTHETIC);
    });

    test("carries no required cue while hidden", () => {
      loadWithSearchOff();
      $("#company_id").val(SYNTHETIC);

      ctx.dom.toggleBusinessFields();

      // A required cue on a field nobody can see is how a checkout becomes
      // unsubmittable with no visible reason why.
      expect($("#company_id_field").hasClass("validate-required")).toBe(false);
    });
  });
});
