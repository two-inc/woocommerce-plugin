/**
 * The client half of the shop-side rate limiter: what the checkout does when
 * its own proxy answers 429.
 *
 * Every one of these routes is re-armed by WooCommerce's `updated_checkout`,
 * which fires per address keystroke — so a 429 that is not backed off becomes
 * a request per second for the whole of the limiter's window, none of which
 * can be answered. And a 429 is the SHOP refusing, never a credit verdict, so
 * it must not deselect the payment method or paint a decline.
 */

"use strict";

const harness = require("./wc-harness");

const GATEWAY_ID = "woocommerce-gateway-tillit";

const SOLE_TRADER_CONFIG = {
  availability_url: "/?wc-ajax=two_sole_trader_availability",
  tokens_url: "/?wc-ajax=two_sole_trader_tokens",
  nonce: "nonce",
  text: {}
};

/**
 * `jQuery.ajax` recorder whose failures carry a real HTTP status and a real
 * `Retry-After`.
 *
 * The shared harness's `stubAjax().fail()` models a jQuery timeout/abort and
 * hard-codes `status: 0`; every branch in this file is gated on `status ===
 * 429` and reads the header, so that helper cannot express the case.
 * `jQuery.get`/`jQuery.post` route through `jQuery.ajax`, so the sole-trader
 * calls are recorded here too.
 *
 * @param {Function} $ jQuery instance
 * @returns {{calls: Array, last: Function, restore: Function}}
 */
function stubAjax($) {
  const original = $.ajax;
  const calls = [];
  $.ajax = function (settings) {
    const deferred = $.Deferred();
    const jqXHR = deferred.promise();
    jqXHR.abort = function () {};
    const record = {
      settings: settings,
      url: settings && settings.url,
      /** Resolve as HTTP 200 with `data`. */
      succeed: function (data) {
        deferred.resolveWith(jqXHR, [data, "success", jqXHR]);
      },
      /**
       * Reject as `status`, optionally carrying a `Retry-After` header.
       *
       * @param {number} status HTTP status
       * @param {string} [retryAfter] header value, seconds
       */
      failWith: function (status, retryAfter) {
        jqXHR.status = status;
        jqXHR.getResponseHeader = function (name) {
          if (name !== "Retry-After" || retryAfter === undefined) return null;
          return retryAfter;
        };
        deferred.rejectWith(jqXHR, [jqXHR, "error", "error"]);
      }
    };
    calls.push(record);
    return jqXHR;
  };
  return {
    calls: calls,
    last: function () {
      return calls[calls.length - 1];
    },
    restore: function () {
      $.ajax = original;
    }
  };
}

/** A jqXHR carrying `Retry-After: value`, or carrying no such header at all. */
function xhrWithRetryAfter(value) {
  return {
    getResponseHeader: function (name) {
      if (name !== "Retry-After" || value === undefined) return null;
      return value;
    }
  };
}

describe("Retry-After parsing", () => {
  let util;

  beforeEach(() => {
    util = harness.loadTwoinc().util;
  });

  test.each([
    { jqXHR: xhrWithRetryAfter("30"), ms: 30000, description: "seconds from the header" },
    { jqXHR: xhrWithRetryAfter("300"), ms: 300000, description: "the clamp's own boundary" },
    { jqXHR: xhrWithRetryAfter("600"), ms: 300000, description: "above the clamp" },
    { jqXHR: xhrWithRetryAfter("86400"), ms: 300000, description: "a day, still clamped" },
    { jqXHR: xhrWithRetryAfter(undefined), ms: 60000, description: "header absent" },
    { jqXHR: xhrWithRetryAfter("soon"), ms: 60000, description: "header not a number" },
    { jqXHR: xhrWithRetryAfter(""), ms: 60000, description: "header empty" },
    { jqXHR: xhrWithRetryAfter("0"), ms: 60000, description: "header zero" },
    { jqXHR: xhrWithRetryAfter("-30"), ms: 60000, description: "header negative" },
    { jqXHR: {}, ms: 60000, description: "no getResponseHeader on the object" },
    { jqXHR: null, ms: 60000, description: "no jqXHR at all" }
  ])("$description", ({ jqXHR, ms }) => {
    expect(util.retryAfterMs(jqXHR)).toBe(ms);
  });
});

