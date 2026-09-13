/**
 * ABN-554. Manual entry captures a company NAME and deliberately no number,
 * so a buyer could fill the whole checkout in and only learn at submit that
 * `process_payment` refuses an order with no company number.
 *
 * `getApproval()` is where this is said instead, because it is the one choke
 * point every capture change already routes through — the same reason the
 * stale-verdict clearing lives there (see intent-loading-state.test.js).
 *
 * The sentence itself is the PHP renderer's and is asserted in
 * tests/unit/run.php; what this suite needs from it is the class name.
 */

"use strict";

const harness = require("./wc-harness");

const GATEWAY_ID = "woocommerce-gateway-tillit";
const NOTICE = ".twoinc-err-no-company";

describe("the company-required notice", () => {
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
      currency: "GBP",
      merchant: { id: "m-1", short_name: "acme" },
      text: {}
    });
    $ = ctx.$;
    dom = ctx.dom;

    harness.buildCheckoutForm();
    buildPaymentTile();

    instance = ctx.Twoinc.getInstance();
    instance.customerRepresentative = {
      email: "buyer@example.test",
      first_name: "Ada",
      last_name: "Lovelace",
      phone_number: "+4471234567"
    };
  });

  afterEach(() => {
    harness.releasePanel(ctx.helper);
    jest.clearAllTimers();
    jest.useRealTimers();
    document.body.innerHTML = "";
  });

  // The chips and the pay-boxes this suite reads, with the classes and the
  // `hidden` starting state the PHP renderer emits.
  function buildPaymentTile() {
    $(document.body).append(
      '<li class="wc_payment_method"><div class="payment_box">' +
        '<span class="twoinc-term-chips-heading" id="twoinc-term-chips-heading">Terms</span>' +
        '<div class="twoinc-term-chips" role="radiogroup" ' +
        'aria-labelledby="twoinc-term-chips-heading"></div>' +
        '<div class="twoinc-pay-box twoinc-loader hidden" role="status">Checking</div>' +
        '<div class="twoinc-pay-box twoinc-err-no-company hidden" role="status">' +
        "SEARCH_AND_SELECT" +
        "</div>" +
        "</div></li>"
    );
    $("form[name='checkout']").append(
      '<input type="radio" name="payment_method" value="' + GATEWAY_ID + '" checked />'
    );
  }

  function shown(selector) {
    const $box = $(selector);
    return $box.length > 0 && !$box.hasClass("hidden");
  }

  function chipsWithheld() {
    return $(".twoinc-term-chips").hasClass("twoinc-withheld");
  }

  function captureCompany(organizationNumber) {
    instance.customerCompany = {
      company_name: "ACME Widgets Ltd",
      organization_number: organizationNumber,
      country_prefix: "GB"
    };
    $("#billing_company").val("ACME Widgets Ltd");
    $("#company_id").val(organizationNumber);
  }

  describe.each([
    // A captured NUMBER is the whole question — the same value
    // `process_payment` refuses when it is empty. The name being present is
    // what makes manual entry look complete, so every row carries one.
    ["", "yes", true, "manual entry captures a name and no number"],
    ["", "no", true, "the merchant's order-intent switch does not gate this"],
    ["12345678", "yes", false, "a captured number lets the usual check run"],
    ["12345678", "no", false, "a skipped check must not strand the chips"]
  ])(
    "organisation number %p with order intent %p",
    (organizationNumber, orderIntent, expectNotice, description) => {
      beforeEach(() => {
        window.twoinc.enable_order_intent = orderIntent;
        captureCompany(organizationNumber);
      });

      test(description, () => {
        const ajax = harness.stubAjax($);
        try {
          instance.getApproval();

          expect(shown(NOTICE)).toBe(expectNotice);
          expect(chipsWithheld()).toBe(expectNotice);
          if (expectNotice) {
            // Not merely "no request yet": the notice replaces the check, so
            // letting the interval run must still produce none.
            jest.advanceTimersByTime(10000);
            expect(ajax.calls.length).toBe(0);
          }
        } finally {
          ajax.restore();
        }
      });
    }
  );

  test("the notice carries its sentence once revealed", () => {
    captureCompany("");

    instance.getApproval();

    expect($(NOTICE).text()).toBe("SEARCH_AND_SELECT");
  });

  test("a repeat paint of the same notice mutates nothing", () => {
    // The sentence is written into a live region, so every write is an
    // announcement. `getApproval()` runs on each field blur, and without the
    // already-shown guard a buyer filling in the rest of the checkout would be
    // told to search for their company on every one of them.
    captureCompany("");
    instance.getApproval();
    expect(shown(NOTICE)).toBe(true);

    let mutations = 0;
    const observer = new MutationObserver(function (records) {
      mutations += records.length;
    });
    observer.observe($(NOTICE)[0], { childList: true, characterData: true, subtree: true });
    try {
      instance.getApproval();
      // jsdom delivers records on a microtask; flush before reading.
      observer.takeRecords().forEach(function () {
        mutations += 1;
      });
    } finally {
      observer.disconnect();
    }

    expect(mutations).toBe(0);
    expect(shown(NOTICE)).toBe(true);
  });

  test("clearing the intent verdicts leaves the notice standing", () => {
    // Typing a company name fires `#billing_company`'s change handler, which
    // clears the verdicts and arms no check of its own — so a notice this
    // cleared would stay gone for the rest of the manual-entry journey, which
    // is the one journey it exists for.
    captureCompany("");
    instance.getApproval();
    expect(shown(NOTICE)).toBe(true);

    dom.clearIntentVerdicts();

    expect(shown(NOTICE)).toBe(true);
  });

  test("capturing a company takes the notice and the withholding away", () => {
    captureCompany("");
    instance.getApproval();
    expect(shown(NOTICE)).toBe(true);
    expect(chipsWithheld()).toBe(true);

    captureCompany("12345678");
    instance.getApproval();

    expect(shown(NOTICE)).toBe(false);
    expect(chipsWithheld()).toBe(false);
  });
});
