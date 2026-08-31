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
 * all, and the fifth (the company picker's own select handler) still left a
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
    harness.releasePanel(ctx.helper);
    jest.clearAllTimers();
    jest.useRealTimers();
    document.body.innerHTML = "";
  });

  // The four pay-boxes the PHP renderer emits into the payment tile, with the
  // same classes and the same `hidden` starting state. Text is a distinctive
  // marker rather than production copy: this suite is about WHICH box is on
  // screen, never about wording.
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

  // The two price nodes `getPrice()` reads. Without them the interval body
  // returns on `!gross_amount` before it ever reaches the check, so the request
  // assertions below would pass against a request that never happened.
  function buildCartTotals() {
    $(document.body).append(
      '<div class="order-total"><span class="woocommerce-Price-amount">120.00</span></div>' +
        '<div class="tax-rate"><span class="woocommerce-Price-amount">20.00</span></div>'
    );
  }

  function shown(selector) {
    const $box = $(".twoinc-pay-box" + selector);
    return $box.length > 0 && !$box.hasClass("hidden");
  }

  // Arms a check AND lets the interval issue its request, which is when the
  // loading state goes up — see `getApproval()`'s own comment for why.
  function issueACheck(ajax) {
    // Exact delta, not `> 0`: a regression that issues an extra request per
    // arming is precisely what "one request at a time" exists to stop, and a
    // floor would let it through every precondition in this file.
    const before = ajax.calls.length;
    instance.getApproval();
    jest.advanceTimersByTime(1000);
    expect(ajax.calls.length).toBe(before + 1);
    expect(shown(".twoinc-loader")).toBe(true);
  }

  // `togglePaySubtitleDesc()` cannot be used to stage a verdict ALONGSIDE a live
  // loader — painting a verdict hides the loader, by design. So the "clears the
  // verdict AND keeps the loader" tests need the box unhidden by hand, or their
  // clear-assertions are vacuous against a box that was never shown.
  function revealVerdictBox(selector) {
    $(".twoinc-pay-box" + selector).removeClass("hidden");
    expect(shown(selector)).toBe(true);
  }

  function showStaleDecline() {
    dom.togglePaySubtitleDesc("errored", ".twoinc-err-payment-default");
    expect(shown(".twoinc-err-payment-default")).toBe(true);
  }

  describe("the order-intent feature switch", () => {
    test("with order intent disabled, no check is ever armed or issued", () => {
      // The `enable_order_intent !== "yes"` gate was entirely unpinned: deleting the
      // block, and loosening it to a truthiness test, both survived. No suite anywhere
      // set the flag to anything but "yes" (review round 8). It is the merchant switch
      // for the whole of this ticket's UI, so "off stays off" is worth a test.
      const ajax = harness.stubAjax($);
      try {
        window.twoinc.enable_order_intent = "no";
        showStaleDecline();

        instance.getApproval();
        jest.advanceTimersByTime(10000);

        expect(ajax.calls.length).toBe(0);
        expect(instance.orderIntentCheck.interval).toBeNull();
        expect(shown(".twoinc-loader")).toBe(false);
        // And the tile is left exactly as it was — the switch being off is not a
        // reason to clear what is on screen.
        expect(shown(".twoinc-err-payment-default")).toBe(true);
      } finally {
        window.twoinc.enable_order_intent = "yes";
        ajax.restore();
      }
    });

    test("a company with a number but no name is not complete enough to check", () => {
      // `isReadyApprovalCheck()` ends in `!isAnyElementEmpty(values)`, and replacing
      // that with `return true` survived: the organisation-number guard above it is
      // pinned, so nothing exercised the array check — which exists for exactly this
      // case, a number present but the name or country blank (review round 8).
      const ajax = harness.stubAjax($);
      try {
        instance.customerCompany = {
          company_name: "",
          organization_number: "12345678",
          country_prefix: "GB"
        };

        instance.getApproval();
        jest.advanceTimersByTime(10000);

        expect(ajax.calls.length).toBe(0);
        expect(instance.orderIntentCheck.interval).toBeNull();
      } finally {
        ajax.restore();
      }
    });
  });

  describe("a new check clears the previous verdict immediately", () => {
    test("arming a check hides a stale decline in the same call", () => {
      showStaleDecline();

      instance.getApproval();

      // No timer advanced: this is the point. Before the fix the decline stayed
      // until the RESPONSE came back, which is at best two ticks and a round trip
      // away.
      expect(shown(".twoinc-err-payment-default")).toBe(false);
      // Positive control: the box is still there, so the line above is about it
      // being hidden and not about a mistyped selector.
      expect($(".twoinc-pay-box.twoinc-err-payment-default").length).toBe(1);
    });

    test("the loader follows with the request, not with the arming", () => {
      // Round 5 reverted showing the loader on arming: it decoupled the loading
      // state's lifetime from the request's, and four review rounds of stranded,
      // blanked and duplicated spinners came out of that one change. Tied to the
      // request, "the loader is up exactly while a request is outstanding" holds
      // by construction. The visible cost is this gap, which is why it is pinned
      // rather than left implicit.
      const ajax = harness.stubAjax($);
      try {
        showStaleDecline();

        instance.getApproval();
        expect(shown(".twoinc-loader")).toBe(false);
        expect(ajax.calls.length).toBe(0);

        jest.advanceTimersByTime(1000);

        expect(shown(".twoinc-loader")).toBe(true);
        expect(ajax.calls.length).toBe(1);
      } finally {
        ajax.restore();
      }
    });

    test("arming a check hides a stale approval too", () => {
      dom.togglePaySubtitleDesc("intent-approved");
      expect(shown(".twoinc-intent-approved")).toBe(true);

      instance.getApproval();

      expect(shown(".twoinc-intent-approved")).toBe(false);
      expect($(".twoinc-pay-box.twoinc-intent-approved").length).toBe(1);
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

  describe("a checkout re-render clears the verdict, not the loading state", () => {
    test("updateElements() does not blink off a loader for a request in flight", () => {
      // `updateElements()` runs on every `updated_checkout` — a coupon, a
      // shipping change — none of which bears on a request already outstanding.
      const ajax = harness.stubAjax($);
      try {
        issueACheck(ajax);

        instance.updateElements();

        expect(shown(".twoinc-loader")).toBe(true);
      } finally {
        ajax.restore();
      }
    });

    test("updateElements() still clears a stale verdict", () => {
      // On an INCOMPLETE form, deliberately (review round 5). With a complete one
      // this passed with `updateElements()`'s own clear deleted, because
      // `getApproval()` clears too — so it pinned nothing. Incomplete, getApproval()
      // takes its readiness early-return and this call is the only thing left that
      // can hide the box.
      showStaleDecline();
      instance.customerCompany.organization_number = "";

      instance.updateElements();

      expect(shown(".twoinc-err-payment-default")).toBe(false);
    });

    test("updateElements() clears a stale approval too", () => {
      // Its own test rather than a second assertion on the one above: asserting
      // the approved box is hidden without ever showing it passes on an absent
      // element (review round 1).
      dom.togglePaySubtitleDesc("intent-approved");
      expect(shown(".twoinc-intent-approved")).toBe(true);
      instance.customerCompany.organization_number = "";

      instance.updateElements();

      expect(shown(".twoinc-intent-approved")).toBe(false);
    });

    test("a verdict about a form the buyer has since broken does not survive", () => {
      // This is the behaviour the two tests above depend on, stated as its own
      // property (review round 5 asked whether it was wanted). It is: the verdict
      // named a company that is no longer captured, so leaving it up would have the
      // tile asserting something about a company the buyer has removed. The tile
      // going blank is correct and self-correcting — completing the form arms a
      // fresh check.
      showStaleDecline();
      $("#company_id").val("");
      instance.customerCompany.organization_number = "";

      instance.updateElements();
      jest.advanceTimersByTime(10000);

      expect(shown(".twoinc-err-payment-default")).toBe(false);
      expect(shown(".twoinc-intent-approved")).toBe(false);
      expect(shown(".twoinc-loader")).toBe(false);
    });
  });

  describe("the loader is not left running when the check is not", () => {
    test("a check abandoned before its request goes out issues nothing", () => {
      // The buyer empties a required field in the second between the check being
      // armed and the tick firing. No loader is up yet — it goes up with the
      // request — so what matters here is that no request is made and nothing is
      // left ticking.
      const ajax = harness.stubAjax($);
      try {
        instance.getApproval();
        expect(shown(".twoinc-loader")).toBe(false);

        instance.customerCompany.organization_number = "";
        jest.advanceTimersByTime(1000);

        expect(shown(".twoinc-loader")).toBe(false);
        expect($(".twoinc-pay-box.twoinc-loader").length).toBe(1);
        expect(ajax.calls.length).toBe(0);
        expect(instance.orderIntentCheck.interval).toBeNull();
      } finally {
        ajax.restore();
      }
    });

    test("a form that goes incomplete mid-request orphans it and clears the loader", () => {
      // The other half, and the one that strands a spinner: the request is already
      // out when the buyer empties a field. Its answer describes a form that no
      // longer exists, so it must not paint — and the loader must not sit there
      // waiting for it (review round 5).
      const ajax = harness.stubAjax($);
      try {
        issueACheck(ajax);

        instance.customerCompany.organization_number = "";
        instance.getApproval();

        expect(shown(".twoinc-loader")).toBe(false);
        expect(instance.orderIntentCheck.inFlightSeq).toBeNull();

        ajax.last().succeed({ approved: true });
        jest.advanceTimersByTime(10000);

        expect(shown(".twoinc-intent-approved")).toBe(false);
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
        expect(ajax.calls[0].url).toBe(harness.API_PROXY.order_intent_url);
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
     */
    function failTheCheckWith(ajax, response) {
      instance.getApproval();
      jest.advanceTimersByTime(1000);
      expect(ajax.calls.length).toBe(1);
      expect(shown(".twoinc-loader")).toBe(true);

      instance.processOrderIntentResponse(response, "hash-" + response.status, true);
      jest.advanceTimersByTime(1000);
    }

    test("a 200 whose body is null does not strand the loader", () => {
      // Every read of the response would be a TypeError, thrown AFTER
      // `stillCurrent()` has released `inFlightSeq`/`inFlightXhr` and BEFORE the paint
      // is armed — so the loader was up for the rest of the page with nothing able to
      // reset it, since the abandon gate reads false on every flag by then. Same class
      // as the round-1 `responseJSON` and `Array.append` throws, but on the SUCCESS
      // path, which those guards never covered (review round 8).
      const ajax = harness.stubAjax($);
      try {
        issueACheck(ajax);

        ajax.last().succeed(null);
        jest.advanceTimersByTime(1000);

        expect(shown(".twoinc-loader")).toBe(false);
        expect($(".twoinc-pay-box.twoinc-loader").length).toBe(1);
        // An unusable body is not an approval, so it reads as declined.
        expect(shown(".twoinc-err-payment-default")).toBe(true);
      } finally {
        ajax.restore();
      }
    });

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

    test("a cart total of ZERO gives up too, and posts nothing", () => {
      // `getPrice()` cannot return 0: `getPriceRecursively()` gates on `if
      // (val)`, so "0.00" is discarded as falsy and the walk falls through to
      // undefined — a zero total and absent markup are indistinguishable there.
      // The pre-existing consequence this records: a fully-discounted order can
      // never obtain a verdict. Its own ticket, in `getPrice`.
      const ajax = harness.stubAjax($);
      try {
        $(".order-total .woocommerce-Price-amount").text("0.00");
        instance.getApproval();

        jest.advanceTimersByTime(9000);
        expect(instance.orderIntentCheck.interval).not.toBeNull();

        jest.advanceTimersByTime(1000);
        expect(instance.orderIntentCheck.interval).toBeNull();
        expect(ajax.calls.length).toBe(0);
        expect(shown(".twoinc-loader")).toBe(false);
      } finally {
        ajax.restore();
      }
    });

    test("no readable cart total gives up rather than spinning forever", () => {
      // Absent totals markup — a theme `getPrice()` cannot read. Retrying leaks a
      // 1s timer for the life of the page and keeps `pendingCheck` alive with it.
      // No loader is involved: it goes up with the request, downstream of this.
      const ajax = harness.stubAjax($);
      try {
        $(".order-total").remove();
        instance.getApproval();

        jest.advanceTimersByTime(9000);
        expect(instance.orderIntentCheck.interval).not.toBeNull();

        jest.advanceTimersByTime(1000);
        expect(instance.orderIntentCheck.interval).toBeNull();
        expect(ajax.calls.length).toBe(0);
        expect(shown(".twoinc-loader")).toBe(false);

        // And the counter is reset for the NEXT check, which is the only reason
        // the reset in getApproval() exists (review round 2). Left at 10, a second
        // price wait would give up after a single tick.
        instance.getApproval();
        jest.advanceTimersByTime(9000);
        expect(instance.orderIntentCheck.interval).not.toBeNull();
        jest.advanceTimersByTime(1000);
        expect(instance.orderIntentCheck.interval).toBeNull();
      } finally {
        ajax.restore();
      }
    });
  });

  describe("a cached verdict disarms the check instead of re-rendering forever", () => {
    // Runs one real check to completion so its request body is in
    // `orderIntentLog`. Only a NON-approved verdict is cached — the approved
    // branch never writes the log — so this declines.
    function completeADeclinedCheck(ajax) {
      instance.getApproval();
      jest.advanceTimersByTime(1000);
      ajax.last().succeed({ approved: false });
      jest.advanceTimersByTime(1000);
      expect(shown(".twoinc-err-payment-default")).toBe(true);
      expect(instance.orderIntentCheck.interval).toBeNull();
    }

    test("the cached branch clears the timer and the pendingCheck flag", () => {
      // A cached branch returning with the interval armed pins `pendingCheck`
      // true for good, and initialize()'s 3s poller then re-enters for ever.
      const ajax = harness.stubAjax($);
      try {
        completeADeclinedCheck(ajax);

        // Same company, same cart => same request body => cache hit.
        instance.getApproval();
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
    // Driven through the REAL delegated handlers: calling
    // abandonOrderIntentCheck() directly passes however the handlers are wired.
    // `initialize()` needs the `#order_review` gate and the gateway radio by id.
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
      // initialize() builds the real search panel, whose transport would reach
      // for the network, and arms its own 1s bootstrap pass.
      ajax = harness.stubAjax($);
      instance.initialize(false);

      // Flush initialize()'s own 1s bootstrap BEFORE re-seeding. That pass
      // overwrites customerCompany/customerRepresentative from the DOM, and this
      // fixture carries no representative fields — so left to fire inside a test
      // it silently emptied the record and every later getApproval() no-opped on
      // an incomplete form, issuing no request at all.
      jest.advanceTimersByTime(1000);
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
        // The request has to be OUT for a loader to exist to take down: it goes up
        // with the request, not with the arming (review round 5).
        issueACheck(ajax);
        const issued = ajax.calls.length;

        trigger.fire();

        expect(shown(".twoinc-loader")).toBe(false);
        expect(instance.orderIntentCheck.inFlightSeq).toBeNull();

        // The superseded request is dropped rather than left running for an answer
        // nobody will read (review round 5).
        expect(ajax.calls[issued - 1].abortedWhilePending).toBe(true);

        // What happens NEXT differs between the two and is asserted separately
        // below: Place Order leaves the check disarmed (the buyer is leaving),
        // `checkout_error` re-arms (they are staying to fix a field).
      });
    }

    test("Place Order clicked BEFORE the first tick issues nothing at all", () => {
      // The parametrised tests above go through `issueACheck()`, which advances a
      // second first — so none of them is actually in the arming window, and
      // deleting `pendingCheck = false` from abandonOrderIntentCheck() survived the
      // whole suite (review round 5). Unset, the 3s poller re-arms a check on a
      // checkout already mid-submit.
      instance.getApproval();
      instance.getApproval();
      expect(instance.orderIntentCheck.pendingCheck).toBe(true);
      expect(ajax.calls.length).toBe(0);

      $("#place_order").trigger("click");

      expect(instance.orderIntentCheck.pendingCheck).toBe(false);
      expect(instance.orderIntentCheck.interval).toBeNull();

      // Ten seconds covers the 1s interval and three turns of the 3s poller.
      jest.advanceTimersByTime(10000);
      expect(ajax.calls.length).toBe(0);
      expect(shown(".twoinc-loader")).toBe(false);
    });

    test("Place Order leaves the check disarmed — nothing re-arms it", () => {
      // The buyer is leaving the page. There is no reason to ask again, and a
      // request racing the submit is what disarming here has always been about.
      issueACheck(ajax);

      $("#place_order").trigger("click");
      jest.advanceTimersByTime(10000);

      expect(instance.orderIntentCheck.interval).toBeNull();
      expect(shown(".twoinc-loader")).toBe(false);
    });

    test("checkout_error with nothing running leaves a good verdict alone", () => {
      // `abandonOrderIntentCheck()` is careful not to reset the tile when nothing was
      // running — and the unconditional re-arm then had `getApproval()`'s own clear
      // wipe the verdict anyway, with no repaint for at least a second, or at all
      // quickly for an approval (never cached). Every failed submit for an unrelated
      // reason — a missing postcode — flickered the box (review round 7).
      dom.togglePaySubtitleDesc("intent-approved");
      expect(shown(".twoinc-intent-approved")).toBe(true);
      expect(instance.orderIntentCheck.interval).toBeNull();
      expect(instance.orderIntentCheck.inFlightSeq).toBeNull();

      $(document.body).trigger("checkout_error");

      expect(shown(".twoinc-intent-approved")).toBe(true);
      expect(ajax.calls.length).toBe(0);
    });

    test("checkout_error re-arms, so the tile is not left blank", () => {
      // `checkout_error` does NOT fire `updated_checkout`, so nothing else would
      // run another check — the tile sat blank, no verdict and no spinner, for the
      // rest of the page while the buyer corrected a field (review round 5).
      issueACheck(ajax);
      const issued = ajax.calls.length;

      $(document.body).trigger("checkout_error");
      expect(shown(".twoinc-loader")).toBe(false);

      jest.advanceTimersByTime(1000);

      expect(ajax.calls.length).toBe(issued + 1);
      expect(shown(".twoinc-loader")).toBe(true);
    });
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
      // A wait held in a local is unreachable from abandonOrderIntentCheck(), and
      // paints its verdict back onto a checkout already mid-submit.
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

  describe("the loading state is never handed to a check that has not asked yet", () => {
    test("a stuck-overlay give-up does not raise the loader for a merely ARMED check", () => {
      // A loader raised for a merely ARMED check can never come down: the
      // cart-total give-up disarms with no UI touch, `clearIntentVerdicts()`
      // excludes the loader, and the abandon gate reads false on every flag.
      const ajax = harness.stubAjax($);
      try {
        $(document.body).append('<div id="payment"><div class="blockOverlay"></div></div>');
        issueACheck(ajax);
        ajax.last().succeed({ approved: true });
        expect(instance.orderIntentCheck.renderInterval).not.toBeNull();

        // A newer check is ARMED but never issues, because the total goes unreadable.
        $(".order-total").remove();
        instance.getApproval();
        expect(instance.orderIntentCheck.interval).not.toBeNull();
        expect(instance.orderIntentCheck.inFlightSeq).toBeNull();

        // The blocked paint gives up at its tenth tick, then the cart-total wait at
        // its own. Nothing is outstanding at any point, so the loader must never be
        // raised — and certainly must not survive.
        jest.advanceTimersByTime(20000);

        expect(shown(".twoinc-loader")).toBe(false);
        expect(instance.orderIntentCheck.interval).toBeNull();
        expect(ajax.calls.length).toBe(1);
      } finally {
        ajax.restore();
      }
    });
  });

  describe("what gets cached, and against which request", () => {
    test("a superseded response is ignored outright — not painted, not cached", () => {
      // The interval is disarmed BEFORE the request goes out, so a second check
      // can be armed while the first is in flight and the two can arrive in
      // either order. What is asserted is that the stale answer has no effect at
      // all, not merely that it is filed separately.
      const ajax = harness.stubAjax($);
      try {
        instance.getApproval();
        jest.advanceTimersByTime(1000);
        expect(ajax.calls.length).toBe(1);

        // A different cart total, so the two checks are genuinely different
        // questions. This proves SUPERSESSION, not hash separation — nothing is
        // cached until a response settles.
        $(".order-total .woocommerce-Price-amount").text("250.00");
        instance.getApproval();
        jest.advanceTimersByTime(1000);
        expect(ajax.calls.length).toBe(2);

        // Newest settles first, and is what the buyer must end up reading.
        ajax.calls[1].succeed({ approved: false });
        jest.advanceTimersByTime(1000);
        expect(shown(".twoinc-err-payment-default")).toBe(true);
        expect(Object.keys(instance.orderIntentLog).length).toBe(1);

        // The superseded one settles afterwards, approving: repainting the tile
        // would tell the buyer a cart total they no longer have is fine.
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

    test("the request is issued with a timeout, so it cannot hang unbounded", () => {
      // The CONFIG, not the behaviour: jQuery honours `timeout` by aborting the
      // XHR, which is beyond this harness, so all that is assertable is that
      // the option is passed. The settled path is the transport-failure test
      // below — production's `.fail` never reads `textStatus`.
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

    for (const status of [401, 403, 408, 429]) {
      test("a " + status + " means ask again, so it is not cached", () => {
        // These four mean "ask again", not "no" — caching one freezes the
        // decline for the rest of the page, since the cached branch issues no
        // request. The 422 and declining-200 tests below are the positive
        // controls against a blanket "never cache".
        instance.processOrderIntentResponse({ approved: false, status: status }, "h", true);

        expect(instance.orderIntentLog["h"]).toBeUndefined();
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

    test("an APPROVED verdict is deliberately not cached", () => {
      // The cache exists so a decline is not re-asked on every checkout
      // re-render; an approval is left to be re-checked, because the cart can
      // change under it. Only the `else` branch writes the log, and nothing pinned
      // that — adding a write to the approved branch passed every test (review
      // round 4).
      const ajax = harness.stubAjax($);
      try {
        instance.getApproval();
        jest.advanceTimersByTime(1000);

        ajax.last().succeed({ approved: true });
        jest.advanceTimersByTime(1000);

        expect(shown(".twoinc-intent-approved")).toBe(true);
        expect(Object.keys(instance.orderIntentLog).length).toBe(0);
      } finally {
        ajax.restore();
      }
    });

    test("the tracking id from the response reaches the order field", () => {
      // Merchant-visible and covered by nothing: deleting both lines passed the
      // whole suite (review round 4).
      $("form[name='checkout']").append(
        "<input type='hidden' id='tracking_id' name='tracking_id' value='' />"
      );
      const ajax = harness.stubAjax($);
      try {
        instance.getApproval();
        jest.advanceTimersByTime(1000);

        ajax.last().succeed({ approved: true, tracking_id: "trk-123" });

        expect($("#tracking_id").val()).toBe("trk-123");
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

    for (const status of [400, 422, 499]) {
      test("a " + status + " business decline IS cached", () => {
        // Parametrised over the window's LOWER boundary, its middle and its top
        // (review round 7): adding 400 to RETRYABLE survived, and so did narrowing
        // `>= 400` to `> 400`, because the only cacheable positive control was 422.
        instance.processOrderIntentResponse(
          { approved: false, status: status },
          "h" + status,
          true
        );

        expect(instance.orderIntentLog["h" + status]).toBe("errored|.twoinc-err-payment-default");
      });
    }

    for (const status of [500, 503]) {
      test("a " + status + " is a failure, not a verdict, so it is not cached", () => {
        // 500 exactly: widening `< 500` to `<= 500` survived, because the 5xx tests
        // used 502 and 503 and never the boundary itself (review round 7).
        instance.processOrderIntentResponse(
          { approved: false, status: status },
          "h" + status,
          true
        );

        expect(instance.orderIntentLog["h" + status]).toBeUndefined();
      });
    }

    test("a cacheable verdict with no request hash is not filed under a blank key", () => {
      // Dropping the `hashedBody &&` guard survived: the pre-existing kill exercised a
      // falsy hash on a NON-cacheable response, where the other guard already
      // rejected it (review round 7).
      instance.processOrderIntentResponse({ approved: false, status: 422 }, undefined, true);

      expect(Object.keys(instance.orderIntentLog).length).toBe(0);
    });

    test("two different bodies of the SAME LENGTH get different cache keys", () => {
      // `getUnsecuredHash` returning `inp.length` survived every test, which means the
      // cache had only ever been exercised with bodies whose lengths differ. The
      // merchant-visible shape: a buyer swaps one 9-digit org number for another and
      // is served the previous company's verdict (review round 7).
      const a = JSON.stringify({ company: "111111111" });
      const b = JSON.stringify({ company: "222222222" });
      expect(a.length).toBe(b.length);

      expect(ctx.util.getUnsecuredHash(a)).not.toBe(ctx.util.getUnsecuredHash(b));
    });

    test("a same-length company change issues a fresh check rather than replaying", () => {
      // End to end, since the unit assertion above cannot show the cache actually
      // missing.
      const ajax = harness.stubAjax($);
      try {
        issueACheck(ajax);
        ajax.last().succeed({ approved: false });
        jest.advanceTimersByTime(1000);
        expect(Object.keys(instance.orderIntentLog).length).toBe(1);

        // Same length, different value — the case a length-based hash cannot tell
        // apart.
        expect(instance.customerCompany.organization_number).toHaveLength(8);
        instance.customerCompany.organization_number = "87654321";
        $("#company_id").val("87654321");

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

  describe("one request at a time", () => {
    test("arming a new check drops the previous request instead of stacking one", () => {
      // The interval is disarmed before a request goes out, so nothing stopped a
      // second check arming and POSTing while the first was still outstanding — at
      // one per second against a 30s timeout, up to thirty in flight, all but the
      // last already superseded (review round 5).
      const ajax = harness.stubAjax($);
      try {
        issueACheck(ajax);

        $(".order-total .woocommerce-Price-amount").text("250.00");
        instance.getApproval();
        jest.advanceTimersByTime(1000);

        expect(ajax.calls.length).toBe(2);
        expect(ajax.calls[0].abortedWhilePending).toBe(true);
        expect(ajax.calls[1].aborted).toBe(false);
        // Exactly one outstanding, and it is the newest.
        expect(instance.orderIntentCheck.inFlightSeq).toBe(instance.orderIntentCheck.seq);
        // The loader stays up across the swap — one question replaced another, the
        // checkout is still waiting.
        expect(shown(".twoinc-loader")).toBe(true);
      } finally {
        ajax.restore();
      }
    });

    test("a cache hit retires a request still in flight for an earlier body", () => {
      // The cached verdict is by construction the answer to the body the form
      // holds now; the outstanding request is for an older one, and its answer
      // would land afterwards and paint over it (review round 5).
      const ajax = harness.stubAjax($);
      try {
        // Cache a decline for the 120.00 cart.
        issueACheck(ajax);
        ajax.last().succeed({ approved: false });
        jest.advanceTimersByTime(1000);
        expect(Object.keys(instance.orderIntentLog).length).toBe(1);

        // A request goes out for a DIFFERENT cart...
        $(".order-total .woocommerce-Price-amount").text("250.00");
        issueACheck(ajax);
        const stale = ajax.calls.length - 1;

        // ...and the cart returns to the cached one before it answers.
        $(".order-total .woocommerce-Price-amount").text("120.00");
        instance.getApproval();
        jest.advanceTimersByTime(1000);

        expect(ajax.calls[stale].abortedWhilePending).toBe(true);
        expect(shown(".twoinc-err-payment-default")).toBe(true);

        // The retired request answering approved must not repaint the tile.
        ajax.calls[stale].succeed({ approved: true });
        jest.advanceTimersByTime(10000);
        expect(shown(".twoinc-intent-approved")).toBe(false);
        expect(shown(".twoinc-err-payment-default")).toBe(true);
      } finally {
        ajax.restore();
      }
    });

    test("a country change retires the request issued under the old country", () => {
      // An answer for the outgoing country would approve or decline an order
      // that no longer exists. Asserted as the outcome, not the mechanism
      // (today, getApproval()'s readiness guard on a wholesale-cleared record).
      const ajax = harness.stubAjax($);
      try {
        // Seed the country tracker. Unseeded, the FIRST country it sees is adopted
        // rather than acted on (TWO-24867), so syncBillingCountry() would take its
        // "not a real change" early return and the test would pass on nothing
        // having happened.
        ctx.helper.countryDidChange("GB");
        issueACheck(ajax);
        const issued = ajax.calls.length - 1;

        // The option has to EXIST first: jQuery cannot select a value a <select>
        // does not offer, so `.val("NO")` alone leaves the field reading "" — and
        // an empty reading is deliberately not a country change (TWO-24867), so
        // syncBillingCountry() would early-return and prove nothing.
        $("#billing_country").append('<option value="NO">Norway</option>').val("NO");
        expect(ctx.helper.currentCountry()).toBe("NO");
        instance.syncBillingCountry();

        expect(ajax.calls[issued].abortedWhilePending).toBe(true);
        expect(instance.orderIntentCheck.inFlightSeq).toBeNull();

        ajax.calls[issued].succeed({ approved: true });
        jest.advanceTimersByTime(10000);
        expect(shown(".twoinc-intent-approved")).toBe(false);
      } finally {
        ajax.restore();
      }
    });
  });

  describe("the verdict names the company the request was ABOUT", () => {
    test("a company changed while a request is in flight does not rename its verdict", () => {
      // These sentences carry the captured company (TWO-25326 §7.3) and were built
      // by re-reading the DOM at PAINT time. Supersession only begins when the NEXT
      // request is issued, up to a second after the buyer changes company — so a
      // response for company A landing inside that window painted A's verdict with
      // B's name and number in it. A decline attributed to the wrong company is the
      // most misleading thing this tile can do (review round 5).
      const ajax = harness.stubAjax($);
      try {
        issueACheck(ajax);

        // The buyer switches company while A's request is still out.
        $("#billing_company").val("Beta Traders Ltd");
        $("#company_id").val("87654321");

        ajax.last().succeed({ approved: false });
        jest.advanceTimersByTime(1000);

        expect(shown(".twoinc-err-payment-default")).toBe(true);
        expect($(".twoinc-pay-box.twoinc-err-payment-default").text()).toBe(
          "ACME Widgets Ltd (12345678)"
        );
      } finally {
        ajax.restore();
      }
    });

    test("a re-render with no response still reads the live company", () => {
      // The DOM read stays as the fallback for callers that are RE-rendering rather
      // than reporting a response — there the DOM is the current truth, and pinning
      // it stops the snapshot being wired in everywhere.
      dom.togglePaySubtitleDesc("intent-approved");
      expect($(".twoinc-pay-box.twoinc-intent-approved").text()).toBe(
        "ACME Widgets Ltd (12345678)"
      );

      $("#billing_company").val("Beta Traders Ltd");
      $("#company_id").val("87654321");
      dom.togglePaySubtitleDesc("intent-approved");

      expect($(".twoinc-pay-box.twoinc-intent-approved").text()).toBe(
        "Beta Traders Ltd (87654321)"
      );
    });

    test("an APPROVAL is not renamed either", () => {
      // The only wrong-company test used `approved: false`, so the approved branch's
      // snapshot was unpinned and an APPROVAL naming the wrong company shipped
      // uncovered — the more damaging direction of the two, since it tells the buyer
      // a company they have moved away from is good for the order (review round 6,
      // found by mutation).
      const ajax = harness.stubAjax($);
      try {
        issueACheck(ajax);

        $("#billing_company").val("Beta Traders Ltd");
        $("#company_id").val("87654321");

        ajax.last().succeed({ approved: true });
        jest.advanceTimersByTime(1000);

        expect(shown(".twoinc-intent-approved")).toBe(true);
        expect($(".twoinc-pay-box.twoinc-intent-approved").text()).toBe(
          "ACME Widgets Ltd (12345678)"
        );
      } finally {
        ajax.restore();
      }
    });

    test("a whitespace-only company name is no name, not a blank-prefixed label", () => {
      // `formatCompanyLabel()`'s OWN blank-collapse — `readCompanyLabelFromDom`'s
      // `blankToEmpty()` is redundant against it, kept only to honour
      // `getCompanyLabelText()`'s documented contract. Set on the RECORD, the
      // source the request body is built from; a whitespace-only name still
      // passes `isReadyApprovalCheck()`, so this stays reachable.
      const ajax = harness.stubAjax($);
      try {
        instance.customerCompany.company_name = "   ";
        issueACheck(ajax);
        ajax.last().succeed({ approved: false });
        jest.advanceTimersByTime(1000);

        // A whitespace-only name is NO name, so the served no-company sentence is
        // the right output — never " (12345678)".
        expect($(".twoinc-pay-box.twoinc-err-payment-default").text()).toBe("NO_COMPANY_DECLINED");
      } finally {
        ajax.restore();
      }
    });

    test("an empty snapshot is honoured, not replaced by a live read", () => {
      // A UNIT test: `isReadyApprovalCheck()` makes this unreachable end to end,
      // but the contract still has to hold — it is what stops a live re-read at
      // paint time substituting whatever company the buyer has moved to.
      // `typeof`, not truthiness: "" is a recorded absence, and the no-company
      // sentence is the right output for it.
      $("#billing_company").val("Beta Traders Ltd");
      $("#company_id").val("87654321");

      expect(dom.resolveCompanyLabel("")).toBe("");
      // ...whereas no snapshot at all DOES fall through to the live read, which is
      // what the re-render callers rely on.
      expect(dom.resolveCompanyLabel(undefined)).toBe("Beta Traders Ltd (87654321)");
    });

    test("the proxied check carries the checkout security token and no merchant identity", () => {
      // The proxy refuses a request without the token, and resolves merchant
      // identity from the store's settings — a page-supplied one would let any
      // visitor spend the merchant's API key against another merchant.
      const ajax = harness.stubAjax($);
      try {
        issueACheck(ajax);
        const posted = ajax.last().settings.data;

        expect(posted.csrf_token).toBe(harness.API_PROXY.csrf_token);
        const intent = JSON.parse(posted.intent);
        expect(intent.merchant_id).toBeUndefined();
        expect(intent.merchant_short_name).toBeUndefined();
      } finally {
        ajax.restore();
      }
    });

    test("the label and the request body name the same company", () => {
      // They used to come from different places — the body from `customerCompany`, the
      // label from `#billing_company`/`#company_id` — and `clearCompanyIfCountryStale()`
      // exists precisely because those two diverge (a number typed with no blur).
      // Divergent, the verdict named a company the API was never asked about (review
      // round 8).
      const ajax = harness.stubAjax($);
      try {
        // The record says ACME; the inputs say something else entirely.
        $("#billing_company").val("Beta Traders Ltd");
        $("#company_id").val("87654321");
        issueACheck(ajax);

        // The body was built from the record...
        expect(JSON.parse(ajax.last().settings.data.intent).buyer.company.company_name).toBe(
          "ACME Widgets Ltd"
        );

        ajax.last().succeed({ approved: false });
        jest.advanceTimersByTime(1000);

        // ...so the sentence must name the record's company too.
        expect($(".twoinc-pay-box.twoinc-err-payment-default").text()).toBe(
          "ACME Widgets Ltd (12345678)"
        );
      } finally {
        ajax.restore();
      }
    });

    test("a fourth verdict box added later is cleared too", () => {
      // `clearIntentVerdicts()` says "every pay-box except the loader" rather than
      // listing the three verdict classes, so a box added by a brand overlay or a
      // later ticket is covered without editing it. A list would leave one stale box
      // surviving every clear, a long way from its cause.
      $(document.body)
        .find(".payment_box")
        .append('<div class="twoinc-pay-box twoinc-err-future-thing">SOMETHING NEW</div>');
      expect($(".twoinc-pay-box.twoinc-err-future-thing").hasClass("hidden")).toBe(false);

      dom.clearIntentVerdicts();

      expect($(".twoinc-pay-box.twoinc-err-future-thing").hasClass("hidden")).toBe(true);
      // And the loader is still the one exception.
      expect($(".twoinc-pay-box.twoinc-loader").length).toBe(1);
    });

    test("clearing verdicts never touches the loader", () => {
      const ajax = harness.stubAjax($);
      try {
        issueACheck(ajax);

        dom.clearIntentVerdicts();

        expect(shown(".twoinc-loader")).toBe(true);
      } finally {
        ajax.restore();
      }
    });

    test("a cached verdict names the company it was cached for", () => {
      // The cached branch passes no snapshot on purpose: a cache hit means the
      // request body matches, which means the company matches, so the live read is
      // right there.
      const ajax = harness.stubAjax($);
      try {
        issueACheck(ajax);
        ajax.last().succeed({ approved: false });
        jest.advanceTimersByTime(1000);

        instance.getApproval();
        jest.advanceTimersByTime(1000);

        expect(ajax.calls.length).toBe(1);
        expect($(".twoinc-pay-box.twoinc-err-payment-default").text()).toBe(
          "ACME Widgets Ltd (12345678)"
        );
      } finally {
        ajax.restore();
      }
    });
  });

  describe("a paint cannot outlive the check that produced it", () => {
    test("a pending paint is dropped when a newer check supersedes it", () => {
      // Neither the issue path nor the cached branch clears `renderInterval`, so a
      // paint still pending from an earlier response fired afterwards and put a
      // stale verdict over the newer check's loader. Reachable with an
      // `updated_checkout` landing in the second between a response and its paint
      // (review round 5).
      const ajax = harness.stubAjax($);
      try {
        $(document.body).append('<div id="payment"><div class="blockOverlay"></div></div>');
        issueACheck(ajax);
        ajax.last().succeed({ approved: true });
        expect(instance.orderIntentCheck.renderInterval).not.toBeNull();

        // A newer check is armed and issued before the paint gets its chance.
        $(".order-total .woocommerce-Price-amount").text("250.00");
        instance.getApproval();
        jest.advanceTimersByTime(1000);
        expect(ajax.calls.length).toBe(2);

        // The overlay clears; the superseded paint must not fire.
        $("#payment .blockOverlay").remove();
        jest.advanceTimersByTime(10000);

        expect(shown(".twoinc-intent-approved")).toBe(false);
        expect($(".twoinc-pay-box.twoinc-intent-approved").length).toBe(1);
      } finally {
        ajax.restore();
      }
    });

    test("a superseded paint's timer is cleared, not just nulled", () => {
      // The mismatch branch nulls `renderInterval` AND clears the timer. Dropping the
      // `clearInterval` leaves an orphaned 1s interval per superseded paint, forever
      // — the same unbounded-interval leak round 5 called out for the cached branch,
      // not applied to its own new guard (review round 6, found by mutation).
      const ajax = harness.stubAjax($);
      try {
        $(document.body).append('<div id="payment"><div class="blockOverlay"></div></div>');
        issueACheck(ajax);
        ajax.last().succeed({ approved: true });
        expect(instance.orderIntentCheck.renderInterval).not.toBeNull();

        $(".order-total .woocommerce-Price-amount").text("250.00");
        instance.getApproval();
        jest.advanceTimersByTime(1000);

        // Baseline: how many timers are live with the newer check armed but the
        // superseded paint not yet retired.
        const withZombie = jest.getTimerCount();

        // Its first tick takes the mismatch branch and must retire the timer, not
        // merely null the handle — nulling alone leaves it ticking forever, and each
        // subsequent tick calls `clearInterval(null)`, a no-op.
        jest.advanceTimersByTime(1000);

        expect(jest.getTimerCount()).toBeLessThan(withZombie);
        expect(instance.orderIntentCheck.renderInterval).toBeNull();
      } finally {
        ajax.restore();
      }
    });

    test("a form that goes incomplete cancels a pending paint too", () => {
      // Once `stillCurrent()` has released `inFlightSeq` the response is banked and
      // only the paint is left — so the readiness guard has to count a pending paint
      // as well, or it writes a verdict about a form the buyer has since emptied.
      const ajax = harness.stubAjax($);
      try {
        $(document.body).append('<div id="payment"><div class="blockOverlay"></div></div>');
        issueACheck(ajax);
        ajax.last().succeed({ approved: true });
        expect(instance.orderIntentCheck.inFlightSeq).toBeNull();
        expect(instance.orderIntentCheck.renderInterval).not.toBeNull();

        instance.customerCompany.organization_number = "";
        instance.getApproval();

        expect(instance.orderIntentCheck.renderInterval).toBeNull();
        $("#payment .blockOverlay").remove();
        jest.advanceTimersByTime(10000);
        expect(shown(".twoinc-intent-approved")).toBe(false);
      } finally {
        ajax.restore();
      }
    });
  });

  describe("the cart-total give-up is quiet", () => {
    test("giving up does not wipe a verdict painted meanwhile", () => {
      // No loading state is up during the price wait, so there is nothing of this
      // check's to take down — and the blanket reset instead erased whatever else the
      // tile was showing, with nothing left to re-arm (review round 5). Driven here
      // with absent totals markup; the zero-total cart takes the same branch and is
      // covered in its own test.
      const ajax = harness.stubAjax($);
      try {
        // Request 1 goes out and is left UNSETTLED on purpose (review round 6):
        // settled, `abortedWhilePending` reads false however the give-up behaves, so
        // the "does not touch an outstanding request" assertion below was vacuous.
        issueACheck(ajax);

        // A second check is armed and its cart total then becomes unreadable — plus a
        // third call while that interval is live, so `pendingCheck` is genuinely set
        // when the give-up runs. Without that it was already false and the assertion
        // proved nothing.
        instance.getApproval();
        $(".order-total").remove();
        instance.getApproval();
        expect(instance.orderIntentCheck.pendingCheck).toBe(true);

        // Staged AFTER the arming calls, since each of them clears verdicts.
        revealVerdictBox(".twoinc-err-payment-default");

        jest.advanceTimersByTime(2000);
        expect(shown(".twoinc-err-payment-default")).toBe(true);

        // Ten ticks in, the price wait gives up — quietly.
        jest.advanceTimersByTime(10000);

        expect(shown(".twoinc-err-payment-default")).toBe(true);
        expect(instance.orderIntentCheck.interval).toBeNull();
        // `pendingCheck` too (review round 6): left set, initialize()'s 3s poller
        // re-enters getApproval() for the life of the page — the exact leak this
        // block's own comment claims to close. Unpinned because this describe never
        // starts the poller.
        expect(instance.orderIntentCheck.pendingCheck).toBe(false);
        // And an outstanding request is deliberately left alone — this wait knows
        // nothing about it. Asserted rather than only claimed in prose.
        expect(ajax.calls[0].abortedWhilePending).toBe(false);
      } finally {
        ajax.restore();
      }
    });
  });

  describe("picking a company does not blank a live loader", () => {
    test("a pick clears the verdict and leaves an in-flight loader up", () => {
      // The picker's own handler blanket-hid before calling `getApproval()`, which
      // only ARMS — so the spinner for a request already in flight went down and the
      // replacement was a second away. Mutation, not review, is what proved this
      // needed a test: swapping the helper back for the blanket hide survived the
      // whole suite (review round 5).
      const ajax = harness.stubAjax($);
      try {
        issueACheck(ajax);
        // Staged by hand, not through togglePaySubtitleDesc, which would hide the
        // loader — so both halves can be asserted at once (review round 6: the two
        // clear-assertions here used to run against a box that was never shown).
        revealVerdictBox(".twoinc-err-payment-default");

        instance.enableCompanySearch();
        // `onPick` is what the panel's own `onSelect` calls for a chosen row.
        ctx.helper.onPick({ id: "Beta Traders Ltd", company_id: "87654321" });

        // The checkout still shows that it is working. Under the blanket hide this
        // was false, and stayed false until the replacement request went out a
        // second later.
        expect(shown(".twoinc-loader")).toBe(true);
        expect(shown(".twoinc-err-payment-default")).toBe(false);
        expect(shown(".twoinc-intent-approved")).toBe(false);
      } finally {
        ajax.restore();
      }
    });
  });

  describe("the company-field change handler", () => {
    // Bound in `initialize()` and entirely untested: swapping it to the blanket
    // hide, and deleting its clear outright, both survived the whole suite (review
    // round 6, found by mutation). It is the manual-entry path a buyer types into.
    let ajax;

    beforeEach(() => {
      $("form[name='checkout']").after('<div id="order_review"></div>');
      $("form[name='checkout']").append(
        "<input type='radio' id='payment_method_" +
          GATEWAY_ID +
          "' name='payment_method' value='" +
          GATEWAY_ID +
          "' checked />"
      );
      ajax = harness.stubAjax($);
      instance.initialize(false);
      jest.advanceTimersByTime(1000);
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
      instance.abandonOrderIntentCheck();
      ajax.calls.length = 0;
    });

    afterEach(() => {
      ajax.restore();
      $(document.body).off();
    });

    test("a change on #billing_company clears the verdict and keeps the loader", () => {
      issueACheck(ajax);
      revealVerdictBox(".twoinc-err-payment-default");

      $("#billing_company").trigger("change");

      expect(shown(".twoinc-err-payment-default")).toBe(false);
      // Positive control, since `shown()` is false for an absent box too.
      expect($(".twoinc-pay-box.twoinc-err-payment-default").length).toBe(1);
      // And the spinner for the request still in flight is untouched — the blanket
      // hide took it down, with nothing to put it back until the next request.
      expect(shown(".twoinc-loader")).toBe(true);
    });
  });

  describe("clearSelectedCompany's deferred re-read", () => {
    test("the 3s re-read does not wipe a verdict painted after the country change", () => {
      // The closure carried a blanket hide, then a verdicts-only clear, and both were
      // wrong for the same reason: it fires three seconds late, by which time the
      // check armed by the country handler's own `getApproval()` has issued (~1s) and
      // painted (~1.5-2s). Clearing then wipes a correct, current verdict — and
      // nothing repaints it, because a country change fires no `updated_checkout`
      // (review round 7). Its own comment named this failure while still causing it.
      const ajax = harness.stubAjax($);
      try {
        ctx.helper.clearSelectedCompany();

        // The record comes back and a check runs to a verdict, inside the 3s window.
        instance.customerCompany = {
          company_name: "ACME Widgets Ltd",
          organization_number: "12345678",
          country_prefix: "GB"
        };
        issueACheck(ajax);
        ajax.last().succeed({ approved: false });
        jest.advanceTimersByTime(1000);
        expect(shown(".twoinc-err-payment-default")).toBe(true);

        // t=3s: the deferred re-read fires and must leave the tile alone.
        jest.advanceTimersByTime(2000);

        expect(shown(".twoinc-err-payment-default")).toBe(true);
      } finally {
        ajax.restore();
      }
    });

    test("a second country change inside the 3s window supersedes the first re-read", () => {
      // Driven through the REAL bump, `syncBillingCountry()` — hand-incrementing
      // `companySearchSeq` proved only that the guard compares two numbers (review
      // round 5).
      ctx.helper.countryDidChange("GB");
      $("#billing_country").append('<option value="NO">Norway</option>');
      $("#billing_country").append('<option value="SE">Sweden</option>');

      $("#billing_country").val("NO");
      instance.syncBillingCountry();

      // A second real change one second in. Its own re-read is the one that should
      // win; the first must not fire at t+3s and overwrite from a DOM that has
      // moved on.
      jest.advanceTimersByTime(1000);
      $("#billing_country").val("SE");
      instance.syncBillingCountry();
      $("#company_id").val("87654321");

      // t+3s: the FIRST closure's deadline. Superseded, so nothing happens.
      jest.advanceTimersByTime(2000);
      expect(instance.customerCompany.organization_number).not.toBe("87654321");

      // t+4s: the second closure's deadline, which is allowed to read.
      jest.advanceTimersByTime(1000);
      expect(instance.customerCompany.organization_number).toBe("87654321");
    });

    test("a capture inside the window is left alone, because the DOM is its source", () => {
      // No capture path bumps `companySearchSeq` — a registry pick, sole trader and
      // manual entry all write `customerCompany` and the two mirror inputs only.
      //
      // It needs no bump: every capture mode writes `#billing_company` and
      // `#company_id`, which is exactly what the re-read reads back, so the re-read
      // is a no-op against a capture rather than a clobber. Pinned so that stays
      // true — a capture path that stopped mirroring to the DOM would fail here.
      ctx.helper.clearSelectedCompany();

      $("#company_id").val("87654321");
      instance.customerCompany = {
        company_name: "Beta Traders Ltd",
        organization_number: "87654321",
        country_prefix: "GB"
      };

      jest.advanceTimersByTime(3000);

      expect(instance.customerCompany.organization_number).toBe("87654321");
    });

    test("the deferred re-read cannot blank a loader for a live request", () => {
      // The third statement in that closure was the blanket hide, pinned by nothing
      // (review round 5). Firing three seconds late, it took the spinner down for a
      // request still outstanding and nothing re-armed.
      const ajax = harness.stubAjax($);
      try {
        ctx.helper.clearSelectedCompany();

        // Put the record back and get a request out inside the 3s window.
        instance.customerCompany = {
          company_name: "ACME Widgets Ltd",
          organization_number: "12345678",
          country_prefix: "GB"
        };
        issueACheck(ajax);

        jest.advanceTimersByTime(3000);

        expect(shown(".twoinc-loader")).toBe(true);
      } finally {
        ajax.restore();
      }
    });

    test("but an unsuperseded re-read still runs", () => {
      // The guard must not be so broad that the re-read never happens — putting the
      // country prefix back is what it exists for.
      //
      // Asserted on the NUMBER and the country: both come straight from the DOM,
      // written after the clear, which empties those fields itself, and with the
      // counter left alone so nothing supersedes the re-read.
      ctx.helper.clearSelectedCompany();
      instance.customerCompany = {};
      $("#company_id").val("12345678");

      jest.advanceTimersByTime(3000);

      expect(instance.customerCompany.organization_number).toBe("12345678");
      expect(instance.customerCompany.country_prefix).toBe("GB");
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

    test("an armed-but-unissued check still counts as RUNNING, so checkout_error re-arms", () => {
      // The return value answers "was anything running", which is what `checkout_error`
      // needs — an armed-but-unissued check is the most likely state to be in when a
      // submit fails validation, and the buyer is still there to retry. Narrowing the
      // return to "was anything on screen" silently stopped re-arming for it (review
      // round 8).
      const ajax = harness.stubAjax($);
      try {
        instance.getApproval();
        expect(instance.orderIntentCheck.interval).not.toBeNull();
        expect(instance.orderIntentCheck.inFlightSeq).toBeNull();
        expect(instance.orderIntentCheck.renderInterval).toBeNull();

        expect(instance.abandonOrderIntentCheck()).toBe(true);
      } finally {
        ajax.restore();
      }
    });

    test("but a check that WAS in flight is still reset", () => {
      const ajax = harness.stubAjax($);
      try {
        issueACheck(ajax);

        instance.abandonOrderIntentCheck();

        expect(shown(".twoinc-loader")).toBe(false);
      } finally {
        ajax.restore();
      }
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

    test("abandoning supersedes FIRST, then aborts, so the abort cannot paint", () => {
      // Ordering is the whole of it (review round 5). jQuery runs `.fail`
      // synchronously for an abort, and that handler deselects the gateway and
      // paints a decline. Because the counter has already moved, the aborted
      // request's own `stillCurrent()` check fails and it does neither — which is
      // what makes aborting safe here at all.
      const ajax = harness.stubAjax($);
      try {
        issueACheck(ajax);
        const seqInFlight = instance.orderIntentCheck.inFlightSeq;
        expect(seqInFlight).not.toBeNull();

        instance.abandonOrderIntentCheck();

        expect(instance.orderIntentCheck.seq).toBeGreaterThan(seqInFlight);
        expect(instance.orderIntentCheck.inFlightSeq).toBeNull();
        expect(ajax.calls[0].abortedWhilePending).toBe(true);
        // The abort's synchronous `.fail` changed nothing.
        expect(shown(".twoinc-err-payment-default")).toBe(false);
        expect($(":input[value='" + GATEWAY_ID + "']").prop("checked")).toBe(true);
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

        // The blocked paint is superseded, so the `paintSeq` guard retires it and
        // touches the tile not at all — leaving the newer check's own loading state
        // exactly where it is. Round 3 reset here unconditionally and blanked it;
        // round 4 "fixed" that with a hand-back that round 7 then showed to be
        // unreachable, because superseded paints never reach the give-up branch at
        // all. THIS is the assertion that matters, and it is the guard that satisfies
        // it.
        jest.advanceTimersByTime(9000);
        expect(shown(".twoinc-loader")).toBe(true);

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

    test("a stuck overlay with nothing else running does reset the tile", () => {
      // The other side of the branch above: with no newer check to hand the tile
      // back to, giving up must leave it neutral rather than spinning.
      const ajax = harness.stubAjax($);
      try {
        $(document.body).append('<div id="payment"><div class="blockOverlay"></div></div>');
        instance.getApproval();
        jest.advanceTimersByTime(1000);
        ajax.last().succeed({ approved: true });

        jest.advanceTimersByTime(10000);

        expect(instance.orderIntentCheck.interval).toBeNull();
        expect(instance.orderIntentCheck.inFlightSeq).toBeNull();
        expect(instance.orderIntentCheck.pendingCheck).toBe(false);
        expect(shown(".twoinc-loader")).toBe(false);
        expect(shown(".twoinc-intent-approved")).toBe(false);
      } finally {
        ajax.restore();
      }
    });
  });

  describe("state released when a response settles", () => {
    test("a settled response releases inFlightSeq, so a later abandon spares the verdict", () => {
      // `stillCurrent()` clears `inFlightSeq` as its side effect, and deleting
      // that line passed the whole suite (review round 4). Left non-null, the
      // abandon gate reads `wasRunning` as permanently true — so the next
      // non-submitting Place Order click or unrelated `checkout_error` blanket-hides
      // a perfectly good verdict, which is the exact defect the gate exists to
      // prevent. Every other abandon test uses a path that never issues a request,
      // so none of them reach it.
      const ajax = harness.stubAjax($);
      try {
        instance.getApproval();
        jest.advanceTimersByTime(1000);
        ajax.last().succeed({ approved: false });
        jest.advanceTimersByTime(1000);
        expect(shown(".twoinc-err-payment-default")).toBe(true);

        expect(instance.orderIntentCheck.inFlightSeq).toBeNull();

        instance.abandonOrderIntentCheck();

        expect(shown(".twoinc-err-payment-default")).toBe(true);
      } finally {
        ajax.restore();
      }
    });

    test("a settled request is not aborted by a later abandon", () => {
      // `stillCurrent()` releases `inFlightXhr` as well as `inFlightSeq`. Left set,
      // a later abandon calls `abort()` on a jqXHR that has already settled — a
      // no-op on a real XHR, but it also means the page holds a reference to every
      // response for its lifetime. Mutation found this unpinned (review round 5).
      const ajax = harness.stubAjax($);
      try {
        issueACheck(ajax);
        ajax.last().succeed({ approved: false });
        jest.advanceTimersByTime(1000);
        expect(instance.orderIntentCheck.inFlightXhr).toBeNull();

        instance.abandonOrderIntentCheck();

        expect(ajax.calls[0].aborted).toBe(false);
        // The stronger flag too (review round 6): with no assertion that it is
        // FALSE anywhere, `abortedWhilePending` was indistinguishable from the
        // `aborted` it was added to improve on, and the harness's `settled` guard
        // behind it was vacuous.
        expect(ajax.calls[0].abortedWhilePending).toBe(false);
      } finally {
        ajax.restore();
      }
    });

    test("a second response supersedes the first paint instead of leaking its timer", () => {
      // processOrderIntentResponse() clears any pending paint before arming its
      // own. Without that the older interval's handle is overwritten, its own
      // `clearInterval` then targets the NEWER handle, and the orphan repaints
      // every second forever. Deleting the pre-arm clear passed the suite (review
      // round 4).
      const ajax = harness.stubAjax($);
      try {
        $(document.body).append('<div id="payment"><div class="blockOverlay"></div></div>');
        instance.getApproval();
        jest.advanceTimersByTime(1000);
        ajax.last().succeed({ approved: false });

        // A second response lands while the first paint is still blocked.
        instance.processOrderIntentResponse({ approved: true }, "second", false);

        $("#payment .blockOverlay").remove();
        jest.advanceTimersByTime(1000);
        expect(shown(".twoinc-intent-approved")).toBe(true);
        expect(instance.orderIntentCheck.renderInterval).toBeNull();

        // Nothing left ticking: hide it by hand and it must stay hidden.
        $(".twoinc-pay-box").addClass("hidden");
        jest.advanceTimersByTime(10000);
        expect(shown(".twoinc-intent-approved")).toBe(false);
      } finally {
        ajax.restore();
      }
    });
  });

  describe("a verdict is announced, not silently swapped in", () => {
    // Records the order of mutations to one box: `attributes` when the `hidden`
    // class moves, `childList`/`characterData` when its sentence is written.
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

    test("a duplicated verdict box is written, not skipped", () => {
      // `.text()` on a multi-element set returns the CONCATENATION, so comparing
      // the set's text to the desired sentence read as "already correct" when only
      // the FIRST copy carried it — leaving the second visibly empty. Reachable if
      // a fragment swap ever leaves two copies of the gateway description live.
      // Found by mutation, not review (review round 4).
      dom.togglePaySubtitleDesc("errored", ".twoinc-err-payment-default");
      const sentence = "ACME Widgets Ltd (12345678)";
      expect($(".twoinc-pay-box.twoinc-err-payment-default").text()).toBe(sentence);

      // A second, empty copy appears beside the first.
      $(document.body)
        .find(".payment_box")
        .append(
          '<div class="twoinc-pay-box twoinc-err-payment-default hidden" role="alert" ' +
            'data-company-template="{company}"></div>'
        );

      dom.togglePaySubtitleDesc("errored", ".twoinc-err-payment-default");

      const boxes = $(".twoinc-pay-box.twoinc-err-payment-default");
      expect(boxes.length).toBe(2);
      boxes.each(function () {
        expect($(this).text()).toBe(sentence);
      });
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
    // Against jsdom's REAL cascade, not a grep over the CSS source: commenting
    // out a declaration, a later overriding rule and an at-rule wrapper all
    // pass a source-text check. Two known gaps, both of which have already
    // produced a green-but-wrong assertion here — jsdom does not honour
    // `!important` from an EARLIER rule (hence `unhidden()`), and it lays out
    // and animates nothing. See the known gaps in tests/js/README.md.
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

    // Every box in the fixture starts hidden, which is what production serves —
    // but `display: none` is not the state whose layout is being asserted, and
    // jsdom's `!important` gap means it does not even resolve to `none`
    // reliably. Unhide, then measure.
    function unhidden(selector) {
      const node = document.querySelector(selector);
      expect(node).not.toBeNull();
      node.classList.remove("hidden");
      return window.getComputedStyle(node);
    }

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
     */
    function rgb(hex) {
      const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
      expect(m).not.toBeNull();
      return (
        "rgb(" + parseInt(m[1], 16) + ", " + parseInt(m[2], 16) + ", " + parseInt(m[3], 16) + ")"
      );
    }

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
      // It is a flex item beside a sentence that is longer in every locale this ships
      // — nb_NO's is 23 characters — so it must not be allowed to shrink (round 8).
      expect(spinner.flexShrink).toBe("0");
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
