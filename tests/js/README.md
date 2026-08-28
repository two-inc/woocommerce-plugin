# Browser JS test suite

Jest + jsdom over the plugin's checkout JavaScript in `assets/js/`.

```bash
make test-js            # from the plugin root; needs host Node 20+
npm run test:js         # equivalent, if node_modules is already installed
```

CI gates this as the `Jest (Node 20)` job in `.github/workflows/unit-tests.yaml`. It is a
real gate, not `continue-on-error`.

The layout mirrors `prestashop-plugin`'s `tests/js/` (itself mirroring `magento-plugin`'s
`Test/Js/`): a `package.json` at the repo root whose only purpose is to hold JS
devDependencies, a jest config sitting next to the tests with `rootDir` pointed back at the
repo root, and `testEnvironment: "jsdom"`. `.distignore` excludes `package.json`,
`package-lock.json`, `node_modules/` and `tests/js/` from the released plugin zip.

Files glob — unlike `tests/unit/run.php`, a new `*.test.js` needs no registration.

`make test-js` is deliberately not wired into `make test`, mirroring `prestashop-plugin`:
`make test` runs the PHP suite in a php container and needs no Node on the host.

## How the browser gets stood up

`assets/js/twoinc.js` is a plain classic script. It declares a few top-level helper objects
and a `Twoinc` class, and `tillit-payment-gateway.php` enqueues it into a checkout page
where jQuery, the company-search panel script and WooCommerce's `wc_country_select_params` /
`window.twoinc` `wp_localize_script` output are already globals. There is nothing to
`require()` and nothing to import.

So `wc-harness.js` assembles the real environment rather than mocking it:

- jsdom (Jest's `testEnvironment`) supplies `window` and `document`;
- the **real** jQuery is installed onto that window as a devDependency;
- the **real** `assets/js/company-search-panel.js` is evaluated onto it too, exactly as its
  own `<script>` tag does, so the assertions run against the shipped popover;
- `wc_country_select_params` and `window.twoinc` are small stubs — they are
  `wp_localize_script` output with no npm distribution;
- the plugin source is then evaluated in global scope, exactly as a `<script>` tag would.

**No production code was refactored to make this testable.** The script loads as-is.

`company-search-panel.js` is vendored byte-identical from the Magento plugin and is never
edited here — see `AGENTS.md`. Installing it rather than a stand-in is what lets a
structural assertion mean anything: the DOM the tests read is the DOM the panel builds.

WooCommerce core's own `#billing_country` select2 is untouched by the plugin and is real in
these fixtures. Nothing in the company-capture control is a select2 widget.

### Reaching the code under test

twoinc.js declares its helpers with `let` and never assigns them to `window`. In a browser
those become global _lexical_ bindings: reachable as free variables from a later `<script>`,
absent from `window`. Global `eval` reproduces that exactly, so the harness appends an
expression naming the bindings and evaluates it in the same scope — the same access pattern
a second `<script>` tag gets. Nothing is exported for the tests' benefit.

The source is loaded with `window.twoinc` **absent**, then the stub is installed. The file's
trailing `jQuery(function () { if (window.twoinc) { ... } })` bootstrap wires the entire
checkout — payment-method listeners, order-intent init, a 1s `setTimeout` — and jsdom's
document is already "ready", so jQuery would run all of it immediately. These tests are
about the company-search helper, so the bootstrap is left to no-op.

## What is covered

`company-search-panel-structure.test.js` — the control's DOM shape, pinned against
PrestaShop's (TWO-25503):

- the panel is a child of the field's own wrapper (`span.two-company-field-wrap`), never a
  layer appended to `<body>`. That nesting is the requirement: the browser's native tab
  order satisfies the keyboard contract with no key handling at all, so a control that
  reproduced the behaviour some other way would still be the wrong one.
- exactly three direct children, in order: `.two-company-dropdown__search` (holding
  `input.two-company-dropdown__query` and `span.two-company-dropdown__spinner`),
  `.two-company-dropdown__results`, `.two-company-mode-chips`.
- the `hidden` attribute is the outer visibility switch, and re-attaching adopts the panel
  already there rather than building a second.
- every chip is inside the panel, in `registered` / `sole_trader` / `manual` order, none
  beside it.

`company-search-transport.test.js` — `searchApi()` and `searchCompanies()`:

- **a timeout is not a cancellation.** `timeout`, `error` and `parsererror` resolve as
  `{unavailable: true}`; `abort` resolves as `{aborted: true}` and paints nothing. The
  premise is asserted rather than assumed: both carry `status 0`, so the outcome has to come
  from `textStatus`.
- no failure path resolves as a result set — an empty list reads to the buyer as "my company
  is not registered".
- request envelope: the 30s client timeout reaches `jQuery.ajax`, the configured host and
  `/companies/v2/company` path, `limit`/`offset` taken from the helper's own bound, the term
  encoded exactly once, `client`/`client_v` alongside the search params, and the country read
  per request rather than captured when the panel was built.
- `degraded === true` resolves as unavailable with no items; a null body neither throws nor
  yields results.
- the supersession guard on failure, success and degraded-success alike, each with a
  mirror-image assertion that the current request still does the work, plus that the
  sequence advances once per dispatched search.
- `abortActiveRequest(token)` cancels only the live bind's request, refuses a foreign token,
  and is inert once the request has settled.
- the six-member contract: `searchApi()`'s keys equal the panel's own
  `SEARCH_API_CONTRACT`, the thresholds are the helper's constants rather than literals, and
  the no-matches message borrows WooCommerce core's copy.
- unavailable copy: the built-in fallback and the localised override.
- **driven through the real panel**, not the transport alone: typing dispatches one request,
  the spinner is up during the debounce before any request goes out, a below-threshold term
  dispatches nothing, a timeout raises the unavailable message styled apart from the other
  two, an empty result set says no matches rather than "down", the next keystroke cancels the
  request on the wire, a superseded response cannot paint over a newer search, and closing
  the panel drops both the request and the spinner.
- spinner shape (TWO-25288): one childless `aria-hidden` node inside the search row beside
  the query field, one node however many searches run.
- spinner paint (TWO-25288): the real stylesheet is injected with `injectStylesheet()` and
  the computed `background-image` read back, so the rule is proven to point at the asset;
  paired with an on-disk existence check, because a correct URL aimed at a missing file would
  satisfy the computed style on its own. The existence check resolves the URL against the
  stylesheet's own directory rather than a path written into the test. The file is then
  checked to be a 16x16 `GIF89a` with more than one frame — a still image would be a spinner
  that never spins, and jsdom evaluates no animation. The frame count comes from
  `countGifFrames()`, which walks the GIF block structure; counting raw `0x2C` bytes does not
  work, because that value also occurs inside the colour table and the compressed pixel data.

`company-search-results.test.js` — row shaping and the two pre-search hints:

- a well-formed hit maps to every field the panel and the selection handler read, in order.
- `response.items` is not assumed to be an array: an absent, null, string, number or array
  body, and `items` as null/object/string/number, each yield no results and do not throw.
- a hit whose `national_identifier` is absent, null, or carries a null/empty `id` renders as
  the company name alone with an empty `company_id`, and does not cost the buyer the other
  hits in the same response.
- the endpoint's `highlight` markup renders as markup in the row, while the field takes the
  plain name; picking a row writes `#billing_company_display`, `#billing_company` and
  `#company_id`.
- the min-chars hint is the query field's own watermark and states a fixed number — core's
  copy counts down the remaining characters, so the same field would say "1 or more" after
  two keystrokes. A below-threshold term is answered inside the panel, not under the field,
  and the watermark survives a close/reopen.
- the empty-field hint is what the closed company field renders, is localised when PHP
  supplies a string, and is not the buyer's company name: not snapshotted, not restored into
  the field, not reported by `getCompanyName()`/`getCompanyData()`, not posted, and gone once
  a real company is picked.
- the pay-for-order template renders a field the panel can anchor to.

`company-search-manual-entry.test.js` — the mode chips and the manual-entry route (TWO-25288,
TWO-40, TWO-25503):

- the chips are built by the bind itself and live in the panel's own chip group, outside the
  results host — so they are present the moment the panel opens, stay put below the search
  threshold, survive a capture, and are not churned by repeated keystrokes on the same term.
  Each is a real `<button>`, not a styled row, and labels come from the localised text map.
- the chip set follows the address-area company-search setting.
- visibility comes from the panel alone: closing hides the whole control at once, reopening
  shows the same group, and the selected modifier is cosmetic — never what makes a chip
  present. A closed panel carries `hidden`, which takes its whole subtree out of the tab
  order.
- one panel per field: a field replaced while the panel is open leaves no stale panel, a
  re-attach adopts what is in the wrapper, and syncing chips never reaches a chip group
  outside this panel.
- mouse-button semantics: a plain click activates, a right-click `mouseup` does not.
- activation enters manual entry, closes the panel and hands the field back rather than
  leaving it live behind manual entry; the way back out is built hidden, is localised,
  keyboard-reachable, activatable detached from the document, and hidden again on the way
  out. Repeating an activation in one tick leaves one switch.
- entering manual entry clears the real company field, the display field and the disowned
  company's registry address; leaving it clears the hand-typed name and org number. Reaching
  manual entry without ever picking a company leaves the address alone.
- placement CSS: `#search_company_btn` is appended into `.woocommerce-input-wrapper` rather
  than the field row, sits in normal flow below the input, declares its own gap, keeps
  `width: 100%` paired with `box-sizing: border-box`, and self-heals a missing wrapper. Its
  focus ring is a dotted border reserved up front and coloured `!important` on focus, so
  focus is visible without reflowing the row.
- handlers bind once, not once per open: one control after five open/close/re-attach cycles,
  one request per keystroke, and the panel exists before the buyer has typed.
- focus is not dropped on either mode switch, and `focusVisibleCompanyField` reports failure
  rather than claiming success for an absent or disabled field.
- a re-created control heals itself — the chip survives `clearSelectedCompany()`, which also
  resets the registry-address flag.
- the sole-trader round trip does not strand a buyer in manual entry; adopting a sole trader
  with the panel open closes it but leaves it bound; and a deferred manual-entry activation
  landing after an async sole-trader switch does not stomp it.
- **returning to search opens the panel and takes the caret**, so the way back costs one
  gesture rather than two: the panel is open, the caret is in its query field, and the buyer
  can type straight away. Opening an already-open panel is a no-op, and both "no panel bound"
  and "no company field at all" report failure rather than lying.
- the affordance needs no template markup on the page, which is what makes it work on the
  pay-for-order surface.

`company-search-focus-trap.test.js` — the buyer's own navigation wins, satisfied
structurally:

- the control is one contiguous run in reading order — field, query, results, chips — with
  nothing outside the field's wrapper, so Tab needs no handling. A Tab keydown is left
  undefaulted and does not close the panel.
- tabbing away from an open panel keeps focus where the buyer put it, through 5s of timers,
  and a results re-render does not pull it back (with a positive control that rows actually
  rendered).
- Escape closes the panel and hands focus back to the field, and the field's own focus opener
  does not reopen what Escape just closed.

`company-search-container-orphan.test.js` — exactly one panel, anchored to the field the
buyer can see (TWO-25469):

- a fragment replace takes the panel with the field, because it is inside it; the re-attach
  afterwards leaves one panel and one wrapper, closed until opened.
- `clearSelectedCompany()`, the other re-attach site, sweeps the same way.
- re-attaching to the field the panel is already on adopts it rather than rebuilding, which
  would drop the buyer's open panel on every `updated_checkout`.
- moving the mount to the payment tile retires the address-form wrapper — two wrappers would
  be two anchors, and the sole-trader note would render against the one the buyer left.

`company-search-tile-location.test.js` — the `company_search_location` setting (TWO-25326
§7.1). Under `payment_tile` the tile shows exactly one company-name field, `#billing_company`
and `#company_id` stay in the address form, the slot is hidden in manual entry, the tile field
is a live bound panel after the real bootstrap, and the read-only summary renders beside it.
Under `address_area` the tile stays hidden and empty. With no gateway on the page the sync is
a no-op rather than a throw.

`company-search-tile-fragment-replace.test.js` — WooCommerce replaces the whole `#payment`
fragment on every payment-method, coupon, shipping or quantity change (TWO-25503):

- the tile's row is **rebuilt from state**, never dragged in and out, so a replace costs
  nothing: after one the rebuilt `#twoinc_tile_company_name` holds the captured name, there is
  exactly one of it, and the panel is bound to the new node rather than the discarded one.
- the tile field carries no `name`, so `#billing_company` is what the order posts.
- switching away from Two and back leaves the field on screen holding its value — the
  two-click path that reproduced an empty tile deterministically.

`company-name-never-neither.test.js` — Doug's "never neither" invariant (TWO-25503). A
company-name surface is visible in all twelve cells of {address_area, payment_tile} ×
{capture, no capture} × {Two selected, other method, none selected}. A buyer with nowhere to
see or enter the company name has reached staging twice. The narrowing half is pinned too:
with a capture and Two selected under tile placement, the address area shows neither row and
the tile is the surface, while `#billing_company`/`#company_id` still serialise.

`company-search-payment-method-agnostic.test.js` — the search-vs-plain decision is the
buyer's capture mode alone (#486). Pinned with no payment-method radio checked at all, which
is the same effective state as Two being unavailable: a buyer mid-search is not knocked into
the plain field when Two stops being selectable.

`company-search-payment-method-switch.test.js` — the control is already in the payment tile
before any switch, and switching TO Two reveals the Two-only fields.

`company-search-deferred-init.test.js` — `initialize()`'s deferred pass: it stores its panel
on the **instance**, binds a panel where the first pass found no host, renders no second panel
on the ordinary path, leaves the field's handlers bound exactly once, and early-returns
outside search capture mode.

Two traps when adding to it. Most of what the retry does is **idempotent** — re-attaching to
a field that already has a panel leaves the DOM as it was — so an end-state assertion passes
whether the timer fired or not, and deleting the `setTimeout` outright leaves it green. Give
any such test a witness that the deferred pass actually ran. And make that witness invariant
to how the call is bound: spying the INSTANCE after `initialize()` returns works against a
wrapper and fails against `.bind(this)`, which resolves the method when the timer is
_scheduled_ — an equally correct shape. Spy `Twoinc.prototype.enableCompanySearch` BEFORE
`initialize()` instead; the cost is that the synchronous pass is counted too, so assert 1
call before advancing and 2 after.

`company-summary.test.js` — the read-only captured-company summary (TWO-25288):

- the two halves render in two different places (TWO-25326 §7). The address area gets the
  organisation **number** only, as a right-aligned block under the company-name field; the
  **name** renders in the payment tile as `<name> (<number>)`. Both are asserted for all three
  capture modes, and the address-area block is asserted to contain no company name at all.
- no number means no label, not an empty one, and the tile drops the parenthesised half
  rather than rendering `Name ()`. A whitespace-only name is not rendered as a company.
- the summary self-heals its position after WooCommerce core's own field resort, and does not
  physically move the node when it is already correctly positioned.
- layout: the box carries core's own form-row padding so the id lines up with the input's
  real edge, the id carries no same-line margin, neither half can overflow on a single
  unbroken token, and on `.custom-checkout` (pay-for-order) the alignment is overridden back
  to the leading edge — asserted through the cascade, not by finding the rule in source.
- the display is genuinely read-only: no `input`, `select`, `textarea` or `contenteditable`,
  nothing tabbable, and no control that would let the buyer delete a captured company.
- submission is unaffected. `#billing_company` and `#company_id` still carry what WooCommerce
  serialises, re-rendering does not disturb them, and nothing inside the summary carries a
  `name` — asserted against the form's real `serialize()`.
- manual entry is name-only: `#company_id_field` is hidden, and stays hidden after a round
  trip through sole-trader mode.
- visibility: absent until something is captured, shown regardless of the selected payment
  method (the label is the only surface the captured number reaches the buyer through), and
  cleared by `clearSelectedCompany()`.
- **a company that is no longer captured stays off screen**: the sole-trader round trip does
  not resurrect the picked company, and what is displayed is what `#billing_company` holds.
- the user-meta restore path, which passes both values explicitly because
  `loadUserMetaInputs` writes `#company_id` _after_ it renders.
- the intent-message boxes carry the captured company (TWO-25326 §7.2/§7.3): approved and
  declined boxes each on their own template, the phone-number box never substituted,
  re-substituted from live inputs on every toggle rather than a stale snapshot, a bare name
  where there is no organisation number, and the served no-company sentences as the fallback.

`company-name-and-number-surfaces.test.js` — the two surfaces the buyer sees (#486):

- **the company NAME is always on screen, as exactly one of two elements** — the search
  control or WooCommerce's native `#billing_company` — across the full three-modes ×
  supported/unsupported-country matrix and independently of the selected payment method. The
  documented exception is `payment_tile` placement, where the two are not competing for the
  same position, and it has a test of its own.
- **the company NUMBER is a read-only label, never a field.** Its two conditions (`search`
  mode, and a number that is not internally minted) are tabled with `shown` and `text` as
  separate columns, because two independent mechanisms produce them: the capture mode gates
  display, and `formatCompanyNumber()` gates whether a `TWO:…` value reaches the DOM as text
  at all. It mirrors `#company_id` on a value written _after_ the fields were toggled — the
  real ordering — sits immediately below whichever name element is visible, follows the name
  into the payment tile, and comes back to the address area when the tile collapses.
- **`#company_id` is still a real, named, undisabled input in every mode**, carrying its value
  into the POST, with no required cue on a field nobody can fill in.

`company-capture-mode-composition.test.js` — the states only a **sequence** of capture-mode
changes reaches. Every single transition is covered by a file above; what is not is the pair
of invariants that two separately-correct changes disagree about (#486):

- **the visible company-name surface must be one that can actually render a name.** A sole
  trader adopted while the buyer sits in manual entry is rendered through a LIVE panel, is put
  where `toggleBusinessFields()` has just pointed the buyer, and reads back through
  `getCompanyName()`/`getCompanyData()` — an empty `company_name` is what stops an order
  intent firing at all. The counterweights are pinned too: an email change alone never adopts
  over a hand-typed name, and abandoning the adoption lands the buyer back in manual entry.
- **the slot directly after the visible company-name field has one occupant.** It goes to the
  number label in registered-search mode; in sole-trader mode the "select a different sole
  trader" link sits inside the field's own input wrapper instead, the same slot the "search
  for company" link uses, so neither depends on a `+`-selector margin correction. The link is
  handed to the native field's own slot when that is the visible one.
- **a capture restored from the DOM alone reaches the panel**, with no user-meta echo behind
  it — a returning guest otherwise saw a placeholder over a hidden field holding their own
  company. Pinned for a sole trader and a registry company alike, plus the guard that an
  earlier restore pass's selection is never overwritten.
- every path that can create a capture reaches the visibility rule.

`country-switch.test.js` — what a billing-country change does, and what a fake one must not
(TWO-24867, with TWO-25326 and TWO-25333):

- **a `change` event that is not a country change is inert.** WooCommerce re-renders the
  billing fields on `updated_checkout`, and core's `address-i18n.js` re-triggers the country
  field on `country_to_state_changing` at init — both reach the delegated handler as a bare
  `change` with the value unchanged. The guard compares against the last country acted on, so
  the captured company survives one such event and a run of them, nothing in flight is
  invalidated, and the field-visibility pass still runs.
- **a real change still clears everything**, records the new country for the next comparison,
  invalidates an in-flight search, and leaves the new `country_prefix` on `customerCompany` —
  set _after_ `clearSelectedCompany()`, which resets that object wholesale and only re-reads
  it from the DOM three seconds later.
- **the tracker cannot drift from the field**, which is the failure mode the guard buys and
  therefore the one this suite spends most of its assertions on. `initialize()` seeds it, and
  the seed is what makes a genuine FIRST change act rather than be adopted; the seed is taken
  _after_ `loadStorageInputs()`, which writes the country with `selectElem.value` and fires no
  `change`; the first country the page ever sees is adopted, not acted on; an empty reading —
  WooCommerce replacing `#billing_country` wholesale mid-re-render — is neither acted on _nor
  recorded_; `updated_checkout` **records** a country that moved with no `change` event, and
  records without clearing a capture the same re-render is consistent with; and the recording
  path cannot loop, even though a change reaching `setAddress()` triggers `update_checkout`.
- **a capture stranded in the wrong country is dropped** (TWO-25333), which is the one case
  record-only got wrong: a company captured under the country just left stayed captured, still
  approved, and was paired with the new billing country in the order payload — the buyer saw a
  green payment method and an opaque order-creation failure. `updated_checkout` clears the
  capture when the recorded country and the captured company's own `country_prefix` actually
  **disagree**, and only then. Pinned in both directions, on **both** `enable_address_lookup`
  settings and in **both** the `search` and `manual` capture modes — the manual leg differs,
  because `clearSelectedCompany` deliberately keeps the buyer's typed `#billing_company` while
  still blanking `#company_id`.
- three readings are deliberately not grounds to clear, each with its own test: a company name
  with no organisation number (not a capture), an unknown country on either side
  (`country_prefix` is null until the first capture, and an empty field reading means
  mid-replacement), and the DOM already holding a **different** company from the one recorded
  — which means the record is stale rather than the fields, so it is re-synced from them
  instead of destroying a company the re-render had just restored. That last one needs **both**
  mirrors to have moved and both to be non-empty: a diverged number alone is a buyer typing
  into `#company_id` without blurring, a diverged name alone is its mirror, and a diverged
  number with an empty `#billing_company` is trusted by neither available fallback — the
  record's name would pair company A's name with company B's number, and an empty name would
  leave `isReadyApprovalCheck()` refusing forever, since this branch arms no deferred re-read.
  All three fall through to the clear, deliberately fail-closed: a clear is recoverable, a
  permanently unusable payment method is not.
- every comparison goes through `blankToEmpty`, because `organization_number` is seeded null
  and written from parsed JSON by the sole-trader prefill while `.val()` is always a string, so
  `123456789 !== "123456789"` would turn a type mismatch into either a laundered pair or a
  destructive clear. All four compared values have their own normalisation test — type and
  whitespace, in both directions. The comparison is also case-insensitive, because
  `currentCountry()` upper-cases and `getCompanyData()` reads the field raw.
- the re-sync reads `#billing_company`, `#company_id` and the country within one tick rather
  than calling `getCompanyData()`: in company-search mode that takes the name from the
  `checkoutInputs` **sessionStorage** snapshot rather than the DOM, so it would rebuild a
  two-moment pair. What it stores is what `getApproval()` posts inside `buyer.company`, so the
  trimmed values are pinned — padding there would reach the order intent verbatim.
- **what the approval-gate test does and does not prove.** `isReadyApprovalCheck()` coming
  back down stops a fresh intent being sought for the dropped pair, and that is what is
  asserted. It is _not_ the same as the payment method becoming unselectable: nothing in the
  file deselects the gateway radio and `isTwoincApproved` is written but never read, so a buyer
  already approved keeps a selected Two method over an emptied company until the next intent
  pass. Enforcing TWO-25326 §6 by deselecting is not in this suite.
- **the capture country is pinned when the company is captured** (TWO-25333), at all three
  capture sites: the panel's select handler, a manually typed organisation number, and the
  sole-trader setter — which does _not_ re-pin on the clearing call `setMode("business")` makes
  with both arguments falsy. Without this the pair is assembled from two different moments, so
  a country that moved with no `change` event before the capture leaves the old country next to
  a company from the new one. The manual-entry pin fires only when the blur actually **moved**
  the number: that handler is bound to `blur`, not `change`, so tabbing through an untouched
  `#company_id` would otherwise launder a stale pair into a consistent-looking one the
  discriminator could never fire on again. Pinned in both directions with a positive control in
  the same fixture, plus the normalisation cases that reopen the laundering by another route.
- **the search country is read live**, so a panel that outlived a country change queries the
  country the form currently holds.
- **the registry address lookup is guarded twice**: by sequence (a newer lookup wins) and by
  the country snapshot taken when the request was issued. Both are needed and both are pinned
  separately — a country written programmatically fires no `change`, so nothing bumps the
  sequence, and a country switched away and back leaves the sequence stale but the country
  matching. An empty reading on _either_ side is deliberately NOT a mismatch: a lookup issued
  during a replacement snapshots `""`, which compared against a known country would discard
  every response. The happy path is pinned too, so the guard cannot be tightened into a no-op.

The both-mirrors rule holds on WooCommerce's own re-render paths for a concrete reason worth
knowing: `#company_id` is a registered billing field (`$fields['billing']['company_id']` in
`WC_Twoinc_Checkout`), so it sits in the same billing fragment as `#billing_company` and every
WC-driven re-render writes both from the same vintage. One mirror moving alone is therefore
evidence of something that is not a re-render.

A **known residual gap** is recorded in the code rather than fixed here: `customerCompany` is
populated from the DOM on a timer, so `#company_id` can hold a real capture while that object
still holds nulls — during `initialize()`'s deferred seed, and for three seconds after
`clearSelectedCompany`. A silent country move inside one of those windows is missed, and the
deferred re-read then re-pairs the old country's company with the new country via
`getCompanyData()`, which reads `#billing_country` live and so un-pins the witness. Closing it
means stopping the DOM re-reads from overwriting a pinned `country_prefix`, which changes
`getCompanyData()`'s contract for its other callers, so it wants its own ticket.

`intent-loading-state.test.js` — when the order-intent loader appears and when a previous
verdict disappears (TWO-25326):

- **the loading state is tied to the REQUEST, not to arming a check.** It is the single most
  load-bearing thing in this suite: "the loader is up exactly while a request is outstanding"
  holds by construction. `getApproval()` only CLEARS the previous verdict; the visible cost is
  a gap between the clear and the spinner, pinned rather than left implicit so nobody "fixes"
  it back.
- **`clearIntentVerdicts()` vs the blanket hide.** Verdict boxes only, loader untouched — used
  by `getApproval()` and by `updateElements()`, which runs on every `updated_checkout` (a
  shipping-method change, a coupon). It says "every pay-box except the loader" rather than
  naming three verdict classes, so a fourth box from a brand overlay is covered without editing
  it; both halves are pinned.
- **one request at a time.** Arming a new check retires the previous one — abort included, so
  the connection is not held for an answer nobody reads. Superseding happens on four paths and
  each is pinned: a newer check, a cache hit, a country change, and a form that goes incomplete
  mid-request. **Supersede FIRST, then abort**: jQuery runs `.fail` synchronously for an abort
  and that handler deselects the gateway and paints a decline, so the counter has to move
  first. Both orderings are pinned.
- **`#place_order` and `checkout_error` are not the same event.** Place Order leaves the check
  disarmed (the buyer is leaving); `checkout_error` re-arms, because it does NOT fire
  `updated_checkout`, so nothing else would run another check while the buyer corrects a field.
  Neither fires unconditionally: a click that never submits and an error from another gateway
  must not wipe a good verdict.
- **a BLANK company snapshot prints the generic sentence**, and deliberately does not fall back
  to a live read. `readCapturedCompany()` reads the inputs, which WooCommerce empties for an
  instant while replacing the billing fields, so a request issued in that window snapshots `""`
  — and by paint time the buyer may have moved to another company.
- **the verdict names the company the request was ABOUT** (TWO-25326 §7.3). Snapshotted at
  request time, not re-read at paint time: supersession only begins when the next request is
  issued, up to a second after the buyer changes company. The live read stays as the fallback
  for callers that are re-rendering rather than reporting, and both directions of the
  wrong-company defect are pinned — an APPROVAL naming the wrong company is the more damaging
  one.
- **both company-field change handlers** — `#billing_company` (the manual-entry path a buyer
  types into) and the panel's own — clear verdicts rather than blanket-hiding.
- **the cache window's boundaries, exactly.** 400, 422 and 499 must be cached; 500 and 503 must
  not; the retryable 4xx codes (401, 403, 408, 429) are not cached, one test per code, because a
  cached answer is permanent for the page. A transport failure (`status` 0 or 5xx) is not a
  verdict and is not cached — one dropped connection would decline that cart permanently. An
  approved verdict is deliberately NOT cached, and the tracking id reaches the order field.
- **two different request bodies of the SAME LENGTH get different cache keys**, and two
  overlapping checks file their verdicts under their own bodies rather than one shared slot.
- **a paint cannot outlive the check that produced it**: the pre-arm paint cancel, the
  `paintSeq` guard, and a settled response releasing `inFlightSeq` are each pinned.
- **supersession, the same idiom `addressLookupSeq` already uses.** The interval is disarmed
  _before_ the request goes out, so two checks can overlap and arrive in either order.
  `seq`/`inFlightSeq` closes the older-response-wins case, the paint-after-Place-Order case,
  and the window in which every "is a check running" flag read falsy. The request is left to
  complete rather than aborted — an abort runs `.fail`, which deselects and declines.
- **every way a check can end takes the loading state down with it**: `#place_order` and
  `checkout_error` through the REAL delegated handlers via `initialize()`, a cart total that
  never becomes readable, and a required field emptied before the tick. A cached verdict
  disarms the check too — leaving it armed had the 3s poller re-entering `getApproval()`
  forever.
- **the request is bounded.** `timeout: 30000`, matching the company-search transport: a
  request that never settles calls neither handler, and both the loader coming down and the
  verdict appearing hang off them.
- **which jQuery callback a response came from is passed, never sniffed.** jQuery hands `.done`
  the parsed response _body_, so a field called `status` in a good 200 was read as an HTTP
  status. Both halves pinned: a body-level `status` must not route and must not block caching.
- two response paths that would throw before rendering anything, both stranding the loader: a
  `status >= 400` with no `responseJSON`, and the phone-number box route. Both driven by
  handing `processOrderIntentResponse()` a synthetic jqXHR, since `stubAjax()`'s `fail()` models
  a jQuery timeout and reports `status: 0`. A 200 whose body parses to `null` is covered too.
- **a verdict is announced, not silently swapped in.** `role="status"`/`role="alert"` only
  announce a content change made while the region is in the accessibility tree, and
  `togglePaySubtitleDesc()` starts by hiding every box — so a `MutationObserver` pins the order:
  the reveal precedes the text, both in one task. A duplicated verdict box is written
  element-wise (`.text()` on a set concatenates; `.first()` skips the second), and a repeated
  verdict is not re-announced, both ways.
- **`clearSelectedCompany()`'s 3s deferred re-read is guarded** by the company-search counter —
  three seconds is long enough to pick a company. Both sides pinned.
- `updateElements()`'s ordering is its own assertion: it runs a blanket reset and arms a check,
  and the reset must not wipe the loader the check just showed.
- the feature's own switch (`enable_order_intent: "no"`), and a company complete except for its
  name (the `isAnyElementEmpty` arm of `isReadyApprovalCheck`).
- the stylesheet is asserted through jsdom's real cascade (`injectStylesheet()` +
  `getComputedStyle`) rather than by grepping the CSS source, which three mutations defeat:
  commenting a declaration out, a later overriding rule, and an at-rule wrap. See Known gaps
  for what jsdom cannot resolve.

`wc-harness.test.js` — the harness's own abort bookkeeping. `stubAjax()`'s `settled` guard,
behind `record.abortedWhilePending`, is unreachable from the suites that depend on it (no
production path aborts an already-settled request), so it is pinned directly: aborting a
PENDING request sets both flags and fails the deferred; aborting a SETTLED or already-failed
one sets only `aborted` and does not re-reject.

`record.aborted` flips even when `abort()` lands on an already-settled deferred, where a real
jqXHR does nothing — so it proves the call was MADE, not that a live request was cancelled.
Assert `record.abortedWhilePending` for that; `aborted` is what pins that a settled request is
NOT aborted.

### Verified by mutation

Every assertion here was checked by breaking the line it pins and watching it fail — that is
the standard for adding to this suite, not an audit that was run once. Mutation is what finds
the gaps reading does not.

Known **equivalent** mutations, each with its reason written into the code beside it, that
survive without being gaps:

- `capturedCountry` left un-normalised — country values are unpadded upper-case ISO strings on
  both sides. The `.toUpperCase()` that _does_ matter, because two readers disagree about it,
  is tested.
- `country_prefix: country` swapped for a fresh `currentCountry()` read — indistinguishable
  today; written as the argument so the pairing is provably against the value the change was
  detected on.
- `domName || recordedName` in the re-sync — dead, because the condition guarantees a non-empty
  name, and actively wrong if it were reachable.
- `!country` in the early guard — unreachable from the only caller, because `countryDidChange`
  already refuses an empty reading. Kept as the guard a second caller would need.
- `this.customerCompany || {}` — the property is an object from construction onward, and
  `clearSelectedCompany` sets `{}` rather than null.
- the manual blur handler storing the raw field value — normalising on the way in would change
  the organisation number the plugin posts on the order intent.
- narrowing `!gross_amount` to `=== undefined` — `getPrice()` cannot return 0, because
  `getPriceRecursively()` gates recursion on `if (val)` and discards a `"0.00"` text node as
  falsy. What that leaves is a real behaviour, pinned and flagged for its own ticket: a
  fully-discounted order can never obtain a verdict.
- writing a border colour as an equivalent `rgb()` notation, and rewriting a catalogue with
  CRLF line endings — both confirmed NOT to fail, because the assertions normalise.

## Known gaps

Deliberately out of scope for this suite, which covers the company-capture control and the
order-intent path rather than every behaviour in the file. Mutating any of the following leaves
the suite green:

- the page bootstrap's remaining wiring: the surcharge fee recalculation trigger, saved-input
  replay;
- the fetch half of `twoincTermChips` — `refresh()`'s fee POST and its done/fail branches.
  `render()` itself IS covered, by `term-chips.test.js`: the singular/plural chip labelling and
  heading placement, and the currency-symbol fee label;
- the registry address autofill beyond its supersession guards;
- `twoincDomHelper`'s field moving/reverting and validation cues.

The spinner's paint is partly covered: `injectStylesheet()` puts the real stylesheet in the
document and jsdom's cascade resolves enough of it to prove the rule points at the loading GIF.
What jsdom cannot tell you is whether the result is _visible_ — box geometry, stacking, and
whether the image animates are all beyond it, and the multi-value `background-position`
shorthand does not resolve at all (it reads back empty however the rule is written, so do not
assert on it). The asset's own bytes are checked instead — dimensions and frame count — which
pins that the file could animate, not that the browser animates it.

**jsdom does not honour `!important` from an earlier rule.** It resolves the intent loader —
`.twoinc-pay-box.twoinc-loader.hidden`, with `.hidden { display: none !important }` at the top
of the stylesheet and `.twoinc-loader { display: flex }` below it — as `display: flex`, while
correctly resolving a sibling box with no `display` declaration to `none`. It DOES honour a
later overriding rule, which is what makes the cascade assertions worth having, so this is a
narrow gap rather than a reason to distrust them. Two consequences, both live in the code
today: the loader carries its own two-class hiding rule so its correctness does not rest on
that `!important` at all, and layout is asserted with `hidden` taken off the node.

Treat a change to the spinner's appearance as needing a real browser. This gap has bitten: an
attempt on TWO-25288 drew the figure in CSS and shipped for one commit rendering completely
motionless with the whole suite green — nothing in jsdom evaluates an animation, and asserting
an animation's _name_ would have passed too. An animated image asset is what makes the paint
assertable at all, but "assertable" stops at the URL.

## Adding tests

Prefer driving behaviour through the real panel — open it with `openCompanyPanel()`, type into
`.two-company-dropdown__query`, assert on `resultsText()` or `panelStructure()` — over spying on
the helpers, and settle requests explicitly through `stubAjax()`. Out-of-order responses, aborts
and timeouts are the subject matter here, so controlling the timing is the point rather than a
shortcut.

Two mechanics the panel imposes:

- it binds with `addEventListener`, which jQuery's `.trigger()` does not reach — dispatch a real
  `Event` on the query field instead;
- the transport is promise-based, so settling a deferred is not enough. Advance the debounce
  (`helper.companySearchDebounceMs`) to dispatch, then flush a microtask turn or two after
  settling before asserting on what the panel painted.

Call `releasePanel(helper)` from `afterEach` BEFORE clearing the DOM: the panel binds a
document-level mousedown that wiping `document.body.innerHTML` does not unbind.

Before trusting a new test, break the line it is supposed to pin and watch it fail.
