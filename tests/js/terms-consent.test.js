/**
 * ABN-554. The terms consent is ONE implementation: `twoincTermsConsent` in
 * twoinc.js owns the state, the copy and the error paint, and both checkouts
 * call it — the classic form through `checkout_place_order` (asserted here)
 * and the Blocks tile through `onPaymentSetup` (asserted in
 * blocks-checkout-registration.test.js against the same accessors).
 */

"use strict";

const harness = require("./wc-harness");

const REFUSAL = "You must accept payment terms to place order.";
const GATEWAY_ID = "woocommerce-gateway-tillit";

/** The consent block as WC_Twoinc::get_terms_consent_html() renders it. */
function consentMarkup() {
  return [
    '<div class="twoinc-terms-consent">',
    '  <div class="twoinc-terms-row">',
    '    <input type="checkbox" id="twoinc_terms_accepted" name="twoinc_terms_accepted" value="1"',
    '           aria-labelledby="twoinc-terms-text" aria-required="true" />',
    '    <span class="twoinc-terms-text" id="twoinc-terms-text">I accept the terms.</span>',
    "  </div>",
    '  <div class="twoinc-terms-error hidden" role="alert">' + REFUSAL + "</div>",
    "</div>"
  ].join("\n");
}

describe("the shared terms consent", () => {
  let ctx;
  let consent;

  beforeEach(() => {
    ctx = harness.loadTwoinc({
      gateway_id: GATEWAY_ID,
      text: { terms_not_accepted: REFUSAL }
    });
    consent = ctx.termsConsent;
    document.body.innerHTML = consentMarkup();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  const tick = (checked) => {
    document.getElementById("twoinc_terms_accepted").checked = checked;
  };

  // [ticked, refusal the gate returns, carrier value, error box visible, description]
  test.each([
    [true, null, "1", false, "a ticked consent passes and travels as the carrier the server reads"],
    [false, REFUSAL, "", true, "an unticked consent is refused and says so on the tile"]
  ])("%s", (checked, refusal, carrier, errorShown, description) => {
    tick(checked);

    expect(consent.validate()).toBe(refusal);
    expect(consent.payload().twoinc_terms_accepted).toBe(carrier);
    expect(document.querySelector(".twoinc-terms-error").classList.contains("hidden")).toBe(
      !errorShown
    );
  });

  test("a brand rendering no consent has nothing to refuse", () => {
    document.body.innerHTML = "";

    expect(consent.validate()).toBeNull();
    expect(consent.payload()).toEqual({});
  });
});

describe("the classic checkout gate", () => {
  let ctx;

  /** The checkout form, with the gateway selected and the consent rendered. */
  function buildClassicCheckout(ticked) {
    document.body.innerHTML = [
      '<form name="checkout" class="checkout woocommerce-checkout">',
      '  <input type="radio" name="payment_method" value="' + GATEWAY_ID + '" checked />',
      consentMarkup(),
      // What `initialize()` looks the checkout page up by.
      '  <div id="order_review"></div>',
      "</form>"
    ].join("\n");
    document.getElementById("twoinc_terms_accepted").checked = ticked;
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  // WooCommerce aborts its own submit when a `checkout_place_order` handler
  // answers false; anything else lets the order through.
  test.each([
    [true, undefined, "a ticked consent lets the classic submit proceed"],
    [false, false, "an unticked consent aborts the classic submit"]
  ])("%s", (ticked, expected) => {
    ctx = harness.loadTwoinc({
      gateway_id: GATEWAY_ID,
      text: { terms_not_accepted: REFUSAL }
    });
    buildClassicCheckout(ticked);
    ctx.Twoinc.getInstance().initialize(false);

    const answer = ctx.$("form.checkout").triggerHandler("checkout_place_order");

    expect(answer === false).toBe(expected === false);
  });

  test("the tick survives the checkout update that re-renders the payment box", () => {
    ctx = harness.loadTwoinc({
      gateway_id: GATEWAY_ID,
      text: { terms_not_accepted: REFUSAL }
    });
    buildClassicCheckout(false);
    const instance = ctx.Twoinc.getInstance();
    instance.initialize(false);

    document.getElementById("twoinc_terms_accepted").checked = true;
    ctx.$('input[name="twoinc_terms_accepted"]').trigger("change");

    // What WooCommerce does to the payment box on every checkout update.
    buildClassicCheckout(false);
    instance.onUpdatedCheckout();

    expect(document.getElementById("twoinc_terms_accepted").checked).toBe(true);
  });

  test("ticking the box takes the refusal back off screen", () => {
    ctx = harness.loadTwoinc({
      gateway_id: GATEWAY_ID,
      text: { terms_not_accepted: REFUSAL }
    });
    buildClassicCheckout(false);
    ctx.Twoinc.getInstance().initialize(false);
    ctx.$("form.checkout").triggerHandler("checkout_place_order");

    document.getElementById("twoinc_terms_accepted").checked = true;
    ctx.$('input[name="twoinc_terms_accepted"]').trigger("change");

    expect(document.querySelector(".twoinc-terms-error").classList.contains("hidden")).toBe(true);
  });
});

/**
 * ABN-554. jsdom lays nothing out, so this reads the shipped stylesheet rather
 * than a computed value, the same way the tile row-spacing test does.
 */
describe("the consent's sizing", () => {
  const fs = require("fs");
  const path = require("path");

  const STYLESHEET = fs.readFileSync(
    path.join(__dirname, "..", "..", "assets", "css", "twoinc.css"),
    "utf8"
  );

  const ruleBody = (selector) => {
    const match = STYLESHEET.match(
      new RegExp("(^|\\}|\\*/)\\s*" + selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([\\s\\S]*?)\\}")
    );

    if (!match) {
      throw new Error("no rule for " + selector);
    }

    return match[2];
  };

  test("the sentence is 11.2px on both checkouts, from the stylesheet both load", () => {
    expect(ruleBody(".twoinc-terms-text")).toMatch(/font-size:\s*11\.2px;/);
  });

  test("the classic block carries 5px of bottom padding", () => {
    expect(ruleBody("#payment .twoinc-terms-consent")).toMatch(/padding-bottom:\s*5px;/);
  });

  test("that padding never reaches the Blocks tile, which shares the class", () => {
    expect(ruleBody(".twoinc-terms-consent")).not.toMatch(/padding-bottom/);
    expect(
      fs.readFileSync(
        path.join(__dirname, "..", "..", "assets", "css", "blocks-checkout.css"),
        "utf8"
      )
    ).not.toMatch(/padding-bottom/);
  });
});
