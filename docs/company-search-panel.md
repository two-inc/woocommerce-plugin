---
description: "The vendored company-search-panel.js (two-copy edit rule, parity digest) and its focus, gating and admin-setting behaviour."
---

# Vendored assets: the company search panel

- `assets/js/company-search-panel.js` is one of TWO copies of the same panel
  module — this one, and the one the Two Magento plugin carries — so both
  checkouts render one control. They are BYTE-IDENTICAL. The Two Hyvä extension
  carries no copy at all — it loads the base Magento plugin's panel by module
  reference — so there are two copies in total, not three.
- **A change to shared panel behaviour is TWO edits in ONE change set.** Apply it
  in place here and identically to the other copy, re-run both JS suites, and
  move both digests. Nothing links the copies: whoever changes one and stops has
  fixed one platform, and neither reviewer sees the other half. Re-copying the
  whole file is NOT a way to re-sync: once the copies differ it reverts whatever
  only this side held, and while they agree there is nothing to copy.
- `tests/js/company-search-panel-vendored.test.js` holds `EDIT_LOCK_SHA256`, this
  copy's own digest (TWO-25503), and the Magento plugin's suite locks its copy to
  the same constant. The suite fails on any change to this file that did not move
  the digest with it — an unintended edit, a stray formatter run, a bad merge.
  Neither repo can read the other, so **two matching digests are the parity
  check**: equal means the copies agree, different means they have drifted.
  `.prettierignore` keeps the formatter off the file so the digest is not moved by
  a reformat nobody asked for — and so this copy stays byte-equal to the other,
  which is authored in the Magento repo's 4-space, single-quote style.
- **Everything platform-specific is an OPTION passed to the panel**, never an edit
  to the file: the transport, the chips and their modes, the country source, the
  rate-limit scope. A difference that cannot be expressed as an option is a
  divergence, and it divides the two checkouts.
- The module is framework-free with a UMD tail, a constraint the other copy shares:
  a Magento-side checkout loads it with no RequireJS, jQuery or Knockout, so a
  framework dependency added to either copy lands in a place that cannot satisfy
  it.
- **The country gates withdraw SEARCH while a mode is left, and the whole
  CONTROL when none is.** `syncCompanySearchAvailability()` in
  `assets/js/twoinc.js` hands the registry answer to the panel's
  `setDisabled()`, which hides the query row and the registered-company chip
  with it; the panel still opens, so the sole-trader route stays reachable
  (ABN-525). `companySearchIsOffered()` is the other half: false where neither
  registry search nor sole trader can answer for the country, and false where
  the merchant record's buyer-country allowlist excludes it. Then the control is
  unmounted and `toggleBusinessFields()` puts WooCommerce's own company field on
  screen in its place — the capture mode stays `search`, since the layout
  changed and the mode did not (ABN-585). The company field never carries the
  native `disabled` flag, and a company-name field is always on screen —
  exactly one, except in payment-tile placement, where the tile row and the
  address area's own `#billing_company_field` are both shown by design. The
  registry gate reads the wider company-search coverage, one global
  list — not the sole-trader chip's own per-country registry lookup, which is a
  different and smaller list.
- **The chip row is shown whenever it offers a mode the buyer is not already
  in**, not merely whenever it holds two chips. A lone chip for the current mode
  is no choice; a lone chip for a different mode is the buyer's whole way out.
- **The company field opens the panel on FOCUS**, through the same `open()` a
  mousedown runs, leaving the caret in the panel's query field — or on the first
  offered chip where the query row is withdrawn, so no mode opens the panel with
  focus nowhere. Same state a click leaves it in, and the same on every platform
  that carries this control.
- **Wherever the mode leaves no query row, a printable key keeps the caret on the
  company field.** The panel opens onto a chip there and a chip is a `<button>`,
  which swallows text, so the character was lost with nothing on screen to say so
  (ABN-554). Both routes in are covered: a key pressed on the chip itself, and a
  key pressed on the field, whose own opener would otherwise park the caret on
  the chip before the character arrives. Space and Enter are excluded, since both
  activate the focused chip. The field's `input` handler then leaves the buyer's
  text where they can see it and, where a MODE withdrew the row, copies it into
  the query ready for the mode change that reveals it — not where the country
  gate did, since no search there can ever run.
