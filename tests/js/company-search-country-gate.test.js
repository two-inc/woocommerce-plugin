/**
 * The ordinary company-search control's own per-country gate.
 *
 * The registry's supported-countries answer names every country its company
 * search covers. It is fetched once per page load, and a country outside it
 * withdraws the SEARCH — the query row inside the panel and the
 * registered-company chip — and nothing else. The panel still opens and the
 * field is never given the native `disabled` flag, because the chips inside
 * the panel are the buyer's only route to manual entry (ABN-525).
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

  function searchIsWithdrawn() {
    return ctx.helper.panel.isDisabled();
  }

  function queryRowIsHidden() {
    const row = document.querySelector(".two-company-dropdown__search");
    return !row || row.classList.contains("two-hidden");
  }

  function wrapHasUnsupportedClass() {
    return ctx
      .$(ctx.helper.companyFieldSelector())
      .closest("." + ctx.helper.fieldWrapClass)
      .hasClass(ctx.helper.companySearchUnsupportedCountryClass);
  }

  test.each([
    [["GB", "US"], false, "a covered country leaves the search offered"],
    [["US"], true, "an uncovered country withdraws the search and marks the wrap"]
  ])("supported %j withdraws the search: %s (%s)", (supported, withdrawn, description) => {
    ctx.helper.syncCompanySearchAvailability();
    supportedCountriesRequest().succeed({ supported_countries: supported });

    expect(searchIsWithdrawn()).toBe(withdrawn);
    expect(wrapHasUnsupportedClass()).toBe(withdrawn);
    // The buyer's own company name reaches the form through this field in
    // manual entry, so the gate must never make it unusable.
    expect(fieldIsDisabled()).toBe(false);
    expect(description).toBeTruthy();
  });

  test.each([
    ["US", true, "switching to an uncovered country withdraws a search that was offered"],
    ["GB", false, "switching back to a covered country offers it again"]
  ])("country %s leaves the search withdrawn: %s (%s)", (country, withdrawn, description) => {
    ctx.helper.syncCompanySearchAvailability();
    supportedCountriesRequest().succeed({ supported_countries: ["GB"] });
    ctx.helper.countryDidChange("GB");
    expect(searchIsWithdrawn()).toBe(false);
    ctx.$("#billing_country").append('<option value="US">US</option>');

    ctx.$("#billing_country").val(country);
    ctx.Twoinc.getInstance().syncBillingCountry();

    expect(searchIsWithdrawn()).toBe(withdrawn);
    expect(wrapHasUnsupportedClass()).toBe(withdrawn);
    expect(fieldIsDisabled()).toBe(false);
    expect(description).toBeTruthy();
  });

  test("an uncovered country still opens the panel, without its query row", () => {
    // Given: a country the registry search does not cover.
    ctx.helper.syncCompanySearchAvailability();
    supportedCountriesRequest().succeed({ supported_countries: ["US"] });

    // When: the buyer reaches for the control.
    const opened = ctx.helper.openCompanySearchDropdown();

    // Then: the panel is up, so its chips are reachable, and the search is not.
    expect(opened).toBe(true);
    expect(ctx.helper.companySearchDropdownIsOpen()).toBe(true);
    expect(queryRowIsHidden()).toBe(true);
  });

  /** The chips the buyer can actually see, by mode; empty when the row is hidden. */
  function visibleChipModes() {
    const row = document.querySelector(".two-company-mode-chips");
    if (!row || row.classList.contains("two-hidden")) return [];
    return Array.prototype.slice
      .call(row.querySelectorAll(".two-company-mode-chip"))
      .filter(function (chip) {
        return !chip.classList.contains("two-hidden");
      })
      .map(function (chip) {
        return chip.getAttribute("data-two-chip");
      });
  }

  test("the manual-entry chip is the one the buyer can still see", () => {
    ctx.helper.syncCompanySearchAvailability();
    supportedCountriesRequest().succeed({ supported_countries: ["US"] });
    ctx.helper.openCompanySearchDropdown();

    const visible = visibleChipModes();

    expect(visible).toContain("manual");
    expect(visible).not.toContain("registered");
  });

  test("a panel built AFTER the answer landed still carries the gate", () => {
    // Given: a resolved answer, and a checkout re-render that took the panel
    // this control was carrying the gate on.
    ctx.helper.syncCompanySearchAvailability();
    supportedCountriesRequest().succeed({ supported_countries: ["US"] });
    harness.releasePanel(ctx.helper);

    // When: the control rebuilds, with no country change to re-ask the gate.
    ctx.helper.attach();

    expect(ctx.helper.panel.isDisabled()).toBe(true);
  });

  test("manual entry survives as the ONLY offered mode, row and all", () => {
    // Given: an uncovered country AND no sole-trader route — one chip left,
    // and it is not the mode the buyer is in.
    ctx.helper.soleTrader.isAvailable = () => false;
    ctx.helper.syncCompanySearchAvailability();
    supportedCountriesRequest().succeed({ supported_countries: ["US"] });

    ctx.helper.openCompanySearchDropdown();

    expect(visibleChipModes()).toEqual(["manual"]);
  });

  function pressKey(node, key) {
    node.dispatchEvent(new window.KeyboardEvent("keydown", { key: key, bubbles: true }));
  }

  // A chip is a `<button>`, which swallows typing, so a caret parked on one
  // loses every character the buyer types (ABN-554).
  test.each([
    {
      key: "f",
      chipFirst: false,
      landsOnField: true,
      description: "a key on the closed field, which opens onto a chip"
    },
    {
      key: "f",
      chipFirst: true,
      landsOnField: true,
      description: "a key while a chip already holds the caret"
    },
    {
      key: " ",
      chipFirst: true,
      landsOnField: false,
      description: "Space, which activates the focused chip instead"
    }
  ])(
    "the caret while the search is withdrawn: $description",
    ({ key, chipFirst, landsOnField }) => {
      ctx.helper.syncCompanySearchAvailability();
      supportedCountriesRequest().succeed({ supported_countries: ["US"] });
      const field = document.querySelector(ctx.helper.companyFieldSelector());
      let target = field;
      if (chipFirst) {
        ctx.helper.openCompanySearchDropdown();
        target = document.activeElement;
      }

      pressKey(target, key);

      expect(document.activeElement).toBe(landsOnField ? field : target);
    }
  );

  test("a covered country still puts the caret in the query row", () => {
    ctx.helper.syncCompanySearchAvailability();
    supportedCountriesRequest().succeed({ supported_countries: ["GB"] });

    pressKey(document.querySelector(ctx.helper.companyFieldSelector()), "f");

    expect(document.activeElement).toBe(document.querySelector(".two-company-dropdown__query"));
  });

  test("the field keeps the caret across its own input event, so a space is text and not a chip press", () => {
    ctx.helper.syncCompanySearchAvailability();
    supportedCountriesRequest().succeed({ supported_countries: ["US"] });
    const field = document.querySelector(ctx.helper.companyFieldSelector());

    field.value = "f";
    field.dispatchEvent(new window.Event("input", { bubbles: true }));

    expect(document.activeElement).toBe(field);
  });

  test("typing in the field while the search is withdrawn queues no search", () => {
    ctx.helper.syncCompanySearchAvailability();
    supportedCountriesRequest().succeed({ supported_countries: ["US"] });
    ajax.calls.length = 0;

    const field = document.querySelector(ctx.helper.companyFieldSelector());
    field.value = "Alp";
    field.dispatchEvent(new window.Event("input", { bubbles: true }));

    // The keystrokes stay where the buyer put them, nothing reaches the wire,
    // and the panel is up with the manual-entry chip a click away.
    expect(field.value).toBe("Alp");
    expect(document.querySelector(".two-company-dropdown__query").value).toBe("");
    expect(ajax.calls.length).toBe(0);
    expect(ctx.helper.companySearchDropdownIsOpen()).toBe(true);
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
