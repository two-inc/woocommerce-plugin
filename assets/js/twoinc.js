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
   * Visibility rule unchanged from the pseudo-option version: the search
   * threshold and nothing else — no "has a search completed" gate. The
   * button appears the moment the buyer has typed enough for a search to be
   * worth running, which is BEFORE the debounced request goes out, so a
   * buyer who already knows their company is not in the registry never has
   * to wait for a round trip to find that out.
   *
   * @returns {void}
   */
  syncManualEntryButton: function () {
    const helper = twoincSelectWooHelper;

    const picker = jQuery("#billing_company_display").data("select2");
    if (!picker || !picker.$results || !picker.$results.length) return;

    const $list = picker.$results;
    const $existing = jQuery("#" + helper.manualEntryRowId);
    const term = jQuery(helper.companySearchInputSelector).val() || "";

    if (term.length < helper.companySearchMinLength) {
      $existing.remove();
      return;
    }

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

        const btn = jQuery("#" + helper.manualEntryRowId).get(0);
        if (!btn) return;

        // Accepted risk, not handled: if the button happens to be hidden or
        // mid-transition at this exact moment, `.focus()` on a real browser
        // silently no-ops per the HTML spec (unlike jsdom, which does not
        // reliably enforce this, so no test here can catch it either way).
        // The buyer is left with focus stuck on the search field — no worse
        // than before this feature existed, just not the "Tab reaches the
        // button" this comment otherwise promises.
        e.preventDefault();
        e.stopPropagation();
        btn.focus();

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
    // Fixed the same way as the shortcut above — `stopPropagation` to keep
    // selectWoo's document handler from ever seeing this keydown — but
    // deliberately WITHOUT `preventDefault` this time: the whole point here
    // is to let the browser's own native Tab traversal proceed to whatever
    // the next real tab-stop is, in either direction (this button carries no
    // special Shift+Tab behaviour, so both directions get the same
    // protection).
    //
    // A known, DELIBERATELY UNFIXED gap this surfaces rather than causes,
    // found under adversarial review: selectWoo never actually clears
    // `isOpen()` on keyboard-only focus-away — nothing but Escape, a result
    // pick, or a `mousedown` anywhere outside the widget closes it
    // (`_attachCloseHandler` in the vendored bundle). A buyer who reaches
    // this button by keyboard and then keeps tabbing onward, without ever
    // clicking anything, leaves the dropdown "open" indefinitely — every
    // later Tab/Enter/Escape ANYWHERE on the page, including Enter on the
    // checkout submit button, still gets caught by selectWoo's unscoped
    // document handler until a stray click finally closes it. This predates
    // this feature; this fix just makes it reachable for the first time
    // (Tab could never actually escape the open dropdown at all before this
    // PR, so nobody could reach "focus outside + still open" via keyboard).
    // Deliberately NOT calling `.select2('close')` here to plug it: that
    // triggers selectWoo's own `container.on('close', ...)` handler, which
    // schedules `self.$selection.focus()` 1ms later UNCONDITIONALLY — which
    // would yank focus straight back from wherever the buyer just legitimately
    // tabbed to, reintroducing the exact keyboard trap #416 (#30.x.4) was
    // written to fix, just one level further out. A real fix needs
    // selectWoo's own close-on-blur gap addressed generally, not patched
    // per-field here — flagged to Doug as a candidate follow-up ticket rather
    // than attempted blind.
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
      });
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
    const $search = jQuery('input[aria-owns="select2-billing_company_display-results"]').parent();
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
   * Generate parameters for selectwoo
   */
  genSelectWooParams: function () {
    let country = jQuery("#billing_country").val();

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
          const searchParams = new URLSearchParams({
            country: country,
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
   * Move the fields to their original or Twoinc template location
   */
  positionFields: function () {
    setTimeout(function () {
      // If business account
      if (twoincDomHelper.isTwoincSelected()) {
        twoincDomHelper.moveField("billing_first_name_field", "fn");
        twoincDomHelper.moveField("billing_last_name_field", "ln");
        twoincDomHelper.moveField("billing_phone_field", "ph");
        twoincDomHelper.moveField("billing_email_field", "em");
      } else {
        twoincDomHelper.revertField("billing_first_name_field", "fn");
        twoincDomHelper.revertField("billing_last_name_field", "ln");
        twoincDomHelper.revertField("billing_phone_field", "ph");
        twoincDomHelper.revertField("billing_email_field", "em");
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
        visibleTargets.push("#billing_company_field", "#company_id_field");
        requiredTargets.push("#billing_company_field", "#company_id_field");
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

    // Clear the addresses, in case address get request fails
    if (window.twoinc.enable_address_lookup === "yes") {
      Twoinc.getInstance().setAddress({
        street_address: "",
        city: "",
        postal_code: ""
      });
    }
    Twoinc.getInstance().registryAddressApplied = false;

    jQuery("#select2-billing_company_display-container")
      .parent()
      .find(".select2-selection__arrow")
      .show();
    Twoinc.getInstance().customerCompany = {};
    twoincDomHelper.togglePaySubtitleDesc();

    // Update again after all elements are updated
    setTimeout(function () {
      Twoinc.getInstance().customerCompany = twoincDomHelper.getCompanyData();
      twoincDomHelper.togglePaySubtitleDesc();
    }, 3000);
  },

  /**
   * Insert the floating company id and closing button
   */
  insertFloatingCompany: function (companyId, delayInSecs) {
    if (!companyId) return;

    // Remove if exist
    jQuery(".floating-company").remove();

    let floatingCompany = jQuery(
      '<span class="floating-company">' +
        '  <span class="floating-company-id">' +
        companyId +
        "</span>" +
        '  <img src="' +
        window.twoinc.twoinc_plugin_url +
        'assets/images/x-button.svg" onclick="twoincDomHelper.clearSelectedCompany()"></img>' +
        "</span>"
    );
    floatingCompany.hide();
    floatingCompany.insertBefore("#billing_company_display");
    setTimeout(function () {
      let floatingCompany = jQuery(".floating-company");
      floatingCompany.insertBefore("#select2-billing_company_display-container");
      floatingCompany.show();
      jQuery("#select2-billing_company_display-container")
        .parent()
        .find(".select2-selection__arrow")
        .hide();
    }, delayInSecs);
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
   * `#billing_company_field` (round 3, #30.x.5.3). `#billing_company_field`
   * wraps BOTH the "Company name" <label> and the input; only the input has a
   * visible border. `.woocommerce-input-wrapper` is WooCommerce core's own
   * wrapper around just the <input> (see twoinc.css for how this button
   * centres against it), so appending here is what lets the CSS vertically
   * centre the button on the visible field itself rather than on label+input
   * combined. Falls back to `#billing_company_field` itself if a host
   * template does not carry the standard wrapper — additive rather than
   * fragile on markup this plugin does not control.
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
      .hide();

    let $wrapper = jQuery("#billing_company_field .woocommerce-input-wrapper");

    // Self-heal rather than silently degrade (found under adversarial
    // review before merge, round 3): a plain "fall back to
    // #billing_company_field" here would still centre the button with
    // `top: 50%; transform: translateY(-50%)` (see twoinc.css) against
    // #billing_company_field itself — which ALREADY carries `position:
    // relative` from before this fix — so on any host template that
    // doesn't render the standard WooCommerce wrapper, this button would
    // silently reproduce the exact label-height centring bug this round
    // exists to fix, with nothing to signal that the fallback path was
    // even taken. Instead, build an equivalent wrapper around just the
    // <input> ourselves: same DOM shape WooCommerce core's own
    // woocommerce_form_field() would have produced, so the CSS centring
    // rule has a consistent structure to hook onto regardless of which
    // path got here. Falls through to #billing_company_field only if
    // #billing_company itself is missing — a field this whole feature
    // already depends on existing.
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
    window.twoinc.enable_company_search = "no";

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
    if ($display.data("select2")) $display.select2("destroy");

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

        // Append company id to company name select box
        if (window.twoinc.user_meta_exists) {
          twoincDomHelper.insertFloatingCompany(window.twoinc.company_id, 2000);
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

  currentCountry: function () {
    return (jQuery("#billing_country").val() || "").toUpperCase();
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
      // restoring the merchant's setting on the way back to business mode.
      if (twoincSoleTrader.savedCompanySearch === null) {
        twoincSoleTrader.savedCompanySearch = window.twoinc.enable_company_search;
      }
      window.twoinc.enable_company_search = "no";
      const $display = jQuery("#billing_company_display");
      if ($display.data("select2")) {
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
        twoincSoleTrader.savedCompanySearch = null;
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
    const instance = Twoinc.getInstance();
    instance.customerCompany.organization_number = companyId;
    instance.customerCompany.company_name = companyName;
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

      // Set the company ID to HTML DOM
      $companyId.val(data.company_id);

      // Set the company name to HTML DOM
      $billingCompany.val(data.id);

      // Display company ID on the right of selected company name
      setTimeout(function () {
        twoincDomHelper.insertFloatingCompany(data.company_id, 0);
      }, 0);

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
    $body.on("click", "#" + twoincSelectWooHelper.searchCompanyBtnId, function () {
      twoincDomHelper.exitManualCompanyEntry();
    });

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
      twoincDomHelper.togglePaySubtitleDesc();
    });

    // Handle the country inputs change event
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
    setTimeout(function () {
      twoincDomHelper.saveCheckoutInputs();
      Twoinc.getInstance().customerCompany = twoincDomHelper.getCompanyData();
      Twoinc.getInstance().customerRepresentative = twoincDomHelper.getRepresentativeData();
      twoincDomHelper.insertFloatingCompany(
        Twoinc.getInstance().customerCompany.organization_number,
        0
      );
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
    const addressResponse = jQuery.ajax({
      dataType: "json",
      url: twoincUtilHelper.constructTwoincUrl(`/companies/v2/company/${selectedCompany.lookup_id}`)
    });
    addressResponse.done(function (response) {
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
      Twoinc.getInstance().customerCompany.organization_number = $input.val();
    } else if (inputName === "billing_company_display") {
      Twoinc.getInstance().customerCompany.company_name = $input.val();
    }

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

  onCountryInputChange(event) {
    const $input = jQuery(this);

    Twoinc.getInstance().customerCompany.country_prefix = $input.val();

    twoincDomHelper.toggleBusinessFields();

    twoincDomHelper.clearSelectedCompany();

    // Sole trader availability is per-country; re-evaluate the toggle.
    twoincSoleTrader.refresh();

    Twoinc.getInstance().getApproval();
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
