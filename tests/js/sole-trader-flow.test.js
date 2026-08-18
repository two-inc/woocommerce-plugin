/**
 * TWO-40 §7 + §8. The sole-trader flow's UX affordances and its identity-trust
 * boundary.
 *
 *   §7 — an in-flight state wired to the REAL duration of the round trip (a
 *   count, not a boolean, not a timeout), a re-entrancy guard so one gesture
 *   cannot stack two signup popups, a "select a different sole trader" link in
 *   the same slot as the existing "search for company" one, and a popup that
 *   is wide enough for the hosted flow's own layout.
 *
 *   §8 — the passive, pre-authentication email match is correct only before
 *   the server has said who the buyer is. Reusing it on the post-OTP callback
 *   is a confirmed bug: the buyer completes signup, the stale check disagrees
 *   with the server, and the same popup reopens forever.
 */

"use strict";

const harness = require("./wc-harness");

/** The checkout subset the sole-trader module reads and writes. */
function buildForm() {
  document.body.innerHTML = [
    '<form name="checkout" class="checkout woocommerce-checkout">',
    '  <select id="billing_country" name="billing_country">',
    '    <option value="GB" selected>GB</option>',
    "  </select>",
    '  <input type="email" id="billing_email" name="billing_email" value="" />',
    '  <input type="text" id="billing_first_name" value="" />',
    '  <input type="text" id="billing_last_name" value="" />',
    '  <input type="text" id="billing_phone" value="" />',
    '  <p id="billing_company_display_field">',
    '    <select id="billing_company_display" name="billing_company_display">',
    '      <option value="">&nbsp;</option>',
    "    </select>",
    "  </p>",
    '  <p id="billing_company_field">',
    '    <label for="billing_company">Company</label>',
    '    <span class="woocommerce-input-wrapper">',
    '      <input type="text" id="billing_company" name="billing_company" value="" />',
    "    </span>",
    "  </p>",
    '  <p id="company_id_field">',
    '    <input type="text" id="company_id" name="company_id" value="" />',
    "  </p>",
    '  <input type="text" id="billing_address_1" value="" />',
    '  <input type="text" id="billing_address_2" value="" />',
    '  <input type="text" id="billing_city" value="" />',
    '  <input type="text" id="billing_postcode" value="" />',
    '  <input type="hidden" id="billing_state" />',
    '  <div class="twoinc-sole-trader-toggle" role="radiogroup"></div>',
    "</form>"
  ].join("\n");
}

const SOLE_TRADER_CONFIG = {
  availability_url: "/?wc-ajax=two_sole_trader_availability",
  tokens_url: "/?wc-ajax=two_sole_trader_tokens",
  nonce: "nonce",
  text: {
    registered_business: "Registered company",
    sole_trader: "Sole trader",
    popup_prompt: "Click here to login or sign up as a sole trader.",
    select_different: "Select a different sole trader",
    error: "Something went wrong"
  }
};

