/**
 * ABN-554. What the company-search panel says to a screen reader.
 *
 * The panel painted rows and messages into a listbox nothing was watching, so
 * a buyer who cannot see the panel got silence for every outcome a search has.
 * The live region here carries the same roles, the same politeness and the same
 * announcement points as the reference panel on the sibling platform, which
 * gets them from the autocomplete widget it is built on.
 *
 * jsdom has no accessibility layer, so these assertions read the attributes and
 * the text written into the region; that the region is in the tree at all is
 * pinned by it living outside the `hidden` panel.
 */

"use strict";

const harness = require("./wc-harness");

const LIVE_SELECTOR = ".two-company-dropdown__status";

describe("the company-search panel's live region", () => {
  let ctx;
  let ajax;

  beforeEach(() => {
    ctx = harness.loadTwoinc();
    harness.buildCheckoutForm();
    ajax = harness.stubAjax(ctx.$);
    jest.useFakeTimers();
    harness.openCompanyPanel(ctx.$, ctx.helper);
    ajax.calls.length = 0;
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    ajax.restore();
    harness.releasePanel(ctx.helper);
    document.body.innerHTML = "";
  });

  /**
   * @param {string} term
   */
  function typeQuery(term) {
    const query = document.querySelector(".two-company-dropdown__query");
    query.value = term;
    query.dispatchEvent(new window.Event("input", { bubbles: true }));
    jest.advanceTimersByTime(ctx.helper.companySearchDebounceMs);
  }

  /** The transport resolves a Promise, so its answer lands on a microtask. */
  function flushPromises() {
    return Promise.resolve().then(() => Promise.resolve());
  }

  /**
   * @param {number} count companies the search should answer with
   */
  async function searchReturning(count) {
    typeQuery("kaffe");
    const items = [];
    for (let i = 0; i < count; i++) {
      items.push({ name: "Example " + i, highlight: "Example " + i });
    }
    ajax.last().succeed({ items: items });
    await flushPromises();
  }

  /** @returns {string} what the region is currently saying */
  function announced() {
    // The write is deferred, so nothing is there until the delay elapses.
    jest.advanceTimersByTime(200);
    const region = document.querySelector(LIVE_SELECTOR);
    return region ? region.textContent : "";
  }

  /**
   * @param {string} key ArrowDown or ArrowUp
   */
  function pressKey(key) {
    const query = document.querySelector(".two-company-dropdown__query");
    query.dispatchEvent(new window.KeyboardEvent("keydown", { key: key, bubbles: true }));
  }

  describe("the region itself", () => {
    test.each([
      ["role", "status", "announced as a status region"],
      ["aria-live", "assertive", "interrupts, because the rows have already changed"],
      ["aria-relevant", "additions", "the added line is what is read, not a removal"]
    ])("carries %s=%s — %s", async (attribute, expected) => {
      await searchReturning(2);
      announced();

      expect(document.querySelector(LIVE_SELECTOR).getAttribute(attribute)).toBe(expected);
    });

    test("lives outside the panel, which carries `hidden` between opens", async () => {
      await searchReturning(2);
      announced();

      const region = document.querySelector(LIVE_SELECTOR);
      expect(region.parentElement).toBe(document.body);
      expect(region.closest(".two-company-dropdown")).toBeNull();
    });

    test("goes with the panel it belongs to", async () => {
      await searchReturning(2);
      announced();
      expect(document.querySelector(LIVE_SELECTOR)).not.toBeNull();

      ctx.helper.panel.destroy();

      expect(document.querySelector(LIVE_SELECTOR)).toBeNull();
    });
  });

  describe("what a search says", () => {
    test.each([
      [3, "3 results are available, use up and down arrow keys to navigate.", "a plural count"],
      [1, "1 result is available, use up and down arrow keys to navigate.", "a single match"],
      [0, "No matches found", "the no-matches copy, the same sentence the panel paints"]
    ])("%i rows announces %s — %s", async (count, expected) => {
      await searchReturning(count);

      expect(announced()).toBe(expected);
    });

    test("a repeat of the same answer is announced again", async () => {
      await searchReturning(2);
      announced();

      await searchReturning(2);

      const region = document.querySelector(LIVE_SELECTOR);
      expect(region.children).toHaveLength(1);
      expect(announced()).toBe("2 results are available, use up and down arrow keys to navigate.");
    });

    test.each([
      ["k", "one character"],
      ["ka", "two, still under the threshold"]
    ])("%s answers nothing, so nothing is announced — %s", (term) => {
      typeQuery(term);

      expect(ajax.calls).toHaveLength(0);
      expect(announced()).toBe("");
    });

    test("the search being down says so rather than reporting no matches", async () => {
      typeQuery("kaffe");
      ajax.last().fail("timeout");
      await flushPromises();

      expect(announced()).toBe("Company search is temporarily unavailable. Please try again.");
    });
  });

  describe("what arrow-key navigation says", () => {
    test.each([
      [["ArrowDown"], "Example 0", "the first row"],
      [["ArrowDown", "ArrowDown"], "Example 1", "the row moved onto"],
      [["ArrowDown", "ArrowUp"], "Example 0", "the row moved back to"]
    ])("%j announces %s — %s", async (keys, expected) => {
      await searchReturning(3);
      announced();

      keys.forEach(pressKey);

      expect(announced()).toBe(expected);
    });
  });

  describe("the query field says whether its list is showing", () => {
    test.each([
      [false, "false", "the panel is hidden, so it claims nothing"],
      [true, "true", "the panel is open"]
    ])("open=%s gives aria-expanded=%s — %s", (open, expected) => {
      if (!open) ctx.helper.closeCompanySearchDropdown();

      expect(
        document.querySelector(".two-company-dropdown__query").getAttribute("aria-expanded")
      ).toBe(expected);
    });
  });
});
