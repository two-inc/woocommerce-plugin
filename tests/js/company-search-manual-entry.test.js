/**
 * TWO-25288, reworked #30.x.1-3. The manual-entry affordance beside the
 * company-search dropdown.
 *
 * TWO-25288 made this a pseudo-option `<li role="option">` living INSIDE
 * `.select2-results__options` (the results list), reachable by arrowing down
 * through every result and activated via the picker's own `select2:selecting`
 * event. That traded one accessibility gap for two others, both reported
 * directly off the live checkout:
 *
 *  - `.select2-results__options` is exactly the element select2/selectWoo
 *    apply their own scroll-and-clip to, so the row was only visible if the
 *    buyer scrolled past however many results came back, and it was NOT in
 *    the normal Tab sequence at all (by design — a listbox option pattern).
 *  - selectWoo's own result-row activation binds on plain `mouseup` with no
 *    mouse-button check, so a right click fired the same activation a left
 *    click did.
 *
 * The button now lives as a sibling of the results list — outside the part
 * that scrolls, in the normal Tab sequence, and owning a plain `click`
 * handler that only ever fires for the primary mouse button.
 *
 * The real widget is used throughout, for the same reason the rest of this
 * suite uses it: the button's actual DOM position relative to the results
 * list, and select2's own scroll/tab behaviour, are properties of the
 * widget's own code — a mock would have to reproduce that correctly to catch
 * a regression in it.
 */

"use strict";

const harness = require("./wc-harness");

