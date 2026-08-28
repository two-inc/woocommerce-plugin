/**
 * TWO-25289. Browser-JS-in-Jest harness for the WooCommerce plugin's ADMIN
 * script, `assets/js/admin.js`.
 *
 * Sibling of wc-harness.js, which does the same job for the storefront script.
 * Kept separate rather than parameterised because the two files need entirely
 * different worlds: the storefront one needs the company-search panel and a
 * checkout form,
 * this one needs the gateway settings page and the `twoinc_admin` localisation
 * object, and nothing needs both.
 *
 * `admin.js` is a plain classic script wrapped in a single
 * `jQuery(function ($) { ... })`. The grid behaviour under test is set up by
 * that bootstrap and driven by real `change` events on real checkboxes,
 * exactly as it is in the browser. Nothing is mocked and no production code
 * was refactored to make it testable.
 *
 * `loadAdmin` is ASYNC, and that is load-bearing rather than stylistic. When
 * the document is already complete — which it is under jsdom the moment the
 * source is evaluated — jQuery does NOT run a ready callback synchronously; it
 * defers it with `window.setTimeout( jQuery.ready )`. So a synchronous harness
 * returns before `admin.js` has bound a single handler, every `.trigger()` the
 * test fires goes nowhere, and the SERVER-rendered rows are left untouched in
 * the DOM — which is precisely what a test asserting "the rebuilt row still
 * holds its stored value" wants to see. Six tests passed that way before this
 * was caught. So `loadAdmin` drains the ready queue and `assertBootstrapped`
 * refuses to hand back a page the bootstrap never touched, making the failure
 * mode a loud error rather than a green suite.
 *
 * Two load-time dependencies are deliberately left unsatisfied, because the
 * source guards both and the guards are what keeps this harness small:
 *   - `wp.media` is referenced only inside a click handler, never at load.
 *   - the inline-fee AJAX returns early unless the term container carries
 *     `data-fees`, and the API-key check returns early unless the key field
 *     holds a value. Neither is set, so no network call is ever attempted —
 *     UNLESS `options.apiKey` is passed (see buildSettingsPage), which opts a
 *     test into the API-key markup and value on purpose.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const SOURCE_PATH = "assets/js/admin.js";

const GATEWAY_ID = "woocommerce-gateway-tillit";

const FIELD_PREFIX = "woocommerce_" + GATEWAY_ID + "_";

/**
 * Put the real jQuery on the jsdom window.
 *
 * jquery's UMD head keys on `global.document` — present under
 * jest-environment-jsdom — and calls its factory with `noGlobal = true`, so it
 * deliberately does NOT assign window.$ / window.jQuery itself. The four
 * assignments below are therefore load-bearing: `admin.js` opens with a free
 * `jQuery(...)` reference that would otherwise resolve to nothing.
 *
 * @returns {Function} the jQuery instance bound to the current jsdom window
 */
function installJQuery() {
  const jQuery = require("jquery");
  global.$ = jQuery;
  global.jQuery = jQuery;
  global.window.$ = jQuery;
  global.window.jQuery = jQuery;
  return jQuery;
}

/**
 * The subset of the gateway settings page the payment-terms + surcharge-grid
 * code reads, in the same shape the PHP renderers emit.
 *
 * The grid markup is the template CONTRACT the JS builds against:
 * `<tr data-days>` rows whose inputs are named
 * `<field_key>[<days>][fixed|percentage|limit]` and whose cells carry
 * `twoinc-col-*` classes. It mirrors generate_two_surcharge_grid_html(),
 * including the detail this test exists for: the server renderer emits a
 * stored cap with isset(), so a stored 0 renders as `value="0"`.
 *
 * @param {Object} options
 * @param {number[]} options.terms preset term checkboxes to render
 * @param {number[]} options.checked which of those start ticked
 * @param {Object} options.stored the stored grid, keyed by term days
 * @param {string} options.type stored surcharge_type
 * @param {number|string} options.customDays stored payment_terms_custom_days value
 * @returns {void}
 */
