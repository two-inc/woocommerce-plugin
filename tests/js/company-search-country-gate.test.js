/**
 *. The ordinary company-search control's own per-country gate.
 *
 * Bifrost's GET /companies/v2/supported-countries answers with the full list
 * of countries its registry search covers. Before this, an unsupported
 * country's search just failed at request time with a generic error; this
 * fetches the list once per page load and disables the search field itself
 * for a country outside it — the same shape as the sole-trader chip's own
 * per-country disable, but keyed against one global list instead of a
 * per-country lookup.
 */

"use strict";

const harness = require("./wc-harness");

describe("company search country gate", () => {
  let ctx;
  let ajax;

  beforeEach(() => {
    ctx = harness.loadTwoinc();
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

  function fieldIsDisabled() {
    return ctx.$(ctx.helper.companyFieldSelector()).prop("disabled");
  }

  function wrapHasUnsupportedClass() {
    return ctx
      .$(ctx.helper.companyFieldSelector())
      .closest("." + ctx.helper.fieldWrapClass)
      .hasClass(ctx.helper.companySearchUnsupportedCountryClass);
  }

  test("a country the fetch reports as supported leaves the field enabled", () => {
    ctx.helper.syncCompanySearchAvailability();
    supportedCountriesRequest().succeed({ supported_countries: ["GB", "US"] });

    expect(fieldIsDisabled()).toBe(false);
    expect(wrapHasUnsupportedClass()).toBe(false);
  });

  test("a country absent from the fetch's list disables the field and marks the wrap", () => {
    ctx.helper.syncCompanySearchAvailability();
    supportedCountriesRequest().succeed({ supported_countries: ["US"] });

    expect(fieldIsDisabled()).toBe(true);
    expect(wrapHasUnsupportedClass()).toBe(true);
  });

  test("switching to an unsupported country disables a previously-enabled field", () => {
    ctx.helper.syncCompanySearchAvailability();
    supportedCountriesRequest().succeed({ supported_countries: ["GB"] });
    ctx.helper.countryDidChange("GB");
    expect(fieldIsDisabled()).toBe(false);

    ctx.$("#billing_country").append('<option value="US">US</option>');
    ctx.$("#billing_country").val("US");
    ctx.Twoinc.getInstance().syncBillingCountry();

    expect(fieldIsDisabled()).toBe(true);
    expect(wrapHasUnsupportedClass()).toBe(true);
  });

  test("switching back to a supported country re-enables the field", () => {
    ctx.helper.syncCompanySearchAvailability();
    supportedCountriesRequest().succeed({ supported_countries: ["GB"] });
    ctx.helper.countryDidChange("GB");
    ctx.$("#billing_country").append('<option value="US">US</option>');
    ctx.$("#billing_country").val("US");
    ctx.Twoinc.getInstance().syncBillingCountry();
    expect(fieldIsDisabled()).toBe(true);

    ctx.$("#billing_country").val("GB");
    ctx.Twoinc.getInstance().syncBillingCountry();

    expect(fieldIsDisabled()).toBe(false);
    expect(wrapHasUnsupportedClass()).toBe(false);
  });

  test("a pending fetch fails open: the field stays enabled and usable", () => {
    ctx.helper.syncCompanySearchAvailability();
    expect(supportedCountriesRequest()).toBeTruthy();

    expect(fieldIsDisabled()).toBe(false);
    expect(ctx.helper.registeredSearchIsAvailable()).toBe(true);
  });

  test("a transient fetch failure fails open rather than hiding the control", () => {
    ctx.helper.syncCompanySearchAvailability();
    supportedCountriesRequest().fail("error", "network error");

    expect(fieldIsDisabled()).toBe(false);
    expect(ctx.helper.registeredSearchIsAvailable()).toBe(true);
    // The list must stay null (not e.g. []) so a later, successful fetch is
    // not permanently shadowed by this failure.
    expect(ctx.supportedSearchCountries.countries).toBeNull();
  });

  test("searchCompanies() itself refuses without hitting the network once a country is confirmed unsupported", () => {
    ctx.helper.syncCompanySearchAvailability();
    supportedCountriesRequest().succeed({ supported_countries: ["US"] });
    ajax.calls.length = 0;

    return ctx.helper
      .searchCompanies({ term: "acme", token: {}, getCountryCode: () => "GB" })
      .then(function (result) {
        expect(result).toEqual({ unavailable: true });
        expect(ajax.calls.length).toBe(0);
      });
  });

  test("the fetch runs once and is shared across both roles", () => {
    ctx.shippingHelper.attach();
    ctx.helper.syncCompanySearchAvailability();
    ctx.shippingHelper.syncCompanySearchAvailability();

    const requests = ajax.calls.filter(function (call) {
      return call.url === harness.API_PROXY.supported_countries_url;
    });
    expect(requests.length).toBe(1);
  });
});