describe("order-intent 429 backoff", () => {
  let ctx;
  let $;
  let instance;
  let ajax;

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

    harness.buildCheckoutForm();
    buildPaymentTile();
    buildCartTotals();

    instance = ctx.Twoinc.getInstance();
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

    ajax = stubAjax($);
  });

  afterEach(() => {
    ajax.restore();
    harness.releasePanel(ctx.helper);
    jest.clearAllTimers();
    jest.useRealTimers();
    document.body.innerHTML = "";
  });

  function buildPaymentTile() {
    $(document.body).append(
      '<li class="wc_payment_method"><div class="payment_box">' +
        '<div class="twoinc-pay-box twoinc-loader hidden" role="status">Checking</div>' +
        '<div class="twoinc-pay-box twoinc-intent-approved hidden" role="status" ' +
        'data-company-template="{company}">APPROVED</div>' +
        '<div class="twoinc-pay-box twoinc-err-payment-default hidden" role="alert" ' +
        'data-company-template="{company}">DECLINED</div>' +
        '<div class="twoinc-pay-box twoinc-busy-retry hidden" role="status">BUSY</div>' +
        "</div></li>"
    );
    $("form[name='checkout']").append(
      '<input type="radio" name="payment_method" value="' + GATEWAY_ID + '" checked />'
    );
  }

  // `getPrice()` returns before the check is ever issued without these.
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

  function selected() {
    return $(":input[value='" + GATEWAY_ID + "']").prop("checked");
  }

  function issueACheck() {
    const before = ajax.calls.length;
    instance.getApproval();
    jest.advanceTimersByTime(1000);
    expect(ajax.calls.length).toBe(before + 1);
  }

  test("a 429 leaves the payment method selected and shows the busy box", () => {
    issueACheck();

    ajax.last().failWith(429, "30");

    expect(selected()).toBe(true);
    expect(shown(".twoinc-busy-retry")).toBe(true);
    expect(shown(".twoinc-err-payment-default")).toBe(false);
    expect(instance.orderIntentCheck.rateLimitedUntil).toBe(Date.now() + 30000);
  });

  test("a 500 still deselects, as before", () => {
    issueACheck();

    ajax.last().failWith(500);
    // The verdict paint is armed a tick out, the deselect is not.
    jest.advanceTimersByTime(1000);

    expect(selected()).toBe(false);
    expect(shown(".twoinc-err-payment-default")).toBe(true);
    expect(instance.orderIntentCheck.rateLimitedUntil).toBe(0);
  });

  test("a check armed inside the window issues no request", () => {
    issueACheck();
    ajax.last().failWith(429, "30");

    instance.getApproval();
    jest.advanceTimersByTime(1000);

    expect(ajax.calls.length).toBe(1);
    expect(shown(".twoinc-busy-retry")).toBe(true);
  });

  test("a check armed after the window issues a request again", () => {
    issueACheck();
    ajax.last().failWith(429, "30");

    jest.advanceTimersByTime(30000);
    instance.getApproval();
    jest.advanceTimersByTime(1000);

    expect(ajax.calls.length).toBe(2);
  });
});

