/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 */

/**
 * TWO-25503: the company-capture popover — one anchored panel that owns the
 * query field, the result list AND the mode chips, matching PrestaShop's
 * `TwoCompanySearch`. There is no separate chip row: opening the control shows
 * the buyer one box containing every route it offers.
 *
 * This replaces the select2 picker. select2 could never satisfy that
 * requirement: it appends its dropdown to `<body>` and rewrites the contents on
 * every open, so anything of ours placed beside the field was a sibling the
 * dropdown drew over rather than a part of the control. The chips were
 * therefore hidden precisely when the buyer opened the thing that offers them.
 *
 * DOM ORDER IS THE DESIGN, not an implementation detail. Everything lives
 * inside the same `.two-company-field-wrap` as the company-name input, in this
 * order:
 *
 *   input[company] -> query field -> results host -> mode chips
 *
 * so the browser's own tab order walks the control the way it reads, and the
 * chips stay reachable without tabbing through up to 50 results. The panel is
 * `hidden` while closed, so none of it is a tab stop until the buyer opens it.
 *
 * Owns: the panel DOM, open/close, the query field, result rendering and
 * keyboard navigation, and the chips' markup and selected state.
 * Does NOT own: which chip means what (the host's capture component), the
 * search request or address write-back (the injected `search` API).
 *
 * FRAMEWORK-FREE ON PURPOSE. Two checkouts mount this same file: Magento's
 * Luma/RequireJS renderer and the Hyvä extension's Alpine one, which ships no
 * jQuery, no Knockout and no RequireJS. Everything platform-shaped is injected
 * (`search`, `translate`, `observe`), so neither side owns a second popover to
 * drift from the first — which is the whole reason this file exists as its own
 * unit. The UMD tail is what lets Hyvä load it as a plain script from
 * `Two_Gateway::js/model/company-search-panel.js` while Luma still gets an AMD
 * module.
 */
