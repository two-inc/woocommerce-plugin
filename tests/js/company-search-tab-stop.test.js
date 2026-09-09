/**
 * Company-search tab stop (TWO-25503, ABN-499).
 *
 * The company field opens the popover on focus and the opener puts the caret
 * in the popover's query input. Left as a tab stop, the field catches Shift+Tab
 * coming back out of the query and pushes focus forward again, and the two
 * adjacent controls oscillate — WCAG 2.1.2. So while the popover is open the
 * field carries `tabindex="-1"`, and on close its PRIOR value is restored: no
 * platform writes a tabindex onto that field, so the restore that actually runs
 * is removing the attribute again.
 *
 * NOT COVERED HERE, AND NOT COVERABLE HERE: the keyboard traversal itself.
 * jsdom implements no sequential focus navigation, so a `Tab` or Shift+Tab
 * `KeyboardEvent` moves focus nowhere in either direction and neither the
 * presence nor the absence of a trap is observable. Everything below asserts
 * the state the browser derives tab order FROM — `tabindex` on the field,
 * `hidden` on the panel, document order of the parts. A green run of this file
 * is never evidence that a keyboard trap is absent; that needs a real browser.
 */

"use strict";

const harness = require("./wc-harness");

const TEXT = {
  enter_manually: "Enter manually",
  search_company: "Search for company"
};

/**
 * A visible, focusable field of the host's outside the control. The real
 * `#billing_company` is NOT that: company search hides its row, so a buyer can
 * never put focus there and an assertion that focus settled on it is fiction
 * jsdom happens to allow (ABN-499).
 */
const OUTSIDE_FIELD = "#billing_country";

