/**
 * ABN-561. A chip activation rebuilds the whole chip row, so the chip the buyer
 * was on is destroyed and focus falls to `<body>`. The rebuild hands focus to
 * the company field, but only where it actually disconnected the focused node —
 * an unconditional move would take focus off whatever the buyer was legitimately
 * using.
 *
 * jsdom has no sequential focus navigation and no layout, so these assertions
 * read `document.activeElement` after driving the rebuild directly. They say
 * nothing about tab order, and nothing about whether a real browser would accept
 * a focus call on an element the stylesheet has hidden.
 */

"use strict";

const harness = require("./wc-harness");

describe("focus when the chip row is rebuilt", () => {
  let ctx;
  let field;
  let panel;

  beforeEach(() => {
    ctx = harness.loadTwoinc();
    harness.buildCheckoutForm();
    ctx.$("#billing_company_display_field").removeClass("hidden");
    ctx.helper.attach();
    ctx.helper.openCompanySearchDropdown();
    field = document.querySelector("#billing_company_display");
    panel = ctx.helper.panel;
  });

  afterEach(() => {
    harness.releasePanel(ctx.helper);
    document.body.innerHTML = "";
  });

  test.each([
    {
      pickTarget: () => document.querySelector(".two-company-mode-chip"),
      keepsFocus: false,
      description: "a chip the rebuild destroys hands focus to the company field"
    },
    {
      pickTarget: () => document.querySelector(".two-company-dropdown__query"),
      keepsFocus: true,
      description: "the query field is inside the panel and survives, so it keeps focus"
    },
    {
      pickTarget: () => document.querySelector("#billing_country"),
      keepsFocus: true,
      description: "focus outside the panel is left where the buyer put it"
    },
    {
      pickTarget: () => {
        const host = document.querySelector(".two-company-mode-chips");
        host.setAttribute("tabindex", "-1");
        return host;
      },
      keepsFocus: true,
      description: "the chips host encloses the chips but is not disconnected, so focus stays"
    }
  ])("$description", ({ pickTarget, keepsFocus }) => {
    const target = pickTarget();
    target.focus();
    expect(document.activeElement).toBe(target);

    panel.syncChips();

    expect(document.activeElement).toBe(keepsFocus ? target : field);
  });

  test("the handover leaves the panel open", () => {
    jest.useFakeTimers();
    try {
      document.querySelector(".two-company-mode-chip").focus();
      panel.syncChips();
      jest.runAllTimers();
    } finally {
      jest.useRealTimers();
    }

    expect(panel.isOpen()).toBe(true);
  });
});
