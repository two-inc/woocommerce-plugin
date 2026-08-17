/**
 * TWO-40. What a buyer sees while the autofill prefetch they are waiting on is
 * still in the air, and what happens to their choice when it lands.
 *
 * The prefetch runs on every email edit, not on the chip click — the click is
 * deliberately synchronous so the signup popup survives the popup blocker. So
 * there is exactly one wait a buyer can experience: clicking "Sole trader"
 * before the prefetch for their email has come back. That wait used to be
 * completely silent, and then ended by flipping the mode back to registered
 * company and hiding the prompt, seconds after they clicked.
 *
 * The clearing table below is the important one. A busy indicator's failure
 * mode is not "never appears", it is "never goes away", and it goes away from
 * one place only because every terminal branch of the call graph funnels
 * there. Each row is a different way the flight can end.
 *
 * Async is flushed with a macrotask throughout. Counting `Promise.resolve()`
 * hops encodes an assumption about production code, and a count one short
 * makes a negative assertion pass against a state that has simply not been
 * reached yet — which is how a vacuous test shipped on a sibling suite.
 */

"use strict";

const harness = require("./wc-harness");

const SIGNUP_ORIGIN = "https://checkout.example.test";
const TOKENS_URL = "/?wc-ajax=twoinc_sole_trader_tokens";

const ENROLLED = {
  email: "enrolled@example.test",
  company_name: "Sole Trader Example",
  organization_number: "TWO:ST:GB:0f8c2b1a"
};

/** Let every pending microtask run. See the file docblock. */
function flush() {
  return new Promise(function (resolve) {
    setTimeout(resolve, 0);
  });
}

