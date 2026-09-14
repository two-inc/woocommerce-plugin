/**
 * The company-search control's own per-country gates.
 *
 * Two answers decide what the buyer is given. The registry's
 * supported-countries list says where ordinary company search works; the
 * merchant record's buyer-country allowlist says where this merchant sells at
 * all. While the panel still holds a mode the buyer can use, only the SEARCH
 * is withdrawn — the query row and the registered-company chip — and the panel
 * stays openable for the rest (ABN-525). Where it holds none, the control goes
 * and WooCommerce's own company field takes its place, with the capture mode
 * left on "search" (ABN-585).
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

  /** Which of the two company-name rows the buyer can see. */
  function visibleCompanyRow() {
    return ["billing_company_display_field", "billing_company_field"].filter(function (id) {
      const row = document.getElementById(id);
      return row && !row.classList.contains("hidden");
    });
  }

  /** Move the billing country the way the buyer does, through the change handler. */
  function selectCountry(country) {
    if (!ctx.$("#billing_country option[value='" + country + "']").length) {
      ctx.$("#billing_country").append('<option value="' + country + '"></option>');
    }
    ctx.$("#billing_country").val(country);
    ctx.Twoinc.getInstance().syncBillingCountry();
  }

  /** The registry answer, and the merchant's allowlist, both settled. */
  function settleGates(registry, allowlist) {
    ctx.twoinc.supported_buyer_countries = allowlist;
    supportedCountriesRequest().succeed({ supported_countries: registry });
  }

  test.each([
    {
      country: "GB",
      registry: ["GB", "JP"],
      row: "billing_company_display_field",
      description: "a country both gates allow keeps the search control"
    },
    {
      country: "JP",
      registry: ["GB"],
      row: "billing_company_field",
      description: "a country the registry does not cover falls back to the plain field"
    },
    {
      country: "JP",
      registry: ["GB", "JP"],
      allowlist: ["GB"],
      row: "billing_company_field",
      description: "a country the merchant does not sell to falls back whatever the registry covers"
    },
    {
      country: "GB",
      registry: ["GB", "JP"],
      allowlist: ["GB", "JP"],
      row: "billing_company_display_field",
      description: "an allowlist naming the country leaves the search control alone"
    },
    {
      country: "JP",
      registry: ["GB", "JP"],
      allowlist: [],
      row: "billing_company_field",
      description: "an allowlist naming nothing falls back everywhere"
    }
  ])(
    "the company-name surface in $country: $description",
    ({ country, registry, allowlist, row }) => {
      settleGates(registry, allowlist);

      selectCountry(country);

      expect(visibleCompanyRow()).toEqual([row]);
      // The buyer's own company name reaches the form through whichever field is
      // on screen, so no gate may ever make it unusable.
      expect(fieldIsDisabled()).toBe(false);
    }
  );

  test("the field left on screen is the one WooCommerce posts", () => {
    settleGates(["GB"], undefined);

    selectCountry("JP");

    // Not the display anchor, whose value the order never sees.
    expect(ctx.capture.nameFieldSelector()).toBe("#billing_company");
    expect(document.querySelector("#billing_company").name).toBe("billing_company");
  });

  test("the capture mode stays on search — the layout changed, not the mode", () => {
    settleGates(["GB"], undefined);

    selectCountry("JP");

    expect(ctx.capture.mode).toBe("search");
  });

  test("nothing of the control is left behind on the plain field", () => {
    settleGates(["GB"], undefined);

    selectCountry("JP");

    // No popover, so no mode chips either — a Sole trader chip here would
    // offer a route the country has no answer for.
    expect(document.querySelector(".two-company-dropdown")).toBeNull();
    expect(document.querySelectorAll(".two-company-mode-chip").length).toBe(0);
    expect(ctx.helper.panel.isBound()).toBe(false);
    expect(document.querySelector("#billing_company_display").getAttribute("role")).toBeNull();
  });

  test("the control comes back when the buyer returns to a covered country", () => {
    settleGates(["GB"], undefined);
    selectCountry("JP");

    selectCountry("GB");

    expect(visibleCompanyRow()).toEqual(["billing_company_display_field"]);
    expect(ctx.helper.panel.isBound()).toBe(true);
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

  /**
   * A country the registry search does not cover but the sole-trader registry
   * does: the panel is the buyer's only route to that flow, so the search is
   * withdrawn from inside it and the control itself stays (ABN-525).
   */
  describe("while the panel still holds a mode the buyer can use", () => {
    beforeEach(() => {
      ctx.soleTrader.availabilityByCountry = { GB: true };
      ctx.helper.syncCompanySearchAvailability();
      supportedCountriesRequest().succeed({ supported_countries: ["US"] });
    });

    test("the search alone goes, and the wrap says so", () => {
      expect(searchIsWithdrawn()).toBe(true);
      expect(wrapHasUnsupportedClass()).toBe(true);
      expect(fieldIsDisabled()).toBe(false);
    });

    test("the panel still opens, without its query row", () => {
      const opened = ctx.helper.openCompanySearchDropdown();

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

    test("the chips left are the modes the country can still answer", () => {
      ctx.helper.openCompanySearchDropdown();

      expect(visibleChipModes()).toEqual(["soletrader", "manual"]);
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

    test("the field keeps the caret across its own input event, so a space is text and not a chip press", () => {
      const field = document.querySelector(ctx.helper.companyFieldSelector());

      field.value = "f";
      field.dispatchEvent(new window.Event("input", { bubbles: true }));

      expect(document.activeElement).toBe(field);
    });

    test("typing in the field while the search is withdrawn queues no search", () => {
      ajax.calls.length = 0;

      const field = document.querySelector(ctx.helper.companyFieldSelector());
      field.value = "Alp";
      field.dispatchEvent(new window.Event("input", { bubbles: true }));

      // The keystrokes stay where the buyer put them, nothing reaches the wire,
      // and the panel is up with the remaining chips a click away.
      expect(field.value).toBe("Alp");
      expect(document.querySelector(".two-company-dropdown__query").value).toBe("");
      expect(ajax.calls.length).toBe(0);
      expect(ctx.helper.companySearchDropdownIsOpen()).toBe(true);
    });
  });

  test("a covered country still puts the caret in the query row", () => {
    ctx.helper.syncCompanySearchAvailability();
    supportedCountriesRequest().succeed({ supported_countries: ["GB"] });

    pressKeyOn(document.querySelector(ctx.helper.companyFieldSelector()), "f");

    expect(document.activeElement).toBe(document.querySelector(".two-company-dropdown__query"));
  });

  function pressKeyOn(node, key) {
    node.dispatchEvent(new window.KeyboardEvent("keydown", { key: key, bubbles: true }));
  }
});
