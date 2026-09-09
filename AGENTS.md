You are an expert in WordPress, WooCommerce, PHP, and related web development technologies.

Key Principles

- Write concise, technical code with accurate PHP examples.
- Follow WordPress and WooCommerce coding standards and best practices.
- Use object-oriented programming when appropriate, focusing on modularity.
- Prefer iteration and modularization over duplication.
- Use descriptive function, variable, and file names.
- Use lowercase with hyphens for directories (e.g., wp-content/themes/my-theme) (e.g., wp-content/plugins/my-plugin).
- Favor hooks (actions and filters) for extending functionality.

PHP/WordPress/WooCommerce

- Use PHP 7.4+ features when appropriate (e.g., typed properties, arrow functions).
- Follow WordPress PHP Coding Standards.
- Use strict typing when possible: `declare(strict_types=1);`
- Utilize WordPress core functions and APIs when available.
- File structure: Follow WordPress theme and plugin directory structures and naming conventions.
- Implement proper error handling and logging:
- Use WordPress debug logging features.
- Create custom error handlers when necessary.
- Use try-catch blocks for expected exceptions.
- Use WordPress's built-in functions for data validation and sanitization.
- Implement proper CSRF-token verification for form submissions.
- Utilize WordPress's database abstraction layer (wpdb) for database interactions.
- Use `prepare()` statements for secure database queries.
- Implement proper database schema changes using `dbDelta()` function.

Dependencies

- WordPress (latest stable version)
- WooCommerce (latest stable version)
- Composer for dependency management (when building advanced plugins or themes)

WordPress and WooCommerce Best Practices

- Use WordPress hooks (actions and filters) instead of modifying core files.
- Implement proper theme functions using functions.php.
- Use WordPress's built-in user roles and capabilities system.
- Utilize WordPress's transients API for caching.
- Implement background processing for long-running tasks using `wp_cron()`.
- Use WordPress's built-in testing tools (WP_UnitTestCase) for unit tests.
- Implement proper internationalization and localization using WordPress i18n functions.
- Implement proper security measures (CSRF tokens, data escaping, input sanitization).
- Use `wp_enqueue_script()` and `wp_enqueue_style()` for proper asset management.
- Implement custom post types and taxonomies when appropriate.
- Use WordPress's built-in options API for storing configuration data.
- Implement proper pagination using functions like `paginate_links()`.
- Leverage action and filter hooks provided by WooCommerce for extensibility.
- Example: `add_action('woocommerce_before_add_to_cart_form', 'your_function');`
- Adhere to WooCommerce's coding standards in addition to WordPress standards.
- Use WooCommerce's naming conventions for functions and variables.
- Use built-in WooCommerce functions instead of reinventing the wheel.
- Example: `wc_get_product()` instead of `get_post()` for retrieving products.
- Use WooCommerce's Settings API for plugin configuration pages.
- Integrate your settings seamlessly into WooCommerce's admin interface.
- Override WooCommerce templates in your plugin for custom layouts.
- Place overridden templates in `your-plugin/woocommerce/` directory.
- Use WooCommerce's CRUD classes and data stores for managing custom data.
- Extend existing data stores for custom functionality.
- Use WooCommerce session handling for storing temporary data.
- Example: `WC()->session->set('your_key', 'your_value');`
- If extending the REST API, follow WooCommerce's API structure and conventions.
- Use proper authentication and permission checks.
- Use WooCommerce's notice system for user-facing messages.
- Example: `wc_add_notice('Your message', 'error');`
- Extend WooCommerce's email system for custom notifications.
- Use `WC_Email` class for creating new email types.
- Check for WooCommerce activation and version compatibility.
- Gracefully disable functionality if requirements aren't met.
- Use WooCommerce's translation functions for text strings.
- After editing any `languages/*.po`, recompile its `.mo` — WordPress reads only
  the compiled catalogue: `for po in languages/*.po; do msgfmt -o "${po%.po}.mo" "$po"; done`.
  CI fails when a `.mo` disagrees with its `.po` (`.github/scripts/check-catalogues.sh`).
  That script also rejects a malformed/missing `.po` header and a `msgstr` whose
  placeholders do not match its `msgid` — recompiling fixes neither, so read which
  of the three it reported before reaching for `msgfmt`. A translation must carry
  exactly the conversion specifiers its source string has: nothing substitutes into
  an invented one, and a dropped one silently loses whatever it was going to show.
- Support RTL languages in your plugin's CSS.
- Utilize WooCommerce's logging system for debugging.
- Example: `wc_get_logger()->debug('Your debug message', array('source' => 'your-plugin'));`

Vendored assets

- `assets/js/company-search-panel.js` is one of TWO copies of the same panel
  module — this one, and the one the Two Magento plugin carries — so both
  checkouts render one control. The copies have DRIFTED: 98 lines differ across
  15 hunks, 93 of them present only on the Magento side and 5 only here. A
  whole-file re-copy is therefore NOT the route while that gap stands; it would
  import the other platform's code into this one wholesale. The Two Hyvä
  extension carries no copy at all — it loads the base Magento plugin's panel by
  module reference — so there are two copies in total, not three.
