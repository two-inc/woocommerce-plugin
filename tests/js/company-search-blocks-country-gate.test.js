/**
 * The per-country gates on a Blocks checkout (ABN-585).
 *
 * The skin owns no gate of its own — it mounts the classic controller onto
 * Blocks' own company row — so this runs the real skin over the real
 * controller and asserts what the buyer is left holding. On a country no mode
 * can answer, Blocks' own company input must be handed back untouched: it is
 * the field the store serialises onto the order.
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

/** Blocks' own company rows, the mount points `mount()` re-anchors the control onto. */
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

/**
 * twoinc.js declares its controller with `let`, which a browser leaves as a
 * global lexical binding every later script can read. An eval's bindings are
 * private to that eval, so the harness hands them back instead and they go on
 * the window here — the same objects, reachable the same way.
 */
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

describe("the company-search country gate on a Blocks checkout", () => {
  let ctx;
  let ajax;

  beforeEach(() => {
    ctx = harness.loadTwoinc();
    buildBlocksCheckout();
    installBlocksGlobals("JP");
    publishController(ctx);
    ajax = harness.stubAjax(ctx.$);
    // Indirect eval, as the skin's own <script> tag evaluates it: its free
    // references to the controller resolve to twoinc.js's global bindings.
    (0, eval)(SKIN);
  });

  afterEach(() => {
    ajax.restore();
    harness.releasePanel(ctx.helper);
    ["wc", "wp", "twoincBlocksName"]
      .concat(CONTROLLER_GLOBALS)
      .forEach((key) => delete window[key]);
    document.body.innerHTML = "";
  });

  function settleRegistry(countries) {
    ajax.calls
      .find((call) => call.url === harness.API_PROXY.supported_countries_url)
      .succeed({ supported_countries: countries });
  }

  function companyInput() {
    return document.getElementById("billing-company");
  }

  test.each([
    {
      registry: ["JP"],
      mounted: true,
      description: "a covered country mounts the control on Blocks' own row"
    },
    {
      registry: ["GB"],
      mounted: false,
      description: "an uncovered country hands that row back as a plain input"
    }
  ])("$description", ({ registry, mounted }) => {
    settleRegistry(registry);

    expect(ctx.helper.panel.isBound()).toBe(mounted);
    expect(!!companyInput().closest("." + ctx.helper.fieldWrapClass)).toBe(mounted);
    expect(companyInput().getAttribute("role")).toBe(mounted ? "combobox" : null);
    expect(!!document.querySelector(".two-company-dropdown")).toBe(mounted);
  });

  test("the chips go with the popover, so no dead Sole trader route is offered", () => {
    settleRegistry(["GB"]);

    expect(document.querySelectorAll(".two-company-mode-chip").length).toBe(0);
  });

  test("the capture mode stays on search — the control went, the mode did not", () => {
    settleRegistry(["GB"]);

    expect(ctx.capture.mode).toBe("search");
  });

  test("a merchant that does not sell to the country withdraws it too", () => {
    ctx.twoinc.supported_buyer_countries = ["GB"];

    settleRegistry(["JP"]);

    expect(ctx.helper.panel.isBound()).toBe(false);
    expect(companyInput().getAttribute("role")).toBeNull();
  });
});