(function (root, factory) {
    'use strict';

    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else {
        root.TwoCompanySearchPanel = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const WRAP_CLASS = 'two-company-field-wrap';
    const PANEL_CLASS = 'two-company-dropdown';
    const SEARCH_ROW_CLASS = 'two-company-dropdown__search';
    const QUERY_CLASS = 'two-company-dropdown__query';
    const SPINNER_CLASS = 'two-company-dropdown__spinner';
    const RESULTS_CLASS = 'two-company-dropdown__results';
    const MESSAGE_CLASS = 'two-company-dropdown__message';
    const ROW_CLASS = 'two-company-dropdown__row';
    const ROW_ACTIVE_CLASS = 'two-company-dropdown__row--active';
    const BACK_CLASS = 'two-company-search-back';
    const CHIPS_CLASS = 'two-company-mode-chips';
    const CHIP_CLASS = 'two-company-mode-chip';
    const CHIP_SELECTED_CLASS = 'two-company-mode-chip--selected';

    // This plugin's own, because a bare `.hidden` is a theme's to define or not
    // — Luma ships one, several one-page checkouts do not, and a chip that
    // silently fails to hide offers the buyer a mode the country cannot serve.
    const HIDDEN_CLASS = 'two-hidden';

    /**
     * Every member the injected `search` API must carry. Checked at
     * construction because a host that supplies a partial one fails silently:
     * a missing `abortActiveRequest` throws inside a close, a missing
     * `noResultsMessage` renders the string "undefined" at the buyer.
     */
    const SEARCH_API_CONTRACT = [
        'MIN_INPUT_LENGTH',
        'SEARCH_DEBOUNCE_MS',
        'minInputLengthMessage',
        'noResultsMessage',
        'searchCompanies',
        'abortActiveRequest'
    ];

    /** Ids are per-panel: one page can host a panel per Two-family brand tile. */
    let instanceSeq = 0;

    /**
     * @param {object} options
     * @param {string} options.fieldSelector selector for the company-name input
     *        this panel anchors to. Re-read on every `bind()`, so a node
     *        replaced by a checkout re-render is picked up.
     * @param {object} options.config brand config subtree — needs
     *        `checkoutApiUrl`, `companySearchLimit`.
     * @param {object} options.search the transport, carrying every member of
     *        SEARCH_API_CONTRACT. Luma passes its `company-search` module
     *        verbatim; Hyvä passes an adapter over its own engine.
     * @param {function(string): string} [options.translate] Luma's
     *        `mage/translate`. Identity when the host has already localised.
     * @param {function(string, function(Element))} [options.observe] report the
     *        node matching a selector, now and on every later re-render. Luma
     *        passes Magento_Ui's `$.async`; a host with no such facility passes
     *        nothing and drives `bind()` itself.
     * @param {function(): (string|undefined)} [options.getCountryCode] the
     *        current ISO country code, read fresh on every search.
     * @param {function(): Array<{mode: string, text: string,
     *        onActivate: function}>} options.getChips the chips to render, in
     *        display order. Called on every sync, so a chip's label can follow
     *        the state it describes.
     * @param {function(string): boolean} [options.isChipVisible] whether a
     *        chip's mode is offered right now — country eligibility for sole
     *        trader, the admin setting for manual entry.
     * @param {function(): string} [options.getSelectedMode] which chip reads as
     *        selected.
     * @param {function(object)} [options.onSelect] the buyer picked a company;
     *        called with the result row.
     * @param {function(): string} [options.getDisplayText] what the field shows
     *        when the panel is closed — the captured company, or ''.
     * @param {function()} [options.onExitManualEntry] the buyer used the return
     *        link to come back out of manual entry.
     */
    function CompanySearchPanel(options) {
        options = options || {};
        this.fieldSelector = options.fieldSelector;
        this.config = options.config;
        this.search = options.search;
        this.translate = options.translate || function (text) { return text; };
        this.observe = options.observe || null;
        this.getCountryCode = options.getCountryCode || function () { return ''; };
        this.getChips = options.getChips || function () { return []; };
        this.isChipVisible = options.isChipVisible || function () { return true; };
        this.getSelectedMode = options.getSelectedMode || function () { return ''; };
        this.onSelect = options.onSelect || function () {};
        this.getDisplayText = options.getDisplayText || function () { return ''; };
        this.onExitManualEntry = options.onExitManualEntry || function () {};

        assertSearchApi(this.search);

        this._id = ++instanceSeq;
        this._field = null;
        this._panel = null;
        this._query = null;
        this._results = null;
        this._chips = null;
        this._back = null;
        this._open = false;
        this._items = [];
        this._activeIndex = -1;
        this._debounceId = null;
        /** Identity for the live bind, so a superseded search cannot paint over it. */
        this._token = null;
        /** Ordinal of the latest search, so an out-of-order response is dropped. */
        this._searchSeq = 0;
        /** Every selector this panel has an observer watching, ever. */
        this._observedSelectors = {};
        /** Suppresses the field's own open-on-focus while the panel closes itself. */
        this._closing = false;
        /** `observe` cannot be disconnected, so its callbacks read this instead. */
        this._destroyed = false;
        /** Listeners this panel owns, so teardown removes exactly its own. */
        this._listeners = [];
    }

    // ------------------------------------------------------------- DOM helpers

    /**
     * Bind a listener and record it, so `_unbind()` can take back exactly what
     * this panel put on a node and nothing else.
     *
     * The recording replaces jQuery's event namespaces, which is what the
     * `.twoCompanyPanel` suffix used to buy: a checkout re-render leaves this
     * class re-binding the same nodes, and blanket `removeEventListener` by
     * type would take the host page's handlers with it.
     *
     * @param {EventTarget} target
     * @param {string} type
     * @param {function} handler
     */
    CompanySearchPanel.prototype._bindEvent = function (target, type, handler) {
        if (!target) return;
        target.addEventListener(type, handler);
        this._listeners.push({ target: target, type: type, handler: handler });
    };

    /**
     * Remove every listener this panel bound to `root` OR ANYTHING INSIDE IT,
     * or all of them when no root is named.
     *
     * The descendant half is what jQuery's `.empty()` used to do for free: the
     * chips are rebuilt on every sync and the panel is rebuilt on every
     * re-render, and recording only exact matches would leave an entry per
     * discarded chip for the page's lifetime.
     *
     * @param {EventTarget} [root]
     */
    CompanySearchPanel.prototype._unbind = function (root) {
        const isElement = !!root && root.nodeType === 1;
        this._listeners = this._listeners.filter(function (entry) {
            const owned = !root
                || entry.target === root
                || (isElement && entry.target.nodeType === 1 && root.contains(entry.target));
            if (!owned) return true;
            entry.target.removeEventListener(entry.type, entry.handler);
            return false;
        });
    };

    /**
     * @param {object} search the injected transport
     */
    function assertSearchApi(search) {
        const missing = SEARCH_API_CONTRACT.filter(function (member) {
            return !search || search[member] === undefined;
        });
        if (!missing.length) return;
        // Loud rather than thrown: a checkout that still renders a plain
        // company field is worth more to the buyer than one that dies on boot.
        console.error(
            'CompanySearchPanel: search API is missing ' + missing.join(', ')
        );
    }

    /**
     * @param {Element} parent
     * @param {string} className
     * @returns {Array<Element>} direct children carrying `className`
     */
    function childrenWithClass(parent, className) {
        if (!parent) return [];
        return Array.prototype.filter.call(parent.children, function (child) {
            return child.classList.contains(className);
        });
    }

    /**
     * @param {Element} node
     * @param {string} type
     */
    function fire(node, type) {
        // The constructor comes from the node's OWN document, not this
        // module's global scope: the panel is loaded once and mounted against
        // whatever document the host hands it.
        const view = node.ownerDocument.defaultView;
        node.dispatchEvent(new view.Event(type, { bubbles: true }));
    }

    // ------------------------------------------------------------------ build

    /**
     * Point the panel at whatever `fieldSelector` currently matches, building
     * it there if it is not there yet. Safe to call repeatedly.
     *
     * @param {object} [bindOptions]
     * @param {boolean} [bindOptions.open] open as soon as it is bound — what a
     *        deliberate click on the registered-company chip means. Left off
     *        for a checkout's initial bind, where popping the panel open
     *        unasked would steal focus from the form.
     */
    CompanySearchPanel.prototype.bind = function (bindOptions) {
        const self = this;
        const wantsOpen = !!(bindOptions && bindOptions.open);
        const selector = this.fieldSelector;

        // ONE observer per selector, EVER — the observer is a MutationObserver
        // that cannot be disconnected, and building the panel mutates the DOM,
        // so a second registration makes the first one's own mutations
        // re-trigger this callback and every later render re-fires every
        // observer ever registered (TWO-25503, the checkout freeze). Tracked as
        // a set, not a single "current" selector: the component re-points this
        // panel between the address step and the payment tile, and a
        // last-selector-wins check re-registers on every switch.
        if (this.observe && !this._observedSelectors[selector]) {
            this._observedSelectors[selector] = true;
            this.observe(selector, function (fieldNode) {
                // The observer for an abandoned mount stays live forever. Left
                // unguarded it drags the panel back to the host the buyer moved
                // off — a payment tile re-rendering on a totals change would
                // re-anchor a control the buyer is typing into on the address
                // step, and mint a new token the in-flight search can no longer
                // be aborted against.
                if (self._destroyed || selector !== self.fieldSelector) return;
                self._attach(fieldNode);
            });
        }

        const field = document.querySelector(selector);
        if (field) this._attach(field);
        if (wantsOpen) this.open();
    };

    /**
     * Build (or adopt) the panel on `field` and wire the field's openers.
     *
     * @param {Element} field company-name input
     */
    CompanySearchPanel.prototype._attach = function (field) {
        // An observer can report the selector without a node behind it, which
        // is not a host to build on.
        if (!field || field.nodeType !== 1 || this._destroyed) return;
        const previous = this._field;
        const rebinding = previous === field;
        if (!rebinding) {
            // The abandoned host keeps its wrapper otherwise, and a second
            // wrapper is a second anchor: the sole-trader fallback note then
            // renders against a host the buyer has left.
            this._releaseWrap(previous);
            // Fresh identity, so a search issued by the node this call replaces
            // resolves into a token nothing is listening for.
            this._token = {};
        }
        this._field = field;

        this._buildPanel(this._ensureWrap(field));
        this.syncChips();

        // Manual entry owns the field: it is a plain text input holding what
        // the buyer typed. Re-arming the openers would pop the popover over
        // them on focus, and painting `getDisplayText()` would blank the name,
        // which nothing else records.
        if (this.getSelectedMode() === 'manual') return;

        this._bindFieldOpeners(field);
        // The closed-state watermark. Set here rather than left to the host
        // form: on the address step core renders this field with no
        // placeholder at all, so nothing would say what clicking it does.
        field.setAttribute('placeholder', this.translate('Enter company name to search'));
        // The field is what a keyboard buyer actually reaches, so it — not the
        // query input inside the panel — is what has to announce that this is a
        // combobox and whether its list is showing.
        field.setAttribute('role', 'combobox');
        field.setAttribute('aria-haspopup', 'listbox');
        field.setAttribute('aria-controls', `two-company-results-${this._id}`);
        field.setAttribute('aria-expanded', this._open ? 'true' : 'false');
        this.setDisplayText(this.getDisplayText());
    };

    /**
     * Retire the wrapper and panel around a host this panel has left.
     *
     * @param {Element} field the previous field, or null on first attach
     */
    CompanySearchPanel.prototype._releaseWrap = function (field) {
        if (!field) return;
        const wrap = field.parentElement;
        if (!wrap || !wrap.classList.contains(WRAP_CLASS)) return;
        const panels = childrenWithClass(wrap, PANEL_CLASS);
        const self = this;
        panels.forEach(function (panel) {
            self._unbind(panel);
            panel.remove();
        });
        this._unbind(field);
        // A re-render can wipe the whole subtree first, leaving the wrapper
        // detached — there is then nowhere to put the field back and nothing
        // left to unwrap.
        if (wrap.parentNode) wrap.parentNode.insertBefore(field, wrap);
        wrap.remove();
    };

    /**
     * The positioning context the panel is absolutely positioned against.
     *
     * @param {Element} field
     * @returns {Element} the wrapper
     */
    CompanySearchPanel.prototype._ensureWrap = function (field) {
        const parent = field.parentElement;
        if (parent && parent.classList.contains(WRAP_CLASS)) return parent;
        const wrap = document.createElement('span');
        wrap.className = WRAP_CLASS;
        field.parentNode.insertBefore(wrap, field);
        wrap.appendChild(field);
        return wrap;
    };

    /**
     * Build the panel once per wrapper, or adopt the one already there.
     *
     * Adoption matters as much as construction: this runs again on every
     * re-render the observer reports, and a second panel in the same wrapper
     * would leave two query fields writing to one identity.
     *
     * @param {Element} wrap
     */
    CompanySearchPanel.prototype._buildPanel = function (wrap) {
        const self = this;
        const existing = childrenWithClass(wrap, PANEL_CLASS)[0];
        if (existing) {
            this._panel = existing;
            this._query = existing.querySelector('.' + QUERY_CLASS);
            this._results = existing.querySelector('.' + RESULTS_CLASS);
            this._chips = existing.querySelector('.' + CHIPS_CLASS);
            return;
        }

        const panel = document.createElement('div');
        panel.className = PANEL_CLASS;
        panel.setAttribute('hidden', 'hidden');

        const searchRow = document.createElement('div');
        searchRow.className = SEARCH_ROW_CLASS;

        // `placeholder` carries the LENGTH REQUIREMENT, not the watermark the
        // company field already showed to get here. `aria-label` deliberately
        // does not mirror it: that is the field's accessible NAME, and naming
        // the field after a transient hint leaves a screen-reader user tabbing
        // back in after a full query still hearing "Enter 3 or more
        // characters" as what the field IS.
        const query = document.createElement('input');
        query.type = 'text';
        query.autocomplete = 'off';
        query.className = QUERY_CLASS;
        query.setAttribute('placeholder', this.search.minInputLengthMessage());
        query.setAttribute('aria-label', this.translate('Search for company'));
        query.setAttribute('role', 'combobox');
        query.setAttribute('aria-autocomplete', 'list');
        query.setAttribute('aria-expanded', 'true');
        query.setAttribute('aria-controls', `two-company-results-${this._id}`);
        this._query = query;

        // A real element rather than a background on the input, so it sits at
        // the field's end regardless of the theme's input padding.
        const spinner = document.createElement('span');
        spinner.className = SPINNER_CLASS;
        spinner.setAttribute('aria-hidden', 'true');
        searchRow.appendChild(query);
        searchRow.appendChild(spinner);

        const results = document.createElement('div');
        results.className = RESULTS_CLASS;
        results.id = `two-company-results-${this._id}`;
        results.setAttribute('role', 'listbox');
        this._results = results;

        const chips = document.createElement('div');
        chips.className = CHIPS_CLASS;
        this._chips = chips;

        // Chips AFTER the results host, so "the query field is the next tab
        // stop after the company-name field" stays true.
        panel.appendChild(searchRow);
        panel.appendChild(results);
        panel.appendChild(chips);
        wrap.appendChild(panel);
        this._panel = panel;

        this._bindPanelHandlers();
        // Closing on an outside click is the panel's own business, and one
        // listener serves every open/close cycle for its lifetime.
        this._bindEvent(document, 'mousedown', function (event) {
            if (!self._open) return;
            if (self._panel && self._panel.contains(event.target)) return;
            if (self._field === event.target) return;
            self.close();
        });
    };

    // --------------------------------------------------------------- handlers

    /** Wire the query field and the results list. Idempotent. */
    CompanySearchPanel.prototype._bindPanelHandlers = function () {
        const self = this;

        this._unbind(this._query);
        this._bindEvent(this._query, 'input', function () {
            self._queueSearch(self._query.value);
        });
        this._bindEvent(this._query, 'keydown', function (event) {
            self._onQueryKeydown(event);
        });

        this._unbind(this._results);
        // Delegated: rows are replaced on every search.
        this._bindEvent(this._results, 'mousedown', function (event) {
            const row = event.target.closest ? event.target.closest('.' + ROW_CLASS) : null;
            if (!row || !self._results.contains(row)) return;
            // Before the blur a click would otherwise fire first, which
            // would close the panel out from under the selection.
            event.preventDefault();
            self._selectIndex(Array.prototype.indexOf.call(self._results.children, row));
        });
    };

    /**
     * The field is the control's trigger: clicking it, or typing into it, opens
     * the panel and moves what was typed into the query field, so the buyer
     * never has to type their first characters twice.
     *
     * `keydown` cannot be the only route in. It never fires a printable `key`
     * for an IME composition (`key` is `'Process'`, and the buyer's actual
     * characters arrive later) or for a paste, so a CJK buyer typing their
     * company name would watch the popover sit on the too-short hint forever.
     * `input` is what catches both: whatever reached the field, however it got
     * there, is moved across and the field is left as the panel found it.
     *
     * @param {Element} field
     */
    CompanySearchPanel.prototype._bindFieldOpeners = function (field) {
        const self = this;
        this._unbind(field);

        this._bindEvent(field, 'mousedown', function (event) {
            if (self._closing) return;
            // The default action of this mousedown is to focus the field
            // itself, which lands AFTER open() has put the caret in the
            // query field and takes it straight back out again — leaving
            // the buyer looking at an open panel they have to click a
            // second time to type into.
            event.preventDefault();
            self.open();
        });
        this._bindEvent(field, 'focus', function () {
            if (self._closing) return;
            self.open();
        });
        this._bindEvent(field, 'keydown', function (event) {
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            // The buyer is leaving, not searching.
            if (event.key === 'Tab' || event.key === 'Escape') return;
            self.open();
        });
        this._bindEvent(field, 'input', function () {
            const typed = field.value;
            if (!typed) return;
            self.open();
            // The captured company's name is what this field shows; leaving
            // the buyer's keystrokes in it would overwrite that with a
            // half-typed query before they have picked anything.
            field.value = self.getDisplayText() || '';
            self._query.value = typed;
            self._query.focus();
            self._queueSearch(typed);
        });
    };

    /**
     * Arrow keys walk the results, Enter takes the active one, Escape closes.
     *
     * Tab is deliberately untouched: the next tab stop is the chips, which is
     * the tab order the DOM already describes.
     *
     * @param {object} event keydown event
     */
    CompanySearchPanel.prototype._onQueryKeydown = function (event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            this.close({ returnFocus: true });
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            if (this._activeIndex >= 0) this._selectIndex(this._activeIndex);
            return;
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        if (!this._items.length) return;
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const next = this._activeIndex + step;
        // Clamped rather than wrapped: wrapping from the last row to the first
        // reads as the list having reloaded under the buyer.
        this._setActiveIndex(Math.min(Math.max(next, 0), this._items.length - 1));
    };

    // ----------------------------------------------------------- open / close

    /**
     * Open the panel and put the caret in the query field.
     *
     * An ALREADY-open panel still re-syncs and re-focuses rather than
     * returning early: the popover stays up behind the signup popup, so
     * "return to registered-company mode" arrives here with the panel open and
     * the query row hidden, and an early return would leave the buyer looking
     * at a search box nothing put the caret in.
     */
    CompanySearchPanel.prototype.open = function () {
        if (!this._panel) return;
        const wasOpen = this._open;
        this._open = true;
        this._panel.removeAttribute('hidden');
        // Before the focus below: the query row is hidden outside
        // registered-company mode, and a hidden input cannot take the caret.
        this.syncChips();
        if (!wasOpen) {
            // The previous session's rows would otherwise be the first thing
            // the buyer sees for a query they have not typed yet.
            this._query.value = '';
            // Empty, not the too-short hint: the query field's own placeholder
            // already carries it, and both says the same thing twice.
            this._renderMessage('');
        }
        if (this._field) this._field.setAttribute('aria-expanded', 'true');
        this._query.focus();
    };

    /**
     * Close the panel and drop whatever the last search left in it.
     *
     * @param {object} [options]
     * @param {boolean} [options.returnFocus] put focus back on the field —
     *        what Escape means. Left off for a click elsewhere, where the
     *        buyer has already chosen where to go.
     */
    CompanySearchPanel.prototype.close = function (options) {
        if (!this._panel || !this._open) return;
        this._open = false;
        this._cancelPendingSearch();
        // A response still on the wire would paint rows into a panel the buyer
        // has closed, and _searchSeq alone would let the next open inherit them.
        this.search.abortActiveRequest(this._token);
        this._setSearching(false);
        this._panel.setAttribute('hidden', 'hidden');
        this._items = [];
        this._activeIndex = -1;
        if (this._field) this._field.setAttribute('aria-expanded', 'false');
        if (options && options.returnFocus && this._field) {
            // Guards the field's own focus opener against reopening the panel
            // this call is closing.
            this._closing = true;
            this._field.focus();
            this._closing = false;
        }
    };

    /** @returns {boolean} whether the panel is currently open */
    CompanySearchPanel.prototype.isOpen = function () {
        return this._open;
    };

    // ----------------------------------------------------------------- search

    /**
     * Debounce a keystroke into a search.
     *
     * @param {string} term raw query-field value
     */
    CompanySearchPanel.prototype._queueSearch = function (term) {
        const self = this;
        const query = String(term || '').trim();
        this._cancelPendingSearch();
        if (query.length < this.search.MIN_INPUT_LENGTH) {
            // Not merely "no results yet": a search already on the wire would
            // answer for a term the buyer has backspaced away from.
            this.search.abortActiveRequest(this._token);
            this._setSearching(false);
            // Nothing typed yet is the placeholder's job; a partial term is
            // where the buyer needs telling why no results came.
            this._renderMessage(query ? this.search.minInputLengthMessage() : '');
            return;
        }
        this._setSearching(true);
        this._debounceId = setTimeout(function () {
            self._debounceId = null;
            self._runSearch(query);
        }, this.search.SEARCH_DEBOUNCE_MS);
    };

    /** Drop a debounced search that has not fired yet. */
    CompanySearchPanel.prototype._cancelPendingSearch = function () {
        if (this._debounceId === null) return;
        clearTimeout(this._debounceId);
        this._debounceId = null;
    };

    /**
     * Issue a search and render whatever comes back.
     *
     * @param {string} query already past the length threshold
     */
    CompanySearchPanel.prototype._runSearch = function (query) {
        const self = this;
        const seq = ++this._searchSeq;
        this.search.abortActiveRequest(this._token);
        this.search
            .searchCompanies({
                config: this.config,
                token: this._token,
                term: query,
                getCountryCode: this.getCountryCode
            })
            .then(function (result) {
                // A response for a term the buyer has already typed past.
                if (seq !== self._searchSeq) return;
                if (result.aborted) return;
                self._setSearching(false);
                if (result.unavailable) {
                    // Styled apart from the other two messages on purpose
                    // (TWO-25326): "the search is down" and "your company is
                    // not here" are different answers and must not read alike.
                    self._renderMessage(
                        self.translate('Company search is unavailable right now. Please try again shortly.'),
                        MESSAGE_CLASS + '--unavailable'
                    );
                    return;
                }
                self._renderResults(result.items);
            });
    };

    /**
     * @param {boolean} isSearching
     */
    CompanySearchPanel.prototype._setSearching = function (isSearching) {
        if (!this._panel) return;
        const spinner = this._panel.querySelector('.' + SPINNER_CLASS);
        if (!spinner) return;
        spinner.classList.toggle(SPINNER_CLASS + '--active', !!isSearching);
    };

    // --------------------------------------------------------------- results

    /**
     * @param {Array} items rows from the search API
     */
    CompanySearchPanel.prototype._renderResults = function (items) {
        const self = this;
        this._items = items || [];
        this._activeIndex = -1;
        if (!this._items.length) {
            this._renderMessage(this.search.noResultsMessage());
            return;
        }
        this._results.innerHTML = '';
        this._items.forEach(function (item, index) {
            const row = document.createElement('div');
            row.className = ROW_CLASS;
            row.setAttribute('role', 'option');
            row.setAttribute('aria-selected', 'false');
            row.id = `two-company-row-${self._id}-${index}`;
            // `innerHTML`, not text: the API marks the matched substring, and
            // it is built from the buyer's own query server-side.
            row.innerHTML = item.html;
            self._results.appendChild(row);
        });
    };

    /**
     * Replace the result rows with a single line of copy — too-short, no
     * matches, or the search being down. Rendered in the results host rather
     * than above it so the chips stay the last thing in the panel.
     *
     * @param {string} text
     * @param {string} [modifier] extra class, where the state needs its own
     *        treatment rather than the neutral one
     */
    CompanySearchPanel.prototype._renderMessage = function (text, modifier) {
        if (!this._results) return;
        this._items = [];
        this._activeIndex = -1;
        const message = document.createElement('div');
        message.className = MESSAGE_CLASS;
        message.textContent = text;
        if (modifier) message.classList.add(modifier);
        this._results.innerHTML = '';
        this._results.appendChild(message);
    };

    /**
     * @param {number} index row to mark active
     */
    CompanySearchPanel.prototype._setActiveIndex = function (index) {
        this._activeIndex = index;
        const rows = childrenWithClass(this._results, ROW_CLASS);
        rows.forEach(function (row) {
            row.classList.remove(ROW_ACTIVE_CLASS);
            row.setAttribute('aria-selected', 'false');
        });
        const active = rows[index];
        if (!active) return;
        active.classList.add(ROW_ACTIVE_CLASS);
        active.setAttribute('aria-selected', 'true');
        this._query.setAttribute('aria-activedescendant', active.id || '');
        if (active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
    };

    /**
     * Take the row at `index` as the buyer's answer.
     *
     * @param {number} index
     */
    CompanySearchPanel.prototype._selectIndex = function (index) {
        const item = this._items[index];
        if (!item) return;
        this.setDisplayText(item.text);
        this.close();
        this.onSelect(item);
    };

    // ----------------------------------------------------------------- chips

    /**
     * Render the chips inside the panel and mark the selected one.
     *
     * Rebuilt from `getChips()` rather than mutated in place: the set itself
     * changes with the country and the admin setting, and a rebuild cannot
     * leave a stale chip wired to a mode that is no longer offered.
     */
    CompanySearchPanel.prototype.syncChips = function () {
        const self = this;
        if (!this._chips) return;
        const selected = this.getSelectedMode();
        this._syncQueryVisibility(selected);
        this._unbind(this._chips);
        this._chips.innerHTML = '';
        this.getChips().forEach(function (chip) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = CHIP_CLASS;
            button.classList.toggle(CHIP_SELECTED_CLASS, chip.mode === selected);
            button.classList.toggle(HIDDEN_CLASS, !self.isChipVisible(chip.mode));
            button.setAttribute('data-two-chip', chip.mode);
            button.setAttribute('data-element', 'click-element');
            button.setAttribute('aria-pressed', chip.mode === selected ? 'true' : 'false');
            button.textContent = chip.text;
            self._bindEvent(button, 'mousedown', function (event) {
                // The panel closes on an outside mousedown; this one is
                // inside it, but the query field's blur would still fire
                // before the click reaches the chip.
                event.preventDefault();
            });
            self._bindEvent(button, 'click', function (event) {
                event.preventDefault();
                // Propagation stops here because one-page checkouts bind
                // collapse handlers above this node.
                event.stopPropagation();
                chip.onActivate();
            });
            self._chips.appendChild(button);
        });
    };

    /**
     * The search row belongs to registered-company mode alone. A sole trader is
     * enrolled through the hosted signup and a manual entry is typed into the
     * company field, so a query box in either mode offers a search that answers
     * for neither.
     *
     * @param {string} mode the selected capture mode
     */
    CompanySearchPanel.prototype._syncQueryVisibility = function (mode) {
        if (!this._query) return;
        const searching = mode === 'registered';
        const row = this._query.closest('.' + SEARCH_ROW_CLASS);
        if (row) row.classList.toggle(HIDDEN_CLASS, !searching);
        if (searching) return;
        // Blanking the value fires no event, so the rows the dropped term
        // produced would stay painted and clickable under a search row that is
        // no longer rendered.
        this._query.value = '';
        this._renderMessage('');
    };

    // ------------------------------------------------------------------ field

    /**
     * Paint the company-name field with what is currently captured.
     *
     * @param {string} text
     */
    CompanySearchPanel.prototype.setDisplayText = function (text) {
        if (!this._field) return;
        this._field.value = text || '';
        // Magento's own KO binding reads the field on `change`, so a value
        // written here is invisible to the quote without it.
        fire(this._field, 'change');
    };

    /**
     * Hand the field back as a plain typeable input — manual entry, where the
     * buyer supplies a name the registry does not have.
     *
     * The popover goes with it, so the chips go too: the return link this
     * renders is then the buyer's only route back to the search, and without it
     * manual entry is a dead end.
     */
    CompanySearchPanel.prototype.releaseField = function () {
        this._cancelPendingSearch();
        this.search.abortActiveRequest(this._token);
        this.close();
        if (this._field) {
            this._unbind(this._field);
            ['role', 'aria-haspopup', 'aria-controls', 'aria-expanded'].forEach(function (attr) {
                this._field.removeAttribute(attr);
            }, this);
        }
        this.renderBackToSearchLink();
    };

    /** Re-take a field released for manual entry. */
    CompanySearchPanel.prototype.reclaimField = function () {
        this.removeBackToSearchLink();
        if (this._field) this._attach(this._field);
    };

    /**
     * The way out of manual entry: a link below the company field, aligned to
     * its right-hand edge.
     *
     * A real `<button type="button">` — focusable, Enter/Space-activated and
     * announced as a button with nothing added by hand, which a styled `<div>`
     * is not. `type="button"` because this sits inside the checkout's own form
     * and a default-type button would submit it.
     */
    CompanySearchPanel.prototype.renderBackToSearchLink = function () {
        const self = this;
        if (!this._field) return;
        this.removeBackToSearchLink();
        const link = document.createElement('button');
        link.type = 'button';
        link.className = BACK_CLASS;
        link.textContent = this.translate('Search for company');
        this._bindEvent(link, 'click', function (event) {
            event.preventDefault();
            // One-page checkouts bind accordion handlers above this node,
            // which read a bubbled click as "collapse this step".
            event.stopPropagation();
            self.onExitManualEntry();
        });
        // Appended to the wrapper rather than after the input, so it lands
        // below the panel that shares that wrapper rather than between the
        // field and its own popover.
        this._field.parentElement.appendChild(link);
        this._back = link;
    };

    /**
     * Remove the return link and unbind it.
     *
     * The class-wide sweep is deliberate: this panel's own reference does not
     * cover a link left on a host it has since moved off, and two of these on
     * one form is worse than none.
     */
    CompanySearchPanel.prototype.removeBackToSearchLink = function () {
        const self = this;
        if (this._back) {
            this._unbind(this._back);
            this._back.remove();
            this._back = null;
        }
        Array.prototype.forEach.call(
            document.querySelectorAll('.' + BACK_CLASS),
            function (node) {
                self._unbind(node);
                node.remove();
            }
        );
    };

    /**
     * Cancel the in-flight search for the current bind, if any.
     *
     * @returns {boolean} true when a request was actually aborted
     */
    CompanySearchPanel.prototype.abortActiveRequest = function () {
        this._cancelPendingSearch();
        return this.search.abortActiveRequest(this._token);
    };

    /**
     * @returns {Array<Element>} the field this panel is anchored to, or empty.
     *          Array-shaped rather than the bare node so a caller can ask
     *          `.length` without knowing whether the panel is mounted.
     */
    CompanySearchPanel.prototype.getField = function () {
        return this._field ? [this._field] : [];
    };

    /** @returns {boolean} whether the panel is built and anchored */
    CompanySearchPanel.prototype.isBound = function () {
        return !!(this._field && this._field.isConnected && this._panel);
    };

    /** @returns {object|null} the current bind identity — for tests that pin it */
    CompanySearchPanel.prototype.getBindToken = function () {
        return this._token;
    };

    /**
     * Tear the panel down entirely, leaving the field as core rendered it.
     *
     * Final: the observers outlive this and cannot be disconnected, so
     * `_destroyed` is what stops the next re-render rebuilding a panel nobody
     * owns — along with a fresh document listener the teardown that already ran
     * would never remove.
     */
    CompanySearchPanel.prototype.destroy = function () {
        this._destroyed = true;
        this._cancelPendingSearch();
        this.search.abortActiveRequest(this._token);
        this._unbind();
        if (this._panel) this._panel.remove();
        this._panel = null;
        this._query = null;
        this._results = null;
        this._chips = null;
        this._open = false;
    };

    CompanySearchPanel.SEARCH_API_CONTRACT = SEARCH_API_CONTRACT;

    CompanySearchPanel.CLASSES = {
        WRAP: WRAP_CLASS,
        PANEL: PANEL_CLASS,
        SEARCH_ROW: SEARCH_ROW_CLASS,
        QUERY: QUERY_CLASS,
        SPINNER: SPINNER_CLASS,
        RESULTS: RESULTS_CLASS,
        MESSAGE: MESSAGE_CLASS,
        ROW: ROW_CLASS,
        ROW_ACTIVE: ROW_ACTIVE_CLASS,
        BACK: BACK_CLASS,
        CHIPS: CHIPS_CLASS,
        CHIP: CHIP_CLASS,
        CHIP_SELECTED: CHIP_SELECTED_CLASS,
        HIDDEN: HIDDEN_CLASS
    };

    return CompanySearchPanel;
}));
