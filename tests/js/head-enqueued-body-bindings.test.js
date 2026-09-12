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

  test.each([
    [["GB", "US"], false, "a covered country leaves the search offered"],
    [["US"], true, "the late answer still withdraws the search over an uncovered country"]
  ])("supported %j withdraws the search: %s (%s)", (supported, withdrawn, description) => {
    ctx.helper.syncCompanySearchAvailability();
    supportedCountriesRequest().succeed({ supported_countries: supported });

    expect(ctx.helper.panel.isDisabled()).toBe(withdrawn);
    expect(description).toBeTruthy();
  });
});
