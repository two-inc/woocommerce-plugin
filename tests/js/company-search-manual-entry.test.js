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

      // Reach the threshold FIRST, so the mechanism is demonstrably live in
      // this test before the absence is asserted. Without this the assertion
      // below is a precondition dressed as a check: the row was never in the
      // list, so "it is not there" holds no matter what the code does, and no
      // mutation could turn this test red. It was in fact the one test in this
      // file that survived all 25.
      type("a".repeat(helper.companySearchMinLength));
      expect(row().length).toBe(1);

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
      // Programmatically focusable, which is what lets the picker's own
      // focus-the-highlighted-row call actually land.
      expect($row.attr("tabindex")).toBe("-1");
    });

    test("it carries the same attributes the picker gives a real option", () => {
      // Rather than restate a list of attributes this test could drift from,
      // compare against what the widget itself produces. If the library ever
      // adds a navigation-relevant attribute, this fails instead of the row
      // silently falling out of the navigable set.
      const $select = openWithAffordance();
      const picker = $select.data("select2");
      const real = picker.results.option({ id: "Real Co", text: "Real Co", _resultId: "real-co" });

      type("abc");
      const $row = row();

      ["role", "data-selected", "tabindex"].forEach((attr) => {
        expect($row.attr(attr)).toBe($(real).attr(attr));
      });
    });

    test("real DOM focus follows the highlight — the picker's own routine", () => {
      const $select = openWithAffordance();
      const picker = $select.data("select2");
      const $list = resultsList();
      $list.append(
        $('<li class="select2-results__option" data-selected="false" tabindex="-1">A company</li>')
          .attr("id", "a-company-row")
          .data("data", { id: "A company", text: "A company", _resultId: "a-company-row" })
      );

      type("abc");

      picker.trigger("results:next", {});
      picker.trigger("results:next", {});
      // What the picker calls on every arrow keypress. Its own source says this
      // is required for screen readers; on a row with no tabindex it is a
      // silent no-op and focus stays on the previous row.
      picker.focusOnActiveElement();

      expect(document.activeElement).toBe(row()[0]);
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
      // The dropdown's own search field carries it too, and that is the element
      // the field's aria-owns points FROM — so it is the one an AT client
      // following the combobox pattern reads. Both are fed from the payload's
      // _resultId; asserting only one left the other free to be wrong.
      expect(searchInput().attr("aria-activedescendant")).toBe(helper.manualEntryRowId);
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
      jest.useRealTimers();
    });

    test("the way back out is localised, not a hard-coded English literal", () => {
      // Asserting against TEXT.search_company would prove nothing: that value is
      // byte-identical to the built-in fallback, so deleting the text-map lookup
      // entirely leaves the assertion passing. Inject a DIFFERENT string, the
      // way the row's own label test does.
      ctx.twoinc.text.search_company = "Søk etter selskap";
      openWithAffordance();

      expect(ctx.dom.getSearchCompanyBtnNode().text()).toBe("Søk etter selskap");
    });

    test("repeating the activation in one tick switches once, not once per press", () => {
      jest.useFakeTimers();
      const $select = openWithAffordance();
      const picker = $select.data("select2");
      let entered = 0;
      const realEnter = ctx.dom.enterManualCompanyEntry;
      ctx.dom.enterManualCompanyEntry = function () {
        entered++;
        return realEnter.apply(this, arguments);
      };

      try {
        type("abc");
        // The selection is prevented, so the dropdown does NOT close and the row
        // is still there to be hit again in the same tick.
        row().trigger("mouseenter");
        picker.trigger("results:select", {});
        picker.trigger("results:select", {});
        picker.trigger("results:select", {});
        jest.advanceTimersByTime(1);

        expect(entered).toBe(1);
      } finally {
        ctx.dom.enterManualCompanyEntry = realEnter;
        jest.useRealTimers();
      }
    });

    test("the real company field is cleared, not just the display one", () => {
      jest.useFakeTimers();
      const $select = openWithAffordance();
      const picker = $select.data("select2");
      // What a completed pick leaves behind.
      $("#billing_company").val("Previously Picked Ltd");
      $("#company_id").val("11111111");

      type("abc");
      row().trigger("mouseenter");
      picker.trigger("results:select", {});
      jest.advanceTimersByTime(1);

      // Otherwise the manual field the buyer is about to see is pre-filled with
      // the company they just said is not theirs, next to an empty org number.
      expect($("#billing_company").val()).toBe("");
      expect($("#company_id").val()).toBe("");
      jest.useRealTimers();
    });

    /**
     * Add the address inputs `setAddress` writes to, prefilled the way an
     * address lookup for a picked company leaves them.
     *
     * They are created here rather than in the shared form because `.val()` on
     * an empty set is a silent no-op: if the fields were absent, a "cleared"
     * assertion would read undefined and could never fail.
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
      // The precondition, asserted rather than assumed — see above.
      expect($("#billing_address_1").val()).toBe("Registry Street 1");
      expect($("#billing_address_2").val()).toBe("Flat 2");
      expect($("#billing_city").val()).toBe("Registryville");
      expect($("#billing_postcode").val()).toBe("0001");
    }

    test("the disowned company's registry address does not survive into the order", () => {
      jest.useFakeTimers();
      const $select = openWithAffordance();
      const picker = $select.data("select2");
      givenLookedUpAddress();

      // The gate reads this flag, not `#company_id` (see the comment at the
      // clear site): `#company_id` is also written by account-restore and
      // sole-trader code with no lookup behind it, and stays empty for a
      // picked company with no organisation number even though its lookup DID
      // run — so faking a pick via `#company_id` would prove the wrong thing.
      // The flag's own producer (`addressLookup`'s success branch) is
      // exercised separately below.
      ctx.Twoinc.getInstance().registryAddressApplied = true;

      type("abc");
      row().trigger("mouseenter");
      picker.trigger("results:select", {});
      jest.advanceTimersByTime(1);

      // Otherwise the order ships to the address of the company the buyer has
      // just said is not theirs, in fields they never visibly touched.
      expect($("#billing_address_1").val()).toBe("");
      expect($("#billing_address_2").val()).toBe("");
      expect($("#billing_city").val()).toBe("");
      expect($("#billing_postcode").val()).toBe("");
      // And the flag itself is consumed, not left set for the next entry.
      expect(ctx.Twoinc.getInstance().registryAddressApplied).toBe(false);
      jest.useRealTimers();
    });

    test("the address is left alone when the row is reached without ever picking a company", () => {
      // The ordinary path: type to the threshold, see nothing you like, click
      // "not on the list". No pick, so no lookup ever ran — clearing the
      // address here would wipe the buyer's own account-prefilled address for
      // no reason. This is the scenario an unconditional clear, or a clear
      // gated on `#company_id` alone, gets wrong: a logged-in buyer can have
      // `#company_id` prefilled by account-restore with no lookup behind it.
      jest.useFakeTimers();
      const $select = openWithAffordance();
      const picker = $select.data("select2");
      givenLookedUpAddress();
      $("#company_id").val("11111111"); // account-restored, not a fresh pick
      // registryAddressApplied deliberately left false — no lookup ran.

      type("abc");
      row().trigger("mouseenter");
      picker.trigger("results:select", {});
      jest.advanceTimersByTime(1);

      expect($("#billing_address_1").val()).toBe("Registry Street 1");
      expect($("#billing_address_2").val()).toBe("Flat 2");
      expect($("#billing_city").val()).toBe("Registryville");
      expect($("#billing_postcode").val()).toBe("0001");
      jest.useRealTimers();
    });

    test("a picked company with no organisation number still has its looked-up address cleared", () => {
      // A company hit can carry no organisation number at all (optional
      // field) and still have had a real address lookup run for it — the
      // lookup is keyed off `lookup_id`, not the org number. Gating on
      // `#company_id` being non-empty would let this case through; gating on
      // the flag does not.
      jest.useFakeTimers();
      const $select = openWithAffordance();
      const picker = $select.data("select2");
      givenLookedUpAddress();
      $("#company_id").val(""); // the org-number-less pick, as it lands in the DOM
      ctx.Twoinc.getInstance().registryAddressApplied = true;

      type("abc");
      row().trigger("mouseenter");
      picker.trigger("results:select", {});
      jest.advanceTimersByTime(1);

      expect($("#billing_address_1").val()).toBe("");
      expect($("#billing_address_2").val()).toBe("");
      expect($("#billing_city").val()).toBe("");
      expect($("#billing_postcode").val()).toBe("");
      jest.useRealTimers();
    });

    test("addressLookup sets the flag only on a successful response with addresses", () => {
      // Closes the coupling gap: everything above sets/reads the flag
      // directly, so nothing proves `addressLookup` itself is the flag's real
      // producer. Drive it through a picked select2:select the way
      // `enableCompanySearch` wires it, with a stubbed ajax response.
      $("form[name='checkout']").append(
        [
          "<input type='text' id='billing_address_1' />",
          "<input type='text' id='billing_address_2' />",
          "<input type='text' id='billing_city' />",
          "<input type='text' id='billing_postcode' />"
        ].join("\n")
      );
      const ajax = harness.stubAjax($);
      const twoinc = ctx.Twoinc.getInstance();
      expect(twoinc.registryAddressApplied).toBe(false);

      twoinc.addressLookup({ lookup_id: "lookup-1" });
      expect(twoinc.registryAddressApplied).toBe(false); // not yet — pending

      ajax.calls[0].succeed({
        addresses: [
          { street_address: "Registry Street 1", city: "Registryville", postal_code: "0001" }
        ]
      });

      expect(twoinc.registryAddressApplied).toBe(true);
      expect($("#billing_address_1").val()).toBe("Registry Street 1");

      // A response carrying no `addresses` key at all (the lookup found
      // nothing) must not falsely arm the flag.
      twoinc.registryAddressApplied = false;
      twoinc.addressLookup({ lookup_id: "lookup-2" });
      ajax.calls[1].succeed({});
      expect(twoinc.registryAddressApplied).toBe(false);

      ajax.restore();
    });

    test("the display select's own value is cleared, not just hidden", () => {
      jest.useFakeTimers();
      // A completed pick leaves the picked option selected on the underlying
      // <select>, and select2("destroy") does not touch it. Left behind, the
      // combobox re-appears showing the company the buyer just disowned.
      $("#billing_company_display").append(
        '<option value="ACME Widgets Ltd" selected>ACME Widgets Ltd</option>'
      );
      const $select = openWithAffordance();
      const picker = $select.data("select2");
      expect($("#billing_company_display").val()).toBe("ACME Widgets Ltd");

      type("abc");
      row().trigger("mouseenter");
      picker.trigger("results:select", {});
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

      // What the buyer typed by hand while in manual entry.
      $("#billing_company").val("Hand Typed Ltd");
      $("#company_id").val("99999999");

      ctx.dom.exitManualCompanyEntry();

      // Left behind, the org number sits on a field the buyer can no longer
      // see, passes the non-empty guard on the PHP side, and reaches the order
      // while the combobox shows nothing selected.
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

    test("one keystroke appends one row, not one per bind", () => {
      const $select = openWithAffordance();
      helper.bindManualEntryAffordance();
      helper.bindManualEntryAffordance();

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
      helper.bindManualEntryAffordance();

      expect(inputHandlerCount()).toBe(1);

      $select.select2("open");
      type("abc");

      expect(row().length).toBe(1);
    });
  });

  describe("focus is not dropped when switching modes", () => {
    beforeEach(() => {
      ctx.Twoinc.getInstance();
    });

    test("entering manual entry focuses the field the buyer asked for", () => {
      jest.useFakeTimers();
      const $select = openWithAffordance();
      const picker = $select.data("select2");

      type("abc");
      row().trigger("mouseenter");
      picker.trigger("results:select", {});
      jest.advanceTimersByTime(1);

      // Destroying the widget leaves activeElement on <body>, which means a
      // keyboard user has to tab in from the top of the document again.
      expect(document.activeElement).toBe($("#billing_company")[0]);
      jest.useRealTimers();
    });

    test("leaving manual entry does not strand focus on the hidden button", () => {
      jest.useFakeTimers();
      const $select = openWithAffordance();
      const picker = $select.data("select2");
      type("abc");
      row().trigger("mouseenter");
      picker.trigger("results:select", {});
      jest.advanceTimersByTime(1);
      jest.useRealTimers();

      ctx.dom.exitManualCompanyEntry();

      // Whatever it lands on, it must not be the button that was just hidden,
      // and it must not be nothing.
      expect(document.activeElement).not.toBe($("#" + helper.searchCompanyBtnId)[0]);
      expect(document.activeElement).not.toBe(document.body);
    });

    test("focusing a field that is not there reports failure rather than lying", () => {
      // Both callers run on a surface that may not render the field. A bare
      // .focus() on an empty jQuery set is a silent no-op that reads as success.
      expect(ctx.dom.focusVisibleCompanyField("#no_such_field_at_all")).toBe(false);
      expect(ctx.dom.focusVisibleCompanyField("#billing_company")).toBe(true);
    });

    test("a disabled field reports failure rather than lying", () => {
      // A disabled input cannot take focus, so `.focus()` on it is the same
      // silent no-op as an empty set. The caller uses the return value to
      // decide whether to try its fallback target, so the distinction has to
      // be real.
      //
      // What this pins is the CONTRACT, not one line of it. The `disabled`
      // clause and the activeElement check are two independent mechanisms that
      // both produce `false` here, so removing either one alone leaves this
      // green (verified by mutation); removing both turns it red. The clause is
      // kept as the explicit one because it also stops `.trigger("focus")`
      // running focus handlers on a field the buyer cannot reach.
      $("#billing_company").prop("disabled", true);

      expect(ctx.dom.focusVisibleCompanyField("#billing_company")).toBe(false);
      expect(document.activeElement).not.toBe($("#billing_company")[0]);

      // Live probe: the same call on the same field succeeds once enabled, so
      // the false above is the guard firing and not a broken selector.
      $("#billing_company").prop("disabled", false);
      expect(ctx.dom.focusVisibleCompanyField("#billing_company")).toBe(true);
    });
  });

  describe("one handler and one observer, across every re-bind", () => {
    /** @returns {number} namespaced pre-select handlers on the select */
    function selectingHandlerCount($select) {
      const events = $._data($select[0], "events");
      const bucket = events && events["select2:selecting"];
      if (!bucket) return 0;
      return bucket.filter((h) => h.namespace === "twoincManualEntry").length;
    }

    test("still one pre-select handler after several re-binds", () => {
      // A duplicate here fires the whole manual-entry switch twice per
      // activation. The body-input counter next door does not see this handler
      // at all — it lives on the select.
      const $select = openWithAffordance();

      expect(selectingHandlerCount($select)).toBe(1);

      helper.bindManualEntryAffordance();
      helper.bindManualEntryAffordance();
      helper.bindManualEntryAffordance();

      expect(selectingHandlerCount($select)).toBe(1);
    });

    /**
     * Record every MutationObserver, keyed on what it ends up observing.
     *
     * Filtering by target is not tidying: the widget constructs a
     * MutationObserver of its OWN inside `_registerDomEvents`, one per widget.
     * A test that merely counts constructions counts the library's too, so it
     * reads 2 when the plugin made 1 and 3 when it made 1 — it fails for a
     * reason that has nothing to do with this code.
     *
     * @returns {{on: Function, restore: Function}}
     */
    function observerSpy() {
      const real = global.MutationObserver;
      const records = [];
      global.MutationObserver = function (cb) {
        const observer = new real(cb);
        const record = { target: null, disconnected: false };
        const observe = observer.observe.bind(observer);
        const disconnect = observer.disconnect.bind(observer);
        observer.observe = function (node, opts) {
          record.target = node;
          return observe(node, opts);
        };
        observer.disconnect = function () {
          record.disconnected = true;
          return disconnect();
        };
        records.push(record);
        return observer;
      };
      return {
        /** @returns {Array} records whose observed node is `node` */
        on: function (node) {
          return records.filter((r) => r.target === node);
        },
        restore: function () {
          global.MutationObserver = real;
        }
      };
    }

    test("still one observer on the results list after several re-binds", () => {
      const spy = observerSpy();
      try {
        const $select = openWithAffordance();
        const list = resultsList()[0];

        helper.bindManualEntryAffordance();
        helper.bindManualEntryAffordance();
        // Several keystrokes, not one. The watcher is installed from the
        // per-keystroke sync — that is what makes a re-created widget heal
        // itself — so a single keystroke cannot tell "installed once" from
        // "re-installed on every character". Without the per-node guard this
        // churns one observer per keystroke.
        type("abc");
        type("abcd");
        type("abcde");
        type("abcdef");

        const mine = spy.on(list);
        expect(mine.length).toBe(1);
        expect(mine.filter((o) => !o.disconnected).length).toBe(1);
      } finally {
        spy.restore();
      }
    });

    test("a replacement results list gets the observer, the old one is released", () => {
      const spy = observerSpy();
      try {
        const $select = openWithAffordance();
        const firstList = resultsList()[0];
        type("abc");
        expect(spy.on(firstList).length).toBe(1);

        // What clearing the selected company does: a brand-new widget, and so a
        // brand-new results list.
        $select.select2("destroy");
        $select.html("");
        $select.selectWoo(helper.genSelectWooParams());
        $select.select2("open");
        type("abc");

        const secondList = resultsList()[0];
        expect(secondList).not.toBe(firstList);
        expect(spy.on(secondList).length).toBe(1);
        // The old one was let go rather than left watching a detached node for
        // the life of the page.
        expect(spy.on(firstList)[0].disconnected).toBe(true);
      } finally {
        spy.restore();
      }
    });
  });

  describe("a re-created widget heals itself", () => {
    beforeEach(() => {
      ctx.Twoinc.getInstance();
    });

    test("the row survives clearing the selected company", () => {
      const $select = openWithAffordance();
      type("abc");
      expect(row().length).toBe(1);

      // The real gesture: the × on the floating company id. It re-creates the
      // widget and knows nothing about this affordance, so nothing re-binds.
      ctx.dom.clearSelectedCompany();
      $select.select2("open");

      type("abc");
      expect(row().length).toBe(1);

      // And it must SURVIVE the next render, which is the part that used to
      // break: the delegated input handler still appended the row, then the
      // first result set wiped it and no observer put it back.
      const picker = $("#billing_company_display").data("select2");
      picker.trigger("results:all", {
        data: { results: [{ id: "A company", text: "A company", html: "A company" }] },
        query: { term: "abc" }
      });

      return Promise.resolve().then(() => {
        expect(row().length).toBe(1);
        expect(resultsList().children().last().attr("id")).toBe(helper.manualEntryRowId);
      });
    });

    test("clearing the selected company resets the registry-address flag", () => {
      // Without this, the × button leaves the flag stale true after already
      // blanking the address: pick a company (flag true, address written),
      // click ×, type your OWN address into the now-empty fields, then click
      // "not on the list" — enterManualCompanyEntry sees the stale flag and
      // wipes what you just typed. The same false-positive round 2 fixed,
      // resurfacing through this path if the reset here ever regresses.
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
      const $select = openWithAffordance();
      const picker = $select.data("select2");

      type("abc");
      row().trigger("mouseenter");
      picker.trigger("results:select", {});
      jest.advanceTimersByTime(1);
      jest.useRealTimers();
      expect(ctx.twoinc.enable_company_search).toBe("no");

      // Sole trader snapshots the CURRENT setting — which manual entry has just
      // written as "no" — and business mode restores that snapshot, so the
      // re-enable path early-returns and the picker never comes back.
      ctx.soleTrader.setMode("sole_trader");
      expect($("#" + helper.searchCompanyBtnId)[0].style.display).toBe("none");

      ctx.soleTrader.setMode("business");

      // Without a route back the buyer is stranded in manual entry with no way
      // to reach the picker again.
      expect(ctx.twoinc.enable_company_search).toBe("no");
      expect($("#" + helper.searchCompanyBtnId)[0].style.display).not.toBe("none");
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

    // All three, not just one: dropping #company_id_field from the selector
    // leaves the buyer a name box and nowhere to type the org number — the
    // exact failure the function exists to prevent — and dropping
    // #billing_company_display_field strands the way back to the picker.
    test.each([
      ["#billing_company_display_field"],
      ["#billing_company_field"],
      ["#company_id_field"]
    ])("%s's wrapper follows the field's own visibility", (fieldSelector) => {
      // The pay-for-order page wraps each company input in a container with
      // its own hidden state. Revealing the field alone leaves manual entry
      // with nothing visible, so the wrapper has to follow.
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
