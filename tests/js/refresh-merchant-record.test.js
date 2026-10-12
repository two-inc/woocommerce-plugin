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

  // TWO-26153: a refresh reloads the page onto Diagnostics, so the tax code
  // section is rendered afresh; a failed one stays put with its reason.
  test.each([
    [{ success: true, data: { message: "Merchant profile refreshed." } }, 1, "a success reloads onto Diagnostics"],
    [{ success: false, data: { message: "No." } }, 0, "a refused refresh does not reload"],
    [null, 0, "a transport failure does not reload"]
  ])("%#: reload, %s", async (response, reloads, description) => {
    window.history.replaceState(null, "", "/wp-admin/admin.php?page=wc-settings&tab=checkout#top");
    window.twoincAdminNavigate = jest.fn();
    try {
      const { $ } = await loadRefreshPage(respondWith(response));
      $("#twoinc-refresh-merchant-record").trigger("click");

      expect([window.twoincAdminNavigate.mock.calls.length, description]).toEqual([reloads, description]);
      if (reloads) {
        const url = new URL(window.twoincAdminNavigate.mock.calls[0][0]);
        expect([url.searchParams.get("page"), url.searchParams.get("tab"), url.hash]).toEqual(["wc-settings", "checkout", "#twoinc-refresh-merchant-record"]);
        expect(url.searchParams.get("twoinc_refreshed")).toMatch(/^\d+$/);
      }
    } finally {
      delete window.twoincAdminNavigate;
    }
  });

  test.each([
    ["/wp-admin/admin.php?page=wc-settings&twoinc_refreshed=1700000000000&tab=checkout#twoinc-refresh-merchant-record", "/wp-admin/admin.php?page=wc-settings&tab=checkout#twoinc-refresh-merchant-record", "the landing stamp is dropped, so a later save does not confirm again"],
    ["/wp-admin/admin.php?page=wc-settings&tab=checkout", "/wp-admin/admin.php?page=wc-settings&tab=checkout", "a URL without it is left alone"]
  ])("%#: %s", async (landing, expected, description) => {
    window.history.replaceState(null, "", landing);
    await loadRefreshPage(respondWith(null));
    expect([window.location.pathname + window.location.search + window.location.hash, description]).toEqual([expected, description]);
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