describe("sole-trader prefetch in flight", () => {
  let ctx;
  let $;
  let soleTrader;
  let opened;
  let originalOpen;
  let boundMessageListeners;
  let realAddEventListener;
  /** Resolvers for the pending token POST, so a flight can be held open. */
  let pendingTokenRequests;

  /**
   * Type an email and run the prefetch, which is exactly what the production
   * `change` binding on #billing_email does. That binding is registered from
   * Twoinc's initialize(), which this harness does not run, so the handler is
   * invoked directly rather than through a synthetic event nothing listens for.
   */
  function setEmail(value) {
    $("#billing_email").val(value);
    soleTrader.onEmailChanged();
    return flush();
  }

  /** Is the busy indicator painted? */
  function spinnerVisible() {
    const $spinner = $(".twoinc-sole-trader-toggle__spinner");
    return $spinner.length > 0 && !$spinner.hasClass("hidden");
  }

  /** Is the registration prompt painted? */
  function noteVisible() {
    const $note = $(".twoinc-sole-trader-note");
    return $note.length > 0 && !$note.hasClass("hidden");
  }

  /**
   * Stub jQuery.post so the token mint can be resolved on demand, which is
   * what makes the in-flight window observable at all.
   */
  function stubTokenTransport() {
    $.post = function (url) {
      const deferred = $.Deferred();
      if (String(url).indexOf("sole_trader_tokens") !== -1) {
        pendingTokenRequests.push(deferred);
      } else {
        deferred.resolve({ success: false });
      }
      return deferred.promise();
    };
  }

  /** Settle the oldest in-flight token request. */
  function resolveTokens(outcome) {
    const deferred = pendingTokenRequests.shift();
    if (outcome === "fail") {
      deferred.reject();
    } else if (outcome === "unusable") {
      deferred.resolve({ success: true, data: {} });
    } else {
      deferred.resolve({
        success: true,
        data: {
          signup_url: SIGNUP_ORIGIN + "/soletrader/signup",
          delegation_token: "delegation-token",
          autofill_token: "autofill-token"
        }
      });
    }
    return flush();
  }

  /** Stub the buyer read that follows a successful token mint. */
  function stubBuyer(buyer, mode) {
    global.fetch = function () {
      if (mode === "reject") {
        return Promise.reject(new Error("network"));
      }
      const status = mode === "server-error" ? 500 : buyer === null ? 404 : 200;
      return Promise.resolve({
        ok: status === 200,
        status: status,
        json: function () {
          return Promise.resolve(buyer);
        },
        text: function () {
          return Promise.resolve("");
        }
      });
    };
  }

  beforeEach(() => {
    // Same harness-vs-production distinction the identity suite documents: the
    // module object is re-evaluated per test but the jsdom window is not, so
    // every test's message listener would otherwise stay live.
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
        tokens_url: TOKENS_URL,
        nonce: "nonce",
        text: {
          registered_business: "Registered company",
          sole_trader: "Sole trader",
          popup_prompt: "Register",
          change_prompt: "Select a different sole trader",
          checking: "Checking your details",
          error: "Something went wrong"
        }
      }
    });
    harness.buildCheckoutForm({ country: "GB" });
    $ = ctx.$;
    soleTrader = ctx.soleTrader;
    $("<input>", { type: "email", id: "billing_email" }).appendTo("form.checkout");
    $("<div>", { class: "twoinc-sole-trader-toggle" }).appendTo(document.body);

    pendingTokenRequests = [];
    stubTokenTransport();
    opened = [];
    originalOpen = global.window.open;
    global.window.open = function (url) {
      opened.push(url);
      return { closed: false, focus: function () {} };
    };

    // The registry answer render() gates on, so the prefetch actually runs.
    soleTrader.availabilityByCountry.GB = true;
    soleTrader.render();
  });

  afterEach(() => {
    boundMessageListeners.forEach(function (handler) {
      global.window.removeEventListener("message", handler);
    });
    global.window.addEventListener = realAddEventListener;
    global.window.open = originalOpen;
    harness.releaseWidgets($);
    document.body.innerHTML = "";
    delete global.fetch;
  });

  describe("the busy indicator", () => {
    test("appears when the chip is clicked while the prefetch is still running", async () => {
      await setEmail("waiting@example.test");
      expect(pendingTokenRequests).toHaveLength(1);
      // Nobody is waiting yet — the prefetch is a background errand.
      expect(spinnerVisible()).toBe(false);

      soleTrader.onModeChipClick("sole_trader");

      expect(spinnerVisible()).toBe(true);
      // The prompt is not the answer yet, so it must not be showing beside it.
      expect(noteVisible()).toBe(false);
      expect(opened).toHaveLength(0);
    });

    test("stays hidden for a prefetch nobody is waiting on", async () => {
      await setEmail("background@example.test");

      expect(spinnerVisible()).toBe(false);

      stubBuyer(ENROLLED);
      await resolveTokens("ok");

      expect(spinnerVisible()).toBe(false);
    });

    test("announces the wait, rather than only painting it", async () => {
      // A live region reports a change to its CONTENT. An empty one that merely
      // becomes visible says nothing, so the text has to arrive with the wait
      // and leave with it.
      const $spinner = $(".twoinc-sole-trader-toggle__spinner");
      expect($spinner.attr("role")).toBe("status");
      expect($spinner.text()).toBe("");

      await setEmail("waiting@example.test");
      soleTrader.onModeChipClick("sole_trader");

      expect($(".twoinc-sole-trader-toggle__spinner").text()).toBe("Checking your details");

      stubBuyer(null);
      await resolveTokens("ok");

      expect($(".twoinc-sole-trader-toggle__spinner").text()).toBe("");
    });

    // Every terminal branch of the flight's call graph. A stuck indicator is
    // the failure mode, so each row ends the flight a different way and
    // asserts it cleared.
    //
    // tokens outcome | buyer stub | buyer mode | description
    const terminalBranches = [
      ["ok", ENROLLED, null, "buyer read succeeds"],
      ["ok", null, null, "buyer read 404s"],
      ["ok", null, "server-error", "buyer read returns a non-2xx"],
      ["ok", null, "reject", "buyer read rejects outright"],
      ["fail", null, null, "token transport fails"],
      ["unusable", null, null, "token response carries no token"]
    ];

    test.each(terminalBranches)(
      "clears when the flight ends: %s / %s / %s (%s)",
      async (tokenOutcome, buyer, buyerMode) => {
        await setEmail("waiting@example.test");
        soleTrader.onModeChipClick("sole_trader");
        expect(spinnerVisible()).toBe(true);

        stubBuyer(buyer, buyerMode);
        await resolveTokens(tokenOutcome);

        expect(spinnerVisible()).toBe(false);
        expect(soleTrader.flightPending).toBe(false);
      }
    );

    test("clears when the buyer switches back to registered company mid-flight", async () => {
      await setEmail("waiting@example.test");
      soleTrader.onModeChipClick("sole_trader");
      expect(spinnerVisible()).toBe(true);

      soleTrader.onModeChipClick("business");

      expect(spinnerVisible()).toBe(false);
    });

    test("clears when the email is emptied while a flight is in the air", async () => {
      await setEmail("waiting@example.test");
      soleTrader.onModeChipClick("sole_trader");
      expect(spinnerVisible()).toBe(true);

      // No request goes out for an empty email, so nothing would ever settle
      // the flight this was waiting on.
      await setEmail("");

      expect(spinnerVisible()).toBe(false);
    });

    test("a superseded flight cannot clear the indicator a newer one owns", async () => {
      await setEmail("first@example.test");
      soleTrader.onModeChipClick("sole_trader");
      await setEmail("second@example.test");
      soleTrader.onModeChipClick("sole_trader");
      expect(pendingTokenRequests).toHaveLength(2);
      expect(spinnerVisible()).toBe(true);

      // Settle the FIRST, stale flight.
      stubBuyer(ENROLLED);
      await resolveTokens("ok");

      expect(spinnerVisible()).toBe(true);
    });
  });

  describe("whose choice sole trader was", () => {
    // who selected it | survives a non-matching prefetch | description
    const cases = [
      [true, true, "the buyer clicked the chip"],
      [false, false, "the prefetch selected it on an earlier email"]
    ];

    test.each(cases)("explicit=%s -> keeps sole trader: %s (%s)", async (explicit, survives) => {
      await setEmail("waiting@example.test");
      if (explicit) {
        soleTrader.onModeChipClick("sole_trader");
      } else {
        // What applyPrefetch() does for a buyer it recognised earlier.
        soleTrader.setMode("sole_trader");
      }
      expect(soleTrader.mode).toBe("sole_trader");

      stubBuyer(null);
      await resolveTokens("ok");

      expect(soleTrader.mode).toBe(survives ? "sole_trader" : "business");
    });

    test("an explicit choice ends the wait with the prompt, not a silent revert", async () => {
      await setEmail("waiting@example.test");
      soleTrader.onModeChipClick("sole_trader");

      stubBuyer(null);
      await resolveTokens("ok");

      expect(soleTrader.mode).toBe("sole_trader");
      // The actionable next step, and the affordance that opens the popup on
      // the buyer's own click rather than an async window.open the browser
      // would block.
      expect(noteVisible()).toBe(true);
      expect(spinnerVisible()).toBe(false);
      expect(opened).toHaveLength(0);
    });

    test("drops the previous buyer's company when the new email matches nobody", async () => {
      // The mode survives an explicit choice; the company must not. Reaching
      // this branch with the last adopted organisation number still in the
      // field would put one buyer's identity on another buyer's order.
      await setEmail("enrolled@example.test");
      stubBuyer(ENROLLED);
      await resolveTokens("ok");
      expect($("#company_id").val()).toBe(ENROLLED.organization_number);

      soleTrader.onModeChipClick("sole_trader");
      await setEmail("someone-else@example.test");
      stubBuyer(null);
      await resolveTokens("ok");

      expect(soleTrader.mode).toBe("sole_trader");
      expect(noteVisible()).toBe(true);
      expect($("#company_id").val()).toBe("");
      expect($("#billing_company").val()).toBe("");
      // The record and its pairing witness go with the field. Asserted rather
      // than assumed, because the clear is delegated to the shared capture
      // helper and this is the only caller that clears while STAYING in
      // sole-trader mode.
      const record = ctx.Twoinc.getInstance().customerCompany;
      expect(record.organization_number).toBe("");
      expect(record.pairedName).toBeNull();
    });

    test("switching to registered company withdraws the explicit choice", async () => {
      soleTrader.onModeChipClick("sole_trader");
      expect(soleTrader.explicitSoleTrader).toBe(true);

      soleTrader.onModeChipClick("business");

      expect(soleTrader.explicitSoleTrader).toBe(false);
    });
  });

  describe("re-entrancy", () => {
    test("two rapid clicks open one popup", async () => {
      // Prefetch resolved with nobody to adopt: this is the path that opens
      // the popup straight from the click.
      await setEmail("waiting@example.test");
      stubBuyer(null);
      await resolveTokens("ok");

      soleTrader.onModeChipClick("sole_trader");
      soleTrader.onModeChipClick("sole_trader");

      expect(opened).toHaveLength(1);
    });

    test("a popup that has closed does not block the next one", async () => {
      await setEmail("waiting@example.test");
      stubBuyer(null);
      await resolveTokens("ok");

      global.window.open = function (url) {
        opened.push(url);
        return { closed: false, focus: function () {} };
      };
      soleTrader.onModeChipClick("sole_trader");
      expect(opened).toHaveLength(1);

      soleTrader.popupWindow.closed = true;
      soleTrader.onModeChipClick("sole_trader");

      expect(opened).toHaveLength(2);
    });

    test("one click during a flight yields one flight", async () => {
      await setEmail("waiting@example.test");
      soleTrader.onModeChipClick("sole_trader");
      soleTrader.onModeChipClick("sole_trader");

      // The chip does not start prefetches; only an email change does. Two
      // clicks must not have produced a second token mint.
      expect(pendingTokenRequests).toHaveLength(1);
    });
  });
});
