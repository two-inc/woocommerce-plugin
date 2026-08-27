/**
 * TWO-25244. Browser-JS-in-Jest harness for the WooCommerce plugin.
 *
 * `assets/js/twoinc.js` is a plain classic script: it declares a handful of
 * top-level helper objects and a `Twoinc` class, and it is enqueued by
 * tillit-payment-gateway.php into a checkout page where jQuery, WooCommerce's
 * selectWoo widget and WooCommerce's own `wc_country_select_params` /
 * `window.twoinc` localisation globals already exist. There is nothing to
 * `require()` and nothing to import.
 *
 * So rather than mock the browser, this harness assembles the real one:
 *
 *   - jsdom (Jest's `testEnvironment`) supplies document/window,
 *   - the REAL jQuery is loaded onto that window,
 *   - the REAL company-search panel script is evaluated onto it too, exactly
 *     as its own `<script>` tag does, so the tests assert against the shipped
 *     popover rather than a stand-in for it,
 *   - `wc_country_select_params` and `window.twoinc` are small stubs, because
 *     they are `wp_localize_script` output with no npm distribution,
 *   - the plugin source is then evaluated in global scope, exactly as a
 *     `<script>` tag would evaluate it.
 *
 * NO production code was refactored to make this testable. The script loads
 * as-is.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const SOURCE_PATH = "assets/js/twoinc.js";

const PANEL_PATH = "assets/js/company-search-panel.js";

const STYLESHEET_PATH = "assets/css/twoinc.css";

/**
 * Put the real jQuery on the jsdom window.
 *
 * @returns {Function} the jQuery instance bound to the current jsdom window
 */
function installJQuery() {
  // jquery's UMD head keys on `global.document` — present under
  // jest-environment-jsdom — and calls its factory with `noGlobal = true`, so
  // it deliberately does NOT assign window.$ / window.jQuery itself. The four
  // assignments below are therefore load-bearing, not tidying: the plugin
  // source's free `jQuery` would otherwise resolve to nothing. Do not remove.
  const jQuery = require("jquery");
  global.$ = jQuery;
  global.jQuery = jQuery;
  global.window.$ = jQuery;
  global.window.jQuery = jQuery;
  return jQuery;
}

/**
 * Evaluate the vendored company-search panel the way its own `<script>` tag
 * does. Its UMD tail assigns `TwoCompanySearchPanel` onto `self`, which under
 * jsdom is the window — the same global twoinc.js reads it from.
 *
 * @returns {Function} the panel constructor
 */
function installCompanySearchPanel() {
  const src = fs.readFileSync(path.join(REPO_ROOT, PANEL_PATH), "utf8");
  const indirectEval = eval;
  indirectEval(src);
  if (typeof global.window.TwoCompanySearchPanel !== "function") {
    throw new Error("harness: company-search-panel.js did not register");
  }
  global.TwoCompanySearchPanel = global.window.TwoCompanySearchPanel;
  return global.window.TwoCompanySearchPanel;
}

/**
 * WooCommerce's `wc_country_select_params` localisation object, reduced to the
 * four strings the plugin's selectWoo `language` callbacks read.
 *
 * @returns {Object}
 */
function installWcParams() {
  const params = {
    i18n_input_too_short_1: "Please enter 1 or more characters",
    i18n_input_too_short_n: "Please enter %qty% or more characters",
    i18n_no_matches: "No matches found",
    i18n_searching: "Searching…"
  };
  global.wc_country_select_params = params;
  global.window.wc_country_select_params = params;
  return params;
}

/**
 * Evaluate the plugin source the way a <script> tag would, and hand back the
 * top-level bindings it declares.
 *
 * twoinc.js declares its helpers with `let` and never assigns them to
 * `window`. In a real browser those become global *lexical* bindings —
 * reachable as free variables from any later script, but absent from `window`.
 * Global `eval` reproduces exactly that: the bindings live in the eval's own
 * scope and never land on `window` either. So the expression appended below —
 * evaluated inside that same scope — is the only way to reach them, and it is
 * the same access pattern the browser gives a second `<script>` tag.
 *
 * `indirectEval` (rather than a direct `eval` call) keeps evaluation in global
 * scope, so `class Twoinc` and the file's free references to `jQuery` /
 * `wc_country_select_params` behave as they do in the browser.
 *
 * @returns {Object} the source's top-level helper objects and Twoinc class
 */