- **A change to shared panel behaviour is TWO edits in ONE change set.** Apply it
  in place here and identically to the other copy, re-run the JS suite, and paste
  the new digest into the edit-lock below in the same commit. Nothing links the
  copies: whoever changes one and stops has fixed one platform, and neither
  reviewer sees the other half. A change that serves one platform only stays in
  that copy, and that is what the divergence above is made of.
- `tests/js/company-search-panel-vendored.test.js` is an **edit-lock, not a parity
  check** (TWO-25503). `EDIT_LOCK_SHA256` is this copy's own digest, so the suite
  fails on any change to this file that did not move the digest with it — an
  unintended edit, a stray formatter run, a bad merge — and passes on a
  deliberate one. It cannot reach the Magento repo at all and says nothing
  whatever about whether the two copies agree: **nothing compares them**, so
  nothing detects the drift between them. `.prettierignore` keeps the formatter
  off the file so the digest is not moved by a reformat nobody asked for.
- The module is framework-free with a UMD tail, a constraint the other copy shares:
  a Magento-side checkout loads it with no RequireJS, jQuery or Knockout, so a
  framework dependency added to either copy lands in a place that cannot satisfy
  it.
- **The unsupported-country gate greys out SEARCH, never manual entry.** Manual
  entry hands the field over as a plain typeable input that never reaches the
  registry, so disabling it there blocks a mode that was never going to search and
  leaves a buyer in an uncovered country with no way to name their company at all.
- **The company field opens the panel on FOCUS**, through the same `open()` a
  mousedown runs, leaving the caret in the panel's query field — the same state a
  click leaves it in, and the same on every platform that carries this control.
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

Keyboard behaviour is not verifiable in jsdom

- jsdom implements no sequential focus navigation: a dispatched `Tab` keydown moves
  focus nowhere, so no Jest suite here can observe a focus trap, a wrong tab order
  or a reverse-Tab dead end, however many cases it carries and however green it is.
  `tests/js/company-search-focus-trap.test.js` therefore asserts the observable
  proxies — the handler leaves the `Tab` event undefaulted, the control's parts are
  one contiguous run in document order, a closed panel carries `hidden` — and the
  keyboard behaviour itself is verified in a real browser. A passing jsdom Tab test
  is never evidence that a trap is absent.

Three more traps in the JS suites:

- **A real chip click fires no `focusin`.** The chip's `mousedown` handler calls
  `preventDefault()`, which suppresses the native focus, so a rule written only
  against `focusin` never sees a pointer buyer at all.
- **jsdom's `getElementById` answers with the first-REGISTERED node, not the
  tree-first one**, so a fixture carrying a duplicate id silently resolves to the
  wrong element.
- **A mutation proves NEW coverage only when re-run against the base ref.** One the
  existing suite already catches proves the suite is sensitive, not that the case
  added covers anything.

A popup window is in no tab listing

- `window.open` returns a window outside a browser extension's tab group, so a tab
  list can never answer "did the popup open" — nor can a hang. The authoritative
  check is the page's own retained handle and its `.closed`, which means wrapping
  `window.open` before the action that should raise one. Judging from a tab list
  yields a confident false "no window opened".

What focus landing on the checkout does to an open signup popup

Once the sole-trader tokens are minted, every `focusin` on the checkout is
classified once — whether a popup is up or not — and these are the three rules
(TWO-25658):

- **The role's own Sole trader chip is inert.** Arrival moves the popup neither way
  — only an activation raises it, and the browser delivers Enter and Space on a
  focused chip as a click.
- **Any other target closes an open popup.**
- **A target outside that role's popover closes the popover too**, with the company
  field counted as INSIDE it: the field is the popover's own trigger and sits
  outside the panel node, and a buyer typing a query is still inside the control;
  its own focus opener would otherwise race this rule on event order.

A window or application switch lands on no control at all and settles nothing.
Launchers are not exempt from rule two — a launch blurs whatever holds focus first,
so a window return re-fires focus on nothing.

**Reaching another role's Sole trader chip by FOCUS closes this popup and launches
one for that chip** — the exemption is gated on the chip being inside this role's own
popover, so another role's chip is a target like any other, and the rule then activates
it, its own click handler being the one place a launch is spelled out. Each role holds
its own sole-trader controller (TWO-25658).

**That "own popover" is resolved off the field on every event, never from a stored
node.** The panel builds the popover as the field's SIBLING, and a host that morphs its
server markup over the live DOM rebuilds the popover — and can delete the wrap the panel
built — while keeping the field. Judged against a stored popover, or against one found
by a descendant search under whatever container the field is left in, this role's own
re-rendered chip reads as another role's and the rule inverts on it: returning to the
very chip that launched the popup closes it, and on a two-role page a descendant search
can answer with the other role's popover outright.

The custom request-header table

- The Diagnostics header table sends any number of named headers on calls to the Two
  API, each with its own "also send from browser" tick. Every rule the save
  enforces — a non-empty name in the RFC 7230 token set, no reserved name matched
  case-insensitively, no duplicate name, a non-blank value, printable-ASCII values
  — is re-applied on the READ path, because a stored value can arrive from a
  hand-edited row or an import that no form validated.