function buildSettingsPage(options) {
  const opts = options || {};
  const terms = opts.terms || [14, 30, 60, 90];
  const checked = opts.checked || [];
  const stored = opts.stored || {};
  const type = opts.type || "percentage";
  const gridKey = FIELD_PREFIX + "surcharge_grid";

  const checkboxes = terms
    .map(function (days) {
      return (
        '<label><input type="checkbox" class="twoinc-term-checkbox"' +
        ' name="' +
        FIELD_PREFIX +
        'payment_terms_days[]" value="' +
        days +
        '"' +
        (checked.indexOf(days) === -1 ? "" : " checked") +
        " /> " +
        days +
        " days<span class='twoinc-term-fee'></span></label>"
      );
    })
    .join("\n");

  // Only the ticked terms have a rendered row, exactly as the PHP foreach
  // over get_available_terms() produces.
  const rows = terms
    .filter(function (days) {
      return checked.indexOf(days) !== -1;
    })
    .map(function (days) {
      const row = stored[days] || {};
      const cell = function (col) {
        const raw = row[col];
        return (
          '<td class="twoinc-col-' +
          col +
          '"><input type="text" name="' +
          gridKey +
          "[" +
          days +
          "][" +
          col +
          ']" value="' +
          (raw === undefined || raw === null ? "" : String(raw)) +
          '" /></td>'
        );
      };
      return (
        '<tr data-days="' +
        days +
        '"><td>' +
        days +
        "</td>" +
        cell("fixed") +
        cell("percentage") +
        cell("limit") +
        "</tr>"
      );
    })
    .join("\n");

  // Mirrors generate_api_key_with_verification_html()'s markup — only built
  // when a test opts in via options.apiKey, so the default page stays free of
  // the API-key field and admin.js's page-load verifyApiKey() never fires for
  // suites that don't want it.
  const apiKeyBlock =
    opts.apiKey === undefined
      ? ""
      : "    <tr><td>" +
        '<input type="text" id="' +
        FIELD_PREFIX +
        'api_key" value="' +
        opts.apiKey +
        '" />' +
        '<span id="api-key-verification-icon" style="display:none">' +
        '<span id="api-key-valid" style="display:none"></span>' +
        '<span id="api-key-invalid" style="display:none"></span>' +
        '<span id="api-key-loading" style="display:none"></span>' +
        "</span>" +
        '<div id="twoinc-merchant-info" style="display:none">' +
        '<span id="twoinc-merchant-id"></span>' +
        '<span id="twoinc-merchant-short-name"></span>' +
        "</div>" +
        '<div id="twoinc-signup-prompt"></div>' +
        '<div id="twoinc-merchant-invalid-notice" style="display:none"></div>' +
        "</td></tr>";

  document.body.innerHTML = [
    '<form method="post">',
    '  <table class="form-table"><tbody>',
    apiKeyBlock,
    '    <tr><td><div class="twoinc-term-checkboxes">' + checkboxes + "</div></td></tr>",
    '    <tr><td><input type="text" id="' +
      FIELD_PREFIX +
      'payment_terms_custom_days" value="' +
      (opts.customDays === undefined ? "" : opts.customDays) +
      '" /></td></tr>',
    '    <tr><td><select id="' + FIELD_PREFIX + 'default_payment_term"></select></td></tr>',
    '    <tr><td><select id="' + FIELD_PREFIX + 'surcharge_type">',
    ["none", "fixed", "percentage", "fixed_and_percentage"]
      .map(function (t) {
        return (
          '<option value="' + t + '"' + (t === type ? " selected" : "") + ">" + t + "</option>"
        );
      })
      .join(""),
    "    </select></td></tr>",
    '    <tr><td><select id="' + FIELD_PREFIX + 'surcharge_tax_treatment">',
    '      <option value="standard" selected>standard</option>',
    '      <option value="custom_class">custom_class</option>',
    "    </select></td></tr>",
    '    <tr><td><select id="' + FIELD_PREFIX + 'surcharge_tax_class"></select></td></tr>',
    '    <tr><td><select id="' + FIELD_PREFIX + 'surcharge_differential"></select></td></tr>',
    '    <tr><td><input type="text" id="' +
      FIELD_PREFIX +
      'surcharge_line_description" /></td></tr>',
    '    <tr><td><select id="' + FIELD_PREFIX + 'surcharge_rounding_basis">',
    '      <option value="none" selected>none</option>',
    '      <option value="up">up</option>',
    '      <option value="down">down</option>',
    '      <option value="standard">standard</option>',
    "    </select></td></tr>",
    '    <tr><td><select id="' + FIELD_PREFIX + 'surcharge_rounding_step"></select></td></tr>',
    '    <tr class="twoinc-surcharge-grid-field"><td>',
    '      <p class="twoinc-surcharge-grid-empty" style="display:none"></p>',
    '      <table class="widefat twoinc-surcharge-grid" data-field-key="' + gridKey + '">',
    "        <thead><tr><th>Term</th>",
    '          <th class="twoinc-col-fixed">Fixed</th>',
    '          <th class="twoinc-col-percentage">Percentage</th>',
    '          <th class="twoinc-col-limit">Limit</th>',
    "        </tr></thead>",
    "        <tbody>" + rows + "</tbody>",
    "      </table>",
    "    </td></tr>",
    "  </tbody></table>",
    "</form>"
  ].join("\n");
}

/**
 * Evaluate `admin.js` the way a <script> tag would.
 *
 * Indirect eval keeps evaluation in global scope, so the file's free
 * references to `jQuery` and `twoinc_admin` resolve as they do in the browser.
 * The source exports nothing — everything it does happens as a side effect of
 * the jQuery-ready bootstrap running against the DOM already in place — so the
 * DOM, not a return value, is what the tests assert on.
 *
 * @returns {void}
 */
