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
      '<input type="radio" name="payment_method" value="' + GATEWAY_ID + '" checked />'
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
      dom.togglePaySubtitleDesc("errored", ".twoinc-err-payment-default");

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
  });
});
