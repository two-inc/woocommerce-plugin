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
  let boundMessageListeners;
  let realAddEventListener;

  beforeEach(() => {
    // The plugin's re-entrancy flag lives on the module object, which the
    // harness re-evaluates per test — but addEventListener targets the jsdom
    // window, which does not reset. Left alone, every test's listener stays
    // live and N of them run per dispatch, so the suite could never detect a
    // double-adoption bug: it would already have N-fold adoption. Production
    // is fine (one page load, one module, one listener); the harness is what
    // needs the bookkeeping.
    boundMessageListeners = [];
    realAddEventListener = global.window.addEventListener;
    const realAdd = realAddEventListener.bind(global.window);
    global.window.addEventListener = function (type, handler, options) {
      if (type === "message") {
        boundMessageListeners.push(handler);
      }
      return realAdd(type, handler, options);
    };

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
    boundMessageListeners.forEach(function (handler) {
      global.window.removeEventListener("message", handler);
    });
    // Restored, or each beforeEach wraps the previous wrapper and the chain
    // grows a layer per test.
    global.window.addEventListener = realAddEventListener;
    harness.releaseWidgets($);
    document.body.innerHTML = "";
    delete global.fetch;
    delete window.twoinc.enable_order_intent;
  });

  /** Stub the buyer read, as the endpoint would answer it. */
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
      // Stand in for the popup having been opened. The listener refuses
      // messages otherwise, and these tests post to it directly rather than
      // going through a click.
      soleTrader.popupOpened = true;
    });

    /**
     * Let every pending microtask run.
     *
     * A macrotask, deliberately, rather than a counted number of
     * `Promise.resolve().then()` hops: `fetchCurrentBuyer` chains a
     * response-handling `then` behind `fetch`, and counting the chain means
     * the count is a hidden assumption about production code. Getting it one
     * short makes a NEGATIVE test assert a state that has not been reached
     * yet instead of one that was refused — which passes, and passes for a
     * fix that does nothing.
     */
    function flush() {
      return new Promise(function (resolve) {
        setTimeout(resolve, 0);
      });
    }

    /** Deliver a postMessage to the listener and let it settle. */
    function post(data, origin) {
      soleTrader.bindPopupMessageListener();
      global.window.dispatchEvent(
        new global.window.MessageEvent("message", {
          data: data === undefined ? "ACCEPTED" : data,
          origin: origin === undefined ? SIGNUP_ORIGIN : origin
        })
      );
      return flush();
    }

    test("adopts the authenticated buyer even though the checkout email differs", async () => {
      $("#billing_email").val("ordering-from-elsewhere@example.test");
      soleTrader.mode = "sole_trader";
      stubBuyer(ENROLLED);
      // Shown first, deliberately. render() leaves the note hidden, so
      // asserting "hidden" after adoption against that initial state would
      // hold whether or not anything hid it — and the prompt being left up is
      // the reopen loop this whole file exists for. Assert the transition.
      soleTrader.showNote(true);
      expect($(".twoinc-sole-trader-note").hasClass("hidden")).toBe(false);

      await post();

      expect($("#company_id").val()).toBe(ENROLLED.organization_number);
      expect($("#billing_company").val()).toBe(ENROLLED.company_name);
      expect($(".twoinc-sole-trader-note").hasClass("hidden")).toBe(true);
    });

    test("honours the signup even if the mode reverted while the popup was open", async () => {
      $("#billing_email").val("ordering-from-elsewhere@example.test");
      // What applyPrefetch() does when a passive prefetch resolves without a
      // match mid-signup.
      soleTrader.mode = "business";
      stubBuyer(ENROLLED);

      await post();

      expect($("#company_id").val()).toBe(ENROLLED.organization_number);
      expect(soleTrader.mode).toBe("sole_trader");
    });

    test("reports a signup it cannot read the buyer back for, rather than going quiet", async () => {
      $("#billing_email").val("enrolled@example.test");
      soleTrader.mode = "sole_trader";
      stubBuyer(null);

      await post();

      expect($("#company_id").val()).toBe("");
      expect($(".twoinc-sole-trader-toggle__error").text()).toBe("Something went wrong");
    });

    test("ignores a message from any other origin", async () => {
      soleTrader.mode = "sole_trader";
      stubBuyer(ENROLLED);

      await post("ACCEPTED", "https://not-the-signup.example.test");

      expect($("#company_id").val()).toBe("");
    });

    test("ignores a message when this plugin never opened a signup popup", async () => {
      soleTrader.popupOpened = false;
      soleTrader.mode = "sole_trader";
      stubBuyer(ENROLLED);

      await post();

      expect($("#company_id").val()).toBe("");
    });

    test("a blocked popup does not open the gate", async () => {
      // The latch has to follow whether a window was actually created. A
      // blocked window.open returns null, the buyer falls back to the prompt
      // link, and until that link opens something there is no popup whose
      // message this checkout should believe.
      soleTrader.popupOpened = false;
      const blocked = [];
      const originalOpen = global.window.open;
      global.window.open = function () {
        blocked.push(1);
        return null;
      };
      try {
        soleTrader.openPopup();
      } finally {
        global.window.open = originalOpen;
      }
      expect(blocked).toHaveLength(1);
      expect(soleTrader.popupOpened).toBe(false);

      stubBuyer(ENROLLED);
      soleTrader.mode = "sole_trader";
      await post();

      expect($("#company_id").val()).toBe("");
    });

    test("reports a signup the hosted flow did not accept", async () => {
      soleTrader.mode = "sole_trader";
      stubBuyer(ENROLLED);

      await post("REJECTED");

      expect($("#company_id").val()).toBe("");
      expect($(".twoinc-sole-trader-toggle__error").text()).toBe("Something went wrong");
    });

    test("arms the order-intent check once the company is adopted", async () => {
      // The adoption's most consequential side effect. Without
      // enable_order_intent the gate short-circuits and getApproval() is a
      // no-op, so the rest of this describe never exercises it.
      window.twoinc.enable_order_intent = "yes";
      $("#billing_email").val("enrolled@example.test");
      soleTrader.mode = "sole_trader";
      stubBuyer(ENROLLED);

      await post();

      expect($("#company_id").val()).toBe(ENROLLED.organization_number);
      expect(ctx.Twoinc.getInstance().orderIntentCheck.interval).not.toBeNull();
    });
  });

  describe("the buyer read's own contract", () => {
    // These exercise fetchCurrentBuyer directly rather than the message path.
    test("lets an adoption failure surface instead of blaming the buyer read", async () => {
      // The read succeeded; applying its result did not. Those are different
      // failures. If the callback's exception were caught by the read's own
      // handler it would re-invoke the callback with null — blaming the
      // network for something that never went near it, and recording "no
      // buyer" while one existed.
      stubBuyer(ENROLLED);
      const seen = [];

      // The message is buyer-conditional on purpose. Under the old shape the
      // catch re-invoked the callback, so a rejection happened either way and
      // matching on a fixed message proved nothing — but that second call
      // arrives with a null the read never produced, so the two shapes reject
      // with different messages and the assertion below can tell them apart on
      // its own.
      await expect(
        soleTrader.fetchCurrentBuyer(function (buyer) {
          seen.push(buyer);
          throw new Error(
            buyer ? "applying the buyer failed" : "re-invoked with a null the read never produced"
          );
        })
      ).rejects.toThrow("applying the buyer failed");

      expect(seen).toEqual([ENROLLED]);
    });

    test("resolves a thenable even when there are no tokens to read with", async () => {
      // Both exits return a promise, so a caller can sequence after the read
      // without knowing which path it took.
      soleTrader.tokens = null;
      const seen = [];

      // Asserted on the RETURN VALUE, not by awaiting it: `await undefined`
      // succeeds, so awaiting would pass whether or not this path returns
      // anything at all.
      const returned = soleTrader.fetchCurrentBuyer(function (buyer) {
        seen.push(buyer);
      });

      expect(typeof (returned || {}).then).toBe("function");
      await returned;
      expect(seen).toEqual([null]);
    });

    test("drains the body of a response it is not going to read", async () => {
      // Not politeness: an unread body leaves the request in flight as far as
      // the browser is concerned, so anything waiting on network-idle never
      // sees it finish. What is pinned is that the body IS read — not that the
      // read is awaited before proceeding, since a fire-and-forget text() would
      // still pass here, and would still drain.
      let drained = 0;
      global.fetch = function () {
        return Promise.resolve({
          ok: false,
          status: 500,
          text: function () {
            drained += 1;
            return Promise.resolve("");
          }
        });
      };
      const seen = [];

      await soleTrader.fetchCurrentBuyer(function (buyer) {
        seen.push(buyer);
      });

      expect(drained).toBe(1);
      expect(seen).toEqual([null]);
    });
  });
});
