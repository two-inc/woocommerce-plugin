/**
 * ABN-554 — closing the popover hands the buyer back to the company-name
 * field, and the field's own open-on-focus opener is held off for that one
 * programmatic focus alone.
 *
 * Two close paths deliberately leave focus alone, and both are asserted here:
 * the deferred close-on-focus-leave, which only fires once focus has settled on
 * another control (TWO-25326), and the sole-trader settle, which places focus
 * itself once the popup has gone (TWO-25658).
 *
 * jsdom CAVEAT: no sequential focus navigation, so a Tab arrival at the field
 * is a programmatic `focus()`. What a real browser adds is in the PR notes.
 */

"use strict";

const harness = require("./wc-harness");

const TEXT = {
  enter_manually: "Enter manually",
  search_company: "Search for company"
};

/** A visible, focusable host field outside the control. */
const OUTSIDE_FIELD = "#billing_country";

describe("closing the popover hands focus back to the company-name field", () => {
  let ctx;
  let $;
  let helper;
  let ajax;

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
    ajax = harness.stubAjax($);
  });

  afterEach(() => {
    ajax.restore();
    jest.clearAllTimers();
    jest.useRealTimers();
    harness.releasePanel(helper);
    document.body.innerHTML = "";
  });

  function displayField() {
    return document.querySelector("#billing_company_display");
  }

  function panelIsOpen() {
    return helper.companySearchDropdownIsOpen();
  }

  /** A page area with nothing focusable in it, so no default action places focus. */
  function backdrop() {
    if (!document.getElementById("two-test-backdrop")) {
      document.body.insertAdjacentHTML("beforeend", '<div id="two-test-backdrop">page</div>');
    }
    return document.getElementById("two-test-backdrop");
  }

  function dispatchMousedown(node) {
    node.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  }

  function pressKey(node, key) {
    node.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: key, bubbles: true, cancelable: true })
    );
  }

  /** Type into the query field and settle the search it dispatches. */
  function searchYielding(term, items) {
    const query = document.querySelector(".two-company-dropdown__query");
    query.value = term;
    query.dispatchEvent(new window.Event("input", { bubbles: true }));
    jest.advanceTimersByTime(helper.companySearchDebounceMs);
    ajax.last().succeed({ items: items });
    return Promise.resolve().then(() => Promise.resolve());
  }

  test.each([
    {
      drive: async () => {
        harness.openCompanyPanel($, helper);
        pressKey(document.querySelector(".two-company-dropdown__query"), "Escape");
      },
      description: "Escape inside the panel"
    },
    {
      drive: async () => {
        harness.openCompanyPanel($, helper);
        await searchYielding("example", [
          {
            name: "Example Trading Co",
            highlight: "<em>Example Trading Co</em>",
            national_identifier: { id: "11111111" }
          }
        ]);
        dispatchMousedown(document.querySelector(".two-company-dropdown__row"));
      },
      description: "a company adopted from the results"
    },
    {
      drive: async () => {
        harness.openCompanyPanel($, helper);
        helper.panel.releaseField();
      },
      description: "manual entry taking the field over"
    },
    {
      drive: async () => {
        harness.openCompanyPanel($, helper);
        helper.closeCompanySearchDropdown();
      },
      description: "the plugin closing it, as a completed sole-trader signup does"
    }
  ])("the panel is shut with focus on the field after $description", async ({ drive }) => {
    await drive();

    expect(panelIsOpen()).toBe(false);
    expect(document.activeElement).toBe(displayField());
    // Manual entry hands the field back as a plain input and takes the combobox
    // attributes with it; every other path leaves `false`.
    expect(displayField().getAttribute("aria-expanded")).not.toBe("true");
  });

  test.each([
    {
      reopen: () => pressKey(displayField(), "a"),
      description: "any keydown on the field"
    },
    {
      reopen: () => dispatchMousedown(displayField()),
      description: "a pointer press on the field"
    },
    {
      reopen: () => {
        document.querySelector(OUTSIDE_FIELD).focus();
        displayField().focus();
      },
      description: "focus arriving at the field from elsewhere, as a Tab back does"
    }
  ])("the popover comes back on $description", ({ reopen }) => {
    harness.openCompanyPanel($, helper);
    pressKey(document.querySelector(".two-company-dropdown__query"), "Escape");
    expect(panelIsOpen()).toBe(false);

    reopen();

    expect(panelIsOpen()).toBe(true);
    expect(displayField().getAttribute("aria-expanded")).toBe("true");
  });

  /**
   * The press's own default action runs after the panel's handler: it focuses
   * whatever it hit, or clears focus where it hit nothing focusable. jsdom
   * performs neither, so each case plays the browser's part explicitly — which
   * is also what makes the two cases distinguishable at all.
   */
  test.each([
    {
      settleFocus: () => document.querySelector(OUTSIDE_FIELD).focus(),
      expected: () => document.querySelector(OUTSIDE_FIELD),
      description: "a press on another control leaves focus on that control"
    },
    {
      settleFocus: () => document.activeElement.blur(),
      expected: () => displayField(),
      description: "a press on anything unfocusable hands focus to the company field"
    }
  ])("$description", async ({ settleFocus, expected }) => {
    harness.openCompanyPanel($, helper);

    dispatchMousedown(backdrop());
    settleFocus();
    jest.advanceTimersByTime(1);

    expect(panelIsOpen()).toBe(false);
    expect(document.activeElement).toBe(expected());
  });

  test("focus settling outside the control closes the panel and leaves that control alone", () => {
    harness.openCompanyPanel($, helper);
    const next = document.querySelector(OUTSIDE_FIELD);

    next.focus();
    document
      .querySelector(".two-company-dropdown")
      .dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));
    jest.advanceTimersByTime(1);

    expect(panelIsOpen()).toBe(false);
    expect(document.activeElement).toBe(next);
  });

  test.each([
    { open: false, expected: "false", description: "shut" },
    { open: true, expected: "true", description: "open" }
  ])("aria-expanded is $expected while the popover is $description", ({ open, expected }) => {
    helper.attach();
    if (open) {
      helper.openCompanySearchDropdown();
    }

    expect(displayField().getAttribute("aria-expanded")).toBe(expected);
  });
});
