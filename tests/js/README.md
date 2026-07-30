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
- the country is captured when `genSelectWooParams()` runs, not per keystroke — which is
  why a country change has to re-run `selectWoo()` with fresh params.
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
- visibility is the search threshold and nothing else. The row is present at the threshold
  with **zero** requests made, which is what rules out a "has a search run" gate, and the
  threshold assertion injects a different number so a leftover literal `3` cannot pass.
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
  the address autofill. The manual-entry row is no longer among these — see its own suite
  above;
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