function loadPluginSource() {
  const src = fs.readFileSync(path.join(REPO_ROOT, SOURCE_PATH), "utf8");
  const indirectEval = eval;
  const exported = indirectEval(
    src +
      "\n;({ twoincUtilHelper, twoincAddressRoles, twoincAddressMirror," +
      " twoincCompanyCapture," +
      " twoincSelectWooHelper, twoincDomHelper," +
      " twoincTermChips, twoincSoleTrader, Twoinc });"
  );
  if (!exported || typeof exported.twoincSelectWooHelper !== "object") {
    throw new Error("harness: twoinc.js did not yield its top-level bindings");
  }
  return exported;
}

/**
 * Load twoinc.js with jQuery, the panel script and the WooCommerce globals in
 * place.
 *
 * Deliberately loaded with `window.twoinc` ABSENT. The file's trailing
 * `jQuery(function () { if (window.twoinc) { ... } })` bootstrap wires the
 * whole checkout — payment-method listeners, a 1s `setTimeout`, order-intent
 * init — and jsdom's document is already "ready", so jQuery would run it
 * immediately. Every test here is about the company-search helper, so the
 * bootstrap is left to no-op and `window.twoinc` is installed afterwards.
 *
 * @param {Object} [twoinc] value for `window.twoinc`, installed post-load
 * @returns {{helper: Object, util: Object, dom: Object, $: Function, twoinc: Object}}
 */
function loadTwoinc(twoinc) {
  const $ = installJQuery();
  installWcParams();
  installCompanySearchPanel();
  const exported = loadPluginSource();
  const settings = Object.assign(
    {
      gateway_id: "woocommerce-gateway-tillit",
      enable_company_search: "yes",
      // Emitted unconditionally by WC_Twoinc_Checkout, so every fixture has it.
      // `isCountrySupported()` reads it on every toggle, and a fixture without
      // it throws where production cannot.
      supported_buyer_countries: ["GB", "NO", "SE", "NL"],
      company_search_location: "address_area",
      twoinc_checkout_host: "https://api.example.test",
      client_name: "woocommerce",
      client_version: "0.0.0-test",
      text: {}
    },
    twoinc || {}
  );
  global.twoinc = settings;
  global.window.twoinc = settings;
  // Belt and braces. Every call re-evaluates the source and so yields a fresh
  // helper object, which is what actually keeps the sequence counter from
  // leaking between tests — and what the "advances once per search" test
  // asserts. This line is here so that memoising the eval later (2300 lines,
  // once per test) cannot silently turn that counter into shared state.
  exported.twoincSelectWooHelper.companySearchSeq = 0;
  return {
    helper: exported.twoincSelectWooHelper,
    util: exported.twoincUtilHelper,
    roles: exported.twoincAddressRoles,
    mirror: exported.twoincAddressMirror,
    capture: exported.twoincCompanyCapture,
    dom: exported.twoincDomHelper,
    termChips: exported.twoincTermChips,
    soleTrader: exported.twoincSoleTrader,
    // The Twoinc class itself, for the code paths that reach the singleton.
    // Safe to construct here: the constructor only initialises fields, and
    // every call re-evaluates the source, so the `instance` a test creates
    // cannot leak into the next one.
    Twoinc: exported.Twoinc,
    $: $,
    twoinc: settings
  };
}

