/**
 * TWO-40. The hosted sole-trader signup opens in a real popup window, at a
 * width the hosted flow's own layout does not clip.
 *
 * Only the first test pins the change that added this file — the width was
 * 610 and the flow clipped. The rest cover properties that were already true
 * and had no test at all: they are here because they are the properties most
 * likely to be broken by someone editing this function for an unrelated
 * reason. The popup has to stay a `window.open()` call made synchronously
 * from the click that triggered it (the hosted flow only works in a real
 * window, and a browser only honours a popup still inside a user gesture),
 * and the URL has to stay the one the server built, because that URL is how
 * an overlay brand reaches its own hosted flow.
 */

"use strict";

const harness = require("./wc-harness");

/** Minimum width the hosted signup flow renders without clipping. */
const MIN_WIDTH = 700;

/** Parse a window.open feature string into a plain object. */
function parseFeatures(features) {
  const parsed = {};
  String(features)
    .split(",")
    .forEach(function (pair) {
      const bits = pair.split("=");
      parsed[bits[0].trim()] = (bits[1] || "").trim();
    });
  return parsed;
}

describe("sole-trader signup popup", () => {
  let ctx;
  let soleTrader;
  let opened;
  let originalOpen;

  beforeEach(() => {
    ctx = harness.loadTwoinc({
      supported_buyer_countries: ["GB"],
      enable_company_search: "yes",
      text: {}
    });
    harness.buildCheckoutForm({ country: "GB" });
    soleTrader = ctx.soleTrader;
    soleTrader.tokens = {
      signup_url: "https://checkout.example.test/soletrader/signup",
      delegation_token: "delegation-token",
      autofill_token: "autofill-token"
    };
    opened = [];
    originalOpen = global.window.open;
    global.window.open = function (url, target, features) {
      opened.push({ url: url, target: target, features: features });
      return { closed: false };
    };
  });

  afterEach(() => {
    global.window.open = originalOpen;
    harness.releaseWidgets(ctx.$);
    document.body.innerHTML = "";
  });

  test("opens at least 700 wide", () => {
    soleTrader.openPopup();

    expect(opened).toHaveLength(1);
    const features = parseFeatures(opened[0].features);
    expect(Number(features.width)).toBeGreaterThanOrEqual(MIN_WIDTH);
    expect(Number(features.height)).toBeGreaterThan(0);
  });

  test("is a real popup window, not an iframe overlay", () => {
    soleTrader.openPopup();

    expect(opened).toHaveLength(1);
    // A feature string at all is what makes this a popup rather than a tab,
    // and no iframe may be created as a side effect.
    expect(opened[0].features).toBeTruthy();
    expect(document.querySelectorAll("iframe")).toHaveLength(0);
  });

  test("carries both delegated-authority tokens on the signup URL", () => {
    soleTrader.openPopup();

    // Pins the popup to the server-built signup_url: the brand reaches the
    // hosted flow through that host, so a client-side rewrite would silently
    // send an overlay buyer to the wrong brand.
    const url = new URL(opened[0].url);
    expect(url.origin + url.pathname).toBe("https://checkout.example.test/soletrader/signup");
    expect(url.searchParams.get("businessToken")).toBe("delegation-token");
    expect(url.searchParams.get("autofillToken")).toBe("autofill-token");
  });

  test("does nothing without minted tokens", () => {
    soleTrader.tokens = null;

    expect(soleTrader.openPopup()).toBeNull();
    expect(opened).toHaveLength(0);
  });
});
