/**
 * TWO-27300. The live API key check posts the Environment dropdown's current
 * value with the key, so a key for an environment chosen but not yet saved is
 * checked against that environment, as the save checks it. Switching the
 * environment checks the key again.
 */

"use strict";

const { loadAdmin, FIELD_PREFIX } = require("./admin-harness");

const KEY = "a-typed-key-of-ample-length";

function recordAjax(calls) {
  return function (jq) {
    jq.ajax = jest.fn(function (settings) {
      calls.push(settings.data);
      settings.success({
        success: true,
        data: { merchant_id: "m-1", merchant_short_name: "shop" }
      });
      return { done: function () {}, fail: function () {} };
    });
  };
}

describe("the live API key check uses the environment chosen on the form", () => {
  test.each([
    {
      environment: "production",
      expected: [{ key: KEY, mode: "production" }],
      description: "env switched, unsaved: the dropdown value is posted"
    },
    {
      environment: "sandbox",
      expected: [{ key: KEY, mode: "sandbox" }],
      description: "env unchanged: the dropdown value is posted"
    },
    {
      environment: undefined,
      expected: [{ key: KEY, mode: undefined }],
      description: "mode missing: no dropdown posts no mode"
    }
  ])("$description", async ({ environment, expected, description }) => {
    const calls = [];
    await loadAdmin({ apiKey: KEY, environment, checked: [30], stubAjax: recordAjax(calls) });

    const posted = calls.map((data) => ({ key: data.api_key, mode: data.mode }));
    expect({ description, posted }).toEqual({ description, posted: expected });
  });

  test.each([
    {
      apiKey: KEY,
      hasSavedKey: true,
      expected: [
        { key: KEY, stored: 0, mode: "sandbox" },
        { key: KEY, stored: 0, mode: "production" }
      ],
      description: "a typed key is checked again against the new environment"
    },
    {
      apiKey: "",
      hasSavedKey: true,
      expected: [
        { key: "", stored: 1, mode: "sandbox" },
        { key: "", stored: 1, mode: "production" }
      ],
      description:
        "with no typed key the saved key is checked against the new environment, as the save would"
    },
    {
      apiKey: "",
      hasSavedKey: false,
      expected: [],
      description: "with no key at all nothing is sent"
    }
  ])(
    "switching the environment: $description",
    async ({ apiKey, hasSavedKey, expected, description }) => {
      const calls = [];
      const { $ } = await loadAdmin({
        apiKey,
        hasSavedKey,
        environment: "sandbox",
        checked: [30],
        stubAjax: recordAjax(calls)
      });

      $("#" + FIELD_PREFIX + "checkout_env")
        .val("production")
        .trigger("change");

      const posted = calls.map((data) => ({
        key: data.api_key,
        stored: data.stored,
        mode: data.mode
      }));
      expect({ description, posted }).toEqual({ description, posted: expected });
    }
  );
});
