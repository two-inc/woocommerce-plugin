/**
 * A stored API key that fails re-verification on page load must not leave
 * the previously fetched Merchant ID / short name on screen — that reads as
 * "the integration is fine" when it is actually broken, and made a recent
 * live incident take longer than it should have to diagnose from the
 * settings page alone.
 *
 * `admin.js` always re-verifies a stored key on page load (see the bottom of
 * the "API Key verification functionality" block). These tests drive that
 * exact path via a stubbed `$.ajax` and assert the merchant-info block is
 * replaced by the invalid-key notice — not left showing the stale value the
 * PHP template rendered server-side.
 */

"use strict";

const { loadAdmin } = require("./admin-harness");

describe("API key verification — merchant info display", () => {
  test("stored key that fails verification clears merchant info and shows the invalid notice", async () => {
    const { $ } = await loadAdmin({
      apiKey: "an-old-stored-key",
      checked: [30],
      stubAjax: function (jq) {
        jq.ajax = jest.fn(function (settings) {
          settings.success({ success: false, data: { message: "API key is invalid" } });
          return { done: function () {}, fail: function () {} };
        });
      }
    });

    expect($("#twoinc-merchant-info").css("display")).toBe("none");
    expect($("#twoinc-signup-prompt").css("display")).toBe("none");
    expect($("#twoinc-merchant-invalid-notice").css("display")).not.toBe("none");
  });

  test("stored key that errors at the transport level also clears merchant info", async () => {
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

    expect($("#twoinc-merchant-info").css("display")).toBe("none");
    expect($("#twoinc-merchant-invalid-notice").css("display")).not.toBe("none");
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
