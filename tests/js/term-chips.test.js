/**
 * ABN-468. The payment-terms chip renderer in assets/js/twoinc.js.
 *
 * Three behaviours are pinned here because all three are silent when they
 * regress — the chips still render, just saying the wrong thing:
 *
 *   1. exactly one offered term  → the single chip names itself
 *      ("Payment Terms 30 days") and NO heading sits above it;
 *   2. more than one            → the heading ("Selected payment terms") sits
 *      above and the chips carry the bare "N days";
 *   3. the fee label shows the currency SYMBOL (the server-formatted
 *      buyer_fee_share_display), never the currency code.
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

  /** @returns {string} */
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

  describe("the fee label", () => {
    test("uses the server-formatted amount, so the symbol not the code shows", () => {
      const chips = mount(Object.assign({ enabled: true, terms: [30, 60], selected: 30 }, COPY), {
        30: { buyer_fee_share: "12.50", currency: "EUR", buyer_fee_share_display: "€12,50" },
        60: { buyer_fee_share: "0", currency: "EUR", buyer_fee_share_display: "€0,00" }
      });
      chips.render([30, 60], 30);

      const fees = ctx
        .$(".twoinc-term-chip__fee")
        .map(function () {
          return ctx.$(this).text();
        })
        .get();
      // Only the non-zero quote gets a label.
      expect(fees).toEqual(["+€12,50"]);
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
});
