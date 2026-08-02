/**
 * TWO-24867 (with TWO-25326). What happens when the billing country changes
 * mid-checkout — and what must NOT happen when WooCommerce merely says it did.
 *
 * Three distinct defects are pinned here, all of them "the country-sensitive
 * code and the country field disagree":
 *
 *   1. The handler fired on WooCommerce's own re-render `change` events, not
 *      only on a buyer's country change, and each one destroyed the captured
 *      company (observed live, TWO-25326).
 *   2. The company search took its country from a closure captured when the
 *      selectWoo widget was built, so a widget that outlived a country change
 *      searched the previous country's register.
 *   3. The registry address lookup had no supersession guard, so a response
 *      for a company picked under the OLD country wrote its address over the
 *      fields after the switch — and flagged it as registry data.
 *
 * The same three behaviours were fixed on the PrestaShop checkout first; this
 * is the WooCommerce equivalent, in this plugin's own delegated-handler and
 * selectWoo shape. See the ticket for the cross-platform parity notes.
 */

"use strict";

const harness = require("./wc-harness");

describe("billing country switch", () => {
  let ctx;
  let ajax;

  beforeEach(() => {
    // `supported_buyer_countries` is read by isCountrySupported(), which
    // toggleBusinessFields() calls — the first thing the country handler does.
    ctx = harness.loadTwoinc({ supported_buyer_countries: ["GB", "ES"] });
    harness.buildCheckoutForm({ country: "GB" });
    // The harness fixture carries a single country option, which is all the
    // search tests need. Switching country needs somewhere to switch TO.
    ctx.$("#billing_country").append('<option value="ES">Spain</option>');
    ajax = harness.stubAjax(ctx.$);
  });

  afterEach(() => {
    ajax.restore();
    harness.releaseWidgets(ctx.$);
    document.body.innerHTML = "";
  });

  /**
   * Put a captured company in every field that holds one, the way a pick from
   * the search results does.
   *
   * @param {string} name
   * @param {string} id
   * @returns {void}
   */
  function captureCompany(name, id) {
    ctx.$("#billing_company").val(name);
    ctx.$("#company_id").val(id);
    ctx.Twoinc.getInstance().customerCompany = {
      company_name: name,
      organization_number: id,
      country_prefix: "GB"
    };
  }

  /**
   * Fire the country handler the way the delegated binding in `initialize()`
   * does — `this` is the country field, which is what the handler reads.
   *
   * @returns {void}
   */
  function fireCountryChange() {
    ctx.Twoinc.prototype.onCountryInputChange.call(
      ctx.$("#billing_country")[0],
      ctx.$.Event("change")
    );
  }

  /** @returns {{name: string, id: string}} the currently captured company */
  function capturedCompany() {
    return {
      name: ctx.$("#billing_company").val(),
      id: ctx.$("#company_id").val()
    };
  }

  describe("a change event that is not a country change (TWO-25326)", () => {
    test("leaves the captured company alone", () => {
      ctx.helper.lastObservedCountry = "GB";
      captureCompany("Example Co", "123456789");

      // WooCommerce re-renders the billing fields on `updated_checkout` and
      // core's address-i18n.js re-triggers the country field at init; both
      // arrive here as a bare `change` with the value unchanged.
      fireCountryChange();

      expect(capturedCompany()).toEqual({ name: "Example Co", id: "123456789" });
    });

    test("does not invalidate an in-flight company search", () => {
      ctx.helper.lastObservedCountry = "GB";
      const seqBefore = ctx.helper.companySearchSeq;

      fireCountryChange();

      expect(ctx.helper.companySearchSeq).toBe(seqBefore);
    });

    test("still re-runs the field-visibility pass", () => {
      // The half of the handler that is NOT destructive stays unconditional.
      // These events are exactly the ones that just re-rendered the billing
      // fields underneath the plugin, so skipping the visibility pass along
      // with the clear would turn this guard into a field-visibility
      // regression. Simulated by knocking a field's state out and checking
      // the handler puts it back.
      ctx.helper.lastObservedCountry = "GB";
      // The field this configuration resolves to visible (the gateway is not
      // the selected payment method here, and company search is not enabled
      // for other methods, so the plain company field is the one shown).
      ctx.$("#billing_company_field").addClass("hidden");

      fireCountryChange();

      expect(ctx.$("#billing_company_field").hasClass("hidden")).toBe(false);
    });

    test("repeated re-renders stay inert, not just the first", () => {
      ctx.helper.lastObservedCountry = "GB";
      captureCompany("Example Co", "123456789");

      fireCountryChange();
      fireCountryChange();
      fireCountryChange();

      expect(capturedCompany()).toEqual({ name: "Example Co", id: "123456789" });
    });
  });

  describe("a real country change", () => {
    test("clears the captured company", () => {
      ctx.helper.lastObservedCountry = "GB";
      captureCompany("Example Co", "123456789");

      ctx.$("#billing_country").val("ES");
      fireCountryChange();

      expect(capturedCompany()).toEqual({ name: "", id: "" });
    });

    test("records the new country so the next re-render is inert again", () => {
      ctx.helper.lastObservedCountry = "GB";

      ctx.$("#billing_country").val("ES");
      fireCountryChange();
      captureCompany("Ejemplo SL", "B12345678");
      fireCountryChange();

      expect(capturedCompany()).toEqual({ name: "Ejemplo SL", id: "B12345678" });
    });

    test("leaves the new country on customerCompany, not the cleared {}", () => {
      // clearSelectedCompany() resets customerCompany wholesale and only
      // re-reads it from the DOM three seconds later, so an assignment made
      // BEFORE it is silently dropped — which left getApproval() and
      // getDueInDays() running with no country for that whole window.
      ctx.helper.lastObservedCountry = "GB";
      captureCompany("Example Co", "123456789");

      ctx.$("#billing_country").val("ES");
      fireCountryChange();

      expect(ctx.Twoinc.getInstance().customerCompany.country_prefix).toBe("ES");
    });

    test("invalidates an in-flight company search", () => {
      ctx.helper.lastObservedCountry = "GB";
      const seqBefore = ctx.helper.companySearchSeq;

      ctx.$("#billing_country").val("ES");
      fireCountryChange();

      expect(ctx.helper.companySearchSeq).toBeGreaterThan(seqBefore);
    });

    test("a search response for the previous country cannot repopulate the list", () => {
      ctx.helper.lastObservedCountry = "GB";
      const $select = harness.openCompanyWidget(ctx.$, ctx.helper);
      const transport = ctx.helper.genSelectWooParams().ajax.transport;
      const success = harness.successRecorder();
      transport({ term: "example", page: 0 }, success.fn);
      const inFlight = ajax.last();

      ctx.$("#billing_country").val("ES");
      fireCountryChange();
      inFlight.succeed({ items: [{ name: "Example Co", highlight: "Example Co" }] });

      expect(success.calls).toHaveLength(0);
      expect($select.length).toBe(1);
    });
  });

  describe("initialize() seeds the tracker (TWO-25326)", () => {
    beforeEach(() => {
      // initialize() installs a 3s setInterval and an 800ms setTimeout that
      // would outlive the test on real timers and run against a torn-down
      // DOM. Nothing here needs them to fire.
      jest.useFakeTimers();
      // The checkout-page gate initialize() returns on, and the gateway radio
      // the bootstrap looks for.
      ctx.$("form[name='checkout']").after('<div id="order_review"></div>');
      ctx
        .$("form[name='checkout']")
        .append(
          "<input type='radio' id='payment_method_woocommerce-gateway-tillit'" +
            " name='payment_method' value='woocommerce-gateway-tillit' />"
        );
    });

    afterEach(() => {
      jest.clearAllTimers();
      jest.useRealTimers();
    });

    test("records the country already in the form, so the first re-render is inert", () => {
      // Core's address-i18n.js triggers `country_to_state_changing` on
      // checkout init, which reaches this binding as a `change` carrying the
      // country the form ALREADY had. An unseeded tracker (null) treats that
      // as a change and clears a company restored from the saved address.
      ctx.Twoinc.getInstance().initialize(false);

      expect(ctx.helper.lastObservedCountry).toBe("GB");

      captureCompany("Example Co", "123456789");
      ctx.$("#billing_country").trigger("change");

      expect(capturedCompany()).toEqual({ name: "Example Co", id: "123456789" });
    });
  });

  describe("the search country is read live, not captured (TWO-24867)", () => {
    test("a widget built under GB searches ES after the field changes", () => {
      // The widget is deliberately NOT rebuilt between the two searches: it
      // survives a country change on every path that does not go through
      // clearSelectedCompany, which is where the captured-closure bug bit.
      const params = ctx.helper.genSelectWooParams();
      harness.openCompanyWidget(ctx.$, ctx.helper);

      const before = params.ajax.url({ term: "example", page: 0 });
      ctx.$("#billing_country").val("ES");
      const after = params.ajax.url({ term: "example", page: 0 });

      expect(before).toContain("country=GB");
      expect(after).toContain("country=ES");
    });
  });

  describe("registry address lookup supersession (TWO-24867)", () => {
    beforeEach(() => {
      // setAddress() writes the four core billing address inputs, which the
      // company-search fixture has no reason to carry.
      ctx
        .$("form[name='checkout']")
        .append(
          [
            "<input type='text' id='billing_address_1' name='billing_address_1' value='' />",
            "<input type='text' id='billing_address_2' name='billing_address_2' value='' />",
            "<input type='text' id='billing_city' name='billing_city' value='' />",
            "<input type='text' id='billing_postcode' name='billing_postcode' value='' />"
          ].join("\n")
        );
    });

    /**
     * @returns {Object} the stubbed request for the lookup just issued
     */
    function lookup(lookupId) {
      ctx.Twoinc.getInstance().addressLookup({ lookup_id: lookupId });
      return ajax.last();
    }

    const GB_ADDRESS = {
      addresses: [{ street_address: "1 Example Street", city: "London", postal_code: "EC1A 1BB" }]
    };

    test("a response that lands after a country change is discarded", () => {
      ctx.helper.lastObservedCountry = "GB";
      const inFlight = lookup("gb-lookup-id");

      ctx.$("#billing_country").val("ES");
      fireCountryChange();
      inFlight.succeed(GB_ADDRESS);

      expect(ctx.$("#billing_address_1").val()).toBe("");
      expect(ctx.Twoinc.getInstance().registryAddressApplied).toBe(false);
    });

    test("a response superseded by a newer lookup is discarded", () => {
      const first = lookup("first-lookup-id");
      const second = lookup("second-lookup-id");

      second.succeed({
        addresses: [{ street_address: "2 Second Street", city: "Leeds", postal_code: "LS1 1AA" }]
      });
      first.succeed(GB_ADDRESS);

      expect(ctx.$("#billing_address_1").val()).toBe("2 Second Street");
    });

    test("a response is discarded when the country moved on WITHOUT an event", () => {
      // Not the same case as the test above, and not covered by the sequence
      // number: nothing bumped it here. WooCommerce's own address-i18n.js and
      // several themes write #billing_country with `.val()`, which fires no
      // `change`, so the handler never runs and never invalidates anything.
      // The country snapshot taken at request time is the only guard that
      // stops the GB registry address landing on an ES checkout.
      const inFlight = lookup("gb-lookup-id");

      ctx.$("#billing_country").val("ES");
      inFlight.succeed(GB_ADDRESS);

      expect(ctx.$("#billing_address_1").val()).toBe("");
      expect(ctx.Twoinc.getInstance().registryAddressApplied).toBe(false);
    });

    test("the current lookup still writes the address", () => {
      // The guard must not be so tight that the happy path stops working.
      lookup("gb-lookup-id").succeed(GB_ADDRESS);

      expect(ctx.$("#billing_address_1").val()).toBe("1 Example Street");
      expect(ctx.Twoinc.getInstance().registryAddressApplied).toBe(true);
    });
  });
});