function loadAdminSource() {
  const src = fs.readFileSync(path.join(REPO_ROOT, SOURCE_PATH), "utf8");
  const indirectEval = eval;
  indirectEval(src);
}

/**
 * Fail loudly unless admin.js's jQuery-ready bootstrap has actually run.
 *
 * The "Default Payment Term" dropdown is rendered EMPTY by the page builder
 * above and is populated only by rebuildDefaultTerm(), which the bootstrap
 * calls on its last line. So a non-empty dropdown is proof the bootstrap
 * completed — including the handler binding the grid tests depend on — and an
 * empty one is proof it did not. Without this check a harness that returns too
 * early leaves the server-rendered DOM in place, which silently satisfies
 * exactly the assertions these tests make.
 *
 * @param {Function} $ jQuery
 * @returns {void}
 */
function isBootstrapped($) {
  return $("#" + FIELD_PREFIX + "default_payment_term option").length > 0;
}

function assertBootstrapped($) {
  if (!isBootstrapped($)) {
    throw new Error("admin-harness: admin.js bootstrap did not run");
  }
}

/**
 * Build the settings page, install the localisation object, run admin.js
 * against it, and wait for its jQuery-ready bootstrap to complete.
 *
 * @param {Object} [options] passed through to buildSettingsPage, plus
 *   `merchantTerms` for the backend-offered set admin.js intersects against,
 *   `apiKeyNotices` for the localized, brand-resolved API-key notice copy PHP
 *   normally supplies (omitted by default so the fallback path stays covered),
 *   and `stubAjax($)` — called right after jQuery is installed but before
 *   admin.js's ready callback can run, so a test can stub `$.ajax` ahead of
 *   the page-load `verifyApiKey()` call that fires when `options.apiKey` is
 *   set (see buildSettingsPage).
 * @returns {Promise<{$: Function, adminSettings: Object}>}
 */
async function loadAdmin(options) {
  const opts = options || {};
  const $ = installJQuery();
  if (typeof opts.stubAjax === "function") {
    opts.stubAjax($);
  }
  buildSettingsPage(opts);
  const adminSettings = {
    gateway_id: GATEWAY_ID,
    ajax_url: "https://example.test/wp-admin/admin-ajax.php",
    nonce: "test-nonce",
    days_label: "%s days",
    decimal_separator: ".",
    merchant_available_terms: opts.merchantTerms || [14, 30, 60, 90],
    surcharge_grid: opts.stored || {}
  };
  // Only set when a test opts in, so the default world keeps exercising
  // admin.js's brand-neutral fallback copy. WC_Twoinc::get_api_key_notices()
  // is what resolves the product name in production, so a test asserting the
  // brand reaches the notice supplies these the way that method would.
  if (opts.apiKeyNotices) {
    adminSettings.api_key_notices = opts.apiKeyNotices;
  }
  global.twoinc_admin = adminSettings;
  global.window.twoinc_admin = adminSettings;
  loadAdminSource();
  // Drain the ready queue. It takes MORE THAN ONE macrotask and the exact
  // number is jQuery's business, not ours: on an already-complete document
  // jQuery queues `window.setTimeout( jQuery.ready )`, that call resolves the
  // internal readyList Deferred, and the callback registered by `jQuery(fn)`
  // is attached with `readyList.then(fn)` — which a jQuery Deferred fires on a
  // further tick of its own. A single flush leaves the page untouched. So poll
  // for the observable end state rather than guessing a tick count, and let
  // assertBootstrapped turn a never-bootstrapped page into a loud failure.
  for (let tick = 0; tick < 10 && !isBootstrapped($); tick++) {
    await new Promise(function (resolve) {
      setTimeout(resolve, 0);
    });
  }
  assertBootstrapped($);
  return { $: $, adminSettings: adminSettings };
}

/**
 * The value of one grid cell's input, or null when the row is not rendered.
 *
 * @param {Function} $ jQuery
 * @param {number} days term days
 * @param {string} col fixed | percentage | limit
 * @returns {?string}
 */
function cellValue($, days, col) {
  const $row = $('.twoinc-surcharge-grid tbody tr[data-days="' + days + '"]');
  if ($row.length === 0) {
    return null;
  }
  return $row.find(".twoinc-col-" + col + " input").val();
}

/**
 * Untick then re-tick one term's checkbox, firing the real change events the
 * grid rebuild is bound to.
 *
 * @param {Function} $ jQuery
 * @param {number} days term days
 * @returns {void}
 */
function untickAndRetick($, days) {
  const $box = $('.twoinc-term-checkbox[value="' + days + '"]');
  $box.prop("checked", false).trigger("change");
  $box.prop("checked", true).trigger("change");
}

module.exports = {
  FIELD_PREFIX: FIELD_PREFIX,
  GATEWAY_ID: GATEWAY_ID,
  buildSettingsPage: buildSettingsPage,
  cellValue: cellValue,
  loadAdmin: loadAdmin,
  untickAndRetick: untickAndRetick
};
