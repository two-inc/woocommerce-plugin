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
- **The unsupported-country gate withdraws SEARCH, never manual entry.**
  `syncCompanySearchAvailability()` in `assets/js/twoinc.js` hands the answer to
  the panel's `setDisabled()`, which hides the query row; the registered-company
  chip goes with it. The panel itself still opens and the company field never
  carries the native `disabled` flag, because the chips inside the panel are the
  buyer's only route to manual entry and the sole-trader flow. Anything that
  disables that field, or closes or refuses the panel on an uncovered country,
  leaves a buyer there with no way to name their company at all (ABN-525). The
  country the gate reads is the wider company-search coverage, one global list —
  not the sole-trader chip's own per-country registry lookup, which is a
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

The payment-term chips are a radio group

- The chips are `button` elements carrying `role="radio"` inside a
  `role="radiogroup"` container, and they implement that role's whole keyboard
  contract: the group is a SINGLE tab stop, carried by the checked chip, and the
  arrow keys move the checked term and the focus together, Home and End jump to the
  ends, and both ends wrap (ABN-554). Both halves or neither — roles without the
  keyboard behaviour advertise something the control does not do, which is its own
  defect.
- **The group is named by the heading above it**, through `aria-labelledby`. That
  heading is a `span`: a `label` names exactly one form control, so as a `label` it
  named nothing and left the group anonymous. A standard-term chip carries no
  `aria-label` — the visible "N days" already reads as a name, and a second one
  risks WCAG 2.5.3.
- **A chip states its term type, not just a day count.** An end-of-month term
  falls due that many days after the end of the month, so a chip reading
  "30 days" on a shop configured that way states the wrong due date. The visible
  text is `30 days` under standard terms and `EOM+30` under end of month, and the
  end-of-month chip alone carries a `title` and an `aria-label` spelling it out:
  `EOM+30: pay 30 days after the end of the month`. The name opens with the
  visible token because WCAG 2.5.3 requires it to contain the visible text. The
  copy is translated PHP-side and reaches the renderer in the checkout bootstrap
  alongside the flag saying which type is stored; a missing end-of-month template
  degrades to the bare `EOM+30` token rather than to a standard-term label.
- **That name states the surcharge as well**, because an `aria-label` replaces the
  whole accessible name and the `+€n,nn` rendered inside the chip is then announced
  nowhere. A priced end-of-month chip is named
  `EOM+30: pay 30 days after the end of the month, plus a €7,25 surcharge`. That is
  a second whole sentence rather than the first with a clause appended, so a
  translator can order the clauses, and its placeholders are numbered because the
  day count and the amount are different values. The chips are rebuilt when the
  quote lands, so the name follows the amount in. A term the quote did not price, a
  set where every term quotes nothing, and a quote still in flight all name no
  amount — the same three states that show no amount on the chip.
- One expression decides both the visual `--selected` class and `aria-checked`, so
  the tick and the exposed state cannot drift apart. A selection matching no offered
  chip leaves nothing checked and puts the tab stop on the first, so the group
  cannot fall out of the tab order.
- **A modified arrow key is left to the browser.** Alt+Left is "back" and
  Ctrl/Cmd+Arrow are the browser's own shortcuts; a group that swallows them breaks
  navigation.
- The focus ring is `:focus-visible`, not `:focus`: with one tab stop the focused
  chip is the only thing saying where the keyboard is, and a clicked chip still gets
  no ring.
- **A re-render replaces every chip, so it destroys the one the buyer is on.**
  `render()` hands focus back to the rebuilt chip carrying the same term. Every fee
  quote, every term selection and every other checkout update re-renders, so without
  it the ordinary click path drops focus to the body too.
- **One resolver decides the term a request is charged for.**
  `WC_Twoinc_Payment_Terms::resolve_charged_term()` prefers the posted hidden
  field and falls back to the session, and the cart fee, the availability gate
  and the order payload all read it. The field follows a chip the moment the
  buyer moves to it while the session follows a round trip later, so a fee
  resolved from the session alone charges the term the buyer left while the order
  is booked on the one they chose.
- **Selection follows focus, so the commit is coalesced.** Each committed change
  costs a selection post, a full checkout update and a fresh fee quote, and an arrow
  sweep crosses every chip on the way. The arrow keys update the chips and the hidden
  `two_selected_term` field in place and arm one delayed commit; a click supersedes a
  commit still waiting. The order is composed on that posted field, current from the
  first keystroke, so the delay costs only the displayed total.
- **The keydown binding is delegated from `document`, not `document.body`.** This
  script is enqueued in the head, where there is no body yet, so a body-rooted
  binding attaches to nothing at all — and jsdom cannot catch it, because the Jest
  harness evaluates the source with a body already present. It is delegated rather
  than bound on the container because a checkout update replaces the payment
  fragment and the container with it, and namespaced with an unbind first so a
  second evaluation of the script replaces the handler instead of stacking one that
  moves the selection twice per key.

Keyboard behaviour is not verifiable in jsdom