/** The strings the affordance reads out of the localised text map. */
const TEXT = {
  company_not_in_list: "My company is not on the list",
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
      enable_company_search_for_others: "yes",
      enable_address_lookup: "no"
    });
    $ = ctx.$;
    helper = ctx.helper;
    harness.buildCheckoutForm();
  });

  afterEach(() => {
    harness.releaseWidgets($);
    $(document.body).off("input.twoincManualEntry");
    document.body.innerHTML = "";
  });

  /**
   * Attach the widget, open it, and wire the affordance the way
   * enableCompanySearch does.
   *
   * @returns {Object} the jQuery-wrapped select
   */
  function openWithAffordance() {
    const $select = harness.openCompanyWidget($, helper);
    helper.bindManualEntryAffordance();
    return $select;
  }

  /** @returns {Object} the dropdown's search input */
  function searchInput() {
    return $(helper.companySearchInputSelector);
  }

  /**
   * Type into the dropdown's search field and fire the event the affordance
   * listens on. Deliberately NOT `.trigger("keyup")` or a debounce flush: the
   * button is specified to appear on input, before any request goes out.
   *
   * @param {string} term what the buyer has typed
   * @returns {void}
   */
  function type(term) {
    searchInput().val(term).trigger("input");
  }

  /** @returns {Object} the results <ul> the picker renders into */
  function resultsList() {
    return $("#billing_company_display").data("select2").$results;
  }

  /** @returns {Object} the manual-entry button, or an empty set */
  function btn() {
    return $("#" + helper.manualEntryRowId);
  }

  /** Activate the button the way a buyer's click or Enter/Space does. */
  function activate() {
    btn().trigger("click");
  }

  /**
   * Guard against a harness that returns before the code under test ran.
   *
   * Every assertion below is about DOM the affordance is supposed to have
   * created. If `bindManualEntryAffordance` silently did nothing — no handler
   * at all — an "is absent" assertion still passes and a "is present" one
   * fails for the wrong reason. This asserts the binding itself happened, so
   * the suite fails loudly at the seam rather than misattributing.
   */
  test("the affordance actually binds — guard for every test below", () => {
    openWithAffordance();

    const bodyEvents = $._data(document.body, "events");
    expect(bodyEvents && bodyEvents.input).toBeDefined();
    expect(
      bodyEvents.input.filter((h) => h.namespace === "twoincManualEntry").length
    ).toBeGreaterThan(0);
    expect(searchInput().length).toBe(1);
  });

  describe("visibility follows the search threshold and nothing else", () => {
    test("absent below the threshold", () => {
      openWithAffordance();

      // Reach the threshold FIRST, so the mechanism is demonstrably live in
      // this test before the absence is asserted. Without this the assertion
      // below is a precondition dressed as a check: the button was never
      // there, so "it is not there" holds no matter what the code does.
      type("a".repeat(helper.companySearchMinLength));
      expect(btn().length).toBe(1);

      type("a".repeat(helper.companySearchMinLength - 1));

      expect(btn().length).toBe(0);
    });

    test("present at the threshold, before any request has been made", () => {
      openWithAffordance();
      const ajax = harness.stubAjax($);

      type("a".repeat(helper.companySearchMinLength));

      expect(btn().length).toBe(1);
      // The point of the timing rule: no round trip has happened, and the
      // button is already there. A `hasSearched` gate would fail this.
      expect(ajax.calls.length).toBe(0);
      ajax.restore();
    });

    test("present above the threshold", () => {
      openWithAffordance();

      type("a".repeat(helper.companySearchMinLength + 4));

      expect(btn().length).toBe(1);
    });

    test("removed again when the buyer deletes back below the threshold", () => {
      openWithAffordance();

      type("a".repeat(helper.companySearchMinLength));
      expect(btn().length).toBe(1);

      type("a".repeat(helper.companySearchMinLength - 1));
      expect(btn().length).toBe(0);
    });

    test("the threshold is read from the shared constant, not hard-coded", () => {
      // Injecting a DIFFERENT number is the only version of this assertion
      // worth having: a test that types three characters passes just as well
      // against a leftover literal 3.
      helper.companySearchMinLength = 5;
      openWithAffordance();

      type("abcd");
      expect(btn().length).toBe(0);

      type("abcde");
      expect(btn().length).toBe(1);
    });
  });

  describe("where the button lives (#30.x.1, #30.x.2)", () => {
    test("it is OUTSIDE the results list, not a row inside it", () => {
      openWithAffordance();

      type("abc");

      // Not a child of the scrollable results list...
      expect(resultsList().children("#" + helper.manualEntryRowId).length).toBe(0);
      // ...but its own element still exists, and is a sibling of that list.
      expect(btn().length).toBe(1);
      expect(btn().prev().is(resultsList())).toBe(true);
    });

    test("it is a real <button>, not a styled row", () => {
      openWithAffordance();

      type("abc");

      expect(btn().prop("tagName")).toBe("BUTTON");
      expect(btn().attr("type")).toBe("button");
    });

    test("it stays visible however many results are already in the (scrollable) list", () => {
      openWithAffordance();
      const $list = resultsList();
      for (let i = 0; i < 30; i++) {
        $list.append(
          '<li class="select2-results__option" data-selected="false">Company ' + i + "</li>"
        );
      }

      type("abc");

      // Still reachable as a plain DOM element regardless of how long the
      // (scrollable) results list got — nothing about finding it depends on
      // scroll position.
      expect(btn().length).toBe(1);
      expect(btn().prev().is($list)).toBe(true);
    });

    test("Tab from the search field reaches it directly, without visiting any option row", () => {
      // select2/selectWoo option rows carry tabindex="-1" — deliberately
      // excluded from the normal Tab sequence (the listbox pattern), reached
      // only by arrow-key navigation. A real <button> with no explicit
      // tabindex participates in the ordinary sequence, so it is the very
      // next tabbable node after the search field once any option rows
      // (all tabindex="-1") are skipped.
      openWithAffordance();
      const $list = resultsList();
      $list.append(
        '<li class="select2-results__option" data-selected="false" tabindex="-1">A company</li>'
      );

      type("abc");

      expect(searchInput().attr("tabindex")).not.toBe("-1");
      expect(btn().attr("tabindex")).not.toBe("-1");
      $list.find("li").each(function () {
        expect($(this).attr("tabindex")).toBe("-1");
      });
    });

    test("it is not churned by repeated syncs on the same keystroke state", () => {
      openWithAffordance();

      type("abc");
      const node = btn()[0];
      type("abc"); // same term again — must not tear down and rebuild
      type("abc");

      expect(btn()[0]).toBe(node);
      expect(btn().length).toBe(1);
    });

    test("the label is the localised msgid, not a hard-coded English literal", () => {
      // Asserting on the English string would pass against a literal in the
      // source. Change what the text map says and require the button to
      // follow.
      ctx.twoinc.text.company_not_in_list = "Selskapet mitt er ikke på listen";
      openWithAffordance();

      type("abc");

      expect(btn().text()).toBe("Selskapet mitt er ikke på listen");
    });
  });

  describe("mouse-button semantics (#30.x.3)", () => {
    test("a plain click activates it", () => {
      jest.useFakeTimers();
      openWithAffordance();
      ctx.Twoinc.getInstance();

      type("abc");
      btn().trigger(new $.Event("click", { button: 0 }));
      jest.advanceTimersByTime(1);

      expect(ctx.twoinc.enable_company_search).toBe("no");
      jest.useRealTimers();
    });

    test("a right click (mouseup, button 2) does not activate it", () => {
      // The bug this replaces: selectWoo's own result-row `mouseup` binding
      // has no button check, so a right click fired the same activation a
      // left click did. A real <button>'s `click` event never fires for a
      // non-primary button in the first place — assert directly that a
      // right-button mouseup on this element causes no activation and no
      // `click` bubbles from it.
      openWithAffordance();
      const clicked = [];
      btn().length; // no-op to satisfy lint on unused-looking helper calls
      type("abc");
      $(document.body).on("click", "#" + helper.manualEntryRowId, () => clicked.push(1));

      btn().trigger(new $.Event("mouseup", { button: 2, which: 3 }));

      expect(clicked).toEqual([]);
      expect(ctx.twoinc.enable_company_search).not.toBe("no");
    });
  });

  describe("activation", () => {
    beforeEach(() => {
      // enterManualCompanyEntry reaches the singleton for the customer-company
      // snapshot; give it one before anything activates the button.
      ctx.Twoinc.getInstance();
    });

    test("it enters manual entry", () => {
      jest.useFakeTimers();
      openWithAffordance();

      type("abc");
      activate();
      // The action is deferred out of the click dispatch.
      jest.advanceTimersByTime(1);

      expect(ctx.twoinc.enable_company_search).toBe("no");
      expect($("#billing_company_display").data("select2")).toBeFalsy();
      expect($("#" + helper.manualEntryRowId).length).toBe(0);
      jest.useRealTimers();
    });

    test("the way back out appears, keyboard-reachable", () => {
      jest.useFakeTimers();
      openWithAffordance();

      type("abc");
      activate();
      jest.advanceTimersByTime(1);

      const $back = $("#" + helper.searchCompanyBtnId);
      expect($back.length).toBe(1);
      // A <button> rather than the unreachable <div> this used to be: focusable
      // and Enter/Space-activatable with no keydown bridge of our own.
      expect($back.prop("tagName")).toBe("BUTTON");
      expect($back.attr("type")).toBe("button");
      // Not `:hidden`: jsdom reports zero dimensions for every element, so that
      // selector matches everything and could never fail. The inline display
      // this code actually sets is the assertable thing.
      expect($back[0].style.display).not.toBe("none");
      jest.useRealTimers();
    });

    test("the way back out is localised, not a hard-coded English literal", () => {
      ctx.twoinc.text.search_company = "Søk etter selskap";
      openWithAffordance();

      expect(ctx.dom.getSearchCompanyBtnNode().text()).toBe("Søk etter selskap");
    });

    test("repeating the activation in one tick switches once, not once per press", () => {
      jest.useFakeTimers();
      openWithAffordance();
      let entered = 0;
      const realEnter = ctx.dom.enterManualCompanyEntry;
      ctx.dom.enterManualCompanyEntry = function () {
        entered++;
        return realEnter.apply(this, arguments);
      };

      try {
        type("abc");
        // The button removes itself on activation, so a second dispatch in
        // the same tick has nothing left to hit.
        btn().trigger("click");
        btn().trigger("click");
        btn().trigger("click");
        jest.advanceTimersByTime(1);

        expect(entered).toBe(1);
      } finally {
        ctx.dom.enterManualCompanyEntry = realEnter;
        jest.useRealTimers();
      }
    });

    test("the real company field is cleared, not just the display one", () => {
      jest.useFakeTimers();
      openWithAffordance();
      $("#billing_company").val("Previously Picked Ltd");
      $("#company_id").val("11111111");

      type("abc");
      activate();
      jest.advanceTimersByTime(1);

      expect($("#billing_company").val()).toBe("");
      expect($("#company_id").val()).toBe("");
      jest.useRealTimers();
    });

    /**
     * Add the address inputs `setAddress` writes to, prefilled the way an
     * address lookup for a picked company leaves them.
     *
     * @returns {void}
     */
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
      openWithAffordance();
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

    test("the address is left alone when the button is reached without ever picking a company", () => {
      jest.useFakeTimers();
      openWithAffordance();
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

    test("the display select's own value is cleared, not just hidden", () => {
      jest.useFakeTimers();
      $("#billing_company_display").append(
        '<option value="ACME Widgets Ltd" selected>ACME Widgets Ltd</option>'
      );
      openWithAffordance();
      expect($("#billing_company_display").val()).toBe("ACME Widgets Ltd");

      type("abc");
      activate();
      jest.advanceTimersByTime(1);

      expect($("#billing_company_display").val()).toBe("");
      jest.useRealTimers();
    });

    test("leaving manual entry clears the hand-typed company and org number", () => {
      jest.useFakeTimers();
      openWithAffordance();

      type("abc");
      activate();
      jest.advanceTimersByTime(1);

      $("#billing_company").val("Hand Typed Ltd");
      $("#company_id").val("99999999");

      ctx.dom.exitManualCompanyEntry();

      expect($("#billing_company").val()).toBe("");
      expect($("#company_id").val()).toBe("");
      jest.useRealTimers();
    });

    test("the way back out is built hidden, before manual entry is entered", () => {
      openWithAffordance();

      const $back = ctx.dom.getSearchCompanyBtnNode();

      expect($back[0].style.display).toBe("none");
      // In place, not floating: it belongs beside the manual company field.
      expect($back.parent().attr("id")).toBe("billing_company_field");
    });

    test("leaving manual entry hides the way back out again", () => {
      jest.useFakeTimers();
      openWithAffordance();

      type("abc");
      activate();
      jest.advanceTimersByTime(1);
      expect($("#" + helper.searchCompanyBtnId)[0].style.display).not.toBe("none");

      ctx.dom.exitManualCompanyEntry();

      expect(ctx.twoinc.enable_company_search).toBe("yes");
      expect($("#" + helper.searchCompanyBtnId)[0].style.display).toBe("none");
      jest.useRealTimers();
    });

    test("a company row still selects normally", () => {
      const selected = [];
      const $select = openWithAffordance();
      $select.on("select2:select", (e) => selected.push(e.params.data));
      const picker = $select.data("select2");

      type("abc");
      const $company = $(
        '<li class="select2-results__option" data-selected="false">A company</li>'
      ).data("data", { id: "A company", text: "A company" });
      resultsList().prepend($company);
      $company.trigger("mouseenter");
      picker.trigger("results:select", {});

      expect(selected.map((d) => d.id)).toEqual(["A company"]);
    });
  });

  describe("handlers are bound once, not once per dropdown open", () => {
    /** @returns {number} how many namespaced input handlers <body> carries */
    function inputHandlerCount() {
      const events = $._data(document.body, "events");
      if (!events || !events.input) return 0;
      return events.input.filter((h) => h.namespace === "twoincManualEntry").length;
    }

    test("still one after five opens and re-binds", () => {
      const $select = openWithAffordance();

      for (let i = 0; i < 5; i++) {
        $select.select2("close");
        $select.select2("open");
        // enableCompanySearch re-runs on a timer and on every return out of
        // manual entry, so re-binding is the normal case, not an edge one.
        helper.bindManualEntryAffordance();
      }

      expect(inputHandlerCount()).toBe(1);
    });

    test("one keystroke produces one button, not one per bind", () => {
      openWithAffordance();
      helper.bindManualEntryAffordance();
      helper.bindManualEntryAffordance();

      type("abc");

      expect(btn().length).toBe(1);
    });

    test("the handler exists before the dropdown's field does", () => {
      // The defect this replaces bound the handler inside a polling callback
      // that fired hundreds of ms after the dropdown opened, so a fast typist's
      // first keystrokes were dropped. Binding is delegated on <body>, so it is
      // in place with no widget attached at all.
      const $select = $("#billing_company_display");
      $select.selectWoo(helper.genSelectWooParams());
      helper.bindManualEntryAffordance();

      expect(inputHandlerCount()).toBe(1);

      $select.select2("open");
      type("abc");

      expect(btn().length).toBe(1);
    });
  });

  describe("focus is not dropped when switching modes", () => {
    beforeEach(() => {
      ctx.Twoinc.getInstance();
    });

    test("entering manual entry focuses the field the buyer asked for", () => {
      jest.useFakeTimers();
      openWithAffordance();

      type("abc");
      activate();
      jest.advanceTimersByTime(1);

      // Destroying the widget leaves activeElement on <body>, which means a
      // keyboard user has to tab in from the top of the document again.
      expect(document.activeElement).toBe($("#billing_company")[0]);
      jest.useRealTimers();
    });

    test("leaving manual entry does not strand focus on the hidden button", () => {
      jest.useFakeTimers();
      openWithAffordance();
      type("abc");
      activate();
      jest.advanceTimersByTime(1);
      jest.useRealTimers();

      ctx.dom.exitManualCompanyEntry();

      expect(document.activeElement).not.toBe($("#" + helper.searchCompanyBtnId)[0]);
      expect(document.activeElement).not.toBe(document.body);
    });

    test("focusing a field that is not there reports failure rather than lying", () => {
      expect(ctx.dom.focusVisibleCompanyField("#no_such_field_at_all")).toBe(false);
      expect(ctx.dom.focusVisibleCompanyField("#billing_company")).toBe(true);
    });

    test("a disabled field reports failure rather than lying", () => {
      $("#billing_company").prop("disabled", true);

      expect(ctx.dom.focusVisibleCompanyField("#billing_company")).toBe(false);
      expect(document.activeElement).not.toBe($("#billing_company")[0]);

      $("#billing_company").prop("disabled", false);
      expect(ctx.dom.focusVisibleCompanyField("#billing_company")).toBe(true);
    });
  });

  describe("a re-created widget heals itself", () => {
    beforeEach(() => {
      ctx.Twoinc.getInstance();
    });

    test("the button survives clearing the selected company", () => {
      const $select = openWithAffordance();
      type("abc");
      expect(btn().length).toBe(1);

      // The real gesture: the × on the floating company id. It re-creates the
      // widget and knows nothing about this affordance, so nothing re-binds.
      ctx.dom.clearSelectedCompany();
      $select.select2("open");

      type("abc");
      expect(btn().length).toBe(1);
    });

    test("clearing the selected company resets the registry-address flag", () => {
      const twoinc = ctx.Twoinc.getInstance();
      twoinc.registryAddressApplied = true;

      ctx.dom.clearSelectedCompany();

      expect(twoinc.registryAddressApplied).toBe(false);
    });
  });

  describe("the sole-trader round trip", () => {
    beforeEach(() => {
      ctx.Twoinc.getInstance();
    });

    test("manual entry survives a trip through sole trader and back", () => {
      jest.useFakeTimers();
      openWithAffordance();

      type("abc");
      activate();
      jest.advanceTimersByTime(1);
      jest.useRealTimers();
      expect(ctx.twoinc.enable_company_search).toBe("no");

      ctx.soleTrader.setMode("sole_trader");
      expect($("#" + helper.searchCompanyBtnId)[0].style.display).toBe("none");

      ctx.soleTrader.setMode("business");

      expect(ctx.twoinc.enable_company_search).toBe("no");
      expect($("#" + helper.searchCompanyBtnId)[0].style.display).not.toBe("none");
    });
  });

  describe("returning to search lands the buyer IN the search box", () => {
    beforeEach(() => {
      ctx.Twoinc.getInstance();
    });

    /** @returns {Object} the picker's container element, or an empty set */
    function container() {
      const picker = $("#billing_company_display").data("select2");
      return picker ? picker.$container : $();
    }

    /**
     * Enter manual entry through the button, the way a buyer does.
     *
     * @returns {void}
     */
    function enterManualEntry() {
      jest.useFakeTimers();
      openWithAffordance();
      type("abc");
      activate();
      jest.advanceTimersByTime(1);
      jest.useRealTimers();
      expect($("#billing_company_display").data("select2")).toBeUndefined();
    }

    test("the dropdown is open, not just re-attached", () => {
      enterManualEntry();

      ctx.dom.exitManualCompanyEntry();

      expect(container().hasClass("select2-container--open")).toBe(true);
      expect($("#select2-billing_company_display-results").length).toBe(1);
    });

    test("the caret is in the dropdown's search box, not on the closed combobox", () => {
      enterManualEntry();

      ctx.dom.exitManualCompanyEntry();

      const input = searchInput();
      expect(input.length).toBe(1);
      expect(document.activeElement).toBe(input[0]);
      expect(document.activeElement).not.toBe(
        $("#billing_company_display_field .select2-selection")[0]
      );
      expect(document.activeElement).not.toBe(document.body);
    });

    test("the buyer can type straight away and the button comes back", () => {
      enterManualEntry();

      ctx.dom.exitManualCompanyEntry();

      $(document.activeElement).val("abc").trigger("input");

      expect(btn().length).toBe(1);
    });

    test("opening an already-open dropdown is a no-op, not a second dropdown", () => {
      enterManualEntry();
      ctx.dom.exitManualCompanyEntry();

      expect(ctx.dom.openCompanySearchDropdown()).toBe(true);

      expect(container().hasClass("select2-container--open")).toBe(true);
      expect($("#select2-billing_company_display-results").length).toBe(1);
      expect(document.activeElement).toBe(searchInput()[0]);
    });

    test("a focus that fails does not drag focus back onto the collapsed combobox", () => {
      enterManualEntry();
      const realFocus = ctx.dom.focusVisibleCompanyField;
      jest.spyOn(ctx.dom, "focusVisibleCompanyField").mockImplementation((selector) => {
        if (selector === helper.companySearchInputSelector) return false;
        return realFocus.call(ctx.dom, selector);
      });

      ctx.dom.exitManualCompanyEntry();

      expect(container().hasClass("select2-container--open")).toBe(true);
      expect(document.activeElement).not.toBe(
        $("#billing_company_display_field .select2-selection")[0]
      );
    });

    test("no picker attached reports failure rather than lying", () => {
      harness.releaseWidgets($);

      expect(ctx.dom.openCompanySearchDropdown()).toBe(false);
    });

    test("a surface with no company select at all still reports failure", () => {
      document.body.innerHTML = "";

      expect(ctx.dom.openCompanySearchDropdown()).toBe(false);
    });
  });

  describe("the pay-for-order surface", () => {
    test("the affordance needs no template markup on the page", () => {
      jest.useFakeTimers();
      expect($(".company_not_in_btn").length).toBe(0);
      expect($("#" + helper.searchCompanyBtnId).length).toBe(0);
      ctx.Twoinc.getInstance();

      openWithAffordance();
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