/**
 * The three company rows as WooCommerce's own `woocommerce_form_field()`
 * renders the declarations in `WC_Twoinc_Checkout::add_company_fields()` —
 * `form-row` plus each field's declared classes, its `data-priority`, a label
 * carrying `span.optional` because all three declare `'required' => false`,
 * and core's `.woocommerce-input-wrapper` around the input alone.
 *
 * Built from the SERVER's declarations rather than copied off a rendered
 * checkout (TWO-25503): a rendered page shows the post-state, where the
 * plugin's own `toggleBusinessFields()` has already swapped `span.optional`
 * for `abbr.required` and stripped `hidden` — so a fixture taken from it bakes
 * in the very transitions the code under test is supposed to perform.
 *
 * One definition, shared: fixtures that each grew their own copy disagreed
 * about nesting, and a fixture that disagrees with the server cannot fail
 * honestly.
 *
 * KNOWN REMAINING GAP: the server also declares `hidden` on the search row and
 * on `company_id`, which `toggleBusinessFields()` is what clears. Seven tests
 * across four suites reach for those rows without running it first, so adding
 * it here is a change to the whole suite's starting state and is deliberately
 * held back from the regression fix this fixture rides in on. Four further
 * fixtures still build these rows themselves and want folding in here too.
 *
 * The country row alongside them carries `priority - 1`, which is what
 * `WC_Twoinc_Checkout` assigns `billing_country` relative to the company rows.
 *
 * `.woocommerce-input-wrapper` bounds the INPUT alone where the row's `<p>`
 * wraps label and input together, and the affordance links are appended into
 * it so they centre against the visible input box rather than the pair — a
 * fixture without it lets that regress to appending on the row itself, which
 * is the overlap-with-the-label bug, with nothing to signal the fallback.
 *
 * @param {Object} [options]
 * @param {string} [options.companyValue] value the search field starts with
 * @returns {string} the three rows as markup
 */
function companyRowsMarkup(options) {
  const opts = options || {};
  const companyValue = opts.companyValue === undefined ? "" : opts.companyValue;
  return [
    '  <p id="billing_company_display_field" class="form-row billing_company_search form-row-wide hidden" data-priority="30">',
    '    <label for="billing_company_display">Company name&nbsp;<span class="optional">(optional)</span></label>',
    '    <span class="woocommerce-input-wrapper">',
    '      <input type="text" id="billing_company_display" name="billing_company_display" autocomplete="off" value="' +
      companyValue +
      '" />',
    "    </span>",
    "  </p>",
    '  <p id="billing_company_field" class="form-row form-row-wide" data-priority="30">',
    '    <label for="billing_company">Company name&nbsp;<span class="optional">(optional)</span></label>',
    '    <span class="woocommerce-input-wrapper">',
    "      <input type='text' id='billing_company' name='billing_company' value='' />",
    "    </span>",
    "  </p>",
    '  <p id="company_id_field" class="form-row hidden" data-priority="31">',
    '    <label for="company_id">Company ID&nbsp;<span class="optional">(optional)</span></label>',
    '    <span class="woocommerce-input-wrapper">',
    "      <input type='text' id='company_id' name='company_id' value='' />",
    "    </span>",
    "  </p>"
  ].join("\n");
}

/**
 * The subset of the WooCommerce checkout form the company-search code reads.
 *
 * `#billing_company_display` is the input the panel anchors to;
 * `#billing_country` is where the search's country parameter comes from;
 * `#billing_company` is the real (hidden) company field.
 *
 * @param {Object} [options]
 * @param {string} [options.country] ISO code for the selected country option
 * @param {string} [options.companyValue] value the search field starts with
 * @returns {void}
 */
function buildCheckoutForm(options) {
  const opts = options || {};
  const country = opts.country || "GB";
  const companyValue = opts.companyValue;
  document.body.innerHTML = [
    // `name="checkout"` is what WooCommerce's own checkout form carries, and
    // it is the selector `saveCheckoutInputs()` looks the form up by. Without
    // it every test here silently exercised that function's no-form early
    // return instead of the snapshotting code (TWO-25288).
    '<form name="checkout" class="checkout woocommerce-checkout">',
    '  <div class="woocommerce-billing-fields">',
    '  <div class="woocommerce-billing-fields__field-wrapper">',
    '  <p id="billing_country_field" class="form-row address-field update_totals_on_change form-row-wide" data-priority="29">',
    '    <label for="billing_country">Country / Region&nbsp;<abbr class="required" title="required">*</abbr></label>',
    '    <span class="woocommerce-input-wrapper">',
    '      <select id="billing_country" name="billing_country">',
    '        <option value="' + country + '" selected>Selected country</option>',
    "      </select>",
    "    </span>",
    "  </p>",
    companyRowsMarkup({ companyValue: companyValue }),
    "  </div>",
    "  </div>",
    "</form>"
  ].join("\n");
}

