let twoincUtilHelper = {
  /**
   * Check if any element in the list is null or empty
   */
  isAnyElementEmpty: function (values) {
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!v || v.length === 0) {
        return true;
      }
    }

    return false;
  },

  /**
   * Normalise a checkout value read out of the DOM to displayable text
   * (TWO-25288).
   *
   * Null, undefined and whitespace-only all become `""`, so callers can treat
   * "is there a value" as a plain truthiness check without a guard of their own.
   *
   * Whitespace-only is the case worth having: the company picker's empty option
   * carries a non-breaking space as its LABEL (its value is `""`), and that
   * label does reach code — `getCompanyName()` reads the picker's rendered
   * selection text out of the checkout snapshot — where it is a one-character
   * string that is truthy and invisible. `trim()` covers it without special
   * handling, since its whitespace definition includes U+00A0.
   *
   * @param {*} value
   * @returns {string}
   */
  blankToEmpty: function (value) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  },

  /**
   * Construct url to Twoinc checkout api.
   *
   * `client` / `client_v` identify this plugin and its version to the API, and
   * are the only attribution the company-search endpoint can get: the widget
   * runs in the buyer's browser, so the user-agent is the shopper's. They go
   * in the query string rather than a header on purpose — a custom header
   * makes the request non-simple and buys a CORS preflight per keystroke.
   *
   * `params` may be a plain object or a URLSearchParams. It used to be
   * assigned to as an object either way, which silently dropped both fields
   * for every URLSearchParams caller (the company search): `new
   * URLSearchParams(existing)` copies entries, not JS properties. Normalising
   * first, and going through set(), covers both shapes and mutates neither.
   */
  constructTwoincUrl: function (path, params) {
    const searchParams = new URLSearchParams(params || {});
    searchParams.set("client", window.twoinc.client_name);
    searchParams.set("client_v", window.twoinc.client_version);
    return window.twoinc.twoinc_checkout_host + path + "?" + searchParams.toString();
  },

  /**
   * Hash some input to store as key
   */
  getUnsecuredHash: function (inp, seed) {
    if (!seed) seed = 0;
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < inp.length; i++) {
      ch = inp.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
};