- jsdom implements no sequential focus navigation: a dispatched `Tab` keydown moves
  focus nowhere, so no Jest suite here can observe a focus trap, a wrong tab order
  or a reverse-Tab dead end, however many cases it carries and however green it is.
  `tests/js/company-search-tab-stop.test.js` therefore asserts only the state the
  browser derives tab order FROM — `tabindex` on the field, `hidden` on the panel,
  document order of the control's parts. The traversal itself is covered by no
  automated test in this repo — the e2e suite has no keyboard case — so it is
  hand-verification only until ABN-499 adds one. A passing jsdom Tab test is never
  evidence that a trap is absent, so no case here may dispatch `Tab` and assert on
  what did not happen:
  an event left undefaulted is what a trap implemented by moving focus looks like
  too (ABN-499).
- Focus a handler moves ITSELF, with `element.focus()`, is the exception: jsdom
  performs that, so arrow-key traversal inside a composite control is directly
  observable where tab order is not. What a suite can pin for tab order is the
  roving `tabindex` the browser derives it from, never the traversal.
- jsdom has no layout and applies no `:focus-visible`, so a focus indicator is
  browser-verification only.

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

Launchers are not exempt from rule two — a launch blurs whatever holds focus first.
A popover left on screen for the flight around a document focusing nothing reaches
no keystroke at all, so the launch parks that focus on the company field one tick
later, through the panel, which holds off the field's own opener (ABN-554). That one
control is exempt from the rules above until focus leaves it: a window return re-fires
`focusin` there with no `focusout` before it, and that is not the buyer arriving. The
settle drops the park before it decides where focus belongs, so what it reads is the
unplaced focus the launch actually left.

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

Where a hand-closed signup popup leaves focus

A popup the buyer closes themselves decided nothing, so the launcher still owns
the focus it gave up and gets it back — as long as that launcher survived the
close. The Sole trader chip does not: it lives inside the dropdown the settle
closes. Focus then goes to whichever launcher is still standing, which once a
sole trader is adopted is the "select a different sole trader" link, and that
link reopens the same chooser. Where nothing was adopted, focus goes to the
company name field instead, whose own opener reopens the search popover and
takes the focus into its query.

One consistent target — always the company name field — would read better than
a target that depends on which control the buyer launched from. It is not done:
the field's opener would have to be revised to guarantee the popover opens when
that is wanted and stays closed when it is not, and getting that right is hard
enough that the inconsistency is the safer state to be in (ABN-561).

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
- The merchant is told. A refusal is re-emitted into `WC_Admin_Settings`' static
  error bucket, which outlives the gateway object WooCommerce discards on save
  and which suppresses core's blanket success notice. A gateway's own
  `display_errors()` prints on an object that no longer holds the refusal.
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

- A quote that never resolved is reported (ABN-539). A configured surcharge the
  pricing service could not price — unreachable, a non-2xx status, an answer that
  cannot be read, or one quoted in a currency the basket is not in — is logged at
  error level naming the term and the cause. A quote that resolved to nothing to
  charge is not a failure and is not reported.
- A quote that never resolved withholds the method at checkout (ABN-546). The
  availability-gate filter quotes the term the basket would be charged for and
  drops the Two gateway when that quote fails, alongside the unmet-minimum and
  no-FX-rate withholds. Only the charged term counts, and only when that term
  has something to charge: one misconfigured term does not take the method
  offline for a checkout not using it, and a resolved zero, a term configured to
  charge nothing — including a cap with no percentage behind it, and the
  default term in fee-difference mode — a term with no surcharge configured
  and an empty basket all withhold nothing and cost no pricing call. A failed
  quote is never cached, so recovery is the next request and every render
  during an outage pays the quote's own timeout. Gate and charge reach the wire
  through the one quote helper on one ceiling, so the gate can never give up
  sooner than the path that charges; the other plugins use the same ceiling. The judgement runs on a checkout
  page carrying the basket the fee applies to: the cart page renders no payment
  method, the order-pay endpoint's session cart is not the basket being paid
  for, an admin request is never judged on it, and the admin's own fee preview
  reads the merchant rates rather than a basket quote. Off the checkout page
  the withhold still fires on a failure the cart-fee hook recorded in the same
  request.
- A quote answering in another currency is refused, not cached (ABN-546). The
  answer is checked against the currency it was asked in before the quote is
  stored, so a mismatched answer is reported as a failure once and cannot be
  served again for the rest of the cache window.
- A fee answer that cannot be drawn is refused, not drawn (ABN-540). The rates
  read refuses a set with nothing priced, and one carrying no currency for the
  amounts it does hold, rather than reporting success. On the screens, a term the
  answer did not price is labelled as carrying no figure — never an empty gap in
  the admin, and never a formatted zero on a buyer's chip, both of which read as
  "this term carries no fee". A term priced AT zero still shows its zero.

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
- A SURCHARGE input that pricing cannot resolve fails CLOSED for the BUYER — the
  availability gate withdraws Two rather than let an order be priced with the fee
  silently absent.
