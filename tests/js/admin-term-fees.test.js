/**
 * ABN-540. The inline per-term fee display beside the Payment Terms
 * checkboxes drew a term the answer did not price as an EMPTY span, which
 * reads as "this term carries no fee" — a wrong figure rather than a missing
 * one. It also dropped the fixed component silently when the answer carried no
 * currency, which the server now refuses outright.
 *
 * The spans are populated by the `twoinc_term_fees` request the payment-terms
 * bootstrap fires on load, so these drive that exact path through a stubbed
 * `$.ajax` and read the rendered spans.
 */

"use strict";

const { loadAdmin } = require("./admin-harness");

const NO_FIGURE = " (no figure)";

/** Stub $.ajax to settle the inline-fee request: done($response), or fail(). */
function settleWith(response, fails) {
  return function (jq) {
    jq.ajax = jest.fn(function () {
      const chain = {
        done: function (cb) {
          if (!fails) cb(response);
          return chain;
        },
        fail: function (cb) {
          if (fails) cb();
          return chain;
        }
      };
      return chain;
    });
  };
}

/** The rendered fee label of each term checkbox, in order. */
async function feeSpans(response, options) {
  const { $ } = await loadAdmin(
    Object.assign(
      {
        inlineFees: true,
        terms: [30, 60],
        checked: [30, 60],
        stubAjax: settleWith(response, false)
      },
      options || {}
    )
  );

  return $(".twoinc-term-checkboxes .twoinc-term-fee")
    .map(function () {
      return $(this).text();
    })
    .get();
}

function priced(fees, currency) {
  return { success: true, data: { currency: currency, fees: fees } };
}

describe("inline term fees — a term the answer did not price says so", () => {
  test.each([
    [
      "a term the answer skipped is labelled, not left blank",
      priced({ 30: { percentage: 2, fixed: 0 } }, "EUR"),
      [" (2.00%)", NO_FIGURE]
    ],
    [
      "every priced term shows its own figure",
      priced({ 30: { percentage: 2, fixed: 1.5 }, 60: { percentage: 3, fixed: 0 } }, "EUR"),
      [" (2.00% + 1.50 EUR)", " (3.00%)"]
    ],
    [
      "a term priced AT nothing shows its zero, unlike one never priced",
      priced({ 30: { percentage: 0, fixed: 0 }, 60: { percentage: 0, fixed: 0 } }, "EUR"),
      [" (0.00 EUR)", " (0.00 EUR)"]
    ],
    ["an answer pricing no term at all", priced({}, "EUR"), [NO_FIGURE, NO_FIGURE]],
    ["a refused answer", { success: false, data: {} }, [NO_FIGURE, NO_FIGURE]],
    ["an answer carrying no fees key", { success: true, data: {} }, [NO_FIGURE, NO_FIGURE]],
    ["no answer body at all", null, [NO_FIGURE, NO_FIGURE]]
  ])("%s", async (description, response, expected) => {
    expect(await feeSpans(response)).toEqual(expected);
  });

  // The server refuses a currency-less set, so only a stale response reaches
  // the screen with one. Drawing its amounts unitless reads as a percentage,
  // and dropping the fixed component (the behaviour this replaces) hides a
  // real charge; the whole set is labelled instead.
  test("a currency-less answer is labelled, not drawn as unitless amounts", async () => {
    const fees = { 30: { percentage: 2, fixed: 1.5 }, 60: { percentage: 0, fixed: 4 } };
    expect(await feeSpans(priced(fees, ""))).toEqual([NO_FIGURE, NO_FIGURE]);
  });

  test("a request that fails outright labels every term rather than leaving gaps", async () => {
    const { $ } = await loadAdmin({
      inlineFees: true,
      terms: [30, 60],
      checked: [30, 60],
      stubAjax: settleWith(null, true)
    });

    expect(
      $(".twoinc-term-checkboxes .twoinc-term-fee")
        .map(function () {
          return $(this).text();
        })
        .get()
    ).toEqual([NO_FIGURE, NO_FIGURE]);
  });

  // This file ships unchanged to brand overlays and to every locale, so a
  // literal creeping back in front of the localisation lookup would show
  // English on a translated shop and nothing else would see it.
  test("the label is the localized one, not a literal of its own", async () => {
    const spans = await feeSpans(priced({}, "EUR"), { noFeeFigureLabel: "geen bedrag" });

    expect(spans).toEqual([" (geen bedrag)", " (geen bedrag)"]);
  });
});