describe("TWO-40 §7/§8 — sole-trader flow", () => {
  let ctx;
  let $;
  let soleTrader;
  let opened;

  beforeEach(() => {
    ctx = harness.loadTwoinc({
      supported_buyer_countries: ["GB"],
      enable_order_intent: "no",
      enable_address_lookup: "no",
      sole_trader: SOLE_TRADER_CONFIG
    });
    $ = ctx.$;
    soleTrader = ctx.soleTrader;
    buildForm();
    soleTrader.availabilityByCountry = { GB: true };
    soleTrader.tokens = {
      delegation_token: "delegation",
      autofill_token: "autofill",
      signup_url: "https://checkout.example.test/soletrader/signup"
    };
    opened = [];
    window.open = jest.fn((url, target, features) => {
      opened.push({ url: url, target: target, features: features });
      return { closed: false };
    });
  });

  afterEach(() => {
    // A `window` listener outlives `document.body.innerHTML = ""` and the
    // module instance that registered it, so an abandoned one keeps answering
    // postMessages for the rest of the file — against a stale module whose
    // spies this test never installed.
    soleTrader.unbindPopupMessageListener();
    harness.releaseWidgets($);
    document.body.innerHTML = "";
  });

  describe("§7 — in-flight state", () => {
    test("goes up on the first flight and stays up until the last settles", () => {
      // A COUNT, not a boolean: a buyer changing email mid-prefetch starts a
      // second flight before the first has landed.
      soleTrader.beginFlight();
      expect($(".twoinc-sole-trader-toggle").hasClass("twoinc-sole-trader-toggle--busy")).toBe(
        true
      );

      soleTrader.beginFlight();
      soleTrader.settleFlight();
      expect($(".twoinc-sole-trader-toggle").hasClass("twoinc-sole-trader-toggle--busy")).toBe(
        true
      );

      soleTrader.settleFlight();
      expect($(".twoinc-sole-trader-toggle").hasClass("twoinc-sole-trader-toggle--busy")).toBe(
        false
      );
    });

    test("an unbalanced settle cannot drive the count negative", () => {
      // Otherwise the NEXT genuine flight would begin at zero-plus-one of a
      // negative number and never show at all.
      soleTrader.settleFlight();
      soleTrader.settleFlight();
      expect(soleTrader.flightDepth).toBe(0);

      soleTrader.beginFlight();
      expect($(".twoinc-sole-trader-toggle").hasClass("twoinc-sole-trader-toggle--busy")).toBe(
        true
      );
    });

    test("shows the spinner inside the company-search field, not as an overlay", () => {
      const $widget = harness.openCompanyWidget($, ctx.helper);

      soleTrader.beginFlight();
      expect($(".twoinc-search-spinner").length).toBe(1);
      // And the control is left OPEN under it.
      expect($widget.data("select2").isOpen()).toBe(true);

      soleTrader.settleFlight();
      expect($(".twoinc-search-spinner").length).toBe(0);
    });

    test("does not take down a spinner a company search is still holding", () => {
      // Two independent owners want the same in-field spinner. Before the
      // ownership split, whichever settled FIRST hid it under the other: a
      // buyer who blurs the email field and then opens the company search
      // inside the prefetch's window watched the search spinner vanish while
      // results were still loading.
      harness.openCompanyWidget($, ctx.helper);
      ctx.helper.holdCompanySearchSpinner("search");
      soleTrader.beginFlight();

      soleTrader.settleFlight();
      expect($(".twoinc-search-spinner").length).toBe(1);

      ctx.helper.releaseCompanySearchSpinner("search");
      expect($(".twoinc-search-spinner").length).toBe(0);
    });

    test("a country change drops every hold at once", () => {
      // Everything either owner was waiting on belongs to a country the
      // checkout has left.
      harness.openCompanyWidget($, ctx.helper);
      ctx.helper.holdCompanySearchSpinner("search");
      soleTrader.beginFlight();

      ctx.helper.resetCompanySearchSpinner();

      expect($(".twoinc-search-spinner").length).toBe(0);
      expect(ctx.helper.spinnerOwners).toEqual({ search: false, soleTrader: false });
    });

    test.each([
      ["the token mint fails", false],
      ["the buyer lookup resolves", true]
    ])("settles when %s", (_description, tokensOk) => {
      // Every terminal branch of the call graph settles its own flight — the
      // upstream review of this feature found stuck-forever spinners on two
      // separate abandon paths, so this is asserted per branch rather than
      // once for the happy path.
      $("#billing_email").val("buyer@example.test");
      jest.spyOn(soleTrader, "fetchTokens").mockImplementation((cb) => cb(tokensOk));
      jest.spyOn(soleTrader, "fetchCurrentBuyer").mockImplementation((cb) => cb(null));

      soleTrader.onEmailChanged();

      expect(soleTrader.flightDepth).toBe(0);
      expect($(".twoinc-sole-trader-toggle").hasClass("twoinc-sole-trader-toggle--busy")).toBe(
        false
      );
    });
  });

  describe("§7 — signup popup", () => {
    test("opens 700x805 — narrower clips the hosted flow's own layout", () => {
      soleTrader.launchSignup();

      expect(opened).toHaveLength(1);
      expect(opened[0].features).toContain("width=700");
      expect(opened[0].features).toContain("height=805");
    });

    test("stays a real window.open, synchronous with the activation", () => {
      // The signup/OTP flow depends on a third party that only works in a real
      // popup; an iframe-in-overlay rewrite was evaluated and rejected. A
      // synchronous open is also what keeps it out of the popup blocker.
      soleTrader.launchSignup();

      expect(window.open).toHaveBeenCalledTimes(1);
      expect(opened[0].target).toBe("_blank");
      expect(document.querySelector("iframe")).toBeNull();
    });

    test("a second activation in the same gesture does not stack a second popup", () => {
      // The re-entrancy guard. Modelled by re-entering from inside the open
      // itself, which is what a double activation amounts to.
      window.open = jest.fn(() => {
        soleTrader.launchSignup();
        return { closed: false };
      });

      soleTrader.launchSignup();

      expect(window.open).toHaveBeenCalledTimes(1);
    });

    test("the guard is released even when the browser blocks the window", () => {
      // Held past the open, a blocked popup would lock the buyer out of
      // retrying through the fallback link.
      window.open = jest.fn(() => null);
      soleTrader.launchSignup();
      expect(soleTrader.openingSignup).toBe(false);

      window.open = jest.fn(() => ({ closed: false }));
      soleTrader.launchSignup();
      expect(window.open).toHaveBeenCalledTimes(1);
    });

    test("a blocked popup falls back to the visible signup link", () => {
      soleTrader.render();
      window.open = jest.fn(() => null);

      soleTrader.launchSignup();

      expect($(".twoinc-sole-trader-note").hasClass("hidden")).toBe(false);
    });

    test("carries the delegation and autofill tokens and the prefill", () => {
      $("#billing_email").val("buyer@example.test");
      $("#billing_city").val("Registryville");

      soleTrader.launchSignup();

      expect(opened[0].url).toContain("businessToken=delegation");
      expect(opened[0].url).toContain("autofillToken=autofill");
      const encoded = decodeURIComponent(opened[0].url.split("autofillData=")[1]);
      const prefill = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
      expect(prefill.email).toBe("buyer@example.test");
      expect(prefill.billing_address.city).toBe("Registryville");
      expect(prefill.billing_address.country_code).toBe("GB");
    });
  });

  describe("§7 — select a different sole trader", () => {
    test("lands in the same slot as the search-for-company link", () => {
      const $btn = soleTrader.getDifferentSoleTraderBtnNode();

      expect($btn.parent().is("#billing_company_field .woocommerce-input-wrapper")).toBe(true);
      expect($btn.text()).toBe("Select a different sole trader");
    });

    test("is hidden until a sole trader is actually adopted", () => {
      soleTrader.syncDifferentSoleTraderLink();
      // `:visible` is unusable under jsdom — nothing has layout, so every
      // element reports zero size. The inline display the show/hide writes is
      // the real signal.
      expect(soleTrader.getDifferentSoleTraderBtnNode().css("display")).toBe("none");

      soleTrader.mode = "sole_trader";
      $("#company_id").val("TWO:ST12345");
      soleTrader.syncDifferentSoleTraderLink();

      expect(soleTrader.getDifferentSoleTraderBtnNode().css("display")).not.toBe("none");
    });

    test("goes back to hidden on the way out of sole-trader mode", () => {
      soleTrader.mode = "sole_trader";
      $("#company_id").val("TWO:ST12345");
      soleTrader.syncDifferentSoleTraderLink();

      soleTrader.setMode("business");

      expect(soleTrader.getDifferentSoleTraderBtnNode().css("display")).toBe("none");
    });

    test.each([
      ["click", (btn) => btn.trigger("click")],
      ["Enter", (btn) => btn.trigger($.Event("keydown", { which: 13 }))],
      ["Space", (btn) => btn.trigger($.Event("keydown", { which: 32 }))]
    ])("activating by %s opens the popup with autoselect=false", (_description, activate) => {
      // Skips the cookie/silent-autofill pre-check entirely and launches
      // directly — the whole point of the link is to override what that
      // pre-check would have decided. The flag is wired through
      // unconditionally, with no client-side branching on its value.
      activate(soleTrader.getDifferentSoleTraderBtnNode());

      expect(opened).toHaveLength(1);
      expect(opened[0].url).toContain("&autoselect=false");
    });

    test("the ordinary signup launch carries no autoselect flag", () => {
      soleTrader.launchSignup();
      expect(opened[0].url).not.toContain("autoselect");
    });
  });

  describe("§8 — identity trust levels", () => {
    /**
     * Deliver a hosted-signup postMessage the way the popup does.
     *
     * @param {string} data
     * @returns {void}
     */
    function postFromSignup(data) {
      window.dispatchEvent(
        new window.MessageEvent("message", {
          data: data,
          origin: "https://checkout.example.test"
        })
      );
    }

    test("the PASSIVE check still requires the cookie's buyer to own the typed email", () => {
      $("#billing_email").val("buyer@example.test");

      expect(soleTrader.buyerOwnsCheckoutEmail({ email: "buyer@example.test" })).toBe(true);
      expect(soleTrader.buyerOwnsCheckoutEmail({ email: "someone.else@example.test" })).toBe(false);
      expect(soleTrader.buyerOwnsCheckoutEmail(null)).toBe(false);
    });

    test("a completed signup is adopted even under a DIFFERENT email from the checkout's", () => {
      // The confirmed bug this closes: the server has already told the browser
      // who the buyer is, so re-running the passive match makes the plugin
      // disagree with the server and reopen the same popup forever.
      $("#billing_email").val("checkout@example.test");
      soleTrader.mode = "sole_trader";
      jest.spyOn(soleTrader, "fetchCurrentBuyer").mockImplementation((cb) =>
        cb({
          email: "signed.up.as@example.test",
          organization_number: "TWO:ST12345",
          company_name: "Sole Trader Co"
        })
      );
      soleTrader.bindPopupMessageListener();

      postFromSignup("ACCEPTED");

      expect($("#company_id").val()).toBe("TWO:ST12345");
      expect($("#billing_company").val()).toBe("Sole Trader Co");
      expect(soleTrader.prefetched.matches).toBe(true);
    });

    test("a completed signup that resolves no buyer at all surfaces the error", () => {
      // The authenticated path trusts the server, which means it also has to
      // handle the server having nothing — otherwise this branch silently does
      // nothing and the buyer is left staring at an unchanged checkout.
      // Rendered BEFORE the mode is set: render() re-runs the email-driven
      // prefetch, and with no email entered that reverts sole-trader mode to
      // business on its own.
      soleTrader.render();
      soleTrader.mode = "sole_trader";
      jest.spyOn(soleTrader, "fetchCurrentBuyer").mockImplementation((cb) => cb(null));
      soleTrader.bindPopupMessageListener();

      postFromSignup("ACCEPTED");

      expect($(".twoinc-sole-trader-toggle__error").text()).toBe("Something went wrong");
      expect($("#company_id").val()).toBe("");
    });

    test("the authenticated lookup settles its own flight", () => {
      soleTrader.mode = "sole_trader";
      jest
        .spyOn(soleTrader, "fetchCurrentBuyer")
        .mockImplementation((cb) => cb({ organization_number: "TWO:ST1", company_name: "X" }));
      soleTrader.bindPopupMessageListener();

      postFromSignup("ACCEPTED");

      expect(soleTrader.flightDepth).toBe(0);
    });

    test("a message from another origin is ignored", () => {
      soleTrader.mode = "sole_trader";
      const lookup = jest.spyOn(soleTrader, "fetchCurrentBuyer");
      soleTrader.bindPopupMessageListener();

      window.dispatchEvent(
        new window.MessageEvent("message", {
          data: "ACCEPTED",
          origin: "https://attacker.example.test"
        })
      );

      expect(lookup).not.toHaveBeenCalled();
    });
  });
});
