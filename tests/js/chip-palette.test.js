/**
 * ABN-589 — the four states of the two chip controls, read as computed style
 * off chips the shipped code rendered, on both checkout surfaces.
 *
 * jsdom has no pointer, so `:hover` never matches. The stylesheet is injected
 * with `:hover` swapped for an attribute selector of the same specificity,
 * which leaves the cascade, the source order and every declaration under test
 * exactly as shipped while letting a test choose the hovered chip.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const harness = require("./wc-harness");

const HOVER = "data-test-hover";

const GREY = "#e3e3e3";
const ACCENT = "#091030";
const WHITE = "#ffffff";

/**
 * The furniture each surface wraps the gateway's own markup in. A chip rule
 * anchored on one surface's ancestors silently stops matching on the other.
 */
const SURFACES = {
  classic: [
    '<div id="payment"><ul class="payment_methods methods">',
    '<li class="wc_payment_method payment_method_woocommerce-gateway-tillit">',
    '<div class="payment_box"></div></li></ul></div>'
  ].join(""),
  blocks: [
    '<div class="wc-block-checkout">',
    '<div class="wc-block-components-radio-control-accordion-content">',
    '<div class="twoinc-blocks-content"></div></div></div>'
  ].join("")
};

const TERMS = [30, 60];
const SELECTED_TERM = 30;

const SOLE_TRADER = {
  enabled: "yes",
  tokens_url: "https://shop.example.test/?wc-ajax=two_sole_trader_tokens",
  text: {
    registered_business: "Registered company",
    sole_trader: "Sole trader",
    enter_manually: "Enter manually"
  }
};

let ctx;
let style;

// jsdom reports a colour as written when it came from a shorthand and as
// `rgb()` when it came from a longhand, so every reading is canonicalised.
function toHex(value) {
  const channels = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (channels) {
    return (
      "#" +
      channels
        .slice(1, 4)
        .map((channel) => Number(channel).toString(16).padStart(2, "0"))
        .join("")
    );
  }

  const short = value.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (short) {
    return ("#" + short[1] + short[1] + short[2] + short[2] + short[3] + short[3]).toLowerCase();
  }

  return value.toLowerCase();
}

function injectStylesheet() {
  const css = fs
    .readFileSync(path.join(harness.REPO_ROOT, harness.STYLESHEET_PATH), "utf8")
    .replace(/:hover\b/g, "[" + HOVER + "]");
  const el = document.createElement("style");
  el.textContent = css;
  document.head.appendChild(el);
  return el;
}

/** @returns {Element} the leaf of the named surface's furniture, in the body */
function surfaceLeaf(surface) {
  document.body.insertAdjacentHTML("beforeend", SURFACES[surface]);
  const roots = document.querySelectorAll(".payment_box, .twoinc-blocks-content");
  return roots[roots.length - 1];
}

/** The payment-term chips, rendered into the containers the gateway emits. */
function mountTermChips(surface, terms, checked) {
  const offered = terms || TERMS;
  const chosen = checked === undefined ? offered[0] : checked;
  ctx = harness.loadTwoinc({
    payment_terms: {
      enabled: true,
      terms: offered,
      selected: chosen,
      days_label: "%s days",
      heading: "Selected payment terms"
    }
  });
  surfaceLeaf(surface).innerHTML =
    '<span class="twoinc-term-chips-heading hidden" id="twoinc-term-chips-heading"></span>' +
    '<div class="twoinc-term-chips hidden" role="radiogroup" aria-labelledby="twoinc-term-chips-heading"></div>';
  ctx.termChips.fees = {};
  ctx.termChips.feesLoaded = true;
  ctx.termChips.render(offered, chosen);

  return ".twoinc-term-chip";
}

/** The capture-mode chips, rendered by opening the company-search panel. */
function mountModeChips(surface) {
  ctx = harness.loadTwoinc({
    enable_company_search: "yes",
    enable_order_intent: "no",
    enable_address_lookup: "no",
    company_search_location: "address_area",
    sole_trader: SOLE_TRADER
  });
  harness.buildCheckoutForm();
  harness.stubAjax(ctx.$);
  ctx.soleTrader.availabilityByCountry = { GB: true };
  harness.openCompanyPanel(ctx.$, ctx.helper);
  surfaceLeaf(surface).appendChild(document.querySelector(".two-company-field-wrap"));

  return ".two-company-mode-chip";
}

const CONTROLS = {
  "payment-term chip": mountTermChips,
  "company-mode chip": mountModeChips
};

/**
 * @returns {{selected: Element, unselected: Element}} one chip in each state,
 *   guarding against an empty row making every assertion vacuous
 */
function chips(control, surface) {
  const selector = CONTROLS[control](surface);
  const rendered = Array.prototype.slice.call(document.querySelectorAll(selector));
  expect(rendered.length).toBeGreaterThan(1);

  const selected = rendered.filter((chip) => chip.className.indexOf("--selected") !== -1);
  expect(selected).toHaveLength(1);

  return {
    selected: selected[0],
    unselected: rendered.filter((chip) => chip !== selected[0])[0]
  };
}