/**
 * Bind the panel to whichever company-name field is current, and open it.
 *
 * Goes through the plugin's own `attach()` rather than constructing a panel
 * here: the transport, the chips and the mount selector are all wired there,
 * so a hand-built panel would exercise one the plugin never ships.
 *
 * @param {Function} $ jQuery instance
 * @param {Object} helper twoincSelectWooHelper
 * @returns {Object} the jQuery-wrapped company-name field
 */
function openCompanyPanel($, helper) {
  helper.attach();
  helper.openCompanySearchDropdown();
  return $(helper.companyFieldSelector());
}

/**
 * The panel's structure as the DOM actually holds it — what a structural
 * assertion compares against PrestaShop's.
 *
 * @param {Function} $ jQuery instance
 * @returns {{wrap: Element, panel: Element, children: Array<string>}|null}
 */
function panelStructure($) {
  const wrap = document.querySelector(".two-company-field-wrap");
  if (!wrap) return null;
  const panel = wrap.querySelector(":scope > .two-company-dropdown");
  if (!panel) return null;
  return {
    wrap: wrap,
    panel: panel,
    children: Array.prototype.map.call(panel.children, function (child) {
      return child.className;
    })
  };
}

/**
 * Read the text the panel is currently rendering in its results list.
 *
 * @param {Function} $ jQuery instance
 * @returns {string}
 */
function resultsText($) {
  return $(".two-company-dropdown__results").text();
}

/**
 * Replace `jQuery.ajax` with a recorder that hands each call's deferred back
 * so a test can settle them in whatever order it wants.
 *
 * Real network timing is the thing under test here — out-of-order responses,
 * aborts, timeouts — so driving the settlement explicitly is the point, not a
 * shortcut. The returned object is a real jQuery Deferred promise with an
 * `abort` bolted on, which is the jqXHR surface twoinc.js uses
 * (`.done`/`.fail`/`.always`); jQuery fires those callbacks synchronously, so
 * no test needs to await anything.
 *
 * @param {Function} $ jQuery instance
 * @returns {{calls: Array, last: Function, restore: Function}}
 */
function stubAjax($) {
  const original = $.ajax;
  const calls = [];
  $.ajax = function (settings) {
    const deferred = $.Deferred();
    const jqXHR = deferred.promise();
    const record = {
      settings: settings,
      url: settings && settings.url,
      timeout: settings && settings.timeout,
      aborted: false,
      // Whether `abort()` landed on a request that had NOT already settled —
      // which is the only case in which a real XHR is actually cancelled.
      // `aborted` alone flips even for an abort of a completed request, where
      // jQuery's own `abort()` is a no-op, so a test asserting `aborted` proves
      // only that the call was MADE. Assert this one to prove a live request was
      // dropped (review round 5).
      abortedWhilePending: false,
      settled: false,
      /** Resolve as HTTP 200 with `data`. */
      succeed: function (data) {
        record.settled = true;
        deferred.resolveWith(jqXHR, [data, "success", jqXHR]);
      },
      /**
       * Resolve as a failure. `textStatus` is jQuery's, so 'timeout',
       * 'error', 'parsererror' or 'abort'.
       *
       * `status: 0` on the jqXHR is not incidental: a jQuery timeout and
       * a cancellation are indistinguishable by status, which is the
       * whole reason the plugin cannot rely on select2's own failure
       * handler and keys off textStatus instead.
       */
      fail: function (textStatus, error) {
        record.settled = true;
        jqXHR.status = 0;
        deferred.rejectWith(jqXHR, [jqXHR, textStatus, error || textStatus]);
      }
    };
    jqXHR.abort = function () {
      record.aborted = true;
      // A real jqXHR's `abort()` does nothing once the request has settled — no
      // state change, no callback — so neither does this (review round 5).
      if (record.settled) return;
      record.abortedWhilePending = true;
      // jQuery reports an aborted request through the failure path with
      // textStatus 'abort', synchronously.
      record.fail("abort", "abort");
    };
    calls.push(record);
    return jqXHR;
  };
  return {
    calls: calls,
    last: function () {
      return calls[calls.length - 1];
    },
    restore: function () {
      $.ajax = original;
    }
  };
}

