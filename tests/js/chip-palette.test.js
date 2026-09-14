/**
 * ABN-589 — every state of the two chip controls, read as computed style off
 * chips the shipped code rendered.
 *
 * jsdom has no pointer, so `:hover` never matches. The stylesheet is injected
 * with `:hover` swapped for an attribute selector of the same specificity,
 * which leaves the cascade, the source order and every declaration under test
 * exactly as shipped while letting a test choose the hovered chip.
 *
 * The chips are mounted under each checkout's ancestors, which proves the rules
 * are ancestor-independent — not that either checkout renders. The mode chips
 * are moved under those ancestors after the panel has built them, since the
 * harness mounts a classic form either way.
 *
 * The cascade audit at the foot of this file covers CONTESTED properties: those
 * more than one rule matching the chip sets. A property no shipped rule sets is
 * outside it, so a rule introducing one — a `transform`, say — passes unseen.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const harness = require("./wc-harness");

const HOVER = "data-test-hover";

const GREY = "#e3e3e3";
const ACCENT = "#091030";
const WHITE = "#ffffff";

/** The furniture each checkout wraps the gateway's own markup in. */
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

/** The containers the gateway description emits, read from the source of them. */
const TERM_CHIP_CONTAINERS = (() => {
  const php = fs.readFileSync(path.join(harness.REPO_ROOT, "class", "WC_Twoinc.php"), "utf8");
  const emitted = php.match(
    /<span class="twoinc-term-chips-heading[^>]*><\/span>\s*<div class="twoinc-term-chips[^>]*><\/div>/
  );

  if (!emitted) {
    throw new Error("the gateway description no longer emits the term-chip containers");
  }

  return emitted[0];
})();

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
  surfaceLeaf(surface).innerHTML = TERM_CHIP_CONTAINERS;
  ctx.termChips.fees = {};
  ctx.termChips.feesLoaded = true;
  ctx.termChips.render(offered, chosen);
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
}

/**
 * The shipped selectors each control is styled by, spelled as the stylesheet
 * spells them. The cascade audit names one of these as the winner it expects
 * for every contested property, so a rule that out-specifies the intended one
 * fails rather than passing for being unique.
 */
const TERM = {
  base: ".twoinc-term-chip",
  chosen: ".twoinc-term-chip.twoinc-term-chip--selected",
  state:
    ".twoinc-term-chip:not(.twoinc-term-chip--selected):not(:disabled):hover, " +
    ".twoinc-term-chip:not(.twoinc-term-chip--selected):not(:disabled):focus",
  sole: ".twoinc-term-chip.twoinc-term-chip--single"
};

const MODE = {
  base: ".two-company-mode-chip",
  chosen: ".two-company-mode-chip.two-company-mode-chip--selected",
  state:
    ".two-company-mode-chip:not(.two-company-mode-chip--selected):hover, " +
    ".two-company-mode-chip:not(.two-company-mode-chip--selected):focus"
};

/** @returns {Object} every property mapped to the selector expected to win it */
const winners = (selector, properties) =>
  properties.reduce((all, property) => Object.assign(all, { [property]: selector }), {});

const CONTROLS = {
  "payment-term chip": {
    mount: mountTermChips,
    selector: TERM.base,
    // The base rule paints with the `background` shorthand, so the chosen rule
    // has to out-rank it on every longhand that shorthand also sets.
    chosen: winners(TERM.chosen, [
      "background-color",
      "background-image",
      "background-repeat",
      "border-color",
      "color"
    ]),
    state: winners(TERM.state, [
      "background-color",
      "background-image",
      "background-repeat",
      "border-color",
      "border-style",
      "border-width",
      "color",
      "padding-bottom",
      "padding-left",
      "padding-right",
      "padding-top"
    ])
  },
  "company-mode chip": {
    mount: mountModeChips,
    selector: MODE.base,
    chosen: winners(MODE.chosen, ["background-color", "border-color", "color"]),
    state: winners(MODE.state, [
      "background-color",
      "border-color",
      "border-style",
      "border-width",
      "color",
      "padding-bottom",
      "padding-left",
      "padding-right",
      "padding-top"
    ])
  }
};

/**
 * @returns {{selected: Element, unselected: Element}} one chip in each state,
 *   guarding against an empty row making every assertion vacuous
 */
