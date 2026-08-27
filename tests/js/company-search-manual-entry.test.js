/**
 * TWO-25288, reworked TWO-25503. The manual-entry route out of company search.
 *
 * The affordance is now the `manual` mode chip inside the company-capture
 * popover: a real `<button>` sitting in `.two-company-mode-chips`, the panel's
 * third and last child, after the query row and the results host. Because the
 * panel is a DOM child of the wrapper around the company-name input rather
 * than a body-appended layer, everything the old select2 build needed custom
 * key handling for — reaching the chip without walking 50 result rows, leaving
 * the dropdown by Tab, nothing being a tab stop while closed — is the
 * browser's own tab order acting on the DOM order this suite asserts.
 *
 * The real panel is used throughout: the chip's position relative to the
 * results host, and what closing does to the whole subtree, are properties of
 * the shipped popover, and a mock would have to reproduce them correctly to
 * catch a regression in them.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const harness = require("./wc-harness");

/** The strings the affordance reads out of the localised text map. */
const TEXT = {
  enter_manually: "Enter manually",
  search_company: "Search for company"
};

describe("company-search manual-entry affordance", () => {
  let ctx;
  let $;
  let helper;

  beforeEach(() => {
    ctx = harness.loadTwoinc({
      text: TEXT,
      supported_buyer_countries: ["GB"],
      enable_company_search: "yes",
      enable_address_lookup: "no"
    });
    $ = ctx.$;
    helper = ctx.helper;
    harness.buildCheckoutForm();
    // The rows ship the server's own `hidden` on the search control;
    // `toggleBusinessFields()` clears it on a real page. This suite exercises
    // what happens once it IS the visible surface.
    $("#billing_company_display_field").removeClass("hidden");
  });

  afterEach(() => {
    harness.releasePanel(helper);
    document.body.innerHTML = "";
  });

  // The panel binds with addEventListener, which jQuery's `.trigger()` does
  // not reach.
  function fire(el, type) {
    el.dispatchEvent(new window.Event(type, { bubbles: true }));
  }

  function click(el) {
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0 }));
  }

  function openPanel() {
    return harness.openCompanyPanel($, helper);
  }

  function panelEl() {
    return document.querySelector(".two-company-dropdown");
  }

  function queryInput() {
    return $(".two-company-dropdown__query");
  }

  function results() {
    return $(".two-company-dropdown__results");
  }

  function chips() {
    return $(".two-company-mode-chips");
  }

  function chip(mode) {
    return $('.two-company-mode-chip[data-two-chip="' + mode + '"]');
  }

  function btn() {
    return chip("manual");
  }

  function type(term) {
    const el = queryInput().get(0);
    el.value = term;
    fire(el, "input");
  }

  function activate() {
    click(btn().get(0));
  }

  /**
   * Run one search all the way to painted rows. Fake timers must already be
   * on: the debounce is what separates a keystroke from a request.
   */
  async function search(term, items) {
    const ajax = harness.stubAjax($);
    type(term);
    jest.advanceTimersByTime(helper.companySearchDebounceMs);
    ajax.last().succeed({ items: items });
    // jQuery settles its deferred synchronously; the Promise wrapping it
    // resolves on the next microtask.
    await Promise.resolve();
    ajax.restore();
  }

  /**
   * Guard against a harness that returns before the code under test ran.
   *
   * Every assertion below is about DOM the panel is supposed to have built. If
   * `attach()` silently did nothing, an "is absent" assertion still passes and
   * a "is present" one fails for the wrong reason.
   */
  test("the panel actually binds — guard for every test below", () => {
    openPanel();

    const structure = harness.panelStructure($);
    expect(structure).not.toBeNull();
    expect(structure.children).toEqual([
      "two-company-dropdown__search",
      "two-company-dropdown__results",
      "two-company-mode-chips"
    ]);
    expect(queryInput().length).toBe(1);
    expect(btn().length).toBe(1);
  });

  describe("visibility: present whenever the panel is open (TWO-25326 §2)", () => {
    test("present as soon as the panel opens, before the buyer has typed anything", () => {
      openPanel();

      // The whole point of the requirement: Doug rejected a route into manual
      // entry that makes the buyer type a query they already know will fail.
      expect(queryInput().val()).toBe("");
      expect(btn().length).toBe(1);
      expect(btn().hasClass("two-hidden")).toBe(false);
    });

    test("the chips are built by the bind itself, not by an input event", () => {
      // Nothing here types or opens, so a chip set built off the query field's
      // own events would never appear at all.
      helper.attach();

      expect(btn().length).toBe(1);
      expect(chips().children(".two-company-mode-chip").length).toBe(3);
    });

    test("stays put below the search threshold", () => {
      openPanel();

      type("a".repeat(helper.companySearchMinLength));
      expect(btn().length).toBe(1);

      type("a".repeat(helper.companySearchMinLength - 1));
      expect(btn().length).toBe(1);

      type("");
      expect(btn().length).toBe(1);
    });

    test("present at the threshold, before any request has been made", () => {
      openPanel();
      const ajax = harness.stubAjax($);

      type("a".repeat(helper.companySearchMinLength));

      expect(btn().length).toBe(1);
      // Nothing has been debounced out yet and the chip is there. A
      // `hasSearched` gate would fail this.
      expect(ajax.calls.length).toBe(0);
      ajax.restore();
    });

    test("present above the threshold", () => {
      openPanel();

      type("a".repeat(helper.companySearchMinLength + 4));

      expect(btn().length).toBe(1);
    });

    test("still there after a company has been captured and the panel reopened", () => {
      // The regression Doug found live on 2026-08-02. A capture gate used to
      // remove the affordance as soon as the display field held a value, so a
      // buyer who picked the wrong company and reopened to correct it had no
      // route into manual entry at all.
      openPanel();
      expect(btn().length).toBe(1);

      helper.setDisplayName("ACME Widgets Ltd");
      helper.syncModeChips();

      expect($("#billing_company_display").val()).toBe("ACME Widgets Ltd");
      expect(btn().length).toBe(1);
    });

    test("a captured company leaves the chip in the tab order too", () => {
      // The same gate took the keyboard with it. Tab is now the browser's own
      // walk of the panel, so what has to survive a capture is the chip's
      // place in it.
      openPanel();
      helper.setDisplayName("ACME Widgets Ltd");
      helper.syncModeChips();

      expect(btn().attr("tabindex")).toBeUndefined();
      expect(btn().closest(".two-company-mode-chips").is(chips())).toBe(true);
      expect(chips().prev().is(results())).toBe(true);
    });
  });

  describe("where the chip lives (#30.x.1, #30.x.2, TWO-40 §0)", () => {
    test("it is OUTSIDE the results host, in the panel's own chip group", () => {
      openPanel();

      type("abc");

      // Not inside the scrollable results host...
      expect(results().find(".two-company-mode-chip").length).toBe(0);
      // ...its own element still exists, inside the chip group...
      expect(btn().length).toBe(1);
      expect(btn().parent().is(chips())).toBe(true);
      // ...last of the group, so it stays the last tab stop in the control...
      expect(chips().children().last().is(btn())).toBe(true);
      // ...and the group is the results host's own next sibling, inside the
      // panel, which is a child of the wrapper rather than of <body>.
      expect(chips().prev().is(results())).toBe(true);
      expect(panelEl().parentElement.classList.contains("two-company-field-wrap")).toBe(true);
      expect(document.body.lastElementChild).not.toBe(panelEl());
    });

    test("it is a real <button>, not a styled row", () => {
      openPanel();

      type("abc");

      expect(btn().prop("tagName")).toBe("BUTTON");
      expect(btn().attr("type")).toBe("button");
    });

    test("it stays put however many results are in the (scrollable) results host", async () => {
      jest.useFakeTimers();
      openPanel();
      const items = [];
      for (let i = 0; i < 30; i++) {
        items.push({ name: "Company " + i, national_identifier: { id: "1000000" + i } });
      }

      await search("abc", items);
      jest.useRealTimers();

      expect(results().children(".two-company-dropdown__row").length).toBe(30);
      // Reachable regardless of how long the results host got — the scroll is
      // on that host, and the chips sit outside it.
      expect(btn().length).toBe(1);
      expect(chips().prev().is(results())).toBe(true);
    });

    test("the tab order runs query field, then results, then chips", async () => {
      // What replaces the old Tab shortcut: result rows are plain <div>s with
      // no tabindex, so the browser skips them, and the chips follow in DOM
      // order — no key handling needed for Tab to reach them.
      jest.useFakeTimers();
      openPanel();
      await search("abc", [{ name: "A company", national_identifier: { id: "12345678" } }]);
      jest.useRealTimers();

      expect(queryInput().attr("tabindex")).toBeUndefined();
      expect(btn().attr("tabindex")).toBeUndefined();
      results()
        .children(".two-company-dropdown__row")
        .each(function () {
          expect(this.tagName).toBe("DIV");
          expect($(this).attr("tabindex")).toBeUndefined();
        });
      expect(Array.prototype.indexOf.call(panelEl().children, chips().get(0))).toBe(2);
    });

    test("it is not churned by repeated keystrokes on the same term", () => {
      openPanel();

      type("abc");
      const node = btn()[0];
      type("abc");
      type("abc");

      expect(btn()[0]).toBe(node);
      expect(btn().length).toBe(1);
    });

    test("the label is the localised msgid, not a hard-coded English literal", () => {
      // Asserting on the English string would pass against a literal in the
      // source.
      ctx.twoinc.text.enter_manually = "Registrer manuelt";
      openPanel();

      expect(btn().text()).toBe("Registrer manuelt");
    });
  });

  describe("one panel per field, never a stale second one (TWO-40, live-reported by Doug)", () => {
    test("a field replaced while the panel is open leaves no stale panel behind", () => {
      // WooCommerce's checkout AJAX can discard the field the control is
      // attached to via a plain `replaceWith()` while the panel is open.
      openPanel();
      expect($(".two-company-dropdown").length).toBe(1);

      $("#billing_company_display_field").replaceWith(
        harness.companyRowsMarkup().split("\n").slice(0, 6).join("\n")
      );
      $("#billing_company_display_field").removeClass("hidden");
      helper.attach();
      helper.openCompanySearchDropdown();

      expect($(".two-company-dropdown").length).toBe(1);
      expect($(".two-company-field-wrap").length).toBe(1);
      expect(panelEl().parentElement.contains($("#billing_company_display").get(0))).toBe(true);
    });

    test("re-attaching adopts the panel already in the wrapper rather than building a second", () => {
      openPanel();
      const first = panelEl();

      helper.attach();
      helper.attach();

      expect($(".two-company-dropdown").length).toBe(1);
      expect($(".two-company-mode-chips").length).toBe(1);
      expect(panelEl()).toBe(first);
    });

    test("syncing the chips never touches a chip group outside this panel", () => {
      // `syncModeChips` runs from `twoincSoleTrader.apply()`, an async
      // availability callback decoupled from whatever else is on the page, so
      // it must be scoped to this panel rather than sweeping by class.
      openPanel();
      const $stray = $('<div class="two-company-mode-chips"><button>Stray</button></div>');
      $(document.body).append($stray);
      const before = btn().get(0);

      helper.syncModeChips();

      // The sync provably ran — this panel's own chips are rebuilt, not
      // mutated — and the stray group is untouched by it.
      expect(btn().get(0)).not.toBe(before);
      expect($stray.children().length).toBe(1);
      expect($stray.children().first().text()).toBe("Stray");
      $stray.remove();
    });
  });

  describe("the chips inherit visibility from the panel alone (TWO-40 §0)", () => {
    /**
     * Ground-truth PrestaShop finding this ports: every chip's own `style`
     * attribute is empty in every observed state — there is exactly ONE
     * visibility switch in the whole structure (the panel's own open/closed
     * state), never one on the group and never one per chip.
     */
    test("closing the panel hides the whole control at once, not one chip at a time", () => {
      openPanel();
      expect(chips().length).toBe(1);
      expect(chips().children(".two-company-mode-chip").length).toBe(3);

      helper.closeCompanySearchDropdown();

      expect(panelEl().hasAttribute("hidden")).toBe(true);
      expect(chips().get(0).getAttribute("style")).toBeNull();
      chips()
        .children(".two-company-mode-chip")
        .each(function () {
          expect(this.getAttribute("style")).toBeNull();
        });
    });

    test("reopening shows the same group again, from the panel alone", () => {
      openPanel();
      helper.closeCompanySearchDropdown();
      expect(panelEl().hasAttribute("hidden")).toBe(true);

      helper.openCompanySearchDropdown();

      expect(panelEl().hasAttribute("hidden")).toBe(false);
      expect(btn().length).toBe(1);
    });

    test("the selected chip's class is cosmetic only — never what makes a chip present", () => {
      openPanel();

      const $selected = chips().children(".two-company-mode-chip--selected");
      expect($selected.length).toBe(1);
      expect($selected.attr("data-two-chip")).toBe("registered");
      expect(chips().children(".two-company-mode-chip").length).toBe(3);
    });
  });

  describe("the chip set follows the address-area company-search setting (TWO-25503)", () => {
    const SOLE_TRADER_CONFIG = {
      availability_url: "/?wc-ajax=two_sole_trader_availability",
      tokens_url: "/?wc-ajax=two_sole_trader_tokens",
      nonce: "nonce",
      text: { registered_business: "Registered company", sole_trader: "Sole trader" }
    };

    /** The modes actually offered — a withheld chip is rendered `.two-hidden`. */
    function visibleChipModes() {
      return chips()
        .children(".two-company-mode-chip")
        .filter(function () {
          return !$(this).hasClass("two-hidden");
        })
        .map(function () {
          return $(this).attr("data-two-chip");
        })
        .get();
    }

    test.each([
      ["address_area", ["registered", "sole_trader", "manual"], "all three offered"],
      [
        "payment_tile",
        ["registered", "sole_trader"],
        "manual entry withheld, the other two untouched"
      ]
    ])("company_search_location %s → %p — %s", (location, expected) => {
      ctx = harness.loadTwoinc({
        text: TEXT,
        supported_buyer_countries: ["GB"],
        enable_company_search: "yes",
        company_search_location: location,
        enable_address_lookup: "no",
        sole_trader: SOLE_TRADER_CONFIG
      });
      $ = ctx.$;
      helper = ctx.helper;
      harness.buildCheckoutForm({ country: "GB" });
      $("#billing_company_display_field").removeClass("hidden");
      ctx.soleTrader.availabilityByCountry = { GB: true };
      if (location === "payment_tile") {
        $(document.body).append('<div class="twoinc-company-search-tile-slot"></div>');
        helper.syncCompanySearchTileLocation();
      }

      openPanel();

      // Every chip is always rendered; withholding one is a class, not a gap.
      expect(chips().children(".two-company-mode-chip").length).toBe(3);
      expect(visibleChipModes()).toEqual(expected);
    });
  });

  describe("nothing in the panel is a tab stop while it is closed", () => {
    test("the closed panel carries `hidden`, which takes its whole subtree out", () => {
      // The #30.x.4 keyboard trap, now answered by the DOM rather than by a
      // key handler: `[hidden]` removes the query field, the rows and the
      // chips from the tab order in one attribute.
      openPanel();
      expect(panelEl().hasAttribute("hidden")).toBe(false);

      helper.closeCompanySearchDropdown();

      expect(panelEl().hasAttribute("hidden")).toBe(true);
      expect(helper.companySearchDropdownIsOpen()).toBe(false);
      expect($("#billing_company_display").attr("aria-expanded")).toBe("false");
    });
  });

  describe("CSS overrides survive a host theme's own styling (#30.x.5, round 3)", () => {
    /**
     * jsdom's cascade does not resolve `!important` + specificity across two
     * separate sheets, so a rendered-style assertion here would be vacuous
     * rather than wrong. The proof is textual, against the shipped rule.
     */
    function stylesheetSource() {
      return fs.readFileSync(path.join(harness.REPO_ROOT, harness.STYLESHEET_PATH), "utf8");
    }

    function ruleBodyFor(css, selector) {
      const re = new RegExp(selector.replace(/[.#]/g, "\\$&") + "\\s*\\{([^}]*)\\}", "m");
      const m = re.exec(css);
      return m ? m[1] : "";
    }

    test.each([["#search_company_btn"], [".two-company-mode-chip"]])(
      "%s declares text-transform: none !important",
      (selector) => {
        // A real Astra selector list Doug found via devtools includes the bare
        // `button` element selector with `!important`, which a non-!important
        // override cannot beat regardless of specificity.
        expect(ruleBodyFor(stylesheetSource(), selector)).toMatch(
          /text-transform:\s*none\s*!important/
        );
      }
    );

    /**
     * All three mode chips hover IDENTICALLY (TWO-40, live-reported by Doug:
     * "Registered Organization" and "Sole Trader" adopt the store's brand
     * colour on hover, while "Enter manually" instead got a red border but a
     * grey fill). A chip-specific hover fill is what made one of them the chip
     * the theme could not colour, so the invariant is "no hover fill declared
     * for any of them".
     */
    test("no mode chip declares a hover background of its own", () => {
      // Comments stripped BEFORE matching: a selector-plus-block match starts
      // at the previous `}`, so it swallows whatever comment precedes the rule.
      const css = stylesheetSource().replace(/\/\*[\s\S]*?\*\//g, "");
      // The `background` shorthand counts too: this stylesheet already paints
      // a chip hover with it elsewhere (`.twoinc-term-chip--selected:hover`).
      const offenders = (css.match(/[^{}]*:hover[^{]*\{[^}]*\}/g) || []).filter(
        (rule) =>
          rule.includes("two-company-mode-chip") &&
          /background(-color)?\s*:/.test(rule.slice(rule.indexOf("{")))
      );

      expect(offenders).toEqual([]);
    });
  });

  describe("placement below the visible field, not overlapping it (#30.x.5.3 round 3; reworked #30.x.9)", () => {
    test("#search_company_btn is appended into .woocommerce-input-wrapper, not #billing_company_field directly", () => {
      // WooCommerce core's own wrapper is around just the <input>, no label
      // inside it, so a button appended as its last child lands in normal flow
      // immediately below the input rather than below the label+input pair.
      jest.useFakeTimers();
      openPanel();
      ctx.Twoinc.getInstance();
      type("abc");
      activate();
      jest.advanceTimersByTime(1);
      jest.useRealTimers();

      const $searchBtn = helper.getSearchCompanyBtnNode();
      expect($searchBtn.parent().hasClass("woocommerce-input-wrapper")).toBe(true);
      expect($searchBtn.closest("#billing_company_field").length).toBe(1);
    });

    test("the button sits in normal flow below the input, not absolutely positioned over it (#30.x.9)", () => {
      // Reported live: the button used to be centred vertically against
      // `.woocommerce-input-wrapper`, which put it ON TOP of the input. Doug's
      // ruling: normal block flow below the field, right-aligned.
      harness.injectStylesheet();

      jest.useFakeTimers();
      openPanel();
      ctx.Twoinc.getInstance();
      type("abc");
      activate();
      jest.advanceTimersByTime(1);
      jest.useRealTimers();

      const $searchBtn = helper.getSearchCompanyBtnNode();
      const wrapper = $searchBtn.parent();
      expect(wrapper.children().last().get(0)).toBe($searchBtn.get(0));
      expect($searchBtn.prev().is("input")).toBe(true);

      const btnStyle = window.getComputedStyle($searchBtn[0]);
      expect(btnStyle.position).not.toBe("absolute");
      expect(btnStyle.display).toBe("block");
      expect(btnStyle.textAlign).toBe("end");
    });

    test("the wrapper is blockified explicitly, not left to whatever the host theme declares (round 1 review)", () => {
      // `.woocommerce-input-wrapper` is a <span> — inline by default — and a
      // theme declaring it `display: flex` would put the button back on the
      // input's own line, re-creating the overlap this removes.
      const m = /#billing_company_field\s+\.woocommerce-input-wrapper\s*\{([^}]*)\}/.exec(
        fs.readFileSync(path.join(harness.REPO_ROOT, harness.STYLESHEET_PATH), "utf8")
      );
      expect(m).not.toBeNull();
      expect(m[1]).toMatch(/display:\s*block/);
      expect(m[1]).toMatch(/position:\s*relative/);
    });

    test("#search_company_btn declares its below-the-field gap explicitly (round 1 review — Vader)", () => {
      // Mutation-caught gap: a mutation deleting `margin-top` passed the full
      // suite while `display`/`position`/`text-align` were asserted.
      const m = /^#search_company_btn\s*\{([^}]*)\}/m.exec(
        fs.readFileSync(path.join(harness.REPO_ROOT, harness.STYLESHEET_PATH), "utf8")
      );
      expect(m).not.toBeNull();
      expect(m[1]).toMatch(/margin-top:\s*4px/);
    });

    test("#search_company_btn keeps width: 100% paired with box-sizing: border-box (round 2 review — Vader)", () => {
      // A <button> is a form control: at `width: auto` it shrink-wraps its own
      // label regardless of `display: block`, which makes `text-align: end` a
      // no-op. `box-sizing: border-box` is what stops the pair overflowing, so
      // either alone reproduces a bug.
      const m = /^#search_company_btn\s*\{([^}]*)\}/m.exec(
        fs.readFileSync(path.join(harness.REPO_ROOT, harness.STYLESHEET_PATH), "utf8")
      );
      expect(m).not.toBeNull();
      expect(m[1]).toMatch(/width:\s*100%/);
      expect(m[1]).toMatch(/box-sizing:\s*border-box/);
    });

    test("self-heals a missing .woocommerce-input-wrapper instead of falling back to the unpositioned field", () => {
      // A host template rendering #billing_company_field without core's
      // wrapper would otherwise put the button below the label+input combined,
      // with nothing to signal the fallback was taken.
      $("#billing_company").unwrap();
      expect($("#billing_company_field .woocommerce-input-wrapper").length).toBe(0);

      const $searchBtn = helper.getSearchCompanyBtnNode();

      const $parent = $searchBtn.parent();
      expect($parent.hasClass("woocommerce-input-wrapper")).toBe(true);
      expect($parent.get(0)).toBe($("#billing_company").parent().get(0));
      expect($searchBtn.closest("#billing_company_field").length).toBe(1);
    });
  });

  describe("mouse-button semantics (#30.x.3)", () => {
    test("a plain click activates it", () => {
      jest.useFakeTimers();
      openPanel();
      ctx.Twoinc.getInstance();

      type("abc");
      activate();
      jest.advanceTimersByTime(1);

      expect(ctx.capture.mode).toBe("manual");
      jest.useRealTimers();
    });

    test("a right click (mouseup, button 2) does not activate it", () => {
      // The bug this replaces: select2's own result-row `mouseup` binding had
      // no button check, so a right click fired the same activation a left one
      // did. A real <button>'s `click` never fires for a non-primary button.
      openPanel();
      ctx.Twoinc.getInstance();
      type("abc");
      const clicked = [];
      btn()
        .get(0)
        .addEventListener("click", () => clicked.push(1));

      btn()
        .get(0)
        .dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true, button: 2 }));

      expect(clicked).toEqual([]);
      expect(ctx.capture.mode).not.toBe("manual");
    });
  });

  describe("activation", () => {
    beforeEach(() => {
      // enterManualCompanyEntry reaches the singleton for the
      // customer-company snapshot.
      ctx.Twoinc.getInstance();
    });

    test("it enters manual entry", () => {
      jest.useFakeTimers();
      openPanel();

      type("abc");
      activate();
      // The action is deferred out of the click dispatch.
      jest.advanceTimersByTime(1);

      expect(ctx.capture.mode).toBe("manual");
      expect(helper.companySearchDropdownIsOpen()).toBe(false);
      expect($("#search_company_btn")[0].style.display).not.toBe("none");
      jest.useRealTimers();
    });

    test("the panel is closed and the field handed back, not left live behind manual entry", () => {
      // #30.x.13: a control left live while the buyer types into a different
      // field is what made Tab unresponsive page-wide under select2. The
      // panel's own openers have to come off the field with it.
      openPanel();
      expect($("#billing_company_display").attr("role")).toBe("combobox");

      jest.useFakeTimers();
      type("abc");
      activate();
      jest.advanceTimersByTime(1);
      jest.useRealTimers();

      expect(panelEl().hasAttribute("hidden")).toBe(true);
      expect($("#billing_company_display").attr("role")).toBeUndefined();
      expect($("#billing_company_display").attr("aria-expanded")).toBeUndefined();
      // The panel's own return link is removed in favour of the plugin's,
      // which renders beside the field the buyer now types into.
      expect($(".two-company-search-back").length).toBe(0);
    });

    test("the way back out appears, keyboard-reachable", () => {
      jest.useFakeTimers();
      openPanel();

      type("abc");
      activate();
      jest.advanceTimersByTime(1);

      const $back = $("#" + helper.searchCompanyBtnId);
      expect($back.length).toBe(1);
      expect($back.prop("tagName")).toBe("BUTTON");
      expect($back.attr("type")).toBe("button");
      // Not `:hidden`: jsdom reports zero dimensions for every element, so
      // that selector matches everything and could never fail.
      expect($back[0].style.display).not.toBe("none");
      jest.useRealTimers();
    });

    test("the way back out is localised, not a hard-coded English literal", () => {
      ctx.twoinc.text.search_company = "Søk etter selskap";
      openPanel();

      expect(helper.getSearchCompanyBtnNode().text()).toBe("Søk etter selskap");
    });

    test("repeating the activation in one tick leaves one switch, not one per press", () => {
      jest.useFakeTimers();
      openPanel();
      let entered = 0;
      const realEnter = helper.enterManualCompanyEntry;
      helper.enterManualCompanyEntry = function () {
        entered++;
        return realEnter.apply(this, arguments);
      };

      try {
        type("abc");
        activate();
        activate();
        activate();
        jest.advanceTimersByTime(1);

        expect(entered).toBeGreaterThan(0);
        expect(ctx.capture.mode).toBe("manual");
        // What must not multiply: the affordances the switch builds.
        expect($("#" + helper.searchCompanyBtnId).length).toBe(1);
        expect($(".two-company-search-back").length).toBe(0);
      } finally {
        helper.enterManualCompanyEntry = realEnter;
        jest.useRealTimers();
      }
    });

    /**
     * The buyer must never end up with manual entry not entered and no way to
     * retry (TWO-40, live-reported by Doug).
     *
     * The two states are handled differently on purpose: an ALREADY-SETTLED
     * sole-trader mode is one the buyer may explicitly leave (so the click
     * proceeds, switching to business first), whereas a STILL-DECIDING one
     * must be left for the outstanding flight/popup to resolve (so the click
     * is dropped — but the chip stays).
     */
    test.each([
      {
        state: "settled sole-trader mode",
        // Through the real `setMode`, not by assigning `.mode`: that is what
        // takes the capture-mode snapshot this path then has to restore.
        arrange: (soleTrader) => {
          soleTrader.setMode("sole_trader");
        },
        entered: true,
        description: "proceeds into manual entry, leaving sole-trader mode behind it"
      },
      {
        state: "an outstanding autofill flight (isDeciding)",
        arrange: (soleTrader) => {
          soleTrader.flightDepth = 1;
        },
        entered: false,
        description: "drops the click but KEEPS the chip, so the buyer can retry"
      }
    ])("manual-entry activation in $state $description", ({ arrange, entered }) => {
      jest.useFakeTimers();
      try {
        // Given: the chip is on screen and the flow is in the state under test.
        openPanel();
        type("abc");
        arrange(ctx.soleTrader);
        expect(btn().length).toBe(1);

        // When: the buyer activates it.
        activate();
        jest.advanceTimersByTime(1);

        // Then: manual entry is entered iff the click proceeded, and the chip
        // is still offered either way.
        expect(ctx.capture.mode === "manual").toBe(entered);
        expect(btn().length).toBe(1);
        // The mode swap reached the DOM, not just the flag.
        expect(helper.companySearchDropdownIsOpen()).toBe(!entered);
        if (entered) {
          expect(ctx.soleTrader.mode).toBe("business");
          // The snapshot `setMode("sole_trader")` took is genuinely GIVEN
          // BACK: manual entry sets the capture mode itself, so asserting that
          // value alone passes even with the restore deleted.
          expect(ctx.soleTrader.savedCaptureMode).toBeNull();
          expect($("#billing_company").prop("readonly")).toBe(false);
        }
      } finally {
        ctx.soleTrader.flightDepth = 0;
        jest.useRealTimers();
      }
    });

    test("the real company field is cleared, not just the display one", () => {
      jest.useFakeTimers();
      openPanel();
      $("#billing_company").val("Previously Picked Ltd");
      $("#company_id").val("11111111");

      type("abc");
      activate();
      jest.advanceTimersByTime(1);

      expect($("#billing_company").val()).toBe("");
      expect($("#company_id").val()).toBe("");
      jest.useRealTimers();
    });

    // The address inputs `setAddress` writes to, prefilled the way an address
    // lookup for a picked company leaves them.
    function givenLookedUpAddress() {
      $("form[name='checkout']").append(
        [
          "<input type='text' id='billing_address_1' value='Registry Street 1' />",
          "<input type='text' id='billing_address_2' value='Flat 2' />",
          "<input type='text' id='billing_city' value='Registryville' />",
          "<input type='text' id='billing_postcode' value='0001' />"
        ].join("\n")
      );
      expect($("#billing_address_1").val()).toBe("Registry Street 1");
    }

    test("the disowned company's registry address does not survive into the order", () => {
      jest.useFakeTimers();
      openPanel();
      givenLookedUpAddress();
      ctx.Twoinc.getInstance().registryAddressApplied = true;

      type("abc");
      activate();
      jest.advanceTimersByTime(1);

      expect($("#billing_address_1").val()).toBe("");
      expect($("#billing_address_2").val()).toBe("");
      expect($("#billing_city").val()).toBe("");
      expect($("#billing_postcode").val()).toBe("");
      expect(ctx.Twoinc.getInstance().registryAddressApplied).toBe(false);
      jest.useRealTimers();
    });

    test("the address is left alone when manual entry is reached without ever picking a company", () => {
      jest.useFakeTimers();
      openPanel();
      givenLookedUpAddress();
      $("#company_id").val("11111111"); // account-restored, not a fresh pick

      type("abc");
      activate();
      jest.advanceTimersByTime(1);

      expect($("#billing_address_1").val()).toBe("Registry Street 1");
      expect($("#billing_address_2").val()).toBe("Flat 2");
      expect($("#billing_city").val()).toBe("Registryville");
      expect($("#billing_postcode").val()).toBe("0001");
      jest.useRealTimers();
    });

    test("the display field's own value is cleared, not just hidden", () => {
      jest.useFakeTimers();
      openPanel();
      helper.setDisplayName("ACME Widgets Ltd");
      expect($("#billing_company_display").val()).toBe("ACME Widgets Ltd");

      // Straight to the switch rather than through the chip: the state is also
      // reachable from sole-trader mode and from the user-meta restore, and
      // what it must do to the display field is the same.
      helper.enterManualCompanyEntry();
      jest.advanceTimersByTime(1);

      expect($("#billing_company_display").val()).toBe("");
      jest.useRealTimers();
    });

    test("leaving manual entry clears the hand-typed company and org number", () => {
      jest.useFakeTimers();
      openPanel();

      type("abc");
      activate();
      jest.advanceTimersByTime(1);

      $("#billing_company").val("Hand Typed Ltd");
      $("#company_id").val("99999999");

      helper.exitManualCompanyEntry();

      expect($("#billing_company").val()).toBe("");
      expect($("#company_id").val()).toBe("");
      jest.useRealTimers();
    });

    test("the way back out is built hidden, before manual entry is entered", () => {
      openPanel();

      const $back = helper.getSearchCompanyBtnNode();

      expect($back[0].style.display).toBe("none");
      // In place, not floating: inside .woocommerce-input-wrapper (round 3,
      // #30.x.5.3), so it renders immediately below the visible input box.
      expect($back.parent().hasClass("woocommerce-input-wrapper")).toBe(true);
      expect($back.closest("#billing_company_field").length).toBe(1);
    });

    test("a real click activates the way back out even detached from the document (#30.x.13)", () => {
      // Live-reported: clicking #search_company_btn did nothing on the real
      // checkout while Enter on the same button worked. It used to be a
      // delegated `$body.on("click", ...)` handler, which only fires via
      // bubbling — an element with no parent cannot bubble anywhere, so
      // detaching it is what distinguishes a delegated binding from a direct
      // one without needing a real browser.
      openPanel();
      jest.useFakeTimers();
      type("abc");
      activate();
      jest.advanceTimersByTime(1);
      jest.useRealTimers();

      const detached = helper.getSearchCompanyBtnNode().detach();

      expect(detached.parent().length).toBe(0);
      detached.trigger("click");

      expect(ctx.capture.mode).toBe("search");
    });

    test("leaving manual entry hides the way back out again", () => {
      jest.useFakeTimers();
      openPanel();

      type("abc");
      activate();
      jest.advanceTimersByTime(1);
      expect($("#" + helper.searchCompanyBtnId)[0].style.display).not.toBe("none");

      helper.exitManualCompanyEntry();

      expect(ctx.capture.mode).toBe("search");
      expect($("#" + helper.searchCompanyBtnId)[0].style.display).toBe("none");
      jest.useRealTimers();
    });

    test("a company row still selects normally", async () => {
      jest.useFakeTimers();
      openPanel();

      await search("abc", [{ name: "A company", national_identifier: { id: "12345678" } }]);
      const row = results().children(".two-company-dropdown__row").get(0);
      row.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, button: 0 }));
      jest.useRealTimers();

      expect($("#billing_company").val()).toBe("A company");
      expect($("#company_id").val()).toBe("12345678");
      expect(helper.companySearchDropdownIsOpen()).toBe(false);
    });
  });

  describe("focus visibility and Enter/Space activation on the way back out (#30.x.7, round 4)", () => {
    function stylesheetSource() {
      return fs.readFileSync(path.join(harness.REPO_ROOT, harness.STYLESHEET_PATH), "utf8");
    }

    test("#search_company_btn reserves a dotted border up front, transparent until focused", () => {
      // Reported live: tabbing out of the manual-entry "Company name" field
      // lands focus here with nothing visible marking it, and a host theme's
      // button-focus reset can remove the browser default. The width and style
      // are reserved in the base rule so gaining focus never resizes the box —
      // a border occupies box space, unlike an outline.
      const base = /^#search_company_btn\s*\{([^}]*)\}/m.exec(stylesheetSource());
      expect(base).not.toBeNull();
      expect(base[1]).toMatch(/border:\s*1px\s+dotted\s+transparent/);
    });

    test("#search_company_btn:focus declares an explicit, !important border colour", () => {
      const m = /#search_company_btn:focus\s*\{([^}]*)\}/m.exec(stylesheetSource());
      expect(m).not.toBeNull();
      expect(m[1]).toMatch(/border-color:\s*#808080\s*!important/);
    });

    test("#search_company_btn declares explicit, tight padding (round 5)", () => {
      // The round-5 border sits flush against the box, so the box has to be
      // sized close to the text rather than left on the browser's own default
      // button padding.
      const m = /^#search_company_btn\s*\{([^}]*)\}/m.exec(stylesheetSource());
      expect(m).not.toBeNull();
      expect(m[1]).toMatch(/padding:\s*0\s+2px/);
    });

    test.each([
      ["Enter", 13],
      ["Space", 32]
    ])("%s activates the button and switches back to search", (name, which) => {
      // Found live: Tab reaches this real <button> fine, but Enter/Space did
      // nothing — some other script on the checkout swallows the native button
      // activation, so this button binds its own keydown directly on the
      // element, which target-then-bubble dispatch runs before any ancestor's.
      jest.useFakeTimers();
      openPanel();
      ctx.Twoinc.getInstance();
      type("abc");
      activate();
      jest.advanceTimersByTime(1);

      const $searchBtn = helper.getSearchCompanyBtnNode();
      $searchBtn.get(0).focus();

      const e = jQuery.Event("keydown", { which: which });
      $searchBtn.trigger(e);

      expect(e.isDefaultPrevented()).toBe(true);
      expect(ctx.capture.mode).toBe("search");
      jest.useRealTimers();
    });

    test("other keys do not activate it (selectivity guard, not proof of the fix on its own)", () => {
      // Passes identically with the whole handler deleted — a guard against an
      // over-broad handler, not evidence the fix exists.
      jest.useFakeTimers();
      openPanel();
      ctx.Twoinc.getInstance();
      type("abc");
      activate();
      jest.advanceTimersByTime(1);

      const $searchBtn = helper.getSearchCompanyBtnNode();
      $searchBtn.get(0).focus();

      const e = jQuery.Event("keydown", { which: 65 }); // "A"
      $searchBtn.trigger(e);

      expect(e.isDefaultPrevented()).toBe(false);
      expect(ctx.capture.mode).toBe("manual");
      jest.useRealTimers();
    });
  });

  describe("handlers are bound once, not once per open", () => {
    test("still one control after five open/close/re-attach cycles", () => {
      openPanel();

      for (let i = 0; i < 5; i++) {
        helper.closeCompanySearchDropdown();
        helper.openCompanySearchDropdown();
        // `enableCompanySearch` re-runs on a timer and on every return out of
        // manual entry, so re-attaching is the normal case, not an edge one.
        helper.attach();
      }

      expect($(".two-company-dropdown").length).toBe(1);
      expect(queryInput().length).toBe(1);
      expect(btn().length).toBe(1);
    });

    test("one keystroke produces one request, not one per attach", () => {
      jest.useFakeTimers();
      openPanel();
      helper.attach();
      helper.attach();
      const ajax = harness.stubAjax($);

      type("abc");
      jest.advanceTimersByTime(helper.companySearchDebounceMs);

      expect(ajax.calls.length).toBe(1);
      ajax.restore();
      jest.useRealTimers();
    });

    test("the panel exists before the buyer has typed anything into it", () => {
      // The defect this replaces bound the handler inside a polling callback
      // that fired hundreds of ms after the control appeared, so a fast
      // typist's first keystrokes were dropped.
      helper.attach();

      expect(queryInput().length).toBe(1);

      helper.openCompanySearchDropdown();
      type("abc");

      expect(queryInput().val()).toBe("abc");
      expect(btn().length).toBe(1);
    });
  });

  describe("focus is not dropped when switching modes", () => {
    beforeEach(() => {
      ctx.Twoinc.getInstance();
    });

    test("entering manual entry focuses the field the buyer asked for", () => {
      jest.useFakeTimers();
      openPanel();

      type("abc");
      activate();
      jest.advanceTimersByTime(1);

      // Releasing the field leaves activeElement on <body>, which means a
      // keyboard user has to tab in from the top of the document again.
      expect(document.activeElement).toBe($("#billing_company")[0]);
      jest.useRealTimers();
    });

    test("leaving manual entry does not strand focus on the hidden button", () => {
      jest.useFakeTimers();
      openPanel();
      type("abc");
      activate();
      jest.advanceTimersByTime(1);
      jest.useRealTimers();

      helper.exitManualCompanyEntry();

      expect(document.activeElement).not.toBe($("#" + helper.searchCompanyBtnId)[0]);
      expect(document.activeElement).not.toBe(document.body);
    });

    test("focusing a field that is not there reports failure rather than lying", () => {
      expect(helper.focusVisibleCompanyField("#no_such_field_at_all")).toBe(false);
      expect(helper.focusVisibleCompanyField("#billing_company")).toBe(true);
    });

    test("a disabled field reports failure rather than lying", () => {
      $("#billing_company").prop("disabled", true);

      expect(helper.focusVisibleCompanyField("#billing_company")).toBe(false);
      expect(document.activeElement).not.toBe($("#billing_company")[0]);

      $("#billing_company").prop("disabled", false);
      expect(helper.focusVisibleCompanyField("#billing_company")).toBe(true);
    });
  });

  describe("a re-created control heals itself", () => {
    beforeEach(() => {
      ctx.Twoinc.getInstance();
    });

    test("the chip survives clearing the selected company", () => {
      openPanel();
      type("abc");
      expect(btn().length).toBe(1);

      // The real gesture: the × on the floating company id. It re-attaches the
      // control and knows nothing about this affordance.
      helper.clearSelectedCompany();
      helper.openCompanySearchDropdown();

      type("abc");
      expect(btn().length).toBe(1);
    });

    test("clearing the selected company resets the registry-address flag", () => {
      const twoinc = ctx.Twoinc.getInstance();
      twoinc.registryAddressApplied = true;

      helper.clearSelectedCompany();

      expect(twoinc.registryAddressApplied).toBe(false);
    });
  });

  describe("the sole-trader round trip", () => {
    beforeEach(() => {
      ctx.Twoinc.getInstance();
    });

    test("manual entry survives a trip through sole trader and back", () => {
      jest.useFakeTimers();
      openPanel();

      type("abc");
      activate();
      jest.advanceTimersByTime(1);
      jest.useRealTimers();
      expect(ctx.capture.mode).toBe("manual");

      // The search button is torn down only once a sole trader is actually
      // adopted — see `setCompany`'s own comment (TWO-40 §7 correction).
      ctx.soleTrader.setMode("sole_trader");
      ctx.soleTrader.setCompany("TWO:ST1", "A Sole Trader");
      expect($("#" + helper.searchCompanyBtnId)[0].style.display).toBe("none");

      ctx.soleTrader.setMode("business");

      expect(ctx.capture.mode).toBe("manual");
      expect($("#" + helper.searchCompanyBtnId)[0].style.display).not.toBe("none");
    });

    test("adopting a sole trader with the panel open closes it, but leaves it bound (TWO-40 §7 direction (a))", () => {
      // A buyer can reach sole-trader mode with the panel still OPEN, via the
      // chip. Adoption must close it, but must NOT tear it down — direction (a)
      // keeps it bound so an adopted sole trader looks like a registered
      // company that was searched and picked.
      openPanel();
      expect(helper.companySearchDropdownIsOpen()).toBe(true);

      ctx.soleTrader.setMode("sole_trader");
      ctx.soleTrader.setCompany("TWO:ST1", "A Sole Trader");

      expect(helper.companySearchDropdownIsOpen()).toBe(false);
      expect(helper.panel.isBound()).toBe(true);
      expect($(".two-company-dropdown").length).toBe(1);
      expect($("#billing_company_display").val()).toBe("A Sole Trader");
    });

    test("a deferred manual-entry activation that lands AFTER an async sole-trader switch does not stomp it (#30.x.13)", () => {
      // Real race: `activateManualEntry` defers the mode switch a tick, and
      // the hosted signup's ACCEPTED handler reaches `setMode("sole_trader")`
      // asynchronously and independently. If that lands first, the stale
      // deferred callback would otherwise force the capture mode back to
      // `manual` — wrong, since sole trader needs `#company_id_field` for its
      // synthetic id — and wipe the fields out from under it.
      jest.useFakeTimers();
      openPanel();
      type("abc");

      // The chip's click handler fires synchronously; the mode switch is what
      // is deferred.
      activate();

      ctx.soleTrader.setMode("sole_trader");
      expect(ctx.capture.mode).toBe("sole_trader");

      jest.advanceTimersByTime(1);
      jest.useRealTimers();

      expect(ctx.capture.mode).toBe("sole_trader");
    });
  });

  describe("returning to search lands the buyer IN the search box", () => {
    beforeEach(() => {
      ctx.Twoinc.getInstance();
    });

    /** Enter manual entry through the chip, the way a buyer does. */
    function enterManualEntry() {
      jest.useFakeTimers();
      openPanel();
      type("abc");
      activate();
      jest.advanceTimersByTime(1);
      jest.useRealTimers();
      expect(ctx.capture.mode).toBe("manual");
    }

    test("the panel is open, not just re-attached", () => {
      enterManualEntry();

      helper.exitManualCompanyEntry();

      expect(helper.companySearchDropdownIsOpen()).toBe(true);
      expect(panelEl().hasAttribute("hidden")).toBe(false);
      expect($("#billing_company_display").attr("aria-expanded")).toBe("true");
    });

    test("the caret is in the panel's query field, not on the company-name field", () => {
      enterManualEntry();

      helper.exitManualCompanyEntry();

      expect(queryInput().length).toBe(1);
      expect(document.activeElement).toBe(queryInput()[0]);
      expect(document.activeElement).not.toBe($("#billing_company_display")[0]);
      expect(document.activeElement).not.toBe(document.body);
    });

    test("the buyer can type straight away and the chip is there", () => {
      enterManualEntry();

      helper.exitManualCompanyEntry();

      const el = document.activeElement;
      el.value = "abc";
      fire(el, "input");

      expect(queryInput().val()).toBe("abc");
      expect(btn().length).toBe(1);
    });

    test("opening an already-open panel is a no-op, not a second panel", () => {
      enterManualEntry();
      helper.exitManualCompanyEntry();

      expect(helper.openCompanySearchDropdown()).toBe(true);

      expect($(".two-company-dropdown").length).toBe(1);
      expect(panelEl().hasAttribute("hidden")).toBe(false);
      expect(document.activeElement).toBe(queryInput()[0]);
    });

    test("no panel bound reports failure rather than lying", () => {
      harness.releasePanel(helper);

      expect(helper.openCompanySearchDropdown()).toBe(false);
    });

    test("a surface with no company field at all still reports failure", () => {
      openPanel();
      document.body.innerHTML = "";

      expect(helper.openCompanySearchDropdown()).toBe(false);
    });
  });

  describe("the pay-for-order surface", () => {
    test("the affordance needs no template markup on the page", () => {
      jest.useFakeTimers();
      expect($(".two-company-mode-chip").length).toBe(0);
      expect($("#" + helper.searchCompanyBtnId).length).toBe(0);
      ctx.Twoinc.getInstance();

      openPanel();
      type("abc");
      expect(btn().length).toBe(1);

      activate();
      jest.advanceTimersByTime(1);

      expect($("#" + helper.searchCompanyBtnId).length).toBe(1);
      jest.useRealTimers();
    });

    test.each([
      ["#billing_company_display_field"],
      ["#billing_company_field"],
      ["#company_id_field"]
    ])("%s's wrapper follows the field's own visibility", (fieldSelector) => {
      $(fieldSelector).wrap('<div class="twoinc-inp-container hidden"></div>');
      $(fieldSelector).addClass("hidden");

      ctx.dom.syncCompanyFieldWrappers();
      expect($(fieldSelector).parent().hasClass("hidden")).toBe(true);

      $(fieldSelector).removeClass("hidden");
      ctx.dom.syncCompanyFieldWrappers();
      expect($(fieldSelector).parent().hasClass("hidden")).toBe(false);
    });
  });
});