let twoincSelectWooHelper = {
  /**
   * Hard ceiling on a single company-search request, ms (TWO-25232). Before
   * this there was no client timeout at all, so a request that never
   * completed left the dropdown spinning forever. Deliberately wider than
   * the backend's own retry envelope for the upstream provider lookup, so a
   * slow-but-arriving response is never cut off client-side — this is the
   * backstop for a request that does not arrive at all.
   */
  companySearchTimeoutMs: 30000,

  /**
   * Characters the buyer must type before the company search runs
   * (TWO-25288). THE single source of this threshold in the plugin: the
   * widget's minimumInputLength reads it, the "not in the list" button's
   * visibility rule reads it, and the min-chars hint is interpolated from it.
   * The hint's PHP string keeps its %d placeholder unresolved for exactly
   * that reason — the number the buyer is told and the number enforced are
   * the same value, so they cannot drift apart.
   */
  companySearchMinLength: 3,

  /**
   * The dropdown's own search field. select2 tears the dropdown down and
   * rebuilds it on every open, so this node is never the same one twice and
   * nothing may hold a reference to it — every use is a fresh lookup, and
   * every handler on it is delegated.
   */
  companySearchInputSelector: 'input[aria-owns="select2-billing_company_display-results"]',

  /**
   * DOM id of the manual-entry button. Unchanged across TWO-25288 (the
   * cloned-<div> version) and the button rework below, so the stylesheet
   * rule and any brand overlays that match it keep working.
   */
  manualEntryRowId: "company_not_in_btn",

  /** DOM id of the link back out of manual entry and into search. */
  searchCompanyBtnId: "search_company_btn",

  /**
   * Text for a company search that could not be completed. Read lazily
   * because window.twoinc is populated by the checkout render; the literal
   * is the last-resort fallback for a page where the localised string is
   * missing (older cached PHP, brand overlay that trims the text map).
   */
  /**
   * Sequence number of the most recently dispatched company-search request.
   * A superseded request must not act on the shared spinner: select2 does
   * abort the previous request before dispatching the next, so today the
   * hide always lands before the next show — but that ordering is an
   * internal detail of select2's ajax adapter, and a stuck-hidden spinner
   * would be a silent regression if it ever changed.
   */
  companySearchSeq: 0,

  companySearchUnavailableText: function () {
    return (
      (window.twoinc && window.twoinc.text && window.twoinc.text.company_search_unavailable) ||
      "Company search is temporarily unavailable. Please try again."
    );
  },

  /**
   * Hint shown in the empty company-search field (TWO-25288). Read lazily for
   * the same reason as the message above.
   */
  companySearchPlaceholderText: function () {
    return (
      (window.twoinc && window.twoinc.text && window.twoinc.text.company_search_placeholder) ||
      "Enter company name to search"
    );
  },

  /**
   * Hint shown while the typed term is below the search threshold
   * (TWO-25288).
   *
   * Deliberately a FIXED number rather than select2's own "N more characters"
   * countdown: the buyer is told what the field needs, not how far off they
   * currently are. The template carries an unresolved %d, interpolated here
   * from companySearchMinLength, so the claimed minimum is the enforced one.
   */
  companySearchTooShortText: function () {
    const template =
      (window.twoinc && window.twoinc.text && window.twoinc.text.company_search_too_short) ||
      "Please enter %d or more characters";
    // Matches gettext's positional form (`%1$d`) as well as the bare `%d` the
    // msgid carries: a translator is entitled to reorder arguments, and the
    // `#, php-format` family of placeholders is what they would reach for. The
    // msgid itself stays `%d` — changing it would invalidate the catalogues.
    return template.replace(/%(\d+\$)?d/, twoincSelectWooHelper.companySearchMinLength);
  },

  /**
   * Label of the manual-entry row (TWO-25288). Read lazily for the same
   * reason as the hints above.
   */
  companyNotInListText: function () {
    return (
      (window.twoinc && window.twoinc.text && window.twoinc.text.company_not_in_list) ||
      "My company is not on the list"
    );
  },

  /** Label of the link back out of manual entry and into search. */
  searchCompanyText: function () {
    return (
      (window.twoinc && window.twoinc.text && window.twoinc.text.search_company) ||
      "Search for company"
    );
  },

  /**
   * Build the manual-entry affordance as a real, focusable button (#30.x.1,
   * #30.x.2, #30.x.3).
   *
   * TWO-25288 made this a pseudo-option `<li role="option">` living INSIDE
   * `.select2-results__options` so it would be arrow-reachable and announced.
   * That traded one accessibility gap for two others:
   *
   *  - `.select2-results__options` is exactly the element select2/selectWoo
   *    apply their own scroll-and-clip to, so the row was only visible if the
   *    buyer scrolled past however many results came back, and the ONLY way
   *    to reach it by keyboard was arrowing down through every one of them —
   *    it carried `tabindex="-1"`, deliberately excluded from the normal Tab
   *    sequence, on purpose, to match the listbox pattern.
   *  - selectWoo's own result-row activation binds on plain `mouseup` with no
   *    button check at all (`Results.prototype.bind`), so a RIGHT click
   *    activated the row exactly like a left click — true of every real
   *    result row too, but only this one was ours to fix.
   *
   * A real `<button>` fixes both: native Tab order, native Enter/Space
   * activation, and a native `click` event that only ever fires for the
   * primary mouse button — no bespoke keydown bridge and no button check to
   * hand-roll.
   *
   * @returns {Object} jQuery-wrapped <button>
   */
  buildManualEntryButton: function () {
    const helper = twoincSelectWooHelper;

    return jQuery("<button></button>")
      .attr({ id: helper.manualEntryRowId, type: "button" })
      .text(helper.companyNotInListText())
      .on("click", function () {
        helper.activateManualEntry();
      });
  },

  /**
   * Switch out of company search into manual entry, from the button's own
   * click handler (#30.x.3).
   *
   * Removes the button before deferring, same reason as before: a second
   * click in the same tick must not queue a second switch. Deferred out of
   * the click dispatch because entering manual entry destroys this widget,
   * and destroying it from inside the event that is still unwinding on it
   * would pull the DOM out from under that unwind.
   *
   * @returns {void}
   */
  activateManualEntry: function () {
    const helper = twoincSelectWooHelper;
    jQuery("#" + helper.manualEntryRowId).remove();
    setTimeout(twoincDomHelper.enterManualCompanyEntry, 0);
  },

  /**
   * Put the manual-entry button right after the results list, or take it
   * away (#30.x.1).
   *
   * A SIBLING of `.select2-results__options`, not a child of it, so it sits
   * outside the part of the dropdown that scrolls: always visible the moment
   * it should be, regardless of how many results came back. Still inside the
   * dropdown itself — appended into `.select2-results`, the same wrapper the
   * results list lives in — so it reads as part of the same panel, just
   * beneath the scrollable area rather than the last row inside it.
   *
   * Visibility rule is "search UI active and nothing captured yet", NOT the
   * search threshold (TWO-25326 §2, found live 2026-08-02).
   *
   * It used to be the threshold and nothing else, which meant the button did
   * not exist in the DOM at all until the buyer had typed three characters.
   * Doug's requirement is the opposite: a buyer who already knows their
   * company is not in the registry must have a route into manual entry
   * WITHOUT typing a doomed query first, so the button is present from the
   * moment the dropdown opens. `bindManualEntryAffordance` therefore also
   * calls this on `select2:open`, not only on `input` — with a threshold gate
   * an open-with-nothing-typed dropdown had nothing to sync.
   *
   * The one thing that DOES hide it is a company already being captured: the
   * gate reads the display select's own value, which is written by the
   * picker's select handler and cleared by `clearSelectedCompany`. A buyer
   * who picks a company and then reopens the dropdown to change it is past
   * the point where "not on the list" means anything, and the ticket calls
   * that state out explicitly.
   *
   * Note this leaves the button in the dropdown's subtree while the dropdown
   * is closed. That is not a stray tab-stop: selectWoo's AttachBody decorator
   * DETACHES the whole dropdown container from the document on close, so a
   * node inside it is not focusable, not rendered and not reachable by Tab
   * until the dropdown is attached again.
   *
   * @returns {void}
   */
  syncManualEntryButton: function () {
    const helper = twoincSelectWooHelper;

    const picker = jQuery("#billing_company_display").data("select2");
    if (!picker || !picker.$results || !picker.$results.length) return;

    const $list = picker.$results;
    const $existing = jQuery("#" + helper.manualEntryRowId);

    // No capture gate. There was one — the button was removed as soon as
    // `#billing_company_display` held a value — and it was wrong, found live
    // by Doug 2026-08-02: pick a company, reopen the dropdown to change it,
    // and there was no route into manual entry at all any more. Worse than
    // the threshold gate it replaced, because typing no longer brought it
    // back either.
    //
    // §2's "hidden once a company IS selected" cannot mean that. This button
    // only ever exists inside the dropdown, so it is only ever on screen
    // while the dropdown is open — and the dropdown being open IS the buyer
    // searching again. "Hidden once selected" is satisfied by the dropdown
    // being shut; it does not extend to locking a buyer out of manual entry
    // because of a pick they are in the middle of correcting.
    //
    // That gate also silently disabled the Tab shortcut, since the handler
    // below keys on the button existing — which is how one regression
    // presented as two (§2 invisible, §4 keyboard trap).

    // Already there, immediately after the current results list: nothing to
    // do. Load-bearing rather than an optimisation for the same reason it was
    // before: an unconditional re-append on every keystroke would tear down
    // and rebuild the same node for no reason.
    if ($existing.length && $existing.prev().is($list)) return;

    $existing.remove();
    $list.after(helper.buildManualEntryButton());
  },

  /**
   * Wire the manual-entry affordance to a company-search widget (TWO-25288,
   * reworked #30.x.1-3).
   *
   * Idempotent by construction. The handler is namespaced and every bind is
   * preceded by the matching `.off()`, so calling this again — and it IS
   * called again, from the 800ms re-run of enableCompanySearch and from every
   * return out of manual entry — leaves exactly one handler bound. The
   * previous implementation bound its input handler inside a polling
   * callback on every dropdown open with no `.off()`, which both accumulated
   * duplicates and missed the first keystrokes of anyone typing faster than
   * the poll interval.
   *
   * No separate activation binding here any more: the button built by
   * `syncManualEntryButton` owns its own click handler directly, since it is
   * a real element outside the results list rather than a pseudo-option the
   * picker's `select2:selecting` event had to be intercepted for.
   *
   * @returns {void}
   */
  bindManualEntryAffordance: function () {
    const helper = twoincSelectWooHelper;

    // Delegated on <body> rather than bound to the search field: that field
    // is destroyed and rebuilt on every open, and delegation means the
    // handler exists before the buyer's first keystroke rather than after a
    // poll notices the field appeared.
    jQuery(document.body)
      .off("input.twoincManualEntry")
      .on("input.twoincManualEntry", helper.companySearchInputSelector, function () {
        helper.syncManualEntryButton();
      });

    // Open, as well as input (TWO-25326 §2). The button's visibility rule is
    // no longer "the buyer has typed enough", so an `input` handler alone can
    // never place it: a buyer who opens the dropdown and types nothing fires
    // no input event at all, and that is precisely the case the requirement
    // is about.
    //
    // Delegated on <body> keyed on the SELECT, not bound to the select2
    // instance, for the same reason the two handlers above are: the instance
    // is thrown away and rebuilt by `clearSelectedCompany` and by every
    // return out of manual entry, and a handler bound to an instance dies
    // with it. `select2:open` is a jQuery event triggered on the original
    // <select>, so it bubbles to <body> like any other.
    //
    // Deferred a tick: `select2:open` fires while the open is still
    // unwinding, and `syncManualEntryButton` needs the results list to be its
    // post-open self before it anchors anything after it.
    jQuery(document.body)
      .off("select2:open.twoincManualEntry")
      .on("select2:open.twoincManualEntry", "#billing_company_display", function () {
        setTimeout(helper.syncManualEntryButton, 0);
      });

    // Tab-to-button shortcut (#30.x.6).
    //
    // Delegated the same way and for the same reason as the input handler
    // above, which is also what scopes this correctly: a delegated handler on
    // the search-field selector only ever fires while THAT field is the
    // keydown target, i.e. while the dropdown is open and the search field
    // itself has focus. That is deliberately narrower than #416's
    // `focusStillWithinCompanySearch` (which also had to cover option rows and
    // the collapsed combobox for a poll running on a timer regardless of
    // focus) — a keydown listener only ever runs when its target already has
    // focus, so there is nothing to check beyond "is this Tab".
    //
    // Only plain Tab is hijacked. Doug asked for Tab to reach the "not on the
    // list" button directly instead of arrowing down through every result;
    // Shift+Tab is left alone on purpose so reverse-tab keeps its ordinary
    // browser behaviour (move to the previous natural tab-stop) rather than
    // also being routed somewhere non-standard.
    //
    // No-op, not a fallback to default Tab, when the button is not currently
    // in the DOM (below the search threshold): `preventDefault` only fires
    // once a target to focus is confirmed, so a buyer who has not typed
    // enough yet still gets plain browser Tab.
    //
    // `e.which` rather than `e.key`, matching the vendored selectWoo bundle's
    // own convention (its `KEYS` module and every keydown branch in
    // selectWoo.full.js read `evt.which`) — one key-reading convention on
    // this shared event chain rather than two, and immune to the (rare) cases
    // where `.key` comes back blank/"Unidentified" on a real keydown while
    // `.which` still resolves.
    //
    // `stopPropagation` is load-bearing, not belt-and-braces. selectWoo's own
    // core binds a `$(document).on('keydown', ...)` handler (see
    // select2/core.js `bindContainerEvents`) that treats a bare Tab exactly
    // like Enter while the dropdown is open: it fires `results:select` on the
    // highlighted row, THEN unconditionally calls `$searchField.focus()` in
    // the same handler, with no check of `evt.isDefaultPrevented()` first.
    // `document` is above `document.body` in the bubble chain, so without
    // stopping propagation here that handler still runs right after this one
    // and yanks focus straight back onto the search field — `preventDefault`
    // alone was proven insufficient (it does not stop the bubble, only the
    // browser's own native Tab action, which select2's handler does not
    // consult). A side effect, and an intentional one: this also means Tab no
    // longer doubles as "accept the highlighted result" the way selectWoo's
    // own Tab-as-Enter branch otherwise would. That is the point of this
    // change — Doug asked for Tab to be a dedicated shortcut to the button,
    // not a second Enter — and Enter itself is untouched.
    //
    // One more of selectWoo's own timers has to be defended against
    // separately, and `stopPropagation` cannot reach it: the SAME document
    // handler also runs on every ordinary typing keystroke (not just Tab) and
    // schedules `focusOnActiveElement()` — which refocuses whatever result
    // row is currently marked `.select2-results__option--highlighted`, and
    // every fresh result render auto-highlights the first row — 1000ms later.
    // That timer is scheduled from the buyer's PREVIOUS keystroke, before
    // this Tab handler ever runs, so stopping propagation on the Tab event
    // itself does nothing to it. A buyer who types quickly and then hits Tab
    // within that ~1s window (the normal case — fast typers are exactly who
    // this shortcut is for) gets focus yanked back onto the highlighted
    // company row shortly after landing on the button. Confirmed
    // reproducible with fake timers before this comment was written.
    // Re-assert focus on the button once, just past that window, but ONLY if
    // selectWoo's timer actually won (`document.activeElement` is a
    // highlighted result row) and the button is still there — so a buyer who
    // has since moved on deliberately (closed the dropdown, tabbed away,
    // clicked the button) is never fought.
    jQuery(document.body)
      .off("keydown.twoincManualEntry")
      .on("keydown.twoincManualEntry", helper.companySearchInputSelector, function (e) {
        if (e.which !== 9 || e.shiftKey) return;

        // No button to shortcut to — a brand overlay that drops the
        // affordance, or any future gating — must NOT fall through to the
        // browser's own Tab. Measured live 2026-08-02, in exactly that state:
        // selectWoo's document-level handler swallows the keystroke whole
        // (`preventDefault` + refocus the search field), so focus never left
        // the query field and the dropdown never closed. That is a keyboard
        // trap, which §4 forbids outright, and it is what the removed capture
        // gate above was producing. Close and move on instead, the same way
        // Tab from the button does.
        const btn = jQuery("#" + helper.manualEntryRowId).get(0);
        if (!btn) {
          const onwards = helper.tabbablesAfterCompanyField();
          e.preventDefault();
          e.stopPropagation();
          helper.closeCompanySearchDropdown();
          if (!helper.focusFirstThatTakes(onwards)) helper.releaseFocusFromCompanyField();
          setTimeout(function () {
            if (!helper.focusIsBackOnCompanyField()) return;
            if (!helper.focusFirstThatTakes(onwards)) helper.releaseFocusFromCompanyField();
          }, 20);
          return;
        }

        // `.focus()` on a button that is hidden or mid-transition silently
        // no-ops per the HTML spec, so confirm it landed rather than assume —
        // same lesson as the Tab-out handler below, which shipped broken for
        // exactly this reason. If the button will not take focus, fall
        // through to closing and moving on rather than stranding the buyer.
        e.preventDefault();
        e.stopPropagation();
        btn.focus();
        if (document.activeElement !== btn) {
          const onwards = helper.tabbablesAfterCompanyField();
          helper.closeCompanySearchDropdown();
          if (!helper.focusFirstThatTakes(onwards)) helper.releaseFocusFromCompanyField();
          return;
        }

        setTimeout(function () {
          const stillThere = jQuery("#" + helper.manualEntryRowId).get(0);
          const stolenByHighlightedRow = jQuery(document.activeElement).is(
            ".select2-results__option--highlighted"
          );
          if (stillThere && stolenByHighlightedRow) stillThere.focus();
        }, 1100);
      });

    // Second Tab press, this time FROM the button (#30.x.6 follow-up, found
    // under adversarial review before merge — reproduced with a real
    // `select2:select` listener before this fix was written).
    //
    // selectWoo's `isOpen()` (the gate its own document-level Tab-as-Enter
    // handler checks) is purely a CSS class on the container — entirely
    // independent of where DOM focus actually is. Moving focus onto the
    // button above does not close the dropdown or clear that class. So a
    // buyer who lands on the button via the shortcut above and then presses
    // Tab AGAIN — the entirely ordinary next step, trying to move on to the
    // next real page field — has that keydown bubble straight past the
    // button (our other handler is scoped to the search field, not this
    // button) to selectWoo's still-live document handler, which still sees
    // `isOpen() === true` and treats this Tab exactly like Enter: silently
    // fires `results:select` on whatever row is currently highlighted (a
    // company the buyer never chose), `preventDefault`s the buyer's actual
    // Tab-away, then unconditionally refocuses the search field. Net effect:
    // the buyer is trapped AND a wrong company gets silently selected
    // underneath them.
    //
    // `stopPropagation` keeps selectWoo's document handler from ever seeing
    // this keydown. That alone is not enough, and the previous revision of
    // this handler stopped there — which left the two defects TWO-25326 §1
    // and §4 record against WC, both confirmed live 2026-08-02:
    //
    //   1. The dropdown stayed open. selectWoo never clears `isOpen()` on
    //      keyboard-only focus-away — nothing but Escape, a result pick, or a
    //      `mousedown` outside the widget closes it (`_attachCloseHandler` in
    //      the vendored bundle) — so every later Tab/Enter/Escape ANYWHERE on
    //      the page, including Enter on the checkout submit button, kept
    //      getting caught by selectWoo's unscoped document handler until a
    //      stray click finally closed it.
    //   2. Native Tab from here does not reach the next form field. The
    //      dropdown is attached to the END of <body> by selectWoo's AttachBody
    //      decorator, so this button is the last tabbable element in the
    //      document: plain Tab fell off the end of the page and landed on
    //      <body>. Measured, not assumed.
    //
    // Both are fixed together, because fixing either alone cannot work. Tab
    // is now `preventDefault`ed and driven by hand: resolve the next real
    // tab-stop after the company-name control FIRST (while the dropdown is
    // still up and the anchor is still in the document), then close, then
    // focus it.
    //
    // The re-assert on a timer is the part that earns its keep. Closing fires
    // selectWoo's own `container.on('close', ...)`, which schedules
    // `self.$selection.focus()` ~1ms later UNCONDITIONALLY — the exact
    // behaviour the previous revision cited as its reason not to close at all,
    // since it yanks focus back from wherever the buyer legitimately went.
    // Rather than avoid the close, outlast the steal: re-focus the intended
    // target just past that window, and only if the steal actually won, so a
    // buyer who has moved on under their own steam is never fought. That
    // "only if it won" guard is the same shape as the one the search-field
    // Tab shortcut above already uses against selectWoo's other timer.
    //
    // Shift+Tab is deliberately untouched (beyond `stopPropagation`): reverse
    // Tab from here should go back to the query field, which sits immediately
    // before this button inside the same dropdown, and native traversal
    // already does exactly that. Hijacking it would close the dropdown the
    // buyer is trying to move back into.
    // Enter and Space, pressed while the button itself has focus, need the
    // exact same protection as Tab above and for the exact same reason
    // (#30.x.6, round 3) — found live: Doug reported Enter and Space both
    // routing to the search field instead of activating the button.
    //
    // selectWoo's document-level handler (see the long comment above) is
    // gated purely on `isOpen()` — a CSS class on the container, entirely
    // independent of which element currently has focus. Landing on this
    // button via the Tab shortcut does not close the dropdown, so with the
    // dropdown still "open" that SAME handler still sees Enter and Space
    // arriving ANYWHERE on the page, including on this button — but NOT
    // identically to Tab. Checked directly against the vendored bundle
    // (`Select2.prototype._registerEvents`): only Enter and Tab hit the
    // `results:select` branch (silently selecting whatever row is currently
    // highlighted, a company the buyer never chose); plain Space (without
    // Ctrl) matches none of that handler's `if`/`else if` branches at all.
    // Every one of these keys — selected branch or not — falls through to
    // the SAME unconditional tail, though: `$searchField.focus()`
    // immediately, then `focusOnActiveElement()` ~1s later. That fallthrough
    // is what "Enter/Space routes to the search field" actually is for
    // Space; for Enter it is both the silent wrong-row selection AND the
    // same refocus. This button's own `keydown.twoincManualEntryButton`
    // handler only ever intercepted Tab, so Enter and Space kept bubbling
    // straight past it to selectWoo's handler unhindered either way.
    //
    // `stopPropagation`, deliberately WITHOUT `preventDefault`, for Enter and
    // Space too — same reasoning as Tab: the browser's own native "activate a
    // focused <button>" default action for both keys must still run so this
    // button's own `click` handler (bound in `buildManualEntryButton`) fires.
    // Calling `preventDefault` here would suppress that native activation
    // right alongside selectWoo's handler, trading one broken key for
    // another rather than fixing it.
    jQuery(document.body)
      .off("keydown.twoincManualEntryButton")
      .on("keydown.twoincManualEntryButton", "#" + helper.manualEntryRowId, function (e) {
        if (e.which !== 9 && e.which !== 13 && e.which !== 32) return;
        e.stopPropagation();

        // Enter and Space stop here: their native "activate a focused
        // <button>" default action must still run so this button's own click
        // handler fires. Shift+Tab stops here too — see above.
        if (e.which !== 9 || e.shiftKey) return;

        // Resolved BEFORE the close, while the company-name control this is
        // measured from is still the one on screen.
        const candidates = helper.tabbablesAfterCompanyField();

        e.preventDefault();
        helper.closeCompanySearchDropdown();

        // Walk the candidates until one actually takes focus, rather than
        // focusing one and hoping. This is the fix for what Doug found live on
        // the first attempt (PR #427): the dropdown closed correctly but focus
        // stayed on company-name, because the single resolved target could not
        // take focus, `.focus()` said nothing about it, and selectWoo's own
        // post-close refocus was left to win by default.
        //
        // Falling all the way through means nothing after the company field
        // can be focused at all. `<body>` is then the honest answer — Tab
        // again resumes from the top of the document — and it is strictly
        // better than being dumped back on company-name, which is
        // indistinguishable from Tab having done nothing.
        if (!helper.focusFirstThatTakes(candidates)) helper.releaseFocusFromCompanyField();

        // selectWoo schedules `$selection.focus()` 1ms after close,
        // unconditionally (vendored bundle, `container.on('close')`). 20ms
        // clears that comfortably. Re-checked rather than re-applied blindly:
        // only take focus back if the steal actually happened, so a buyer who
        // clicked somewhere else inside the window is never fought.
        setTimeout(function () {
          if (!helper.focusIsBackOnCompanyField()) return;
          if (!helper.focusFirstThatTakes(candidates)) helper.releaseFocusFromCompanyField();
        }, 20);
      });
    // NOTE: #search_company_btn's equivalent Enter/Space fix (round 4,
    // #30.x.7, in getSearchCompanyBtnNode) looks different on purpose — it
    // binds directly on the element and calls preventDefault() +
    // exitManualCompanyEntry() rather than stopPropagation()-and-let-native-
    // activation-proceed like this one does. The two buttons have different
    // interferers (selectWoo's document handler here; something unconfirmed
    // and external there, since selectWoo isn't even alive at that point),
    // so the fix shape differs — see that function's own comment.
  },

  /**
   * Close the company-search dropdown, if one is open (TWO-25326).
   *
   * Goes through the instance rather than `.select2('close')` so it is a
   * no-op — not a thrown "select2 is not a function" — on a page where the
   * widget was never attached, which is every page the buyer reaches with
   * company search disabled.
   *
   * @returns {void}
   */
  closeCompanySearchDropdown: function () {
    const picker = jQuery("#billing_company_display").data("select2");
    if (picker && typeof picker.close === "function") picker.close();
  },

  /**
   * Elements the browser will stop on during Tab traversal.
   *
   * Deliberately a superset — `[tabindex]` catches both the select2 combobox
   * span (`tabindex="0"`, not a natively focusable element) and rows that
   * carry `tabindex="-1"` to opt OUT — which is why the caller filters on the
   * live `tabIndex` property rather than trusting the selector alone.
   */
  tabbableSelector:
    "a[href], area[href], input:not([disabled]):not([type=hidden]), " +
    "select:not([disabled]), textarea:not([disabled]), button:not([disabled]), " +
    "iframe, object, embed, [tabindex], [contenteditable]",

  /**
   * Is this element hidden, for the purpose of choosing a Tab target?
   *
   * A cheap pre-filter, NOT the guarantee. It reads the ways this checkout
   * actually hides a field — the `hidden` class on the field or an ancestor
   * (the plugin's and WooCommerce's own convention, and how both company
   * inputs are hidden behind the picker in search mode), the `hidden`
   * attribute, and an inline `display: none` — all of which are readable
   * without layout.
   *
   * Deliberately NOT jQuery's `:visible`, which is a layout query
   * (`offsetWidth || offsetHeight || getClientRects().length`). jsdom
   * implements no layout, so under Jest `:visible` reports every element in
   * the document as hidden and a filter built on it would find no tab target
   * ever — the test proving the fix works would pass against a function that
   * always returns nothing.
   *
   * What this cannot see is a field hidden by a stylesheet rule that is none
   * of the above. That is why the caller no longer trusts this: it walks the
   * candidates in order and CHECKS that focus actually landed, because
   * `.focus()` on a non-rendered element silently no-ops per the HTML spec.
   * See `focusFirstThatTakes`.
   *
   * @param {HTMLElement} el
   * @returns {boolean}
   */
  isHiddenForTabbing: function (el) {
    const $el = jQuery(el);
    if ($el.closest(".hidden, [hidden]").length) return true;
    return Boolean(el.style && el.style.display === "none");
  },

  /**
   * Every real tab-stop after the company-name control, in tab order
   * (TWO-25326 §4).
   *
   * Needed because the dropdown is not where the buyer thinks it is: selectWoo
   * attaches it to the END of `<body>`, so native Tab out of anything inside
   * it walks off the end of the document instead of continuing through the
   * address form. To put focus where the buyer expects it, the traversal has
   * to be recomputed from the control's position in the FORM, not from the
   * focused element's position in the document.
   *
   * Returns a LIST, not just the first hit, and that is the fix for the defect
   * Doug found on the merged first attempt (PR #427, live-tested 2026-08-02):
   * Tab closed the dropdown but left focus sitting on company-name. The old
   * version resolved exactly one element and the caller focused it and assumed
   * it worked. Any reason that one element could not take focus — chiefly a
   * theme hiding it by a stylesheet rule this cannot detect, where `.focus()`
   * silently no-ops — degraded to "nothing focused", which handed the race to
   * selectWoo's own unconditional post-close `$selection.focus()`. Losing that
   * race puts focus back on company-name, which is precisely the symptom. With
   * a list the caller can keep walking until one actually takes.
   *
   * Anchored on the select2 combobox in search mode, falling through to the
   * field wrapper and then the plain input, so the same function answers in
   * both capture modes and survives the combobox not being where it is
   * expected. A missing anchor now yields an empty list rather than a null the
   * caller has to remember to handle.
   *
   * Everything inside an open select2 is excluded. Without that the answer
   * would be the query field or the manual-entry button — both of which follow
   * the anchor in document order, both of which are about to be detached by
   * the close, and neither of which is "the next control in the tab order" in
   * any sense the buyer would recognise.
   *
   * Uses `compareDocumentPosition` rather than an index into the candidate
   * list on purpose: selectWoo flips the combobox's own `tabindex` while the
   * dropdown is open, so the anchor is not reliably a member of the list it is
   * being located within, and an index lookup would return -1 exactly when
   * this is called.
   *
   * @returns {Array<HTMLElement>} in document order, possibly empty
   */
  tabbablesAfterCompanyField: function () {
    const anchor = twoincSelectWooHelper.companyFieldTabAnchor();
    if (!anchor) return [];

    const found = [];

    // jQuery returns a grouped selector's matches in document order, so
    // appending in iteration order gives the list in tab order.
    jQuery(twoincSelectWooHelper.tabbableSelector).each(function () {
      if (this.tabIndex < 0) return;
      if (jQuery(this).closest(".select2-container--open, .select2-dropdown").length) return;
      if (twoincSelectWooHelper.isHiddenForTabbing(this)) return;
      if (!((anchor.compareDocumentPosition(this) & 4) /* DOCUMENT_POSITION_FOLLOWING */)) return;
      found.push(this);
    });

    return found;
  },

  /**
   * The element the Tab traversal is measured from (TWO-25326 §4).
   *
   * Three candidates rather than the two the first attempt used, in order of
   * how precisely they locate the control the buyer is actually tabbing out
   * of: the rendered combobox, then its `.form-row` wrapper, then the plain
   * input that manual entry uses. The wrapper is the new middle rung — it is
   * present whether or not select2 has rendered, and whether or not the
   * plugin's own field reordering has moved the container, so the anchor no
   * longer disappears just because the combobox is not where it was looked
   * for.
   *
   * @returns {HTMLElement|null}
   */
  companyFieldTabAnchor: function () {
    const selectors = [
      "#billing_company_display_field .select2-selection",
      "#billing_company_display_field",
      "#billing_company"
    ];

    for (let i = 0; i < selectors.length; i++) {
      const el = jQuery(selectors[i]).get(0);
      if (el) return el;
    }

    return null;
  },

  /**
   * Focus the first candidate that will actually accept focus (TWO-25326 §4).
   *
   * `.focus()` is not a request that can be relied on to succeed: per the HTML
   * spec it silently does nothing on an element that is not being rendered,
   * and returns nothing to say so. A caller that focuses one element and moves
   * on cannot tell "focused" from "no-op", which is the whole reason the first
   * attempt at this fix shipped broken.
   *
   * So: try, then read `document.activeElement` back, and keep walking on
   * failure. The verification is what makes the visibility pre-filter in
   * `isHiddenForTabbing` an optimisation rather than a correctness
   * requirement — a field hidden in a way this plugin cannot detect costs one
   * wasted `.focus()` call and nothing else.
   *
   * @param {Array<HTMLElement>} candidates in tab order
   * @returns {HTMLElement|null} the element that took focus, or null
   */
  focusFirstThatTakes: function (candidates) {
    for (let i = 0; i < candidates.length; i++) {
      candidates[i].focus();
      if (document.activeElement === candidates[i]) return candidates[i];
    }

    return null;
  },

  /**
   * Is focus back on the company-name control? (TWO-25326 §4)
   *
   * Asked after the dropdown closes, to tell selectWoo's unconditional
   * post-close `$selection.focus()` — scheduled 1ms out, in the vendored
   * bundle's `container.on('close')` — apart from the buyer having deliberately
   * gone somewhere themselves in the meantime. Only the former is worth
   * fighting.
   *
   * Nothing focused (`<body>`) counts as yes. Either the traversal found no
   * target and released focus deliberately, or the browser dropped it when the
   * dropdown was torn out from under it; both are worth one more attempt at
   * the candidates now that the dropdown is gone. What must NOT count is focus
   * sitting on some other real control, which only the buyer can have caused.
   *
   * @returns {boolean}
   */
  focusIsBackOnCompanyField: function () {
    const active = document.activeElement;
    if (!active || active === document.body) return true;

    return (
      jQuery(active).closest("#billing_company_display_field").length > 0 ||
      active === jQuery("#billing_company").get(0)
    );
  },

  /**
   * Give up on finding a tab target, but do not let the buyer be dumped back
   * where they started (TWO-25326 §4).
   *
   * If nothing after the company field can take focus, `<body>` is the honest
   * answer — the buyer presses Tab again and the browser resumes from the top
   * of the document. Leaving focus on the company-name control instead is
   * strictly worse: it is indistinguishable from Tab having done nothing at
   * all, which is exactly what was reported live.
   *
   * @returns {void}
   */
  releaseFocusFromCompanyField: function () {
    const active = document.activeElement;
    if (!active || typeof active.blur !== "function") return;
    if (!twoincSelectWooHelper.focusIsBackOnCompanyField()) return;
    if (active === document.body) return;

    active.blur();
  },

  /**
   * The dropdown's query-field wrapper — where the spinner belongs
   * (TWO-25326).
   *
   * Two lookups, because the primary one is conditional on widget state in a
   * way that is easy to miss: selectWoo sets `aria-owns` on the query field
   * in its `container.on('open')` handler and REMOVES it again on close, so
   * `companySearchInputSelector` matches nothing whenever the dropdown is
   * shut. That is correct for the spinner (there is nothing to paint on a
   * closed dropdown) but it makes the selector a state check masquerading as
   * an element lookup, and a caller that runs a tick early or a tick late
   * gets a silent no-op rather than a spinner.
   *
   * The fallback is anchored on the results list's id instead, which is
   * static markup: it identifies THIS field's dropdown specifically, so it
   * can never pick up the country picker's search field, which sits in an
   * identically-classed wrapper whenever that dropdown happens to be open.
   *
   * @returns {Object} jQuery-wrapped wrapper, empty if there is no dropdown
   */
  getCompanySearchFieldContainer: function () {
    const $byAria = jQuery(twoincSelectWooHelper.companySearchInputSelector).parent();
    if ($byAria.length) return $byAria;

    return jQuery("#select2-billing_company_display-results")
      .closest(".select2-dropdown")
      .find(".select2-search--dropdown")
      .first();
  },

  /**
   * Toggle the in-field search spinner (TWO-25288).
   *
   * The spinner is a single childless element: the stylesheet paints an
   * animated loading GIF onto it as a background-image, so there is no inner
   * markup and no asset URL for this function to keep in step with the
   * stylesheet. aria-hidden keeps it out of the accessibility tree — it is
   * decoration, and select2 already announces search state through the
   * results list.
   *
   * Removed rather than hidden when the search ends. The search input lives
   * inside the dropdown, which select2 tears down and rebuilds on every
   * open, so add-then-remove keeps at most one node alive and leaves no
   * animating element running behind a closed dropdown.
   */
  toggleCompanySearchSpinner: function (isSearching) {
    const $search = twoincSelectWooHelper.getCompanySearchFieldContainer();
    if ($search.length === 0) return;
    $search.find(".twoinc-search-spinner").remove();
    if (isSearching) {
      $search.append('<span class="twoinc-search-spinner" aria-hidden="true"></span>');
    }
    $search.toggleClass("twoinc-searching", !!isSearching);
  },

  /**
   * Replace the results list with the "search unavailable" message. Goes
   * through select2's own results:message channel (the results adapter
   * listens on the container for it) so the message is cleared on the next
   * query like any other, instead of us hand-managing dropdown DOM.
   */
  showCompanySearchUnavailable: function () {
    const select2 = jQuery("#billing_company_display").data("select2");
    if (select2 && typeof select2.trigger === "function") {
      select2.trigger("results:message", { message: "errorLoading" });
    }
  },

  /**
   * The billing country the checkout form currently holds, upper-cased, or
   * "" when the field is absent or unset (TWO-24867).
   *
   * The reader for the three country-sensitive paths added or changed by
   * TWO-24867 — the search request, the change guard and the address-lookup
   * supersession check — so those three can never disagree about what "the
   * current country" is.
   *
   * `twoincSoleTrader.currentCountry()` delegates to this one, so the
   * per-country availability cache cannot be keyed on a different answer.
   *
   * NOT the only reader in the file: `getCompanyData()` and
   * `isCountrySupported()` still read `.val()` raw and uncased, so the
   * `country_prefix` this file's handler writes upper-cased is replaced with
   * the raw value by `clearSelectedCompany`'s deferred re-read. Harmless as
   * things stand — WooCommerce's country values are already upper-case ISO
   * codes — and left alone rather than swept into this fix, but do not read
   * the paragraph above as a claim that the whole file is unified.
   */
  currentCountry: function () {
    return (jQuery("#billing_country").val() || "").toUpperCase();
  },

  /**
   * The last billing country this page has acted on (TWO-24867 / TWO-25326).
   *
   * `null` until the first known country is seen — by `initialize()`'s seed,
   * by the country handler, or by `onUpdatedCheckout`'s re-sync, whichever
   * gets there first. All three go through `countryDidChange`, so none of
   * them can leave this out of step with the field.
   */
  lastObservedCountry: null,

  /**
   * Whether a `change` event on #billing_country represents a REAL country
   * change, as opposed to WooCommerce re-emitting one during its own
   * re-render (TWO-25326).
   *
   * The handler this gates destroys the captured company — #billing_company,
   * #company_id, the picker's selection and the registry address behind it.
   * WooCommerce fires `change` on #billing_country for reasons that are not
   * the buyer changing country: `updated_checkout` re-renders the billing
   * fields and core's address-i18n.js re-triggers the field on
   * `country_to_state_changing` at init, not only on a user gesture. Bound
   * delegated on document.body, this handler saw all of them, so a buyer who
   * had picked a company watched it vanish on an unrelated re-render with no
   * action of their own — observed live on TWO-25326.
   *
   * Compared by value rather than by `event.originalEvent` being present:
   * WooCommerce's re-render path re-triggers through jQuery on some themes
   * and dispatches a native event on others, so an event-source test would
   * hold on the fixture and fail on the shop. The value comparison is true
   * to what the handler actually needs to know.
   *
   * Records the new value as a side effect, so the caller must invoke this
   * exactly once per event and act on its answer.
   *
   * Two flavours of "unknown" are deliberately NOT a change, and neither is
   * incidental:
   *
   *   - An empty reading. WooCommerce replaces #billing_country wholesale on
   *     some re-renders, so a poll landing mid-replacement reads "". Treated
   *     as a change that would clear the captured company for nothing. It is
   *     also not RECORDED, so a genuine switch that completes after the gap
   *     is still compared against the last real country and still acts.
   *   - The first known country, whatever this was called from. There is no
   *     previous country to have moved away from, so there is nothing to
   *     invalidate: on a checkout restored from a saved address the company
   *     and the country arrive together.
   *
   * @param {string} country upper-cased ISO code currently in the field
   * @returns {boolean}
   */
  countryDidChange: function (country) {
    if (!country) {
      return false;
    }
    const previous = twoincSelectWooHelper.lastObservedCountry;
    twoincSelectWooHelper.lastObservedCountry = country;
    return !!previous && country !== previous;
  },

  /**
   * Generate parameters for selectwoo
   */
  genSelectWooParams: function () {
    let twoincSearchLimit = 50;
    return {
      minimumInputLength: twoincSelectWooHelper.companySearchMinLength,
      // Empty-field hint (TWO-25288). select2 renders this through
      // templateSelection below, and only while the current selection's id
      // matches the placeholder's — which is why the field's empty option has
      // to carry value="" rather than only a non-breaking space.
      placeholder: twoincSelectWooHelper.companySearchPlaceholderText(),
      width: "100%",
      escapeMarkup: function (markup) {
        return markup;
      },
      templateResult: function (data) {
        return data.html;
      },
      templateSelection: function (data) {
        return data.text;
      },
      language: {
        errorLoading: function () {
          // Only ever reached deliberately now: the custom ajax transport
          // below suppresses the cancelled-request case (which is why this
          // used to masquerade as "searching…") and raises this message
          // only for a timeout, a transport error, or a degraded response.
          return twoincSelectWooHelper.companySearchUnavailableText();
        },
        inputTooShort: function () {
          // No argument read on purpose: WooCommerce core's own copy counts
          // down the REMAINING characters, so the same field said "2 or more"
          // after one keystroke and "3 or more" before any. This hint is
          // plugin-owned and states the threshold itself (TWO-25288).
          return twoincSelectWooHelper.companySearchTooShortText();
        },
        noResults: function () {
          return wc_country_select_params.i18n_no_matches;
        },
        searching: function () {
          return wc_country_select_params.i18n_searching;
        }
      },
      ajax: {
        dataType: "json",
        // 300ms across all three plugin checkouts (was 200 here).
        delay: 300,
        /**
         * Replaces select2's default transport so the request carries a
         * timeout and so failures can be told apart. select2's own failure
         * handler cannot make that distinction — it treats any jqXHR with
         * status 0 as a cancellation, and a jQuery timeout also reports
         * status 0 — which is why failure() is not called from here at all
         * and this code owns the messaging.
         */
        transport: function (params, success) {
          const seq = ++twoincSelectWooHelper.companySearchSeq;
          twoincSelectWooHelper.toggleCompanySearchSpinner(true);

          const request = jQuery.ajax(
            jQuery.extend({}, params, {
              timeout: twoincSelectWooHelper.companySearchTimeoutMs
            })
          );

          request.done(function (data) {
            // Same supersession rule as the failure path: a stale response
            // must not repopulate the list under a newer search.
            if (seq !== twoincSelectWooHelper.companySearchSeq) return;
            // `degraded` marks an HTTP 200 whose (near-empty) result set is
            // unreliable because the upstream provider lookup timed out.
            // The field may not be deployed yet, so absent must read as not
            // degraded — hence the explicit === true rather than truthiness.
            if (data && data.degraded === true) {
              success({ items: [] });
              twoincSelectWooHelper.showCompanySearchUnavailable();
              return;
            }
            success(data);
          });

          request.fail(function (jqXHR, textStatus) {
            // A cancelled request is routine: select2 aborts the in-flight
            // search on every keystroke, and the widget is re-created on
            // country change. Those must stay silent. A timeout or a real
            // transport error must not — left silent it renders as "no
            // companies found", which is a wrong answer, not a missing one.
            if (textStatus === "abort") return;
            // A superseded request must not paint over a newer one's results.
            if (seq !== twoincSelectWooHelper.companySearchSeq) return;
            twoincSelectWooHelper.showCompanySearchUnavailable();
          });

          request.always(function () {
            // Only the newest request owns the spinner (see companySearchSeq).
            if (seq !== twoincSelectWooHelper.companySearchSeq) return;
            twoincSelectWooHelper.toggleCompanySearchSpinner(false);
          });

          return request;
        },
        url: function (params) {
          // Read live, per request — NOT captured when the widget was built
          // (TWO-24867). The widget outlives a country change on any path
          // that does not rebuild it: WooCommerce replaces #billing_country
          // wholesale on some `updated_checkout` re-renders, address-i18n.js
          // rewrites the field without a user gesture, and a programmatic
          // `.val()` fires no `change` at all. A captured value made the
          // search query the PREVIOUS country's register while the form said
          // otherwise — the buyer saw "no companies found" for a company that
          // exists, which reads as a broken registry rather than stale state.
          const searchParams = new URLSearchParams({
            country: twoincSelectWooHelper.currentCountry(),
            limit: twoincSearchLimit,
            offset: (params.page || 0) * twoincSearchLimit,
            q: decodeURIComponent(params.term)
          });
          return twoincUtilHelper.constructTwoincUrl("/companies/v2/company", searchParams);
        },
        data: function () {
          return {};
        },
        processResults: function (response, params) {
          const items = [];
          // A degraded response is fed through here with a synthesised
          // empty payload, and a malformed body must not throw either.
          const rawItems = response && Array.isArray(response.items) ? response.items : [];
          for (let i = 0; i < rawItems.length; i++) {
            const item = rawItems[i];
            // `national_identifier` is optional in the search response — the
            // company may have none in its home registry, and its `id` may be
            // null or empty. Reading it unguarded threw here, and a throw in
            // this callback happens inside select2's query pipeline: it kills
            // the whole result list, not just this hit, leaving the dropdown
            // stuck on "Searching…". So render the company with whatever it
            // has: the identifier is the buyer's disambiguator between two
            // similarly-named companies, but dropping the hit entirely would
            // remove a selectable company. Without one the buyer sees the
            // company name alone and types the organisation number into the
            // (still required) company_id field themselves.
            const identifier =
              item.national_identifier && item.national_identifier.id
                ? String(item.national_identifier.id)
                : "";
            items.push({
              id: item.name,
              text: item.name,
              html: identifier ? item.highlight + " (" + identifier + ")" : item.highlight,
              company_id: identifier,
              lookup_id: item.lookup_id,
              approved: false
            });
          }

          return {
            results: items,
            pagination: {
              more: false
            }
          };
        }
      }
    };
  },

  /**
   * Fix the position bug
   * https://github.com/select2/select2/issues/4614
   */
  fixSelectWooPositionCompanyName: function () {
    if (window.twoinc.enable_company_search === "yes") {
      const billingCompanyDisplay = jQuery("#billing_company_display").data("select2");

      if (billingCompanyDisplay) {
        billingCompanyDisplay.on("open", function (e) {
          this.results.clear();
          this.dropdown._positionDropdown();
        });
        billingCompanyDisplay.on("results:message", function (e) {
          this.dropdown._resizeDropdown();
          this.dropdown._positionDropdown();
        });

        // Spinner, driven off the widget's own query lifecycle as well as off
        // the ajax transport (TWO-25326 §1).
        //
        // The transport hooks in genSelectWooParams stay — they are the
        // accurate signal, and they are what the supersession guard is built
        // around. These are additive, and they buy two things the transport
        // cannot:
        //
        //   - Coverage of the debounce. `query` fires on the keystroke;
        //     the transport does not run until 300ms later. To the buyer, the
        //     search is "in progress" for that whole time — this bullet asks
        //     for a spinner "while a search query is in progress", and a third
        //     of a second of dead field before it appears is the visible part
        //     of the wait.
        //   - Independence from the transport actually being reached. Live
        //     verification on 2026-08-02 found no spinner during a real
        //     search on staging, while the identical path driven through the
        //     real selectWoo widget under Jest shows it correctly — so the
        //     transport hook demonstrably does not always land in a real
        //     browser, and the root cause is not yet established. Hanging the
        //     spinner off the widget's own events as well means it no longer
        //     depends on which of the two paths runs.
        //
        // `results:all` and `results:message` are the two terminal states of a
        // query — a rendered result set, or a message row ("No matches found",
        // "search unavailable"). Both mean the search is over.
        //
        // The threshold check is load-bearing, not a tidy-up. Handlers run in
        // registration order and the widget registered its own `query`
        // handler at construction, so by the time this one runs the data
        // adapter has ALREADY been asked for results — and for a below-minimum
        // term the minimumInputLength decorator answers it synchronously with
        // `results:message`, meaning the hide below has already fired before
        // this show would run. Without the guard, every keystroke under three
        // characters would leave a spinner running forever over a "Please
        // enter 3 or more characters" hint with no request in flight.
        billingCompanyDisplay.on("query", function (params) {
          const term = (params && params.term) || "";
          if (term.length < twoincSelectWooHelper.companySearchMinLength) return;
          twoincSelectWooHelper.toggleCompanySearchSpinner(true);
        });
        billingCompanyDisplay.on("results:all", function () {
          twoincSelectWooHelper.toggleCompanySearchSpinner(false);
        });
        billingCompanyDisplay.on("results:message", function () {
          twoincSelectWooHelper.toggleCompanySearchSpinner(false);
        });
      }
    }
  },

  /**
   * Whether focus is still somewhere this poll is allowed to touch.
   *
   * `waitToFocus` exists because the picker's own focus-on-open does not land
   * reliably on every host theme, so it polls to nudge focus into the search
   * field. Left unchecked, that poll kept nudging for its whole window (up to
   * ~4.8s from `select2:open`, ~12.8s per re-render from
   * `addSelectWooFocusFixHandler`) with no regard for what happened after it
   * was scheduled — including the buyer deliberately Tabbing to a completely
   * different field, which got yanked back into the dropdown until the poll's
   * hit count ran out or the buyer hit Esc (which tears the dropdown down,
   * so the search-field selector this poll uses stops matching anything).
   *
   * "Still allowed" covers every state the poll's job actually needs to work
   * through: nothing focused yet (`<body>`, select2's own state before its
   * first focus attempt), the search field itself, an option row inside the
   * open results list (the picker focuses those on arrow-key navigation), or
   * the still-collapsed combobox trigger. Anything else means the buyer's own
   * navigation has taken them elsewhere, and that must win.
   *
   * @param {string} selectWooElemId the select's element id
   * @returns {boolean}
   */
  focusStillWithinCompanySearch: function (selectWooElemId) {
    const active = document.activeElement;
    if (!active || active === document.body) return true;

    const $active = jQuery(active);
    if ($active.is('input[aria-owns="select2-' + selectWooElemId + '-results"]')) return true;

    return (
      $active.closest(
        "#select2-" + selectWooElemId + "-results, #select2-" + selectWooElemId + "-container"
      ).length > 0
    );
  },

  /**
   * Wait until element appear and focus
   */
  waitToFocus: function (selectWooElemId, hitsRequired, intervalDuration, callbackFunc) {
    if (isNaN(intervalDuration)) intervalDuration = 300;
    if (isNaN(hitsRequired)) hitsRequired = 2;
    let attemptsLeft = hitsRequired * 8;

    let focusInterval = setInterval(function () {
      // The buyer's own navigation always wins over this poll's nudging.
      if (!twoincSelectWooHelper.focusStillWithinCompanySearch(selectWooElemId)) {
        clearInterval(focusInterval);
        return;
      }

      let inpElem = jQuery('input[aria-owns="select2-' + selectWooElemId + '-results"]').get(0);
      if (inpElem) {
        // Focus on the element if not already focused
        if (inpElem != document.activeElement) inpElem.focus();
        // Mark this as a hit attempt
        hitsRequired--;
        // If reached number of required hits, do not attempt again
        if (hitsRequired <= 0) attemptsLeft = 0;
      }

      attemptsLeft--;
      if (attemptsLeft <= 0) {
        clearInterval(focusInterval);
        if (inpElem && callbackFunc) callbackFunc();
      }
    }, intervalDuration);
  },

  /**
   * Wait until element appear and focus
   */
  addSelectWooFocusFixHandler: function (selectWooElemId) {
    let billingCompanyDisplayResult = jQuery("#select2-" + selectWooElemId + "-results");

    // Ensure the element exists and the handler hasn't been added already
    if (
      billingCompanyDisplayResult.length &&
      !billingCompanyDisplayResult.attr("two-focused-handler")
    ) {
      billingCompanyDisplayResult.attr("two-focused-handler", true);

      // Create a new MutationObserver
      let observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
          for (let addedNode of mutation.addedNodes) {
            // Ensure the node has a parent and check for the correct parentNode ID
            if (
              addedNode.parentNode &&
              addedNode.parentNode.id === "select2-" + selectWooElemId + "-results"
            ) {
              twoincSelectWooHelper.waitToFocus("billing_company_display", 80, 20);
            }
          }
        });
      });

      // Observe changes to the childList of the raw DOM element
      observer.observe(billingCompanyDisplayResult[0], {
        childList: true // Monitor when child nodes are added or removed
      });
    }
  }
};

