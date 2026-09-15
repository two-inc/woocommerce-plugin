/**
 * The Sole trader mode chip on a Blocks checkout (TWO-25776).
 *
 * Availability is a per-country server answer, and the controller only asks
 * for it where its own note host exists. Neither classic host is in this DOM,
 * so this runs the real skin over the real controller and asserts the chip
 * each address form is left offering.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const harness = require("./wc-harness");

const SKIN = fs.readFileSync(
  path.join(__dirname, "..", "..", "assets", "js", "blocks-checkout.js"),
  "utf8"
);

const METHOD_DATA = { title: "Business invoice", supports: ["products"] };

const SOLE_TRADER_CONFIG = {
  availability_url: "/?wc-ajax=two_sole_trader_availability",
  tokens_url: "/?wc-ajax=two_sole_trader_tokens",
  csrf_token: "csrf-token",
  text: {
    registered_business: "Registered company",
    sole_trader: "Sole trader",
    popup_prompt: "Click here to login or sign up as a sole trader.",
    select_different: "Select a different sole trader",
    error: "Something went wrong"
  }
};

/** Blocks' own company rows, and no host for the sole-trader note anywhere. */
function buildBlocksCheckout() {
  document.body.innerHTML = [
    '<div class="wp-block-woocommerce-checkout">',
    '  <div class="wc-block-components-text-input">',
    '    <input type="text" id="billing-company" name="billing-company" />',
    "  </div>",
    '  <div class="wc-block-components-text-input">',
    '    <input type="text" id="shipping-company" name="shipping-company" />',
    "  </div>",
    "</div>"
  ].join("\n");
}

const ADDRESS_KEYS = [
  "first_name",
  "last_name",
  "company",
  "address_1",
  "address_2",
  "city",
  "state",
  "postcode",
  "country",
  "phone",
  "email"
];

function address(country) {
  const values = {};
  ADDRESS_KEYS.forEach((key) => {
    values[key] = "";
  });
  values.country = country;
  return values;
}

/** The Blocks globals the skin reads, reduced to what `bootstrap()` touches. */
function installBlocksGlobals(country) {
  const customer = { billingAddress: address(country), shippingAddress: address(country) };
  window.wc = {
    wcBlocksRegistry: { registerPaymentMethod() {} },
    wcSettings: {
      getSetting: (key) => (key === "woocommerce-gateway-tillit_data" ? METHOD_DATA : null)
    },
    blocksCheckout: { extensionCartUpdate: () => Promise.resolve() }
  };
  window.wp = {
    element: { createElement: () => null, useEffect: () => {} },
    htmlEntities: { decodeEntities: (value) => value },
    data: {
      select: (store) =>
        store === "wc/store/payment"
          ? { getActivePaymentMethod: () => null }
          : {
              getCartData: () => ({}),
              getCustomerData: () => customer,
              getCartTotals: () => ({
                total_price: "38600",
                total_tax: "0",
                currency_minor_unit: 2
              }),
              hasFinishedResolution: (selector) => selector === "getCartData"
            },
      dispatch: () => ({ setBillingAddress() {}, setShippingAddress() {} }),
      subscribe: () => {}
    }
  };
  window.twoincBlocksName = "woocommerce-gateway-tillit";
}

/** twoinc.js's `let` bindings, which a browser leaves readable to the skin. */
const CONTROLLER_GLOBALS = [
  "twoincSelectWooHelper",
  "twoincSelectWooHelperShipping",
  "twoincCompanySearchControls",
  "twoincCompanyCapture",
  "twoincAddressRoles",
  "twoincDomHelper",
  "Twoinc"
];

function publishController(ctx) {
  window.twoincSelectWooHelper = ctx.helper;
  window.twoincSelectWooHelperShipping = ctx.shippingHelper;
  window.twoincCompanySearchControls = ctx.controls;
  window.twoincCompanyCapture = ctx.capture;
  window.twoincAddressRoles = ctx.roles;
  window.twoincDomHelper = ctx.dom;
  window.Twoinc = ctx.Twoinc;
}

describe("the Sole trader mode chip on a Blocks checkout", () => {
  let ctx;
  let ajax;

  beforeEach(() => {
    ctx = harness.loadTwoinc({
      enable_order_intent: "no",
      enable_address_lookup: "no",
      sole_trader: SOLE_TRADER_CONFIG
    });
    window.sessionStorage.clear();
    buildBlocksCheckout();
    installBlocksGlobals("GB");
    publishController(ctx);
    ajax = harness.stubAjax(ctx.$);
    // Indirect eval, as the skin's own <script> tag evaluates it.
    (0, eval)(SKIN);
  });

  afterEach(() => {
    ctx.controls.forEach((search) => {
      search.soleTrader.unbindPopupMessageListener();
      search.soleTrader.unbindFocusinListener();
      search.soleTrader.stopAllPopupWatchers();
      search.soleTrader.stopTokenRefresh();
    });
    ajax.restore();
    harness.releasePanel(ctx.helper);
    harness.releasePanel(ctx.shippingHelper);
    ["wc", "wp", "twoincBlocksName"]
      .concat(CONTROLLER_GLOBALS)
      .forEach((key) => delete window[key]);
    document.body.innerHTML = "";
  });

  function settleRegistry(countries) {
    ajax.calls
      .filter((call) => call.url === harness.API_PROXY.supported_countries_url)
      .forEach((call) => call.succeed({ supported_countries: countries }));
  }

  /** Every role asks for its own answer, so every pending request is settled. */
  function settleAvailability(available) {
    const asked = ajax.calls.filter(
      (call) => call.url === SOLE_TRADER_CONFIG.availability_url && !call.settled
    );
    asked.forEach((call) => call.succeed({ success: true, data: { available: available } }));
    return asked.length;
  }

  function chip(role, mode) {
    const input = document.getElementById(role + "-company");
    const wrap = input && input.closest("." + ctx.helper.fieldWrapClass);
    return wrap && wrap.querySelector('[data-two-chip="' + mode + '"]');
  }

  test.each([
    {
      role: "billing",
      available: true,
      offered: true,
      description: "the invoice form offers Sole trader where the country supports it"
    },
    {
      role: "shipping",
      available: true,
      offered: true,
      description: "the delivery form offers Sole trader where the country supports it"
    },
    {
      role: "billing",
      available: false,
      offered: false,
      description: "a country without sole traders withholds the chip on the invoice form"
    },
    {
      role: "shipping",
      available: false,
      offered: false,
      description: "a country without sole traders withholds the chip on the delivery form"
    }
  ])("$description", ({ role, available, offered, description }) => {
    settleRegistry(["GB"]);

    const asked = settleAvailability(available);
    expect(`${asked} roles asked — ${description}`).toBe(`2 roles asked — ${description}`);

    const search = ctx.controls.find((control) => control.role === role);
    expect(`${search.isChipVisible("soletrader")} — ${description}`).toBe(
      `${offered} — ${description}`
    );
    expect(`${!chip(role, "soletrader").classList.contains("two-hidden")} — ${description}`).toBe(
      `${offered} — ${description}`
    );
  });
});