describe("address lookup failure", () => {
  let ctx;
  let $;
  let instance;
  let ajax;

  beforeEach(() => {
    ctx = harness.loadTwoinc({
      gateway_id: GATEWAY_ID,
      enable_order_intent: "no",
      enable_address_lookup: "yes",
      text: {}
    });
    $ = ctx.$;
    harness.buildCheckoutForm();
    $(document.body).append(
      '<li class="wc_payment_method"><div class="payment_box">' +
        '<div class="twoinc-pay-box twoinc-busy-retry hidden" role="status">BUSY</div>' +
        "</div></li>"
    );
    instance = ctx.Twoinc.getInstance();
    ajax = stubAjax($);
  });

  afterEach(() => {
    ajax.restore();
    harness.releasePanel(ctx.helper);
    document.body.innerHTML = "";
  });

  test.each([
    { status: 429, description: "a lookup refused by the shop's limiter surfaces the busy box" },
    { status: 500, description: "a lookup that cannot be reached surfaces the busy box" }
  ])("$description", ({ status }) => {
    instance.addressLookup({ lookup_id: "lookup-1" });

    ajax.last().failWith(status);

    const $box = $(".twoinc-pay-box.twoinc-busy-retry");
    expect($box.hasClass("hidden")).toBe(false);
  });

  test("a superseded lookup's failure paints nothing", () => {
    instance.addressLookup({ lookup_id: "lookup-1" });
    instance.addressLookup({ lookup_id: "lookup-2" });

    ajax.calls[0].failWith(500);

    expect($(".twoinc-pay-box.twoinc-busy-retry").hasClass("hidden")).toBe(true);
  });
});

describe("sole-trader 429 backoff", () => {
  let ctx;
  let $;
  let soleTrader;
  let ajax;

  beforeEach(() => {
    jest.useFakeTimers();
    ctx = harness.loadTwoinc({
      gateway_id: GATEWAY_ID,
      enable_order_intent: "no",
      enable_address_lookup: "no",
      sole_trader: SOLE_TRADER_CONFIG,
      text: {}
    });
    $ = ctx.$;
    soleTrader = ctx.soleTrader;
    harness.buildCheckoutForm();
    $("form[name='checkout']").append('<div class="twoinc-sole-trader-note-slot"></div>');
    ajax = stubAjax($);
  });

  afterEach(() => {
    ajax.restore();
    soleTrader.stopTokenRefresh();
    harness.releasePanel(ctx.helper);
    jest.clearAllTimers();
    jest.useRealTimers();
    document.body.innerHTML = "";
  });

  describe("availability", () => {
    test("a 429 is cached, so the next refresh issues no request", () => {
      soleTrader.refresh();
      ajax.last().failWith(429, "30");

      expect(soleTrader.availabilityByCountry.GB).toBe(false);

      soleTrader.refresh();

      expect(ajax.calls.length).toBe(1);
    });

    test("the cache expires with the header's window", () => {
      soleTrader.refresh();
      ajax.last().failWith(429, "30");

      jest.advanceTimersByTime(30000);
      soleTrader.refresh();

      expect(ajax.calls.length).toBe(2);
    });

    test("a 500 is not cached, so the next refresh re-requests", () => {
      soleTrader.refresh();
      ajax.last().failWith(500);

      expect("GB" in soleTrader.availabilityByCountry).toBe(false);

      soleTrader.refresh();

      expect(ajax.calls.length).toBe(2);
    });
  });

  describe("token mint", () => {
    test("a 429 backs off, so the next mint answers false without a request", () => {
      soleTrader.fetchTokens();
      ajax.last().failWith(429, "30");

      expect(soleTrader.tokenMintBackoffUntil).toBe(Date.now() + 30000);

      const cb = jest.fn();
      soleTrader.fetchTokens(cb);

      expect(ajax.calls.length).toBe(1);
      expect(cb).toHaveBeenCalledWith(false);
    });

    test("a mint after the window issues a request again", () => {
      soleTrader.fetchTokens();
      ajax.last().failWith(429, "30");

      jest.advanceTimersByTime(30000);
      soleTrader.fetchTokens();

      expect(ajax.calls.length).toBe(2);
    });

    test("a 500 does not back off", () => {
      const first = jest.fn();
      soleTrader.fetchTokens(first);
      ajax.last().failWith(500);

      expect(soleTrader.tokenMintBackoffUntil).toBe(0);
      expect(first).toHaveBeenCalledWith(false);

      soleTrader.fetchTokens();

      expect(ajax.calls.length).toBe(2);
    });
  });
});