let twoincDomHelper = {
  /**
   * Add a placeholder after an input, used for moving the fields in HTML DOM
   */
  addPlaceholder: function ($el, name) {
    // Get an existing placeholder
    let $placeholder = jQuery("#twoinc-" + name + "-source");

    // Stop if we already have a placeholder
    if ($placeholder.length > 0) return;

    // Create a placeholder
    $placeholder = jQuery('<div id="twoinc-' + name + '-source" class="twoinc-source"></div>');

    // Add placeholder after element
    $placeholder.insertAfter($el);
  },

  /**
   * Move a field to Twoinc template location and leave a placeholder
   */
  moveField: function (selector, name) {
    // Get the element
    const $el = jQuery("#" + selector);

    // Add a placeholder
    twoincDomHelper.addPlaceholder($el, name);

    // Get the target
    const $target = jQuery("#twoinc-" + name + "-target");

    // Move the input
    $el.insertAfter($target);
  },

  /**
   * Move a field back to its original location
   */
  revertField: function (selector, name) {
    // Get the element
    const $el = jQuery("#" + selector);

    // Get the target
    const $source = jQuery("#twoinc-" + name + "-source");

    // Move the input
    if ($source.length > 0) {
      $el.insertAfter($source);
    }
  },

  /**
   * Move the fields to their original or Twoinc template location.
   *
   * Phone and email used to be pulled up here too (into the pre-billing
   * "representative" wrapper, alongside first/last name), so a buyer would
   * see one field order on first paint and a different one ~1s later once
   * this fired. That grouping's own visual cue (an h3 heading) was commented
   * out back in 2021 and never replaced with CSS, so nothing distinguishes
   * the wrapper today — it was pure reorder with no remaining display
   * purpose. Phone/email now stay in their native WC position (#33).
   */
  positionFields: function () {
    setTimeout(function () {
      // If business account
      if (twoincDomHelper.isTwoincSelected()) {
        twoincDomHelper.moveField("billing_first_name_field", "fn");
        twoincDomHelper.moveField("billing_last_name_field", "ln");
      } else {
        twoincDomHelper.revertField("billing_first_name_field", "fn");
        twoincDomHelper.revertField("billing_last_name_field", "ln");
      }

      twoincDomHelper.toggleTooltip(
        '#billing_phone, label[for="billing_phone"]',
        window.twoinc.text.tooltip_phone
      );
      twoincDomHelper.toggleTooltip(
        '#billing_company_display_field .select2-container, label[for="billing_company_display"], #billing_company, label[for="billing_company"]',
        window.twoinc.text.tooltip_company
      );
    }, 100);
  },

  /**
   * Mark checkout inputs invalid
   */
  markFieldInvalid: function (fieldWrapperId) {
    const fieldWrapper = document.querySelector("#" + fieldWrapperId);

    if (fieldWrapper && fieldWrapper.classList) {
      fieldWrapper.classList.remove("woocommerce-validated");
      fieldWrapper.classList.add("woocommerce-invalid");
    }
  },

  /**
   * Toggle the visual cues for required fields
   */
  toggleRequiredCues: function ($targets, is_required) {
    // For each input
    $targets.find(":input").each(function () {
      // Get the input
      const $input = jQuery(this);

      // Get the input row
      const $row = $input.parents(".form-row");

      // Toggle the required property
      if (is_required) {
        $input.attr("required", true);

        // Add 'required' visual cue
        if ($row.find("label .twoinc-required, label .required").length == 0) {
          $row
            .find("label")
            .append('<abbr class="required twoinc-required" title="required">*</abbr>');
        }
        $row.find("label .optional").hide();
      } else {
        $input.attr("required", false);

        // Show the hidden optional visual cue
        $row.find("label .twoinc-required").remove();
        $row.find("label .optional").show();
      }
    });
  },

  /**
   * Toggle the custom business fields for Twoinc
   */
  toggleBusinessFields: function () {
    // Get the targets
    let allTargets = [
      ".woocommerce-company-fields",
      ".woocommerce-representative-fields",
      "#billing_phone_field",
      "#billing_company_display_field",
      "#billing_company_field",
      "#company_id_field",
      "#invoice_email_field",
      "#purchase_order_number_field",
      "#project_field",
      "#department_field"
    ];
    let requiredBusinessTargets = [];
    let visibleTargets = [
      ".woocommerce-company-fields",
      ".woocommerce-representative-fields",
      "#billing_phone_field"
    ];
    let requiredTargets = [];

    // Toggle the targets based on the account type
    const isTwoincSelected =
      twoincDomHelper.isTwoincVisible() && twoincDomHelper.isTwoincSelected();

    if (isTwoincSelected) {
      visibleTargets.push(
        "#invoice_email_field",
        "#purchase_order_number_field",
        "#project_field",
        "#department_field"
      );
      requiredTargets.push("#billing_phone_field");
      if (twoincDomHelper.isCountrySupported() && window.twoinc.enable_company_search === "yes") {
        visibleTargets.push("#billing_company_display_field");
        requiredTargets.push("#billing_company_display_field");
      } else {
        visibleTargets.push("#billing_company_field");
        requiredTargets.push("#billing_company_field");

        // #company_id_field is deliberately left OUT here when manual entry
        // (TWO-25288/#30.x.13) is what put us on this branch. This branch is
        // shared with two other reasons `enable_company_search` can read
        // "no" — the merchant simply never enabled company search at all,
        // and sole-trader mode (twoincSoleTrader.setMode), which both
        // legitimately want the id field: the plain fallback captures
        // name+id like it always has, and sole-trader mode fills company_id
        // itself with a synthetic identifier (Two's payment method cannot
        // function without one). Manual entry is the one case in this org's
        // three-mode company-capture model that captures name ONLY — Two's
        // payment method still needs an id in the other two modes, but a
        // buyer who says "my company isn't in the registry" has no id to
        // give, and showing the field only invites one that was never
        // validated against anything. `manual_company_entry_active` is set
        // by enterManualCompanyEntry/exitManualCompanyEntry specifically so
        // this branch can tell "manual entry" apart from the other two
        // routes into it.
        if (!window.twoinc.manual_company_entry_active) {
          visibleTargets.push("#company_id_field");
          requiredTargets.push("#company_id_field");
        }
      }
    } else {
      if (
        twoincDomHelper.isCountrySupported() &&
        window.twoinc.enable_company_search === "yes" &&
        window.twoinc.enable_company_search_for_others === "yes"
      ) {
        visibleTargets.push("#billing_company_display_field");
      } else {
        visibleTargets.push("#billing_company_field");
      }
    }

    allTargets = jQuery(allTargets.join(","));
    requiredTargets = jQuery(requiredTargets.join(","));
    visibleTargets = jQuery(visibleTargets.join(","));

    allTargets.addClass("hidden");
    visibleTargets.removeClass("hidden");

    // Toggle the required fields based on the account type
    twoincDomHelper.toggleRequiredCues(allTargets, false);
    twoincDomHelper.toggleRequiredCues(requiredTargets, isTwoincSelected);

    twoincDomHelper.syncCompanyFieldWrappers();

    // Last, and unconditionally: this function runs on every payment-method,
    // country and capture-mode switch, which is exactly when the summary's own
    // visibility gate needs re-evaluating. It reads the current inputs and
    // calls nothing that re-enters here.
    twoincDomHelper.renderCompanySummary();
  },

  /**
   * Mirror each company field's visibility onto its enclosing wrapper
   * (TWO-25288).
   *
   * The pay-for-order page lays its copy of the company inputs out in
   * per-field wrappers, each carrying its own hidden state that the function
   * above does not touch — so hiding or revealing the field inside one has no
   * visible effect there. Manual entry was unreachable on that page until now,
   * which is the only reason that has not shown up: switching to it would have
   * revealed a company field still inside a hidden wrapper, leaving the buyer
   * with nowhere to type. The checkout page has no such wrappers and this is a
   * no-op there.
   *
   * @returns {void}
   */
  syncCompanyFieldWrappers: function () {
    jQuery("#billing_company_display_field, #billing_company_field, #company_id_field").each(
      function () {
        const $field = jQuery(this);
        const $wrapper = $field.closest(".twoinc-inp-container");
        if (!$wrapper.length) return;
        $wrapper.toggleClass("hidden", $field.hasClass("hidden"));
      }
    );
  },

  /**
   * Deselect payment method and select the first available one
   */
  deselectPaymentMethod: function () {
    const paymentMethodRadioObj = jQuery(':input[value="' + window.twoinc.gateway_id + '"]');
    // Deselect the current payment method
    if (paymentMethodRadioObj) {
      paymentMethodRadioObj.prop("checked", false);
    }
  },

  /**
   * Toggle the tooltip for input fields
   */
  toggleTooltip: function (selectorStr, tooltip) {
    if (window.twoinc.display_tooltips !== "yes") return;

    jQuery(selectorStr).each(function () {
      if (twoincDomHelper.isTwoincSelected()) {
        if (!jQuery(this).attr("original-title") && tooltip !== jQuery(this).attr("title")) {
          jQuery(this).attr("original-title", jQuery(this).attr("title"));
        }
        jQuery(this).attr("title", tooltip);
      } else {
        jQuery(this).attr("title", jQuery(this).attr("original-title"));
        jQuery(this).attr("original-title", "");
      }
    });
  },

  /**
   * Toggle payment text in subtitle and description
   */
  togglePaySubtitleDesc: function (action, errSelector) {
    jQuery(".twoinc-pay-box").addClass("hidden");
    if (["checking-intent", "intent-approved", "errored"].includes(action)) {
      if (action === "checking-intent") {
        // Suppressed by the brand => the loader div is absent too
        // (TWO-25224: the notice switch covers the whole reassurance
        // pass, loading state included), so this is a no-op on an empty
        // jQuery set. The error branches below are never suppressed.
        jQuery(".twoinc-pay-box.twoinc-loader").removeClass("hidden");
      } else if (action === "intent-approved") {
        // The notice ships the no-company sentence as its text and the
        // company-name variant as a template on data-company-template
        // (only the browser knows the buyer's company). Substitute here,
        // always from the template, so a later company change re-renders
        // and an emptied company falls back to the served sentence.
        // Suppressed by the brand => the div is absent and every call
        // below is a no-op on an empty jQuery set.
        let intentBox = jQuery(".twoinc-pay-box.twoinc-intent-approved");
        if (intentBox.data("twoincDefaultText") === undefined) {
          intentBox.data("twoincDefaultText", intentBox.text());
        }
        let companyTemplate = intentBox.attr("data-company-template");
        let companyName = (twoincDomHelper.getCompanyName() || "").trim();
        if (companyTemplate && companyName) {
          intentBox.text(companyTemplate.replace("{company}", companyName));
        } else {
          intentBox.text(intentBox.data("twoincDefaultText"));
        }
        intentBox.removeClass("hidden");
      } else if (action === "errored") {
        jQuery(".twoinc-pay-box" + errSelector).removeClass("hidden");
      }
    }

    // The tile's captured-company label tracks the intent notice's
    // visibility (TWO-25326 §7, revised 2026-08-03), and this method is the
    // ONLY thing in the plugin that changes that visibility — the sweep on
    // the first line plus the three branches above are the whole set. So the
    // re-sync belongs here, at the end, AFTER the notice's own class has
    // settled: `renderCompanyTileLabel()` reads that class back rather than
    // recomputing the action, which is what keeps the two from drifting.
    //
    // Called unconditionally, including for the actions that show nothing:
    // hiding the notice must hide the label in the same turn, and the early
    // `addClass` sweep means every non-intent action is a hide.
    twoincDomHelper.renderCompanyTileLabel();
  },

  /**
   * Whether the payment tile's intent-approved notice is on screen right now
   * (TWO-25326 §7, revised 2026-08-03).
   *
   * The single source of truth for the captured-company label's visibility.
   * Deliberately reads the notice ELEMENT's own state rather than re-deriving
   * it from the intent action: the requirement is that the label shows
   * exactly when the notice shows, and any second copy of the condition — however
   * faithful when written — is a thing that can come to disagree.
   *
   * Both halves are load-bearing, and they cover the two independent ways the
   * notice can be off screen:
   *   - `.length` — the brand switched the notice off, so
   *     get_intent_approved_notice() returned '' and the div was never
   *     rendered at all (`intent_approved_notice_enabled: false`). An absent
   *     notice is a hidden notice, so the label stays hidden forever on that
   *     brand;
   *   - `.hidden` — the notice exists but the checkout is not in the
   *     intent-approved state (pre-intent, checking, errored, or a
   *     re-render), which is the runtime case.
   *
   * @returns {boolean}
   */
  isIntentNoticeVisible: function () {
    const $notice = jQuery(".twoinc-pay-box.twoinc-intent-approved");
    return $notice.length > 0 && !$notice.hasClass("hidden");
  },

  /**
   * Get company name string
   */
  getCompanyName: function () {
    if (window.twoinc.enable_company_search === "yes") {
      let companyNameObj = twoincDomHelper.getCheckoutInput(
        "SPAN",
        "select",
        "select2-billing_company_display-container"
      );
      if (companyNameObj) {
        return companyNameObj.val;
      }
    } else {
      return jQuery("#billing_company").val();
    }

    return "";
  },

  /**
   * Get company data from current HTML inputs
   */
  getCompanyData: function () {
    return {
      company_name: twoincDomHelper.getCompanyName(),
      country_prefix: jQuery("#billing_country").val(),
      organization_number: jQuery("#company_id").val()
    };
  },

  /**
   * Get representative data from current HTML inputs
   */
  getRepresentativeData: function () {
    let representativeData = {};
    if (jQuery("#billing_email").val())
      representativeData["email"] = jQuery("#billing_email").val();
    if (jQuery("#billing_phone").val())
      representativeData["phone_number"] = jQuery("#billing_phone").val();
    representativeData["first_name"] = jQuery("#billing_first_name").val();
    representativeData["last_name"] = jQuery("#billing_last_name").val();
    return representativeData;
  },

  /**
   * Clear the selected selectWoo company name and id
   */
  clearSelectedCompany: function () {
    // Clear company inputs
    let billingCompanyDisplay = jQuery("#billing_company_display");
    billingCompanyDisplay.html("");
    billingCompanyDisplay.selectWoo(twoincSelectWooHelper.genSelectWooParams());
    twoincDomHelper.toggleTooltip(
      "#billing_company_display_field .select2-container",
      window.twoinc.text.tooltip_company
    );
    twoincSelectWooHelper.fixSelectWooPositionCompanyName();
    jQuery("#company_id").val("");
    // The real company field too, matching what enterManualCompanyEntry does.
    // Without this the cleared company survives in #billing_company: it is the
    // field WooCommerce posts, so the order carried a company the buyer had
    // just been shown as cleared, and — since #billing_company is also the live
    // mirror the read-only summary reads — the summary reappeared showing it on
    // the next re-render (TWO-25288).
    //
    // Gated on the picker being the capture mode, which is what this function
    // is about clearing. In manual entry #billing_company is the buyer's own
    // typed input, and this runs on every country change: clearing
    // unconditionally would wipe a name they typed for reasons of their own.
    if (window.twoinc.enable_company_search === "yes") {
      jQuery("#billing_company").val("");
    }

    // Clear the addresses, in case address get request fails
    if (window.twoinc.enable_address_lookup === "yes") {
      Twoinc.getInstance().setAddress({
        street_address: "",
        city: "",
        postal_code: ""
      });
    }
    Twoinc.getInstance().registryAddressApplied = false;

    Twoinc.getInstance().customerCompany = {};
    // Re-read rather than forced empty. Forcing it disagreed with the gated
    // clear above: in manual entry the buyer's typed company is deliberately
    // kept, so the summary vanished here and reappeared 3s later when the
    // re-read below ran.
    twoincDomHelper.renderCompanySummary();
    twoincDomHelper.togglePaySubtitleDesc();

    // Update again after all elements are updated
    setTimeout(function () {
      Twoinc.getInstance().customerCompany = twoincDomHelper.getCompanyData();
      twoincDomHelper.renderCompanySummary();
      twoincDomHelper.togglePaySubtitleDesc();
    }, 3000);
  },

  /**
   * DOM id of the company-number label under the company-name field
   * (TWO-25288, narrowed to number-only by TWO-25326 §7).
   *
   * Id and class kept as `twoinc_company_summary` / `.twoinc-company-summary`
   * even though it no longer summarises anything but the number: brand
   * overlays style this element by class (`.custom-checkout
   * .twoinc-company-summary` in twoinc.css is one in this repo alone), and
   * renaming it would silently drop their styling on a change whose whole
   * purpose is cosmetic.
   */
  companySummaryId: "twoinc_company_summary",

  /**
   * The read-only company-number label, built hidden on first use
   * (TWO-25288; scope narrowed TWO-25326 §7).
   *
   * ONE <span> and no <input>: the captured number is a value the buyer is
   * shown, not a field they fill in, so there is deliberately nothing here to
   * type into and no control that removes it. `readonly` inputs are this
   * plugin's convention for a field that still carries a value the buyer must
   * not change (sole-trader mode readonly-locks #billing_company and
   * #company_id) — but those are the SUBMITTED fields, and they keep that job
   * untouched. This is a display beside them, so a span is the right shape.
   *
   * It used to render the captured NAME here too, in a
   * `.twoinc-company-summary-name` span above the number. That span is gone
   * (TWO-25326 §7): the name is already on screen in the company-name control
   * immediately above, and the ticket rules out any additional company name
   * or number text in the address area beyond the company-name field itself
   * and this number label. The number stays because §5 requires exactly this
   * — the number as a plain right-aligned text label immediately below the
   * name field, never as an input — and this element is the only thing on WC
   * providing it. The name moved to the payment tile instead, where §7 wants
   * it; see `renderCompanyTileLabel`.
   *
   * Anchored after the company-id field's enclosing `.twoinc-inp-container`
   * where there is one, NOT inside it. The pay-for-order page wraps every
   * company input in such a container and hides the container, not just the
   * field (see syncCompanyFieldWrappers) — so a summary placed inside would be
   * invisible on that page in exactly the search mode it matters most for. The
   * checkout page has no wrappers and the anchor falls through to the field.
   *
   * Re-anchored on EVERY call, not just on first creation (#30.x.9, found by
   * live post-merge verification — reported live: the summary rendered ABOVE
   * the company field instead of below it). Root cause is documented in
   * `WC_Twoinc_Checkout.php`, above `move_country_field()` and
   * `sync_locale_country_priority()`: WooCommerce core's own
   * `address-i18n.js` detaches and re-appends every `.form-row` in the
   * billing wrapper by priority, on EVERY checkout load — not only on
   * country change. This summary is a plain `<div>`, not a `.form-row`, so
   * it never takes part in that resort; once WC moves the real fields past
   * it, it stays stranded wherever it was first inserted, above all of
   * them. The plugin already carries two established fixes for exactly this
   * mechanism (for the country field) — this is the same class of bug for
   * the summary. `insertAfter` on an already-attached node MOVES it rather
   * than cloning, so re-checking the anchor here on every
   * `renderCompanySummary()` call (which already fires on every pick,
   * payment-method switch, country change and re-render) snaps the summary
   * back into place after any external resort.
   *
   * Guarded on `$node.prev()` (round 1 review — Han): re-running
   * `insertAfter` UNCONDITIONALLY, on every call, physically detaches and
   * re-inserts the node even when nothing has drifted — measured with a
   * MutationObserver, every "healthy" call still fires a childList removal
   * + addition. That collapses any text selection inside the summary (the
   * only interaction this read-only org-number display affords is
   * selecting it to copy), forces a reflow, and would restart any CSS
   * transition a brand overlay puts on this element (`.custom-checkout
   * .twoinc-company-summary` in twoinc.css proves overlays do style it).
   * `.prev()` is element-only (ignores text nodes), so "prev is already the
   * anchor" reliably implies "already positioned, same parent, nothing to
   * do" — the move only runs when the anchor actually changed.
   *
   * @returns {Object} jQuery-wrapped summary, or an empty set on a page with
   *   no company fields at all
   */
  getCompanySummaryNode: function () {
    let $node = jQuery("#" + twoincDomHelper.companySummaryId);
    const isNew = !$node.length;

    let $field = jQuery("#company_id_field");
    if (!$field.length) $field = jQuery("#billing_company_field");
    // Dead ternary removed (round 2 review — Vader): `isNew` is exactly
    // `!$node.length`, and `$node` is never reassigned before this line, so
    // `isNew ? jQuery() : $node` and plain `$node` are the same value in
    // both branches — an equivalent mutant proved it. Reads as if it guards
    // something it doesn't.
    if (!$field.length) return $node;

    if (isNew) {
      $node = jQuery(
        '<div id="' +
          twoincDomHelper.companySummaryId +
          '" class="twoinc-company-summary hidden">' +
          '<span class="twoinc-company-summary-id"></span>' +
          "</div>"
      );
    }

    const $wrapper = $field.closest(".twoinc-inp-container");
    const $anchor = $wrapper.length ? $wrapper : $field;
    if ($node.prev()[0] !== $anchor[0]) $node.insertAfter($anchor);
    return $node;
  },

  /**
   * Render the captured company's name and number, read-only (TWO-25288).
   *
   * Supersedes the floating company-id overlay this used to be. That showed
   * the number only, and shipped an x-button that let the buyer delete a
   * registry identity from the checkout — which is the affordance this
   * reversal removes. Both values now render as text, in one place, for all
   * three capture modes:
   *
   *   - company search: name and number as picked from the registry;
   *   - sole trader: name and number as held by Two for the buyer;
   *   - manual entry: whatever name the buyer typed, and NO number — manual
   *     entry clears #company_id, so the number renders empty until the buyer
   *     supplies one in the field of its own.
   *
   * Both arguments are optional. Callers that already hold the values pass
   * them (the picker's select handler, sole-trader autofill, the user-meta
   * restore — which writes #company_id AFTER this runs, so reading the DOM
   * there would render an empty number). Everyone else omits them and the
   * current inputs are read.
   *
   * @param {string} [companyName]
   * @param {string} [companyId]
   * @returns {void}
   */
  renderCompanySummary: function (companyName, companyId) {
    const data =
      companyName === undefined && companyId === undefined
        ? twoincDomHelper.readCapturedCompany()
        : { company_name: companyName, organization_number: companyId };

    // The empty selectWoo option's label is a non-breaking space, so an
    // unselected picker reads back as " " rather than "" — which would
    // render as a label with an invisible value in it.
    const name = twoincUtilHelper.blankToEmpty(data.company_name);
    const number = twoincUtilHelper.blankToEmpty(data.organization_number);

    // Rendered from the same resolved pair, in the same call, so the tile and
    // the address area can never disagree about what was captured
    // (TWO-25326 §7).
    twoincDomHelper.renderCompanyTileLabel(name, number);

    const $node = twoincDomHelper.getCompanySummaryNode();
    if (!$node.length) return;

    $node.find(".twoinc-company-summary-id").text(number);

    // Keyed on the NUMBER alone now, not on "name or number" (TWO-25326 §5,
    // §7). This element renders nothing but the number, so a captured company
    // with no number — which is exactly what manual entry produces, since it
    // clears #company_id — must leave no empty block behind occupying vertical
    // space under the field. §5 states it outright: manual-entry mode shows no
    // company-number field or label at all.
    //
    // Shown only for a Two purchase. A buyer paying by another method may well
    // have a company number sitting in the field, and echoing it back at them
    // under Two's styling is noise.
    const visible = Boolean(
      number && twoincDomHelper.isTwoincVisible() && twoincDomHelper.isTwoincSelected()
    );
    $node.toggleClass("hidden", !visible);
  },

  /** DOM class of the payment tile's captured-company label (TWO-25326 §7). */
  companyTileLabelClass: "twoinc-company-tile-label",

  /**
   * Render the captured company inside the payment tile (TWO-25326 §7).
   *
   * The ticket asks for `<name> (<number>)` as a text label in the tile,
   * "between the chips and the intent message (if rendered) or else the
   * optional fields". On WooCommerce the second half of that has no referent:
   * the optional fields (invoice email, project, department) are checkout
   * form fields in the billing column, not tile content, so there is nothing
   * in the tile for the label to sit above if the intent message is switched
   * off. The container is therefore server-rendered as the last element of
   * the tile block before the intent loader/notice, which satisfies the
   * position in both cases — see the block comment on that markup in
   * WC_Twoinc.php.
   *
   * Nothing here creates DOM. The container is server-rendered, so a brand
   * overlay that removes or repositions it in its own template simply gets no
   * label, rather than having one injected back underneath it.
   *
   * Falls back to the bare name when the capture carries no number, which is
   * manual entry. `<name> ()` would read as a rendering fault, and the number
   * is genuinely absent rather than pending.
   *
   * @param {string} name already blank-collapsed
   * @param {string} number already blank-collapsed
   * @returns {void}
   */
  renderCompanyTileLabel: function (name, number) {
    const $label = jQuery("." + twoincDomHelper.companyTileLabelClass);
    if (!$label.length) return;

    // Both arguments omitted => read the live inputs, the same fallback
    // `renderCompanySummary` uses. This is the shape `togglePaySubtitleDesc`
    // calls: it knows the notice's visibility changed but holds no company
    // values of its own, and re-reading is what lets it re-sync the label
    // without the capture sites having to notify it.
    if (name === undefined && number === undefined) {
      const captured = twoincDomHelper.readCapturedCompany();
      name = twoincUtilHelper.blankToEmpty(captured.company_name);
      number = twoincUtilHelper.blankToEmpty(captured.organization_number);
    }

    const text = name && number ? name + " (" + number + ")" : name;

    $label.text(text);

    // Visibility is the intent notice's, not "is a company captured"
    // (TWO-25326 §7, revised 2026-08-03: the label is no longer wanted
    // shown unconditionally once a company is known). `isIntentNoticeVisible()`
    // reads the notice element back, so this is the same gate the notice
    // itself passed through rather than a parallel re-derivation of it.
    //
    // Note what is NOT and-ed in here: `text`. A captured company is no
    // longer part of the condition, so an intent-approved checkout whose
    // company is unknown — a real state, which is precisely why the notice
    // ships a no-company variant of its sentence — leaves this element
    // unhidden with nothing in it. The empty case is suppressed in CSS
    // instead (`.twoinc-company-tile-label:empty`), because an empty label
    // with the rule's 12px margins would otherwise push the notice down by
    // 24px for no visible reason. Keeping that out of the JS is what makes
    // "shown exactly when the notice is shown" literally true of this line,
    // with the no-content case handled as the rendering detail it is.
    $label.toggleClass("hidden", !twoincDomHelper.isIntentNoticeVisible());
  },

  /**
   * Read the captured company straight out of the live inputs (TWO-25288).
   *
   * Deliberately NOT getCompanyData(), which is what this used to call. In
   * search mode that reaches getCompanyName(), and getCompanyName() reads the
   * company name out of the `checkoutInputs` sessionStorage snapshot rather
   * than the document — a snapshot saveCheckoutInputs() refreshes on a 3-second
   * interval. So a summary rendered from it in search mode showed whatever the
   * name was up to three seconds ago, or nothing at all before the first save:
   * switching payment method away and back re-renders through
   * toggleBusinessFields, which would have blanked the name of a company that
   * was still very much picked, while the number — read live — stayed.
   *
   * `#billing_company` and `#company_id`, and ONLY those two. They are the
   * fields WooCommerce posts, and they are written by every capture mode: the
   * picker's select handler on each pick, manual entry, sole-trader autofill,
   * and the user-meta restore.
   *
   * The display select's value was briefly a fallback here, on the reasoning
   * that its options carry the company name as their value. It had to go: the
   * picker appends an <option> for every pick and neither select2("destroy")
   * nor twoincSoleTrader.setCompany("", "") removes it, so leaving search mode
   * left a company on that select which no longer existed in either posted
   * field — and the fallback read it back, showing a company the order did not
   * carry. Reading only what is posted is what keeps the display and the order
   * unable to disagree.
   *
   * @returns {{company_name: string, organization_number: string}}
   */
  readCapturedCompany: function () {
    return {
      company_name: twoincUtilHelper.blankToEmpty(jQuery("#billing_company").val()),
      organization_number: twoincUtilHelper.blankToEmpty(jQuery("#company_id").val())
    };
  },

  /**
   * Get the link back out of manual entry and into company search, building it
   * hidden on first use (TWO-25288).
   *
   * A real <button> rather than the <div> this used to be. The div had no
   * href, no role and no tabindex, so the only way out of manual entry was a
   * mouse click; type="button" is what keeps a button inside the checkout form
   * from submitting it.
   *
   * Appended into `.woocommerce-input-wrapper`, not directly into
   * `#billing_company_field` (round 3, #30.x.5.3; positioning reworked
   * #30.x.9) — see the rule comment above `#search_company_btn` in
   * twoinc.css for why: that wrapper is WooCommerce core's own box around
   * just the <input>, no label inside it, so a plain block appended as its
   * last child lands in normal flow immediately below the input regardless
   * of label height or how many lines it wraps to. If that wrapper is
   * missing (a host template not using WooCommerce core's own field markup),
   * one is built around `#billing_company` directly rather than falling back
   * to `#billing_company_field` itself, which would silently reintroduce the
   * bug this fixes (see below).
   *
   * @returns {Object} jQuery-wrapped button
   */
  getSearchCompanyBtnNode: function () {
    const id = twoincSelectWooHelper.searchCompanyBtnId;

    let $btn = jQuery("#" + id);
    if ($btn.length) return $btn;

    $btn = jQuery("<button></button>")
      .attr({ id: id, type: "button" })
      .text(twoincSelectWooHelper.searchCompanyText())
      .hide()
      // Both click AND Enter/Space must activate this button directly,
      // bound on the element itself rather than delegated from
      // document.body (#30.x.7, #30.x.13).
      //
      // CLICK (#30.x.13, live-reported by Doug): a `$body.on("click", "#" +
      // searchCompanyBtnId, ...)` delegated handler used to be the only
      // activation path. Live reproduction confirmed the mouse event DOES
      // reach this button (mousedown focuses it, document.activeElement
      // becomes this element, elementFromPoint at its centre resolves to
      // the button itself — no overlap, no z-index/stacking interference),
      // yet the delegated handler never ran and nothing was switched back
      // to search. The same button's OWN direct keydown handler (below)
      // fires correctly for a real Enter keypress on the same element in
      // the same session — so whatever is intercepting this is specific to
      // the bubble-phase "click" event reaching document.body, not to this
      // button or to activation in general. Binding directly here removes
      // the dependency on that bubble reaching body at all, the same
      // reasoning already applied to Enter/Space below.
      //
      // ENTER/SPACE (#30.x.7): reported live — Tab reaches this button fine
      // (it is a real, focusable <button>), but pressing Enter or Space
      // while it has focus did nothing via the browser's native "activate a
      // focused <button>" default action alone.
      //
      // A directly-bound bubble-phase listener always runs before any
      // bubble-phase listener on an ancestor, regardless of registration
      // order or where that ancestor handler lives (the one theoretical
      // exception is a capture-phase listener somewhere in the ancestor
      // chain, which jQuery never installs and nothing vendored in this
      // repo uses either) — so both of these fire regardless of whatever
      // else is bound between this element and document.body, and
      // regardless of whether some ancestor handler already called
      // `preventDefault()`/`stopPropagation()` by the time it runs.
      .on("click", function (e) {
        twoincDomHelper.exitManualCompanyEntry();
      })
      .on("keydown", function (e) {
        if (e.which !== 13 && e.which !== 32) return;
        e.preventDefault();
        e.stopPropagation();
        twoincDomHelper.exitManualCompanyEntry();
      });

    let $wrapper = jQuery("#billing_company_field .woocommerce-input-wrapper");

    // Self-heal rather than silently degrade (found under adversarial
    // review before merge, round 3): a plain "fall back to
    // #billing_company_field" here would append the button as a sibling of
    // BOTH the label and the input, rather than immediately after the input
    // alone — reintroducing the old overlap-with-the-field-label class of
    // bug this wrapper exists to avoid. Instead, build an equivalent wrapper
    // around just the <input> ourselves: same DOM shape WooCommerce core's
    // own woocommerce_form_field() would have produced, so the button always
    // lands directly below the input regardless of which path got here.
    // Falls through to #billing_company_field only if #billing_company
    // itself is missing — a field this whole feature already depends on
    // existing.
    if (!$wrapper.length) {
      const $input = jQuery("#billing_company");
      if ($input.length) {
        $input.wrap('<span class="woocommerce-input-wrapper"></span>');
        $wrapper = jQuery("#billing_company_field .woocommerce-input-wrapper");
      }
    }

    ($wrapper.length ? $wrapper : jQuery("#billing_company_field")).append($btn);
    return $btn;
  },

  /**
   * Switch the company field from search to manual entry (TWO-25288).
   *
   * Reached only from the manual-entry row's activation, keyboard or mouse.
   *
   * @returns {void}
   */
  enterManualCompanyEntry: function () {
    // Guard against the deferred activation (activateManualEntry's
    // `setTimeout(enterManualCompanyEntry, 0)`) landing AFTER an async
    // sole-trader switch raced in during the same tick — e.g. the
    // email-driven autofill prefetch calling
    // `twoincSoleTrader.setMode("sole_trader")` "on its own", independent of
    // what the dropdown is doing (round 2 review, Han+Vader, convergent:
    // both independently reproduced this race). Without this guard, this
    // function would still run after setMode already put the buyer into
    // sole-trader mode — forcing `manual_company_entry_active` back to
    // true (wrong: sole trader needs `#company_id_field` for its synthetic
    // id), re-showing the search-again button setMode just hid, and
    // wiping `#billing_company`/`#company_id` out from under the synthetic
    // id sole-trader mode may have just written. That reproduces the exact
    // #30.x.13 symptom (wrong id-field visibility) via a path this PR's
    // own new flag opened up. Same shape as the existing "remove the
    // button before deferring" reentrancy guard in `activateManualEntry`,
    // one level further out.
    if (twoincSoleTrader.mode === "sole_trader") return;

    window.twoinc.enable_company_search = "no";
    // Distinguishes THIS route into "search suppressed" from the other two
    // (merchant-level company-search-off, and twoincSoleTrader.setMode) —
    // see the comment on this flag's read in toggleBusinessFields. Reset in
    // exitManualCompanyEntry.
    window.twoinc.manual_company_entry_active = true;

    jQuery("#billing_company_display").val("");
    // The real company field too, not just the display one. Without this the
    // manual field the buyer is about to be shown is pre-filled with the
    // company they have just said is NOT theirs, while its org-number twin is
    // empty — and the exit path clears this same mirror, so leaving it here
    // would be asymmetric on top of wrong.
    jQuery("#billing_company").val("");
    jQuery("#company_id").val("");

    // The registry address too, mirroring clearSelectedCompany — but ONLY when
    // a registry lookup actually wrote it. Reaching manual entry does not
    // imply one ran: the row is live from the first keystroke, before any
    // request goes out, and clearing unconditionally would blank a logged-in
    // buyer's own account-prefilled address for no reason. `#company_id` is
    // NOT that signal — it is written by account-restore and sole-trader code
    // with no lookup behind it, and stays empty for a picked company that
    // simply carries no organisation number even though its lookup DID run —
    // so this reads `registryAddressApplied` instead, which is set only on
    // the branch that actually writes looked-up data.
    if (Twoinc.getInstance().registryAddressApplied) {
      Twoinc.getInstance().setAddress({
        street_address: "",
        city: "",
        postal_code: ""
      });
      Twoinc.getInstance().registryAddressApplied = false;
    }

    Twoinc.getInstance().customerCompany = twoincDomHelper.getCompanyData();

    // Looked up from the DOM rather than through the cached
    // billingCompanySelect: enableCompanySearch can have re-attached the
    // widget since that reference was taken, and the one to tear down is
    // whichever one is currently attached.
    const $display = jQuery("#billing_company_display");
    if ($display.data("select2")) {
      // `close()` BEFORE `destroy()` — new, #30.x.13. Reached here the
      // widget is essentially always still OPEN: this function only runs
      // from activating the manual-entry row, and that row exists only
      // INSIDE the open results list.
      //
      // CORRECTED mechanism (round 2 review, Han+Vader, both independently
      // verified directly against the real vendored selectWoo.full.js —
      // the previous version of this comment had the mechanism wrong):
      // selectWoo's document-level keydown handler (bound ONCE per widget
      // instance in `_registerEvents`, `$(document).on('keydown', ...)`,
      // see the long comment in bindManualEntryAffordance above) is never
      // unbound by anything — not by `close()`, not by `destroy()`. What
      // actually neutralizes it: that handler's dangerous branches are
      // gated on `self.isOpen()`, which just reads a CSS class
      // (`select2-container--open`) on the container. `close()`
      // synchronously flips that class off. `destroy()` alone never fires
      // the close event, so a destroyed-but-still-referenced instance's
      // container keeps that class (and therefore `isOpen() === true`)
      // forever — the handler is still bound to `document` and still
      // "live" by its own gate, just with no widget left for it to
      // reason about. That is what live reproduction (#30.x.13, Doug)
      // showed: Tab became unresponsive PAGE-WIDE, not just near the
      // company field, the moment manual entry was reached — exactly
      // what that ungated zombie handler produces. Calling `close()`
      // first is what actually fixes it, by flipping the one flag the
      // handler checks; the handler itself is still bound afterward and
      // always will be, so this is a mitigation of a permanent gap, not
      // a removal of it. Direct empirical repro (round 2, Vader): a real
      // widget destroyed WITHOUT close() first leaves a subsequent
      // synthetic document keydown{which:9} reporting
      // `defaultPrevented === true` (Tab trapped); with close() first,
      // the same dispatch reports `false` (Tab free).
      //
      // Safe to call unconditionally ahead of destroy(): `close()` on an
      // already-closed widget is a documented no-op in select2/selectWoo.
      // `close()` does schedule its own `self.$selection.focus()` ~1ms
      // later (see the same earlier comment) — by the time that timer
      // fires, `destroy()` below has already run and
      // `focusVisibleCompanyField("#billing_company")` at the end of this
      // function has already handed focus to the manual field, and
      // `toggleBusinessFields()` has hidden `#billing_company_display_field`
      // — so that stray refocus lands on a `display: none` element, which
      // is a silent no-op per the HTML focus spec, not a fight over focus.
      $display.select2("close");
      $display.select2("destroy");
    }

    jQuery("#" + twoincSelectWooHelper.manualEntryRowId).remove();
    twoincDomHelper.getSearchCompanyBtnNode().show();

    twoincDomHelper.toggleBusinessFields();

    // Destroying the widget leaves focus on nothing — activeElement falls back
    // to <body> — so a keyboard or AT user loses their place mid-checkout and
    // has to tab in from the top of the document. Hand focus to the field they
    // asked to be given.
    twoincDomHelper.focusVisibleCompanyField("#billing_company");
  },

  /**
   * Switch the company field back from manual entry to search (TWO-25288).
   *
   * @returns {void}
   */
  exitManualCompanyEntry: function () {
    window.twoinc.enable_company_search = "yes";
    window.twoinc.manual_company_entry_active = false;

    Twoinc.getInstance().enableCompanySearch();

    jQuery("#billing_company").val("");
    jQuery("#company_id").val("");
    Twoinc.getInstance().customerCompany = twoincDomHelper.getCompanyData();

    twoincDomHelper.getSearchCompanyBtnNode().hide();
    twoincDomHelper.toggleBusinessFields();

    // Asking to search again is a request to search, not a request to be shown
    // a closed combobox: land the buyer in the open dropdown with the caret in
    // its search box, so the gesture costs one click rather than two.
    //
    // After toggleBusinessFields, deliberately. Opening the dropdown positions
    // it against its container, and that container is only laid out once the
    // business fields have been shown.
    if (!twoincDomHelper.openCompanySearchDropdown()) {
      // Fallback for a surface with no picker attached (the pay-for-order page
      // renders a different set of fields). Mirrors the enter path: the button
      // that had focus is now hidden, so without this focus is stranded on a
      // display:none element.
      //
      // Reached ONLY when no dropdown was opened. Running it alongside an open
      // dropdown would park focus on the collapsed combobox while the picker is
      // expanded behind it — a worse state than either outcome on its own,
      // because the buyer's keystrokes would go nowhere the open list can see.
      //
      // NOT #billing_company_display — the picker hides that <select> and moves
      // its accessible role onto the rendered combobox, which is the element
      // carrying tabindex and the one a buyer can actually see.
      if (
        !twoincDomHelper.focusVisibleCompanyField(
          "#billing_company_display_field .select2-selection"
        )
      ) {
        twoincDomHelper.focusVisibleCompanyField("#billing_company_display");
      }
    }
  },

  /**
   * Open the company-search dropdown and put the caret in its search box
   * (TWO-25288).
   *
   * `select2("open")` is safe to call unconditionally — the picker's own `open`
   * early-returns when it is already open — so this does not need to read the
   * open state first.
   *
   * The explicit focus is not redundant with the picker's own. The picker
   * focuses its search field from a listener on its `open` event, and this
   * plugin already carries a polling focus fix (`waitToFocus`, wired to
   * `select2:open`) precisely because that focus does not reliably land on
   * every host theme. Focusing here makes the caret's arrival synchronous with
   * the buyer's click instead of dependent on a poll that may take up to
   * ~2.4s, and the poll then finds the field already focused and no-ops.
   *
   * Reports whether the DROPDOWN was opened, deliberately — not whether focus
   * landed. The caller uses it to decide whether to fall back to focusing the
   * collapsed combobox, and that fallback is only ever right when there is no
   * open dropdown to be inside. A focus that failed with the dropdown open is
   * left to the `select2:open` poll to repair.
   *
   * @returns {boolean} whether the search dropdown was opened
   */
  openCompanySearchDropdown: function () {
    const $display = jQuery("#billing_company_display");
    if (!$display.length || !$display.data("select2")) return false;

    $display.select2("open");

    // Looked up after opening, never cached: the picker tears the dropdown
    // down and rebuilds the search field on every open, so the node focused
    // here is the one this open just created.
    twoincDomHelper.focusVisibleCompanyField(twoincSelectWooHelper.companySearchInputSelector);

    return true;
  },

  /**
   * Move focus to a company field, if it is actually focusable (TWO-25288).
   *
   * Guarded rather than a bare `.focus()`: both callers run on surfaces where
   * the target may be absent (the pay-for-order page renders a different set)
   * and `.focus()` on an empty set is a silent no-op that reads as success.
   *
   * @param {string} selector the field to focus
   * @returns {boolean} whether focus was moved
   */
  focusVisibleCompanyField: function (selector) {
    const $field = jQuery(selector);
    if (!$field.length || $field.prop("disabled")) return false;
    $field.trigger("focus");
    return jQuery(document.activeElement).is($field);
  },

  /**
   * Check if selected country is supported by Twoinc
   */
  isCountrySupported: function () {
    return window.twoinc.supported_buyer_countries.includes(jQuery("#billing_country").val());
  },

  /**
   * Check if twoinc payment is currently selected
   */
  isTwoincSelected: function () {
    return jQuery('input[name="payment_method"]:checked').val() === window.twoinc.gateway_id;
  },

  /**
   * Check if twoinc payment is currently visible
   */
  isTwoincVisible: function () {
    return (
      jQuery("li.wc_payment_method.payment_method_" + window.twoinc.gateway_id).css("display") !==
      "none"
    );
    //return jQuery('#payment_method_' + window.twoinc.gateway_id + ':visible').length !== 0
  },

  /**
   * Get price recursively from a DOM node
   */
  getPriceRecursively: function (node) {
    if (!node) return;
    if (node.classList && node.classList.contains("woocommerce-Price-currencySymbol")) return;
    if (node.childNodes) {
      for (let n of node.childNodes) {
        let val = twoincDomHelper.getPriceRecursively(n);
        if (val) {
          return val;
        }
      }
    }
    if (node.nodeName === "#text") {
      let val = node.textContent
        .replaceAll(window.twoinc.price_thousand_separator, "")
        .replaceAll(window.twoinc.price_decimal_separator, ".");
      if (!isNaN(val) && !isNaN(parseFloat(val))) {
        return parseFloat(val);
      }
    }
  },

  /**
   * Get price from DOM
   */
  getPrice: function (priceName) {
    let node =
      document.querySelector("." + priceName + " .woocommerce-Price-amount bdi") ||
      document.querySelector("." + priceName + " .woocommerce-Price-amount");
    return twoincDomHelper.getPriceRecursively(node);
  },

  /**
   * Rearrange descriptions in Twoinc payment to make it cleaner
   */
  rearrangeDescription: function () {
    let twoincPaymentBox = jQuery(".payment_box.payment_method_" + window.twoinc.gateway_id);
    if (twoincPaymentBox.length > 0) {
      twoincPaymentBox.after(jQuery(".abt-twoinc"));
    }
  },

  /**
   * Save checkout inputs
   */
  saveCheckoutInputs: function () {
    let checkoutInputs = [];
    let checkoutForm = document.querySelector('form[name="checkout"]');
    // if page is order-pay
    if (!checkoutForm)
      checkoutForm = document.querySelector("div.checkout.woocommerce-checkout.custom-checkout");
    // still not found
    if (!checkoutForm) return;

    for (let inp of checkoutForm.querySelectorAll('input:not([type="radio"],[type="checkbox"])')) {
      if (inp.getAttribute("id")) {
        checkoutInputs.push({
          htmlTag: inp.tagName,
          id: inp.getAttribute("id"),
          name: inp.getAttribute("name"),
          type: inp.getAttribute("type"),
          val: inp.value
        });
      }
    }
    for (let inp of checkoutForm.querySelectorAll(
      'input[type="radio"]:checked,input[type="checkbox"]:checked'
    )) {
      if (inp.getAttribute("id")) {
        checkoutInputs.push({
          htmlTag: inp.tagName,
          id: inp.getAttribute("id"),
          name: inp.getAttribute("name"),
          type: inp.getAttribute("type")
        });
      }
    }
    for (let inp of checkoutForm.querySelectorAll('span[id$="-container"]')) {
      if (inp.getAttribute("id")) {
        let textOnly = inp.textContent;
        let hasPlaceholder = false;
        let subs = [];
        inp.childNodes.forEach(function (val) {
          if (val.nodeType === Node.TEXT_NODE) {
            textOnly = val.nodeValue.trim();
          } else if (val.nodeType === Node.ELEMENT_NODE) {
            if (val.classList.contains("select2-selection__placeholder")) {
              // The empty-field hint (TWO-25288) is an ELEMENT child, unlike
              // the non-breaking space the empty option used to render as a
              // text node — so neither the textContent seed above nor the
              // TEXT_NODE branch would treat this container as empty, and the
              // hint would be snapshotted as though the buyer had chosen a
              // company of that name. getCompanyName() reads this value, and
              // it is written into the posted #billing_company field.
              //
              // Excluded from `subs` for the same reason it is not a
              // selection: loadStorageInputs() re-appends every sub onto a
              // container whose restored html already carries the hint, so
              // keeping it here rendered the hint twice.
              hasPlaceholder = true;
              return;
            }
            subs.push(val.outerHTML);
          }
        });
        // A rendered placeholder means, by definition, that the widget has no
        // selection.
        if (hasPlaceholder) textOnly = "";
        checkoutInputs.push({
          htmlTag: inp.tagName,
          id: inp.getAttribute("id"),
          parentLabel: inp.parentNode.getAttribute("aria-labelledby"),
          html: inp.outerHTML,
          type: "select",
          name: inp.getAttribute("id"),
          val: textOnly,
          subs: subs
        });
      }
    }
    for (let inp of checkoutForm.querySelectorAll("select")) {
      if (inp.getAttribute("id")) {
        if (inp.querySelector('option[value="' + inp.value + '"]')) {
          checkoutInputs.push({
            htmlTag: inp.tagName,
            id: inp.getAttribute("id"),
            val: inp.value,
            optionHtml: inp.querySelector('option[value="' + inp.value + '"]').outerHTML
          });
        }
      }
    }
    sessionStorage.setItem("checkoutInputs", JSON.stringify(checkoutInputs));
  },

  /**
   * Get checkout input
   */
  getCheckoutInput: function (htmlTag, inpType, inpName) {
    let checkoutInputs = sessionStorage.getItem("checkoutInputs");
    if (!checkoutInputs) return;
    checkoutInputs = JSON.parse(checkoutInputs);
    for (let inp of checkoutInputs) {
      if (inp.htmlTag === htmlTag && inp.type === inpType && inp.name === inpName) {
        return inp;
      }
    }
  },

  /**
   * Load sessionStorage checkout inputs
   */
  loadStorageInputs: function () {
    let checkoutInputs = sessionStorage.getItem("checkoutInputs");
    if (!checkoutInputs) return;
    checkoutInputs = JSON.parse(checkoutInputs);
    for (let inp of checkoutInputs) {
      // Skip load company id/name if user logged in and has Two meta set
      if (window.twoinc.user_meta_exists) {
        let skipIds = ["company_id", "billing_company", "billing_company_display"];
        if (skipIds.includes(inp.id)) continue;
      }
      // Load all other fields
      if (inp.htmlTag === "INPUT") {
        if (inp.val && ["text", "tel", "email", "hidden"].indexOf(inp.type) >= 0) {
          if (document.querySelector("#" + inp.id) && !document.querySelector("#" + inp.id).value) {
            document.querySelector("#" + inp.id).value = inp.val;
          }
        } else if (inp.type === "radio") {
          if (document.querySelector("#" + inp.id) && inp.id != "payment_method_kco") {
            document.querySelector("#" + inp.id).click();
          }
        } else if (inp.type === "checkbox") {
          if (document.querySelector("#" + inp.id)) {
            document.querySelector("#" + inp.id).click();
          }
        }
      } else if (inp.htmlTag === "SPAN") {
        if (inp.parentLabel && inp.html) {
          if (document.querySelector("#" + inp.id)) {
            document.querySelector("#" + inp.id).remove();
          }
          let parentNode = document.querySelector('[aria-labelledby="' + inp.parentLabel + '"]');
          if (parentNode) {
            parentNode.innerHTML = inp.html + parentNode.innerHTML;
          }
          if (inp.subs && inp.subs.length > 0) {
            setTimeout(
              function (inp) {
                let elem = document.querySelector("#" + inp.id);
                if (elem) {
                  for (let sub of inp.subs) {
                    elem.innerHTML += sub;
                  }
                }
              },
              1000,
              inp
            );
          }
        }
      } else if (inp.htmlTag === "SELECT") {
        if (inp.val && inp.optionHtml) {
          let selectElem = document.querySelector("#" + inp.id);
          if (selectElem) {
            if (!selectElem.querySelector('option:not([value=""])')) {
              selectElem.innerHTML = inp.optionHtml + selectElem.innerHTML;
            }
            selectElem.value = inp.val;
          }
        }
      }
    }
  },

  /**
   * Load usermeta checkout inputs
   */
  loadUserMetaInputs: function () {
    window.twoinc.user_meta_exists = window.twoinc.billing_company && window.twoinc.company_id;
    if (document.querySelector("#billing_company_display")) {
      let selectElem = document.querySelector("#billing_company_display");
      if (!selectElem.querySelector('option:not([value=""])') && window.twoinc.user_meta_exists) {
        // Append to selectWoo
        if (!selectElem.querySelector('option[value="' + window.twoinc.billing_company + '"]')) {
          selectElem.innerHTML =
            '<option value="' +
            window.twoinc.billing_company +
            '">' +
            window.twoinc.billing_company +
            "</option>" +
            selectElem.innerHTML;
        }
        selectElem.value = window.twoinc.billing_company;

        // Show the restored company read-only beside the field. Both values
        // are passed explicitly: `#company_id` is written further down this
        // function, so reading the DOM here would render an empty number.
        if (window.twoinc.user_meta_exists) {
          twoincDomHelper.renderCompanySummary(
            window.twoinc.billing_company,
            window.twoinc.company_id
          );
        }
      }
    }
    if (document.querySelector("#department") && window.twoinc.department) {
      document.querySelector("#department").value = window.twoinc.department;
    }
    if (document.querySelector("#project") && window.twoinc.project) {
      document.querySelector("#project").value = window.twoinc.project;
    }

    // Update the object values
    if (document.querySelector("#billing_company") && window.twoinc.billing_company) {
      document.querySelector("#billing_company").value = window.twoinc.billing_company;
    }
    if (document.querySelector("#company_id") && window.twoinc.company_id) {
      document.querySelector("#company_id").value = window.twoinc.company_id;
    }
  },

  /**
   * Get id of current or parent theme, return null if not found
   */
  getThemeBase: function () {
    if (jQuery("#webtron-css-css").length > 0) {
      return "webtron";
    } else if (jQuery("#biagiotti-mikado-default-style-css").length > 0) {
      return "biagiotti-mikado";
    } else if (jQuery("#kava-theme-style-css").length > 0) {
      return "kava";
    } else if (jQuery("#storefront-style-inline-css").length > 0) {
      return "storefront";
    } else if (jQuery("#divi-style-css").length > 0) {
      return "divi";
    } else if (jQuery("#kalium-style-css-css").length > 0) {
      return "kalium";
    } else if (jQuery("#flatsome-style-css").length > 0) {
      return "flatsome";
    } else if (jQuery("#shopkeeper-styles-css").length > 0) {
      return "shopkeeper";
    }
  },

  /**
   * Get id of current or parent theme, return null if not found
   */
  insertCustomCss: function () {
    let themeBase = twoincDomHelper.getThemeBase();
    if (themeBase) {
      jQuery("head").append(
        '<link href="' +
          window.twoinc.twoinc_plugin_url +
          "assets/css/c-" +
          themeBase +
          '.css" type="text/css" rel="stylesheet" />'
      );
    }
  }
};

