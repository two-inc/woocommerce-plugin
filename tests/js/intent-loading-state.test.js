/**
 * TWO-25326, 2026-08-04. The order-intent check's loading state, and when a
 * previous verdict is taken off screen.
 *
 * The bug this suite pins: the buyer picked a different company, a fresh
 * order-intent check started, and the tile kept showing the PREVIOUS
 * company's verdict — "<old company> is not available for this order" — for as
 * long as the new check took. The only thing that cleared it was the new
 * RESULT arriving, which on a slow check is seconds of confidently wrong copy
 * about a company the buyer has already moved on from.
 *
 * `getApproval()` is where that is fixed, because it is the one choke point
 * every route into a check passes through. Four of the five routes —
 * `setSoleTraderCompany()`, `onCompanyInputBlur()`,
 * `onRepresentativeInputBlur()` and `onCountryChange()` — cleared nothing at
 * all, and the fifth (the company picker's `select2:select`) still left a
 * second of stale verdict on screen because the check is armed on a 1s
 * interval. So the assertions below are deliberately about `getApproval()`
 * and the interval's own ticks rather than about any one caller: a new route
 * added later inherits the behaviour, and a test per route would not have
 * caught the ones that existed.
 *
 * The loader's own markup (spinner asset + "Checking availability") is the
 * PHP renderer's, and asserted in tests/unit/run.php. What this suite needs
 * from it is only the class names the JS toggles.
 */

"use strict";

const harness = require("./wc-harness");

const GATEWAY_ID = "woocommerce-gateway-tillit";