/** @returns {Object} the chip's painted edge, fill and label */
function paint(chip) {
  const computed = window.getComputedStyle(chip);
  return {
    borderWidth: computed.borderTopWidth,
    borderColor: toHex(computed.borderTopColor),
    background: toHex(computed.backgroundColor),
    color: toHex(computed.color)
  };
}

/** @returns {number[]} the chip's outer size contributions, top then left */
function boxEdges(chip) {
  const computed = window.getComputedStyle(chip);
  return [
    parseFloat(computed.borderTopWidth) + parseFloat(computed.paddingTop),
    parseFloat(computed.borderLeftWidth) + parseFloat(computed.paddingLeft)
  ];
}

/** Every state the two chip controls have, and what each one paints. */
const STATES = [
  {
    which: "unselected",
    hovered: false,
    focused: false,
    borderWidth: "2px",
    borderColor: GREY,
    background: WHITE,
    color: ACCENT,
    case: "resting, a grey edge on white"
  },
  {
    which: "selected",
    hovered: false,
    focused: false,
    borderWidth: "2px",
    borderColor: ACCENT,
    background: ACCENT,
    color: WHITE,
    case: "chosen, a white label on a solid accent fill"
  },
  {
    which: "unselected",
    hovered: true,
    focused: false,
    borderWidth: "1px",
    borderColor: ACCENT,
    background: GREY,
    color: ACCENT,
    case: "the pointer over an unchosen chip"
  },
  {
    which: "selected",
    hovered: true,
    focused: false,
    borderWidth: "2px",
    borderColor: ACCENT,
    background: ACCENT,
    color: WHITE,
    case: "a chosen chip, inert under the pointer"
  },
  {
    which: "unselected",
    hovered: false,
    focused: true,
    borderWidth: "1px",
    borderColor: ACCENT,
    background: GREY,
    color: ACCENT,
    case: "the keyboard on an unchosen chip, reading as the pointer does"
  },
  {
    which: "selected",
    hovered: false,
    focused: true,
    borderWidth: "2px",
    borderColor: ACCENT,
    background: ACCENT,
    color: WHITE,
    case: "the keyboard on a chosen chip, which it leaves alone"
  },
  {
    which: "unselected",
    hovered: true,
    focused: true,
    borderWidth: "1px",
    borderColor: ACCENT,
    background: GREY,
    color: ACCENT,
    case: "pointer and keyboard together on an unchosen chip"
  },
  {
    which: "selected",
    hovered: true,
    focused: true,
    borderWidth: "2px",
    borderColor: ACCENT,
    background: ACCENT,
    color: WHITE,
    case: "pointer and keyboard together on a chosen chip, still untouched"
  }
];

beforeEach(() => {
  style = injectStylesheet();
});

afterEach(() => {
  style.remove();
  if (ctx && ctx.helper) {
    harness.releasePanel(ctx.helper);
    ctx.$(document.body).off();
  }
  ctx = null;
  document.body.innerHTML = "";
});

describe.each(Object.keys(CONTROLS))("the %s", (control) => {
  describe.each(Object.keys(SURFACES))("on the %s checkout", (surface) => {
    test.each(STATES)(
      "$case",
      ({ which, hovered, focused, borderWidth, borderColor, background, color }) => {
        const chip = chips(control, surface)[which];
        if (hovered) {
          chip.setAttribute(HOVER, "");
        }
        if (focused) {
          chip.focus();
          expect(document.activeElement).toBe(chip);
        }

        expect(paint(chip)).toEqual({ borderWidth, borderColor, background, color });
      }
    );

    test.each([
      { act: (chip) => chip.setAttribute(HOVER, ""), case: "the pointer" },
      { act: (chip) => chip.focus(), case: "the keyboard" }
    ])("the chip keeps its size when $case thins the border", ({ act }) => {
      const chip = chips(control, surface).unselected;
      const resting = boxEdges(chip);
      act(chip);

      expect(boxEdges(chip)).toEqual(resting);
    });

    test("a keyboard-focused chip is ringed in the accent", () => {
      const chip = chips(control, surface).unselected;
      chip.focus();
      const ring = window.getComputedStyle(chip).outline.split(" ");

      expect(chip.matches(":focus-visible")).toBe(true);
      expect([ring[0], ring[1], toHex(ring.slice(2).join(" "))]).toEqual(["2px", "solid", ACCENT]);
    });
  });
});

describe("the company-mode chips", () => {
  /**
   * TWO-40 — one chip carrying a hover fill of its own is what made it the one
   * the store could not colour, so the three have to hover as one.
   */
  test("every unchosen chip hovers identically", () => {
    mountModeChips("classic");
    const rendered = Array.prototype.slice.call(
      document.querySelectorAll(".two-company-mode-chip")
    );
    expect(rendered).toHaveLength(3);

    const unchosen = rendered.filter(
      (chip) => !chip.classList.contains("two-company-mode-chip--selected")
    );
    unchosen.forEach((chip) => chip.setAttribute(HOVER, ""));

    expect(unchosen.map(paint)).toEqual(
      unchosen.map(() => ({
        borderWidth: "1px",
        borderColor: ACCENT,
        background: GREY,
        color: ACCENT
      }))
    );
  });
});