- **The header table gets no data patch or migration, deliberately.** The
  single-value setting it replaces never reached a production release on any
  platform, so no merchant ever had one configured; do not add one on the
  assumption that stored values exist.
- **A browser-ticked header must already be allowed by the API for
  browser-originated calls**, or the one direct call the browser makes fails CORS
  preflight and the sole-trader autofill silently finds no buyer. Nothing enforces
  it and no field help states it.
- A refusal names the rule, never who sets the header — the reason has to be true of
  every reserved name, not of the one example that prompted the question.
- **The printable-ASCII value pattern carries `/D`.** A bare
  `$` also matches immediately before a trailing newline, which is precisely the
  byte the rule exists to refuse, and a header value ending in one is a
  response-splitting sink.

A guard is invoked through `bash`

- A script committed mode `100644` and run as `./script.sh` exits 126. On a CI
  dashboard that is indistinguishable from a check that ran and failed, so the
  guard's own absence reads as its verdict. Invoke anything whose failure mode is
  "did not execute" as `bash script.sh`, and have it print what it checked.

This is a public repository

- No partner or merchant name reaches file contents, a commit body, a branch name or
  a PR title or body. Gate before pushing: a force-push afterwards does not remove a
  commit from GitHub's history.
- In comments, commit messages and PR bodies alike, cite a Linear ticket id and
  nothing else: a section, question or ruling number belonging to an internal review
  document means nothing to a reader outside the company, and neither does a person
  named as the authority for a rule.
- Describe another plugin's behaviour in your own words; never reproduce its source
  text, schema fragments or test identifiers here.

Admin settings fail loud: an unrecognised stored value is never priced

The standard for EVERY gateway setting, not only the surcharge method.

- Save refuses it. The field's `validate_<field>_field()` throws for a value
  outside the field's known set, judged on the RAW submission — so a crafted
  POST cannot store a value nothing understands. Only the field's explicit
  unset key persists as the default.
- Read paths raise. The settings reader is the single choke point: it maps the
  unset key to the default and throws for anything else. Callers that price a
  fee or build an order let that throw.
- Gates catch it. The availability-gate filter withdraws the Two gateway and
  nothing else; render-time and wc-ajax callers degrade to "no fee" rather
  than fatalling the page. That judgement runs in admin too, so an
  admin-created order cannot place with the fee silently absent. The reader
  logs the offending value once per request, so the catchers stay quiet.
- Buyer copy stays generic. The buyer sees the existing "not available"
  wording. A setting name, a stored value or an enum key never reaches the
  storefront — those belong in the WooCommerce log and in the admin field's
  own validation message.

Degrading a junk value to a working default is the failure this replaces: it
prices an order under a configuration nobody chose, and nobody is told.

The merchant record refreshes on an event, never on expiry

- One read path fetches the merchant record and one fetch writes every derivative
  (terms, due-in-days, platform minimum, surcharge cap, buyer countries). Adding a
  per-consumer freshness clock is how those drift apart.
- Refreshed on three events: a key or environment save, a nightly cron re-anchored
  if a DST shift drifts it off midnight, and the Diagnostics refresh button. No
  render path refreshes on purpose; a render on a cold clock pays the fetch that
  repopulates it, bounded to one attempt per 60 seconds while the API is failing.
- **A failed fetch keeps last-known-good and advances no FRESHNESS clock** — only
  the attempt clock the 60-second bound reads — so it can neither overwrite a
  concurrent success nor blank a cached restriction to "unrestricted".
- An input that pricing cannot resolve fails CLOSED for the BUYER — the availability
  gate withdraws Two rather than let an order be priced with the fee silently
  absent, and a 200 carrying no merchant record counts as unresolved: a proxy, a
  captive portal or a maintenance page answers 200 too, and there is no identity to
  offer the method under.
- **An unresolved offerable term set withdraws Two from checkout too** (ABN-495) — a
  verified key proves the shop's identity, not that the account can sell. Empty
  whether the fetch never succeeded or the account offers nothing; the gate reads the
  same cached list every other consumer does, so it adds no fetch of its own.
- **The admin save stays possible whatever the verification says** (ABN-495). An
  unreachable API judges nothing about the key, and refusing the save locks the
  merchant out of storing the key that would fix the outage; the verdict is reported
  beside the save instead. A key Two rejected (401/403) is the one submitted value
  the save discards, and the message says the stored key was kept.
- The payment-terms type setting is rendered only for a merchant already set to end
  of month (TWO-25656); a merchant not on it is not offered it.

Key Conventions

1. Follow WordPress's plugin API for extending functionality.
2. Use WordPress's template hierarchy for theme development.
3. Implement proper data sanitization and validation using WordPress functions.
4. Use WordPress's template tags and conditional tags in themes.
5. Implement proper database queries using $wpdb or WP_Query.
6. Use WordPress's authentication and authorization functions.
7. Implement proper AJAX handling using admin-ajax.php or REST API.
8. Use WordPress's hook system for modular and extensible code.
9. Implement proper database operations using WordPress transactional functions.
10. Use WordPress's WP_Cron API for scheduling tasks.