/**
 * Release the panel bound to the company field.
 *
 * The panel binds a document-level mousedown that wiping
 * `document.body.innerHTML` does not unbind, so an abandoned panel keeps
 * listening for the rest of the test file. Call this from `afterEach` BEFORE
 * clearing the DOM.
 *
 * @param {Object} helper twoincSelectWooHelper
 * @returns {void}
 */
function releasePanel(helper) {
  if (!helper || !helper.panel) return;
  helper.panel.destroy();
  helper.panel = null;
}

/**
 * Inject the plugin's real stylesheet into the jsdom document.
 *
 * Read from disk and inlined as a `<style>` element rather than linked: jsdom
 * does not fetch `<link rel=stylesheet>` hrefs, so a link would leave
 * `getComputedStyle` returning nothing. Inlining means the assertions run
 * against the same bytes the plugin ships.
 *
 * jsdom's cascade is real but partial. It resolves `background-image`,
 * `background-repeat` and `background-size`, so a rule's asset URL can be
 * asserted on. It does NOT resolve the multi-value `background-position`
 * shorthand — that reads back as an empty string whatever the stylesheet
 * says, so do not assert on it.
 *
 * Call once per test that needs computed style, after the DOM is built. The
 * element goes in `<head>`, so a test that clears `document.body` keeps it.
 *
 * @returns {HTMLStyleElement} the injected style element
 */
function injectStylesheet() {
  const css = fs.readFileSync(path.join(REPO_ROOT, STYLESHEET_PATH), "utf8");
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
  return style;
}

/**
 * Count the image frames in a GIF by walking its block structure.
 *
 * Counting raw 0x2C bytes across the whole file does not work: that value
 * occurs freely inside the colour tables and the LZW-compressed pixel data,
 * so a genuinely single-frame GIF reports plenty of "frames" and the
 * assertion catches nothing. The structure has to be walked so that only
 * bytes actually sitting in an image-descriptor position are counted.
 *
 * @param {Buffer} bytes the whole GIF file
 * @returns {number} the number of image descriptors in the stream
 */
function countGifFrames(bytes) {
  // Header (6) + logical screen descriptor (7).
  let at = 13;

  // Global colour table, when the descriptor's packed field says there is one.
  const packed = bytes[10];
  if (packed & 0x80) {
    at += 3 * Math.pow(2, (packed & 0x07) + 1);
  }

  // Data sub-blocks: a length byte, that many bytes, repeated until a
  // zero-length block terminates the sequence.
  const skipSubBlocks = function () {
    while (at < bytes.length) {
      const size = bytes[at];
      at += 1;
      if (size === 0) return;
      at += size;
    }
  };

  let frames = 0;

  while (at < bytes.length) {
    const block = bytes[at];
    at += 1;

    if (block === 0x3b) {
      // Trailer: end of stream.
      return frames;
    }

    if (block === 0x21) {
      // Extension: a label byte, then sub-blocks.
      at += 1;
      skipSubBlocks();
      continue;
    }

    if (block === 0x2c) {
      frames += 1;
      // Image descriptor: 4x2 bytes of geometry plus a packed field.
      const localPacked = bytes[at + 8];
      at += 9;
      if (localPacked & 0x80) {
        at += 3 * Math.pow(2, (localPacked & 0x07) + 1);
      }
      // LZW minimum code size, then the compressed data sub-blocks.
      at += 1;
      skipSubBlocks();
      continue;
    }

    // Anything else means the walk has lost sync with the stream; stop rather
    // than counting noise.
    break;
  }

  return frames;
}

module.exports = {
  REPO_ROOT: REPO_ROOT,
  countGifFrames: countGifFrames,
  SOURCE_PATH: SOURCE_PATH,
  STYLESHEET_PATH: STYLESHEET_PATH,
  injectStylesheet: injectStylesheet,
  loadTwoinc: loadTwoinc,
  buildCheckoutForm: buildCheckoutForm,
  companyRowsMarkup: companyRowsMarkup,
  openCompanyPanel: openCompanyPanel,
  panelStructure: panelStructure,
  resultsText: resultsText,
  stubAjax: stubAjax,
  releasePanel: releasePanel
};