describe("company-search tab stop", () => {
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

  /** @returns {Element} the display field the panel binds its openers to */
  function displayField() {
    return document.querySelector("#billing_company_display");
  }

  /** @returns {Element} the host field outside the control */
  function outsideField() {
    return document.querySelector(OUTSIDE_FIELD);
  }

  /** @returns {Array<Element>} the control's parts, in document order */
  function controlNodes() {
    return [
      displayField(),
      document.querySelector(".two-company-dropdown__query"),
      document.querySelector(".two-company-dropdown__results"),
      document.querySelector(".two-company-mode-chips")
    ];
  }

  function pressEscape() {
    document
      .querySelector(".two-company-dropdown__query")
      .dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
      );
  }

  function clickOutside() {
    outsideField().dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
  }

  function focusSettlesOutside() {
    outsideField().focus();
    document
      .querySelector(".two-company-dropdown")
      .dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));
    jest.advanceTimersByTime(1);
  }

  test("an open panel leaves no tab stop on the field it opened from", () => {
    harness.openCompanyPanel($, helper);

    expect(displayField().getAttribute("tabindex")).toBe("-1");
  });

  test.each([
    { prior: null, restored: null, description: "no tabindex, which is what a platform ships" },
    { prior: "7", restored: "7", description: "a tabindex the theme set, given back exactly" }
  ])("closing restores the field's prior tab stop — $description", ({ prior, restored, description }) => {
    helper.attach();
    if (prior !== null) displayField().setAttribute("tabindex", prior);

    helper.openCompanySearchDropdown();
    expect(displayField().getAttribute("tabindex")).toBe("-1");

    helper.closeCompanySearchDropdown();

    expect({ description: description, tabindex: displayField().getAttribute("tabindex") }).toEqual(
      { description: description, tabindex: restored }
    );
  });

  test.each([
    { close: () => helper.closeCompanySearchDropdown(), description: "the panel's own close" },
    { close: pressEscape, description: "Escape, which also hands focus back to the field" },
    { close: clickOutside, description: "a mousedown outside the panel" },
    { close: focusSettlesOutside, description: "focus settling outside the control" },
    { close: () => helper.panel.destroy(), description: "teardown while still open" }
  ])("the tab stop comes back on every route out — $description", ({ close, description }) => {
    helper.attach();
    expect(displayField().hasAttribute("tabindex")).toBe(false);

    helper.openCompanySearchDropdown();
    expect(displayField().getAttribute("tabindex")).toBe("-1");

    close();

    expect({ description: description, tabindex: displayField().getAttribute("tabindex") }).toEqual(
      { description: description, tabindex: null }
    );
  });

  test("a throwing host abort still leaves the field with its tab stop back", () => {
    helper.attach();
    const transport = helper.panel.search;
    helper.panel.search = Object.assign({}, transport, {
      abortActiveRequest() {
        throw new Error("host transport is broken");
      }
    });

    try {
      helper.openCompanySearchDropdown();
      expect(displayField().getAttribute("tabindex")).toBe("-1");

      // Positive control: the throw has to reach the caller, or the release is
      // being asserted on an ordinary close.
      expect(() => helper.closeCompanySearchDropdown()).toThrow("host transport is broken");

      expect(displayField().hasAttribute("tabindex")).toBe(false);
    } finally {
      // afterEach destroys the panel, which calls the same host member.
      helper.panel.search = transport;
    }
  });

  test("a second open/close cycle restores the same state as the first", () => {
    helper.attach();

    for (let cycle = 0; cycle < 2; cycle++) {
      helper.openCompanySearchDropdown();
      expect(displayField().getAttribute("tabindex")).toBe("-1");
      helper.closeCompanySearchDropdown();
      expect(displayField().hasAttribute("tabindex")).toBe(false);
    }
  });

  /**
   * The host re-renders its own container while the panel is open: the wrapper
   * goes, and the field either survives or comes back from the host's template.
   *
   * @param {boolean} keepField
   */
  function hostReRender(keepField) {
    const field = displayField();
    const wrap = field.parentElement;
    let next = field;
    if (!keepField) {
      next = document.createElement("input");
      next.type = "text";
      next.id = field.id;
    }
    wrap.parentNode.insertBefore(next, wrap);
    wrap.remove();
    helper.attach();
  }

  test.each([
    { keepField: true, description: "keeping the field node" },
    { keepField: false, description: "re-rendering the field too" }
  ])(
    "a host re-render while open leaves the field closed, not stranded — $description",
    ({ keepField, description }) => {
      harness.openCompanyPanel($, helper);
      expect(displayField().getAttribute("tabindex")).toBe("-1");

      hostReRender(keepField);

      // Positive control: the re-render has to have cost the panel its wrapper,
      // or this exercises adoption instead of construction.
      expect(document.querySelector(".two-company-dropdown").hasAttribute("hidden")).toBe(true);
      expect({
        description: description,
        tabindex: displayField().getAttribute("tabindex"),
        expanded: displayField().getAttribute("aria-expanded")
      }).toEqual({ description: description, tabindex: null, expanded: "false" });
    }
  );

  test("the panel carries `hidden` while closed, which is what keeps its parts out of the tab order", () => {
    helper.attach();
    const panel = document.querySelector(".two-company-dropdown");

    expect(panel.hasAttribute("hidden")).toBe(true);

    helper.openCompanySearchDropdown();
    expect(panel.hasAttribute("hidden")).toBe(false);

    helper.closeCompanySearchDropdown();
    expect(panel.hasAttribute("hidden")).toBe(true);
  });

  test("the control's parts sit in reading order inside the field's own wrapper", () => {
    helper.attach();

    const parts = controlNodes();
    parts.forEach((node) => expect(node).not.toBeNull());
    for (let i = 0; i < parts.length - 1; i++) {
      // DOCUMENT_POSITION_FOLLOWING.
      expect(parts[i].compareDocumentPosition(parts[i + 1]) & 4).toBeTruthy();
    }
    const wrap = document.querySelector(".two-company-field-wrap");
    parts.slice(1).forEach((node) => expect(wrap.contains(node)).toBe(true));
  });

  test("Escape closes the panel and hands focus back to the field", () => {
    harness.openCompanyPanel($, helper);

    pressEscape();

    expect(helper.companySearchDropdownIsOpen()).toBe(false);
    expect(document.activeElement).toBe(displayField());
    // The field's own focus opener must not reopen what Escape just closed.
    jest.advanceTimersByTime(1000);
    expect(helper.companySearchDropdownIsOpen()).toBe(false);
  });

  test("focus the buyer moved out of the control is not taken back by a timer", () => {
    harness.openCompanyPanel($, helper);
    expect(document.activeElement).toBe(document.querySelector(".two-company-dropdown__query"));

    outsideField().focus();
    jest.advanceTimersByTime(5000);

    expect(document.activeElement).toBe(outsideField());
  });

  test("a results re-render does not pull focus back into the panel", async () => {
    harness.openCompanyPanel($, helper);
    const ajax = harness.stubAjax($);
    const query = document.querySelector(".two-company-dropdown__query");
    query.value = "example";
    query.dispatchEvent(new window.Event("input", { bubbles: true }));
    jest.advanceTimersByTime(helper.companySearchDebounceMs);

    outsideField().focus();
    ajax.last().succeed({ items: [{ name: "Example Co", highlight: "Example Co" }] });
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(2000);

    // Positive control: a fixture that rendered no rows would satisfy the
    // focus assertion without exercising the re-render at all.
    expect(document.querySelectorAll(".two-company-dropdown__row")).toHaveLength(1);
    expect(document.activeElement).toBe(outsideField());
    ajax.restore();
  });
});
