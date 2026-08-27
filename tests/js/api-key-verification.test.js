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

  test('a 5xx shows a service-error message, not "invalid key"', async () => {
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

  test("a transport-level failure talking to admin-ajax.php shows a neutral message — it hasn't reached Two yet, so it must not blame Two's API", async () => {
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
    expect(text).toMatch(/could not complete verification/i);
    expect(text).not.toMatch(/invalid or has expired/i);
    expect(text).not.toMatch(/two's api/i);
    expect($("#twoinc-merchant-info").css("display")).toBe("none");
  });

  // The localisation contract only: a literal creeping back in front of a
  // `notices.X` lookup shows an overlay's admin the wrong brand, and nothing
  // else would see it. Brand resolution itself is the PHP suite's.
  describe("admin.js renders the localized copy, not a literal of its own", () => {
    const OVERLAY_NOTICES = {
      invalid_key: "This API key is invalid or has expired.",
      service_error:
        "Testbrand's API returned a service error (HTTP %s). This is likely temporary on Testbrand's side — try again shortly.",
      unreachable:
        "Could not reach Testbrand's API (network or connectivity error). Try again shortly.",
      not_configured: "Enter an API key above to enable Testbrand.",
      request_failed: "Could not complete verification — try again shortly.",
      unexpected_response: "Testbrand's API returned an unexpected response (HTTP %s).",
      unverified: "This API key could not be verified."
    };

    test("a 5xx names the overlay brand, not Two, and still carries the status code", async () => {
      const { $ } = await loadAdmin({
        apiKey: "an-old-stored-key",
        checked: [30],
        apiKeyNotices: OVERLAY_NOTICES,
        stubAjax: stubAjaxError("service_error", 503)
      });

      const text = $("#twoinc-merchant-invalid-notice").text();
      expect(text).toContain("Testbrand's API");
      expect(text).toContain("503");
      expect(text).not.toContain("%s");
      expect(text).not.toMatch(/\bTwo\b/);
    });

    // A translator may legitimately reference %2$s (the status code) more than
    // once — msgfmt accepts it — so PHP hands admin.js a string with two %s.
    // Replacing only the first left a raw "%s" on screen.
    test("a translation that repeats the status placeholder substitutes every occurrence", async () => {
      const { $ } = await loadAdmin({
        apiKey: "an-old-stored-key",
        checked: [30],
        apiKeyNotices: Object.assign({}, OVERLAY_NOTICES, {
          service_error: "Testbrand: HTTP %s — service error (HTTP %s), try again shortly."
        }),
        stubAjax: stubAjaxError("service_error", 503)
      });

      const text = $("#twoinc-merchant-invalid-notice").text();
      expect(text).not.toContain("%s");
      expect(text.match(/503/g)).toHaveLength(2);
    });

    test("an unreachable API names the overlay brand, not Two", async () => {
      const { $ } = await loadAdmin({
        apiKey: "an-old-stored-key",
        checked: [30],
        apiKeyNotices: OVERLAY_NOTICES,
        stubAjax: stubAjaxError("unreachable", 0)
      });

      const text = $("#twoinc-merchant-invalid-notice").text();
      expect(text).toContain("Could not reach Testbrand's API");
      expect(text).not.toMatch(/\bTwo\b/);
    });

    test("an uncategorized failure with a status code names the overlay brand, not Two", async () => {
      const { $ } = await loadAdmin({
        apiKey: "an-old-stored-key",
        checked: [30],
        apiKeyNotices: OVERLAY_NOTICES,
        stubAjax: stubAjaxError("error", 418)
      });

      const text = $("#twoinc-merchant-invalid-notice").text();
      expect(text).toContain("Testbrand's API returned an unexpected response (HTTP 418).");
      expect(text).not.toMatch(/\bTwo\b/);
    });
  });

  // The fallback literals only render when the localisation never arrived, so
  // they must not name a brand at all — this file ships unchanged to overlays.
  test("the fallback copy used when localisation is absent names no brand", async () => {
    const { $ } = await loadAdmin({
      apiKey: "an-old-stored-key",
      checked: [30],
      stubAjax: stubAjaxError("service_error", 503)
    });

    const text = $("#twoinc-merchant-invalid-notice").text();
    expect(text).toMatch(/service error/i);
    expect(text).toContain("503");
    expect(text).not.toMatch(/\bTwo\b/);
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
