"use strict";

/**
 * TWO-25326 / #486: switching payment method TO the Two gateway, from a
 * different gateway checked by default, must re-decide field visibility —
 * not just relocate whatever `toggleBusinessFields()` already decided at
 * page load.
 *
 * Original live bug (Doug, 2026-08-04): with "Enable Company Search In
 * Address Entry" unchecked (`company_search_location: 'payment_tile'`), the
 * search control never appeared in the payment tile at all. Root cause:
 * `onUpdatedCheckout()` calls `syncCompanySearchTileLocation()` directly on
 * every `updated_checkout`, but nothing reliably called
 * `toggleBusinessFields()` when the buyer SWITCHED to this gateway from a
 * different one — WooCommerce checks the first available gateway by
 * default, so this is the ordinary case, not an edge one.
 *
 * #486 correction (Doug, 2026-08-19): `toggleBusinessFields()` itself used
 * to gate `#billing_company_display_field`'s own visibility on
 * `isTwoincSelected` — a leftover from the removed
 * `enable_company_search_for_others` admin setting (TWO-25326). That made a
 * buyer Two itself rejects (e.g. an email resolving to a different
 * business) fall through to the plain manual field the moment Two stopped
 * being the selected/eligible method, silently downgrading a
 * registered-company or sole-trader buyer into manual-entry territory they
 * never asked for. The search-vs-plain decision is payment-method-agnostic
 * now — driven solely by the buyer's own capture mode — so relocation into the
 * tile happens once at bootstrap and no longer depends on the buyer ever
 * switching gateways. What switching TO Two still must re-decide is the
 * genuinely Two-only fields (invoice email, PO number, project,
 * department) — this suite now proves the payment-method listener still
 * fires `toggleBusinessFields()` via one of those instead.
 *
 * This suite drives the real bootstrap IIFE (the trailing
 * `jQuery(function () { ... })` block) rather than the helper methods
 * directly, because that block is what wires (or fails to wire) the
 * payment-method listener in the first place; `wc-harness.js` deliberately
 * loads with `window.twoinc` ABSENT so that block no-ops (see its own doc
 * comment), which is why no other suite caught the original bug.
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SOURCE_PATH = "assets/js/twoinc.js";

const GATEWAY_ID = "woocommerce-gateway-tillit";
const OTHER_GATEWAY_ID = "cod";

/**
 * @returns {Function} the jQuery instance bound to the current jsdom window
 */
function installJQuery() {
  const jQuery = require("jquery");
  global.$ = jQuery;
  global.jQuery = jQuery;
  global.window.$ = jQuery;
  global.window.jQuery = jQuery;
  require("selectwoo/dist/js/selectWoo.full.js")(global.window, jQuery);
  return jQuery;
}

/** @returns {void} */
function installWcParams() {
  const params = {
    i18n_input_too_short_1: "Please enter 1 or more characters",
    i18n_input_too_short_n: "Please enter %qty% or more characters",
    i18n_no_matches: "No matches found",
    i18n_searching: "Searching…"
  };
  global.wc_country_select_params = params;
  global.window.wc_country_select_params = params;
}

/**
 * Classic-checkout markup with a DIFFERENT gateway (`cod`) checked by
 * default and the Two gateway present but unchecked, its payment box
 * carrying the empty, hidden tile slot `get_pay_box_description()` renders.
 *
 * @returns {void}
 */
