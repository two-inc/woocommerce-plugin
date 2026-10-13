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
- Place templates the plugin loads itself in `your-plugin/woocommerce/` — that directory name is the `$default_path` the plugin passes to `wc_get_template`.
- A template WooCommerce core loads has no such seam: replace it through `woocommerce_locate_template`, return any path you like, and record in its header the core version it was copied from.
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
- Translation catalogues (`.pot`, `.po`, `.mo`): read [docs/translations.md](docs/translations.md) before adding, changing or deleting a translatable string or catalogue entry, or regenerating or editing any catalogue.
- Support RTL languages in your plugin's CSS.
- Utilize WooCommerce's logging system for debugging.
- Example: `wc_get_logger()->debug('Your debug message', array('source' => 'your-plugin'));`

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
  Commit trailers added by tooling (`Co-Authored-By`, `Claude-Session`) are
  attribution, not citations, and stay.
- Describe another plugin's behaviour in your own words; never reproduce its source
  text, schema fragments or test identifiers here.

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

## The plugin package contains plugin files only

Two exclusion lists decide what merchants receive, and both must agree:

- `.distignore`: honoured by the WordPress.org deploy in `deploy.yaml`.
- `.gitattributes` (`export-ignore`): honoured by `git archive`, which `make
archive` uses.

A file that is repository tooling rather than plugin code (agent instructions,
CI configs, dev scripts, lint and analysis configs, env examples, version
markers, stray build output) goes into both lists in the same change that adds
it. Check before pushing:

    git archive --format tar --worktree-attributes HEAD | tar -t | awk -F/ '{print $1}' | sort -u

The expected top level is `assets brands class languages readme.txt templates
tillit-payment-gateway.php uninstall.php views`.

## Task-specific guides

Read the matching guide before working in that area. Each holds rules that are not repeated here. Every "read before" line below applies equally when reviewing a pull request that touches that area.

- [docs/company-search-panel.md](docs/company-search-panel.md): read before editing `assets/js/company-search-panel.js`, its `.prettierignore` entry or its digest test (`tests/js/company-search-panel-vendored.test.js`), or running a formatter over it; changing the options `assets/js/twoinc.js` passes the panel (transport, chips and modes, country source, rate-limit scope); any company-search, company-name field, capture-mode chip, popover, country gating (`syncCompanySearchAvailability()`, `companySearchIsOffered()`, `toggleBusinessFields()`, the buyer-country allowlist, search coverage), payment-tile placement, required-cue (`toggleRequiredCues()`, or a `required` attribute or asterisk on a company field from JS or PHP), autofill or focus behaviour; or the company search and address autofill settings, their admin rows, getters (`get_enable_company_search()`, `get_enable_address_lookup()`) and legacy `enable_company_name` migration.
- [docs/payment-term-chips.md](docs/payment-term-chips.md): read before changing the payment-term chips (markup, roles, keyboard handling, focus, labels, accessible names, the surcharge amount shown on a chip, CSS, what renders when no term set resolves), the checkout bootstrap data that feeds them (translated chip copy, the term-type flag), how the chip script is enqueued or binds its handlers, the term selection post or the `two_selected_term` field, the name of the payment terms fee line (including the line-description setting and a brand overlay's fee-line label, as shown in the cart, order, emails and admin order view), or how the charged term is resolved (`resolve_charged_term()`) for the fee, the availability gate or the order.
- [docs/js-testing-and-focus.md](docs/js-testing-and-focus.md): read before writing or changing any JavaScript test (anything under `tests/js/`, including fixtures and mutation checks) or adding a keyboard case to the e2e suite; verifying keyboard, focus or popup-window behaviour in a real browser; or changing focus handling around the sole-trader signup popup (its launch, `focusin` classifier, per-role controller, settle, or the "select a different sole trader" link) or the company-search popover.
- [docs/custom-request-headers.md](docs/custom-request-headers.md): read before changing the Diagnostics custom request-header table (its save or read validation, refusal messages, value pattern, browser tick, or any data patch or migration for it), or any custom header the plugin sends to the Two API, from PHP or from the browser.
- [docs/admin-settings-fail-loud.md](docs/admin-settings-fail-loud.md): read before adding or changing any gateway setting (its `validate_<field>_field()`, save, admin error notice or read path); touching surcharge and fee quoting (the quote helper, its timeout, caching, currency check or failure logging), the merchant fee-rates read, or how fee rates are displayed in the admin or on the chips; changing the availability gate that withholds Two (failed quote, unmet minimum, missing FX rate) or the buyer's "not available" copy; or changing what render-time, wc-ajax or admin-created-order paths do when a setting or quote fails.
- [docs/merchant-record-refresh.md](docs/merchant-record-refresh.md): read before changing how the merchant record is fetched, cached or refreshed (key or environment save, the nightly cron, the Diagnostics refresh, the cold-clock fetch on render and its 60-second bound) or anything derived from it (terms, due-in-days, platform minimum, surcharge cap, buyer countries, merchant country); the API-key check and its verdicts (`is_definitive_key_failure()`), including the settings-screen re-verify, the admin key-check script, the Merchant ID and key indicator, and saving the key; anything that withholds Two because a call failed or a surcharge input cannot be resolved; the term-set failure cause, the Payment Terms field message or the install health summary; or the payment-terms settings and their resolution (offered terms, terms type, custom day, `get_default_term()`, `default_payment_term` and its admin select, the fee-difference surcharge basis, the merchant default-term option row and its upgrade migration).
- [docs/tax-codes.md](docs/tax-codes.md): read before changing tax codes (`apply_tax_codes()`), the `tax_code_map` setting, its admin rows, `admin.js` JSON field, save or migration (`migrate_tax_code_map_to_rows()`), `zero_tax_rates()` or its memo; the line builder (`get_line_items()`) or any order create, edit, refund or intent payload built from it, or its payload tests and goldens; the `_<prefix>_tax_codes` order meta; or how the buyer VAT number is read and sent (`get_buyer_vat_number()`, its meta keys, refused list and `twoinc_buyer_vat_number` filter).
- [docs/readme-changelog.md](docs/readme-changelog.md): read before writing a `readme.txt` changelog or upgrade-notice entry, editing any `readme.txt` section, changing the release notes `release.yml` builds, or preparing a release.
- [docs/translations.md](docs/translations.md): read before adding, changing or deleting a translatable string or catalogue entry (including strings passed to `__()` as a variable), regenerating the `.pot`, editing any `languages/*.po` or `.mo`, or changing the catalogue check (`.github/scripts/check-catalogues.sh`).
- [docs/two-order-hook.md](docs/two-order-hook.md): read before working on the deprecated order-request hooks.
