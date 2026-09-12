/**
 * tillit-payment-gateway.php enqueues assets/js/twoinc.js with no
 * `$in_footer` argument, so it evaluates inside `<head>` — where
 * `document.body` is still null. A module-level binding made on
 * `document.body` therefore attaches to an empty jQuery set and never fires.
 *
 * Every other suite loads the source into a jsdom document that already has a
 * body, which is why a dead binding passes them. This one removes the body for
 * the duration of the evaluation so the real page's condition is reproduced.
 */

"use strict";

const harness = require("./wc-harness");

describe("bindings made while the script evaluates in the head", () => {
  let ctx;
  let ajax;

  beforeEach(() => {
    const body = document.body;
    document.documentElement.removeChild(body);
    try {
      ctx = harness.loadTwoinc();
    } finally {
      document.documentElement.appendChild(body);
    }
    harness.buildCheckoutForm({ country: "GB" });
    ajax = harness.stubAjax(ctx.$);
    ctx.helper.attach();
  });

  afterEach(() => {
    ajax.restore();
    harness.releasePanel(ctx.helper);
    document.body.innerHTML = "";
  });

  function supportedCountriesRequest() {
    return ajax.calls.find(function (call) {
      return call.url === harness.API_PROXY.supported_countries_url;
    });
  }

  /**
   * Run one function with no body in the document, which is the state the
   * script itself evaluated in.
   *
   * @param {Function} run
   */
  function withoutBody(run) {
    const body = document.body;
    document.documentElement.removeChild(body);
    try {
      run();
    } finally {
      document.documentElement.appendChild(body);
    }
  }

  test.each([
    [["GB", "US"], false, "a covered country leaves the search offered"],
    [["US"], true, "the late answer still withdraws the search over an uncovered country"]
  ])("supported %j withdraws the search: %s (%s)", (supported, withdrawn, description) => {
    ctx.helper.syncCompanySearchAvailability();
    supportedCountriesRequest().succeed({ supported_countries: supported });

    expect(ctx.helper.panel.isDisabled()).toBe(withdrawn);
    expect(description).toBeTruthy();
  });

  // The announcement and its listener have to be rooted on the same node. A
  // body-rooted announcement is delivered nowhere whenever the answer lands
  // before `document.body` exists, and nothing re-checks the controls — and
  // every case above passes either way, because jQuery bubbles a body-rooted
  // trigger up to document once a body is there to root it on.
  test.each([
    { present: true, case: "a body in the document" },
    { present: false, case: "none yet, as when the script itself evaluated" }
  ])("the answer is announced on the document, with $case", ({ present }) => {
    let heard = 0;
    ctx.$(document).on("twoinc_supported_search_countries_updated", function () {
      heard += 1;
    });
    ctx.helper.syncCompanySearchAvailability();
    const land = function () {
      supportedCountriesRequest().succeed({ supported_countries: ["GB"] });
    };

    if (present) {
      land();
    } else {
      withoutBody(land);
    }

    expect(heard).toBe(1);
  });
});