- **The api-key verdict is the only upstream failure that may withhold Two, and only
  its definitive-rejection categories do** (ABN-533):
  `WC_Twoinc::is_definitive_key_failure()` — `invalid_key` and `not_configured`.
  `unreachable`, `service_error` and `error` fall through to the cached merchant
  record, which never expires, so an outage leaves a correctly configured shop
  selling. A 200 carrying no merchant record is `error`, not `ok` — a proxy, a
  captive portal or a maintenance page answers 200 too — but it rejects no key and
  so withholds nothing. That predicate is the ONE definition of the set; do not
  re-list the categories at a gate, and do not add a second gate that withholds
  because a call to Two failed.
- **An unresolved offerable term set does NOT withhold Two** (ABN-533) — the tile is
  offered with an EMPTY term set, aligning every platform on Magento. No term chip
  renders, no term is sent on the order and the account default applies; a preset
  term set must never be composed for a buyer. Empty whether the fetch never
  succeeded or the account offers nothing; the read is the same cached list every
  other consumer uses, so it adds no fetch of its own.
- **An unresolved term set is explained in the admin, and its cause is PERSISTED**
  (ABN-513). A fetch that lands no record writes its own category — unreachable,
  rejected key, rate limited, server error, another status, an answer that cannot be
  read — to a dedicated option row that the next success deletes, because the render
  that has to explain the state is rarely the request whose fetch failed. The Payment
  Terms field then states the cause, that buyers are offered no term to choose until
  one can be read, and when the terms were last read successfully; the install health
  summary carries the same verdict and that timestamp. A successful read of an empty
  list and a record carrying no term list at all are named separately. The API key is named only
  in the two states where it is actually implicated — none saved, or one the API
  rejected — never as a guess at an unexplained failure.
- **Only the gateway's own settings section re-verifies the stored key on load**
  (ABN-537). The hook it rides fires on every wp-admin request, so the screen check
  is what stops an unreachable API blocking the whole administration area; the
  cached verdict is read before a call is spent, and the call is capped well under
  wp_remote_request()'s own 30-second default.
- **Figures served from cache are never presented as current** (ABN-538). The
  recorded refresh failure is read before a term-set status resolves, so a set
  standing over failed refreshes carries the cause with it, and the age of the last
  successful read decides whether the install health summary paints it as healthy —
  the age half of that judgement being the refresh policy's own freshness test,
  negated, with the recorded failure an additional reason that clock cannot see. The
  summary names which of the two it is, because figures read minutes ago whose
  refresh then failed are not out of date. Withholding is unaffected: a cached set
  still resolves and the method is still offered.
- **A key check that reached no verdict degrades nothing in the admin** (ABN-536).
  Only a definitive rejection blanks the Merchant ID and marks the key bad, and
  which verdicts those are is decided by the same predicate the gate uses, sent
  with the verdict rather than re-listed in the admin script. An unreachable API,
  a service error, an unexpected status or a request that never left the site
  leave the identity block and the key indicator exactly as they were, and say
  the check did not complete in a tone that is not an error colour. A green tick
  applies only to the key it was earned for.
- **The admin save stays possible whatever the verification says** (ABN-495). An
  unreachable API judges nothing about the key, and refusing the save locks the
  merchant out of storing the key that would fix the outage; the verdict is reported
  beside the save instead. A key Two rejected (401/403) is the one submitted value
  the save discards, and the message says the stored key was kept.
- The payment-terms type setting is rendered only for a merchant already set to end
  of month (TWO-25656); a merchant not on it is not offered it.
- **A stored custom term day the account does not offer never reaches a buyer**
  (ABN-521) — the effective set is the configured terms narrowed to the offered
  list, the custom day included, and an unresolved list is unknown rather than
  empty so it narrows nothing. Refusing such a day at save time is deferred
  pending ABN-522.
- **The preselected term prefers 30 days** (ABN-548) — `get_default_term()`
  resolves the admin's stored default, the merchant's own default term, 30, and
  finally the shortest offered term, each only while it is in the offered set.
  An empty offered set has no default at all. The differential surcharge basis
  reads the same resolver, so the reference term it prices against moves with
  the preference.
- **Nothing but the admin puts a day count in `default_payment_term`.** The
  field's first option is Automatic, an empty value; the save validator stores
  empty for any posted default the offered set does not carry, except where
  that set is empty — an unresolved backend list, or a selection with nothing
  ticked, which the terms validator refuses — and it keeps whatever was stored
  rather than reading a set no merchant chose as a decision. The admin JS that rebuilds the
  select as terms are ticked re-creates that option and keeps only a selection
  still offered. Anything that synthesises a day count there instead is stored
  by the next save, becomes the resolver's first step, and makes every later
  step unreachable on that shop.
- **The merchant's own default term is 0 in its option row when the record
  carries none**, and the row written under the rule that stored 14 there is
  dropped once on upgrade — a shop whose record never resolves would otherwise
  keep reading a fabricated 14 as a real term. The record's freshness stamp is
  deliberately left alone: the admin's terms-state notice reads it, and
  dropping it reports a term set the shop holds as never fetched.

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