/**
 * Payment terms chip selector — presentation only (TWO-24751).
 *
 * All business logic (term availability, fee quoting, selection
 * validation) lives in WC_Twoinc_Payment_Terms; this module renders the
 * data the wc-ajax endpoints return and posts the buyer's selection back.
 */
let twoincTermChips = {
  fees: {},
  feesLoaded: false,

  config: function () {
    return (window.twoinc && window.twoinc.payment_terms) || { enabled: false };
  },

  /**
   * Re-render the chips after every checkout update (cart changes move
   * the fee quotes, so re-fetch then re-render).
   */
  refresh: function () {
    const cfg = twoincTermChips.config();
    const $container = jQuery(".twoinc-term-chips");
    if (!cfg.enabled || !cfg.terms || cfg.terms.length === 0 || $container.length === 0) {
      // Nothing to offer: make sure a heading left over from an earlier
      // checkout update does not sit above an empty container.
      jQuery(".twoinc-term-chips-heading").addClass("hidden").text("");
      return;
    }
    $container.removeClass("hidden");

    const willFetchFees = Boolean(cfg.offset_pricing_enabled && cfg.fees_url);
    // A checkout update invalidates the previous quotes, so show the
    // loading dots again until the fresh quotes arrive. When no fetch
    // will happen, skip straight to the settled (no-fee) state.
    twoincTermChips.feesLoaded = !willFetchFees;
    twoincTermChips.render(cfg.terms, cfg.selected);

    if (willFetchFees) {
      jQuery
        .post(cfg.fees_url, { nonce: cfg.nonce })
        .done(function (response) {
          twoincTermChips.feesLoaded = true;
          if (response && response.success && response.data) {
            twoincTermChips.fees = response.data.fees || {};
            twoincTermChips.render(response.data.terms, response.data.selected);
          } else {
            twoincTermChips.render(cfg.terms, cfg.selected);
          }
        })
        .fail(function () {
          // Fee labels are decorative: chips stay usable without them.
          // Re-render to settle the loading dots into the no-fee state.
          twoincTermChips.feesLoaded = true;
          twoincTermChips.render(cfg.terms, cfg.selected);
        });
    }
  },

  render: function (terms, selected) {
    const $container = jQuery(".twoinc-term-chips");
    if ($container.length === 0) return;
    $container.empty();

    const cfg = twoincTermChips.config();
    const single = terms.length === 1;

    // Heading placement mirrors Magento's Luma template: shown ABOVE the
    // chips only when the buyer has a choice to make. A single chip carries
    // its own "Payment Terms N days" label instead, so a heading there would
    // say the same thing twice (ABN-468).
    const $heading = jQuery(".twoinc-term-chips-heading");
    if (single || terms.length === 0) {
      $heading.addClass("hidden").text("");
    } else {
      $heading.text(cfg.heading || "").removeClass("hidden");
    }

    terms.forEach(function (days) {
      const isSelected = days === selected;
      const $chip = jQuery("<button>", {
        type: "button",
        class:
          "twoinc-term-chip" +
          (isSelected ? " twoinc-term-chip--selected" : "") +
          (single ? " twoinc-term-chip--single" : ""),
        role: "radio",
        "aria-checked": isSelected ? "true" : "false",
        "data-days": days,
        disabled: single
      });
      // A lone chip is not a choice, so it names what it is: Magento's
      // singleTermLabel ("Payment Terms N days") rather than the bare
      // "N days" used when the buyer is picking between chips.
      // Both templates come from PHP, already translated. The fallbacks
      // degrade to the SHORTER localised form rather than to an English
      // sentence: an English literal here renders as plausible copy on a
      // non-English shop and hides the fact that the label never arrived,
      // which is the failure class TWO-25270 was (heading does the same,
      // falling back to '' rather than to English).
      const labelTemplate = single
        ? cfg.single_label || cfg.days_label || "%s"
        : cfg.days_label || "%s";
      const daysLabel = labelTemplate.replace("%s", days);
      $chip.append(jQuery("<span>", { class: "twoinc-term-chip__days", text: daysLabel }));

      if (!twoincTermChips.feesLoaded) {
        // Fee quote in flight: show animated loading dots instead of a
        // blank chip. Never render the configured rate — only the real
        // quoted amount once it arrives.
        // twoinc-dots carries the shared dot-pulse styling (also used by
        // the order-intent loader); the BEM class stays as the chip-scoped
        // hook. Appearance is unchanged.
        const $loading = jQuery("<span>", {
          class: "twoinc-term-chip__loading twoinc-dots",
          "aria-hidden": "true"
        });
        for (let i = 0; i < 3; i++) {
          $loading.append(jQuery("<span>", { text: "." }));
        }
        $chip.append($loading);
      } else {
        const fee = twoincTermChips.fees[days];
        if (fee && parseFloat(fee.buyer_fee_share) > 0) {
          // buyer_fee_share_display is the amount run through the store's
          // own price format server-side, so it carries the currency SYMBOL
          // in the store's position — "+€12,50", matching Magento's
          // priceUtils.formatPrice. The raw amount + currency CODE is kept
          // only as the degraded fallback for a response that predates it.
          const feeLabel = fee.buyer_fee_share_display
            ? fee.buyer_fee_share_display
            : fee.buyer_fee_share + " " + fee.currency;
          $chip.append(
            jQuery("<span>", {
              class: "twoinc-term-chip__fee",
              text: "+" + feeLabel
            })
          );
        }
      }
      if (!single) {
        $chip.on("click", function () {
          twoincTermChips.select(days);
        });
      }
      $container.append($chip);
    });

    // The selection rides the checkout form post so process_payment can
    // validate it without depending on the session.
    let $hidden = $container.find("input[name='two_selected_term']");
    if ($hidden.length === 0) {
      $hidden = jQuery("<input>", { type: "hidden", name: "two_selected_term" });
      $container.append($hidden);
    }
    $hidden.val(selected);
  },

  select: function (days) {
    const cfg = twoincTermChips.config();
    if (!cfg.select_url) return;
    jQuery
      .post(cfg.select_url, { days: days, nonce: cfg.nonce })
      .done(function (response) {
        if (response && response.success && response.data) {
          cfg.selected = response.data.selected;
          // Recalculate totals so the offset fee follows the new term;
          // updated_checkout then re-renders the chips.
          jQuery(document.body).trigger("update_checkout");
        }
      })
      .fail(function () {
        // Keep the previous selection on failure.
      });
  }
};