function buildCheckoutForm() {
  document.body.innerHTML = [
    '<form name="checkout" class="checkout woocommerce-checkout">',
    '  <p id="billing_country_field">',
    '    <select id="billing_country" name="billing_country">',
    '      <option value="GB" selected>UK</option>',
    "    </select>",
    "  </p>",
    '  <p id="billing_company_display_field" class="billing_company_selectwoo form-row-wide hidden">',
    '    <select id="billing_company_display" name="billing_company_display">' +
      '<option value="">&nbsp;</option>' +
      "</select>",
    "  </p>",
    '  <p id="billing_company_field">',
    '    <label for="billing_company">Company name</label>',
    '    <span class="woocommerce-input-wrapper">',
    "      <input type='text' id='billing_company' name='billing_company' value='' />",
    "    </span>",
    "  </p>",
    '  <p id="company_id_field" class="hidden">',
    "    <input type='text' id='company_id' name='company_id' value='' />",
    "  </p>",
    '  <p id="invoice_email_field" class="hidden">',
    "    <input type='email' id='invoice_email' name='invoice_email' value='' />",
    "  </p>",
    '  <div id="order_review"></div>',
    '  <div id="payment" class="woocommerce-checkout-payment">',
    '    <ul class="wc_payment_methods payment_methods methods">',
    '      <li class="wc_payment_method payment_method_' + OTHER_GATEWAY_ID + '">',
    '        <input type="radio" id="payment_method_' +
      OTHER_GATEWAY_ID +
      '" name="payment_method" value="' +
      OTHER_GATEWAY_ID +
      '" checked />',
    "      </li>",
    '      <li class="wc_payment_method payment_method_' + GATEWAY_ID + '">',
    '        <input type="radio" id="payment_method_' +
      GATEWAY_ID +
      '" name="payment_method" value="' +
      GATEWAY_ID +
      '" />',
    '        <div class="payment_box payment_method_' + GATEWAY_ID + '">',
    '          <div class="twoinc-company-search-tile-slot hidden"></div>',
    "        </div>",
    "      </li>",
    "    </ul>",
    "  </div>",
    "</form>"
  ].join("\n");
}

/**
 * Evaluate the plugin source with `window.twoinc` already installed, so the
 * trailing bootstrap IIFE actually runs (mirrors `wc-harness.js`'s
 * `loadPluginSource`, but deliberately WITHOUT its "load first, install
 * `window.twoinc` after" ordering — see this file's own doc comment for why
 * that ordering is exactly what this suite must not use).
 *
 * @returns {void}
 */
function loadPluginSourceWithBootstrap() {
  const src = fs.readFileSync(path.join(REPO_ROOT, SOURCE_PATH), "utf8");
  const indirectEval = eval;
  indirectEval(src);
}

describe("payment-method switch onto the Two gateway (TWO-25326 / #486)", () => {
  test("the search control is already in the payment tile before any switch, and switching TO Two reveals the Two-only fields", async () => {
    buildCheckoutForm();
    installJQuery();
    installWcParams();

    global.window.twoinc = {
      gateway_id: GATEWAY_ID,
      enable_company_search: "yes",
      company_search_location: "payment_tile",
      enable_order_intent: "yes",
      enable_address_lookup: "no",
      supported_buyer_countries: ["GB"],
      twoinc_checkout_host: "https://api.example.test",
      client_name: "woocommerce",
      client_version: "0.0.0-test",
      text: {}
    };
    global.twoinc = global.window.twoinc;

    loadPluginSourceWithBootstrap();

    // Let the deferred jQuery-ready bootstrap actually run: jsdom/jQuery
    // defer it at least a tick even when `document.readyState` is already
    // 'complete' by the time this test body runs.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const $ = global.window.jQuery;

    // #486: the search control's own visibility no longer depends on which
    // gateway is selected, so bootstrap already shows and relocates it into
    // the payment tile with the OTHER gateway checked — the fix under test.
    expect($("#billing_company_display_field").hasClass("hidden")).toBe(false);
    expect(
      $("#billing_company_display_field").closest(".twoinc-company-search-tile-slot").length
    ).toBe(1);
    expect($(".twoinc-company-search-tile-slot").hasClass("hidden")).toBe(false);

    // Sanity check on the fixture itself: the Two-only fields start hidden
    // with the OTHER gateway selected. If this assertion starts failing,
    // the bug below is no longer isolated to the switch.
    expect($("#invoice_email_field").hasClass("hidden")).toBe(true);

    // The buyer switches to the Two gateway.
    $("#payment_method_" + GATEWAY_ID)
      .prop("checked", true)
      .trigger("change");

    // Proves the payment-method listener still re-invokes
    // `toggleBusinessFields()` on switch — the original TWO-25326 wiring
    // bug this suite guards against.
    expect($("#invoice_email_field").hasClass("hidden")).toBe(false);
  });
});
