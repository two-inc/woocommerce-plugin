/**
 * The payment-terms chip renderer in assets/js/twoinc.js.
 *
 * Four behaviours are pinned here because all four are silent when they
 * regress — the chips still render, just saying the wrong thing:
 *
 *   1. exactly one offered term  → the single chip names itself
 *      ("Payment Terms 30 days") and NO heading sits above it;
 *   2. more than one            → the heading ("Selected payment terms") sits
 *      above and the chips carry the bare "N days";
 *   3. the fee label shows the currency SYMBOL (the server-formatted
 *      buyer_fee_share_display), never the currency code;
 *   4. whether an amount shows is decided over the whole offered set
 *      (ABN-528), so chips never disagree about carrying a fee.
 *
 * Reference implementation is magento-plugin's Luma renderer
 * (view/frontend/web/js/view/payment/method-renderer/gateway_method.js and
 * view/frontend/web/template/payment/gateway_method.html) — the same template
 * the Amasty and Fire checkouts render.
 */

"use strict";

const harness = require("./wc-harness");

describe("payment terms chips", () => {
  let ctx;

  /**
   * Mount the two containers build_payment_description() renders, and hand
   * back a chip module primed with settled (non-loading) fee state.
   *
   * @param {Object} cfg   window.twoinc.payment_terms
   * @param {Object} [fees] keyed by term days, as the fees endpoint returns
   * @returns {Object} the twoincTermChips module
   */
  function mount(cfg, fees) {
    ctx = harness.loadTwoinc({ payment_terms: cfg });
    document.body.innerHTML = [
      '<label class="twoinc-term-chips-heading hidden"></label>',
      '<div class="twoinc-term-chips hidden" role="radiogroup"></div>'
    ].join("");
    ctx.termChips.fees = fees || {};
    ctx.termChips.feesLoaded = true;
    return ctx.termChips;
  }

  const COPY = {
    days_label: "%s days",
    single_label: "Payment Terms %s days",
    heading: "Selected payment terms"
  };

  afterEach(() => {
    document.body.innerHTML = "";
  });

  function headingText() {
    const $h = ctx.$(".twoinc-term-chips-heading");
    return $h.hasClass("hidden") ? "" : $h.text();
  }

  /** @returns {string[]} the day-label of each rendered chip, in order */
  function chipDayLabels() {
    return ctx
      .$(".twoinc-term-chip__days")
      .map(function () {
        return ctx.$(this).text();
      })
      .get();
  }

  describe("exactly one offered term", () => {
    test("names the term inside the chip and renders no heading", () => {
      const chips = mount(Object.assign({ enabled: true, terms: [30], selected: 30 }, COPY));
      chips.render([30], 30);

      expect(chipDayLabels()).toEqual(["Payment Terms 30 days"]);
      expect(headingText()).toBe("");
    });

    // The chip templates are translated PHP-side. A fallback that spelled
    // out English would render as plausible copy on a non-English shop and
    // hide the fact that the label never arrived — the same failure that
    // made a Dutch tagline look intentional on an English shop (TWO-25270).
    test("a missing single_label degrades to the plain day label, not English", () => {
      const chips = mount(
        Object.assign({ enabled: true, terms: [30], selected: 30 }, COPY, { single_label: "" })
      );
      chips.render([30], 30);

      expect(chipDayLabels()).toEqual(["30 days"]);
    });

    test("no label copy at all leaves the chip visibly bare, never English", () => {
      const chips = mount({ enabled: true, terms: [30], selected: 30 });
      chips.render([30], 30);

      expect(chipDayLabels()).toEqual(["30"]);
    });

    test("the lone chip is not clickable", () => {
      const chips = mount(Object.assign({ enabled: true, terms: [30], selected: 30 }, COPY));
      chips.render([30], 30);

      const $chip = ctx.$(".twoinc-term-chip");
      expect($chip).toHaveLength(1);
      expect($chip.prop("disabled")).toBe(true);
      expect($chip.hasClass("twoinc-term-chip--single")).toBe(true);
    });
  });

  describe("more than one offered term", () => {
    test("no label copy at all leaves every chip bare, never English", () => {
      const chips = mount({ enabled: true, terms: [30, 60], selected: 30 });
      chips.render([30, 60], 30);

      expect(chipDayLabels()).toEqual(["30", "60"]);
    });

    test("puts the heading above bare day-labelled chips", () => {
      const chips = mount(Object.assign({ enabled: true, terms: [30, 60], selected: 30 }, COPY));
      chips.render([30, 60], 30);

      expect(headingText()).toBe("Selected payment terms");
      expect(chipDayLabels()).toEqual(["30 days", "60 days"]);
      // The heading is a sibling ahead of the radiogroup, not a chip inside it.
      expect(ctx.$(".twoinc-term-chips .twoinc-term-chips-heading")).toHaveLength(0);
      expect(ctx.$(".twoinc-term-chips-heading").nextAll(".twoinc-term-chips")).toHaveLength(1);
    });

    test("dropping back to a single term retracts the heading", () => {
      const chips = mount(Object.assign({ enabled: true, terms: [30, 60], selected: 30 }, COPY));
      chips.render([30, 60], 30);
      expect(headingText()).toBe("Selected payment terms");

      chips.render([30], 30);
      expect(headingText()).toBe("");
      expect(chipDayLabels()).toEqual(["Payment Terms 30 days"]);
    });
  });

  describe("the fee amount", () => {
    /** @returns {string[]} the fee text of each rendered chip, in order */
    function chipFees() {
      return ctx
        .$(".twoinc-term-chip__fee")
        .map(function () {
          return ctx.$(this).text();
        })
        .get();
    }

    /** One term's entry as the fees endpoint returns it. */
    function quote(amount, display) {
      return { buyer_fee_share: amount, currency: "EUR", buyer_fee_share_display: display };
    }

    // Whether an amount shows is decided over the whole set: any priced term
    // puts an amount on every chip, all-zero puts one on none. A term whose
    // quote failed (null) counts as zero and still shows an amount when a
    // sibling is priced.
    test.each([
      { terms: [30, 60], fees: { 30: quote("0", "€0,00"), 60: quote("0", "€0,00") }, expected: [], description: "every term zero shows nothing anywhere" },
      { terms: [30, 60], fees: { 30: quote("12.50", "€12,50"), 60: quote("0", "€0,00") }, expected: ["+€12,50", "+€0,00"], description: "one priced term puts a zero amount on the zero-fee chip" },
      { terms: [30, 60], fees: { 30: quote("12.50", "€12,50"), 60: quote("18.00", "€18,00") }, expected: ["+€12,50", "+€18,00"], description: "every priced term shows its own amount" },
      { terms: [30], fees: { 30: quote("0", "€0,00") }, expected: [], description: "a lone zero-fee chip shows nothing" },
      { terms: [30], fees: { 30: quote("9.00", "€9,00") }, expected: ["+€9,00"], description: "a lone priced chip shows its amount" },
      { terms: [30, 60], fees: { 30: quote("12.50", "€12,50"), 60: null }, expected: ["+€12,50", "+€0,00"], description: "an unresolved term shows a zero amount beside a priced sibling" },
      { terms: [30, 60], fees: { 30: null, 60: null }, expected: [], description: "no term resolving shows nothing anywhere" }
    ])("$description", ({ terms, fees, expected }) => {
      const chips = mount(Object.assign({ enabled: true, terms: terms, selected: terms[0] }, COPY), fees);
      chips.zeroFeeDisplay = "€0,00";
      chips.render(terms, terms[0]);

      expect(chipFees()).toEqual(expected);
    });

    test("uses the server-formatted amount, so the symbol not the code shows", () => {
      const chips = mount(Object.assign({ enabled: true, terms: [30, 60], selected: 30 }, COPY), {
        30: quote("12.50", "€12,50"),
        60: quote("0", "€0,00")
      });
      chips.render([30, 60], 30);

      expect(ctx.$(".twoinc-term-chips").text()).not.toContain("EUR");
    });

    test("falls back to amount plus code when no formatted amount is present", () => {
      const chips = mount(Object.assign({ enabled: true, terms: [30], selected: 30 }, COPY), {
        30: { buyer_fee_share: "12.50", currency: "EUR" }
      });
      chips.render([30], 30);

      expect(ctx.$(".twoinc-term-chip__fee").text()).toBe("+12.50 EUR");
    });
  });

  describe("a fee quote that does not arrive", () => {
    let ajax;

    afterEach(() => {
      if (ajax) ajax.restore();
      ajax = null;
    });

    /** @returns {string[]} the fee label of each rendered chip, in order */
    function feeLabels() {
      return ctx
        .$(".twoinc-term-chip__fee")
        .map(function () {
          return ctx.$(this).text();
        })
        .get();
    }

    const QUOTE = {
      success: true,
      data: {
        terms: [30, 60],
        selected: 30,
        fees: {
          30: { buyer_fee_share: "9.00", currency: "EUR", buyer_fee_share_display: "€9,00" }
        },
        zero_fee_display: "€0,00"
      }
    };

    // jQuery routes a non-2xx and a dropped connection both through .fail with
    // textStatus 'error', so they are one row rather than two.
    const OUTCOMES = [
      ["a fresh quote replaces the stale badge", (r) => r.succeed(QUOTE), ["+€9,00", "+€0,00"]],
      ["a network error or non-2xx clears", (r) => r.fail("error"), []],
      ["an unparseable body clears", (r) => r.fail("parsererror"), []],
      ["a declined quote clears", (r) => r.succeed({ success: false, data: {} }), []],
      ["a non-envelope body clears", (r) => r.succeed("<html>error</html>"), []]
    ];

    test.each(OUTCOMES)("%s", (description, settle, expected) => {
      const chips = mount(
        Object.assign(
          {
            enabled: true,
            terms: [30, 60],
            selected: 30,
            offset_pricing_enabled: true,
            fees_url: "https://shop.example.test/?wc-ajax=two_term_fees",
            csrf_token: "test-checkout-csrf-token"
          },
          COPY
        ),
        { 30: { buyer_fee_share: "99.00", currency: "EUR", buyer_fee_share_display: "€99,00" } }
      );
      ajax = harness.stubAjax(ctx.$);

      chips.refresh();
      settle(ajax.last());

      expect(feeLabels()).toEqual(expected);
      expect(ctx.$(".twoinc-term-chip__loading")).toHaveLength(0);
    });
  });
});