/**
 * Sole trader checkout — presentation only (TWO-24754).
 *
 * All business logic (country eligibility, token minting) lives in
 * WC_Twoinc_Sole_Trader; this module renders a Business / Sole trader
 * toggle, suppresses company search in sole-trader mode, opens Two's
 * hosted signup popup, and autofills the company fields from
 * GET /autofill/v1/buyer/current. Mirrors the Magento reference flow.
 */
let twoincSoleTrader = {
  mode: "business", // 'business' | 'sole_trader'
  availabilityByCountry: {},
  tokens: null,
  savedCompanySearch: null,
  // Snapshot of window.twoinc.manual_company_entry_active, saved/restored
  // alongside savedCompanySearch (#30.x.13, round 1 review — Vader). Without
  // this, a buyer who reaches sole-trader mode WHILE in manual entry (the
  // mode chip is not hidden during manual entry, and the email-driven
  // autofill prefetch can also call setMode("sole_trader") unprompted) comes
  // back out of sole-trader mode with enable_company_search correctly
  // restored to "no" (still manual) but manual_company_entry_active left at
  // the "false" this branch forces below — toggleBusinessFields then reads
  // that as the OTHER "no" case (merchant-level search-off / sole-trader)
  // and shows + REQUIRES #company_id_field, with no working search widget
  // to fill it from (enableCompanySearch early-returns since
  // enable_company_search !== "yes") and no manual name-only path left. Same
  // null-sentinel pattern as savedCompanySearch: `null` means "nothing
  // saved", distinct from the flag's own true/false/undefined values.
  savedManualEntryActive: null,
  messageListenerBound: false,
  // Result of the most recent autofill prefetch for the entered email.
  // ready=false until the first prefetch resolves; matches=true when the
  // buyer on the Two cookie owns the email currently typed at checkout.
  prefetched: { ready: false, buyer: null, matches: false },
  // Email the prefetch last ran for, to dedupe repeated checkout re-renders
  // (and so a pre-filled email still prefetches once on first render).
  lastPrefetchEmail: null,

  config: function () {
    return (window.twoinc && window.twoinc.sole_trader) || {};
  },

  // Delegated rather than a second copy of the same two lines (TWO-24867):
  // sole-trader availability is decided per country and cached per country,
  // so it disagreeing with the country the search and the change guard use
  // would be a cache keyed on one answer and read with another.
  currentCountry: function () {
    return twoincSelectWooHelper.currentCountry();
  },

  enteredEmail: function () {
    return (jQuery("#billing_email").val() || "").trim();
  },

  isAvailable: function () {
    const country = twoincSoleTrader.currentCountry();
    return twoincSoleTrader.availabilityByCountry[country] === true;
  },

  /**
   * Re-evaluate the toggle after every checkout update or country change.
   * Availability is decided server-side by the registry answer for the
   * billing country (there is no merchant toggle — TWO-25163); responses
   * are cached per country for the page's lifetime.
   */
  refresh: function () {
    const cfg = twoincSoleTrader.config();
    const $container = jQuery(".twoinc-sole-trader-toggle");
    if (!cfg.availability_url || $container.length === 0) {
      twoincSoleTrader.hide();
      return;
    }
    const country = twoincSoleTrader.currentCountry();
    if (!country) {
      twoincSoleTrader.hide();
      return;
    }
    if (country in twoincSoleTrader.availabilityByCountry) {
      twoincSoleTrader.apply(twoincSoleTrader.availabilityByCountry[country]);
      return;
    }
    jQuery
      .get(cfg.availability_url, { country: country, nonce: cfg.nonce })
      .done(function (response) {
        const available = !!(
          response &&
          response.success &&
          response.data &&
          response.data.available
        );
        twoincSoleTrader.availabilityByCountry[country] = available;
        // The buyer may have changed country while the request was in
        // flight; only apply if the answer is still for the current one.
        if (twoincSoleTrader.currentCountry() === country) {
          twoincSoleTrader.apply(available);
        }
      })
      .fail(function () {
        // Fail-soft: no sole trader option, checkout proceeds as business.
        if (twoincSoleTrader.currentCountry() === country) {
          twoincSoleTrader.apply(false);
        }
      });
  },

  apply: function (available) {
    if (available) {
      twoincSoleTrader.render();
    } else {
      twoincSoleTrader.hide();
    }
  },

  hide: function () {
    jQuery(".twoinc-sole-trader-toggle").addClass("hidden").empty();
    // Re-show (e.g. country change) should prefetch afresh.
    twoincSoleTrader.lastPrefetchEmail = null;
    if (twoincSoleTrader.mode === "sole_trader") {
      twoincSoleTrader.setMode("business");
    }
  },

  render: function () {
    const cfg = twoincSoleTrader.config();
    const $container = jQuery(".twoinc-sole-trader-toggle");
    $container.empty().removeClass("hidden");

    // Mode chips (mirrors the Magento .mode_selector / .mode_item rendering).
    const $selector = jQuery("<div>", { class: "twoinc-mode-selector" });
    [
      { value: "business", label: cfg.text.registered_business },
      { value: "sole_trader", label: cfg.text.sole_trader }
    ].forEach(function (option) {
      const $chip = jQuery("<span>", {
        class: "twoinc-mode-item",
        text: option.label,
        role: "button",
        tabindex: 0,
        "data-mode": option.value
      }).on("click keypress", function (event) {
        if (event.type === "keypress" && event.which !== 13 && event.which !== 32) {
          return;
        }
        event.preventDefault();
        twoincSoleTrader.onModeChipClick(option.value);
      });
      $selector.append($chip);
    });
    $container.append($selector);

    // Bell-icon note + signup link — shown only when sole-trader mode is
    // active and signup is needed (no matching autofill), and as the
    // fallback when an auto-launched popup is blocked.
    const $note = jQuery(
      '<div class="twoinc-sole-trader-note hidden">' +
        '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">' +
        '<path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0M3.124 7.5A8.969 8.969 0 015.292 3m13.416 0a8.969 8.969 0 012.168 4.5"/>' +
        "</svg></div>"
    );
    jQuery("<a>", {
      href: "#",
      class: "twoinc-sole-trader-note__link",
      text: cfg.text.popup_prompt
    })
      .on("click", function (event) {
        event.preventDefault();
        twoincSoleTrader.launchSignup();
      })
      .appendTo($note);
    $container.append($note);

    twoincSoleTrader.updateChips();
    // Prefetch for an already-filled email (returning/logged-in buyer), so a
    // known sole trader is auto-selected without waiting for an email edit.
    twoincSoleTrader.onEmailChanged();
  },

  updateChips: function () {
    jQuery(".twoinc-sole-trader-toggle .twoinc-mode-item").each(function () {
      jQuery(this).toggleClass(
        "twoinc-mode-item--selected",
        jQuery(this).data("mode") === twoincSoleTrader.mode
      );
    });
  },

  showNote: function (show) {
    jQuery(".twoinc-sole-trader-note").toggleClass("hidden", !show);
  },

  /**
   * A mode chip was clicked. Business is immediate; Sole trader switches
   * mode then acts on the prefetched autofill result so the signup popup
   * (when needed) opens in the same synchronous gesture as the click.
   */
  onModeChipClick: function (mode) {
    if (mode === "business") {
      twoincSoleTrader.setMode("business");
      return;
    }
    twoincSoleTrader.setMode("sole_trader");
    const pf = twoincSoleTrader.prefetched;
    if (pf.ready && pf.matches && pf.buyer) {
      twoincSoleTrader.setCompany(pf.buyer.organization_number, pf.buyer.company_name);
      twoincSoleTrader.showNote(false);
    } else if (pf.ready) {
      // Prefetch resolved with no matching buyer → signup. Opening here keeps
      // the user gesture intact so the popup is not blocker-killed.
      twoincSoleTrader.launchSignup();
    } else {
      // Prefetch not ready (e.g. no email entered yet): fall back to the link.
      twoincSoleTrader.showNote(true);
    }
  },

  /**
   * Switch mode and toggle the company-search suppression. No token/buyer
   * work happens here — that is owned by the email-driven prefetch and the
   * chip-click handler.
   */
  setMode: function (mode) {
    twoincSoleTrader.mode = mode;
    twoincSoleTrader.updateChips();

    if (mode === "sole_trader") {
      // Suppress company search by the same lever the manual-entry row uses,
      // restoring the merchant's setting (and whether manual entry was
      // active) on the way back to business mode.
      if (twoincSoleTrader.savedCompanySearch === null) {
        twoincSoleTrader.savedCompanySearch = window.twoinc.enable_company_search;
        twoincSoleTrader.savedManualEntryActive = window.twoinc.manual_company_entry_active;
      }
      window.twoinc.enable_company_search = "no";
      // Sole trader is a DIFFERENT one of this org's three company-capture
      // modes than manual entry — it carries a synthetic id (see the
      // comment on this flag's read in toggleBusinessFields) — so any
      // manual-entry state left over from before this switch must not
      // suppress #company_id_field here. Snapshotted above first so it can
      // be put back on the way out, in case the buyer really was mid manual
      // entry.
      window.twoinc.manual_company_entry_active = false;
      const $display = jQuery("#billing_company_display");
      if ($display.data("select2")) {
        // close() before destroy() — same fix, same reason, as
        // enterManualCompanyEntry (#30.x.13). This branch is reachable with
        // the widget still OPEN exactly like that one: a buyer mid manual
        // entry (dropdown already torn down, so a no-op there) or mid an
        // open search (dropdown live) can switch to sole-trader mode via
        // the mode chip, and the autofill prefetch (onEmailChanged) can
        // call setMode("sole_trader") on its own regardless of what the
        // dropdown is doing. destroy() alone, on an open widget, skips
        // selectWoo's own close cleanup — the same page-wide-Tab-shaped gap
        // documented in bindManualEntryAffordance and enterManualCompanyEntry
        // above (found under adversarial review, round 1 — Han: this PR
        // fixed the identical hazard in enterManualCompanyEntry but missed
        // this sibling call site).
        $display.select2("close");
        $display.select2("destroy");
      }
      // Only the link back to search: the manual-entry row lives inside the
      // dropdown and goes with the widget that was just destroyed (TWO-25288).
      jQuery("#" + twoincSelectWooHelper.searchCompanyBtnId).hide();
      jQuery("#billing_company, #company_id").prop("readonly", true);
      twoincDomHelper.toggleBusinessFields();
    } else {
      twoincSoleTrader.showNote(false);
      jQuery("#billing_company, #company_id").prop("readonly", false);
      if (twoincSoleTrader.savedCompanySearch !== null) {
        window.twoinc.enable_company_search = twoincSoleTrader.savedCompanySearch;
        window.twoinc.manual_company_entry_active = twoincSoleTrader.savedManualEntryActive;
        twoincSoleTrader.savedCompanySearch = null;
        twoincSoleTrader.savedManualEntryActive = null;
      }
      twoincSoleTrader.setCompany("", "");
      twoincDomHelper.toggleBusinessFields();
      Twoinc.getInstance().enableCompanySearch();
      // The buyer may have been in MANUAL entry when they switched to sole
      // trader, in which case the snapshot restored above is "no" and
      // enableCompanySearch has just early-returned. Without this the link
      // back to search stays hidden and business mode has no route back to
      // the picker at all (TWO-25288).
      if (window.twoinc.enable_company_search !== "yes") {
        twoincDomHelper.getSearchCompanyBtnNode().show();
      }
    }
  },

  /**
   * Prefetch the autofill buyer for the entered email. Runs on every email
   * change so the chip click can resolve synchronously. Mints tokens (needed
   * for the signup popup) then reads the buyer on the Two cookie; a match is
   * when that buyer owns the email currently typed at checkout.
   */
  onEmailChanged: function () {
    if (!twoincSoleTrader.isAvailable()) {
      return;
    }
    const email = twoincSoleTrader.enteredEmail();
    // Dedupe repeated checkout re-renders firing for an unchanged email.
    if (email === twoincSoleTrader.lastPrefetchEmail) {
      return;
    }
    twoincSoleTrader.lastPrefetchEmail = email;
    twoincSoleTrader.prefetched = { ready: false, buyer: null, matches: false };
    if (!email) {
      // No email to match → cannot be a known sole trader; leave business.
      if (twoincSoleTrader.mode === "sole_trader") {
        twoincSoleTrader.setMode("business");
      }
      return;
    }
    twoincSoleTrader.fetchTokens(function (ok) {
      if (!ok) {
        twoincSoleTrader.prefetched = { ready: true, buyer: null, matches: false };
        twoincSoleTrader.applyPrefetch();
        return;
      }
      twoincSoleTrader.fetchCurrentBuyer(function (buyer) {
        const entered = twoincSoleTrader.enteredEmail().toLowerCase();
        const matches = !!(buyer && buyer.email && String(buyer.email).toLowerCase() === entered);
        twoincSoleTrader.prefetched = { ready: true, buyer: buyer, matches: matches };
        twoincSoleTrader.applyPrefetch();
      });
    });
  },

  /**
   * React to a resolved prefetch: a matching buyer auto-selects Sole trader
   * and prefills the company; a non-match reverts an active Sole-trader
   * selection back to Registered business (re-clicking then starts signup).
   */
  applyPrefetch: function () {
    const pf = twoincSoleTrader.prefetched;
    if (pf.matches && pf.buyer) {
      twoincSoleTrader.setMode("sole_trader");
      twoincSoleTrader.setCompany(pf.buyer.organization_number, pf.buyer.company_name);
      twoincSoleTrader.showNote(false);
    } else if (twoincSoleTrader.mode === "sole_trader") {
      twoincSoleTrader.setMode("business");
    }
  },

  /**
   * Open the hosted signup popup, falling back to the visible link if the
   * browser blocks the window (e.g. gesture lost after a slow prefetch).
   */
  launchSignup: function () {
    const win = twoincSoleTrader.openPopup();
    twoincSoleTrader.showNote(!win);
  },

  setCompany: function (companyId, companyName) {
    jQuery("#company_id").val(companyId);
    jQuery("#billing_company").val(companyName);
    // The display select too, when this is the clearing call setMode("business")
    // makes. The picker appends an <option> per pick and select2("destroy")
    // leaves it selected, so without this a company picked before the sole-trader
    // detour stayed on that select after being cleared from both posted fields
    // (TWO-25288).
    if (!companyName) {
      jQuery("#billing_company_display").val("");
    }
    const instance = Twoinc.getInstance();
    instance.customerCompany.organization_number = companyId;
    instance.customerCompany.company_name = companyName;
    // Pin the capture country next to the number, same as the picker's select
    // handler does and for the same reason (TWO-25333 — see there). Only on
    // the capturing call: setMode("business") reaches this with both arguments
    // falsy to CLEAR, and there is no capture then for a country to belong to.
    if (companyId) {
      instance.customerCompany.country_prefix = twoincSelectWooHelper.currentCountry();
    }
    // Explicit rather than DOM-read: this function is the authority on what was
    // just captured, so the summary should not depend on the order the mirrors
    // above are written in (TWO-25288).
    twoincDomHelper.renderCompanySummary(companyName, companyId);
    if (companyId) {
      instance.getApproval();
    }
  },

  /**
   * Mint the delegation + autofill tokens. Invokes cb(true) once tokens are
   * available (also binding the signup postMessage listener), cb(false) on
   * any failure. Tokens are short-lived, so we re-mint on each email change.
   */
  fetchTokens: function (cb) {
    const cfg = twoincSoleTrader.config();
    if (!cfg.tokens_url) {
      if (cb) cb(false);
      return;
    }
    jQuery
      .post(cfg.tokens_url, { nonce: cfg.nonce, country: twoincSoleTrader.currentCountry() })
      .done(function (response) {
        if (response && response.success && response.data && response.data.autofill_token) {
          twoincSoleTrader.tokens = response.data;
          twoincSoleTrader.bindPopupMessageListener();
          if (cb) cb(true);
        } else {
          if (cb) cb(false);
        }
      })
      .fail(function () {
        if (cb) cb(false);
      });
  },

  /**
   * Read the buyer on the Two cookie. Invokes cb(buyer) with the buyer
   * details, or cb(null) when none exist (404) or on error. No UI side
   * effects — the caller decides what to do with the result.
   */
  fetchCurrentBuyer: function (cb) {
    if (!twoincSoleTrader.tokens) {
      cb(null);
      return;
    }
    fetch(window.twoinc.twoinc_checkout_host + "/autofill/v1/buyer/current", {
      credentials: "include",
      headers: { "two-delegated-authority-token": twoincSoleTrader.tokens.autofill_token }
    })
      .then(function (response) {
        if (response.ok) return response.json();
        // Every non-2xx path must still drain the body. Abandoning an unread
        // response leaves the request in flight as far as the browser is
        // concerned, so the in-flight request count never returns to zero and
        // anything waiting on network-idle (tooling, analytics, some themes)
        // hangs.
        return response.text().then(function () {
          if (response.status === 404) return null;
          throw new Error("autofill/v1/buyer/current failed");
        });
      })
      .then(function (json) {
        cb(json || null);
      })
      .catch(function () {
        cb(null);
      });
  },

  openPopup: function () {
    if (!twoincSoleTrader.tokens) {
      return null;
    }
    const prefill = {
      email: jQuery("#billing_email").val(),
      first_name: jQuery("#billing_first_name").val(),
      last_name: jQuery("#billing_last_name").val(),
      company_name: jQuery("#billing_company").val(),
      phone_number: jQuery("#billing_phone").val(),
      billing_address: {
        street: jQuery("#billing_address_1").val(),
        postal_code: jQuery("#billing_postcode").val(),
        city: jQuery("#billing_city").val(),
        region: jQuery("#billing_state").val() || "",
        country_code: twoincSoleTrader.currentCountry()
      }
    };
    const url =
      twoincSoleTrader.tokens.signup_url +
      "?businessToken=" +
      encodeURIComponent(twoincSoleTrader.tokens.delegation_token) +
      "&autofillToken=" +
      encodeURIComponent(twoincSoleTrader.tokens.autofill_token) +
      "&autofillData=" +
      encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(prefill)))));
    return window.open(
      url,
      "_blank",
      "location=yes,resizable=yes,scrollbars=yes,status=yes,height=805,width=610"
    );
  },

  /**
   * The hosted signup posts 'ACCEPTED' back to the opener when the buyer
   * completes registration; re-read the buyer (it now owns the entered
   * email) and apply the result — autofilling and keeping Sole trader.
   */
  bindPopupMessageListener: function () {
    if (twoincSoleTrader.messageListenerBound) {
      return;
    }
    twoincSoleTrader.messageListenerBound = true;
    window.addEventListener("message", function (event) {
      if (twoincSoleTrader.mode !== "sole_trader" || !twoincSoleTrader.tokens) {
        return;
      }
      const signupOrigin = new URL(twoincSoleTrader.tokens.signup_url).origin;
      if (event.origin !== signupOrigin) {
        return;
      }
      if (event.data === "ACCEPTED") {
        twoincSoleTrader.fetchCurrentBuyer(function (buyer) {
          const entered = twoincSoleTrader.enteredEmail().toLowerCase();
          const matches = !!(buyer && buyer.email && String(buyer.email).toLowerCase() === entered);
          twoincSoleTrader.prefetched = { ready: true, buyer: buyer, matches: matches };
          if (matches) {
            twoincSoleTrader.setCompany(buyer.organization_number, buyer.company_name);
            twoincSoleTrader.showNote(false);
          }
        });
      } else {
        twoincSoleTrader.showError();
      }
    });
  },

  showError: function () {
    const cfg = twoincSoleTrader.config();
    const $container = jQuery(".twoinc-sole-trader-toggle");
    if (!cfg.text || !cfg.text.error || $container.length === 0) {
      return;
    }
    let $error = $container.find(".twoinc-sole-trader-toggle__error");
    if ($error.length === 0) {
      $error = jQuery("<span>", { class: "twoinc-sole-trader-toggle__error" });
      $container.append($error);
    }
    $error.text(cfg.text.error);
  }
};

