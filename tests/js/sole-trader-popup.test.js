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

  /**
   * "Select a different sole trader" (TWO-40, guide §7).
   *
   * A buyer who already has a sole trader adopted had no way to swap it: the
   * only affordance was the registration prompt, and that is hidden precisely
   * when a company has been adopted. This is the control that fills that gap,
   * and it reaches the hosted flow's own picker via `autoselect=false`.
   *
   * The `render()`-then-assert shape matters. `render()` rebuilds the whole
   * container on every checkout AJAX refresh, so a control whose visibility is
   * only set on the adoption transition would vanish on the next refresh —
   * which is why the visibility is derived and why these tests drive it
   * through the real rendered DOM rather than calling the helper directly.
   */
  describe("the change-sole-trader control", () => {
    const SELECTOR = ".twoinc-sole-trader-change";

    /** Render the sole-trader UI into the container the payment tile ships. */
    function render() {
      ctx.$("<div>", { class: "twoinc-sole-trader-toggle" }).appendTo(document.body);
      soleTrader.render();
    }

    /** Put the checkout in the state a successful adoption leaves behind. */
    function adopt() {
      soleTrader.mode = "sole_trader";
      ctx.$("#company_id").val("TWO:ST:GB:0f8c2b1a");
      soleTrader.syncChangeOption();
    }

    beforeEach(() => {
      // render() reads these; without them the chips render as "undefined".
      global.window.twoinc.sole_trader = {
        availability_url: "/?wc-ajax=twoinc_sole_trader_availability",
        tokens_url: "/?wc-ajax=twoinc_sole_trader_tokens",
        nonce: "nonce",
        text: {
          registered_business: "Registered company",
          sole_trader: "Sole trader",
          popup_prompt: "Click here to login or sign up as a sole trader.",
          change_prompt: "Select a different sole trader",
          error: "Something went wrong"
        }
      };
    });

    // mode | company id | visible | description
    const visibility = [
      ["business", "", false, "no mode, no company"],
      ["business", "TWO:ST:GB:0f8c2b1a", false, "a company but not in sole-trader mode"],
      ["sole_trader", "", false, "sole-trader mode with nothing adopted yet"],
      ["sole_trader", "TWO:ST:GB:0f8c2b1a", true, "sole trader adopted"]
    ];

    test.each(visibility)("mode %s / company %s -> visible %s (%s)", (mode, companyId, visible) => {
      render();
      soleTrader.mode = mode;
      ctx.$("#company_id").val(companyId);

      soleTrader.syncChangeOption();

      expect(ctx.$(SELECTOR).hasClass("hidden")).toBe(!visible);
    });

    test("survives the container being rebuilt by a checkout refresh", () => {
      render();
      adopt();

      // What WooCommerce's updated_checkout does: same container, rebuilt.
      soleTrader.render();

      expect(ctx.$(SELECTOR)).toHaveLength(1);
      expect(ctx.$(SELECTOR).hasClass("hidden")).toBe(false);
    });

    test("clicking it opens a popup that asks for the picker", () => {
      render();
      adopt();

      ctx.$(SELECTOR).trigger("click");

      expect(opened).toHaveLength(1);
      expect(new URL(opened[0].url).searchParams.get("autoselect")).toBe("false");
    });

    test("the registration prompt does not ask for the picker", () => {
      render();

      ctx.$(".twoinc-sole-trader-note__link").trigger("click");

      expect(opened).toHaveLength(1);
      expect(new URL(opened[0].url).searchParams.has("autoselect")).toBe(false);
    });

    test("opens the popup synchronously, inside the click", () => {
      render();
      adopt();

      // A browser only honours a popup still inside the user gesture, so the
      // window must exist by the time the handler returns — not a tick later.
      ctx.$(SELECTOR).trigger("click");
      expect(opened).toHaveLength(1);
    });

    test("Enter and Space activate it, like the sibling search-again control", () => {
      // Bound directly on the element for a live-diagnosed reason; a browser's
      // native activation of a focused <button> was observed not to fire here.
      [13, 32].forEach(function (which) {
        opened.length = 0;
        render();
        adopt();
        // Only one signup window is allowed open at a time, so the window the
        // previous iteration opened has to be gone before this one asks for
        // another — otherwise the second key is refused for the right reason
        // and this test reads as though it never activated.
        if (ctx.soleTrader.popupWindow) {
          ctx.soleTrader.popupWindow.closed = true;
        }

        const event = ctx.$.Event("keydown");
        event.which = which;
        ctx.$(SELECTOR).trigger(event);

        expect(opened).toHaveLength(1);
      });
    });

    test("is a real button, so it is reachable by keyboard at all", () => {
      render();
      adopt();

      const node = ctx.$(SELECTOR).get(0);
      expect(node.tagName).toBe("BUTTON");
      // type=button: inside WooCommerce's checkout <form>, a default-type
      // button submits the order.
      expect(node.getAttribute("type")).toBe("button");
      expect(ctx.$(SELECTOR).text()).toBe("Select a different sole trader");
    });
  });
});
