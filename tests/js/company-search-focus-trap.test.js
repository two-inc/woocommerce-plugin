/**
 * Company-search focus trap (TWO-25288 follow-up, re-pinned for TWO-25503).
 *
 * The panel is a child of the company field's own wrapper, so the browser's
 * native tab order walks field -> query -> results -> chips with no key
 * handling of the plugin's own, and `hidden` on the closed panel keeps every
 * one of those out of the tab order until the buyer opens it.
 *
 * So the subject is unchanged — the buyer's own navigation wins — but it is now
 * satisfied by structure, and that is what these assert.
 */

"use strict";

const harness = require("./wc-harness");

const TEXT = {
  enter_manually: "Enter manually",
  search_company: "Search for company"
};

describe("company-search focus trap", () => {
  let ctx;
  let $;
  let helper;

  beforeEach(() => {
    jest.useFakeTimers();
    ctx = harness.loadTwoinc({
      text: TEXT,
      enable_company_search: "yes",
      enable_address_lookup: "no"
    });
    $ = ctx.$;
    helper = ctx.helper;
    harness.buildCheckoutForm();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    harness.releasePanel(helper);
    document.body.innerHTML = "";
  });

  /** @returns {Array<Element>} the control's parts, in document order */
  function controlNodes() {
    return [
      document.querySelector("#billing_company_display"),
      document.querySelector(".two-company-dropdown__query"),
      document.querySelector(".two-company-dropdown__results"),
      document.querySelector(".two-company-mode-chips")
    ];
  }

  test("tabbing away from an open panel keeps focus on the field the buyer tabbed to", () => {
    harness.openCompanyPanel($, helper);

    const query = document.querySelector(".two-company-dropdown__query");
    expect(document.activeElement).toBe(query);

    $("#billing_company").get(0).focus();
    expect(document.activeElement).toBe($("#billing_company").get(0));

    // Nothing may schedule a focus nudge behind the buyer's back.
    jest.advanceTimersByTime(5000);

    expect(document.activeElement).toBe($("#billing_company").get(0));
  });

  test("a results re-render does not pull focus back into the panel", async () => {
    harness.openCompanyPanel($, helper);
    const ajax = harness.stubAjax($);
    const query = document.querySelector(".two-company-dropdown__query");
    query.value = "example";
    query.dispatchEvent(new window.Event("input", { bubbles: true }));
    jest.advanceTimersByTime(helper.companySearchDebounceMs);

    $("#billing_company").get(0).focus();
    ajax.last().succeed({ items: [{ name: "Example Co", highlight: "Example Co" }] });
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(2000);

    // Positive control: a fixture that rendered no rows would satisfy the
    // focus assertion without exercising the re-render at all.
    expect(document.querySelectorAll(".two-company-dropdown__row")).toHaveLength(1);
    expect(document.activeElement).toBe($("#billing_company").get(0));
    ajax.restore();
  });

  test("the whole control is one contiguous run, in reading order", () => {
    helper.attach();

    const stops = controlNodes();
    stops.forEach((node) => expect(node).not.toBeNull());
    for (let i = 0; i < stops.length - 1; i++) {
      // DOCUMENT_POSITION_FOLLOWING.
      expect(stops[i].compareDocumentPosition(stops[i + 1]) & 4).toBeTruthy();
    }
    // Nothing of the control sits outside the wrapper the field is in.
    const wrap = document.querySelector(".two-company-field-wrap");
    stops.slice(1).forEach((node) => expect(wrap.contains(node)).toBe(true));
  });

  test("a closed panel is out of the tab order entirely", () => {
    helper.attach();
    const panel = document.querySelector(".two-company-dropdown");

    expect(panel.hasAttribute("hidden")).toBe(true);

    helper.openCompanySearchDropdown();
    expect(panel.hasAttribute("hidden")).toBe(false);

    helper.closeCompanySearchDropdown();
    expect(panel.hasAttribute("hidden")).toBe(true);
  });

  test("Escape closes the panel and hands focus back to the field", () => {
    harness.openCompanyPanel($, helper);
    const query = document.querySelector(".two-company-dropdown__query");

    query.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
    );

    expect(helper.companySearchDropdownIsOpen()).toBe(false);
    expect(document.activeElement).toBe(document.querySelector("#billing_company_display"));
    // The field's own focus opener must not reopen what Escape just closed.
    jest.advanceTimersByTime(1000);
    expect(helper.companySearchDropdownIsOpen()).toBe(false);
  });

  test("Tab is left to the browser — the panel binds no Tab handling", () => {
    harness.openCompanyPanel($, helper);
    const query = document.querySelector(".two-company-dropdown__query");
    const tab = new window.KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true
    });

    query.dispatchEvent(tab);

    expect(tab.defaultPrevented).toBe(false);
    expect(helper.companySearchDropdownIsOpen()).toBe(true);
  });
});