class Twoinc {
  constructor() {
    if (instance) {
      throw "Twoinc is a singleton";
    }
    instance = this;

    this.isInitialized = false;
    this.isTwoincApproved = null;
    // Whether the address fields currently hold a registry lookup's result,
    // as opposed to the buyer's own (typed or account-prefilled) address.
    // Set only where `setAddress` is actually called with looked-up data
    // (TWO-25288); read by `enterManualCompanyEntry` to decide whether
    // disowning the company should clear the address behind it.
    this.registryAddressApplied = false;
    // Monotonic supersession counter for the registry address lookup
    // (TWO-24867). Bumped by every lookup and by every real country change,
    // so only the newest lookup — and only one issued under the country still
    // selected — is allowed to write the address fields.
    this.addressLookupSeq = 0;
    this.orderIntentCheck = {
      interval: null,
      pendingCheck: false,
      lastCheckOk: false,
      lastCheckHash: null
    };
    this.orderIntentLog = {};
    this.customerCompany = {
      company_name: null,
      country_prefix: null,
      organization_number: null
    };
    this.customerRepresentative = {
      email: null,
      first_name: null,
      last_name: null,
      phone_number: null
    };
    this.billingCompanySelect = null;
  }

  enableCompanySearch() {
    const self = this;

    const $body = jQuery(document.body);

    // Get the billing company field
    const $billingCompanyDisplay = $body.find("#billing_company_display");
    const $billingCompany = $body.find("#billing_company");

    // Get the company ID field
    const $companyId = $body.find("#company_id");
    if (window.twoinc.enable_company_search !== "yes") return;
    self.billingCompanySelect = $billingCompanyDisplay.selectWoo(
      twoincSelectWooHelper.genSelectWooParams()
    );
    twoincDomHelper.toggleTooltip(
      "#billing_company_display_field .select2-container",
      window.twoinc.text.tooltip_company
    );
    self.billingCompanySelect.on("select2:select", function (e) {
      const self = Twoinc.getInstance();

      // Get the option data
      const data = e.params.data;

      // Set the company name
      self.customerCompany.company_name = data.id;

      // Set the company ID
      self.customerCompany.organization_number = data.company_id;

      // Pin the country this company was captured UNDER, alongside the number
      // (TWO-25333). Without this the pair could be assembled from two
      // different moments: the number is written here, while `country_prefix`
      // was last written by whichever DOM re-read ran most recently — so a
      // country that moved with no `change` event before the pick left the
      // OLD country next to a company from the NEW one, which getApproval()
      // then posted as a self-consistent pair. It is also what makes
      // `clearCompanyIfCountryStale` sound: a witness written at a different
      // time from the thing it witnesses produces false positives, and a
      // false positive there is a destructive clear.
      self.customerCompany.country_prefix = twoincSelectWooHelper.currentCountry();

      // Set the company ID to HTML DOM
      $companyId.val(data.company_id);

      // Set the company name to HTML DOM
      $billingCompany.val(data.id);

      // Display the picked company read-only. Synchronous, unlike the
      // overlay this replaces: that had to wait for select2 to rebuild its
      // selection container because it was positioned against it, and this is
      // anchored to a field that is already in the document.
      twoincDomHelper.renderCompanySummary(data.id, data.company_id);

      // Update the company name in agreement sentence and text in subtitle/description
      twoincDomHelper.togglePaySubtitleDesc();

      // Get the company approval status
      self.getApproval();

      // Address search
      if (window.twoinc.enable_address_lookup === "yes") {
        // Fetch the company data
        self.addressLookup(data);
      }
    });

    twoincSelectWooHelper.fixSelectWooPositionCompanyName();

    // Manual-entry affordance (TWO-25288). Bound here, once per widget, rather
    // than on every dropdown open: the handlers it installs are delegated and
    // outlive the dropdown, so re-binding them per open only ever accumulated
    // duplicates.
    twoincSelectWooHelper.bindManualEntryAffordance();

    self.billingCompanySelect.on("select2:open", function (e) {
      // Arguments kept verbatim: waitToFocus treats an explicit null as a
      // value rather than a default, so dropping them would change the poll
      // timing of the focus fix, which is not what this change is about.
      twoincSelectWooHelper.waitToFocus("billing_company_display", null, null);
      twoincSelectWooHelper.addSelectWooFocusFixHandler("billing_company_display");
    });
  }