function chips(control, surface) {
  CONTROLS[control].mount(surface);
  const rendered = Array.prototype.slice.call(
    document.querySelectorAll(CONTROLS[control].selector)
  );
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
  describe.each(Object.keys(SURFACES))("under %s checkout ancestors", (surface) => {
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

    // jsdom focuses a disabled button where a browser refuses to, so the
    // `:focus` arm's `:not(:disabled)` is genuinely exercised here.
    expect(document.activeElement).toBe(chip);
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
 * closes that gap analytically: for each chip state it names the selector that
 * must win every contested property, so a rule that out-specifies the intended
 * one fails, and so does one that merely ties with it.
 */
describe("the cascade over both chip controls", () => {
  /** Longhands a shorthand in this stylesheet also sets, so both contest them. */
  const LONGHANDS = {
    border: ["border-width", "border-style", "border-color"],
    padding: ["padding-top", "padding-right", "padding-bottom", "padding-left"],
    background: ["background-color", "background-image", "background-repeat"],
    outline: ["outline-width", "outline-style", "outline-color"]
  };

  const count = (text, pattern) => (text.match(pattern) || []).length;

  /** @returns {string} the text between the parenthesis at `open` and its partner */
  function balanced(selector, open) {
    let depth = 0;

    for (let at = open; at < selector.length; at += 1) {
      if (selector[at] === "(") depth += 1;
      if (selector[at] === ")") {
        depth -= 1;
        if (depth === 0) return selector.slice(open + 1, at);
      }
    }

    throw new Error("unbalanced parenthesis in selector: " + selector);
  }

  /** @returns {string[]} one entry per comma-separated arm of a selector list */
  function arms(selector) {
    const found = [];
    let depth = 0;
    let from = 0;

    for (let at = 0; at < selector.length; at += 1) {
      const character = selector[at];
      if (character === "(" || character === "[") depth += 1;
      else if (character === ")" || character === "]") depth -= 1;
      else if (character === "," && depth === 0) {
        found.push(selector.slice(from, at));
        from = at + 1;
      }
    }

    return found
      .concat(selector.slice(from))
      .map((arm) => arm.trim())
      .filter(Boolean);
  }

  /** Refuses anything this scorer would otherwise mis-score in silence. */
  function refuseUnsupported(arm) {
    if (/:(is|where|has)\(/.test(arm)) {
      throw new Error("selector needs a real specificity engine: " + arm);
    }

    if (/\[[^\]]*["']/.test(arm)) {
      throw new Error("quoted attribute value would be read as a combinator: " + arm);
    }

    for (let at = arm.indexOf(":not("); at !== -1; at = arm.indexOf(":not(", at + 5)) {
      const inner = balanced(arm, at + 4);
      if (inner.indexOf(":not(") !== -1 || arms(inner).length > 1) {
        throw new Error("nested or multi-argument :not() is not scored here: " + arm);
      }
    }
  }

  /** @returns {number} one comparable weight for a single selector arm */
  function specificity(arm) {
    refuseUnsupported(arm);

    let ids = 0;
    let classes = 0;
    let types = 0;

    const rest = arm.replace(/:not\(([^)]*)\)/g, (whole, inner) => {
      const inside = specificity(inner);
      ids += Math.floor(inside / 10000);
      classes += Math.floor(inside / 100) % 100;
      types += inside % 100;
      return " ";
    });

    ids += count(rest, /#[\w-]+/g);
    classes +=
      count(rest, /\.[\w-]+/g) + count(rest, /\[[^\]]+\]/g) + count(rest, /(?<!:):[\w-]+/g);
    types += count(rest, /(?:^|[\s>+~])[a-zA-Z][\w-]*/g) + count(rest, /::[\w-]+/g);

    return ids * 10000 + classes * 100 + types;
  }

  /** The selector as the stylesheet spells it, with the hover stand-in undone. */
  const asShipped = (selectorText) =>
    selectorText.replace(new RegExp("\\[" + HOVER + "\\]", "g"), ":hover").replace(/\s+/g, " ");

  /** @returns {Array<{property: string, important: boolean}>} what a rule sets */
  function declarations(rule) {
    const body = rule.cssText.slice(rule.cssText.indexOf("{") + 1, rule.cssText.lastIndexOf("}"));

    return body
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .reduce((all, part) => {
        const property = part.slice(0, part.indexOf(":")).trim();
        const important = /!important$/.test(part);
        return all.concat(
          (LONGHANDS[property] || [property]).map((name) => ({ property: name, important }))
        );
      }, []);
  }

  /**
   * @returns {Object} every property more than one matching rule sets, mapped to
   *   the selector that wins it — or to the tie, spelled out, where none does.
   */
  /** @returns {string[]} every property named anywhere inside a rule's text */
  const propertiesIn = (rule) =>
    (rule.cssText.match(/[-a-z]+(?=\s*:)/g) || []).reduce(
      (all, property) => all.concat(LONGHANDS[property] || [property]),
      []
    );

  function cascadeWinners(chip) {
    const setters = {};
    const styleRules = [];
    const keyframes = [];

    Array.prototype.forEach.call(style.sheet.cssRules, (rule) => {
      if (rule.type === CSSRule.KEYFRAMES_RULE) keyframes.push(rule);
      else if (rule.type === CSSRule.STYLE_RULE) styleRules.push(rule);
      // Anything else would be dropped in silence, which is how a rule inside
      // `@media` goes unseen.
      else throw new Error("the audit cannot read a " + rule.constructor.name);
    });

    styleRules.forEach((rule) => {
      const matched = arms(rule.selectorText).filter((arm) => chip.matches(arm));
      if (!matched.length) return;

      const weight = Math.max.apply(null, matched.map(specificity));
      declarations(rule).forEach(({ property, important }) => {
        setters[property] = (setters[property] || []).concat({
          // An `!important` declaration wins its own tier, whatever out-specifies it.
          weight: important ? weight + 1000000 : weight,
          label: asShipped(rule.selectorText) + (important ? " !important" : "")
        });
      });
    });

    // An animation outranks every normal author declaration, and
    // `animation-fill-mode: forwards` keeps its last frame after the run, so a
    // `@keyframes` block is only harmless while it cannot reach this chip.
    const animated = setters.animation || setters["animation-name"];
    keyframes.forEach((rule) => {
      if (animated && propertiesIn(rule).some((property) => setters[property])) {
        throw new Error("@keyframes " + rule.name + " can repaint this chip");
      }
    });

    return Object.keys(setters)
      .filter((property) => setters[property].length > 1)
      .sort()
      .reduce((all, property) => {
        const top = Math.max.apply(
          null,
          setters[property].map((setter) => setter.weight)
        );
        const at = setters[property]
          .filter((setter) => setter.weight === top)
          .map((setter) => setter.label);
        return Object.assign(all, {
          [property]: at.length === 1 ? at[0] : "tie between " + at.sort().join(" | ")
        });
      }, {});
  }

  test("a selector list is scored one arm at a time, not summed", () => {
    expect(arms(".a:hover, .b").map(specificity)).toEqual([200, 100]);
  });

  test.each([
    { selector: ".x:is(.a.b.c)", case: ":is()" },
    { selector: ".x:where(.a)", case: ":where(), which weighs nothing" },
    { selector: ".x:has(.a)", case: ":has()" },
    { selector: '.x[data-y="a b"]', case: "a quoted attribute value" },
    { selector: ".x:not(:not(.y))", case: "a nested :not()" },
    { selector: ".x:not(a, .b)", case: "a multi-argument :not()" }
  ])("the scorer refuses $case rather than score it wrong in silence", ({ selector }) => {
    expect(() => specificity(selector)).toThrow();
  });

  describe.each(Object.keys(CONTROLS))("the %s", (control) => {
    test.each(STATES)("$case", ({ which, hovered, focused }) => {
      const chip = chips(control, "classic")[which];
      if (hovered) {
        chip.setAttribute(HOVER, "");
      }
      if (focused) {
        chip.focus();
      }

      const expected = which === "selected" ? CONTROLS[control].chosen : CONTROLS[control].state;

      expect(cascadeWinners(chip)).toEqual(
        hovered || focused || which === "selected" ? expected : {}
      );
    });
  });

  test.each([
    { checked: 30, chosen: true, case: "chosen, as one offered term normally leaves it" },
    { checked: 60, chosen: false, case: "unchosen, when the stored term is not the one on offer" }
  ])("the disabled sole term chip, which the state rule skips: $case", ({ checked, chosen }) => {
    mountTermChips("classic", [30], checked);
    const chip = document.querySelector(".twoinc-term-chip");
    chip.setAttribute(HOVER, "");
    chip.focus();

    expect(cascadeWinners(chip)).toEqual(
      Object.assign({ cursor: TERM.sole }, chosen ? CONTROLS["payment-term chip"].chosen : {})
    );
  });
});
