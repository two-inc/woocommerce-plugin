/**
 * TWO-25326 follow-up (2026-08-05 incident). Before this change, EVERY
 * non-200 response from /v1/merchant/verify_api_key — an actual 401/403
 * invalid key, a Two 5xx, or a network/routing failure reaching Two at all
 * — was reported to the admin identically as "API key is invalid". That
 * made a routing failure look exactly like a merchant typo, and cost real
 * time diagnosing today's incident from the settings page alone.
 *
 * `admin.js` always re-verifies a stored key on page load (see the bottom of
 * the "API Key verification functionality" block). These tests drive that
 * exact path via a stubbed `$.ajax` and assert the merchant-info block is
 * replaced by a notice whose TEXT differs per failure category — not a
 * single generic "invalid" message, and not the raw response body/content.
 */

"use strict";

const { loadAdmin } = require("./admin-harness");

function stubAjaxError(status, code) {
  return function (jq) {
    jq.ajax = jest.fn(function (settings) {
      settings.success({
        success: false,
        data: { message: "API key could not be verified", status: status, code: code }
      });
      return { done: function () {}, fail: function () {} };
    });
  };
}

describe("API key verification — categorized failure display", () => {
  test("401/403 shows an invalid-key message", async () => {
    const { $ } = await loadAdmin({
      apiKey: "an-old-stored-key",
      checked: [30],
      stubAjax: stubAjaxError("invalid_key", 401)
    });

    expect($("#twoinc-merchant-info").css("display")).toBe("none");
    expect($("#twoinc-signup-prompt").css("display")).toBe("none");
    expect($("#twoinc-merchant-invalid-notice").css("display")).not.toBe("none");
    expect($("#twoinc-merchant-invalid-notice").text()).toMatch(/invalid or has expired/i);
  });

  test('a 5xx shows a Two-service-error message, not "invalid key"', async () => {
    const { $ } = await loadAdmin({
      apiKey: "an-old-stored-key",
      checked: [30],
      stubAjax: stubAjaxError("service_error", 503)
    });

    const text = $("#twoinc-merchant-invalid-notice").text();
    expect(text).toMatch(/service error/i);
    expect(text).toMatch(/503/);
    expect(text).not.toMatch(/invalid or has expired/i);
  });

  test("a transport-level (network) error also shows an unreachable message, distinct from invalid key", async () => {
    const { $ } = await loadAdmin({
      apiKey: "an-old-stored-key",
      checked: [30],
      stubAjax: function (jq) {
        jq.ajax = jest.fn(function (settings) {
          settings.error({}, "error", "Network error");
          return { done: function () {}, fail: function () {} };
        });
      }
    });

    const text = $("#twoinc-merchant-invalid-notice").text();
    expect(text).toMatch(/could not reach/i);
    expect(text).not.toMatch(/invalid or has expired/i);
    expect($("#twoinc-merchant-info").css("display")).toBe("none");
  });

  test("stored key that verifies successfully shows merchant info, not the invalid notice", async () => {
    const { $ } = await loadAdmin({
      apiKey: "an-old-stored-key",
      checked: [30],
      stubAjax: function (jq) {
        jq.ajax = jest.fn(function (settings) {
          settings.success({
            success: true,
            data: { merchant_id: "42", merchant_short_name: "Acme" }
          });
          return { done: function () {}, fail: function () {} };
        });
      }
    });

    expect($("#twoinc-merchant-info").css("display")).not.toBe("none");
    expect($("#twoinc-merchant-invalid-notice").css("display")).toBe("none");
    expect($("#twoinc-merchant-id").text()).toBe("42");
  });
});