  /**
   * Initialize Twoinc code
   */
  initialize(loadSavedInputs) {
    const self = this;

    if (this.isInitialized) {
      return;
    }
    const $body = jQuery(document.body);

    // Stop if not the checkout page
    if (jQuery("#order_review").length === 0) return;

    // Set up the business fields when the gateway is visible — or when
    // company search should serve other payment methods while this
    // gateway is gated away. (Note isTwoincVisible() is also true when
    // the gateway <li> is absent entirely — .css() on an empty set — so
    // the second clause guards intent, not today's behaviour: it must
    // survive any future tightening of isTwoincVisible.)
    if (
      twoincDomHelper.isTwoincVisible() ||
      (window.twoinc.enable_company_search === "yes" &&
        window.twoinc.enable_company_search_for_others === "yes")
    ) {
      // Toggle the business fields
      twoincDomHelper.toggleBusinessFields();

      // Move the fields to correct positions
      twoincDomHelper.positionFields();
    }

    // Focus on search input on country open
    jQuery("#billing_country").on("select2:open", function (e) {
      twoincSelectWooHelper.waitToFocus("billing_country");
    });

    // Enable company search
    this.enableCompanySearch();
    setTimeout(this.enableCompanySearch, 800);

    // Disable or enable actions based on the account type
    $body.on("updated_checkout", Twoinc.getInstance().onUpdatedCheckout);

    // No click handler for the manual-entry row (TWO-25288). It is a pseudo-
    // option inside the results list now, so the picker already turns a click
    // on it into the same internal select that Enter does, and
    // bindManualEntryAffordance intercepts that one event for both. A second,
    // click-only path here would fire alongside it on every mouse activation.
    //
    // #search_company_btn's own click activation used to be delegated from
    // here (`$body.on("click", "#" + searchCompanyBtnId, ...)`). Removed
    // (#30.x.13) — live reproduction showed a real click on that button
    // never reached this handler (no console errors, mousedown/focus both
    // landed on the button correctly), so the activation now lives directly
    // on the button itself, alongside its Enter/Space handler — see the
    // comment in getSearchCompanyBtnNode for why binding directly there is
    // also more robust than delegating here in the first place.

    // Handle the representative inputs blur event
    $body.on(
      "blur",
      "#billing_first_name, #billing_last_name, #billing_email, #billing_phone",
      self.onRepresentativeInputBlur
    );

    // Handle the representative inputs blur event
    $body.on("blur", "#company_id, #billing_company_display", self.onCompanyManualInputBlur);

    // Handle the company inputs change event
    $body.on(
      "change",
      "#select2-billing_company_display-container",
      twoincDomHelper.togglePaySubtitleDesc
    );
    $body.on("change", "#billing_company", function () {
      Twoinc.getInstance().customerCompany.company_name = twoincDomHelper.getCompanyName();
      twoincDomHelper.renderCompanySummary();
      twoincDomHelper.togglePaySubtitleDesc();
    });

    // Handle the country inputs change event. The tracker behind it is seeded
    // at the END of this function, not here — see the comment there.
    $body.on("change", "#billing_country", self.onCountryInputChange);

    // Re-evaluate the sole-trader autofill prefetch whenever the email
    // changes, so a returning sole trader is auto-selected and the signup
    // popup can open synchronously on the chip click.
    $body.on("change", "#billing_email", function () {
      twoincSoleTrader.onEmailChanged();
    });

    $body.on("click", "#place_order", function () {
      clearInterval(Twoinc.getInstance().orderIntentCheck.interval);
      Twoinc.getInstance().orderIntentCheck.interval = null;
      Twoinc.getInstance().orderIntentCheck.pendingCheck = false;
    });

    $body.on("checkout_error", function () {
      clearInterval(Twoinc.getInstance().orderIntentCheck.interval);
      Twoinc.getInstance().orderIntentCheck.interval = null;
      Twoinc.getInstance().orderIntentCheck.pendingCheck = false;
    });

    setInterval(function () {
      if (Twoinc.getInstance().orderIntentCheck.pendingCheck) Twoinc.getInstance().getApproval();
      twoincDomHelper.saveCheckoutInputs();
    }, 3000);

    // Add customization for current theme if any
    twoincDomHelper.insertCustomCss();

    twoincDomHelper.loadUserMetaInputs();
    if (loadSavedInputs) twoincDomHelper.loadStorageInputs();

    // Seed the country tracker HERE — after the two restore passes above, not
    // next to the binding that reads it (TWO-24867 / TWO-25326).
    //
    // `loadStorageInputs()` writes #billing_country with `selectElem.value =`
    // and fires no `change`. Seeded before it, the tracker held the country
    // the page was rendered with while the field held the restored one, and
    // the first re-render afterwards read the difference as a real country
    // change — destroying the company and address that same restore had just
    // put back. The bootstrap's own call is `initialize(true)`, so that is the
    // production path, not an edge case.
    //
    // Seeding at all is what tells the two first-event cases apart: with no
    // seed the FIRST country the page ever sees is adopted rather than acted
    // on — right for the re-render WooCommerce fires at init (core's
    // address-i18n.js triggers `country_to_state_changing` carrying the
    // country the form already had), wrong for a buyer who changes country
    // before any re-render happens.
    //
    // Through `countryDidChange` rather than by assignment, so this file has
    // exactly one writer for the tracker.
    twoincSelectWooHelper.countryDidChange(twoincSelectWooHelper.currentCountry());

    setTimeout(function () {
      twoincDomHelper.saveCheckoutInputs();
      Twoinc.getInstance().customerCompany = twoincDomHelper.getCompanyData();
      Twoinc.getInstance().customerRepresentative = twoincDomHelper.getRepresentativeData();
      twoincDomHelper.renderCompanySummary();
      Twoinc.getInstance().getApproval();
    }, 1000);
    this.updateElements();
    this.isInitialized = true;
  }

  /**
   * Get singleton instance
   */
  static getInstance() {
    if (!instance) instance = new Twoinc();
    return instance;
  }

  /**
   * Check if all the required details are collected
   *
   * @returns {boolean}
   */
  updateElements() {
    // Check approval again
    this.getApproval();

    // Update the text in subtitle and description
    twoincDomHelper.togglePaySubtitleDesc();

    // Rearrange the DOMs in Twoinc payment
    twoincDomHelper.rearrangeDescription();

    this.toggleDueInDays();
    this.getDueInDays();
  }

  /**
   * Check if all the required details are collected
   *
   * @returns {boolean}
   */
  isReadyApprovalCheck() {
    if (window.twoinc.enable_order_intent !== "yes") {
      return false;
    }

    if (!Twoinc.getInstance().customerCompany.organization_number) {
      return false;
    }

    let values = [].concat(Object.values(this.customerCompany));

    return !twoincUtilHelper.isAnyElementEmpty(values);
  }

  /**
   * Check the company approval status by creating an order intent
   */
  getApproval() {
    if (!this.isReadyApprovalCheck()) return;

    if (this.orderIntentCheck.interval) {
      this.orderIntentCheck.pendingCheck = true;
      return;
    }

    this.orderIntentCheck.interval = setInterval(function () {
      let gross_amount = twoincDomHelper.getPrice("order-total");
      let tax_amount = twoincDomHelper.getPrice("tax-rate");
      if (!gross_amount) {
        return;
      }
      if (!tax_amount) {
        tax_amount = 0;
      }
      let net_amount = gross_amount - tax_amount;

      let jsonBody = JSON.stringify({
        merchant_id: window.twoinc.merchant?.id,
        merchant_short_name: window.twoinc.merchant?.short_name,
        gross_amount: gross_amount.toFixed(2),
        net_amount: net_amount.toFixed(2),
        tax_amount: tax_amount.toFixed(2),
        invoice_type: "FUNDED_INVOICE",
        buyer: {
          company: Twoinc.getInstance().customerCompany,
          representative: Twoinc.getInstance().customerRepresentative
        },
        currency: window.twoinc.currency,
        line_items: [
          {
            name: "Cart",
            description: "",
            gross_amount: gross_amount.toFixed(2),
            net_amount: net_amount.toFixed(2),
            discount_amount: "0",
            tax_amount: tax_amount.toFixed(2),
            tax_class_name: "VAT " + ((100.0 * tax_amount) / net_amount).toFixed(2) + "%",
            tax_rate: "" + ((1.0 * tax_amount) / net_amount).toFixed(6),
            unit_price: net_amount.toFixed(2),
            quantity: 1,
            quantity_unit: "item",
            image_url: "",
            product_page_url: "",
            type: "PHYSICAL",
            details: {
              categories: [],
              barcodes: []
            }
          }
        ]
      });

      let hashedBody = twoincUtilHelper.getUnsecuredHash(jsonBody);
      if (Twoinc.getInstance().orderIntentLog[hashedBody]) {
        twoincDomHelper.togglePaySubtitleDesc(
          ...Twoinc.getInstance().orderIntentLog[hashedBody].split("|")
        );
        return;
      }
      Twoinc.getInstance().orderIntentCheck["lastCheckHash"] = hashedBody;

      clearInterval(Twoinc.getInstance().orderIntentCheck.interval);
      Twoinc.getInstance().orderIntentCheck.interval = null;
      Twoinc.getInstance().orderIntentCheck.pendingCheck = false;

      if (!Twoinc.getInstance().isReadyApprovalCheck()) return;

      twoincDomHelper.togglePaySubtitleDesc("checking-intent");

      // Create an order intent
      const approvalResponse = jQuery.ajax({
        url: twoincUtilHelper.constructTwoincUrl("/v1/order_intent"),
        contentType: "application/json; charset=utf-8",
        dataType: "json",
        method: "POST",
        xhrFields: { withCredentials: true },
        data: jsonBody
      });

      approvalResponse.done(function (response) {
        // Store the approved state
        Twoinc.getInstance().isTwoincApproved = response.approved;

        if (!response.approved) {
          twoincDomHelper.deselectPaymentMethod();
        }

        // Update tracking number
        if (response.tracking_id && document.querySelector("#tracking_id")) {
          document.querySelector("#tracking_id").value = response.tracking_id;
        }

        // Display messages and update order intent logs
        Twoinc.getInstance().processOrderIntentResponse(response);
      });

      approvalResponse.fail(function (response) {
        // Store the approved state
        Twoinc.getInstance().isTwoincApproved = false;

        twoincDomHelper.deselectPaymentMethod();

        // Display messages and update order intent logs
        Twoinc.getInstance().processOrderIntentResponse(response);
      });
    }, 1000);
  }

  /**
   * Update page after order intent request complete
   */
  processOrderIntentResponse(response) {
    let displayMsgId = "";
    let invalidFields = [];

    if (response.approved) {
      displayMsgId = "intent-approved";
    } else {
      // Display error messages
      displayMsgId = "errored|.twoinc-err-payment-default";
      if (response.status >= 400) {
        // @TODO: use the error code returned by the API
        let errMsg = response.responseJSON;
        if (typeof response.responseJSON !== "string") {
          if ("error_details" in response.responseJSON && response.responseJSON["error_details"]) {
            errMsg = response.responseJSON["error_details"];
          } else if ("error_code" in response.responseJSON && response.responseJSON["error_code"]) {
            errMsg = response.responseJSON["error_code"];
          }
        }

        if (errMsg.includes("Invalid phone number")) {
          displayMsgId = "errored|.twoinc-err-phone-number";
          invalidFields.append("billing_phone_field");
        }
      }

      // Update order intent log
      this.orderIntentCheck["lastCheckOk"] = response.approved;
      // this.orderIntentLog = {}
      this.orderIntentLog[this.orderIntentCheck["lastCheckHash"]] = displayMsgId;
    }

    // Update twoinc message
    let twoincSubtitleExistCheck = setInterval(function () {
      if (jQuery("#payment .blockOverlay").length === 0) {
        // woocommerce's update_checkout is not running
        twoincDomHelper.togglePaySubtitleDesc(...displayMsgId.split("|"));
        for (let fld of invalidFields) {
          twoincDomHelper.markFieldInvalid(fld);
        }
        clearInterval(twoincSubtitleExistCheck);
      }
    }, 1000);
  }

  addressLookup(selectedCompany) {
    const self = this;
    // Supersession, not cancellation (TWO-24867). Two independent things can
    // make this response wrong by the time it arrives: a newer lookup (the
    // buyer picked a different company) and a country change (the buyer
    // corrected a mis-clicked country). The sequence number catches the
    // first, the country snapshot the second — a country switched away from
    // and back again between request and response leaves the sequence stale
    // but the country matching, and vice versa, so both are needed.
    const seq = (self.addressLookupSeq += 1);
    const requestCountry = twoincSelectWooHelper.currentCountry();
    const addressResponse = jQuery.ajax({
      dataType: "json",
      url: twoincUtilHelper.constructTwoincUrl(`/companies/v2/company/${selectedCompany.lookup_id}`)
    });
    addressResponse.done(function (response) {
      if (seq !== self.addressLookupSeq) return;
      // An empty reading on EITHER side means the field was mid-replacement,
      // not that the country moved — discarding a good registry address on it
      // would be a silent failure with no retry and no message. Both sides
      // matter: a lookup issued during a replacement snapshots "", and
      // comparing that against a known country would drop every response.
      // Only two countries that are both known AND different are grounds to
      // drop this.
      const landedCountry = twoincSelectWooHelper.currentCountry();
      if (requestCountry && landedCountry && landedCountry !== requestCountry) return;
      // Use new address lookup by default
      if (response.addresses) {
        self.setAddress(response.addresses[0]);
        // Only here, on the branch that actually writes registry data. A
        // buyer's own address (account-prefilled, or typed by hand) never
        // goes through this path, so this flag distinguishes the two —
        // `#company_id` being non-empty does not: it is also written by
        // account-restore and sole-trader code with no lookup behind it, and
        // is empty for company hits that carry no organisation number even
        // though a lookup DID run for them.
        self.registryAddressApplied = true;
      }
    });
  }

  setAddress(address) {
    jQuery("#billing_address_1").val(address.street_address);
    jQuery("#billing_address_2").val("");
    jQuery("#billing_city").val(address.city);
    jQuery("#billing_postcode").val(address.postal_code);
    // Update order review in case there is a shipping change
    jQuery(document.body).trigger("update_checkout");
  }

  /**
   * Get the actual due in days to display on page
   */
  getDueInDays() {
    if (
      !Twoinc.getInstance().customerCompany ||
      !Twoinc.getInstance().customerCompany.organization_number ||
      !Twoinc.getInstance().customerCompany.country_prefix
    )
      return;

    let params = {
      merchant_id: window.twoinc.merchant?.id,
      merchant_short_name: window.twoinc.merchant?.short_name,
      buyer_organization_number: Twoinc.getInstance().customerCompany.organization_number,
      country_prefix: Twoinc.getInstance().customerCompany.country_prefix
    };

    // Create a get due in days request
    const dueInDaysResponse = jQuery.ajax({
      url: twoincUtilHelper.constructTwoincUrl("/v1/payment_terms", params),
      dataType: "json",
      method: "GET"
    });

    dueInDaysResponse.done(function (response) {
      window.twoinc.custom_due_in_days = typeof response.due_in_days !== "undefined";

      Twoinc.getInstance().toggleDueInDays();
    });

    dueInDaysResponse.fail(function (response) {
      Twoinc.getInstance().toggleDueInDays();
    });
  }

  /**
   * Display due in days only if the buyer does not have custom payment term
   */
  toggleDueInDays() {
    if (window.twoinc.custom_due_in_days) {
      jQuery(".payment-term-number").hide();
      jQuery(".payment-term-nonumber").show();
    } else {
      jQuery(".payment-term-nonumber").hide();
      jQuery(".payment-term-number").show();
    }
  }

