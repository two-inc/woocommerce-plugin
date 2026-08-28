/**
 * TWO-25503. The company-capture control's DOM SHAPE, pinned against
 * PrestaShop's.
 *
 * Structure is the requirement here, not behaviour: because the panel is a
 * real child of the field's own wrapper rather than a layer appended to
 * `<body>`, the browser's native tab order satisfies the keyboard contract
 * with no key handling at all. A regression that reproduced the behaviour some
 * other way would still be the wrong control, so these assertions read the
 * nesting directly.
 */

"use strict";

const harness = require("./wc-harness");

describe("company-capture panel structure", () => {
  let ctx;

  beforeEach(() => {
    ctx = harness.loadTwoinc();
    harness.buildCheckoutForm();
    ctx.$("#billing_company_display_field").removeClass("hidden");
  });

  afterEach(() => {
    harness.releasePanel(ctx.helper);
    document.body.innerHTML = "";
  });

  test("the panel is a child of the field's own wrapper, never of <body>", () => {
    ctx.helper.attach();

    const field = document.querySelector("#billing_company_display");
    const wrap = field.parentElement;
    expect(wrap.classList.contains("two-company-field-wrap")).toBe(true);

    const panels = document.querySelectorAll(".two-company-dropdown");
    expect(panels).toHaveLength(1);
    expect(panels[0].parentElement).toBe(wrap);
    expect(document.body.querySelector(":scope > .two-company-dropdown")).toBeNull();
  });

  test("the panel has exactly three direct children, in PrestaShop's order", () => {
    ctx.helper.attach();

    const structure = harness.panelStructure();
    expect(structure.children).toEqual([
      "two-company-dropdown__search",
      "two-company-dropdown__results",
      "two-company-mode-chips"
    ]);
  });

  test("the search row holds the query field and its spinner", () => {
    ctx.helper.attach();

    const row = document.querySelector(".two-company-dropdown__search");
    expect(row.querySelector(":scope > input.two-company-dropdown__query")).not.toBeNull();
    expect(row.querySelector(":scope > span.two-company-dropdown__spinner")).not.toBeNull();
  });

  test("the `hidden` attribute is the outer visibility switch", () => {
    ctx.helper.attach();
    const panel = document.querySelector(".two-company-dropdown");
    expect(panel.hasAttribute("hidden")).toBe(true);

    ctx.helper.openCompanySearchDropdown();
    expect(panel.hasAttribute("hidden")).toBe(false);

    ctx.helper.closeCompanySearchDropdown();
    expect(panel.hasAttribute("hidden")).toBe(true);
  });

  test("every chip lives inside the panel, none beside it", () => {
    ctx.helper.attach();

    const chips = document.querySelectorAll(".two-company-mode-chip");
    expect(chips.length).toBeGreaterThan(0);
    chips.forEach((chip) => {
      expect(chip.closest(".two-company-mode-chips").parentElement.className).toBe(
        "two-company-dropdown"
      );
    });
    expect(Array.prototype.map.call(chips, (chip) => chip.getAttribute("data-two-chip"))).toEqual([
      "registered",
      "sole_trader",
      "manual"
    ]);
  });

  test("the query field is the field's next tab stop, by document order alone", () => {
    ctx.helper.attach();

    const field = document.querySelector("#billing_company_display");
    const query = document.querySelector(".two-company-dropdown__query");
    // DOCUMENT_POSITION_FOLLOWING.
    expect(field.compareDocumentPosition(query) & 4).toBeTruthy();

    const chips = document.querySelector(".two-company-mode-chips");
    const results = document.querySelector(".two-company-dropdown__results");
    expect(results.compareDocumentPosition(chips) & 4).toBeTruthy();
  });

  test("re-attaching adopts the panel already there rather than building a second", () => {
    ctx.helper.attach();
    ctx.helper.attach();
    ctx.helper.attach();

    expect(document.querySelectorAll(".two-company-dropdown")).toHaveLength(1);
    expect(document.querySelectorAll(".two-company-field-wrap")).toHaveLength(1);
  });

  test("a billing re-render re-binds the panel to the field that replaced it", () => {
    ctx.helper.attach();
    const before = document.querySelector("#billing_company_display");
    ctx
      .$("form[name='checkout']")
      .append(
        '<div class="payment_box"><div class="twoinc-company-search-tile-slot hidden"></div></div>'
      );

    // What core's `address-i18n.js` does to the billing wrapper on every load.
    ctx
      .$(".two-company-field-wrap")
      .replaceWith(
        '<input type="text" id="billing_company_display" name="billing_company_display" />'
      );
    ctx.helper.syncCompanySearchTileLocation();

    const after = document.querySelector("#billing_company_display");
    expect(after).not.toBe(before);
    expect(ctx.helper.panel.getField()[0]).toBe(after);
    expect(document.querySelectorAll(".two-company-dropdown")).toHaveLength(1);
  });

  describe("the wrapper is pinned to the input's own box", () => {
    const FIELD_HEIGHT = 42;
    const FIELD_WIDTH_HOLDER = { value: 310 };
    const FIELD_WIDTH = 310;
    let outerWidth;
    let outerHeight;

    beforeEach(() => {
      FIELD_WIDTH_HOLDER.value = FIELD_WIDTH;
      // jsdom has no layout, so the measurements the pin reads have to come
      // from somewhere; the row is deliberately WIDER than the input, which is
      // the case the pin exists for.
      outerWidth = ctx.$.fn.outerWidth;
      outerHeight = ctx.$.fn.outerHeight;
      ctx.$.fn.outerWidth = function () {
        if (!this.is("#billing_company_display")) return 640;
        const pinned = this.closest(".two-company-field-wrap").get(0);
        // The input is `width: 100%` of the wrapper, so a pin left in place is
        // what a re-measurement reads back.
        if (pinned && pinned.style.width) return parseInt(pinned.style.width, 10);
        return FIELD_WIDTH_HOLDER.value;
      };
      ctx.$.fn.outerHeight = function () {
        return this.is("#billing_company_display") ? FIELD_HEIGHT : 96;
      };
    });

    afterEach(() => {
      ctx.$.fn.outerWidth = outerWidth;
      ctx.$.fn.outerHeight = outerHeight;
    });

    test("it carries the input's height as the panel's anchor", () => {
      ctx.helper.attach();

      const wrap = document.querySelector(".two-company-field-wrap");
      expect(wrap.style.getPropertyValue("--two-company-input-height")).toBe(FIELD_HEIGHT + "px");
      expect(wrap.style.width).toBe(FIELD_WIDTH + "px");
    });

    test("a second pass re-measures rather than reading its own pin back", () => {
      ctx.helper.attach();
      expect(document.querySelector(".two-company-field-wrap").style.width).toBe(
        FIELD_WIDTH + "px"
      );
      FIELD_WIDTH_HOLDER.value = 220;

      ctx.helper.syncFieldWrapMetrics();

      expect(document.querySelector(".two-company-field-wrap").style.width).toBe("220px");
    });
  });

  test("the stylesheet anchors the panel to the input's height, not the wrapper's", () => {
    const style = harness.injectStylesheet();
    const rule = Array.prototype.find.call(style.sheet.cssRules, function (candidate) {
      return candidate.selectorText === ".two-company-dropdown";
    });

    expect(rule).toBeDefined();
    // `100%` here is the WRAPPER, which grows by the sole-trader link's height
    // the moment one is adopted.
    expect(rule.style.top).toBe("calc(var(--two-company-input-height, 100%) + 8px)");
    style.remove();
  });
});
