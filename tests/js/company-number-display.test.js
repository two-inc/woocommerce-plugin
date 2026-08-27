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
    harness.releasePanel(ctx.helper);
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

    test("an empty label yields no orphan parens", () => {
      expect(util.composeCompanyLabel("", "11111111")).toBe("");
    });

    test("returns its label verbatim when there is nothing to append", () => {
      // The contract callers rely on: whatever went in comes back out
      // untouched, so a caller that passed a string always gets a string. The
      // dropdown guarantees that by defaulting its fragment before calling in
      // — a search hit missing `highlight` must not compose to `undefined`.
      expect(util.composeCompanyLabel("", SYNTHETIC)).toBe("");
      expect(util.composeCompanyLabel("Example Ltd", "")).toBe("Example Ltd");
    });
  });

  describe("the search-results panel", () => {
    /**
     * Shape a response into panel rows, as the transport's own success
     * handler does.
     *
     * @param {Object} response
     * @returns {Array<Object>}
     */
    function rows(response) {
      return ctx.helper.toResultItems(response);
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
      const out = rows({ items: [hit("Example Trading Co", SYNTHETIC)] });

      expect(out[0].html).toBe("<em>Example Trading Co</em>");
      expect(out[0].html).not.toContain("TWO:");
      expect(out[0].html).not.toContain("(");
    });

    test("still carries the raw value as the row's company_id", () => {
      // Selecting this row has to be able to capture the company. The
      // identifier is what the pick handler writes to the submitted field, so
      // filtering it out of the DATA as well would break sole-trader
      // checkout in the name of a display rule.
      const out = rows({ items: [hit("Example Trading Co", SYNTHETIC)] });

      expect(out[0].company_id).toBe(SYNTHETIC);
    });

    test("a registry number is untouched", () => {
      const out = rows({ items: [hit("Example Trading Co", "11111111")] });

      expect(out[0].html).toBe("<em>Example Trading Co</em> (11111111)");
      expect(out[0].company_id).toBe("11111111");
    });

    test("a hit with no highlight falls back to the plain name", () => {
      // The panel writes `html` straight into the row's innerHTML, so an
      // undefined composition renders a blank-but-selectable entry.
      const withoutHighlight = hit("Example Trading Co", "11111111");
      delete withoutHighlight.highlight;

      const out = rows({ items: [withoutHighlight] });

      expect(out[0].html).toBe("Example Trading Co (11111111)");
    });

    test("a hit with neither highlight nor name yields a string, not undefined", () => {
      const out = rows({ items: [{ national_identifier: { id: "11111111" } }] });

      expect(typeof out[0].html).toBe("string");
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
  });

  describe("the data the server is sent", () => {
    beforeEach(() => {
      harness.buildCheckoutForm();
    });

    // This is the half the display filter must NOT reach. Asserting that
    // `#company_id` still holds what the test itself typed into it would be a
    // tautology — nothing in the display path writes that input — so the
    // assertions here are on the payload builder instead, which is what a
    // careless "just filter it at the source" fix would break.
    test("getCompanyData carries the raw minted identifier", () => {
      $("#billing_company").val("Example Ltd");
      $("#company_id").val(SYNTHETIC);

      expect(ctx.dom.getCompanyData().organization_number).toBe(SYNTHETIC);
    });

    test("getCompanyData carries a registry number unchanged", () => {
      $("#billing_company").val("Example Ltd");
      $("#company_id").val("11111111");

      expect(ctx.dom.getCompanyData().organization_number).toBe("11111111");
    });
  });

  describe("the minted number never reaches the buyer", () => {
    /**
     * The configuration that used to be §12's problem case: a billing country
     * with no supported registry, so there is nothing to search and the plain
     * native name field is what captures the company. That state used to also
     * show `#company_id` as an editable box, which is how a `TWO:…` value ended
     * up on screen at all.
     *
     * As of 2026-08-19 (Doug, #486) `#company_id_field` is never visible in any
     * mode or country — the number is a read-only label instead — so §12's
     * guarantee no longer rests on hiding a field. What these tests pin now is
     * the other half, which is the half that must not regress: the value stays
     * on the submitted input, and no surface renders it.
     *
     * This fixture used to be driven by `enable_company_search: "no"`. That was
     * never a real state: the admin checkbox only relocates the search control
     * (TWO-25326 §7.1), so PHP always sends `'yes'`, and the runtime mutation
     * that made the fixture "work" is gone.
     */
    function loadWithNoRegistry() {
      ctx = harness.loadTwoinc({
        gateway_id: GATEWAY_ID,
        supported_buyer_countries: ["NO"],
        enable_address_lookup: "no",
        text: {}
      });
      $ = ctx.$;
      util = ctx.util;
      harness.buildCheckoutForm();
      // Two selected: the label's own visibility no longer depends on it
      // (#486), but the intent tile's rendering still does, and leaving the
      // radio unchecked would let a suppression assertion pass for the wrong
      // reason.
      $("form[name='checkout']").append(
        '<input type="radio" name="payment_method" value="' + GATEWAY_ID + '" checked />'
      );
    }

    // The whole reason §12 existed: on a country with no registry, an enrolled
    // sole trader's `TWO:…` used to sit in a visible text box. It cannot any
    // more, whatever it holds — the input is hidden in every state — so the
    // guarantee to pin is that hiding it did not cost the value.
    test.each([
      ["11111111", "a registry number"],
      ["", "nothing captured yet"],
      [SYNTHETIC, "a minted identifier"]
    ])("#company_id holding %s (%s) is hidden but still posted", (value) => {
      loadWithNoRegistry();
      $("#company_id").val(value);

      ctx.dom.toggleBusinessFields();

      expect($("#company_id_field").hasClass("hidden")).toBe(true);
      expect($("#company_id").val()).toBe(value);
      expect($("#company_id").attr("name")).toBe("company_id");
      expect($("#company_id").prop("disabled")).toBe(false);
      // A required cue on a field nobody can see is how a checkout becomes
      // unsubmittable with no visible reason why. Asserted against what
      // toggleRequiredCues actually does — set the `required` attribute and
      // append an `<abbr class="twoinc-required">` to the label. An earlier
      // draft asserted a `validate-required` class that nothing in this
      // codebase sets, so it passed no matter what the production code did.
      expect($("#company_id").attr("required")).toBeFalsy();
      expect($("#company_id_field").find("label .twoinc-required").length).toBe(0);
    });

    describe("driven through the real sole-trader flow", () => {
      // The ordering that matters, and the one the assertions above cannot
      // reach: production toggles the fields BEFORE the autofill lands, so
      // `#company_id` is empty at toggle time and the field is shown on the
      // strength of that. Setting the value first and toggling afterwards —
      // as the tests above do — inverts it, and would certify a guarantee
      // the real flow does not deliver. So drive the actual capture entry
      // point and assert the end state.
      test("enrolling a sole trader leaves no minted number on screen", () => {
        loadWithNoRegistry();

        ctx.soleTrader.setCompany(SYNTHETIC, "Example Ltd");

        expect($("#company_id_field").hasClass("hidden")).toBe(true);
        expect($("#company_id").attr("required")).toBeFalsy();
        // Still posted — the whole point of hiding rather than blanking.
        expect($("#company_id").val()).toBe(SYNTHETIC);
        expect(ctx.dom.getCompanyData().organization_number).toBe(SYNTHETIC);
      });

      test("capturing a registry company still surfaces its number, on the label", () => {
        // The counterweight: proves the suppression above is genuinely driven
        // by the filter rather than the label simply never rendering here.
        loadWithNoRegistry();

        ctx.soleTrader.setCompany("11111111", "Example Ltd");

        const $summary = $("#" + ctx.helper.companySummaryId);
        expect($summary.find(".twoinc-company-summary-id").text()).toBe("11111111");
        expect($summary.hasClass("hidden")).toBe(false);
      });

      test("the summary label shows no minted number after enrollment", () => {
        loadWithNoRegistry();

        ctx.soleTrader.setCompany(SYNTHETIC, "Example Ltd");

        const $summary = $("#" + ctx.helper.companySummaryId);
        expect($summary.find(".twoinc-company-summary-id").text()).toBe("");
        expect($summary.hasClass("hidden")).toBe(true);
      });
    });

    describe("restored from a previous visit", () => {
      // The other ordering trap: initialize() toggles the fields before the
      // restore passes run, so both of them write `#company_id` after the
      // decision was taken against an empty input. A returning sole trader's
      // user meta holds a minted identifier, so this is the every-page-load
      // case rather than an edge case.
      test("user-meta restore leaves no minted number on screen", () => {
        loadWithNoRegistry();
        ctx.dom.toggleBusinessFields();
        // The state initialize() is in when it reaches the restore: fields
        // already toggled, input still empty, so nothing on the label yet.
        const $summary = $("#" + ctx.helper.companySummaryId);
        expect($summary.hasClass("hidden")).toBe(true);

        ctx.twoinc.billing_company = "Example Ltd";
        ctx.twoinc.company_id = SYNTHETIC;
        ctx.dom.loadUserMetaInputs();

        expect($("#company_id").val()).toBe(SYNTHETIC);
        expect($("#company_id_field").hasClass("hidden")).toBe(true);
        expect($summary.find(".twoinc-company-summary-id").text()).toBe("");
        expect($summary.hasClass("hidden")).toBe(true);
      });

      test("user-meta restore of a registry number reaches the label", () => {
        loadWithNoRegistry();
        ctx.dom.toggleBusinessFields();

        ctx.twoinc.billing_company = "Example Ltd";
        ctx.twoinc.company_id = "11111111";
        ctx.dom.loadUserMetaInputs();

        const $summary = $("#" + ctx.helper.companySummaryId);
        expect($summary.find(".twoinc-company-summary-id").text()).toBe("11111111");
        expect($summary.hasClass("hidden")).toBe(false);
        // Still never as a field, even now that it holds a real number.
        expect($("#company_id_field").hasClass("hidden")).toBe(true);
      });

      // No equivalent for loadStorageInputs(): that replay is deliberately
      // NOT made to re-toggle. It runs from initialize() before the country
      // configuration is guaranteed to be populated (an existing suite drives
      // it with a minimal fixture and toggleBusinessFields() throws there), and
      // it only ever replays the current session's own inputs — which the
      // capture path that produced them has already toggled for. The
      // cross-visit case, which is the one that actually persists a minted
      // identifier, is the user-meta pass covered above.
    });
  });
});