  /**
   * Handle the woocommerce updated checkout event
   */
  onUpdatedCheckout() {
    // RECORD the billing country, and nothing else (TWO-24867). A re-render
    // can move the field with no `change` event — a `checkout_error`
    // re-render, a multi-step theme, a session address restored server-side —
    // and without this the tracker would hold the pre-re-render country for
    // the rest of the page, so a later genuine switch BACK to that value
    // would read as no change and be swallowed.
    //
    // Deliberately NOT `syncBillingCountry()`. These re-renders restore the
    // country and the company together, so clearing the capture here would
    // destroy what the same re-render just put back — the TWO-25326 failure
    // on a new trigger. Throwing away a captured company needs the buyer's
    // gesture, and the `change` event is the only signal of one there is.
    //
    // Record-only is still not the whole answer, though: a country that moved
    // to something the captured company does not belong to left that company
    // captured and approved, and the mismatch surfaced as an opaque
    // order-creation failure. `clearCompanyIfCountryStale` below is the
    // discriminator for that — it fires on the countries DISAGREEING, not on
    // the country having moved, so it stays silent on the restore-together
    // case above (TWO-25333).
    const movedCountry = twoincSelectWooHelper.currentCountry();
    if (twoincSelectWooHelper.countryDidChange(movedCountry)) {
      // Invalidating in-flight work IS safe here, though, and record-only
      // would otherwise leave a hole: on this path nothing bumps either
      // counter, so a company-search response or a registry address for the
      // OUTGOING country could still land — and the address guard's own
      // country comparison does not cover it either, since an empty reading
      // on either side (the field mid-replacement, which is exactly what this
      // path is about) waves the response through by design.
      //
      // Purely destructive-to-pending, never to captured state: it discards
      // answers to questions asked under a country that is no longer
      // selected, which is not something the buyer can lose.
      twoincSelectWooHelper.companySearchSeq += 1;
      Twoinc.getInstance().addressLookupSeq += 1;

      // BEFORE updateElements() below, which is what re-runs getApproval().
      // getApproval() does not fire immediately — it arms a 1s interval — so
      // the ordering is not what stops the stale pair being posted, and no
      // test pins it as though it were. It is here because clearing before the
      // approval pass is the only order in which `updateElements` sees the
      // state that the rest of this event's work should be derived from.
      Twoinc.getInstance().clearCompanyIfCountryStale(movedCountry);
    }

    Twoinc.getInstance().updateElements();

    jQuery('input[name="payment_method"]').on("change", function () {
      twoincDomHelper.toggleBusinessFields();
    });

    twoincDomHelper.rearrangeDescription();

    twoincTermChips.refresh();
    twoincSoleTrader.refresh();
  }

  /**
   * Handle the company manual input changes
   *
   * @param event
   */

  onCompanyManualInputBlur(event) {
    const $input = jQuery(this);

    let inputName = $input.attr("name");

    if (inputName === "company_id") {
      const typed = $input.val();
      // Only when the blur actually MOVED the number (TWO-25333 — see the
      // picker's select handler for why the number and the country have to be
      // written together). This is a BLUR, not a change: tabbing through an
      // untouched `#company_id` fires it too, and re-pinning there would
      // launder a stale pair into a consistent-looking one. The number would
      // still be the previous country's company while `country_prefix` was
      // rewritten to the country the form has since moved to, and
      // `clearCompanyIfCountryStale` could never fire on it again. Pinning only
      // a number the buyer actually entered keeps the witness tied to a
      // capture rather than to a keystroke that passed through.
      // Normalised on both sides, and requiring a value: `organization_number`
      // is seeded null by the constructor and written from parsed JSON by the
      // sole-trader prefill, so a raw `!==` reads the number 123456789 as
      // different from the string "123456789" and re-pins on a blur that moved
      // nothing — reopening the laundering this guard exists to close, through
      // a type mismatch. And a blur on an EMPTY untouched field would otherwise
      // count as movement ("" !== null), pinning a country onto a capture that
      // does not exist; inert today, but it makes the witness look
      // authoritative to the next reader, which is how this class of bug got
      // here.
      const previousNumber = twoincUtilHelper.blankToEmpty(
        Twoinc.getInstance().customerCompany.organization_number
      );
      const numberMoved = twoincUtilHelper.blankToEmpty(typed) !== previousNumber;
      Twoinc.getInstance().customerCompany.organization_number = typed;
      if (numberMoved && twoincUtilHelper.blankToEmpty(typed)) {
        Twoinc.getInstance().customerCompany.country_prefix =
          twoincSelectWooHelper.currentCountry();
      }
    } else if (inputName === "billing_company_display") {
      Twoinc.getInstance().customerCompany.company_name = $input.val();
    }

    twoincDomHelper.renderCompanySummary();
    Twoinc.getInstance().getApproval();
  }

  /**
   * Handle the representative input changes
   *
   * @param event
   */

  onRepresentativeInputBlur(event) {
    const $input = jQuery(this);

    let inputName = $input.attr("name").replace("billing_", "");

    if (inputName === "phone") inputName += "_number";

    Twoinc.getInstance().customerRepresentative[inputName] = $input.val();

    Twoinc.getInstance().getApproval();
  }

  /**
   * Handle the country input changes
   *
   * @param event
   */

  onCountryInputChange() {
    Twoinc.getInstance().syncBillingCountry();
  }

  /**
   * Bring everything that depends on the billing country back into step with
   * the field (TWO-24867). Reached only from the `change` handler on
   * #billing_country — that event is the closest thing this checkout has to a
   * buyer gesture on the country.
   *
   * Everything destructive lives behind that gesture on purpose. WooCommerce
   * can also move the country with no `change` at all — a `checkout_error`
   * re-render, a multi-step theme, a session address restored server-side —
   * and it is tempting to run this from `updated_checkout` so the tracker
   * cannot drift. It must NOT: those re-renders restore the country and the
   * company TOGETHER, so clearing on them destroys data the same re-render
   * just put back, which is the TWO-25326 failure again on a new trigger.
   * `onUpdatedCheckout` therefore only RECORDS the country (see there); the
   * tracker still cannot drift, and nothing is thrown away without a gesture.
   */
  syncBillingCountry() {
    const country = twoincSelectWooHelper.currentCountry();
    const changed = twoincSelectWooHelper.countryDidChange(country);

    // Unconditional, and BEFORE the guard below. This pass is idempotent —
    // it re-derives which company fields should be visible and required from
    // the current state and writes nothing the buyer typed — and the events
    // the guard now swallows are exactly the ones that just re-rendered the
    // billing fields underneath it (core's address-i18n.js re-sorts them on
    // `country_to_state_changing`). Gating it behind the guard along with
    // everything else would have turned this fix into a field-visibility
    // regression on every such re-render (TWO-24867).
    twoincDomHelper.toggleBusinessFields();

    // Everything past here is destructive, so only a REAL country change gets
    // to run it (TWO-25326 — see countryDidChange for the events this
    // swallows). The rest of what this handler used to do on those events is
    // already re-run by `onUpdatedCheckout`: sole-trader availability and the
    // approval check both go through it.
    if (!changed) {
      return;
    }

    const self = Twoinc.getInstance();

    // Invalidate everything already in flight under the OUTGOING country
    // (TWO-24867). Neither of these responses can be allowed to land:
    //
    //  - a company search would repopulate the picker with the previous
    //    country's register, next to a field this handler is about to clear;
    //  - an address lookup would write the previous country's registry
    //    address over the cleared address fields, and set
    //    registryAddressApplied on it.
    //
    // Both are supersession counters rather than aborts on purpose: the
    // network request may already have completed, so cancelling it is not
    // enough — the guard has to sit on the handler.
    twoincSelectWooHelper.companySearchSeq += 1;
    self.addressLookupSeq += 1;
    // Belt and braces, and DELIBERATELY not covered by a test — there is no
    // reachable case that fails without it today, so a test asserting the
    // spinner is gone afterwards would pass either way and be worse than
    // none. The reasoning for keeping the line anyway: the transport hands
    // the spinner off to whichever request is newest, so bumping the counter
    // above orphans the one an in-flight search is showing (its `always()`
    // now sees a stale sequence and returns before hiding it). What actually
    // clears it is `clearSelectedCompany()` below re-attaching the widget and
    // taking the dropdown — and the spinner node inside it — with it. That is
    // an incidental consequence of an unrelated call, not a guarantee.
    twoincSelectWooHelper.toggleCompanySearchSpinner(false);

    twoincDomHelper.clearSelectedCompany();

    // AFTER clearSelectedCompany, deliberately: that function resets
    // `customerCompany` to {} wholesale, so setting the country prefix before
    // it (as this used to) discarded it immediately and left getApproval()
    // below — and getDueInDays(), which early-returns without one — running
    // on an undefined country for the three seconds until the deferred
    // re-read inside clearSelectedCompany put it back (TWO-24867).
    self.customerCompany.country_prefix = country;

    // Sole trader availability is per-country; re-evaluate the toggle.
    twoincSoleTrader.refresh();

    self.getApproval();
  }

  /**
   * Drop a captured company that belongs to a country the checkout has since
   * moved away from (TWO-25333).
   *
   * The gap this closes. `onUpdatedCheckout` records a country that moved with
   * no `change` event and deliberately does NOT clear the capture, because
   * those re-renders restore the country and the company together and
   * clearing would destroy what the re-render just put back (TWO-24867 /
   * TWO-25326 — see there). But when the country really did move to something
   * the captured company does not belong to, that company survived and
   * nothing downstream caught it: `getApproval()` posts `customerCompany`
   * carrying the OLD `country_prefix` next to the OLD organisation number, so
   * the pair is internally consistent and the intent check approves it and
   * the buyer sees a green payment method; the order payload then pairs that
   * `company_id` with the ORDER's billing country with no consistency check
   * between the two. The mismatch reached the Two API at order creation and
   * came back as an opaque failure the buyer could not act on.
   *
   * Discriminating rather than choosing between "always clear" and "never
   * clear" is what keeps this from being TWO-25326 again: in the
   * restore-together case the recorded country and the captured company's own
   * country agree by construction, because the same re-render supplied both,
   * so this stays silent exactly where clearing would be destructive.
   *
   * Called only from `onUpdatedCheckout`. The `change` path
   * (`syncBillingCountry`) already clears unconditionally on a real country
   * change, which is strictly stronger, so running this there as well would
   * be dead code rather than extra safety.
   *
   * Three readings are NOT grounds to clear, and none of them is incidental:
   *
   *   - No organisation number on `customerCompany`. A company name with no
   *     id is not a capture (TWO-25326 §6: the payment method is usable only
   *     for a company captured WITH an id), and there is nothing about a bare
   *     name that a country change invalidates.
   *
   *     KNOWN RESIDUAL GAP, not closed here. `customerCompany` is populated
   *     from the DOM on a timer, so `#company_id` can hold a real capture
   *     while this object still holds nulls — during `initialize()`'s deferred
   *     seed, and for the three seconds after `clearSelectedCompany`. A silent
   *     country move inside one of those windows is missed, and the deferred
   *     re-read then pairs the old country's company with the new country via
   *     `getCompanyData()`, which reads `#billing_country` live and so
   *     UN-PINS the witness — leaving a self-consistent false pair nothing can
   *     detect afterwards. The country is not the only half `getCompanyData()`
   *     unpairs: it also sources the name from `getCompanyName()`, which in
   *     company-search mode reads the `checkoutInputs` sessionStorage snapshot
   *     rather than the DOM, so the name comes from a third moment again.
   *     Benign in both windows as things stand, because `organization_number`
   *     is empty there and every downstream guard refuses on that — but the
   *     gap is two-axis, not one, and a later reader should not conclude the
   *     name half is sound. Falling back to `#company_id` here would not help:
   *     the DOM has no per-company country to compare against, which is why
   *     the witness has to live in JS state at all. Closing it properly means
   *     stopping the DOM re-reads from overwriting a pinned `country_prefix`,
   *     which is a change to `getCompanyData()`'s contract and its several
   *     other callers — deliberately left for its own ticket rather than
   *     widened into this one.
   *   - An unknown country on either side. `country_prefix` is null until the
   *     first capture or DOM re-read, and an empty field reading means the
   *     field was mid-replacement — the same rule the address-lookup guard
   *     and `countryDidChange` already apply, for the same reason: only two
   *     countries that are both KNOWN and DIFFERENT are evidence of anything.
   *   - The DOM already holding a DIFFERENT company from the one recorded.
   *     Then it is the record that is stale, not the fields: `customerCompany`
   *     is refreshed from the DOM on a timer, so a re-render that swapped in
   *     another saved address — country AND company together, a different pair
   *     but a self-consistent one — reaches here with the previous capture
   *     still in JS state. Clearing on that would destroy the company the
   *     re-render had just restored, which is precisely the regression this
   *     ticket must not reintroduce. Re-sync to the DOM instead.
   *
   * Compared case-insensitively because the two sides are written by
   * different readers: `currentCountry()` upper-cases, `getCompanyData()`
   * reads `#billing_country` raw (the inconsistency noted in the comment on
   * `currentCountry`, still not swept up here). WooCommerce's country values
   * are upper-case ISO codes today, so this normalisation is guarding the
   * comparison against that known disagreement rather than against observed
   * mixed-case data — a false positive here is a destructive clear.
   *
   * Returns nothing on purpose. It reported whether it had cleared, the only
   * caller ignored it, and flipping the value broke no test — an unverified
   * contract stated in a docblock is worse than none.
   *
   * @param {string} country upper-cased ISO code the checkout has moved to
   * @returns {void}
   */
  clearCompanyIfCountryStale(country) {
    const company = this.customerCompany || {};
    if (!company.organization_number) return;

    const capturedCountry = twoincUtilHelper.blankToEmpty(company.country_prefix).toUpperCase();
    if (!country || !capturedCountry || capturedCountry === country) return;

    // Every comparison below goes through `blankToEmpty`, which normalises
    // null/undefined to "" and coerces to a trimmed string. Not defensive
    // noise: `organization_number` is seeded null by the constructor and
    // written from parsed JSON by the sole-trader prefill, so it is not
    // guaranteed to be a string, while `.val()` always is. A raw `!==` between
    // the number 123456789 and the string "123456789" is true, and every
    // comparison here treats "different" as evidence — so an un-normalised
    // compare turns a type mismatch into either a laundered stale pair or a
    // destructive clear of a valid capture.
    const domNumber = twoincUtilHelper.blankToEmpty(jQuery("#company_id").val());
    const domName = twoincUtilHelper.blankToEmpty(jQuery("#billing_company").val());
    const recordedNumber = twoincUtilHelper.blankToEmpty(company.organization_number);
    const recordedName = twoincUtilHelper.blankToEmpty(company.company_name);

    // The DOM holds a DIFFERENT company than the record: BOTH halves present
    // and BOTH diverged. Then it is the record that is stale rather than the
    // fields — a re-render swapped in another saved address, country and
    // company together, a different pair but a self-consistent one — and
    // clearing would destroy what that re-render just restored.
    //
    // Both halves, and both non-empty, is the whole discriminator. Requiring
    // only the number to diverge was fail-OPEN: a buyer typing into
    // `#company_id` without blurring produces the same divergence, and this
    // branch then pinned the new country onto a number no capture path had
    // witnessed, next to the PREVIOUS company's name — a two-moment pair made
    // self-consistent, which is the exact defect this function exists to catch.
    // Requiring the name to have moved too is what separates a restore (which
    // writes both mirrors) from a keystroke (which writes one).
    //
    // Anything else falls through to the clear, deliberately fail-CLOSED. In
    // particular a diverged number with an EMPTY `#billing_company` is NOT
    // trusted: taking the name from the record instead would pair company A's
    // name with company B's number, and writing the empty name through would
    // leave `isReadyApprovalCheck()` refusing forever — this branch arms no
    // deferred re-read, and the next re-render would see a self-consistent
    // pair and never fire again, so the payment method would be stuck unusable
    // with no way back. A clear is recoverable; that is not.
    //
    // Read field by field rather than through `getCompanyData()`, which is what
    // this did first and which was wrong on the half that matters: in
    // company-search mode that takes the name from `getCompanyName()`, and that
    // does not read the DOM at all — it reads the `checkoutInputs`
    // sessionStorage snapshot, refreshed only by `saveCheckoutInputs()`'s own
    // interval. So the name came from a different moment than the number and
    // the country. `#billing_company` is the right source here: the field
    // WooCommerce posts, the mirror a restore writes, and the one
    // `clearSelectedCompany` and `enterManualCompanyEntry` already treat as
    // authoritative.
    //
    // Two things here are deliberately NOT independently covered, because no
    // reachable case can distinguish them — recorded rather than left for the
    // next reader to "fix" into a difference:
    //
    //   - Normalising `recordedNumber` is defence in depth, not an independent
    //     guard. A number-vs-string mismatch on its own cannot reach the
    //     re-sync, because the name condition rejects it first; it would take a
    //     re-render that moved the name while leaving a numerically identical
    //     but differently typed number. Kept because all four values go through
    //     the same normaliser and making one of them the exception is how the
    //     next type mismatch gets in.
    //   - `company_name: domName` needs no fallback. The condition guarantees
    //     `domName` is non-empty, so `domName || recordedName` would be dead —
    //     and worse than dead: falling back to the record's name would pair
    //     company A's name with company B's number, which is the two-moment
    //     pair this whole function exists to prevent.
    if (domNumber && domName && domNumber !== recordedNumber && domName !== recordedName) {
      this.customerCompany = {
        company_name: domName,
        country_prefix: country,
        organization_number: domNumber
      };
      return;
    }

    // No supersession bump here, deliberately. `clearSelectedCompany()` below
    // empties the fields, so a company search or a registry address issued
    // under the outgoing country must not land on top of them afterwards — but
    // the only caller has already bumped both counters, unconditionally on the
    // country having moved, before it reaches this. A defensive repeat was
    // written here first and then removed: it changed nothing observable, so no
    // test could hold it in place, and an untestable line that reads as the
    // guarantee is worse than the guarantee living plainly at the one call
    // site. A second caller would have to bump them too, and its own test for
    // that is what would say so.
    twoincDomHelper.clearSelectedCompany();

    // AFTER clearSelectedCompany, for the reason spelled out in
    // syncBillingCountry: it resets `customerCompany` to {} wholesale, so an
    // assignment made before it is dropped and leaves getApproval() and
    // getDueInDays() with no country for the three seconds until its deferred
    // re-read runs.
    this.customerCompany.country_prefix = country;
  }
}

let instance = null;
let isTwoincSelected = null;
jQuery(function () {
  if (window.twoinc) {
    // WooCommerce core's own radio-click handler for payment method
    // selection (checkout.js payment_method_selected) calls
    // e.stopPropagation() and only fires a bare `payment_method_selected`
    // event on document.body — it never triggers `update_checkout`. This
    // gateway's buyer surcharge fee (apply_cart_fee) is conditional on
    // which payment method is currently chosen, so without an explicit
    // recalculation trigger here the fee neither appears when switching
    // TO this gateway nor disappears when switching AWAY from it, until
    // something unrelated (e.g. a term-chip click) happens to fire
    // update_checkout first. Bound once at page load; WC fires
    // payment_method_selected only when the checked radio actually
    // changes, so this does not cause extra recalculations on unrelated
    // re-renders.
    jQuery(document.body).on("payment_method_selected", function () {
      jQuery(document.body).trigger("update_checkout");
    });

    if (window.twoinc.enable_order_intent === "yes") {
      const initIfGatewayPresent = function () {
        if (jQuery("#payment_method_" + window.twoinc.gateway_id).length > 0) {
          // Run Twoinc code if order intent is enabled
          Twoinc.getInstance().initialize(true);
          return true;
        }
        return false;
      };
      if (!initIfGatewayPresent()) {
        // The gateway can be absent at page load yet appear later: the
        // server-side availability gate re-evaluates per order-review
        // refresh (basket total crossing the platform minimum, billing
        // country change). The old one-shot check left company search
        // unwired for the whole session. Re-check on every
        // updated_checkout; and when company search is enabled for other
        // methods, wire it immediately — that setting exists precisely
        // for checkouts where this gateway isn't offered.
        if (
          window.twoinc.enable_company_search === "yes" &&
          window.twoinc.enable_company_search_for_others === "yes"
        ) {
          Twoinc.getInstance().initialize(true);
        } else {
          const $body = jQuery(document.body);
          const retryInit = function () {
            // initialize(false): the load-time saved-input replay must not
            // run mid-session — replaying stored radio/checkbox clicks
            // TOGGLES state the buyer set after page load.
            if (jQuery("#payment_method_" + window.twoinc.gateway_id).length > 0) {
              Twoinc.getInstance().initialize(false);
              $body.off("updated_checkout", retryInit);
            }
          };
          $body.on("updated_checkout", retryInit);
        }
      }
    } else {
      // Handle initialization every time order review (right panel) is updated
      jQuery(document.body).on("updated_checkout", function () {
        // If shop defaults payment method to Twoinc, run Twoinc code
        if (twoincDomHelper.isTwoincSelected()) {
          Twoinc.getInstance().initialize(false);
          Twoinc.getInstance().onUpdatedCheckout();
        }

        // Run Twoinc code if Twoinc payment is selected
        jQuery("#payment_method_" + window.twoinc.gateway_id).on("change", function () {
          Twoinc.getInstance().initialize(false);
          Twoinc.getInstance().onUpdatedCheckout();
        });
      });

      // If last selected payment method is Twoinc, run Twoinc code anyway
      let lastSelectedPayment = twoincDomHelper.getCheckoutInput(
        "INPUT",
        "radio",
        "payment_method"
      );
      if (
        lastSelectedPayment &&
        lastSelectedPayment.id === "payment_method_" + window.twoinc.gateway_id
      ) {
        Twoinc.getInstance().initialize(true);
      }

      // Otherwise do not run Twoinc code
    }

    // Nothing to relocate or hide here any more (TWO-25288): the manual-entry
    // row is created inside the results list only while it should be visible,
    // and the link back to search is created hidden, in place, on first use.

    setTimeout(function () {
      // Init the hidden Company name field
      const companyName = twoincDomHelper.getCompanyName().trim();
      if (companyName) {
        jQuery("#billing_company").val(companyName);
      }
    }, 1000);
  }
});
