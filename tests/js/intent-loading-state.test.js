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
        '<div class="twoinc-pay-box twoinc-loader hidden" role="status">' +
        '<span class="twoinc-loader__spinner" aria-hidden="true"></span>' +
        '<span class="twoinc-loader__text">Checking availability</span>' +
        "</div>" +
        '<div class="twoinc-pay-box twoinc-intent-approved hidden" data-company-template="{company}">' +
        "NO_COMPANY_APPROVED" +
        "</div>" +
        '<div class="twoinc-pay-box twoinc-err-payment-default hidden" data-company-template="{company}">' +
        "NO_COMPANY_DECLINED" +
        "</div>" +
        '<div class="twoinc-pay-box twoinc-err-phone-number hidden">Phone number is invalid.</div>' +
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

        ajax.last().succeed({ approved: false });
        jest.advanceTimersByTime(1000);

        expect(shown(".twoinc-loader")).toBe(false);
        expect(shown(".twoinc-err-payment-default")).toBe(true);
        expect($(".twoinc-pay-box.twoinc-err-payment-default").text()).toBe(
          "ACME Widgets Ltd (12345678)"
        );
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
     * @param {Object} ajax the stubAjax recorder
     * @param {Object} response synthetic jqXHR
     * @returns {void}
     */
    function failTheCheckWith(ajax, response) {
      instance.getApproval();
      jest.advanceTimersByTime(1000);
      expect(ajax.calls.length).toBe(1);
      expect(shown(".twoinc-loader")).toBe(true);

      instance.processOrderIntentResponse(response);
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
        expect(shown(".twoinc-err-payment-default")).toBe(false);
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

  describe("the stylesheet paints what the classes promise", () => {
    // Against jsdom's REAL cascade rather than a grep over the CSS source
    // (review round 1). Three separate mutations passed a source-text check:
    // commenting out a declaration, adding a later overriding rule, and wrapping
    // a rule in an at-rule. jsdom resolves all three correctly. What it cannot
    // tell you is whether the result is visible or whether the GIF animates —
    // see tests/js/README.md's known gaps.
    beforeEach(() => {
      harness.injectStylesheet();
    });

    /**
     * @param {string} selector
     * @returns {CSSStyleDeclaration}
     */
    function styleOf(selector) {
      const node = document.querySelector(selector);
      expect(node).not.toBeNull();
      return window.getComputedStyle(node);
    }

    test("the loader is a centred row: spinner, gap, sentence", () => {
      const row = styleOf(".twoinc-pay-box.twoinc-loader");
      expect(row.display).toBe("flex");
      expect(row.alignItems).toBe("center");
      expect(row.justifyContent).toBe("center");
      expect(row.gap).toBe("8px");
    });

    test("the spinner paints the shared GIF at its native size", () => {
      const spinner = styleOf(".twoinc-loader__spinner");
      expect(spinner.backgroundImage).toContain("loader.gif");
      // Native 16x16 — scaling it with an em-relative box would blur it.
      expect(spinner.width).toBe("16px");
      expect(spinner.height).toBe("16px");
    });

    test("the approved verdict is a green bordered box", () => {
      const box = styleOf(".twoinc-pay-box.twoinc-intent-approved");
      expect(box.backgroundColor).toBe("rgb(212, 237, 218)");
      expect(box.color).toBe("rgb(21, 87, 36)");
      expect(box.borderTopWidth).toBe("2px");
      expect(box.borderTopStyle).toBe("solid");
      expect(box.borderTopColor).toBe("#28a745");
    });

    test("both failure verdicts are red bordered boxes", () => {
      // The phone-number box included, deliberately: it is the one box with no
      // company template and no overflow-wrap, so it drops out of most selector
      // groups in this stylesheet legitimately and is the easy one to forget.
      for (const selector of [
        ".twoinc-pay-box.twoinc-err-payment-default",
        ".twoinc-pay-box.twoinc-err-phone-number"
      ]) {
        const box = styleOf(selector);
        expect(box.backgroundColor).toBe("rgb(248, 215, 218)");
        expect(box.color).toBe("rgb(114, 28, 36)");
        expect(box.borderTopWidth).toBe("2px");
        expect(box.borderTopStyle).toBe("solid");
        expect(box.borderTopColor).toBe("#dc3545");
      }
    });

    test("all three verdict boxes share one shape, so a verdict never resizes", () => {
      for (const selector of [
        ".twoinc-pay-box.twoinc-intent-approved",
        ".twoinc-pay-box.twoinc-err-payment-default",
        ".twoinc-pay-box.twoinc-err-phone-number"
      ]) {
        const box = styleOf(selector);
        expect(box.padding).toBe("16px");
        expect(box.borderRadius).toBe("8px");
        expect(box.marginTop).toBe("12px");
        expect(box.lineHeight).toBe("1.4");
      }
    });

    test("the two company-carrying boxes can wrap an unbroken registry name", () => {
      // Registry names in DE/NL/NO routinely contain a single unbroken token
      // wider than the tile column, and these two hold the company in their own
      // sentence (TWO-25326 §7.3).
      expect(styleOf(".twoinc-pay-box.twoinc-intent-approved").overflowWrap).toBe("anywhere");
      expect(styleOf(".twoinc-pay-box.twoinc-err-payment-default").overflowWrap).toBe("anywhere");
    });
  });
});