- **Closing the panel puts focus back on the company-name field** — Escape, a
  pointer press outside it, a company adopted from the results, manual entry
  taking the field over, and the plugin's own close when a sole-trader signup
  answers (ABN-554). The field's own focus opener is held off for that one
  programmatic focus alone, so any keydown on the field, a pointer press on it,
  or focus arriving from anywhere else brings the popover straight back.
- **Three closes pass `returnFocus: false`, and each has a reason.** The
  deferred close-on-focus-leave fires only once focus has settled on another
  control, so taking it back would undo the buyer's own Tab (TWO-25326). The
  `focusin` classifier runs BECAUSE focus landed elsewhere. A country change
  leaves the buyer in the country select. The sole-trader settle places focus
  itself once the popup has gone, and the company field's own opener is what
  brings the picker back there (TWO-25658).
- **Escape is bound to the PANEL and to the company field, not to the query
  field.** Outside registered-company mode the query row is withdrawn and a chip
  is what holds focus, and the popover is drawn over the control below the field
  — so an Escape the query field alone answers leaves that buyer with no route
  out at all. The field needs its own binding because it is the panel's SIBLING,
  not a descendant: a mode change, and the sole-trader signup launch that parks
  focus there while the popover is deliberately held open, both leave the
  dismissal key on a node the panel's handler never sees (ABN-554).
- **A mode change places focus again, wherever it took it from.** The chip row
  is rebuilt from scratch and a mode that withdraws the query row hides the
  input the caret was in, which is what a pointer buyer's chip click leaves
  focus in, since the chip's own press cancels the native focus. It asks
  whether the NODE survived, never where focus is now: a browser does not blur
  the caret out of a hidden row until it restyles, which is after the handler
  that hid it, so focus still reads as that input inside the sync. Focus is
  placed again only where the sync itself took the holder away: inside the panel
  where it is still open, on the company-name field where it is not (ABN-554).
- **A press on the panel's own dead space is a no-op.** Its default action would
  blur the caret out of the query field and leave the open popover holding
  nothing, so the press is cancelled — except on a control, which a press is
  entitled to focus, and except on a scrollbar, where cancelling would stop the
  drag scrolling the results. The outside-press close is a different gesture and
  unaffected: it is a press the panel does not contain (ABN-554).
- **A pointer press outside the popover takes focus back only where the press
  left it nowhere**, and one tick later rather than in the handler: the press's
  own default action runs after the handler and either focuses what it hit or
  clears focus entirely, so focusing the field from the handler is simply
  undone. Neither default action exists in jsdom, which is why this needed a
  real browser.
- **A chip-row rebuild replaces every chip, so the focused one is destroyed.** The
  rebuild hands focus to the company field, and only where it actually disconnected
  the focused node — moving focus unconditionally would take it off whatever the
  buyer was legitimately using (ABN-561).
- **The open panel takes the field's tab stop** — `tabindex="-1"` while it is up,
  and on close the field's PRIOR value restored exactly, which is removal when
  there was none — a theme's own `tabindex` is given back, not removed
  (TWO-25503). Without it the focus opener is a keyboard trap: the opener puts the
  caret in the query field, Shift+Tab returns to the field, and the opener pushes
  focus forward again, so the buyer cannot get back past the control (WCAG 2.1.2).
- **Only one popover is open, page-wide.** Opening one closes whichever other one
  was open, enforced at open time rather than inferred from focus leaving the
  first: a real pointer press on the other role need not deliver a focus event to
  the control it hits (ABN-510). The popover that closes gives its own field's tab
  stop back before the newly opened one takes its. A pointer press outside the open
  popover closes it too, with the company field counted as inside the control.
- **No company field carries a required cue.** Neither the search control nor
  WooCommerce's native company row takes the `required` attribute or an
  asterisk, in any capture mode, placement or country: the payment tile's own
  guidance message is the whole signal (ABN-554). `toggleRequiredCues()` still
  serves the phone row.
- **"Autofill company address" is offered only while "Enable company search in
  address entry" is on.** That checkbox still only relocates the search control
  (see `get_enable_company_search()`); what it additionally gates is autofill.
  Off withdraws the autofill row from the admin screen AND unticks it, and
  `get_enable_address_lookup()` reads as `no` regardless of what is stored, so a
  `yes` saved before the switch went off cannot keep autofilling (ABN-554).
  Ticking company search on switches autofill on with it, edge-triggered
  (ABN-562). A legacy `enable_company_name` row is REWRITTEN to the current key
  at construction, because the current key's own `'default' => 'yes'` is what
  renders the admin checkbox: only one stored value makes the screen and every
  getter agree.
