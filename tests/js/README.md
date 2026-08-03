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
where jQuery, WooCommerce's selectWoo widget and WooCommerce's `wc_country_select_params` /
`window.twoinc` `wp_localize_script` output are already globals. There is nothing to
`require()` and nothing to import.

So `wc-harness.js` assembles the real environment rather than mocking it:

- jsdom (Jest's `testEnvironment`) supplies `window` and `document`;
- the **real** jQuery and the **real** selectWoo widget are installed onto that window as
  devDependencies;
- `wc_country_select_params` and `window.twoinc` are small stubs — they are
  `wp_localize_script` output with no npm distribution;
- the plugin source is then evaluated in global scope, exactly as a `<script>` tag would.

**No production code was refactored to make this testable.** The script loads as-is.

Using the real widget instead of a mock is deliberate. The reason the plugin owns a custom
`ajax.transport` at all is a property _of_ select2's ajax adapter, not of our code: its
failure handler treats any jqXHR with `status 0` as a cancellation, and a jQuery `timeout`
also reports `status 0`, so with the default transport a timeout rendered as "no companies
found" — a wrong answer rather than a missing one. The "unavailable" message is likewise
delivered through the widget's own `results:message` channel and rendered by its results
adapter via the `language.errorLoading` hook. A hand-written mock would have to reproduce
both correctly to catch either bug, which is precisely the assumption that let them ship.

### selectWoo, and where it comes from

WooCommerce ships **selectWoo**, its own fork of select2, and the plugin calls
`.selectWoo(...)`. selectWoo is not published to npm under any name, so the devDependency is
a GitHub tarball pinned to a commit SHA — which npm records in `package-lock.json` with a
real integrity hash, unlike a `git+` dependency (npm rewrites those to `git+ssh://` and
skips the integrity check, which would break `npm ci` on a runner with no SSH key).

The cost of that choice: `npm ci` — and therefore the CI job — reaches
`codeload.github.com` as well as the npm registry. Both are pinned and integrity-checked, but
it is one more host the gate depends on.

That pin is selectWoo **1.0.11**, the tip of the fork's default branch; the repo publishes
no tag for it. WooCommerce core currently bundles 1.0.9. Nothing this suite touches differs
between the two — the plugin uses the standard ajax adapter (`transport`, `url`, `data`,
`delay`, `processResults`), the `results:message` channel and the `select2:*` events, all
unchanged across selectWoo 1.0.x. If a future test needs a behaviour that _is_
version-sensitive, pin the SHA to whatever WooCommerce bundles at that point instead.

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

`company-search-transport.test.js` — the custom `ajax.transport`:

- **a timeout is not a cancellation.** `timeout`, `error` and `parsererror` raise the
  unavailable message; `abort` stays silent, because select2 aborts the in-flight search on
  every keystroke and the widget is re-created on a country change. The premise is asserted
  rather than assumed: both a timeout and an abort carry `status 0`, which is all select2's
  own failure handler gets to look at.
- no failure path feeds an empty result set to select2 — an empty dropdown reads to the
  buyer as "my company is not registered".
- request envelope: the 30s client timeout actually reaches `jQuery.ajax` (it sits outside
  the checkout API's own retry window), select2's params pass through un-mutated, and the
  jqXHR is returned so select2 can abort it.
- `degraded === true` yields the synthesised empty result set _and_ the unavailable message;
  an **absent** `degraded` field reads as false, and so does every truthy non-`true` value
  (`"true"`, `1`, `{}`) — the field may not be deployed yet, so today's healthy responses
  must keep working.
- the `companySearchSeq` supersession guard on **all three** callbacks: a superseded failure
  does not paint over the newer request, a superseded success does not repopulate the list
  (the guard was originally on the failure path only, so a slow first response could
  overwrite a newer search's results), and a superseded `always` does not pull the spinner
  out from under the request that replaced it. Each has a mirror-image assertion proving the
  request that _is_ current still does the work.
- spinner lifecycle: raised per search, cleared on success and on every failure including
  the silent one, exactly one spinner node however many searches run in one open dropdown,
  removed rather than merely hidden once a search ends, and no throw when there is no open
  dropdown to hang it on.
- spinner shape (TWO-25288): a single childless element carrying the styling hook class and
  `aria-hidden="true"`, landing inside the widget's own search box. The stylesheet paints an
  animated loading GIF onto that one node as a background-image, so inner markup would be
  dead weight — the childlessness is pinned deliberately.
- spinner paint (TWO-25288): the real stylesheet is injected with `injectStylesheet()` and
  the computed `background-image` is read back, so the rule is proven to point at the asset;
  paired with an on-disk existence check, because a correct URL aimed at a missing file
  would satisfy the computed style on its own. The existence check resolves the URL the
  stylesheet declares against the stylesheet's own directory rather than a path written into
  the test, so repointing the rule at a directory that holds nothing fails here. The file it
  lands on is then checked to be a 16x16 `GIF89a` with more than one frame — a still image
  would be a spinner that never spins, and jsdom evaluates no animation. The frame count
  comes from `countGifFrames()`, which walks the GIF block structure; counting raw `0x2C`
  bytes across the file does not work, because that value also occurs inside the colour
  table and the compressed pixel data, so a single-frame file passes such a scan.
- message copy: the built-in fallback, the localised override, and that the widget renders
  ours rather than select2's own "The results could not be loaded."

`company-search-results.test.js` — `processResults` and the request envelope:

- a well-formed hit maps to every field selectWoo and the selection handler read
  (`id`/`text`/`html`/`company_id`/`lookup_id`/`approved`), in order.
- `response.items` is not assumed to be an array: an absent, null, string, number or array
  body, and `items` as null/object/string/number, each yield no results and do not throw.
  A throw here would not surface as an error message — it happens inside select2's query
  pipeline, leaving the dropdown stuck on "Searching…".
- a hit whose `national_identifier` is absent, null, or carries a null/empty `id` renders as
  the company name alone with an empty `company_id`, and does not cost the buyer the other
  hits in the same response.
- request url: the configured host and `/companies/v2/company` path, the country from the
  checkout form, `limit`/`offset` bounding and paging by that same bound, the term decoded
  exactly once, and `client`/`client_v` alongside the search params rather than replacing them.
- the country is read per request rather than captured when `genSelectWooParams()` runs
  (inverted by TWO-24867 — the widget outlives a country change on every path that does
  not go through `clearSelectedCompany()`).
- widget params: the 3-character minimum, the 300ms debounce shared with the other plugin
  checkouts, `escapeMarkup` passing the endpoint's highlight markup through while
  `templateSelection` uses plain text, and the non-error messages borrowing WooCommerce
  core's own copy.

`company-search-manual-entry.test.js` — the "my company is not on the list" row (TWO-25288):

- the row is the **last child of the results list**, not a sibling beside it, and carries
  everything the picker navigates by: `role="option"`, `data-selected="false"`, a stable id,
  the `--selectable` class, and a payload with an id sentinel and a `_resultId` matching the
  li. Reachability is asserted through the widget's own navigation — arrow twice and check
  which row ended up highlighted — rather than by inspecting markup and hoping.
- `data-selected="true"` is specifically pinned as wrong: the picker routes activation of an
  already-selected row to closing the dropdown, so the row would look reachable and do
  nothing. The mutation that flips it takes the activation tests down.
- visibility is capture state, **not** the search threshold (TWO-25326 §2, reversed from the
  original rule after Doug found the old one live). The button is in the dropdown from the
  moment it opens, before a single keystroke — the requirement is a route into manual entry
  that does not make the buyer type a doomed query first — it stays put when the term drops
  back under the threshold, and the only thing that removes it is a company actually being
  captured. Placement is asserted through the delegated `select2:open` handler with no input
  event anywhere near it, since an `input`-only binding is exactly what the old rule allowed.
- Tab **out** of the button is driven by hand, not by the browser (TWO-25326 §1/§4). The
  dropdown is attached to the end of `<body>`, so native Tab from the button walks off the end
  of the document — live, focus landed on `<body>` and the dropdown stayed open. The handler
  resolves the next tabbable control in FORM order first, then closes, then focuses it, then
  re-asserts that focus past selectWoo's own unconditional `$selection.focus()` 1ms after
  close. All four steps are pinned, and the target resolution has its own describe covering
  `hidden`-class wrappers, `tabindex="-1"`, hidden inputs, and manual-entry mode.
- activation prevents the selection: no `select2:select`, no company name, no company id. A
  normal company row still selects, which is what stops the interception from being a
  blanket one.
- the handler that shows the row is bound **once** across five opens and repeated re-binds,
  and exists before the dropdown's search field does. Both are regression pins: the previous
  implementation bound it inside a polling callback, per open, with no `.off()`.
- the row survives the picker emptying the list, and is not churned by its own observer —
  asserted as the same DOM node across many observer turns, since the sync runs from a
  MutationObserver on the list it appends to.
- the label follows the localised text map rather than an English literal.
- the affordance needs no template markup on the page, which is what makes it work on the
  pay-for-order surface; and a company field's wrapper follows the field's own visibility,
  which is what keeps manual entry usable there.
- **real DOM focus follows the highlight.** The picker `.focus()`es the highlighted row on
  every arrow keypress and its own source says that is required for screen readers, so the
  row needs `tabindex="-1"` to be able to take focus at all. Asserted via `document.activeElement`
  after driving the picker's own navigation and focus routine — not by inspecting the attribute
  alone, which would not notice the focus call being a no-op.
- the row's attributes are compared against **an option the widget itself builds**, rather than
  against a hand-written list. If the library adds a navigation-relevant attribute, that test
  fails instead of the row quietly falling out of the navigable set.
- **the row survives a widget re-creation** — clearing the selected company builds a new picker
  and a new results list, and nothing in that path knows this affordance exists. Also that at
  most one render watcher is live, keyed on the node it observes: the widget constructs a
  MutationObserver of its own, so counting constructions without checking the target counts the
  library's too and fails for an unrelated reason.
- focus is not dropped on either mode switch, and `focusVisibleCompanyField` reports failure
  rather than claiming success when the field is absent.
- **returning to search opens the dropdown and takes the caret**, so the way back costs one
  gesture rather than two. Asserted on the picker's own rendered state — the open class on its
  container and `document.activeElement` being the dropdown's search field — then proved end to
  end by typing into whatever holds focus and watching the manual-entry row reappear. Both halves
  are pinned independently: dropping the call leaves the dropdown closed, and dropping only the
  explicit focus leaves it open with the caret nowhere, because the picker's own focus does not
  land synchronously.
- the sole-trader round trip does not strand a buyer in manual entry.

`company-summary.test.js` — the read-only captured-company summary (TWO-25288):

- the two halves render in two different places (TWO-25326 §7). The address area gets the
  organisation **number** only, as a right-aligned text label under the company-name field;
  the **name** renders in the payment tile, as `<name> (<number>)`. The name used to render in
  the address area too, under the control that already showed it, which is what Doug found
  live. Both are asserted for all three capture modes, and the address-area block is asserted
  to contain no company name at all.
- no number means no label, not an empty one: a registry hit with no organisation number, and
  manual entry (which clears the number of the company the buyer just disowned), both leave
  the address-area block hidden outright rather than occupying a row under the field. The tile
  drops the parenthesised half in the same case rather than rendering `Name ()`.
- search-mode rendering is driven through `enableCompanySearch`'s own `select2:select` binding
  rather than by calling the render function, so unwiring the two fails the test.
- the display is genuinely read-only: no `input`, `select`, `textarea` or `contenteditable`
  inside either half, the number in a `span`, nothing tabbable, and — the affordance this reversal
  removes — no button, link, image, `onclick` or bound handler that would let the buyer delete
  a captured company. The overlay this replaces shipped an `<img>` with an inline `onclick`.
- submission is unaffected. `#billing_company` and `#company_id` still carry the values
  WooCommerce serialises, re-rendering does not disturb them, and nothing inside the summary
  carries a `name` attribute of its own — asserted against the form's real `serialize()`
  output, since the summary sits inside the checkout form.
- visibility: shown only for a Two purchase with something captured, hidden when the buyer
  switches to another payment method (with the fields still posting), and cleared by
  `clearSelectedCompany()`.
- the picker's empty option carries a non-breaking space as its **label**, not its value —
  truthy and invisible, so anything checking only for `""` renders it as a company. The live
  read cannot see one (the value is `""`, asserted), so the normalisation is defensive
  against the label reaching code the other way, through the checkout snapshot.
- **a company that is no longer captured stays off screen.** The picker appends an `<option>`
  per pick and neither `select2("destroy")` nor the clearing `setCompany("", "")` removes it,
  so a search → sole trader → back-to-business round trip left a company on that select with
  both posted fields empty. Pinned twice: the round trip itself, and the invariant behind it —
  what is displayed is what `#billing_company` holds, with a deliberately stale option still
  on the select.
- the user-meta restore path, which passes both values explicitly because `loadUserMetaInputs`
  writes `#company_id` _after_ it renders.

`country-switch.test.js` — what a billing-country change does, and what a fake one must not
(TWO-24867, with TWO-25326 and TWO-25333):

- **a `change` event that is not a country change is inert.** WooCommerce re-renders the
  billing fields on `updated_checkout`, and core's `address-i18n.js` re-triggers the country
  field on `country_to_state_changing` at init — both reach the delegated handler as a bare
  `change` with the value unchanged, and each one used to destroy the captured company. The
  guard compares against the last country acted on, so the captured company survives one
  such event and a run of them, and nothing in flight is invalidated.
- **a real change still clears everything**, records the new country for the next comparison,
  and leaves the new `country_prefix` on `customerCompany` — set _after_ `clearSelectedCompany()`,
  which resets that object wholesale and only re-reads it from the DOM three seconds later.
- **the tracker cannot drift from the field**, which is the failure mode the guard buys and
  therefore the one this suite spends most of its assertions on. Seven separate ways it could:
  `initialize()` seeds it, and the seed is what makes a genuine FIRST change act rather than
  be adopted; the seed is taken _after_ `loadStorageInputs()`, which writes the country with
  `selectElem.value` and fires no `change` — seeded before it, the first re-render read the
  restore as a real country change and destroyed the company that restore had just put back
  (`initialize(true)` is the bootstrap's own call, so that was the production path); the first
  country the page ever sees (billing fields rendering after `initialize()` has run) is
  adopted, not acted on; an empty reading — WooCommerce replacing `#billing_country` wholesale
  mid-re-render — is neither acted on _nor recorded_, so the switch that completes afterwards
  still acts; `updated_checkout` **records** a country that moved with no `change` event;
  it records **without** clearing a capture the same re-render is consistent with (see the
  next bullet, which narrowed this); and the recording path cannot loop, even though a change
  reaching `setAddress()` triggers `update_checkout`.
- **a capture stranded in the wrong country is dropped** (TWO-25333), which is the one case
  record-only got wrong. Recording without clearing is right when the re-render restores the
  country and the company **together** — they agree by construction — but it left a company
  captured under the country just left still captured, still approved, and paired with the new
  billing country in the order payload with no consistency check anywhere between the two: the
  buyer saw a green payment method and an opaque order-creation failure. `updated_checkout`
  therefore clears the capture when the recorded country and the captured company's own
  `country_prefix` actually **disagree**, and only then. Pinned in both directions, because the
  discriminator is the whole fix: a company captured under the country just left is cleared and
  the approval gate comes back down with it; a matching pair is untouched. Both directions are
  pinned on **both** `enable_address_lookup` settings and **both** `enable_company_search`
  settings — the manual-entry leg differs, because `clearSelectedCompany` deliberately keeps the
  buyer's typed `#billing_company` there while still blanking `#company_id`. Three readings are
  deliberately not grounds to clear, each with its own test — a company name with no
  organisation number (not a capture), an unknown country on either side (`country_prefix` is
  null until the first capture, and an empty field reading means mid-replacement), and the DOM
  already holding a **different** company from the one recorded, which means the record is what
  is stale rather than the fields, so it is re-synced from the fields instead of destroying a
  company the re-render had just restored. That re-sync reads `#billing_company`,
  `#company_id` and the country within one tick rather than calling `getCompanyData()`: in
  company-search mode that takes the name from the `checkoutInputs` **sessionStorage** snapshot
  rather than the DOM, so it rebuilt a two-moment pair — and an empty name takes
  `isReadyApprovalCheck()` down with it, leaving the method unusable for a company that was
  legitimately restored. The comparison is case-insensitive, because `currentCountry()`
  upper-cases and `getCompanyData()` reads the field raw — a false positive here is a
  destructive clear. This path can now reach `clearSelectedCompany()`, so the loop it used to be
  immune to by construction (clear → `setAddress()` → `update_checkout`) is pinned again for it.
- **what the approval-gate test does and does not prove.** `isReadyApprovalCheck()` coming back
  down stops a fresh intent being sought for the dropped pair, and that is what is asserted. It
  is _not_ the same as the payment method becoming unselectable: nothing in the file deselects
  the gateway radio and `isTwoincApproved` is written but never read, so a buyer already approved
  keeps a selected Two method over an emptied company until the next intent pass. Enforcing
  TWO-25326 §6 by deselecting is the deferred half of that design and is not in this suite.
- **the capture country is pinned when the company is captured** (TWO-25333), at all three
  capture sites: the picker's `select2:select` handler, a manually typed organisation number,
  and the sole-trader setter — which does _not_ re-pin on the clearing call `setMode("business")`
  makes with both arguments falsy. Without this the pair is assembled from two different
  moments, the number at capture and `country_prefix` from whichever DOM re-read ran last, so a
  country that moved with no `change` event _before_ the capture left the old country next to a
  company from the new one — posted by `getApproval()` as a self-consistent pair, and read by
  the discriminator above as a mismatch it would clear. The manual-entry pin fires only when the
  blur actually **moved** the number: that handler is bound to `blur`, not `change`, so tabbing
  through an untouched `#company_id` would otherwise launder a stale pair into a
  consistent-looking one the discriminator could never fire on again. Pinned, in both
  directions.

A **known residual gap** is recorded in the code rather than fixed here: `customerCompany` is
populated from the DOM on a timer, so `#company_id` can hold a real capture while that object
still holds nulls — during `initialize()`'s deferred seed, and for three seconds after
`clearSelectedCompany`. A silent country move inside one of those windows is missed, and the
deferred re-read then re-pairs the old country's company with the new country via
`getCompanyData()`, which reads `#billing_country` live and so un-pins the witness. Closing it
means stopping the DOM re-reads from overwriting a pinned `country_prefix`, which changes
`getCompanyData()`'s contract for its other callers, so it wants its own ticket. The suite also
cannot observe those timers: advancing them throws from `setTimeout(this.enableCompanySearch, 800)`
in `initialize()` — an unbound `this` in a strict class body, pre-existing and firing on every
real page load with company search on. That wants fixing first, in its own commit, before any
timer-based test here is possible.

- **the whole suite drives the real wiring**: a real `initialize(false)`, then
  `trigger("change")` on the field, so unwiring the delegated binding or moving the seed out
  of `initialize()`'s reach fails it. `afterEach` unbinds `document.body` — jsdom's document
  outlives the test, so without it each test leaves a live handler closed over its own
  evaluation of the source and the next test's event runs all of them.
- **the search country is read per request**, so a widget that outlived a country change
  queries the country the form currently holds rather than the one it was built under.
- **an in-flight company search for the outgoing country cannot repopulate the list** — the
  supersession counter is bumped by the country change, not only by a newer search.
- **the registry address lookup is guarded twice**: by sequence (a newer lookup wins) and by
  the country snapshot taken when the request was issued. Both are needed and both are pinned
  separately — a country written programmatically fires no `change`, so nothing bumps the
  sequence, and a country switched away and back leaves the sequence stale but the country
  matching. An empty reading on _either_ side is deliberately NOT a mismatch — dropping a good
  registry address there would be a silent failure with no retry, and a lookup issued during a
  replacement snapshots `""`, which compared against a known country would discard every
  response. The happy path is pinned too, so the guard cannot be tightened into a no-op.

One line in this change is deliberately uncovered and says so in its own comment: the
spinner hand-off in the country handler. Nothing reachable fails without it — what clears
the spinner today is `clearSelectedCompany()` re-attaching the widget and taking the
dropdown with it — so a test asserting the spinner is gone afterwards would pass either way,
which is worse than no test.

### Two defects these tests found, now fixed

Both were pinned as characterisation tests when this suite landed, and both were fixed
immediately afterwards; the tests now assert the corrected behaviour:

- **a hit with no usable `national_identifier` no longer throws.** `item.national_identifier.id`
  was read unguarded, and the body-level guard above it stops a malformed _body_, not a
  malformed _hit_. `national_identifier` is optional in the search response, so a throw inside
  select2's query pipeline took the whole result list down and left the dropdown on
  "Searching…". Such a hit now renders as the company name with no identifier suffix and an
  empty `company_id`, so the company stays selectable and the other hits survive.
- **`client` / `client_v` reach the company-search query string.** `constructTwoincUrl()` set
  them as properties on the object it was handed; the search's `url()` callback hands it a
  `URLSearchParams`, and `new URLSearchParams(params)` copies entries, not properties, so both
  were dropped for that one caller. They now go through `set()` on a normalised
  `URLSearchParams`, which covers both shapes. Query string rather than a header on purpose —
  a custom header makes the request non-simple and costs a CORS preflight per keystroke, and
  this is the only platform attribution the endpoint can get, since the widget is client-side
  and the user-agent is the shopper's browser.

## Known gaps

Deliberately out of scope for this suite, which covers the company-search request path
rather than every behaviour in a 2300-line file. Mutating any of the following leaves the
suite green:

- everything reached through the `Twoinc` class and the page bootstrap: order-intent checks,
  the surcharge fee recalculation trigger, saved-input replay, sole-trader fields;
- the fetch half of `twoincTermChips` — `refresh()`'s fee POST and its done/fail branches.
  `render()` itself IS covered, by `term-chips.test.js`: the singular/plural chip labelling
  and heading placement, and the currency-symbol fee label (ABN-468);
- the selection side of company search — `onCompanySelected`-equivalent handling in
  `Twoinc.initialize`'s `select2:select` binding, `clearSelectedCompany()`, the
  the address autofill. Neither the manual-entry row nor the captured-company summary is among
  these any more — see their own suites above. The `select2:select` binding and
  `clearSelectedCompany()` are covered only for what they do to that summary; everything else
  they do still is not;
- `twoincDomHelper`'s field moving/reverting and validation cues;
- `fixSelectWooPositionCompanyName`, `waitToFocus` and `addSelectWooFocusFixHandler` — DOM
  position and focus workarounds whose observable effect is layout.

`toggleCompanySearchSpinner()`'s `$search.length === 0` early return is covered (via the
closed-dropdown test), but the `.twoinc-searching` class it toggles is asserted rather than
its rendered effect, which is CSS.

The spinner's paint is partly covered: `injectStylesheet()` puts the real stylesheet in the
document and jsdom's cascade resolves enough of it to prove the rule points at the loading
GIF. What jsdom cannot tell you is whether the result is _visible_ — box geometry, stacking,
and whether the image animates are all beyond it, and the multi-value `background-position`
shorthand does not resolve at all (it reads back empty however the rule is written, so do
not assert on it). The asset's own bytes are checked instead — dimensions and frame count —
which pins that the file could animate, not that the browser animates it.

Treat a change to the spinner's appearance as needing a real browser. This gap has bitten
once already: an earlier attempt on TWO-25288 drew the figure in CSS and shipped for one
commit rendering completely motionless, with the whole suite green — nothing in jsdom
evaluates an animation, and asserting an animation's _name_ would have passed too. Moving to
an animated image asset is what made the paint assertable at all, but "assertable" stops at
the URL.

## Adding tests

Prefer driving behaviour through the real widget — open it with `openCompanyWidget()` and
assert on `resultsText()` — over spying on the helpers, and settle requests explicitly
through `stubAjax()`. Out-of-order responses, aborts and timeouts are the subject matter
here, so controlling the timing is the point rather than a shortcut.

Before trusting a new test, break the line it is supposed to pin and watch it fail. Every
assertion in this suite was checked that way; nine separate mutations of
`assets/js/twoinc.js` (silencing the abort branch, dropping either supersession guard,
dropping the `always` guard, weakening `degraded === true` to truthiness, removing the
`Array.isArray` guard, removing the request timeout, dropping the `national_identifier`
guard, reverting `constructTwoincUrl()` to property assignment) each fail at least one test.

Four further mutations of `assets/css/twoinc.css` and its asset were checked the same way,
all against the spinner-paint test: repointing the spinner's `url()` at a directory that does
not exist, deleting its `background-image` declaration, deleting `assets/images/loader.gif`,
and replacing that asset with a valid single-frame 16x16 `GIF89a` built from its own header,
colour table and first frame. Two of those used to pass: the repointed `url()`, because the
existence check looked at a path written into the test rather than the one the stylesheet
declares, and the single-frame GIF, because the frame count was a raw byte scan.
