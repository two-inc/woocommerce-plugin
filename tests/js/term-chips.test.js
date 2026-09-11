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
 * The chip contract is cross-platform: every platform's checkout renders the
 * same four rules, so a change here belongs in all of them.
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
      '<span class="twoinc-term-chips-heading hidden" id="twoinc-term-chips-heading"></span>',
      '<div class="twoinc-term-chips hidden" role="radiogroup" aria-labelledby="twoinc-term-chips-heading"></div>'
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
      {
        terms: [30, 60],
        fees: { 30: quote("0", "€0,00"), 60: quote("0", "€0,00") },
        expected: [],
        description: "every term zero shows nothing anywhere"
      },
      {
        terms: [30, 60],
        fees: { 30: quote("12.50", "€12,50"), 60: quote("0", "€0,00") },
        expected: ["+€12,50", "+€0,00"],
        description: "one priced term puts a zero amount on the zero-fee chip"
      },
      {
        terms: [30, 60],
        fees: { 30: quote("12.50", "€12,50"), 60: quote("18.00", "€18,00") },
        expected: ["+€12,50", "+€18,00"],
        description: "every priced term shows its own amount"
      },
      {
        terms: [30],
        fees: { 30: quote("0", "€0,00") },
        expected: [],
        description: "a lone zero-fee chip shows nothing"
      },
      {
        terms: [30],
        fees: { 30: quote("9.00", "€9,00") },
        expected: ["+€9,00"],
        description: "a lone priced chip shows its amount"
      },
      {
        terms: [30, 60],
        fees: { 30: quote("12.50", "€12,50"), 60: null },
        expected: ["+€12,50"],
        description: "an unpriced term shows no amount beside a priced sibling"
      },
      {
        terms: [30, 60],
        fees: { 30: quote("12.50", "€12,50"), 60: quote("0", "€0,00") },
        expected: ["+€12,50", "+€0,00"],
        description: "a term priced AT zero still shows its zero, unlike one never priced"
      },
      {
        terms: [30, 60],
        fees: { 30: null, 60: null },
        expected: [],
        description: "no term resolving shows nothing anywhere"
      }
    ])("$description", ({ terms, fees, expected }) => {
      const chips = mount(
        Object.assign({ enabled: true, terms: terms, selected: terms[0] }, COPY),
        fees
      );
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
        }
      }
    };

    // jQuery routes a non-2xx and a dropped connection both through .fail with
    // textStatus 'error', so they are one row rather than two.
    const OUTCOMES = [
      ["a fresh quote replaces the stale badge", (r) => r.succeed(QUOTE), ["+€9,00"]],
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

  // Every re-render replaces every chip, so a chip the buyer is on is
  // destroyed. Without a handover focus falls to the body and the keyboard
  // loses its place in the group (ABN-554).
  describe("a re-render under the buyer's focus", () => {
    /** @returns {string|null} the day-count of the focused chip, if any */
    function focusedDays() {
      const active = document.activeElement;
      return active && active.classList.contains("twoinc-term-chip")
        ? active.getAttribute("data-days")
        : null;
    }

    function chipFor(days) {
      return ctx.$('.twoinc-term-chip[data-days="' + days + '"]')[0];
    }

    test.each([
      {
        rerenderTerms: [30, 60, 90],
        expected: "60",
        description: "the same term keeps the focus on its rebuilt chip"
      },
      {
        rerenderTerms: [30, 90],
        expected: null,
        description: "a term no longer offered has no chip to hand focus back to"
      }
    ])("$description", ({ rerenderTerms, expected }) => {
      const chips = mount(
        Object.assign({ enabled: true, terms: [30, 60, 90], selected: 30 }, COPY)
      );
      chips.render([30, 60, 90], 30);
      const before = chipFor(60);
      before.focus();
      expect(focusedDays()).toBe("60");

      chips.render(rerenderTerms, 30);

      expect(focusedDays()).toBe(expected);
      if (expected !== null) expect(document.activeElement).not.toBe(before);
    });

    test("leaves focus alone when it sits outside the chip group", () => {
      const chips = mount(Object.assign({ enabled: true, terms: [30, 60], selected: 30 }, COPY));
      chips.render([30, 60], 30);
      const $outside = ctx
        .$('<button type="button" id="outside"></button>')
        .appendTo(document.body);
      $outside[0].focus();

      chips.render([30, 60], 30);

      expect(document.activeElement.id).toBe("outside");
    });
  });

  // The chips advertise themselves as a radio group, so they owe that role's
  // keyboard contract: the group is ONE tab stop and the arrow keys move the
  // checked term and the focus together (ABN-554, W3C APG radio pattern).
  // Tab order itself is not observable in jsdom and is verified in a browser;
  // what is observable here is the roving tabindex the browser reads, and the
  // focus the handler moves itself.
  describe("the keyboard contract", () => {
    const SELECT_URL = "https://shop.example.test/?wc-ajax=two_select_term";

    /**
     * Three chips with the middle one checked, so a traversal has somewhere to
     * go in both directions and both wraps are reachable in one step.
     */
    function mountGroup(selected) {
      const chips = mount(
        Object.assign(
          {
            enabled: true,
            terms: [30, 60, 90],
            selected: selected,
            select_url: SELECT_URL,
            csrf_token: "test-checkout-csrf-token"
          },
          COPY
        )
      );
      chips.render([30, 60, 90], selected);
      return chips;
    }

    /** @returns {string|null} the day-count of the focused chip, if any */
    function focusedDays() {
      const active = document.activeElement;
      return active && active.classList.contains("twoinc-term-chip")
        ? active.getAttribute("data-days")
        : null;
    }

    /** @returns {string[]} the day-count of every chip carrying the tab stop */
    function tabbableDays() {
      return ctx
        .$('.twoinc-term-chip[tabindex="0"]')
        .map(function () {
          return ctx.$(this).attr("data-days");
        })
        .get();
    }

    /** @returns {string|null} the day-count of the chip exposed as checked */
    function checkedDays() {
      const $checked = ctx.$('.twoinc-term-chip[aria-checked="true"]');
      return $checked.length === 1 ? $checked.attr("data-days") : null;
    }

    /** @returns {string|null} the day-count of the chip painted as selected */
    function selectedDays() {
      const $selected = ctx.$(".twoinc-term-chip--selected");
      return $selected.length === 1 ? $selected.attr("data-days") : null;
    }

    function focusChip(days) {
      ctx.$('.twoinc-term-chip[data-days="' + days + '"]')[0].focus();
    }

    /** Dispatch one keydown from the focused chip and hand back the event. */
    function press(key, modifiers) {
      const event = ctx.$.Event("keydown", Object.assign({ key: key }, modifiers || {}));
      ctx.$(document.activeElement).trigger(event);
      return event;
    }

    test("renders exactly one tab stop, on the checked chip", () => {
      mountGroup(60);

      expect(tabbableDays()).toEqual(["60"]);
      expect(ctx.$(".twoinc-term-chip")).toHaveLength(3);
    });

    // A stale session selection, or a term withdrawn between the render and
    // the quote: the group must not drop out of the tab order over it.
    test("a selection matching no chip puts the tab stop on the first", () => {
      mountGroup(45);

      expect(tabbableDays()).toEqual(["30"]);
      expect(checkedDays()).toBeNull();
    });

    test.each([
      { from: 60, key: "ArrowRight", expected: "90", description: "ArrowRight moves forward" },
      { from: 60, key: "ArrowDown", expected: "90", description: "ArrowDown moves forward" },
      { from: 60, key: "ArrowLeft", expected: "30", description: "ArrowLeft moves back" },
      { from: 60, key: "ArrowUp", expected: "30", description: "ArrowUp moves back" },
      { from: 90, key: "ArrowRight", expected: "30", description: "the last chip wraps forward" },
      { from: 30, key: "ArrowLeft", expected: "90", description: "the first chip wraps back" },
      { from: 60, key: "Home", expected: "30", description: "Home jumps to the first" },
      { from: 60, key: "End", expected: "90", description: "End jumps to the last" }
    ])("$description", ({ from, key, expected }) => {
      mountGroup(from);
      focusChip(from);

      const event = press(key);

      // The group has consumed the key, so the page must not also scroll.
      expect(event.isDefaultPrevented()).toBe(true);
      expect(focusedDays()).toBe(expected);
      expect(tabbableDays()).toEqual([expected]);
      // Selection follows focus, and the tick and the exposed state move as
      // one: neither can be left behind on the chip the buyer has left.
      expect(checkedDays()).toBe(expected);
      expect(selectedDays()).toBe(expected);
      expect(ctx.$("input[name='two_selected_term']").val()).toBe(expected);
    });

    // Alt+Left is "back" and Ctrl/Cmd+Arrow are the browser's own text and
    // history shortcuts. Swallowing them broke navigation on another platform.
    test.each([
      { modifiers: { altKey: true }, description: "Alt+ArrowLeft is left to the browser" },
      { modifiers: { ctrlKey: true }, description: "Ctrl+ArrowLeft is left to the browser" },
      { modifiers: { metaKey: true }, description: "Cmd+ArrowLeft is left to the browser" }
    ])("$description", ({ modifiers }) => {
      mountGroup(60);
      focusChip(60);

      const event = press("ArrowLeft", modifiers);

      expect(focusedDays()).toBe("60");
      expect(checkedDays()).toBe("60");
      expect(event.isDefaultPrevented()).toBe(false);
    });

    test("a key the group does not own keeps its default action", () => {
      mountGroup(60);
      focusChip(60);

      const event = press("Tab");

      expect(focusedDays()).toBe("60");
      expect(event.isDefaultPrevented()).toBe(false);
    });

    // The script is enqueued in the HEAD, where `document.body` is still null,
    // so a delegated binding rooted on the body attaches to nothing at all.
    // Not observable through behaviour here: the Jest harness evaluates the
    // source with a body already present, so a body-rooted binding passes
    // every keyboard case above and fails on a real checkout.
    test("the keydown binding is rooted on the document, not the body", () => {
      mountGroup(60);
      const bodyEvents = ctx.$._data(document.body, "events") || {};
      const documentEvents = ctx.$._data(document, "events") || {};

      const namespaces = (documentEvents.keydown || []).map((handler) => handler.namespace);
      expect(namespaces).toContain("twoincTermChips");
      expect((bodyEvents.keydown || []).map((handler) => handler.namespace)).not.toContain(
        "twoincTermChips"
      );
    });

    test("a lone chip has nothing to traverse", () => {
      const chips = mount(Object.assign({ enabled: true, terms: [30], selected: 30 }, COPY));
      chips.render([30], 30);

      const event = ctx.$.Event("keydown", { key: "ArrowRight" });
      ctx.$(".twoinc-term-chip").trigger(event);

      expect(event.isDefaultPrevented()).toBe(false);
      expect(checkedDays()).toBe("30");
    });

    describe("what a sweep costs", () => {
      let ajax;

      beforeEach(() => {
        jest.useFakeTimers();
      });

      afterEach(() => {
        jest.useRealTimers();
        if (ajax) ajax.restore();
        ajax = null;
      });

      /** @returns {number} selection posts issued so far */
      function selectPosts() {
        return ajax.calls.filter((call) => call.url === SELECT_URL).length;
      }

      // Selection follows focus, so a four-key sweep changes the term four
      // times. Each committed change costs a selection post, a full checkout
      // update and a fresh fee quote, so committing per keystroke turns one
      // keyboard gesture into a request storm.
      test("a sweep commits once, on the term it settles on", () => {
        const chips = mountGroup(30);
        ajax = harness.stubAjax(ctx.$);
        focusChip(30);

        press("ArrowRight");
        press("ArrowRight");
        press("ArrowLeft");

        expect(focusedDays()).toBe("60");
        expect(checkedDays()).toBe("60");
        expect(selectPosts()).toBe(0);

        jest.advanceTimersByTime(chips.commitDelayMs);

        expect(selectPosts()).toBe(1);
        expect(harness.requestParams(ajax.last()).get("days")).toBe("60");
      });

      // The chips carry the term the order is composed on, so a checkout
      // update landing mid-sweep must not paint the committed term back over
      // the buyer's choice.
      test("a re-render mid-sweep keeps the uncommitted term", () => {
        const chips = mountGroup(30);
        ajax = harness.stubAjax(ctx.$);
        focusChip(30);
        press("ArrowRight");

        chips.render([30, 60, 90], 30);

        expect(checkedDays()).toBe("60");
        expect(selectedDays()).toBe("60");
        expect(tabbableDays()).toEqual(["60"]);
        expect(ctx.$("input[name='two_selected_term']").val()).toBe("60");
      });

      test("a sweep that returns to the committed term posts nothing", () => {
        const chips = mountGroup(30);
        ajax = harness.stubAjax(ctx.$);
        focusChip(30);

        press("ArrowRight");
        press("ArrowLeft");
        jest.advanceTimersByTime(chips.commitDelayMs);

        expect(checkedDays()).toBe("30");
        expect(selectPosts()).toBe(0);
      });

      test("a click supersedes a commit the sweep has not posted yet", () => {
        const chips = mountGroup(30);
        ajax = harness.stubAjax(ctx.$);
        focusChip(30);
        press("ArrowRight");

        ctx.$('.twoinc-term-chip[data-days="90"]').trigger("click");
        jest.advanceTimersByTime(chips.commitDelayMs);

        expect(selectPosts()).toBe(1);
        expect(harness.requestParams(ajax.last()).get("days")).toBe("90");
      });
    });
  });
});
