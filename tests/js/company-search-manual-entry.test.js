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

const fs = require("fs");
const path = require("path");
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
      enable_address_lookup: "no"
    });
    $ = ctx.$;
    helper = ctx.helper;
    harness.buildCheckoutForm();
  });

  afterEach(() => {
    harness.releaseWidgets($);
    $(document.body).off("input.twoincManualEntry");
    $(document.body).off("keydown.twoincManualEntry");
    $(document.body).off("select2:open.twoincManualEntry");
    $(document.body).off("keydown.twoincManualEntryButton");
    document.body.innerHTML = "";
  });

  /**
   * Attach the widget, open it, and wire the affordance the way
   * enableCompanySearch does.
   *
   * @returns {Object} the jQuery-wrapped select
   */
  function openWithAffordance() {
    // Bound BEFORE the open, the way enableCompanySearch does it: the button
    // is now placed by a delegated `select2:open` handler (TWO-25326 §2), so
    // binding after the widget is already open would miss the event that
    // places it.
    helper.bindManualEntryAffordance();
    const $select = harness.openCompanyWidget($, helper);

    // That open handler defers the sync a tick. Flushed by hand here so the
    // rest of the suite does not have to run fake timers to see the button;
    // the deferral itself is covered by its own test below, which does NOT
    // use this helper.
    helper.syncManualEntryButton();
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

  describe("visibility: present whenever the dropdown is open (TWO-25326 §2)", () => {
    /**
     * Dispatch a real Tab keydown at the query field. Same `which: 9`
     * reasoning as the copies in the Tab describes below.
     *
     * @param {Object} $el
     * @returns {Object} the jQuery.Event dispatched
     */
    function tabAtSearch($el) {
      const e = jQuery.Event("keydown", { key: "Tab", which: 9 });
      $el.trigger(e);
      return e;
    }

    test("present as soon as the dropdown opens, before the buyer has typed anything", () => {
      openWithAffordance();

      // The whole point of the requirement: Doug rejected a route into manual
      // entry that makes the buyer type a query they already know will fail.
      // A buyer who knows their company is not in the registry must be able to
      // open the field and leave immediately.
      expect(searchInput().val()).toBe("");
      expect(btn().length).toBe(1);
    });

    test("it is `select2:open` that places it, not only an input event", () => {
      // Deliberately not using openWithAffordance(), which flushes the
      // deferred sync by hand. Nothing here fires an `input` event, so if the
      // open handler were removed the button would never appear — which is
      // exactly the failure the old threshold-gated version had.
      jest.useFakeTimers();
      helper.bindManualEntryAffordance();
      harness.openCompanyWidget($, helper);

      expect(btn().length).toBe(0);
      jest.advanceTimersByTime(1);
      expect(btn().length).toBe(1);
      jest.useRealTimers();
    });

    test("stays put below the search threshold", () => {
      // This is the behaviour reversal. It used to be removed here.
      openWithAffordance();

      type("a".repeat(helper.companySearchMinLength));
      expect(btn().length).toBe(1);

      type("a".repeat(helper.companySearchMinLength - 1));
      expect(btn().length).toBe(1);

      type("");
      expect(btn().length).toBe(1);
    });

    test("present at the threshold, before any request has been made", () => {
      openWithAffordance();
      const ajax = harness.stubAjax($);

      type("a".repeat(helper.companySearchMinLength));

      expect(btn().length).toBe(1);
      // No round trip has happened and the button is there. A `hasSearched`
      // gate would fail this.
      expect(ajax.calls.length).toBe(0);
      ajax.restore();
    });

    test("present above the threshold", () => {
      openWithAffordance();

      type("a".repeat(helper.companySearchMinLength + 4));

      expect(btn().length).toBe(1);
    });

    test("still there after a company has been captured and the dropdown reopened", () => {
      // The regression Doug found live on 2026-08-02. A capture gate used to
      // remove the button as soon as the display select held a value, so a
      // buyer who picked the wrong company and reopened the dropdown to
      // correct it had no route into manual entry at all — and typing no
      // longer brought it back, which the threshold gate before it at least
      // did. §2's "hidden once a company IS selected" is satisfied by the
      // dropdown being shut; it does not mean locking the buyer out of manual
      // entry mid-correction.
      openWithAffordance();
      expect(btn().length).toBe(1);

      $("#billing_company_display").append(
        '<option value="ACME Widgets Ltd" selected>ACME Widgets Ltd</option>'
      );
      helper.syncManualEntryButton();

      expect(btn().length).toBe(1);
    });

    test("a captured company does not disable the Tab shortcut either", () => {
      // The same gate took the keyboard with it: the search-field Tab handler
      // keys on the button existing, so removing the button turned Tab into a
      // no-op that selectWoo's own document handler then swallowed whole —
      // one regression presenting as two (§2 invisible, §4 keyboard trap).
      openWithAffordance();
      $("#billing_company_display").append(
        '<option value="ACME Widgets Ltd" selected>ACME Widgets Ltd</option>'
      );
      helper.syncManualEntryButton();
      type("abc");

      searchInput().get(0).focus();
      const e = tabAtSearch(searchInput());

      expect(e.isDefaultPrevented()).toBe(true);
      expect(document.activeElement).toBe(btn().get(0));
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

  describe("Tab-to-button shortcut (#30.x.6)", () => {
    /**
     * Dispatch a real Tab keydown at the search field, the way the browser
     * would, and return the event so its `defaultPrevented` state can be
     * asserted.
     *
     * `which: 9` because the production handler reads `e.which` (matching
     * the vendored selectWoo bundle's own convention), not `e.key` — a test
     * built on `.key` alone would keep passing against a handler that no
     * longer reads it.
     *
     * @param {Object} opts e.g. { shiftKey: true }
     * @returns {Object} the jQuery.Event dispatched
     */
    function tabAt($el, opts) {
      const e = jQuery.Event("keydown", Object.assign({ key: "Tab", which: 9 }, opts || {}));
      $el.trigger(e);
      return e;
    }

    test("Tab while the dropdown is open moves focus straight to the button", () => {
      openWithAffordance();
      type("a".repeat(helper.companySearchMinLength));
      expect(btn().length).toBe(1);

      searchInput().get(0).focus();
      const e = tabAt(searchInput());

      expect(e.isDefaultPrevented()).toBe(true);
      expect(document.activeElement).toBe(btn().get(0));
    });

    test("Shift+Tab is left alone — our handler does not touch the button", () => {
      // Not asserting `isDefaultPrevented()` here: selectWoo's own vendored
      // document-level handler (see the comment above the production code)
      // treats Tab as Enter whenever the dropdown is open regardless of
      // Shift — confirmed directly against the real library, not this
      // plugin's code — so `preventDefault` already happens independent of
      // this feature and is not a contract this handler owns. What IS this
      // handler's contract is the early return on `e.shiftKey`: mutate it
      // away and this test fails, because the button would then receive an
      // explicit `.focus()` call this code makes directly (which jsdom does
      // perform, unlike native Tab traversal it never simulates).
      openWithAffordance();
      type("a".repeat(helper.companySearchMinLength));
      expect(btn().length).toBe(1);

      searchInput().get(0).focus();
      tabAt(searchInput(), { shiftKey: true });

      expect(document.activeElement).not.toBe(btn().get(0));
    });

    test("Tab with no button to reach still closes the dropdown and moves on", () => {
      // Measured live 2026-08-02 in exactly this state: with no button, this
      // handler used to `return` and let the keystroke through — straight into
      // selectWoo's document-level handler, which swallows it whole
      // (preventDefault + refocus the search field). Focus never left the
      // query field and the dropdown never closed. That is the keyboard trap
      // §4 forbids, and "no button" is reachable in production through a brand
      // overlay that drops the affordance.
      jest.useFakeTimers();
      openWithAffordance();
      type("abc");
      btn().remove();
      expect(btn().length).toBe(0);

      const onwards = helper.tabbablesAfterCompanyField()[0];
      expect(onwards).toBeDefined();

      searchInput().get(0).focus();
      const e = tabAt(searchInput());

      expect(e.isDefaultPrevented()).toBe(true);
      expect($("#billing_company_display").data("select2").isOpen()).toBe(false);
      expect(document.activeElement).toBe(onwards);

      jest.advanceTimersByTime(30);
      expect(document.activeElement).toBe(onwards);
      jest.useRealTimers();
    });

    test("a button that refuses focus is not a dead end either", () => {
      // `.focus()` on a hidden or mid-transition element silently no-ops per
      // the HTML spec. The shortcut used to call it and assume — the same
      // mistake that shipped in the Tab-out handler and had to be fixed there.
      jest.useFakeTimers();
      openWithAffordance();
      type("abc");
      btn().get(0).focus = function () {};

      const onwards = helper.tabbablesAfterCompanyField()[0];

      searchInput().get(0).focus();
      tabAt(searchInput());

      expect($("#billing_company_display").data("select2").isOpen()).toBe(false);
      expect(document.activeElement).toBe(onwards);
      jest.useRealTimers();
    });

    test("no-trap regression check: closing the dropdown removes this handler's own hook, not just the button", () => {
      // This is the #30.x.4 regression this change must not reintroduce.
      // Rather than asserting on a DIFFERENT field never in scope for this
      // selector (which would pass even if the selector were broadened to
      // match anything, since #billing_company never matched it either way),
      // prove the actual mechanism: selectWoo's own `close` handling strips
      // `aria-owns` off the search field it belongs to — which is exactly
      // what `companySearchInputSelector` keys on — so once the dropdown is
      // closed this handler's delegated selector provably cannot match
      // ANYTHING any more, regardless of what element Tab is pressed on.
      openWithAffordance();
      expect(searchInput().length).toBe(1);

      $("#billing_company_display").select2("close");

      expect(jQuery(helper.companySearchInputSelector).length).toBe(0);

      // And, separately: Tab on a genuinely unrelated field is untouched.
      const $other = $("#billing_company");
      $other.get(0).focus();
      tabAt($other);

      expect(document.activeElement).toBe($other.get(0));
    });

    test("survives selectWoo's own stale focusOnActiveElement() timer stealing focus back", () => {
      // selectWoo's vendored document-level keydown handler schedules a
      // `focusOnActiveElement()` call 1000ms after EVERY typing keystroke
      // (not just Tab), which refocuses whatever result row is currently
      // `.select2-results__option--highlighted` — and every fresh result
      // render auto-highlights the first row. That timer is scheduled from
      // the buyer's PREVIOUS keystroke, before Tab is ever pressed, so
      // `stopPropagation` on the Tab event itself cannot reach it. A buyer
      // who types and then hits Tab within that ~1s window — the normal case
      // for a fast typer — would otherwise see focus land on the button and
      // then get yanked back onto the highlighted company row shortly after.
      jest.useFakeTimers();
      const $select = openWithAffordance();
      const picker = $select.data("select2");

      // Real keydown events, not just `.trigger("input")` — selectWoo's own
      // handler listens for keydown specifically, and this is the mechanism
      // under test.
      "abc".split("").forEach((ch) => {
        searchInput().val(searchInput().val() + ch);
        searchInput().trigger($.Event("keydown", { key: ch, which: ch.charCodeAt(0) }));
        searchInput().trigger("input");
      });

      // A fresh result render, which selectWoo auto-highlights the first row
      // of (Results.prototype.bind's `results:all` handler).
      picker.trigger("results:all", {
        data: { results: [{ id: "Real Co", text: "Real Co", html: "Real Co" }] },
        query: { term: "abc" }
      });
      expect(
        $("#select2-billing_company_display-results").find(".select2-results__option--highlighted")
          .length
      ).toBe(1);
      expect(btn().length).toBe(1);

      searchInput().get(0).focus();
      tabAt(searchInput());
      expect(document.activeElement).toBe(btn().get(0));

      // Run past selectWoo's own 1000ms timer.
      jest.advanceTimersByTime(1100);

      expect(document.activeElement).toBe(btn().get(0));
      jest.useRealTimers();
    });

    test("a second Tab press FROM the button closes the dropdown, moves on, and selects nothing", () => {
      // TWO-25326 §1 and §4, both confirmed broken live on 2026-08-02 and
      // both fixed by the same handler.
      //
      // What this used to do: `stopPropagation` and nothing else. That kept
      // selectWoo's document-level Tab-as-Enter handler from silently
      // selecting the highlighted row — which is real and is still asserted
      // below — but left the dropdown open indefinitely (selectWoo only
      // closes on Escape, a pick, or an outside mousedown) and let native Tab
      // run, which walks off the end of the document because the dropdown is
      // attached to the end of <body>. Live, that landed focus on <body>.
      jest.useFakeTimers();
      const $select = openWithAffordance();
      const picker = $select.data("select2");

      type("abc");
      picker.trigger("results:all", {
        data: { results: [{ id: "Real Co", text: "Real Co", html: "Real Co" }] },
        query: { term: "abc" }
      });
      expect(btn().length).toBe(1);

      searchInput().get(0).focus();
      tabAt(searchInput());
      expect(document.activeElement).toBe(btn().get(0));

      const selected = [];
      $select.on("select2:select", (ev) => selected.push(ev.params.data));

      // Resolved here, from the same function the handler uses, while the
      // dropdown is still up — which is also when the handler resolves it.
      const expectedNext = helper.tabbablesAfterCompanyField()[0];
      expect(expectedNext).toBeDefined();
      expect(document.activeElement).not.toBe(expectedNext);

      const e2 = tabAt(btn());

      // Native Tab is now suppressed on purpose: it cannot reach the next
      // form control from inside a body-attached dropdown, so the traversal
      // is done by hand instead.
      expect(e2.isDefaultPrevented()).toBe(true);
      expect(picker.isOpen()).toBe(false);
      expect(document.activeElement).toBe(expectedNext);

      // Still no silent selection — the original contract, unchanged.
      expect(selected).toEqual([]);
      expect($("#billing_company").val()).toBe("");

      // And it survives selectWoo's own post-close `$selection.focus()`,
      // which it schedules ~1ms out, unconditionally. This is the reason the
      // previous revision refused to close the dropdown at all.
      jest.advanceTimersByTime(30);
      expect(document.activeElement).toBe(expectedNext);
      jest.useRealTimers();
    });

    test("Shift+Tab from the button is left to the browser, and leaves the dropdown open", () => {
      // Reverse Tab from the button should go back to the query field, which
      // sits immediately before it inside the same dropdown. Closing on
      // Shift+Tab would tear down the thing the buyer is navigating back
      // into.
      const $select = openWithAffordance();
      const picker = $select.data("select2");

      type("abc");
      btn().get(0).focus();

      const e = tabAt(btn(), { shiftKey: true });

      expect(e.isDefaultPrevented()).toBe(false);
      expect(picker.isOpen()).toBe(true);
    });

    /**
     * Dispatch a real Enter or Space keydown directly at the button, and
     * return the event so its `defaultPrevented` state can be asserted.
     *
     * `which` matches the vendored selectWoo bundle's own convention, same
     * reasoning as `tabAt` above.
     *
     * @param {number} which 13 (Enter) or 32 (Space)
     * @returns {Object} the jQuery.Event dispatched
     */
    function keyAtButton(which) {
      const e = jQuery.Event("keydown", { which: which });
      btn().trigger(e);
      return e;
    }

    test.each([
      ["Enter", 13],
      ["Space", 32]
    ])(
      "%s, with the button focused, does not get hijacked by selectWoo's document-level handler (#30.x.6 round 3)",
      (name, which) => {
        // Found live: Doug reported both Enter and Space, pressed while the
        // button has focus, routing to the search field instead of
        // activating the button. Root cause: this button's own
        // keydown.twoincManualEntryButton handler only ever intercepted Tab
        // (which === 9) — Enter and Space kept bubbling straight past it to
        // selectWoo's document-level handler, which is gated purely on
        // isOpen() (a CSS class), not on focus. That handler does NOT treat
        // Enter and Space identically, though (checked directly against the
        // vendored bundle): only Enter (like Tab) hits the results:select
        // branch, silently selecting whatever row is highlighted; plain
        // Space matches none of that handler's branches and only inherits
        // its unconditional fallthrough — $searchField.focus() immediately,
        // then focusOnActiveElement() ~1s later. Both keys still end up
        // routing focus back to the search field, just via different
        // mechanisms, which is why both need the same stopPropagation guard
        // regardless of which internal branch they'd otherwise have hit.
        //
        // jsdom does not simulate the browser's native "Enter/Space
        // activates a focused <button>" default action, so this cannot
        // prove the button's own click handler fires from these keys — only
        // that selectWoo's handler is kept from stealing the keydown first.
        // Native activation dispatches the same `click` event a mouse click
        // does, which the "mouse-button semantics" suite already covers.
        const $select = openWithAffordance();
        const picker = $select.data("select2");

        type("abc");
        picker.trigger("results:all", {
          data: { results: [{ id: "Real Co", text: "Real Co", html: "Real Co" }] },
          query: { term: "abc" }
        });
        expect(btn().length).toBe(1);

        searchInput().get(0).focus();
        tabAt(searchInput());
        expect(document.activeElement).toBe(btn().get(0));

        const selected = [];
        $select.on("select2:select", (ev) => selected.push(ev.params.data));

        const e = keyAtButton(which);

        // Not preventDefault'd: the browser's own native button-activation
        // default action for Enter/Space must still be free to run.
        expect(e.isDefaultPrevented()).toBe(false);
        // But selectWoo's document handler must never have seen this event:
        // no row silently selected, no value written, focus untouched.
        expect(selected).toEqual([]);
        expect($("#billing_company").val()).toBe("");
        expect(document.activeElement).toBe(btn().get(0));
      }
    );
  });

  describe("CSS overrides survive a host theme's own styling (#30.x.5, round 3)", () => {
    /**
     * The stylesheet source, read fresh per test rather than cached at
     * module scope: cheap, and keeps each test's failure message pointing at
     * the actual file on disk.
     *
     * jsdom's cascade does not reliably resolve `!important` + specificity
     * across two separate `<style>` sheets (confirmed directly: injecting a
     * synthetic `button { text-transform: uppercase !important; }` theme
     * sheet made jsdom report "uppercase" for #company_not_in_btn too, even
     * though round 2's `!important` fix for that element is already merged
     * and working live — a false failure on code that isn't broken, not a
     * real one). So the proof here is textual, against the shipped rule
     * itself, which is deterministic and matches this repo's existing
     * convention for CSS facts jsdom cannot render (see the spinner GIF byte
     * assertions in company-search-transport.test.js).
     *
     * @returns {string} the raw CSS
     */
    function stylesheetSource() {
      return fs.readFileSync(path.join(harness.REPO_ROOT, harness.STYLESHEET_PATH), "utf8");
    }

    /**
     * Extract a single-id-selector rule's declaration block by name.
     *
     * @param {string} css the stylesheet source
     * @param {string} id e.g. "search_company_btn" (no leading #)
     * @returns {string} the rule's declaration block, or "" if not found
     */
    function ruleBodyFor(css, id) {
      const re = new RegExp("#" + id + "\\s*\\{([^}]*)\\}", "m");
      const m = re.exec(css);
      return m ? m[1] : "";
    }

    test("#search_company_btn declares text-transform: none !important", () => {
      // Round 2 added `text-transform: none !important` to #company_not_in_btn
      // only, on the (correct) reasoning that becoming a real <button> (since
      // #416) made it a target for a host theme's own
      // `button { text-transform: uppercase }` styling — the real Astra
      // selector list Doug found via devtools includes the bare `button`
      // element selector itself, `!important`, which is exactly the shape a
      // non-!important override cannot beat regardless of specificity
      // (importance is compared before specificity in the cascade). That
      // reasoning applies exactly as much to #search_company_btn — it has
      // been a real <button> since the same PR — but the override was never
      // added here, so the theme kept winning on THIS button while the
      // other one was already fixed. Same escalation, same reason, applied
      // to the button that was missed.
      const body = ruleBodyFor(stylesheetSource(), "search_company_btn");
      expect(body).toMatch(/text-transform:\s*none\s*!important/);
    });

    test("#company_not_in_btn still declares it too (round 2 regression guard)", () => {
      const body = ruleBodyFor(stylesheetSource(), "company_not_in_btn");
      expect(body).toMatch(/text-transform:\s*none\s*!important/);
    });
  });

  describe("placement below the visible field, not overlapping it (#30.x.5.3 round 3; reworked #30.x.9)", () => {
    test("#search_company_btn is appended into .woocommerce-input-wrapper, not #billing_company_field directly", () => {
      // See the rule comment above `#search_company_btn` in twoinc.css for
      // why this containing block matters: it is WooCommerce core's own
      // wrapper around just the <input>, no label inside it, so a button
      // appended as its last child lands in normal flow immediately below
      // the input rather than below the label+input combined.
      jest.useFakeTimers();
      openWithAffordance();
      type("abc");
      activate();
      jest.advanceTimersByTime(1);
      jest.useRealTimers();

      const $searchBtn = ctx.helper.getSearchCompanyBtnNode();
      const $parent = $searchBtn.parent();
      expect($parent.hasClass("woocommerce-input-wrapper")).toBe(true);
      expect($searchBtn.closest("#billing_company_field").length).toBe(1);
    });

    test("the button sits in normal flow below the input, not absolutely positioned over it (#30.x.9)", () => {
      // Reported live: the button used to be `position: absolute; top: 50%;
      // transform: translateY(-50%)` against `.woocommerce-input-wrapper` —
      // centred vertically against the input, which put it ON TOP of the
      // input rather than below it. Doug's ruling: no absolute positioning,
      // normal block flow below the field, right-aligned — same pattern as
      // Magento/Luma's `.search_for_company` and Hyvä.
      harness.injectStylesheet();

      jest.useFakeTimers();
      openWithAffordance();
      type("abc");
      activate();
      jest.advanceTimersByTime(1);
      jest.useRealTimers();

      const $searchBtn = ctx.helper.getSearchCompanyBtnNode();

      // The button is the LAST child of the wrapper, after the <input> —
      // i.e. it renders below it in normal document flow.
      const wrapper = $searchBtn.parent();
      expect(wrapper.children().last().get(0)).toBe($searchBtn.get(0));
      expect($searchBtn.prev().is("input")).toBe(true);

      const btnStyle = window.getComputedStyle($searchBtn[0]);
      expect(btnStyle.position).not.toBe("absolute");
      expect(btnStyle.display).toBe("block");
      expect(btnStyle.textAlign).toBe("end");
    });

    test("the wrapper is blockified explicitly, not left to whatever the host theme declares (round 1 review)", () => {
      // Han/Vader, convergent: `.woocommerce-input-wrapper` is a <span> —
      // inline by default — and this repo has no control over what a host
      // theme sets it to. A theme declaring it `display: flex` would put
      // the button back on the same line as the input, silently
      // re-creating the overlap this change removes. `position: relative`
      // stays too — it's what the OLD absolute-positioned button relied on,
      // kept at zero cost so no theme-supplied decoration inside this
      // wrapper silently changes its own positioning context.
      const m = /#billing_company_field\s+\.woocommerce-input-wrapper\s*\{([^}]*)\}/.exec(
        fs.readFileSync(path.join(harness.REPO_ROOT, harness.STYLESHEET_PATH), "utf8")
      );
      expect(m).not.toBeNull();
      expect(m[1]).toMatch(/display:\s*block/);
      expect(m[1]).toMatch(/position:\s*relative/);
    });

    test("#search_company_btn declares its below-the-field gap explicitly (round 1 review — Vader)", () => {
      // Mutation-caught gap: the button's own `display`/`position`/
      // `text-align` were asserted above, but `margin-top` — the actual
      // "sits below the field with a gap" spacing — was not, and a mutation
      // deleting it passed the full suite.
      const m = /^#search_company_btn\s*\{([^}]*)\}/m.exec(
        fs.readFileSync(path.join(harness.REPO_ROOT, harness.STYLESHEET_PATH), "utf8")
      );
      expect(m).not.toBeNull();
      expect(m[1]).toMatch(/margin-top:\s*4px/);
    });

    test("#search_company_btn keeps width: 100% paired with box-sizing: border-box (round 2 review — Vader, correcting round 1)", () => {
      // Round 1 deleted `width: 100%` on the theory that `display: block`
      // alone fills the containing block at `width: auto` — true for an
      // ordinary element, FALSE for a <button>: form controls use intrinsic
      // (shrink-to-fit) sizing at `width: auto` regardless of `display`.
      // Without `width: 100%` this button hugs its own label and sits at
      // the input's left edge, making `text-align: end` a no-op — silently
      // reintroducing a left-aligned link where the design calls for
      // right-aligned. `box-sizing: border-box` is what actually answers
      // round 1's original overflow concern (no global border-box
      // guaranteed anywhere in this stylesheet), so the two must ship
      // together — either alone reproduces a bug.
      const m = /^#search_company_btn\s*\{([^}]*)\}/m.exec(
        fs.readFileSync(path.join(harness.REPO_ROOT, harness.STYLESHEET_PATH), "utf8")
      );
      expect(m).not.toBeNull();
      expect(m[1]).toMatch(/width:\s*100%/);
      expect(m[1]).toMatch(/box-sizing:\s*border-box/);
    });

    test("self-heals a missing .woocommerce-input-wrapper instead of silently falling back to the unpositioned field (found under adversarial review)", () => {
      // A host template that renders #billing_company_field without
      // WooCommerce core's own .woocommerce-input-wrapper span around the
      // input would otherwise leave this button falling back to appending
      // directly onto #billing_company_field — which wraps BOTH the label
      // and the input, so the button would land below the label+input
      // COMBINED rather than immediately below the input alone, silently
      // reproducing the exact "not right below the field" bug this round
      // exists to fix, with nothing to signal the fallback path was taken.
      // getSearchCompanyBtnNode must instead build an equivalent wrapper
      // around the bare input rather than degrade.
      $("#billing_company").unwrap();
      expect($("#billing_company_field .woocommerce-input-wrapper").length).toBe(0);

      const $searchBtn = ctx.helper.getSearchCompanyBtnNode();

      const $parent = $searchBtn.parent();
      expect($parent.hasClass("woocommerce-input-wrapper")).toBe(true);
      expect($parent.get(0)).toBe($("#billing_company").parent().get(0));
      expect($searchBtn.closest("#billing_company_field").length).toBe(1);
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

    test("closes the widget before destroying it, not the other way round (#30.x.13)", () => {
      // Live-reported regression: Tab became unresponsive PAGE-WIDE the
      // moment manual entry was reached, not just near the company field —
      // exactly what selectWoo's own document-level Tab/Enter-as-select
      // handler would produce if left bound with nothing to reason about.
      // That handler is only unbound as part of selectWoo's own CLOSE
      // cleanup — `destroy()` alone, called while the widget is still open
      // (the only way this function is ever reached — the manual-entry row
      // lives INSIDE the open results list), tears down the widget's DOM
      // without ever running that cleanup. `close()` before `destroy()` is
      // the fix; this asserts the ORDER, which is what the fix actually is
      // — asserting only that `select2("destroy")` happened somewhere,
      // without the order, would pass against the old code too.
      const $select = openWithAffordance();
      const calls = [];
      const original = jQuery.fn.select2;
      jest.spyOn(jQuery.fn, "select2").mockImplementation(function (arg) {
        if (arg === "close" || arg === "destroy") calls.push(arg);
        return original.apply(this, arguments);
      });

      expect($select.data("select2").isOpen()).toBe(true);

      jest.useFakeTimers();
      type("abc");
      activate();
      jest.advanceTimersByTime(1);
      jest.useRealTimers();

      expect(calls).toEqual(["close", "destroy"]);
      jQuery.fn.select2.mockRestore();
    });

    test("the way back out appears, keyboard-reachable", () => {
      jest.useFakeTimers();
      openWithAffordance();

      type("abc");
      activate();
      jest.advanceTimersByTime(1);

      const $back = $("#" + helper.searchCompanyBtnId);
      expect($back.length).toBe(1);
      // A <button> rather than the unreachable <div> this used to be:
      // focusable by Tab. Enter/Space activation is NOT native-only, though
      // (round 4, #30.x.7) — see the "Enter/Space activation" describe block
      // below for why this button carries its own keydown bridge.
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

      expect(ctx.helper.getSearchCompanyBtnNode().text()).toBe("Søk etter selskap");
    });

    test("repeating the activation in one tick switches once, not once per press", () => {
      jest.useFakeTimers();
      openWithAffordance();
      let entered = 0;
      const realEnter = ctx.helper.enterManualCompanyEntry;
      ctx.helper.enterManualCompanyEntry = function () {
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
        ctx.helper.enterManualCompanyEntry = realEnter;
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

      // Straight to the switch rather than through the button. With a company
      // captured the manual-entry button is, correctly, no longer offered
      // (TWO-25326 §2), so it is not the route into this state — but the
      // state is still reachable, from sole-trader mode and from the
      // user-meta restore, and what it must do to the display select is
      // unchanged.
      ctx.helper.enterManualCompanyEntry();
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

      ctx.helper.exitManualCompanyEntry();

      expect($("#billing_company").val()).toBe("");
      expect($("#company_id").val()).toBe("");
      jest.useRealTimers();
    });

    test("the way back out is built hidden, before manual entry is entered", () => {
      openWithAffordance();

      const $back = ctx.helper.getSearchCompanyBtnNode();

      expect($back[0].style.display).toBe("none");
      // In place, not floating: it belongs beside the manual company field —
      // specifically inside .woocommerce-input-wrapper (round 3, #30.x.5.3),
      // not directly on #billing_company_field, so it renders immediately
      // below the visible input box rather than below the field's
      // label+input combined.
      expect($back.parent().hasClass("woocommerce-input-wrapper")).toBe(true);
      expect($back.closest("#billing_company_field").length).toBe(1);
    });

    test("a real click activates the way back out even detached from the document (#30.x.13)", () => {
      // Live-reported regression: clicking #search_company_btn did nothing
      // on the real checkout, though a real Enter keypress on the same
      // button (its own directly-bound keydown handler) worked. The
      // activation used to be a `$body.on("click", "#" + searchCompanyBtnId,
      // ...)` delegated handler — which a plain `$btn.trigger("click")`
      // cannot distinguish from a direct binding, because jQuery delegation
      // works identically in jsdom whether or not the real browser's click
      // event actually reaches document.body (that interference is exactly
      // what this suite cannot reproduce — it is a live-browser-only bug).
      //
      // What DOES distinguish the two here: detaching the button from the
      // document before dispatching the click. A delegated `$body.on(...)`
      // handler only ever fires via bubbling up to `document.body` — an
      // element with no parent cannot bubble anywhere, so a delegated
      // handler could never see this click. A handler bound DIRECTLY on the
      // element itself still runs for a native click dispatched at that
      // element, attached or not. This is a real regression test: it fails
      // against the old delegated-only binding and passes against a direct
      // one, without needing a real browser.
      openWithAffordance();
      jest.useFakeTimers();
      type("abc");
      activate();
      jest.advanceTimersByTime(1);
      jest.useRealTimers();

      const $btn = ctx.helper.getSearchCompanyBtnNode();
      const detached = $btn.detach();

      expect(detached.parent().length).toBe(0);
      detached.trigger("click");

      expect(ctx.twoinc.enable_company_search).toBe("yes");
    });

    test("leaving manual entry hides the way back out again", () => {
      jest.useFakeTimers();
      openWithAffordance();

      type("abc");
      activate();
      jest.advanceTimersByTime(1);
      expect($("#" + helper.searchCompanyBtnId)[0].style.display).not.toBe("none");

      ctx.helper.exitManualCompanyEntry();

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

  describe("focus visibility and Enter/Space activation on the way back out (#30.x.7, round 4)", () => {
    /**
     * The stylesheet source, read fresh per test. Textual assertion against
     * the shipped rule, not a jsdom-rendered one — same reasoning as the
     * uppercase-override tests above: jsdom does not reliably resolve
     * `!important` + specificity across separate `<style>` sheets, and this
     * repo's own harness only ever loads one stylesheet at a time anyway
     * (nothing here would exercise a real host-theme collision).
     *
     * @returns {string} the raw CSS
     */
    function stylesheetSource() {
      return fs.readFileSync(path.join(harness.REPO_ROOT, harness.STYLESHEET_PATH), "utf8");
    }

    test("#search_company_btn reserves a dotted border up front, transparent until focused", () => {
      // Reported live: tabbing out of the manual-entry "Company name" field
      // lands focus on this button with nothing visible marking it. The
      // button carried no host-supplied focus styling of its own, and a
      // host theme's own button-focus reset can silently remove the browser
      // default with nothing in this stylesheet to fall back on.
      //
      // Round 4 shipped an outline here; Doug found it ~4px wider than the
      // button's own padding and inconsistent with this checkout's other
      // focus states, and asked for a plain dotted rectangle with square
      // corners instead — a border, not an outline. Round 5. The border's
      // WIDTH and STYLE are reserved in the base (non-focus) rule, not just
      // on :focus, specifically so gaining/losing focus never changes the
      // button's box size (a border occupies box space, unlike outline) —
      // :focus only ever flips the colour.
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
      // The button previously relied on the browser's own default <button>
      // padding, which is what made round 4's outline read as oversized
      // relative to the visible text — the outline sat `outline-offset`
      // away from a box that was already bigger than the text needed. The
      // round-5 border sits flush against the box instead, so the box
      // itself has to be sized close to the text for the border to look
      // right — hence the explicit, tight `0 2px`.
      const m = /^#search_company_btn\s*\{([^}]*)\}/m.exec(stylesheetSource());
      expect(m).not.toBeNull();
      expect(m[1]).toMatch(/padding:\s*0\s+2px/);
    });

    test("Enter activates the button and switches back to search", () => {
      // Found live: Tab reaches this real <button> fine, but Enter/Space,
      // pressed while it has focus, did nothing — it never relies on the
      // browser's native "activate a focused <button>" default action here,
      // unlike #company_not_in_btn's Tab handling (round 3, #30.x.6), because
      // the interference cannot be selectWoo (its widget is destroyed before
      // this button is ever shown — see enterManualCompanyEntry) and is
      // therefore some other, unenumerable external script (most likely
      // WooCommerce core's own checkout.js guarding the whole form against a
      // premature submit on Enter — UNCONFIRMED, see the production comment
      // in getSearchCompanyBtnNode for the caveat). getSearchCompanyBtnNode
      // now binds a keydown handler directly on the element itself, which
      // the DOM's own target-then-bubble dispatch order guarantees runs
      // before any bubble-phase ancestor handler regardless of where that
      // handler lives or when it was registered.
      //
      // The production handler doesn't gate on focus at all (it's bound
      // unconditionally on the element), so `.focus()` below isn't
      // load-bearing for this assertion — it's here to mirror how a buyer
      // actually reaches this keydown (Tab lands them here first).
      jest.useFakeTimers();
      openWithAffordance();
      type("abc");
      activate();
      jest.advanceTimersByTime(1);

      const $searchBtn = ctx.helper.getSearchCompanyBtnNode();
      $searchBtn.get(0).focus();

      const e = jQuery.Event("keydown", { which: 13 });
      $searchBtn.trigger(e);

      expect(e.isDefaultPrevented()).toBe(true);
      expect(ctx.twoinc.enable_company_search).toBe("yes");
      jest.useRealTimers();
    });

    test("Space activates the button and switches back to search", () => {
      jest.useFakeTimers();
      openWithAffordance();
      type("abc");
      activate();
      jest.advanceTimersByTime(1);

      const $searchBtn = ctx.helper.getSearchCompanyBtnNode();
      $searchBtn.get(0).focus();

      const e = jQuery.Event("keydown", { which: 32 });
      $searchBtn.trigger(e);

      expect(e.isDefaultPrevented()).toBe(true);
      expect(ctx.twoinc.enable_company_search).toBe("yes");
      jest.useRealTimers();
    });

    test("other keys do not activate it (selectivity guard, not proof of the fix on its own)", () => {
      // This asserts the handler is selective (which === 13/32 only) — it
      // would pass identically even with the whole round-4 handler deleted,
      // so it's a guard against an over-broad handler, not evidence the
      // Enter/Space fix exists. The two tests above are what actually break
      // on a revert.
      jest.useFakeTimers();
      openWithAffordance();
      type("abc");
      activate();
      jest.advanceTimersByTime(1);

      const $searchBtn = ctx.helper.getSearchCompanyBtnNode();
      $searchBtn.get(0).focus();

      const e = jQuery.Event("keydown", { which: 65 }); // "A"
      $searchBtn.trigger(e);

      expect(e.isDefaultPrevented()).toBe(false);
      expect(ctx.twoinc.enable_company_search).toBe("no");
      jest.useRealTimers();
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

      ctx.helper.exitManualCompanyEntry();

      expect(document.activeElement).not.toBe($("#" + helper.searchCompanyBtnId)[0]);
      expect(document.activeElement).not.toBe(document.body);
    });

    test("focusing a field that is not there reports failure rather than lying", () => {
      expect(ctx.helper.focusVisibleCompanyField("#no_such_field_at_all")).toBe(false);
      expect(ctx.helper.focusVisibleCompanyField("#billing_company")).toBe(true);
    });

    test("a disabled field reports failure rather than lying", () => {
      $("#billing_company").prop("disabled", true);

      expect(ctx.helper.focusVisibleCompanyField("#billing_company")).toBe(false);
      expect(document.activeElement).not.toBe($("#billing_company")[0]);

      $("#billing_company").prop("disabled", false);
      expect(ctx.helper.focusVisibleCompanyField("#billing_company")).toBe(true);
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
      ctx.helper.clearSelectedCompany();
      $select.select2("open");

      type("abc");
      expect(btn().length).toBe(1);
    });

    test("clearing the selected company resets the registry-address flag", () => {
      const twoinc = ctx.Twoinc.getInstance();
      twoinc.registryAddressApplied = true;

      ctx.helper.clearSelectedCompany();

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

    test("switching to sole trader closes the widget before destroying it, not the other way round (#30.x.13, round 1 review — Han)", () => {
      // Same hazard as enterManualCompanyEntry's own close()-before-destroy()
      // fix, in a sibling call site this PR's first pass missed: a buyer can
      // reach sole-trader mode with the search dropdown still OPEN — via the
      // mode chip directly, or via the email-driven autofill prefetch
      // (onEmailChanged) — without ever going through manual entry first.
      // destroy() alone on an open widget skips selectWoo's own close
      // cleanup, which is what unbinds its document-level Tab/Enter-as-select
      // interceptor — the same page-wide-Tab-shaped gap. Asserting only that
      // destroy() happened, without the order, would pass against the old
      // (buggy) code too.
      const $select = openWithAffordance();
      const calls = [];
      const original = jQuery.fn.select2;
      jest.spyOn(jQuery.fn, "select2").mockImplementation(function (arg) {
        if (arg === "close" || arg === "destroy") calls.push(arg);
        return original.apply(this, arguments);
      });

      expect($select.data("select2").isOpen()).toBe(true);

      ctx.soleTrader.setMode("sole_trader");

      expect(calls).toEqual(["close", "destroy"]);
      jQuery.fn.select2.mockRestore();
    });

    test("a deferred manual-entry activation that lands AFTER an async sole-trader switch does not stomp it (#30.x.13, round 2 review — Han+Vader, convergent)", () => {
      // Real race, not hypothetical: `activateManualEntry` removes the
      // button synchronously but defers the actual mode switch via
      // `setTimeout(enterManualCompanyEntry, 0)` (so destroying the widget
      // doesn't happen from inside its own still-unwinding click handler).
      // Separately, the email-driven autofill prefetch can call
      // `twoincSoleTrader.setMode("sole_trader")` on its own, asynchronously,
      // regardless of what the dropdown/manual-entry button is doing (see
      // the comment on `savedManualEntryActive`). If that prefetch's
      // callback lands in the SAME tick window as the pending deferred
      // `enterManualCompanyEntry` — entirely plausible, both are macrotask/
      // microtask-scheduled independently of each other — `setMode` runs
      // first (snapshotting the correct pre-manual-entry state), and then
      // the stale `enterManualCompanyEntry` fires anyway: without a guard it
      // would force `manual_company_entry_active` back to true (wrong —
      // sole trader needs `#company_id_field` for its synthetic id),
      // re-show the search-again button `setMode` just hid, and wipe
      // `#billing_company`/`#company_id` out from under the synthetic id
      // sole-trader mode may have just written. That reproduces the exact
      // #30.x.13 wrong-id-field-visibility symptom via a path this PR's own
      // new flag opened up. This asserts `enterManualCompanyEntry` bails
      // once sole-trader mode has taken over by the time it actually runs.
      jest.useFakeTimers();
      openWithAffordance();
      type("abc");

      // The button's click handler fires synchronously; the mode switch
      // itself is what's deferred.
      activate();

      // Async sole-trader switch races in and completes BEFORE the deferred
      // enterManualCompanyEntry timer fires.
      ctx.soleTrader.setMode("sole_trader");
      expect(ctx.twoinc.manual_company_entry_active).toBe(false);
      expect(ctx.twoinc.enable_company_search).toBe("no");

      // Now the stale deferred callback runs. Without the guard in
      // enterManualCompanyEntry, this forces manual_company_entry_active
      // back to true — wrong, sole trader needs #company_id_field for its
      // synthetic id (see toggleBusinessFields) — reproducing the
      // #30.x.13 wrong-id-field-visibility symptom via this new flag.
      jest.advanceTimersByTime(1);
      jest.useRealTimers();

      // Sole-trader mode must still be intact — not stomped by the late
      // manual-entry activation.
      expect(ctx.twoinc.manual_company_entry_active).toBe(false);
      expect(ctx.twoinc.enable_company_search).toBe("no");
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

      ctx.helper.exitManualCompanyEntry();

      expect(container().hasClass("select2-container--open")).toBe(true);
      expect($("#select2-billing_company_display-results").length).toBe(1);
    });

    test("the caret is in the dropdown's search box, not on the closed combobox", () => {
      enterManualEntry();

      ctx.helper.exitManualCompanyEntry();

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

      ctx.helper.exitManualCompanyEntry();

      $(document.activeElement).val("abc").trigger("input");

      expect(btn().length).toBe(1);
    });

    test("opening an already-open dropdown is a no-op, not a second dropdown", () => {
      enterManualEntry();
      ctx.helper.exitManualCompanyEntry();

      expect(ctx.helper.openCompanySearchDropdown()).toBe(true);

      expect(container().hasClass("select2-container--open")).toBe(true);
      expect($("#select2-billing_company_display-results").length).toBe(1);
      expect(document.activeElement).toBe(searchInput()[0]);
    });

    test("a focus that fails does not drag focus back onto the collapsed combobox", () => {
      enterManualEntry();
      const realFocus = ctx.helper.focusVisibleCompanyField;
      jest.spyOn(ctx.helper, "focusVisibleCompanyField").mockImplementation((selector) => {
        if (selector === helper.companySearchInputSelector) return false;
        return realFocus.call(ctx.dom, selector);
      });

      ctx.helper.exitManualCompanyEntry();

      expect(container().hasClass("select2-container--open")).toBe(true);
      expect(document.activeElement).not.toBe(
        $("#billing_company_display_field .select2-selection")[0]
      );
    });

    test("no picker attached reports failure rather than lying", () => {
      harness.releaseWidgets($);

      expect(ctx.helper.openCompanySearchDropdown()).toBe(false);
    });

    test("a surface with no company select at all still reports failure", () => {
      document.body.innerHTML = "";

      expect(ctx.helper.openCompanySearchDropdown()).toBe(false);
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

  describe("choosing the Tab target out of the dropdown (TWO-25326 §4)", () => {
    /** @returns {HTMLElement|undefined} first candidate, for the common case */
    function firstTarget() {
      return helper.tabbablesAfterCompanyField()[0];
    }

    test("the first candidate is the next tabbable control after the company field, in FORM order", () => {
      openWithAffordance();

      // Not the query field and not the button, even though both follow the
      // anchor in DOCUMENT order — the dropdown is attached to the end of
      // <body>, which is the whole reason native Tab could not do this.
      expect(firstTarget()).toBe($("#billing_company").get(0));
    });

    test("it returns EVERY following tab stop, in order, not just the first", () => {
      // The list is the fix for the live defect on PR #427. One resolved
      // element gave the caller no way to recover when that element turned
      // out not to be focusable, and "nothing focused" hands the race to
      // selectWoo's post-close refocus — which lands on company-name, exactly
      // what Doug reported.
      openWithAffordance();

      expect(helper.tabbablesAfterCompanyField()).toEqual([
        $("#billing_company").get(0),
        $("#company_id").get(0)
      ]);
    });

    test("controls hidden by the `hidden` class are skipped, along with their contents", () => {
      // How this checkout hides a field: the class goes on the `.form-row`
      // wrapper, not the input. In search mode BOTH company inputs are hidden
      // that way behind the picker.
      openWithAffordance();
      $("#billing_company_field, #company_id_field").addClass("hidden");

      expect(helper.tabbablesAfterCompanyField()).toEqual([]);

      $("#company_id_field").removeClass("hidden");
      expect(firstTarget()).toBe($("#company_id").get(0));
    });

    test("`tabindex=-1` and hidden inputs are not tab stops", () => {
      openWithAffordance();
      $("#billing_company").attr("tabindex", "-1");
      $("#company_id_field").before(
        '<input type="hidden" id="a_hidden_input" name="a_hidden_input" value="x" />'
      );

      expect(firstTarget()).toBe($("#company_id").get(0));
    });

    test("nothing after the company field at all answers an empty list", () => {
      openWithAffordance();
      $("#billing_company_field, #company_id_field").remove();

      expect(helper.tabbablesAfterCompanyField()).toEqual([]);
    });

    test("the anchor falls through the combobox, then its wrapper, then the plain input", () => {
      // Three rungs rather than two. The wrapper is the one added after the
      // live failure: it is present whether or not select2 has rendered and
      // wherever the plugin's own field reordering has put the container, so
      // the anchor no longer vanishes just because the combobox was not found
      // where it was looked for — and a vanished anchor is an empty candidate
      // list, which is how focus ended up stranded on company-name.
      openWithAffordance();
      expect(helper.companyFieldTabAnchor()).toBe(
        $("#billing_company_display_field .select2-selection").get(0)
      );

      $("#billing_company_display_field").find(".select2-container").remove();
      expect(helper.companyFieldTabAnchor()).toBe($("#billing_company_display_field").get(0));

      $("#billing_company_display_field").remove();
      expect(helper.companyFieldTabAnchor()).toBe($("#billing_company").get(0));

      $("#billing_company_field").remove();
      expect(helper.companyFieldTabAnchor()).toBeNull();
    });
  });

  describe("landing the focus, not just aiming it (TWO-25326 §4)", () => {
    /**
     * Dispatch a real Tab keydown, the way the browser would. Same shape and
     * same `which: 9` reasoning as the copy in the shortcut describe above.
     *
     * @param {Object} $el
     * @returns {Object} the jQuery.Event dispatched
     */
    function tabAt($el) {
      const e = jQuery.Event("keydown", { key: "Tab", which: 9 });
      $el.trigger(e);
      return e;
    }

    /**
     * A candidate that refuses focus, the way a non-rendered element does in
     * a real browser: `.focus()` is called, nothing happens, and nothing is
     * returned to say so. jsdom does not enforce that rule — it focuses
     * anything — so the behaviour has to be modelled explicitly or no test
     * here can exercise the recovery path at all.
     *
     * @returns {HTMLElement} an element whose focus() is a no-op
     */
    function unfocusable() {
      const el = document.createElement("input");
      document.body.appendChild(el);
      el.focus = function () {};
      return el;
    }

    test("skips a candidate whose focus() silently does nothing", () => {
      openWithAffordance();
      const dead = unfocusable();
      const live = $("#billing_company").get(0);

      expect(helper.focusFirstThatTakes([dead, live])).toBe(live);
      expect(document.activeElement).toBe(live);
    });

    test("answers null when no candidate will take focus", () => {
      openWithAffordance();

      expect(helper.focusFirstThatTakes([unfocusable(), unfocusable()])).toBeNull();
    });

    test("an empty candidate list is not an error", () => {
      openWithAffordance();

      expect(helper.focusFirstThatTakes([])).toBeNull();
    });

    test("a Tab that can find nothing focusable releases the field rather than sitting on it", () => {
      // The live symptom being fixed: focus left on company-name is
      // indistinguishable from Tab having done nothing. <body> at least lets
      // the next Tab resume from the top of the document.
      jest.useFakeTimers();
      openWithAffordance();
      type("abc");

      // Nothing after the company field can be focused.
      $("#billing_company_field, #company_id_field").addClass("hidden");
      expect(helper.tabbablesAfterCompanyField()).toEqual([]);

      btn().get(0).focus();
      tabAt(btn());

      expect(document.activeElement).toBe(document.body);

      // And selectWoo's post-close refocus does not get to undo that.
      jest.advanceTimersByTime(30);
      expect(document.activeElement).toBe(document.body);
      jest.useRealTimers();
    });

    test("focus stolen back to the company field inside the window is taken back again", () => {
      // selectWoo's `container.on('close')` fires `$selection.focus()` 1ms
      // out, unconditionally. Modelled directly here rather than relying on
      // the widget's own timing, so the recovery is pinned even if the
      // vendored bundle changes when it fires.
      jest.useFakeTimers();
      openWithAffordance();
      type("abc");

      btn().get(0).focus();
      tabAt(btn());
      const landed = $("#billing_company").get(0);
      expect(document.activeElement).toBe(landed);

      $("#billing_company_display_field").find(".select2-selection").get(0).focus();

      jest.advanceTimersByTime(30);

      expect(document.activeElement).toBe(landed);
      jest.useRealTimers();
    });

    test("a buyer who moves on themselves is not dragged back", () => {
      jest.useFakeTimers();
      openWithAffordance();
      type("abc");

      btn().get(0).focus();
      tabAt(btn());

      // Let selectWoo's own 1ms post-close refocus land FIRST. Ordering is the
      // point: the buyer can only meaningfully "move on themselves" after that
      // steal, and modelling their click before it would be modelling a 1ms
      // window that no human is in. (Inside that window the steal wins and
      // this code then moves focus to its own target rather than the buyer's
      // click — an accepted trade, and still better than leaving it on
      // company-name.)
      jest.advanceTimersByTime(5);

      const elsewhere = $("#billing_country").get(0);
      elsewhere.focus();

      jest.advanceTimersByTime(30);

      expect(document.activeElement).toBe(elsewhere);
      jest.useRealTimers();
    });
  });
});
