/**
 * TWO-25288. The manual-entry affordance inside the company-search dropdown.
 *
 * The row is a pseudo-option injected into a results list the picker owns and
 * empties on every render, so almost everything worth asserting here is about
 * the seam between the plugin and the widget rather than about a pure function:
 * whether the row is where the picker's keyboard navigation looks for it,
 * whether it survives a re-render, whether activating it is intercepted before
 * a company value is written, and whether the handlers that show it are bound
 * once rather than once per dropdown open.
 *
 * The real widget is used throughout, for the same reason the rest of this
 * suite uses it: the row's reachability IS a property of the widget's own
 * navigation code, and a mock would have to reproduce that code correctly to
 * catch a regression in it — which is exactly the assumption that let the
 * previous, unreachable implementation ship.
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
    helper.bindManualEntryAffordance($select);
    return $select;
  }

  /** @returns {Object} the dropdown's search input */
  function searchInput() {
    return $(helper.companySearchInputSelector);
  }

  /**
   * Type into the dropdown's search field and fire the event the affordance
   * listens on. Deliberately NOT `.trigger("keyup")` or a debounce flush: the
   * row is specified to appear on input, before any request goes out.
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

  /** @returns {Object} the manual-entry row, or an empty set */
  function row() {
    return resultsList().children("#" + helper.manualEntryRowId);
  }

  /**
   * Guard against a harness that returns before the code under test ran.
   *
   * Every assertion below is about DOM the affordance is supposed to have
   * created. If `bindManualEntryAffordance` silently did nothing — no handler,
   * no observer — an "is absent" assertion still passes and a "is present" one
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

      type("a".repeat(helper.companySearchMinLength - 1));

      expect(row().length).toBe(0);
    });

    test("present at the threshold, before any request has been made", () => {
      openWithAffordance();
      const ajax = harness.stubAjax($);

      type("a".repeat(helper.companySearchMinLength));

      expect(row().length).toBe(1);
      // The point of the timing rule: no round trip has happened, and the row
      // is already there. A `hasSearched` gate would fail this.
      expect(ajax.calls.length).toBe(0);
      ajax.restore();
    });

    test("present above the threshold", () => {
      openWithAffordance();

      type("a".repeat(helper.companySearchMinLength + 4));

      expect(row().length).toBe(1);
    });

    test("removed again when the buyer deletes back below the threshold", () => {
      openWithAffordance();

      type("a".repeat(helper.companySearchMinLength));
      expect(row().length).toBe(1);

      type("a".repeat(helper.companySearchMinLength - 1));
      expect(row().length).toBe(0);
    });

    test("the threshold is read from the shared constant, not hard-coded", () => {
      // Injecting a DIFFERENT number is the only version of this assertion
      // worth having: a test that types three characters passes just as well
      // against a leftover literal 3.
      helper.companySearchMinLength = 5;
      openWithAffordance();

      type("abcd");
      expect(row().length).toBe(0);

      type("abcde");
      expect(row().length).toBe(1);
    });
  });

  describe("the row is where the picker's keyboard navigation looks", () => {
    test("it is the LAST child of the results list", () => {
      openWithAffordance();
      const $list = resultsList();
      $list.append('<li class="select2-results__option" data-selected="false">A company</li>');

      type("abc");

      expect($list.children().last().attr("id")).toBe(helper.manualEntryRowId);
    });

    test("it is inside the list, not beside it", () => {
      openWithAffordance();

      type("abc");

      expect(row().parent().is(resultsList())).toBe(true);
    });

    test("it carries the attributes the picker navigates by", () => {
      openWithAffordance();

      type("abc");
      const $row = row();

      expect($row.attr("role")).toBe("option");
      expect($row.attr("data-selected")).toBe("false");
      expect($row.attr("aria-selected")).toBe("false");
      expect($row.attr("id")).toBeTruthy();
      expect($row.hasClass("select2-results__option")).toBe(true);
      expect($row.hasClass("select2-results__option--selectable")).toBe(true);
    });

    test("it carries a payload with an id and a matching _resultId", () => {
      openWithAffordance();

      type("abc");
      const data = row().data("data");

      expect(data).toBeTruthy();
      expect(data.id).toBe(helper.manualEntrySentinelId);
      // aria-activedescendant is set from _resultId, so a mismatch makes the
      // row reachable but never announced.
      expect(data._resultId).toBe(row().attr("id"));
      expect(data.text).toBe(TEXT.company_not_in_list);
    });

    test("the picker's own navigation reaches it — a real reachability check", () => {
      openWithAffordance();
      const $select = $("#billing_company_display");
      const picker = $select.data("select2");
      const $list = resultsList();
      // A payload with a _resultId, because the widget's own focus handler
      // reads one off every row it highlights — including the company row it
      // passes through on the way to ours.
      $list.append(
        $('<li class="select2-results__option" data-selected="false">A company</li>')
          .attr("id", "a-company-row")
          .data("data", { id: "A company", text: "A company", _resultId: "a-company-row" })
      );

      type("abc");

      // Arrow down twice from nothing highlighted: once onto the company row,
      // once onto ours. This is the widget's own handler doing the walking, so
      // it passes only if the row is genuinely in the navigable set.
      picker.trigger("results:next", {});
      picker.trigger("results:next", {});

      const $highlighted = $list.find(".select2-results__option--highlighted");
      expect($highlighted.attr("id")).toBe(helper.manualEntryRowId);
      // And it is announced. Two independent places have to agree for a screen
      // reader to name the row: the list's own aria-activedescendant, taken
      // from the highlighted element's id, and the combobox's, taken from the
      // highlighted row's payload `_resultId`.
      expect($list.attr("aria-activedescendant")).toBe(helper.manualEntryRowId);
      expect(picker.selection.$selection.attr("aria-activedescendant")).toBe(
        helper.manualEntryRowId
      );
    });

    test("the label is the localised msgid, not a hard-coded English literal", () => {
      // Asserting on the English string would pass against a literal in the
      // source. Change what the text map says and require the row to follow.
      ctx.twoinc.text.company_not_in_list = "Selskapet mitt er ikke på listen";
      openWithAffordance();

      type("abc");

      expect(row().text()).toBe("Selskapet mitt er ikke på listen");
    });
  });

  describe("it survives the picker emptying the list", () => {
    test("re-appended after a fresh result set is rendered", () => {
      openWithAffordance();
      const $select = $("#billing_company_display");
      const picker = $select.data("select2");

      type("abc");
      expect(row().length).toBe(1);

      // What the picker does on every render: wipe the list, then append.
      picker.trigger("results:all", {
        data: { results: [{ id: "A company", text: "A company", html: "A company" }] },
        query: { term: "abc" }
      });

      // The observer runs as a microtask, so let the queue drain.
      return Promise.resolve().then(() => {
        expect(row().length).toBe(1);
        expect(resultsList().children().last().attr("id")).toBe(helper.manualEntryRowId);
      });
    });

    test("the row is not churned by its own observer", async () => {
      // The sync runs from a MutationObserver on the very list it appends to,
      // so without the "already last, do nothing" early return every append
      // re-triggers the observer and the row is torn down and rebuilt forever.
      // The row surviving as the SAME DOM node across many observer turns is
      // what says the guard is there.
      openWithAffordance();

      type("abc");
      const node = row()[0];
      expect(node).toBeTruthy();

      for (let i = 0; i < 25; i++) await Promise.resolve();

      expect(row()[0]).toBe(node);
      expect(row().length).toBe(1);
    });

    test("not re-appended when the term is back below the threshold", () => {
      openWithAffordance();
      const picker = $("#billing_company_display").data("select2");

      type("abc");
      expect(row().length).toBe(1);

      searchInput().val("ab");
      picker.trigger("results:all", {
        data: { results: [] },
        query: { term: "ab" }
      });

      return Promise.resolve().then(() => {
        expect(row().length).toBe(0);
      });
    });
  });

  describe("activation", () => {
    /**
     * Activate the row the way the picker does for BOTH Enter and a click:
     * highlight it, then ask the picker to select the highlighted row.
     *
     * @returns {void}
     */
    function activate() {
      const picker = $("#billing_company_display").data("select2");
      row().trigger("mouseenter");
      picker.trigger("results:select", {});
    }

    beforeEach(() => {
      // enterManualCompanyEntry reaches the singleton for the customer-company
      // snapshot; give it one before anything activates the row.
      ctx.Twoinc.getInstance();
    });

    test("no company value is written — the selection is prevented", () => {
      const selected = [];
      const $select = openWithAffordance();
      const picker = $select.data("select2");
      $select.on("select2:select", (e) => selected.push(e.params.data));

      type("abc");
      activate();

      expect(selected).toEqual([]);
      expect($("#billing_company").val()).toBe("");
      expect($("#company_id").val()).toBe("");

      // The three assertions above are all "nothing happened", and a recorder
      // that was never wired up — or a widget that stopped emitting at all —
      // satisfies every one of them. They would pass for the wrong reason and
      // could not fail. So prove the recorder is LIVE on the same widget, in
      // the same test: an ordinary row selected the ordinary way IS recorded,
      // and the sentinel is still absent.
      const $company = $(
        '<li id="live-probe-row" class="select2-results__option" data-selected="false">Probe Co</li>'
      ).data("data", { id: "Probe Co", text: "Probe Co", _resultId: "live-probe-row" });
      resultsList().prepend($company);
      $company.trigger("mouseenter");
      picker.trigger("results:select", {});

      expect(selected.map((d) => d.id)).toEqual(["Probe Co"]);
      expect(selected.map((d) => d.id)).not.toContain(helper.manualEntrySentinelId);
    });

    test("it enters manual entry", () => {
      jest.useFakeTimers();
      openWithAffordance();

      type("abc");
      activate();
      // The action is deferred out of the picker's own event dispatch.
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
      expect($back.text()).toBe(TEXT.search_company);
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
        helper.bindManualEntryAffordance($select);
      }

      expect(inputHandlerCount()).toBe(1);
    });

    test("one keystroke appends one row, not one per bind", () => {
      const $select = openWithAffordance();
      helper.bindManualEntryAffordance($select);
      helper.bindManualEntryAffordance($select);

      type("abc");

      expect(row().length).toBe(1);
      expect(resultsList().children("li[id]").length).toBe(1);
    });

    test("the handler exists before the dropdown's field does", () => {
      // The defect this replaces bound the handler inside a polling callback
      // that fired hundreds of ms after the dropdown opened, so a fast typist's
      // first keystrokes were dropped. Binding is delegated on <body>, so it is
      // in place with no widget attached at all.
      const $select = $("#billing_company_display");
      $select.selectWoo(helper.genSelectWooParams());
      helper.bindManualEntryAffordance($select);

      expect(inputHandlerCount()).toBe(1);

      $select.select2("open");
      type("abc");

      expect(row().length).toBe(1);
    });
  });

  describe("the pay-for-order surface", () => {
    test("the affordance needs no template markup on the page", () => {
      // The billing-form view that used to carry these two nodes is rendered on
      // the checkout page only. Nothing here renders it, and the row and the
      // link back are still built.
      jest.useFakeTimers();
      expect($(".company_not_in_btn").length).toBe(0);
      expect($("#" + helper.searchCompanyBtnId).length).toBe(0);
      ctx.Twoinc.getInstance();

      const $select = openWithAffordance();
      type("abc");
      expect(row().length).toBe(1);

      const picker = $select.data("select2");
      row().trigger("mouseenter");
      picker.trigger("results:select", {});
      jest.advanceTimersByTime(1);

      expect($("#" + helper.searchCompanyBtnId).length).toBe(1);
      jest.useRealTimers();
    });

    test("a company field's wrapper follows the field's own visibility", () => {
      // The pay-for-order page wraps each company input in a container with its
      // own hidden state. Revealing the field alone leaves manual entry with
      // nothing visible, so the wrapper has to follow.
      $("#billing_company_field").wrap('<div class="twoinc-inp-container hidden"></div>');
      $("#billing_company_field").addClass("hidden");

      ctx.dom.syncCompanyFieldWrappers();
      expect($("#billing_company_field").parent().hasClass("hidden")).toBe(true);

      $("#billing_company_field").removeClass("hidden");
      ctx.dom.syncCompanyFieldWrappers();
      expect($("#billing_company_field").parent().hasClass("hidden")).toBe(false);
    });
  });
});
