/**
 * ABN-554 — the popover's capture-mode chips are a keyboard destination, so the
 * focused one has to be identifiable. They carry the ring the payment-term
 * chips already carry; the theme resets the UA outline away, so without a rule
 * of the plugin's own the focused chip is indistinguishable.
 *
 * jsdom resolves `:focus-visible` in the cascade and reports the resulting
 * `outline`, so these are computed values rather than a reading of the
 * stylesheet text.
 */

"use strict";

const harness = require("./wc-harness");

const RING = "2px solid #3043d1";
const OFFSET = "2px";
const CHIP = ".two-company-mode-chip";
const SELECTED_CLASS = "two-company-mode-chip--selected";

const SOLE_TRADER_CONFIG = {
  enabled: "yes",
  tokens_url: "https://shop.example.test/?wc-ajax=two_sole_trader_tokens",
  text: {
    registered_business: "Registered company",
    sole_trader: "Sole trader",
    enter_manually: "Enter manually"
  }
};

describe("the popover's mode chips show where the keyboard is (ABN-554)", () => {
  let ctx;
  let $;
  let style;

  beforeEach(() => {
    ctx = harness.loadTwoinc({
      enable_company_search: "yes",
      enable_order_intent: "no",
      enable_address_lookup: "no",
      sole_trader: SOLE_TRADER_CONFIG
    });
    $ = ctx.$;
    harness.buildCheckoutForm();
    harness.stubAjax($);
    ctx.soleTrader.availabilityByCountry = { GB: true };
    style = harness.injectStylesheet();
    harness.openCompanyPanel($, ctx.helper);
  });

  afterEach(() => {
    style.remove();
    harness.releasePanel(ctx.helper);
    $(document.body).off();
    document.body.innerHTML = "";
    jest.restoreAllMocks();
  });

  /** The rendered chips, guarding against an empty row making this vacuous. */
  function chips() {
    const rendered = Array.prototype.slice.call(document.querySelectorAll(CHIP));
    expect(rendered.length).toBeGreaterThan(1);
    return rendered;
  }

  test.each([
    [true, "the selected chip, whose own blue fill the ring has to survive"],
    [false, "an unselected chip"]
  ])("a keyboard-focused chip is ringed: selected=%p (%s)", (selected) => {
    const chip = chips().find(function (candidate) {
      return candidate.classList.contains(SELECTED_CLASS) === selected;
    });

    expect(chip).toBeDefined();
    chip.focus();

    // Given the chip is where the keyboard landed
    expect(document.activeElement).toBe(chip);
    expect(chip.matches(":focus-visible")).toBe(true);
    // Then it is ringed, outside its own fill
    expect({
      outline: window.getComputedStyle(chip).outline,
      outlineOffset: window.getComputedStyle(chip).outlineOffset
    }).toEqual({ outline: RING, outlineOffset: OFFSET });
  });

  test("the ring is the payment-term chips', not a second style", () => {
    const term = document.createElement("button");
    term.className = "twoinc-term-chip";
    document.body.appendChild(term);
    term.focus();
    const termRing = window.getComputedStyle(term);

    const chip = chips()[0];
    chip.focus();
    const chipRing = window.getComputedStyle(chip);

    expect([chipRing.outline, chipRing.outlineOffset]).toEqual([
      termRing.outline,
      termRing.outlineOffset
    ]);
  });
});