describe("order-intent loading state and stale-verdict clearing", () => {
  let ctx;
  let $;
  let dom;
  let instance;

  beforeEach(() => {
    jest.useFakeTimers();

    ctx = harness.loadTwoinc({
      gateway_id: GATEWAY_ID,
      enable_order_intent: "yes",
      supported_buyer_countries: ["GB"],
      enable_company_search: "yes",
      enable_address_lookup: "no",
      currency: "GBP",
      merchant: { id: "m-1", short_name: "acme" },
      text: {}
    });
    $ = ctx.$;
    dom = ctx.dom;

    harness.buildCheckoutForm();
    buildPaymentTile();
    buildCartTotals();

    instance = ctx.Twoinc.getInstance();
    // `isReadyApprovalCheck()` rejects an organisation number it does not have
    // AND any empty value anywhere in `customerCompany`, so a partial fixture
    // would make every test below exercise its early return instead.
    instance.customerCompany = {
      company_name: "ACME Widgets Ltd",
      organization_number: "12345678",
      country_prefix: "GB"
    };
    instance.customerRepresentative = {
      email: "buyer@example.test",
      first_name: "Ada",
      last_name: "Lovelace",
      phone_number: "+4471234567"
    };
    $("#billing_company").val("ACME Widgets Ltd");
    $("#company_id").val("12345678");
  });

  afterEach(() => {
    harness.releaseWidgets($);
    jest.clearAllTimers();
    jest.useRealTimers();
    document.body.innerHTML = "";
  });

  /**
   * The four pay-boxes the PHP renderer emits into the payment tile, with the
   * same classes and the same `hidden` starting state. Text is a distinctive
   * marker rather than production copy: this suite is about WHICH box is on
   * screen, never about wording.
   *
   * @returns {void}
   */
  function buildPaymentTile() {
    $(document.body).append(
      '<li class="wc_payment_method"><div class="payment_box">' +
        // The ARIA roles are the ones the PHP renderer emits, so the reveal
        // ordering that makes them announce anything is exercised on real
        // markup (review round 2).
        '<div class="twoinc-pay-box twoinc-loader hidden" role="status">' +
        '<span class="twoinc-loader__spinner" aria-hidden="true"></span>' +
        '<span class="twoinc-loader__text">Checking availability</span>' +
        "</div>" +
        '<div class="twoinc-pay-box twoinc-intent-approved hidden" role="status" ' +
        'data-company-template="{company}">' +
        "NO_COMPANY_APPROVED" +
        "</div>" +
        '<div class="twoinc-pay-box twoinc-err-payment-default hidden" role="alert" ' +
        'data-company-template="{company}">' +
        "NO_COMPANY_DECLINED" +
        "</div>" +
        '<div class="twoinc-pay-box twoinc-err-phone-number hidden" role="alert">' +
        "Phone number is invalid." +
        "</div>" +
        "</div></li>"
    );
    $("form[name='checkout']").append(
      '<input type="radio" name="payment_method" value="' +
        GATEWAY_ID +
        '" checked />' +
        // markFieldInvalid() targets the field WRAPPER by id, and silently does
        // nothing when it is absent — so without this the phone-number test
        // would assert the marking passed by never looking for it.
        '<p id="billing_phone_field" class="woocommerce-validated">' +
        '<input type="tel" id="billing_phone" name="billing_phone" value="+4471234567" />' +
        "</p>"
    );
  }

  /**
   * The two price nodes `getPrice()` reads. Without them the interval body
   * returns on `!gross_amount` before it ever reaches the check, so the
   * request assertions below would pass against a request that never happened.
   *
   * @returns {void}
   */
  function buildCartTotals() {
    $(document.body).append(
      '<div class="order-total"><span class="woocommerce-Price-amount">120.00</span></div>' +
        '<div class="tax-rate"><span class="woocommerce-Price-amount">20.00</span></div>'
    );
  }

  /**
   * @param {string} selector one pay-box class
   * @returns {boolean} whether that box is on screen
   */
  function shown(selector) {
    const $box = $(".twoinc-pay-box" + selector);
    return $box.length > 0 && !$box.hasClass("hidden");
  }

  /** Put a declined verdict on screen, as a completed earlier check would. */
  function showStaleDecline() {
    dom.togglePaySubtitleDesc("errored", ".twoinc-err-payment-default");
    expect(shown(".twoinc-err-payment-default")).toBe(true);
  }

  describe("a new check clears the previous verdict immediately", () => {
    test("arming a check hides a stale decline and shows the loader in the same call", () => {
      showStaleDecline();

      instance.getApproval();

      // No timer advanced: this is the point. Before the fix the decline
      // stayed until the RESPONSE came back, which is at best two ticks and a
      // round trip away.
      expect(shown(".twoinc-err-payment-default")).toBe(false);
      expect(shown(".twoinc-loader")).toBe(true);
    });

    test("arming a check hides a stale approval too", () => {
      dom.togglePaySubtitleDesc("intent-approved");
      expect(shown(".twoinc-intent-approved")).toBe(true);

      instance.getApproval();

      expect(shown(".twoinc-intent-approved")).toBe(false);
      expect(shown(".twoinc-loader")).toBe(true);
    });

    test("and hides a stale phone-number error", () => {
      dom.togglePaySubtitleDesc("errored", ".twoinc-err-phone-number");
      expect(shown(".twoinc-err-phone-number")).toBe(true);

      instance.getApproval();

      expect(shown(".twoinc-err-phone-number")).toBe(false);
    });

    test("a second call while a check is already armed still clears", () => {
      // The interval guard returns early on this path, so the clearing has to
      // sit ABOVE it. A call arriving now is a newer question than the one in
      // flight, so the older verdict is stale either way.
      instance.getApproval();
      expect(instance.orderIntentCheck.interval).not.toBeNull();
      // Through showStaleDecline() for its positive control (review round 1):
      // `shown()` is false both for a hidden box and for a box that does not
      // exist, so without asserting the box is UP first, a typo in the selector
      // made the assertion below pass on nothing.
      showStaleDecline();

      instance.getApproval();

      expect(instance.orderIntentCheck.pendingCheck).toBe(true);
      expect(shown(".twoinc-err-payment-default")).toBe(false);
      expect(shown(".twoinc-loader")).toBe(true);
    });

    test("a brand with the notice suppressed has no loader, and still gets the clearing", () => {
      // 'intent_approved_notice_enabled: false' => the PHP renderer emits no
      // loader div at all (TWO-25224). The clearing half must survive that:
      // holding a stale verdict is not the behaviour a merchant opted into by
      // declining the reassurance copy.
      $(".twoinc-pay-box.twoinc-loader").remove();
      showStaleDecline();

      instance.getApproval();

      expect($(".twoinc-pay-box.twoinc-loader").length).toBe(0);
      expect(shown(".twoinc-err-payment-default")).toBe(false);
    });

    test("no check, no loader: an incomplete company leaves the tile untouched", () => {
      // The clearing sits BELOW the readiness guard on purpose. A buyer who
      // has not finished filling the form has not asked a new question, so
      // whatever is on screen is still the answer to the last one they did.
      showStaleDecline();
      instance.customerCompany.organization_number = "";

      instance.getApproval();

      expect(shown(".twoinc-err-payment-default")).toBe(true);
      expect(shown(".twoinc-loader")).toBe(false);
      expect(instance.orderIntentCheck.interval).toBeNull();
    });
  });

  describe("the loader survives the paths that reset every pay-box", () => {
    test("updateElements() leaves the loader on screen, not blank", () => {
      // Positive control (review round 2): `shown()` is false for a hidden box
      // AND for one that is not there, so the loader has to be proven absent
      // before it is proven present, or a selector typo passes.
      expect(shown(".twoinc-loader")).toBe(false);

      // `updateElements()` runs a blanket hide-everything reset and arms an
      // approval pass. Run in the old order — approval first — the reset
      // immediately hid the loader the approval pass had just shown, and the
      // buyer saw nothing for a second. This is the ordering assertion; it
      // fails if the two calls are swapped back.
      instance.updateElements();

      expect(shown(".twoinc-loader")).toBe(true);
    });

    test("updateElements() still clears a stale verdict", () => {
      showStaleDecline();

      instance.updateElements();

      expect(shown(".twoinc-err-payment-default")).toBe(false);
    });

    test("updateElements() clears a stale approval too", () => {
      // Its own test rather than a second assertion on the one above: asserting
      // the approved box is hidden without ever showing it passes on an absent
      // element (review round 1).
      dom.togglePaySubtitleDesc("intent-approved");
      expect(shown(".twoinc-intent-approved")).toBe(true);

      instance.updateElements();

      expect(shown(".twoinc-intent-approved")).toBe(false);
    });
  });

  describe("the loader is not left running when the check is not", () => {
    test("a check abandoned at the tick takes the loader down with it", () => {
      const ajax = harness.stubAjax($);
      try {
        instance.getApproval();
        expect(shown(".twoinc-loader")).toBe(true);

        // The buyer empties a required field in the second between the check
        // being armed and the tick firing. Without the reset the tile reads
        // "Checking availability" for the rest of the page, with nothing
        // running behind it.
        instance.customerCompany.organization_number = "";
        jest.advanceTimersByTime(1000);

        expect(shown(".twoinc-loader")).toBe(false);
        // Proof the box is still THERE, so the assertion above is about it being
        // hidden and not about a mistyped selector (review round 2).
        expect($(".twoinc-pay-box.twoinc-loader").length).toBe(1);
        expect(ajax.calls.length).toBe(0);
      } finally {
        ajax.restore();
      }
    });

    test("an approved response replaces the loader with the approved notice", () => {
      const ajax = harness.stubAjax($);
      try {
        instance.getApproval();
        jest.advanceTimersByTime(1000);

        expect(ajax.calls.length).toBe(1);
        expect(ajax.calls[0].url).toContain("/v1/order_intent");
        expect(shown(".twoinc-loader")).toBe(true);

        ajax.last().succeed({ approved: true });
        // processOrderIntentResponse defers the render on its own 1s interval,
        // waiting out any WooCommerce checkout re-render.
        jest.advanceTimersByTime(1000);

        expect(shown(".twoinc-loader")).toBe(false);
        expect(shown(".twoinc-intent-approved")).toBe(true);
        expect($(".twoinc-pay-box.twoinc-intent-approved").text()).toBe(
          "ACME Widgets Ltd (12345678)"
        );
      } finally {
        ajax.restore();
      }
    });

    test("a declined response replaces the loader with the decline", () => {
      const ajax = harness.stubAjax($);
      try {
        instance.getApproval();
        jest.advanceTimersByTime(1000);
        // Loader-up asserted here too, not only on the approved path (review
        // round 1) — otherwise "loader down afterwards" is one-sided.
        expect(shown(".twoinc-loader")).toBe(true);
        expect($(":input[value='" + GATEWAY_ID + "']").prop("checked")).toBe(true);

        ajax.last().succeed({ approved: false });
        jest.advanceTimersByTime(1000);

        expect(shown(".twoinc-loader")).toBe(false);
        expect(shown(".twoinc-err-payment-default")).toBe(true);
        expect($(".twoinc-pay-box.twoinc-err-payment-default").text()).toBe(
          "ACME Widgets Ltd (12345678)"
        );
        // The gateway is deselected under the buyer (review round 2). This is
        // the behaviour the failure boxes' `role="alert"` — assertive, not
        // polite — is justified by, and it was asserted nowhere: settling
        // through the real deferred is what reaches it, since
        // processOrderIntentResponse() alone does not deselect.
        expect($(":input[value='" + GATEWAY_ID + "']").prop("checked")).toBe(false);
      } finally {
        ajax.restore();
      }
    });

    /**
     * Arm a real check, let the loader go up, then hand the response handler the
     * failure jqXHR directly.
     *
     * Direct rather than through `stubAjax`'s `fail()`, deliberately: that helper
     * models a jQuery TIMEOUT/abort, which reports `status: 0`, and both branches
     * under test here are gated on `status >= 400`. Driving it through the stub
     * would take the generic path and prove nothing. What is passed is the same
     * object shape the real `.fail` handler passes on — the jqXHR itself.
     *
     * The third argument is the failure flag the real `.fail` handler passes:
     * which jQuery callback we came from is a fact only the caller has, and
     * sniffing it off the payload read a `status` field in a 200 response BODY as
     * an HTTP status (review round 3).
     *
     * @param {Object} ajax the stubAjax recorder
     * @param {Object} response synthetic jqXHR
     * @returns {void}
     */
    function failTheCheckWith(ajax, response) {
      instance.getApproval();
      jest.advanceTimersByTime(1000);
      expect(ajax.calls.length).toBe(1);
      expect(shown(".twoinc-loader")).toBe(true);

      instance.processOrderIntentResponse(response, "hash-" + response.status, true);
      jest.advanceTimersByTime(1000);
    }

    test("a 502 with no JSON body still lands a verdict, and does not strand the loader", () => {
      // A proxy 502 carrying an HTML error page reaches the handler with
      // `responseJSON` undefined, and `"error_details" in undefined` is a
      // TypeError. The throw happened BEFORE the only code that renders a verdict
      // and takes the loader down, so the tile spun forever. Pre-existing, but
      // the loader now goes up a second earlier and is the thing that cleared the
      // previous verdict, so a stranded loader is now the whole tile (review
      // round 1).
      const ajax = harness.stubAjax($);
      try {
        failTheCheckWith(ajax, { approved: false, status: 502 });

        expect(shown(".twoinc-loader")).toBe(false);
        expect(shown(".twoinc-err-payment-default")).toBe(true);
      } finally {
        ajax.restore();
      }
    });

    test("an error_code-only failure body still routes to the phone box", () => {
      // The `error_code` fallback was rewritten in round 1 (`"x" in obj && obj.x`
      // -> `obj.x`) and covered by nothing — deleting the whole branch passed
      // every test (review round 2).
      const ajax = harness.stubAjax($);
      try {
        failTheCheckWith(ajax, {
          approved: false,
          status: 400,
          responseJSON: { error_code: "Invalid phone number" }
        });

        expect(shown(".twoinc-err-phone-number")).toBe(true);
        expect(shown(".twoinc-err-payment-default")).toBe(false);
      } finally {
        ajax.restore();
      }
    });

    test("a real transport failure deselects the gateway", () => {
      // The fail handler's own deselection, reached through the real deferred —
      // `failTheCheckWith()` calls processOrderIntentResponse() directly and so
      // cannot see it (review round 2).
      const ajax = harness.stubAjax($);
      try {
        instance.getApproval();
        jest.advanceTimersByTime(1000);
        expect($(":input[value='" + GATEWAY_ID + "']").prop("checked")).toBe(true);

        ajax.last().fail("error", "error");
        jest.advanceTimersByTime(1000);

        expect($(":input[value='" + GATEWAY_ID + "']").prop("checked")).toBe(false);
        expect(shown(".twoinc-loader")).toBe(false);
        expect(shown(".twoinc-err-payment-default")).toBe(true);
      } finally {
        ajax.restore();
      }
    });

    test("an invalid-phone-number failure shows the phone box, not the generic one", () => {
      // The ONLY route to `.twoinc-err-phone-number` called
      // `invalidFields.append()`, which Array does not have — so it threw every
      // time and that box has never once been on screen. It gets its red border
      // in this pass, which would have been styling unreachable UI (review round
      // 1).
      const ajax = harness.stubAjax($);
      try {
        failTheCheckWith(ajax, {
          approved: false,
          status: 400,
          responseJSON: { error_details: "Invalid phone number" }
        });

        expect(shown(".twoinc-err-phone-number")).toBe(true);
        // Positive controls, so "the generic box is not showing" cannot pass on a
        // missing element (review round 2).
        expect($(".twoinc-pay-box.twoinc-err-payment-default").length).toBe(1);
        expect(shown(".twoinc-err-payment-default")).toBe(false);
        expect($(".twoinc-pay-box.twoinc-loader").length).toBe(1);
        expect(shown(".twoinc-loader")).toBe(false);
        // The field the message is about is marked up as invalid alongside it.
        expect($("#billing_phone_field").hasClass("woocommerce-invalid")).toBe(true);
      } finally {
        ajax.restore();
      }
    });

    test("no readable cart total gives up rather than spinning forever", () => {
      // A 100%-discounted cart reads a total of 0, which is falsy on every tick,
      // and a theme whose totals markup getPrice() cannot read never yields one
      // at all. The interval retried indefinitely — invisible before, a spinner
      // that never resolves now (review round 1).
      const ajax = harness.stubAjax($);
      try {
        $(".order-total").remove();
        instance.getApproval();
        expect(shown(".twoinc-loader")).toBe(true);

        jest.advanceTimersByTime(9000);
        expect(shown(".twoinc-loader")).toBe(true);
        expect(instance.orderIntentCheck.interval).not.toBeNull();

        jest.advanceTimersByTime(1000);
        expect(shown(".twoinc-loader")).toBe(false);
        expect(instance.orderIntentCheck.interval).toBeNull();
        expect(ajax.calls.length).toBe(0);

        // And the counter is reset for the NEXT check, which is the only reason
        // the reset in getApproval() exists (review round 2). Left at 10, a
        // second price wait would give up after a single tick.
        instance.getApproval();
        jest.advanceTimersByTime(9000);
        expect(shown(".twoinc-loader")).toBe(true);
        jest.advanceTimersByTime(1000);
        expect(shown(".twoinc-loader")).toBe(false);
      } finally {
        ajax.restore();
      }
    });
  });

  describe("a cached verdict disarms the check instead of re-rendering forever", () => {
    /**
     * Run one real check to completion so its request body is in
     * `orderIntentLog`. Only a NON-approved verdict is cached — the approved
     * branch never writes the log — so this declines.
     *
     * @param {Object} ajax the stubAjax recorder
     * @returns {void}
     */
    function completeADeclinedCheck(ajax) {
      instance.getApproval();
      jest.advanceTimersByTime(1000);
      ajax.last().succeed({ approved: false });
      jest.advanceTimersByTime(1000);
      expect(shown(".twoinc-err-payment-default")).toBe(true);
      expect(instance.orderIntentCheck.interval).toBeNull();
    }

    test("the cached branch clears the timer and the pendingCheck flag", () => {
      // It used to return with the interval still armed, which left
      // `pendingCheck` permanently true — the guard in getApproval() sets it
      // whenever an interval exists, and nothing could ever clear it. The 3s
      // poller in initialize() then re-entered getApproval() indefinitely.
      const ajax = harness.stubAjax($);
      try {
        completeADeclinedCheck(ajax);

        // Same company, same cart => same request body => cache hit.
        instance.getApproval();
        expect(shown(".twoinc-loader")).toBe(true);
        expect(shown(".twoinc-err-payment-default")).toBe(false);

        jest.advanceTimersByTime(1000);

        expect(shown(".twoinc-err-payment-default")).toBe(true);
        expect(shown(".twoinc-loader")).toBe(false);
        expect(instance.orderIntentCheck.interval).toBeNull();
        expect(instance.orderIntentCheck.pendingCheck).toBe(false);
        // No second request: the answer was already in hand.
        expect(ajax.calls.length).toBe(1);
      } finally {
        ajax.restore();
      }
    });

    test("the cached verdict is not re-rendered on a loop", () => {
      // With the timer left armed the cached branch repainted every second
      // forever. Ten seconds of quiet is what "disarmed" looks like from
      // outside.
      const ajax = harness.stubAjax($);
      try {
        completeADeclinedCheck(ajax);
        instance.getApproval();
        jest.advanceTimersByTime(1000);
        expect(shown(".twoinc-err-payment-default")).toBe(true);

        // Hide it by hand. If anything is still ticking, it comes back.
        $(".twoinc-pay-box").addClass("hidden");
        jest.advanceTimersByTime(10000);

        expect(shown(".twoinc-err-payment-default")).toBe(false);
        expect(shown(".twoinc-loader")).toBe(false);
      } finally {
        ajax.restore();
      }
    });

    test("a pendingCheck re-arm re-enters the loading state at the tick", () => {
      // This is what the second, re-asserted `checking-intent` call inside the
      // interval body is for: the re-armed pass arrives through the guard, which
      // returns without touching the timer, so the tick is where the loading
      // state has to be true again. Round 1 shipped that line with no test at
      // all — deleting it failed nothing.
      const ajax = harness.stubAjax($);
      try {
        instance.getApproval();
        instance.getApproval();
        expect(instance.orderIntentCheck.pendingCheck).toBe(true);

        // Hide everything, so the tick's own call is the only thing that can put
        // the loader back.
        $(".twoinc-pay-box").addClass("hidden");
        jest.advanceTimersByTime(1000);

        expect(shown(".twoinc-loader")).toBe(true);
        expect(ajax.calls.length).toBe(1);
      } finally {
        ajax.restore();
      }
    });
  });

  describe("the ways a check ends without a response", () => {
    // Driven through the REAL delegated handlers, not by calling
    // abandonOrderIntentCheck() directly: the defect being fixed is that those
    // two handlers disarmed the timer and said nothing about the UI, so a test
    // that calls the method itself would pass with the handlers still wired to
    // the old inline three lines.
    //
    // `initialize()` needs two things this suite's fixture does not otherwise
    // have: the `#order_review` gate it returns on, and the gateway radio by id.
    let ajax;

    beforeEach(() => {
      $("form[name='checkout']").after('<div id="order_review"></div>');
      // The handler is delegated on document.body, so the click has to bubble
      // from a real #place_order element — without one the trigger is a no-op
      // and the test would pass on nothing having happened.
      $("form[name='checkout']").append(
        '<button type="submit" id="place_order">Place order</button>'
      );
      $("form[name='checkout']").append(
        "<input type='radio' id='payment_method_" +
          GATEWAY_ID +
          "' name='payment_method' value='" +
          GATEWAY_ID +
          "' checked />"
      );
      // initialize() builds a real selectWoo widget whose transport would reach
      // for the network, and arms its own 1s bootstrap pass.
      ajax = harness.stubAjax($);
      instance.initialize(false);
      // Take the tile back to a known state: initialize()'s own passes may have
      // armed a check of their own.
      instance.abandonOrderIntentCheck();
      ajax.calls.length = 0;
    });

    afterEach(() => {
      ajax.restore();
      // initialize() binds delegated handlers on document.body, which outlives
      // the test — wiping innerHTML leaves them live for the next one.
      $(document.body).off();
    });

    for (const trigger of [
      {
        name: "Place Order is clicked inside the arming window",
        fire: () => $("#place_order").trigger("click")
      },
      { name: "checkout_error fires", fire: () => $(document.body).trigger("checkout_error") }
    ]) {
      test("the loader comes down when " + trigger.name, () => {
        instance.getApproval();
        expect(shown(".twoinc-loader")).toBe(true);

        trigger.fire();

        expect(shown(".twoinc-loader")).toBe(false);
        expect(instance.orderIntentCheck.interval).toBeNull();
        expect(instance.orderIntentCheck.pendingCheck).toBe(false);

        // And nothing is left ticking behind it. `checkout_error` is the worse of
        // the two to get wrong: it does not trigger `updated_checkout`, so
        // nothing re-renders the tile afterwards and the spinner would sit beside
        // the validation errors for the rest of the page.
        jest.advanceTimersByTime(10000);
        expect(shown(".twoinc-loader")).toBe(false);
        expect(ajax.calls.length).toBe(0);
      });
    }
  });

  describe("the verdict paint waits out a checkout re-render, but not forever", () => {
    /** Put WooCommerce's own blocking overlay up, which is what the wait is for. */
    function blockCheckout() {
      $(document.body).append('<div id="payment"><div class="blockOverlay"></div></div>');
    }

    test("a verdict is held back while the overlay is up", () => {
      const ajax = harness.stubAjax($);
      try {
        blockCheckout();
        instance.getApproval();
        jest.advanceTimersByTime(1000);
        ajax.last().succeed({ approved: true });

        jest.advanceTimersByTime(5000);

        // Painting into the payment box mid-re-render loses the verdict:
        // `updated_checkout` rebuilds that box.
        expect(shown(".twoinc-intent-approved")).toBe(false);
        expect(shown(".twoinc-loader")).toBe(true);

        $("#payment .blockOverlay").remove();
        jest.advanceTimersByTime(1000);

        expect(shown(".twoinc-intent-approved")).toBe(true);
        expect(shown(".twoinc-loader")).toBe(false);
      } finally {
        ajax.restore();
      }
    });

    test("an overlay that never clears gives up rather than spinning forever", () => {
      // This wait is the ONLY code that takes the loading state down, so an
      // overlay stuck up meant "Checking availability" for the rest of the page —
      // the same defect the cart-total wait was bounded for in round 1, left
      // unbounded here (review round 2).
      const ajax = harness.stubAjax($);
      try {
        blockCheckout();
        instance.getApproval();
        jest.advanceTimersByTime(1000);
        ajax.last().succeed({ approved: true });

        jest.advanceTimersByTime(9000);
        expect(shown(".twoinc-loader")).toBe(true);

        jest.advanceTimersByTime(1000);
        expect(shown(".twoinc-loader")).toBe(false);
        expect(shown(".twoinc-intent-approved")).toBe(false);
        expect(instance.orderIntentCheck.renderInterval).toBeNull();
      } finally {
        ajax.restore();
      }
    });

    test("abandoning the check cancels a pending paint, so no verdict lands afterwards", () => {
      // The wait used to be held in a local, unreachable from
      // abandonOrderIntentCheck(): a Place Order click reset the tile and an
      // orphan copy of the wait then painted a verdict back onto a checkout
      // already mid-submit, with the gateway radio already deselected (review
      // round 2).
      const ajax = harness.stubAjax($);
      try {
        blockCheckout();
        instance.getApproval();
        jest.advanceTimersByTime(1000);
        ajax.last().succeed({ approved: true });
        expect(instance.orderIntentCheck.renderInterval).not.toBeNull();

        instance.abandonOrderIntentCheck();
        $("#payment .blockOverlay").remove();
        jest.advanceTimersByTime(10000);

        expect(shown(".twoinc-intent-approved")).toBe(false);
        expect($(".twoinc-pay-box.twoinc-intent-approved").length).toBe(1);
        expect(shown(".twoinc-loader")).toBe(false);
      } finally {
        ajax.restore();
      }
    });
  });

  describe("what gets cached, and against which request", () => {
    test("a superseded response is ignored outright — not painted, not cached", () => {
      // The interval is disarmed BEFORE the request goes out, so a second check
      // can be armed while the first is in flight, and the two can arrive in
      // either order.
      //
      // Round 2 fixed only the FILING of this (the hash used to be one shared
      // slot, so the first response was cached under the second body). Round 3
      // found the older response was still being ACTED on: arriving last it won,
      // and the buyer read a verdict about a cart they had already changed. So
      // the assertion is not "two entries" any more — it is that the stale answer
      // has no effect at all, and only the newest one paints.
      const ajax = harness.stubAjax($);
      try {
        instance.getApproval();
        jest.advanceTimersByTime(1000);
        expect(ajax.calls.length).toBe(1);

        // A different cart total => a different request body => a different hash.
        $(".order-total .woocommerce-Price-amount").text("250.00");
        instance.getApproval();
        jest.advanceTimersByTime(1000);
        expect(ajax.calls.length).toBe(2);

        // Newest settles first, and is what the buyer must end up reading.
        ajax.calls[1].succeed({ approved: false });
        jest.advanceTimersByTime(1000);
        expect(shown(".twoinc-err-payment-default")).toBe(true);
        expect(Object.keys(instance.orderIntentLog).length).toBe(1);

        // The superseded one settles afterwards, approving. Before round 3 this
        // repainted the tile as APPROVED — the buyer would have been told a cart
        // total they no longer had was fine.
        ajax.calls[0].succeed({ approved: true });
        jest.advanceTimersByTime(1000);

        expect(shown(".twoinc-intent-approved")).toBe(false);
        expect($(".twoinc-pay-box.twoinc-intent-approved").length).toBe(1);
        expect(shown(".twoinc-err-payment-default")).toBe(true);
        expect(Object.keys(instance.orderIntentLog).length).toBe(1);
      } finally {
        ajax.restore();
      }
    });

    test("a request that never settles times out rather than spinning forever", () => {
      // Both the loader coming down and the verdict appearing hang off the ajax
      // handlers, and a request that never settles calls neither — so a hung
      // connection meant "Checking availability" for the rest of the page. The
      // company-search transport was already bounded; this one was not (review
      // round 3).
      const ajax = harness.stubAjax($);
      try {
        instance.getApproval();
        jest.advanceTimersByTime(1000);

        expect(ajax.calls.length).toBe(1);
        expect(ajax.calls[0].timeout).toBe(30000);
      } finally {
        ajax.restore();
      }
    });

    test("a timed-out request paints a decline and is not cached", () => {
      // jQuery reports a timeout as a `.fail` with status 0, which must reach the
      // buyer as the generic "not available" — but must NOT be remembered as one.
      const ajax = harness.stubAjax($);
      try {
        instance.getApproval();
        jest.advanceTimersByTime(1000);

        ajax.last().fail("timeout", "timeout");
        jest.advanceTimersByTime(1000);

        expect(shown(".twoinc-loader")).toBe(false);
        expect(shown(".twoinc-err-payment-default")).toBe(true);
        expect(Object.keys(instance.orderIntentLog).length).toBe(0);
      } finally {
        ajax.restore();
      }
    });

    for (const status of [401, 403, 408, 429]) {
      test("a " + status + " means ask again, so it is not cached", () => {
        // Round 2 cached the whole 4xx range as verdicts. These four mean "ask
        // again" rather than "no" — a refreshable session or key, a server-side
        // timeout, rate limiting — and caching one froze the decline in place for
        // the rest of the page, because the cached branch issues no request
        // (review round 3).
        const ajax = harness.stubAjax($);
        try {
          instance.getApproval();
          jest.advanceTimersByTime(1000);
          instance.processOrderIntentResponse({ approved: false, status: status }, "h", true);

          expect(instance.orderIntentLog["h"]).toBeUndefined();
        } finally {
          ajax.restore();
        }
      });
    }

    test("a declining 200 is never routed by its body's own `status` field", () => {
      // Mutation survivor found while verifying round 3: dropping the `isFailure`
      // gate on the HTTP-status branch failed nothing. A 200 response BODY
      // carrying `status: 400` and an `error_details` string was being read as an
      // HTTP 400 and routed to the phone-number box — a wrong message on a
      // perfectly good response, and `billing_phone` marked invalid for no reason.
      const ajax = harness.stubAjax($);
      try {
        instance.getApproval();
        jest.advanceTimersByTime(1000);

        ajax.last().succeed({
          approved: false,
          status: 400,
          error_details: "Invalid phone number",
          responseJSON: { error_details: "Invalid phone number" }
        });
        jest.advanceTimersByTime(1000);

        expect(shown(".twoinc-err-payment-default")).toBe(true);
        expect($(".twoinc-pay-box.twoinc-err-phone-number").length).toBe(1);
        expect(shown(".twoinc-err-phone-number")).toBe(false);
        expect($("#billing_phone_field").hasClass("woocommerce-invalid")).toBe(false);
      } finally {
        ajax.restore();
      }
    });

    test("a declining 200 whose body happens to carry a `status` field is still cached", () => {
      // jQuery hands `.done` the parsed response BODY, so a field called `status`
      // in a perfectly good 200 was being read as an HTTP status — routing it down
      // the HTTP-error branch and, for a 5xx-looking value, refusing to cache a
      // real verdict (review round 3). Which callback we came from is the fact
      // that decides this, and only the caller knows it.
      const ajax = harness.stubAjax($);
      try {
        instance.getApproval();
        jest.advanceTimersByTime(1000);

        ajax.last().succeed({ approved: false, status: 503 });
        jest.advanceTimersByTime(1000);

        expect(shown(".twoinc-err-payment-default")).toBe(true);
        expect(Object.keys(instance.orderIntentLog).length).toBe(1);
      } finally {
        ajax.restore();
      }
    });

    test("a transport failure is not cached, so the next check retries", () => {
      // A dropped connection is not a verdict. Cached, it declined this cart and
      // company for the rest of the page — permanently, since the cached branch
      // disarms and no request is ever retried. One blip would lose the sale
      // (review round 2).
      const ajax = harness.stubAjax($);
      try {
        instance.getApproval();
        jest.advanceTimersByTime(1000);
        ajax.last().fail("error", "error");
        jest.advanceTimersByTime(1000);

        expect(shown(".twoinc-err-payment-default")).toBe(true);
        expect(Object.keys(instance.orderIntentLog).length).toBe(0);

        // Same body as before: a cached entry would answer it without a request.
        instance.getApproval();
        jest.advanceTimersByTime(1000);
        expect(ajax.calls.length).toBe(2);
      } finally {
        ajax.restore();
      }
    });

    test("a 4xx business decline IS cached", () => {
      // The backend declining with a reason is an answer, and re-asking it on
      // every checkout re-render is what the cache exists to avoid. Pinned so the
      // guard above cannot be widened into "never cache".
      const ajax = harness.stubAjax($);
      try {
        instance.getApproval();
        jest.advanceTimersByTime(1000);
        instance.processOrderIntentResponse(
          { approved: false, status: 422, responseJSON: { error_code: "TOO_BIG" } },
          "hash-422",
          true
        );

        expect(instance.orderIntentLog["hash-422"]).toBe("errored|.twoinc-err-payment-default");
      } finally {
        ajax.restore();
      }
    });
  });

  describe("nothing in flight means nothing to reset", () => {
    test("a checkout error unrelated to this gateway leaves a good verdict alone", () => {
      // `#place_order` fires on clicks that never submit (an HTML5 constraint
      // failure, WooCommerce's own validation) and `checkout_error` fires for a
      // missing postcode. Resetting unconditionally wiped a perfectly good
      // verdict, and neither event fires `updated_checkout`, so nothing brought
      // it back (review round 2).
      dom.togglePaySubtitleDesc("intent-approved");
      expect(shown(".twoinc-intent-approved")).toBe(true);
      expect(instance.orderIntentCheck.interval).toBeNull();

      instance.abandonOrderIntentCheck();

      expect(shown(".twoinc-intent-approved")).toBe(true);
    });

    test("but a check that WAS in flight is still reset", () => {
      instance.getApproval();
      expect(shown(".twoinc-loader")).toBe(true);

      instance.abandonOrderIntentCheck();

      expect(shown(".twoinc-loader")).toBe(false);
    });
  });

  describe("a response arriving after the check was abandoned does nothing", () => {
    test("Place Order orphans the in-flight response instead of painting it", () => {
      // The window between the interval being disarmed and the response arriving
      // is the whole duration of the XHR, and round 2's `wasRunning` gate read
      // every flag as falsy across it — so an abandon there skipped the reset and
      // left the loader up, then the response landed and deselected the gateway on
      // a checkout already mid-submit (review round 3).
      const ajax = harness.stubAjax($);
      try {
        instance.getApproval();
        jest.advanceTimersByTime(1000);
        expect(ajax.calls.length).toBe(1);
        expect(shown(".twoinc-loader")).toBe(true);

        // Nothing is ticking now — the interval is disarmed and the render wait
        // has not been armed — which is exactly why the gate needed a fourth flag.
        expect(instance.orderIntentCheck.interval).toBeNull();
        expect(instance.orderIntentCheck.renderInterval).toBeNull();
        expect(instance.orderIntentCheck.pendingCheck).toBe(false);

        instance.abandonOrderIntentCheck();
        expect(shown(".twoinc-loader")).toBe(false);

        // The orphaned response settles afterwards and must change nothing: no
        // verdict, no deselection, no cache entry.
        ajax.last().succeed({ approved: false });
        jest.advanceTimersByTime(10000);

        expect(shown(".twoinc-err-payment-default")).toBe(false);
        expect($(".twoinc-pay-box.twoinc-err-payment-default").length).toBe(1);
        expect(shown(".twoinc-loader")).toBe(false);
        expect($(":input[value='" + GATEWAY_ID + "']").prop("checked")).toBe(true);
        expect(Object.keys(instance.orderIntentLog).length).toBe(0);
      } finally {
        ajax.restore();
      }
    });

    test("the request is left to complete rather than aborted", () => {
      // Aborting would run `.fail`, which deselects the gateway and paints a
      // decline — doing that to a checkout the buyer has just submitted is worse
      // than letting the request finish unheard.
      const ajax = harness.stubAjax($);
      try {
        instance.getApproval();
        jest.advanceTimersByTime(1000);

        instance.abandonOrderIntentCheck();

        expect(ajax.calls[0].aborted).toBe(false);
      } finally {
        ajax.restore();
      }
    });

    test("a stuck overlay gives up on the paint without orphaning a newer check", () => {
      // The give-up used to call abandonOrderIntentCheck(), which also bumps the
      // supersession counter — so a newer check armed while this paint was waiting
      // was silently killed by an unrelated timeout (review round 3).
      const ajax = harness.stubAjax($);
      try {
        $(document.body).append('<div id="payment"><div class="blockOverlay"></div></div>');
        instance.getApproval();
        jest.advanceTimersByTime(1000);
        ajax.last().succeed({ approved: true });

        // A newer check is armed and issued while the first paint is blocked.
        $(".order-total .woocommerce-Price-amount").text("250.00");
        instance.getApproval();
        jest.advanceTimersByTime(1000);
        expect(ajax.calls.length).toBe(2);
        const seqInFlight = instance.orderIntentCheck.seq;

        // The blocked paint reaches its tenth tick and gives up.
        jest.advanceTimersByTime(9000);
        expect(shown(".twoinc-loader")).toBe(false);

        // The newer request has NOT been superseded by that give-up, so its
        // verdict still lands. Calling abandonOrderIntentCheck() here bumped the
        // counter and the buyer got no answer at all.
        expect(instance.orderIntentCheck.seq).toBe(seqInFlight);
        $("#payment .blockOverlay").remove();
        ajax.calls[1].succeed({ approved: false });
        jest.advanceTimersByTime(1000);

        expect(shown(".twoinc-err-payment-default")).toBe(true);
      } finally {
        ajax.restore();
      }
    });
  });

  describe("a verdict is announced, not silently swapped in", () => {
    /**
     * Record the order of mutations to one box: `attributes` when the `hidden`
     * class moves, `childList`/`characterData` when its sentence is written.
     *
     * @param {Element} node
     * @returns {{records: Array, stop: Function}}
     */
    function watch(node) {
      const records = [];
      const observer = new MutationObserver(function (list) {
        for (const record of list) records.push(record.type);
      });
      observer.observe(node, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true
      });
      return {
        records: records,
        stop: function () {
          observer.takeRecords().forEach((r) => records.push(r.type));
          observer.disconnect();
        }
      };
    }

    test("the box is revealed BEFORE its sentence is written", () => {
      // `role="status"`/`role="alert"` only announce a content change made while
      // the region is in the accessibility tree. Writing the sentence first and
      // revealing second mutated a region that was not in the tree, then revealed
      // one whose content had not changed — most likely no announcement at all
      // (review round 2). Both happen in one task, so the tree is computed once
      // and this is one announcement, not two.
      const box = document.querySelector(".twoinc-pay-box.twoinc-intent-approved");
      const seen = watch(box);

      dom.togglePaySubtitleDesc("intent-approved");
      seen.stop();

      const firstText = seen.records.findIndex((t) => t !== "attributes");
      const lastAttr = seen.records.lastIndexOf("attributes");
      expect(firstText).toBeGreaterThan(-1);
      expect(lastAttr).toBeLessThan(firstText);
      expect(box.classList.contains("hidden")).toBe(false);
      expect(box.textContent).toBe("ACME Widgets Ltd (12345678)");
    });

    test("re-showing the same verdict does not re-announce it", () => {
      // `.text()` replaces the child text node whether or not the string differs,
      // and that is a DOM mutation inside a live region — so the same verdict was
      // re-announced on every `updated_checkout` and every field blur that re-ran
      // the pass. An assertive region repeating "not available for this order"
      // each time the buyer edits a field is worse than the silence it replaced
      // (review round 3).
      dom.togglePaySubtitleDesc("errored", ".twoinc-err-payment-default");
      const box = document.querySelector(".twoinc-pay-box.twoinc-err-payment-default");
      expect(box.textContent).toBe("ACME Widgets Ltd (12345678)");

      const seen = watch(box);
      dom.togglePaySubtitleDesc("errored", ".twoinc-err-payment-default");
      seen.stop();

      // The class churn within one task is fine — it nets to no change, so the
      // accessibility tree is not disturbed. A text mutation is not.
      expect(seen.records.filter((t) => t !== "attributes")).toEqual([]);
      expect(box.textContent).toBe("ACME Widgets Ltd (12345678)");
    });

    test("but a CHANGED verdict is announced", () => {
      // The guard must not be so broad that a genuinely different sentence goes
      // out silently.
      dom.togglePaySubtitleDesc("errored", ".twoinc-err-payment-default");
      const box = document.querySelector(".twoinc-pay-box.twoinc-err-payment-default");

      $("#billing_company").val("Beta Traders Ltd");
      $("#company_id").val("87654321");
      const seen = watch(box);
      dom.togglePaySubtitleDesc("errored", ".twoinc-err-payment-default");
      seen.stop();

      expect(seen.records.filter((t) => t !== "attributes").length).toBeGreaterThan(0);
      expect(box.textContent).toBe("Beta Traders Ltd (87654321)");
    });

    test("the same holds for the declined box", () => {
      const box = document.querySelector(".twoinc-pay-box.twoinc-err-payment-default");
      const seen = watch(box);

      dom.togglePaySubtitleDesc("errored", ".twoinc-err-payment-default");
      seen.stop();

      const firstText = seen.records.findIndex((t) => t !== "attributes");
      const lastAttr = seen.records.lastIndexOf("attributes");
      expect(firstText).toBeGreaterThan(-1);
      expect(lastAttr).toBeLessThan(firstText);
      expect(box.textContent).toBe("ACME Widgets Ltd (12345678)");
    });
  });

  describe("the stylesheet paints what the classes promise", () => {
    // Against jsdom's REAL cascade rather than a grep over the CSS source
    // (review round 1). Three mutations passed a source-text check and fail
    // here: commenting out a declaration, adding a later overriding rule, and
    // wrapping a rule in an at-rule.
    //
    // TWO known gaps, both of which have already produced a green-but-wrong
    // assertion in this file, so do not assume a third one is safe:
    //
    //  - jsdom does NOT honour `!important` from an EARLIER rule. It resolved
    //    `.twoinc-loader.hidden` as `display: flex`, because the blanket
    //    `.hidden { display: none !important }` sits at the top of the
    //    stylesheet and the loader's `display: flex` below it — so the layout
    //    assertion below was measuring a state that never exists in a browser.
    //    Hence `unhidden()`, and hence the loader's own two-class hiding rule.
    //  - it does not lay out or animate anything. Whether the box is visible,
    //    whether the GIF moves — beyond this suite, needs a real browser. See
    //    the known gaps in tests/js/README.md.
    let injected;

    beforeEach(() => {
      injected = harness.injectStylesheet();
    });

    afterEach(() => {
      // One <style> per test otherwise accumulates and outlives
      // `document.body.innerHTML = ""`, which is latent ordering coupling for
      // whichever describe runs next.
      injected.remove();
    });

    /**
     * The computed style of a pay-box with `hidden` taken OFF.
     *
     * Every box in the fixture starts hidden, which is what production serves —
     * but `display: none` is not the state whose layout is being asserted, and
     * jsdom's `!important` gap means it does not even resolve to `none`
     * reliably. Unhide, then measure.
     *
     * @param {string} selector
     * @returns {CSSStyleDeclaration}
     */
    function unhidden(selector) {
      const node = document.querySelector(selector);
      expect(node).not.toBeNull();
      node.classList.remove("hidden");
      return window.getComputedStyle(node);
    }

    /**
     * @param {string} selector
     * @returns {CSSStyleDeclaration}
     */
    function styleOf(selector) {
      const node = document.querySelector(selector);
      expect(node).not.toBeNull();
      return window.getComputedStyle(node);
    }

    /**
     * `#rrggbb` as the `rgb(r, g, b)` jsdom normalises background and text
     * colours to.
     *
     * Border colours come back RAW from jsdom, unlike those two, so asserting
     * the hex literal made an equivalent `rgb()` notation in the stylesheet —
     * identical paint — fail the test. Normalising both sides asserts the
     * colour rather than how it was typed.
     *
     * @param {string} hex
     * @returns {string}
     */
    function rgb(hex) {
      const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
      expect(m).not.toBeNull();
      return (
        "rgb(" + parseInt(m[1], 16) + ", " + parseInt(m[2], 16) + ", " + parseInt(m[3], 16) + ")"
      );
    }

    /**
     * @param {CSSStyleDeclaration} style
     * @returns {string} the top border colour, normalised
     */
    function borderColour(style) {
      const raw = style.borderTopColor;
      return raw.charAt(0) === "#" ? rgb(raw) : raw;
    }

    test("the loader is hidden by a rule of its own, not only by an !important", () => {
      // The blanket `.hidden` is `display: none !important`, and the loader's
      // `display: flex` is a same-specificity declaration LATER in the file — so
      // without a two-class rule the loader's hiding rests entirely on that
      // `!important`, and tidying it away would leave a permanently visible
      // spinner on every checkout. jsdom resolves the two-class rule correctly,
      // which is what makes this assertable at all.
      expect(styleOf(".twoinc-pay-box.twoinc-loader").display).toBe("none");
    });

    test("the loader is a centred row: spinner, gap, sentence", () => {
      const row = unhidden(".twoinc-pay-box.twoinc-loader");
      expect(row.display).toBe("flex");
      expect(row.alignItems).toBe("center");
      expect(row.justifyContent).toBe("center");
      expect(row.gap).toBe("8px");
      expect(row.padding).toBe("12px 16px");
    });

    test("the spinner paints the shared GIF, once, at its native size", () => {
      const spinner = styleOf(".twoinc-loader__spinner");
      expect(spinner.backgroundImage).toContain("loader.gif");
      // Native 16x16, painted once and unscaled: an em-relative box would blur
      // it, and a tiled or resized background is a different (wrong) picture
      // that the URL assertion alone cannot see.
      expect(spinner.width).toBe("16px");
      expect(spinner.height).toBe("16px");
      expect(spinner.backgroundRepeat).toBe("no-repeat");
      expect(spinner.backgroundSize).toBe("16px 16px");
    });

    test("the sentence beside it is weighted to read as a status, not body copy", () => {
      expect(styleOf(".twoinc-loader__text").fontWeight).toBe("500");
    });

    test("the approved verdict is a green bordered box", () => {
      const box = unhidden(".twoinc-pay-box.twoinc-intent-approved");
      expect(box.backgroundColor).toBe(rgb("#d4edda"));
      expect(box.color).toBe(rgb("#155724"));
      expect(box.borderTopWidth).toBe("2px");
      expect(box.borderTopStyle).toBe("solid");
      expect(borderColour(box)).toBe(rgb("#28a745"));
    });

    test("both failure verdicts are red bordered boxes", () => {
      // The phone-number box included, deliberately: it is the one box with no
      // company template and no overflow-wrap, so it drops out of most selector
      // groups in this stylesheet legitimately and is the easy one to forget.
      for (const selector of [
        ".twoinc-pay-box.twoinc-err-payment-default",
        ".twoinc-pay-box.twoinc-err-phone-number"
      ]) {
        const box = unhidden(selector);
        expect(box.backgroundColor).toBe(rgb("#f8d7da"));
        expect(box.color).toBe(rgb("#721c24"));
        expect(box.borderTopWidth).toBe("2px");
        expect(box.borderTopStyle).toBe("solid");
        expect(borderColour(box)).toBe(rgb("#dc3545"));
      }
    });

    test("all three verdict boxes share one shape, so a verdict never resizes", () => {
      for (const selector of [
        ".twoinc-pay-box.twoinc-intent-approved",
        ".twoinc-pay-box.twoinc-err-payment-default",
        ".twoinc-pay-box.twoinc-err-phone-number"
      ]) {
        const box = unhidden(selector);
        expect(box.padding).toBe("16px");
        expect(box.borderRadius).toBe("8px");
        expect(box.marginTop).toBe("12px");
        expect(box.lineHeight).toBe("1.4");
        expect(box.fontSize).toBe("14px");
        expect(box.fontWeight).toBe("500");
      }
    });

    test("the two company-carrying boxes can wrap an unbroken registry name", () => {
      // Registry names in DE/NL/NO routinely contain a single unbroken token
      // wider than the tile column, and these two hold the company in their own
      // sentence (TWO-25326 §7.3).
      expect(unhidden(".twoinc-pay-box.twoinc-intent-approved").overflowWrap).toBe("anywhere");
      expect(unhidden(".twoinc-pay-box.twoinc-err-payment-default").overflowWrap).toBe("anywhere");
    });
  });
});
