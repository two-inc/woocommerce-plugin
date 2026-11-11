/**
 * TWO-27235. With no country selected, company search says "Select your
 * country above to search for your company." instead of asking the registry,
 * on load and after the buyer clears the country.
 *
 * Only the clear itself may abort a search. The checkout re-notifies with the
 * country still empty: WooCommerce re-emits `change` on #billing_country, and
 * `updated_checkout` fires after every refresh (the Blocks checkout reaches
 * the same handler on each store pass that moves an address field). A repeat
 * that aborted would cancel the search the buyer typed since, with the spinner
 * left on. A page that loads with no country counts as already cleared, so its
 * first empty notification is a repeat too.
 *
 * Driven through `initialize()`'s own bindings and the real panel.
 */

"use strict";

const harness = require("./wc-harness");

const SENTENCE = "Select your country above to search for your company.";

describe("company search with no country", () => {
  let ctx;
  let ajax;

  beforeEach(() => {
    // initialize() installs timers that would outlive the test on real ones.
    jest.useFakeTimers();
    ctx = harness.loadTwoinc({});
    harness.buildCheckoutForm({ country: "GB" });
    ctx.$("#billing_country").prepend('<option value="">Select a country</option>');
    // The checkout-page gate initialize() returns on, and the gateway radio.
    ctx.$("form[name='checkout']").after('<div id="order_review"></div>');
    ctx
      .$("form[name='checkout']")
      .append(
        "<input type='radio' id='payment_method_woocommerce-gateway-tillit'" +
          " name='payment_method' value='woocommerce-gateway-tillit' />"
      );
    ajax = harness.stubAjax(ctx.$);
  });

  afterEach(() => {
    ajax.restore();
    harness.releasePanel(ctx.helper);
    // `initialize()` delegates on document.body, which outlives the test.
    ctx.$(document.body).off();
    document.body.innerHTML = "";
    window.sessionStorage.clear();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  /** The panel binds its query field with addEventListener, which `.trigger()` misses. */
  function typeQuery(runDebounce) {
    harness.openCompanyPanel(ctx.$, ctx.helper);
    const query = document.querySelector(".two-company-dropdown__query");
    query.value = "exampleco";
    query.dispatchEvent(new window.Event("input", { bubbles: true }));
    if (runDebounce) jest.advanceTimersByTime(ctx.helper.companySearchDebounceMs);
  }

  function setCountry(country) {
    ctx.$("#billing_country").val(country);
  }

  const STEPS = {
    type: () => typeQuery(true),
    // Typed, debounce still pending: the window a repeat abort would kill.
    typeHeld: () => typeQuery(false),
    debounce: () => jest.advanceTimersByTime(ctx.helper.companySearchDebounceMs),
    clear: () => {
      setCountry("");
      ctx.$("#billing_country").trigger("change");
    },
    pick: () => {
      setCountry("GB");
      ctx.$("#billing_country").trigger("change");
    },
    repeatChange: () => ctx.$("#billing_country").trigger("change"),
    rerender: () => ctx.$(document.body).trigger("updated_checkout")
  };

  function searches() {
    return ajax.calls.filter(function (call) {
      return call.url === harness.API_PROXY.company_search_url;
    });
  }

  function spinnerVisible() {
    const spinner = document.querySelector(".two-company-dropdown__spinner");
    return !!spinner && spinner.classList.contains("two-company-dropdown__spinner--active");
  }

  /** The transport resolves a Promise, so its answer lands on a microtask. */
  function flushPromises() {
    return Promise.resolve().then(() => Promise.resolve());
  }

  test.each([
    {
      load: "",
      steps: ["type"],
      countries: [],
      sentence: true,
      aborted: false,
      description: "on load with no country, a search asks for one and sends nothing"
    },
    {
      load: "GB",
      steps: ["clear", "type"],
      countries: [],
      sentence: true,
      aborted: false,
      description: "after the country is cleared, a search asks for one and sends nothing"
    },
    {
      load: "GB",
      steps: ["type", "clear"],
      countries: ["GB"],
      sentence: false,
      aborted: true,
      description: "the clear aborts the search in flight for the country just left"
    },
    {
      load: "GB",
      steps: ["clear", "typeHeld", "repeatChange", "rerender", "debounce"],
      countries: [],
      sentence: true,
      aborted: false,
      description: "a repeat empty notification after the clear aborts nothing"
    },
    {
      load: "",
      steps: ["typeHeld", "repeatChange", "rerender", "debounce"],
      countries: [],
      sentence: true,
      aborted: false,
      description: "a page loaded with no country: its first empty notification aborts nothing"
    },
    {
      load: "",
      steps: ["pick", "type"],
      countries: ["GB"],
      sentence: false,
      aborted: false,
      description: "a country then picked searches normally"
    },
    {
      load: "GB",
      steps: ["clear", "pick", "type"],
      countries: ["GB"],
      sentence: false,
      aborted: false,
      description: "the country back after a clear searches normally"
    }
  ])(
    "loaded with '$load', $steps: $description",
    async ({ load, steps, countries, sentence, aborted, description }) => {
      setCountry(load);
      ctx.Twoinc.getInstance().initialize(false);

      steps.forEach(function (step) {
        STEPS[step]();
      });
      await flushPromises();

      expect({
        countries: searches().map(function (call) {
          return harness.requestParams(call).get("country");
        }),
        sentence: harness.resultsText(ctx.$).indexOf(SENTENCE) !== -1,
        aborted: searches().some(function (call) {
          return call.abortedWhilePending;
        }),
        // Up only while a request is on the wire. Not asked of a search the
        // clear aborted: the panel paints nothing for an aborted answer.
        spinner: aborted ? null : spinnerVisible(),
        description: description
      }).toEqual({
        countries: countries,
        sentence: sentence,
        aborted: aborted,
        spinner: aborted ? null : countries.length > 0,
        description: description
      });
    }
  );

  test("the buyer sees the localised sentence", async () => {
    ctx.twoinc.text.company_search_no_country = "Velg landet ditt ovenfor.";
    setCountry("");
    ctx.Twoinc.getInstance().initialize(false);

    typeQuery(true);
    await flushPromises();

    expect(harness.resultsText(ctx.$)).toContain("Velg landet ditt ovenfor.");
  });

  test("a search with a country after one without words an empty answer as no match", async () => {
    setCountry("");
    ctx.Twoinc.getInstance().initialize(false);
    typeQuery(true);
    await flushPromises();

    STEPS.pick();
    typeQuery(true);
    searches()[0].succeed({ items: [] });
    await flushPromises();

    expect(harness.resultsText(ctx.$)).not.toContain(SENTENCE);
    expect(harness.resultsText(ctx.$)).toContain("No matches found");
  });
});
