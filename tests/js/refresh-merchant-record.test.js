// The Diagnostics "Refresh merchant profile" button: a refresh that could not land must say so inline.

"use strict";

const { loadAdmin } = require("./admin-harness");

function stubAjax(handler) {
  return function (jq) {
    jq.ajax = jest.fn(handler);
  };
}

async function loadRefreshPage(handler) {
  return loadAdmin({
    refreshMerchantRecord: true,
    checked: [30],
    stubAjax: stubAjax(handler)
  });
}

function respondWith(response) {
  return function (settings) {
    if (response === null) {
      settings.error({}, "error", "Network error");
    } else {
      settings.success(response);
    }
    settings.complete();
    return { done: function () {}, fail: function () {} };
  };
}

describe("Diagnostics refresh merchant profile", () => {
  test.each([
    {
      response: {
        success: true,
        data: { message: "Merchant profile refreshed.", merchant: "sn - mid" }
      },
      expected: /Merchant profile refreshed\. sn - mid/,
      description: "a success reports which profile was refreshed"
    },
    {
      response: {
        success: false,
        data: {
          message: "Could not refresh the merchant profile. Check that the API key is valid."
        }
      },
      expected: /Check that the API key is valid/,
      description: "a refused refresh reports the server's reason"
    },
    {
      response: { success: false, data: {} },
      expected: /Could not refresh the merchant profile\./,
      description: "a reasonless failure still reports a failure"
    },
    {
      response: null,
      expected: /Could not refresh the merchant profile\./,
      description: "a transport failure reaching admin-ajax.php is reported, not swallowed"
    }
  ])("$description", async ({ response, expected }) => {
    const { $ } = await loadRefreshPage(respondWith(response));
    $("#twoinc-refresh-merchant-record").trigger("click");

    expect($("#twoinc-refresh-merchant-record-status").text()).toMatch(expected);
    expect($("#twoinc-refresh-merchant-record").prop("disabled")).toBe(false);
  });

  test("the request carries the nonce and the action the PHP handler is registered on", async () => {
    const { $ } = await loadRefreshPage(function () {
      return { done: function () {}, fail: function () {} };
    });
    $("#twoinc-refresh-merchant-record").trigger("click");

    const settings = $.ajax.mock.calls[0][0];
    expect(settings.type).toBe("POST");
    expect(settings.data.action).toBe("twoinc_refresh_merchant_record");
    expect(settings.data.csrf_token).toBe("test-csrf-token");
  });
});
