/**
 * TWO-40. Two trust levels for an autofill buyer, and the authenticated one
 * does not re-run the passive check.
 *
 * The passive check — does this buyer own the email currently typed at
 * checkout — is the right question when the buyer came off the Two cookie
 * with nothing proving who is sitting at the checkout. It is the wrong
 * question once the hosted signup's OTP step has succeeded, because by then
 * the server has established the identity and the checkout's contact field is
 * just another form value. Someone enrolled under one address and ordering
 * with another is an ordinary buyer, not a mismatch.
 *
 * Asking it anyway is not a cosmetic bug: the adoption is skipped, the signup
 * prompt stays visible, and the next click reopens the same popup the buyer
 * just completed — with no error to explain why. The integration tests below
 * are written around that loop rather than around the boolean, because a fix
 * that got the boolean right and still failed to paint the result would look
 * identical to the buyer.
 */

"use strict";

const harness = require("./wc-harness");

const SIGNUP_ORIGIN = "https://checkout.example.test";

const ENROLLED = {
  email: "enrolled@example.test",
  company_name: "Sole Trader Example",
  organization_number: "TWO:ST:GB:0f8c2b1a"
};

describe("autofill buyer trust levels", () => {
  let ctx;
  let $;
  let soleTrader;

  beforeEach(() => {
    ctx = harness.loadTwoinc({
      supported_buyer_countries: ["GB"],
      enable_company_search: "yes",
      text: {},
      sole_trader: {
        availability_url: "/?wc-ajax=twoinc_sole_trader_availability",
        tokens_url: "/?wc-ajax=twoinc_sole_trader_tokens",
        nonce: "nonce",
        text: {
          registered_business: "Registered business",
          sole_trader: "Sole trader",
          popup_prompt: "Register",
          error: "Something went wrong"
        }
      }
    });
    harness.buildCheckoutForm({ country: "GB" });
    $ = ctx.$;
    soleTrader = ctx.soleTrader;
    // The checkout's contact-email field. Not part of the shared harness form,
    // which was built for the company-search suites.
    $("<input>", { type: "email", id: "billing_email" }).appendTo("form.checkout");
    soleTrader.tokens = {
      signup_url: SIGNUP_ORIGIN + "/soletrader/signup",
      delegation_token: "delegation-token",
      autofill_token: "autofill-token"
    };
  });

  afterEach(() => {
    harness.releaseWidgets($);
    document.body.innerHTML = "";
    delete global.fetch;
  });

  describe("buyerIsAdoptable", () => {
    // buyer email | entered email | authenticated | adoptable | description
    const cases = [
      ["enrolled@example.test", "enrolled@example.test", false, true, "passive, emails agree"],
      ["enrolled@example.test", "someone@example.test", false, false, "passive, emails differ"],
      ["enrolled@example.test", "", false, false, "passive, nothing typed yet"],
      ["ENROLLED@EXAMPLE.TEST", "enrolled@example.test", false, true, "passive, case differs only"],
      [undefined, "enrolled@example.test", false, false, "passive, buyer carries no email"],
      ["enrolled@example.test", "someone@example.test", true, true, "authenticated, emails differ"],
      ["enrolled@example.test", "", true, true, "authenticated, nothing typed at checkout"],
      [undefined, "enrolled@example.test", true, true, "authenticated, buyer carries no email"]
    ];

    test.each(cases)(
      "buyer %s / entered %s / authenticated %s -> %s (%s)",
      (buyerEmail, enteredEmail, authenticated, expected) => {
        // The case description is the last column and rides in the test name
        // above, so a failure names the case without a custom message.
        $("#billing_email").val(enteredEmail);

        expect(soleTrader.buyerIsAdoptable({ email: buyerEmail }, authenticated)).toBe(expected);
      }
    );

    test("a missing buyer is never adoptable, however it was obtained", () => {
      [true, false].forEach(function (authenticated) {
        expect(soleTrader.buyerIsAdoptable(null, authenticated)).toBe(false);
        expect(soleTrader.buyerIsAdoptable(undefined, authenticated)).toBe(false);
      });
    });
  });

  describe("the post-signup ACCEPTED message", () => {
    beforeEach(() => {
      // render() fills the container the payment tile ships, and is what
      // creates the note the reopen loop hangs off. Asserting on the real
      // rendered note rather than a hand-built stand-in is the point: the bug
      // is that the note stays visible.
      $("<div>", { class: "twoinc-sole-trader-toggle" }).appendTo(document.body);
      soleTrader.render();
    });

    /** Stub the buyer read the ACCEPTED handler performs. */
    function stubBuyer(buyer) {
      global.fetch = function () {
        return Promise.resolve({
          ok: buyer !== null,
          status: buyer === null ? 404 : 200,
          json: function () {
            return Promise.resolve(buyer);
          },
          text: function () {
            return Promise.resolve("");
          }
        });
      };
    }

    /** Deliver an ACCEPTED postMessage from the signup origin and settle it. */
    function accept(data) {
      soleTrader.bindPopupMessageListener();
      global.window.dispatchEvent(
        new global.window.MessageEvent("message", {
          data: data === undefined ? "ACCEPTED" : data,
          origin: SIGNUP_ORIGIN
        })
      );
      // Two chained promises inside fetchCurrentBuyer, then the callback.
      return Promise.resolve()
        .then(function () {})
        .then(function () {})
        .then(function () {});
    }

    test("adopts the authenticated buyer even though the checkout email differs", async () => {
      $("#billing_email").val("ordering-from-elsewhere@example.test");
      soleTrader.mode = "sole_trader";
      stubBuyer(ENROLLED);

      await accept();

      expect($("#company_id").val()).toBe(ENROLLED.organization_number);
      expect($("#billing_company").val()).toBe(ENROLLED.company_name);
      // The prompt is the reopen affordance. Still visible means the loop.
      expect($(".twoinc-sole-trader-note").hasClass("hidden")).toBe(true);
    });

    test("honours the signup even if the mode reverted while the popup was open", async () => {
      $("#billing_email").val("ordering-from-elsewhere@example.test");
      // What applyPrefetch() does when a passive prefetch resolves without a
      // match mid-signup.
      soleTrader.mode = "business";
      stubBuyer(ENROLLED);

      await accept();

      expect($("#company_id").val()).toBe(ENROLLED.organization_number);
      expect(soleTrader.mode).toBe("sole_trader");
    });

    test("reports a signup it cannot read the buyer back for, rather than going quiet", async () => {
      $("#billing_email").val("enrolled@example.test");
      soleTrader.mode = "sole_trader";
      stubBuyer(null);

      await accept();

      expect($("#company_id").val()).toBe("");
      expect($(".twoinc-sole-trader-toggle__error").text()).toBe("Something went wrong");
    });

    test("ignores a message from any other origin", async () => {
      soleTrader.mode = "sole_trader";
      stubBuyer(ENROLLED);
      soleTrader.bindPopupMessageListener();

      global.window.dispatchEvent(
        new global.window.MessageEvent("message", {
          data: "ACCEPTED",
          origin: "https://not-the-signup.example.test"
        })
      );
      await Promise.resolve();

      expect($("#company_id").val()).toBe("");
    });
  });
});
