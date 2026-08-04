"use strict";

/**
 * TWO-25326: switching payment method TO the Two gateway, from a different
 * gateway checked by default, must re-decide company-field visibility — not
 * just relocate whatever `toggleBusinessFields()` already decided at page
 * load.
 *
 * Live bug (Doug, 2026-08-04): with "Enable Company Search In Address
 * Entry" unchecked (`company_search_location: 'payment_tile'`), the search
 * control never appeared in the payment tile at all. Root cause:
 * `onUpdatedCheckout()` calls `syncCompanySearchTileLocation()` directly on
 * every `updated_checkout`, but nothing reliably called
 * `toggleBusinessFields()` — the function that actually decides whether
 * `#billing_company_display_field` is shown — when the buyer SWITCHED to
 * this gateway from a different one. WooCommerce checks the first available
 * gateway by default, so this is the ordinary case, not an edge one. The
 * only rebind that existed lived inside `onUpdatedCheckout()` itself
 * (`jQuery('input[name="payment_method"]').on("change", ...)`, no matching
 * `.off()`), which is bound too late to catch the FIRST switch of a session
 * — nothing forces `updated_checkout` to have fired even once before a buyer
 * picks a payment method — and accumulates a duplicate on every cycle
 * besides. `syncCompanySearchTileLocation()`'s own "unhide only if a VISIBLE
 * child moved in" guard then correctly kept the tile slot hidden around a
 * still-hidden field, which is the exact symptom reported live.
 *
 * The fix moves this to a single namespaced, delegated binding in
 * `initialize()` — bound once, before the buyer's first click. This suite
 * drives the real bootstrap IIFE (the trailing `jQuery(function () { ... })`
 * block) rather than the helper methods directly, because that block is what
 * wires (or fails to wire) the payment-method listener in the first place;
 * `wc-harness.js` deliberately loads with `window.twoinc` ABSENT so that
 * block no-ops (see its own doc comment), which is why no other suite caught
 * this.
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

describe("payment-method switch onto the Two gateway (TWO-25326)", () => {
  test("the search control appears in the payment tile after switching TO Two from a different default gateway", async () => {
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

    // Sanity check on the fixture itself: at page load, with the OTHER
    // gateway selected and `company_search_location` "payment_tile" (i.e.
    // the checkbox unchecked), the search control is correctly absent for
    // this OTHER gateway — the "other payment methods" branch of
    // `toggleBusinessFields()` working as designed. If this assertion starts
    // failing, the bug below is no longer isolated to the switch.
    expect($("#billing_company_display_field").hasClass("hidden")).toBe(true);

    // The buyer switches to the Two gateway.
    $("#payment_method_" + GATEWAY_ID)
      .prop("checked", true)
      .trigger("change");

    expect($("#billing_company_display_field").hasClass("hidden")).toBe(false);
    expect(
      $("#billing_company_display_field").closest(".twoinc-company-search-tile-slot").length
    ).toBe(1);
    expect($(".twoinc-company-search-tile-slot").hasClass("hidden")).toBe(false);
  });
});