describe("the sole payment-term chip", () => {
  test.each([
    {
      checked: 30,
      borderColor: ACCENT,
      background: ACCENT,
      color: WHITE,
      case: "chosen, as one offered term normally leaves it"
    },
    {
      checked: 60,
      borderColor: GREY,
      background: WHITE,
      color: ACCENT,
      case: "unchosen, when the stored term is not the one on offer"
    }
  ])("the disabled chip takes neither affordance: $case", (expected) => {
    mountTermChips("classic", [30], expected.checked);
    const chip = document.querySelector(".twoinc-term-chip");
    expect(chip.matches(":disabled")).toBe(true);

    const resting = paint(chip);
    chip.setAttribute(HOVER, "");
    chip.focus();

    expect(paint(chip)).toEqual(resting);
    expect(resting).toEqual({
      borderWidth: "2px",
      borderColor: expected.borderColor,
      background: expected.background,
      color: expected.color
    });
  });
});

/*
 * jsdom's `getComputedStyle` resolves a cascade by source order alone — it
 * ignores specificity entirely — so every computed-style test above measures
 * declarations and order, never which rule a browser would actually pick. This
 * closes that gap analytically: for each chip state it enumerates the rules the
 * chip matches and requires the highest-specificity setter of each contested
 * property to be unique, so no state is left for source order to decide.
 */
describe("the cascade over both chip controls", () => {
  /** Longhands a shorthand in this stylesheet also sets, so both contest it. */
  const LONGHANDS = {
    border: ["border-width", "border-style", "border-color"],
    padding: ["padding-top", "padding-right", "padding-bottom", "padding-left"],
    background: ["background-color", "background-image", "background-repeat"],
    outline: ["outline-width", "outline-style", "outline-color"]
  };

  const count = (text, pattern) => (text.match(pattern) || []).length;

  /** @returns {number} one comparable weight for a selector's specificity */
  function specificity(selector) {
    let ids = 0;
    let classes = 0;
    let types = 0;

    const rest = selector.replace(/:not\(([^)]*)\)/g, (whole, inner) => {
      ids += Math.floor(specificity(inner) / 10000);
      classes += Math.floor(specificity(inner) / 100) % 100;
      types += specificity(inner) % 100;
      return " ";
    });

    ids += count(rest, /#[\w-]+/g);
    classes +=
      count(rest, /\.[\w-]+/g) + count(rest, /\[[^\]]+\]/g) + count(rest, /(?<!:):[\w-]+/g);
    types += count(rest, /(?:^|[\s>+~])[a-zA-Z][\w-]*/g) + count(rest, /::[\w-]+/g);

    return ids * 10000 + classes * 100 + types;
  }

  /** @returns {Array<{property: string, weight: number}>} one entry per property a rule sets */
  function declarations(rule) {
    const body = rule.cssText.slice(rule.cssText.indexOf("{") + 1, rule.cssText.lastIndexOf("}"));
    const weight = specificity(rule.selectorText);

    return body
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .reduce((all, part) => {
        const property = part.slice(0, part.indexOf(":")).trim();
        // An `!important` declaration wins its own tier, so it never ties with a
        // normal one however specific that one is.
        const tier = /!important$/.test(part) ? weight + 1000000 : weight;
        return all.concat(
          (LONGHANDS[property] || [property]).map((name) => ({ property: name, weight: tier }))
        );
      }, []);
  }

  /** @returns {string[]} the properties this chip has more than one top setter for */
  function tiedProperties(chip) {
    const top = {};
    const tied = {};

    Array.prototype.forEach.call(style.sheet.cssRules, (rule) => {
      if (!rule.selectorText || !chip.matches(rule.selectorText)) return;
      declarations(rule).forEach(({ property, weight }) => {
        if (top[property] === undefined || weight > top[property]) {
          top[property] = weight;
          tied[property] = false;
        } else if (weight === top[property]) {
          tied[property] = true;
        }
      });
    });

    return Object.keys(tied)
      .filter((property) => tied[property])
      .sort();
  }

  describe.each(Object.keys(CONTROLS))("the %s", (control) => {
    test.each(STATES)("$case", ({ which, hovered, focused }) => {
      const chip = chips(control, "classic")[which];
      if (hovered) {
        chip.setAttribute(HOVER, "");
      }
      if (focused) {
        chip.focus();
      }

      expect(tiedProperties(chip)).toEqual([]);
    });
  });

  test("the disabled sole term chip, which the state rules deliberately skip", () => {
    mountTermChips("classic", [30]);
    const chip = document.querySelector(".twoinc-term-chip");
    chip.setAttribute(HOVER, "");

    expect(tiedProperties(chip)).toEqual([]);
  });
});
