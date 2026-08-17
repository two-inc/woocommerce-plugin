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
    // initialize() installs a 3s setInterval and an 800ms setTimeout that
    // would outlive the test on real timers and run against a torn-down DOM.
    // Nothing here needs either to fire.
    jest.useFakeTimers();
    // `supported_buyer_countries` is read by isCountrySupported(), which
    // toggleBusinessFields() calls — the first thing the country handler does.
    ctx = harness.loadTwoinc({ supported_buyer_countries: ["GB", "ES"] });
    harness.buildCheckoutForm({ country: "GB" });
    // The harness fixture carries a single country option, which is all the
    // search tests need. Switching country needs somewhere to switch TO.
    ctx.$("#billing_country").append('<option value="ES">Spain</option>');
    // The checkout-page gate initialize() returns on, and the gateway radio
    // the payment-method checks look for.
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
    harness.releaseWidgets(ctx.$);
    // Load-bearing, not tidying. `initialize()` binds its handlers DELEGATED
    // on document.body, and jsdom's document outlives the test — wiping
    // `innerHTML` removes the elements but not the bindings. Every test that
    // calls initializeCheckout() would otherwise leave a live handler closed
    // over its own evaluation of the source (the harness re-evaluates per
    // test, so each has its own `lastObservedCountry` and its own singleton),
    // and the next test's `change` event would run all of them against the
    // current DOM. That presents as an order-dependent flake — a company
    // cleared by a predecessor's zombie guard — rather than as the leak it is.
    ctx.$(document.body).off();
    document.body.innerHTML = "";
    // jsdom's sessionStorage outlives the test too, and one test seeds a
    // saved-input snapshot into it.
    window.sessionStorage.clear();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  /**
   * Run the real page wiring: the delegated `change` binding on
   * #billing_country, the `updated_checkout` binding, and the seed of the
   * country tracker.
   *
   * Every test that fires a country event goes through this rather than
   * calling the handler by hand. Calling it directly would leave the binding
   * itself untested, so unwiring it — or moving the seed to somewhere
   * initialize() does not reach — would keep the suite green.
   *
   * @returns {void}
   */
  function initializeCheckout() {
    ctx.Twoinc.getInstance().initialize(false);
  }

  /**
   * Put a captured company in every field that holds one, the way a pick from
   * the search results does.
   *
   * @param {string} name
   * @param {string} id
   * @returns {void}
   */
  function captureCompany(name, id, country) {
    // Through the ONE capture write path (TWO-40 §5), not by poking the two
    // inputs: that is what a real pick, a sole-trader adoption and a user-meta
    // restore all do, and it is what leaves the pairing tag and the provenance
    // marker behind. Written raw here, the pair would be indistinguishable
    // from a buyer's own typing — which is precisely the state the guard and
    // the country-change clear are supposed to treat differently.
    ctx.capture.write(name, id, { country: country || "GB" });
    // The country the company was captured UNDER, which is not necessarily the
    // one in the field by the time a test asserts (TWO-25333). Re-asserted for
    // the callers that capture with no id, where the write path has no capture
    // for a country to belong to.
    ctx.Twoinc.getInstance().customerCompany.country_prefix = country || "GB";
  }

  /**
   * The buyer typing a company into the plain fallback fields by hand, with no
   * plugin write behind it.
   *
   * Distinct from `captureCompany` since TWO-40 §5: the two differ by
   * PROVENANCE, and the country-change clear treats them differently on
   * purpose — it drops what the plugin wrote and keeps what the buyer typed.
   *
   * @param {string} name
   * @param {string} id
   * @param {string} [country]
   * @returns {void}
   */
  function typeCompanyByHand(name, id, country) {
    ctx.$("#billing_company").val(name);
    ctx.$("#company_id").val(id);
    ctx.Twoinc.getInstance().customerCompany = {
      company_name: name,
      organization_number: id,
      country_prefix: country || "GB"
    };
  }

  /**
   * Fire a real `change` on the country field, which reaches the plugin only
   * through the delegated binding `initialize()` installs on document.body.
   *
   * @returns {void}
   */
  function fireCountryChange() {
    ctx.$("#billing_country").trigger("change");
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
      initializeCheckout();
      captureCompany("Example Co", "123456789");

      // WooCommerce re-renders the billing fields on `updated_checkout` and
      // core's address-i18n.js re-triggers the country field at init; both
      // arrive here as a bare `change` with the value unchanged.
      fireCountryChange();

      expect(capturedCompany()).toEqual({ name: "Example Co", id: "123456789" });
    });

    test("does not invalidate an in-flight company search", () => {
      initializeCheckout();
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
      initializeCheckout();
      // The field this configuration resolves to visible (the gateway is not
      // the selected payment method here, and company search is not enabled
      // for other methods, so the plain company field is the one shown).
      ctx.$("#billing_company_field").addClass("hidden");

      fireCountryChange();

      expect(ctx.$("#billing_company_field").hasClass("hidden")).toBe(false);
    });

    test("repeated re-renders stay inert, not just the first", () => {
      initializeCheckout();
      captureCompany("Example Co", "123456789");

      fireCountryChange();
      fireCountryChange();
      fireCountryChange();

      expect(capturedCompany()).toEqual({ name: "Example Co", id: "123456789" });
    });
  });

  describe("a real country change", () => {
    test("clears the captured company", () => {
      initializeCheckout();
      captureCompany("Example Co", "123456789");

      ctx.$("#billing_country").val("ES");
      fireCountryChange();

      expect(capturedCompany()).toEqual({ name: "", id: "" });
    });

    test("records the new country so the next re-render is inert again", () => {
      initializeCheckout();

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
      initializeCheckout();
      captureCompany("Example Co", "123456789");

      ctx.$("#billing_country").val("ES");
      fireCountryChange();

      expect(ctx.Twoinc.getInstance().customerCompany.country_prefix).toBe("ES");
    });

    test("invalidates an in-flight company search", () => {
      initializeCheckout();
      const seqBefore = ctx.helper.companySearchSeq;

      ctx.$("#billing_country").val("ES");
      fireCountryChange();

      expect(ctx.helper.companySearchSeq).toBeGreaterThan(seqBefore);
    });

    test("a search response for the previous country cannot repopulate the list", () => {
      initializeCheckout();
      const $select = harness.openCompanyWidget(ctx.$, ctx.helper);
      const transport = ctx.helper.genSelectWooParams().ajax.transport;
      const success = harness.successRecorder();
      transport({ term: "example", page: 0 }, success.fn);
      const inFlight = ajax.last();

      ctx.$("#billing_country").val("ES");
      fireCountryChange();
      inFlight.succeed({ items: [{ name: "Example Co", highlight: "Example Co" }] });

      expect(success.calls).toHaveLength(0);
      expect(harness.resultsText(ctx.$)).not.toContain("Example Co");
      $select.select2("close");
    });
  });

  describe("the tracker cannot drift from the field", () => {
    test("the seed makes a FIRST event that IS a real change act", () => {
      // The mirror of the seeding test below, and the reason the seed is
      // load-bearing rather than an optimisation: with no seed the first
      // country the page ever sees is adopted rather than acted on, which is
      // right for WooCommerce's init re-render and wrong for a buyer who
      // changes country before any re-render has happened.
      initializeCheckout();
      captureCompany("Example Co", "123456789");

      ctx.$("#billing_country").val("ES");
      fireCountryChange();

      expect(capturedCompany()).toEqual({ name: "", id: "" });
    });

    test("initialize() records the country already in the form", () => {
      // Core's address-i18n.js triggers `country_to_state_changing` on
      // checkout init, which reaches this binding as a `change` carrying the
      // country the form ALREADY had.
      initializeCheckout();

      expect(ctx.helper.lastObservedCountry).toBe("GB");

      captureCompany("Example Co", "123456789");
      fireCountryChange();

      expect(capturedCompany()).toEqual({ name: "Example Co", id: "123456789" });
    });

    test("updated_checkout RECORDS a country that moved with no change event", () => {
      // WooCommerce can replace the billing fields with a server-rendered
      // country and fire no `change`: a checkout_error re-render, a
      // multi-step theme, a session address restored server-side. Left
      // unrecorded the tracker keeps the pre-re-render country for the rest
      // of the page, and a later genuine switch BACK to it reads as no
      // change and is swallowed.
      initializeCheckout();

      ctx.$("#billing_country").val("ES");
      ctx.$(document.body).trigger("updated_checkout");

      expect(ctx.helper.lastObservedCountry).toBe("ES");

      // And the tracker is genuinely usable afterwards: a switch back to GB
      // is a real change and is acted on.
      captureCompany("Ejemplo SL", "B12345678");
      ctx.$("#billing_country").val("GB");
      fireCountryChange();

      expect(capturedCompany()).toEqual({ name: "", id: "" });
    });

    test("updated_checkout records WITHOUT clearing the captured company", () => {
      // The other half, and the reason this entry point records rather than
      // running the whole handler. Those re-renders restore the country and
      // the company TOGETHER, so clearing here destroys what the same
      // re-render just put back — TWO-25326 again on a new trigger. Nothing
      // is thrown away without the buyer's gesture, and a `change` event is
      // the only signal of one this checkout has.
      //
      // The company is captured under ES, the country the re-render moves the
      // field to, because "together" is the whole point: this fixture used to
      // pair a GB company with a move to ES, which is not the restore case at
      // all but the stale-pairing case TWO-25333 now clears. The assertion the
      // test was written to make — a record-only path throws nothing away —
      // needs a pair the re-render could actually have supplied.
      initializeCheckout();
      ctx.$("#billing_country").val("ES");
      captureCompany("Ejemplo SL", "B12345678", "ES");

      ctx.$(document.body).trigger("updated_checkout");

      expect(capturedCompany()).toEqual({ name: "Ejemplo SL", id: "B12345678" });
    });

    test("the seed is taken AFTER the saved-input restore, not before", () => {
      // `loadStorageInputs()` writes #billing_country with `selectElem.value`
      // and fires no `change`. Seeded before it ran, the tracker held the
      // country the page was RENDERED with while the field held the RESTORED
      // one, and the first re-render afterwards read the difference as a real
      // country change — destroying the company and address that same restore
      // had just put back. `initialize(true)` is the bootstrap's own call, so
      // this is the production path.
      // The shape saveCheckoutInputs() actually writes.
      window.sessionStorage.setItem(
        "checkoutInputs",
        JSON.stringify([
          {
            htmlTag: "SELECT",
            id: "billing_country",
            name: "billing_country",
            val: "ES",
            optionHtml: '<option value="ES">Spain</option>'
          },
          {
            htmlTag: "INPUT",
            id: "billing_company",
            name: "billing_company",
            type: "text",
            val: "Ejemplo SL"
          },
          {
            htmlTag: "INPUT",
            id: "company_id",
            name: "company_id",
            type: "text",
            val: "B12345678"
          }
        ])
      );

      ctx.Twoinc.getInstance().initialize(true);

      expect(ctx.$("#billing_country").val()).toBe("ES");
      expect(ctx.helper.lastObservedCountry).toBe("ES");

      // The re-render that follows the restore must not read it as a change.
      ctx.$(document.body).trigger("updated_checkout");
      fireCountryChange();

      expect(capturedCompany()).toEqual({ name: "Ejemplo SL", id: "B12345678" });
    });

    test("the FIRST country ever seen is adopted, not acted on", () => {
      // The billing fields can render after initialize() does: the gate it
      // returns on is #order_review, and a multi-step or late-rendering theme
      // puts the address block in afterwards. The seed then reads nothing, so
      // the first country the page ever sees arrives on the re-render event —
      // together with the company restored from the saved address, not
      // instead of it. There is no previous country to have moved away from,
      // so there is nothing to invalidate.
      const $country = ctx.$("#billing_country");
      const markup = $country.prop("outerHTML");
      $country.remove();

      initializeCheckout();
      expect(ctx.helper.lastObservedCountry).toBe(null);

      ctx.$("#billing_country_field").append(markup);
      captureCompany("Example Co", "123456789");
      fireCountryChange();

      expect(capturedCompany()).toEqual({ name: "Example Co", id: "123456789" });
      expect(ctx.helper.lastObservedCountry).toBe("GB");
    });

    test("updated_checkout invalidates in-flight work for the outgoing country", () => {
      // Record-only would otherwise leave a hole: nothing on this path bumps
      // either counter, so a registry address for the country just left could
      // still land. The lookup's own country comparison does not cover it —
      // an empty reading on either side waves the response through by design,
      // and the field being mid-replacement is exactly what this path is
      // about. Invalidating pending answers is safe in a way clearing the
      // capture is not: it discards replies to questions asked under a
      // country that is no longer selected, which the buyer cannot lose.
      ctx
        .$("form[name='checkout']")
        .append(
          "<input type='text' id='billing_address_1' value='' />" +
            "<input type='text' id='billing_city' value='' />" +
            "<input type='text' id='billing_postcode' value='' />" +
            "<input type='text' id='billing_address_2' value='' />"
        );
      initializeCheckout();
      const searchSeqBefore = ctx.helper.companySearchSeq;
      ctx.Twoinc.getInstance().addressLookup({ lookup_id: "gb-lookup-id" });
      const inFlight = ajax.last();

      // No `change` event — the whole point of this path.
      ctx.$("#billing_country").val("ES");
      ctx.$(document.body).trigger("updated_checkout");
      inFlight.succeed({
        addresses: [{ street_address: "1 Example Street", city: "London", postal_code: "EC1A 1BB" }]
      });

      expect(ctx.helper.companySearchSeq).toBeGreaterThan(searchSeqBefore);
      expect(ctx.$("#billing_address_1").val()).toBe("");
      expect(ctx.Twoinc.getInstance().registryAddressApplied).toBe(false);
    });

    test("updated_checkout does NOT invalidate when the country is unchanged", () => {
      // The counter bump is behind the same change test as the recording, so
      // the constant stream of `updated_checkout` events on an ordinary
      // checkout does not cancel the buyer's own in-flight search.
      initializeCheckout();
      const searchSeqBefore = ctx.helper.companySearchSeq;

      ctx.$(document.body).trigger("updated_checkout");

      expect(ctx.helper.companySearchSeq).toBe(searchSeqBefore);
    });

    test("the updated_checkout re-sync terminates instead of looping", () => {
      // The loop this must not become: `updated_checkout` -> a country change
      // -> clearSelectedCompany() -> setAddress() -> `update_checkout` ->
      // WooCommerce refreshes -> `updated_checkout` again. Two things stop it
      // — this entry point only RECORDS, so it never reaches
      // clearSelectedCompany at all; and even if it did, the country was
      // recorded on the way through, so the second pass sees no change.
      // Pinned rather than reasoned about because both guards live in
      // different functions from the recursion, and the setAddress leg is
      // behind `enable_address_lookup`, so a regression here would only
      // appear on shops that turn address lookup on.
      ctx.twoinc.enable_address_lookup = "yes";
      ctx
        .$("form[name='checkout']")
        .append(
          [
            "<input type='text' id='billing_address_1' value='' />",
            "<input type='text' id='billing_address_2' value='' />",
            "<input type='text' id='billing_city' value='' />",
            "<input type='text' id='billing_postcode' value='' />"
          ].join("\n")
        );
      initializeCheckout();
      // Stand in for WooCommerce core's checkout.js, which is what turns a
      // requested `update_checkout` into a completed `updated_checkout`.
      let passes = 0;
      ctx.$(document.body).on("update_checkout", function () {
        passes += 1;
        if (passes > 20) throw new Error("update_checkout did not settle");
        ctx.$(document.body).trigger("updated_checkout");
      });

      ctx.$("#billing_country").val("ES");
      ctx.$(document.body).trigger("updated_checkout");

      expect(passes).toBeLessThan(5);
      expect(ctx.helper.lastObservedCountry).toBe("ES");
    });

    test("an empty reading is neither acted on nor recorded", () => {
      // WooCommerce replaces #billing_country wholesale on some re-renders,
      // so an event landing mid-replacement reads "". Clearing on that would
      // destroy a captured company for nothing; RECORDING it would be worse —
      // the genuine switch that completes afterwards would then be compared
      // against "" and swallowed.
      initializeCheckout();
      captureCompany("Example Co", "123456789");
      const $country = ctx.$("#billing_country");
      const restore = $country.html();

      $country.empty();
      fireCountryChange();
      expect(capturedCompany()).toEqual({ name: "Example Co", id: "123456789" });
      expect(ctx.helper.lastObservedCountry).toBe("GB");

      $country.html(restore).val("ES");
      fireCountryChange();
      expect(capturedCompany()).toEqual({ name: "", id: "" });
    });
  });

  describe("a capture stranded in the wrong country (TWO-25333)", () => {
    /**
     * The four core billing address inputs `setAddress` writes. Needed by any
     * test that lets the clear run with `enable_address_lookup` on, since
     * `clearSelectedCompany` blanks them on that setting.
     *
     * @returns {void}
     */
    function addAddressFields() {
      ctx
        .$("form[name='checkout']")
        .append(
          [
            "<input type='text' id='billing_address_1' value='' />",
            "<input type='text' id='billing_address_2' value='' />",
            "<input type='text' id='billing_city' value='' />",
            "<input type='text' id='billing_postcode' value='' />"
          ].join("\n")
        );
    }

    /**
     * Move the country with NO `change` event and let the re-render land —
     * the path this whole block is about. WooCommerce writes
     * #billing_country with `.val()` / `selectElem.value =` on a
     * checkout_error re-render, a multi-step theme and a server-side session
     * restore, and fires `updated_checkout` rather than `change`.
     *
     * @param {string} country
     * @returns {void}
     */
    function moveCountrySilently(country) {
      ctx.$("#billing_country").val(country);
      ctx.$(document.body).trigger("updated_checkout");
    }

    test("clears a company captured under the country just left", () => {
      // The defect. Nothing downstream catches this pair: getApproval() posts
      // customerCompany carrying the OLD country_prefix next to the OLD
      // organisation number, so the intent check sees a self-consistent pair
      // and approves it, and the order payload pairs that company_id with the
      // order's billing country with no check between the two. The buyer got a
      // green payment method and an opaque order-creation failure.
      addAddressFields();
      initializeCheckout();
      captureCompany("Example Co", "123456789", "GB");

      moveCountrySilently("ES");

      expect(capturedCompany()).toEqual({ name: "", id: "" });
      expect(ctx.Twoinc.getInstance().customerCompany.organization_number).toBeFalsy();
    });

    test("the cleared capture takes the approval gate back down", () => {
      // Named for what it proves, which is narrower than "the payment method
      // becomes unusable". `isReadyApprovalCheck` is the gate deciding whether
      // an intent is asked for at all, so it coming back down is what stops a
      // fresh approval being sought for the dropped pair — and it is a real
      // assertion the emptied fields would not give us.
      //
      // What it does NOT prove: the gateway radio stays `checked` and
      // `isTwoincApproved` stays true after this, because nothing in the file
      // deselects the method and `isTwoincApproved` is written but never read.
      // So a buyer who had already been approved keeps a selected Two method
      // over an emptied company until the next intent pass. Enforcing §6 by
      // deselecting is the DEFERRED half of that design and belongs to its own
      // ticket, not to this one — recorded here so the gap is not mistaken for
      // something this test covers.
      ctx.twoinc.enable_order_intent = "yes";
      addAddressFields();
      initializeCheckout();
      captureCompany("Example Co", "123456789", "GB");
      // Everything else the gate needs, so that it is genuinely true BEFORE
      // and the assertion after it is not passing for an unrelated reason.
      ctx.Twoinc.getInstance().customerRepresentative = {
        email: "buyer@example.test",
        first_name: "Ex",
        last_name: "Ample",
        phone_number: "+441234567890"
      };
      expect(ctx.Twoinc.getInstance().isReadyApprovalCheck()).toBe(true);

      moveCountrySilently("ES");

      expect(ctx.Twoinc.getInstance().isReadyApprovalCheck()).toBe(false);
    });

    test("leaves the new country on customerCompany, not the cleared {}", () => {
      // Same trap as on the `change` path: clearSelectedCompany() resets
      // customerCompany wholesale and only re-reads it from the DOM three
      // seconds later, so an assignment made before it is silently dropped and
      // getDueInDays() — which early-returns without a country — is dead for
      // that whole window.
      addAddressFields();
      initializeCheckout();
      captureCompany("Example Co", "123456789", "GB");

      moveCountrySilently("ES");

      expect(ctx.Twoinc.getInstance().customerCompany.country_prefix).toBe("ES");
    });

    // No test here for the supersession counters being bumped. They are bumped
    // by the caller, unconditionally on the country having moved, which is
    // pre-existing TWO-24867 behaviour already pinned by "updated_checkout
    // invalidates in-flight work for the outgoing country" above. A copy inside
    // this block passed with this whole feature reverted, so it asserted
    // nothing about it.

    test("does NOT clear when the restore supplies country and company together", () => {
      // The regression guard, and the reason this is a discriminator rather
      // than a return to clearing on every country movement. This is the
      // TWO-24867 / TWO-25326 case: the same re-render that moved the country
      // also supplied the company, so the two agree and there is nothing
      // stale. Reverting the discriminator to "always clear" fails here.
      addAddressFields();
      initializeCheckout();
      ctx.$("#billing_country").val("ES");
      captureCompany("Ejemplo SL", "B12345678", "ES");

      ctx.$(document.body).trigger("updated_checkout");

      expect(capturedCompany()).toEqual({ name: "Ejemplo SL", id: "B12345678" });
      expect(ctx.Twoinc.getInstance().customerCompany.organization_number).toBe("B12345678");
    });

    test("does NOT clear when the re-render restored a DIFFERENT company too", () => {
      // The second shape of "supplied together", and the one a naive
      // discriminator gets wrong. `customerCompany` is refreshed from the DOM
      // on a timer, so a re-render that swapped in another saved address —
      // country AND company together, a different pair but a self-consistent
      // one — arrives here with the PREVIOUS capture still in JS state. The
      // record is what is stale, not the fields, and clearing would destroy
      // the company the re-render had just restored.
      addAddressFields();
      initializeCheckout();
      captureCompany("Example Co", "123456789", "GB");

      // The re-render's own doing: new country, new company, BOTH mirrors in
      // the DOM. Both halves matter — see the two tests below, where only one
      // of them moved.
      ctx.$("#billing_company").val("Ejemplo SL");
      ctx.$("#company_id").val("B12345678");
      moveCountrySilently("ES");

      expect(capturedCompany()).toEqual({ name: "Ejemplo SL", id: "B12345678" });
      // And the stale record is re-synced to the pair the DOM actually holds,
      // rather than left describing a company that is no longer in the form.
      expect(ctx.Twoinc.getInstance().customerCompany.organization_number).toBe("B12345678");
      expect(ctx.Twoinc.getInstance().customerCompany.country_prefix).toBe("ES");
      expect(ctx.Twoinc.getInstance().customerCompany.company_name).toBe("Ejemplo SL");
    });

    test("the re-synced record holds trimmed values, which are what get posted", () => {
      // Not the same assertion as "padding is not read as divergence" above.
      // Once the branch HAS decided the DOM holds a different company, what it
      // stores is what `getApproval()` posts inside `buyer.company` — so a
      // padded field value would reach the order intent verbatim. The opposite
      // direction from the blur handler's deliberate raw store, and unlike that
      // one this is observable and therefore pinned.
      addAddressFields();
      initializeCheckout();
      captureCompany("Example Co", "123456789", "GB");

      ctx.$("#billing_company").val("  Ejemplo SL  ");
      ctx.$("#company_id").val("  B12345678  ");
      moveCountrySilently("ES");

      expect(ctx.Twoinc.getInstance().customerCompany.organization_number).toBe("B12345678");
      expect(ctx.Twoinc.getInstance().customerCompany.company_name).toBe("Ejemplo SL");
    });

    test("clears when only the NUMBER diverged — a keystroke, not a restore", () => {
      // Fail-closed, and the reason the discriminator needs both halves. A
      // buyer typing into #company_id without blurring diverges the number
      // exactly as a restore does; trusting that pinned the new country onto a
      // number no capture path had witnessed, next to the PREVIOUS company's
      // name — a two-moment pair made to look self-consistent, which is the
      // defect this whole function exists to catch. A restore writes both
      // mirrors; a keystroke writes one.
      addAddressFields();
      initializeCheckout();
      captureCompany("Example Co", "123456789", "GB");

      ctx.$("#company_id").val("999999999");
      moveCountrySilently("ES");

      expect(capturedCompany()).toEqual({ name: "", id: "" });
      expect(ctx.Twoinc.getInstance().customerCompany.organization_number).toBeFalsy();
    });

    test("clears when only the NAME diverged — the mirror of the case above", () => {
      // The other half of "both mirrors must have moved". A name that changed
      // under an unchanged number is not a restored company either; treating it
      // as one would pin the new country onto the number still sitting there
      // from the previous country's capture.
      addAddressFields();
      initializeCheckout();
      captureCompany("Example Co", "123456789", "GB");

      ctx.$("#billing_company").val("Ejemplo SL");
      moveCountrySilently("ES");

      expect(capturedCompany()).toEqual({ name: "", id: "" });
    });

    test("clears when the number diverged but #billing_company reads empty", () => {
      // The other fail-closed leg, and the one with the worst alternative. Both
      // ways of trusting a nameless DOM pair are traps: taking the name from
      // the record pairs company A's name with company B's number, and writing
      // the empty name through leaves isReadyApprovalCheck() refusing forever —
      // this branch arms no deferred re-read, so the next re-render would see a
      // self-consistent pair, never fire again, and the payment method would be
      // stuck unusable with no way back. Clearing is recoverable; that is not.
      addAddressFields();
      initializeCheckout();
      captureCompany("Example Co", "123456789", "GB");

      ctx.$("#billing_company").val("");
      ctx.$("#company_id").val("B12345678");
      moveCountrySilently("ES");

      expect(ctx.$("#company_id").val()).toBe("");
      expect(ctx.Twoinc.getInstance().customerCompany.organization_number).toBeFalsy();
      // And the approval gate is down rather than stuck refusing on an empty
      // name it can never be rid of.
      expect(ctx.Twoinc.getInstance().isReadyApprovalCheck()).toBe(false);
    });

    test("a sole-trader numeric number survives a re-render of the NAME alone", () => {
      // The reachable chain the recorded-number normalisation actually guards,
      // driven through the real setter rather than by poking the record.
      // `setCompany` writes the organisation number straight out of parsed
      // JSON, so the record holds a NUMBER while `#company_id` holds a string.
      // Then a re-render rewrites WooCommerce's own `#billing_company` and
      // leaves the plugin's `#company_id` untouched — the mirror asymmetry this
      // whole ticket is about. Un-normalised, the number reads as diverged, the
      // name genuinely has diverged, and the re-sync branch launders a
      // GB-captured number into a self-consistent ES pair with nothing left
      // downstream to catch it.
      addAddressFields();
      initializeCheckout();
      ctx.soleTrader.setCompany(123456789, "Sole Trader Co");
      expect(ctx.Twoinc.getInstance().customerCompany.organization_number).toBe(123456789);

      ctx.$("#billing_company").val("Other Saved Ltd");
      moveCountrySilently("ES");

      expect(ctx.$("#company_id").val()).toBe("");
      expect(ctx.Twoinc.getInstance().customerCompany.organization_number).toBeFalsy();
    });

    test("a whitespace-padded recorded number is not read as diverged", () => {
      // The other representation-only divergence, and one this file produces
      // itself. Same shape as the test above: the name has genuinely moved, so
      // only the number comparison stands between a correct clear and a
      // laundered re-sync.
      addAddressFields();
      initializeCheckout();
      captureCompany("Example Co", "123456789", "GB");
      ctx.Twoinc.getInstance().customerCompany.organization_number = "  123456789  ";

      ctx.$("#billing_company").val("Other Saved Ltd");
      moveCountrySilently("ES");

      expect(capturedCompany()).toEqual({ name: "", id: "" });
    });

    test("a whitespace-padded recorded NAME is not read as diverged either", () => {
      // The recorded name goes through the same normaliser, for the same
      // reason and with the same consequence if it does not.
      addAddressFields();
      initializeCheckout();
      captureCompany("Example Co", "123456789", "GB");
      ctx.Twoinc.getInstance().customerCompany.company_name = "  Example Co  ";

      ctx.$("#company_id").val("B12345678");
      moveCountrySilently("ES");

      expect(capturedCompany()).toEqual({ name: "", id: "" });
    });

    test("a whitespace-padded DOM number is not read as diverged", () => {
      // The DOM side of the same normalisation, and it needed its own test for
      // the same reason the record side did: the reasoning applies identically
      // to both, so testing only one left half the guard resting on an
      // assumption. A buyer pasting a padded number into #company_id without
      // blurring leaves the record holding the picker's clean value, so an
      // un-normalised compare reads it as a different company — and with the
      // name moved by a re-render, launders the GB capture into an ES pair.
      addAddressFields();
      initializeCheckout();
      captureCompany("Example Co", "123456789", "GB");

      ctx.$("#company_id").val("  123456789  ");
      ctx.$("#billing_company").val("Other Saved Ltd");
      moveCountrySilently("ES");

      expect(capturedCompany()).toEqual({ name: "", id: "" });
    });

    test("a whitespace-padded DOM name is not read as diverged", () => {
      // The mirror of the above, on the name half.
      addAddressFields();
      initializeCheckout();
      captureCompany("Example Co", "123456789", "GB");

      ctx.$("#billing_company").val("  Example Co  ");
      ctx.$("#company_id").val("B12345678");
      moveCountrySilently("ES");

      expect(capturedCompany()).toEqual({ name: "", id: "" });
    });

    test("a numeric organisation number is not read as a different company", () => {
      // `organization_number` is seeded null and written from parsed JSON by
      // the sole-trader prefill, so it is not guaranteed to be a string while
      // `.val()` always is. Un-normalised, `123456789 !== "123456789"` is true
      // and the DOM-differs branch would fire on a capture that had not moved
      // at all — trusting the fields and pinning the NEW country onto the same
      // old company, which is a laundered stale pair rather than a clear.
      addAddressFields();
      initializeCheckout();
      captureCompany("Example Co", "123456789", "GB");
      ctx.Twoinc.getInstance().customerCompany.organization_number = 123456789;

      moveCountrySilently("ES");

      expect(capturedCompany()).toEqual({ name: "", id: "" });
    });

    test("does NOT clear a company name with no organisation number", () => {
      // Not a capture (TWO-25326 §6), and nothing about a bare name is
      // invalidated by a country change — the buyer typed it, and manual entry
      // deliberately keeps it. Clearing here would delete their own input on a
      // re-render they never asked for.
      addAddressFields();
      initializeCheckout();
      ctx.$("#billing_company").val("Some Buyer Ltd");
      ctx.Twoinc.getInstance().customerCompany = {
        company_name: "Some Buyer Ltd",
        organization_number: "",
        country_prefix: "GB"
      };

      moveCountrySilently("ES");

      expect(ctx.$("#billing_company").val()).toBe("Some Buyer Ltd");
    });

    test("does NOT clear when the captured country is unknown", () => {
      // `country_prefix` is null until the first capture or DOM re-read. An
      // unknown witness is not evidence of a mismatch, and treating it as one
      // would clear on the first re-render of any checkout whose company came
      // from somewhere that had not pinned a country yet.
      addAddressFields();
      initializeCheckout();
      ctx.$("#billing_company").val("Example Co");
      ctx.$("#company_id").val("123456789");
      ctx.Twoinc.getInstance().customerCompany = {
        company_name: "Example Co",
        organization_number: "123456789",
        country_prefix: null
      };

      moveCountrySilently("ES");

      expect(capturedCompany()).toEqual({ name: "Example Co", id: "123456789" });
    });

    test("compares the two countries case-insensitively", () => {
      // The two sides are written by different readers: currentCountry()
      // upper-cases, getCompanyData() reads #billing_country raw. A
      // case-sensitive comparison would read `es` vs `ES` as a mismatch and
      // clear a perfectly good capture — a false positive here is destructive,
      // which is why the normalisation is pinned rather than left to the
      // observation that WooCommerce's values happen to be upper-case.
      addAddressFields();
      initializeCheckout();
      ctx.$("#billing_country").val("ES");
      captureCompany("Ejemplo SL", "B12345678", "es");

      ctx.$(document.body).trigger("updated_checkout");

      expect(capturedCompany()).toEqual({ name: "Ejemplo SL", id: "B12345678" });
    });

    test("clears with address lookup OFF as well as on", () => {
      // Neither behaviour may depend on `enable_address_lookup`: it decides
      // whether clearSelectedCompany also blanks the address fields, and the
      // recursion the clear can start (setAddress -> update_checkout) only
      // exists on the `yes` leg — so a fix that worked on one setting and not
      // the other would be invisible on half the shops.
      ctx.twoinc.enable_address_lookup = "no";
      initializeCheckout();
      captureCompany("Example Co", "123456789", "GB");

      moveCountrySilently("ES");

      expect(capturedCompany()).toEqual({ name: "", id: "" });
    });

    test("does NOT clear the matching pair with address lookup OFF either", () => {
      ctx.twoinc.enable_address_lookup = "no";
      initializeCheckout();
      ctx.$("#billing_country").val("ES");
      captureCompany("Ejemplo SL", "B12345678", "ES");

      ctx.$(document.body).trigger("updated_checkout");

      expect(capturedCompany()).toEqual({ name: "Ejemplo SL", id: "B12345678" });
    });

    test("the clear terminates instead of looping", () => {
      // The loop the record-only design used to be immune to by construction,
      // and is not any more: this path now CAN reach clearSelectedCompany, so
      // `updated_checkout` -> clear -> setAddress -> `update_checkout` ->
      // WooCommerce refreshes -> `updated_checkout` is live again. What stops
      // it is that the country was recorded on the way through and the capture
      // is gone by the second pass, so neither the change test nor the
      // mismatch test is true a second time. Behind `enable_address_lookup`,
      // so a regression would only show on shops that turn it on.
      ctx.twoinc.enable_address_lookup = "yes";
      addAddressFields();
      initializeCheckout();
      captureCompany("Example Co", "123456789", "GB");
      // Stand in for WooCommerce core's checkout.js, which is what turns a
      // requested `update_checkout` into a completed `updated_checkout`.
      let passes = 0;
      ctx.$(document.body).on("update_checkout", function () {
        passes += 1;
        if (passes > 20) throw new Error("update_checkout did not settle");
        ctx.$(document.body).trigger("updated_checkout");
      });

      moveCountrySilently("ES");

      expect(passes).toBeLessThan(5);
      expect(capturedCompany()).toEqual({ name: "", id: "" });
    });

    test("a clear does not condemn what is captured after it", () => {
      addAddressFields();
      initializeCheckout();
      captureCompany("Example Co", "123456789", "GB");

      moveCountrySilently("ES");
      // Asserted mid-test on purpose. Without this the test passes with the
      // whole feature reverted: `captureCompany` overwrites `customerCompany`
      // wholesale, so with nothing cleared the only state it could witness is
      // `lastObservedCountry`, which is already ES either way.
      expect(capturedCompany()).toEqual({ name: "", id: "" });

      // A fresh capture under the country now selected must survive the next
      // re-render — the clear must not leave the tracker or the witness in a
      // state that condemns everything captured afterwards.
      captureCompany("Ejemplo SL", "B12345678", "ES");
      ctx.$(document.body).trigger("updated_checkout");

      expect(capturedCompany()).toEqual({ name: "Ejemplo SL", id: "B12345678" });
    });

    test("clears with company search OFF (manual entry) as well as on", () => {
      // The manual-entry leg behaves differently inside
      // `clearSelectedCompany`: it deliberately KEEPS the buyer's typed
      // `#billing_company` (it is their own input, not a picked company) while
      // still blanking `#company_id`. So the assertion is not the same one the
      // search-mode tests make, and running only those left this leg unproven.
      //
      // Typed by hand rather than captured (TWO-40 §5): what decides this leg
      // is PROVENANCE — did the plugin write this name — not the capture mode
      // the flag names. `enable_company_search === "no"` was a proxy for that
      // question, and a sole-trader name is plugin-written while reaching here
      // with the flag reading "no", so the proxy kept a name whose number had
      // already gone.
      ctx.twoinc.enable_company_search = "no";
      addAddressFields();
      initializeCheckout();
      typeCompanyByHand("Example Co", "123456789", "GB");

      moveCountrySilently("ES");

      expect(ctx.$("#company_id").val()).toBe("");
      expect(ctx.$("#billing_company").val()).toBe("Example Co");
      expect(ctx.Twoinc.getInstance().customerCompany.organization_number).toBeFalsy();

      // CHARACTERISATION, not endorsement. `clearSelectedCompany` re-attaches
      // selectWoo to #billing_company_display unconditionally, so a clear in
      // manual-entry mode resurrects the picker the buyer had dismissed even
      // with company search off. That is PRE-EXISTING — the `change` path has
      // called this on every real country change in manual entry since long
      // before this ticket — and fixing it means changing a shared destructive
      // function's behaviour on that path too, which is exactly the kind of
      // stacking TWO-25333 was split out of TWO-24867 to avoid. Pinned here so
      // the behaviour is recorded and a later fix has something to flip, not
      // because it is right.
      expect(ctx.$("#billing_company_display").data("select2")).toBeTruthy();
    });

    test("does NOT clear the matching pair with company search OFF either", () => {
      ctx.twoinc.enable_company_search = "no";
      addAddressFields();
      initializeCheckout();
      ctx.$("#billing_country").val("ES");
      captureCompany("Ejemplo SL", "B12345678", "ES");

      ctx.$(document.body).trigger("updated_checkout");

      expect(capturedCompany()).toEqual({ name: "Ejemplo SL", id: "B12345678" });
    });
  });

  describe("the capture country is pinned when the company is captured (TWO-25333)", () => {
    // Without this the pair is assembled from two different moments: the
    // organisation number is written at capture, while `country_prefix` was
    // last written by whichever DOM re-read ran most recently. A country that
    // moved with no `change` event BEFORE the capture therefore left the old
    // country next to a company from the new one — which getApproval() posts
    // as a self-consistent pair, and which the discriminator above would read
    // as a mismatch and clear, destroying a capture that was never stale.

    test("the picker's select handler pins the country it picked under", () => {
      initializeCheckout();
      // A silent country move that the record-only path has not seen yet, so
      // customerCompany.country_prefix still holds the country before it.
      ctx.Twoinc.getInstance().customerCompany.country_prefix = "GB";
      ctx.$("#billing_country").val("ES");

      ctx.$("#billing_company_display").trigger({
        type: "select2:select",
        params: { data: { id: "Ejemplo SL", company_id: "B12345678" } }
      });

      expect(ctx.Twoinc.getInstance().customerCompany.country_prefix).toBe("ES");
    });

    test("a manually typed organisation number pins the country too", () => {
      initializeCheckout();
      ctx.Twoinc.getInstance().customerCompany.country_prefix = "GB";
      ctx.$("#billing_country").val("ES");

      ctx.$("#company_id").val("B12345678").trigger("blur");

      expect(ctx.Twoinc.getInstance().customerCompany.organization_number).toBe("B12345678");
      expect(ctx.Twoinc.getInstance().customerCompany.country_prefix).toBe("ES");
    });

    test("tabbing THROUGH an untouched number does not launder a stale pair", () => {
      // This handler is bound to `blur`, not `change`, so it also fires when
      // focus merely passes through the field. Re-pinning there would rewrite
      // the witness to the country the form has since moved to while the number
      // is still the previous country's company — a stale pair made to look
      // consistent, which `clearCompanyIfCountryStale` could then never fire on.
      initializeCheckout();
      captureCompany("Example Co", "123456789", "GB");
      // A silent country move the record-only path has not seen yet.
      ctx.$("#billing_country").val("ES");

      ctx.$("#company_id").trigger("blur");

      expect(ctx.Twoinc.getInstance().customerCompany.country_prefix).toBe("GB");

      // Positive control, in the same fixture. Without it this test also passes
      // when the whole `company_id` blur branch is dead, so it could not tell
      // "the guard works" from "the handler never ran".
      ctx.$("#company_id").val("B12345678").trigger("blur");
      expect(ctx.Twoinc.getInstance().customerCompany.country_prefix).toBe("ES");
    });

    test("a numeric recorded number does not read as movement on blur", () => {
      // Same normalisation hazard as in the discriminator, at the other end: an
      // `organization_number` that arrived as a number (the sole-trader prefill
      // writes parsed JSON) compared raw against `.val()`'s string counts as
      // movement, and re-pins the country on a blur that changed nothing.
      initializeCheckout();
      captureCompany("Example Co", "123456789", "GB");
      ctx.Twoinc.getInstance().customerCompany.organization_number = 123456789;
      ctx.$("#billing_country").val("ES");

      ctx.$("#company_id").trigger("blur");

      expect(ctx.Twoinc.getInstance().customerCompany.country_prefix).toBe("GB");
    });

    test("EMPTYING a populated number pins nothing", () => {
      // The only case the emptiness half of the guard is reachable in:
      // `numberMoved` alone already excludes a blur that changed nothing, so
      // this is what distinguishes "pin when a number was entered" from "pin
      // whenever the field moved". Clearing the number is not a capture, so it
      // must not leave a witness behind claiming one was made under ES.
      initializeCheckout();
      captureCompany("Example Co", "123456789", "GB");
      ctx.$("#billing_country").val("ES");

      ctx.$("#company_id").val("").trigger("blur");

      expect(ctx.Twoinc.getInstance().customerCompany.country_prefix).toBe("GB");
    });

    test("re-blurring the same number with stray whitespace is not movement", () => {
      // `.val()` hands back exactly what is in the field, so a pasted value can
      // differ from the recorded one by padding alone. Compared untrimmed that
      // counts as movement and re-pins the country on a number that did not
      // change — the laundering path again, through whitespace this time.
      initializeCheckout();
      captureCompany("Example Co", "123456789", "GB");
      ctx.$("#billing_country").val("ES");

      ctx.$("#company_id").val("  123456789  ").trigger("blur");

      expect(ctx.Twoinc.getInstance().customerCompany.country_prefix).toBe("GB");
    });

    test("a blur on an empty untouched field pins nothing (conjunction)", () => {
      // "" !== null counts as movement without normalisation, so a fresh
      // checkout's first stray blur pinned a country onto a capture that does
      // not exist. Inert downstream, but a witness that looks authoritative and
      // is not is how this class of bug arrives.
      //
      // Labelled a CONJUNCTION test on purpose: no single revert breaks it, and
      // it should not be read as independent coverage of either guard.
      // Un-normalising `previousNumber` alone is still stopped by the emptiness
      // check, and dropping the emptiness check alone is still stopped by
      // `numberMoved` being false. The two tests above cover each guard on its
      // own; this one covers them holding together on the path a real page
      // takes first.
      initializeCheckout();
      ctx.$("#billing_country").val("ES");

      ctx.$("#company_id").trigger("blur");

      expect(ctx.Twoinc.getInstance().customerCompany.country_prefix).toBeFalsy();
    });

    test("a sole-trader capture pins the country, and clearing does not", () => {
      initializeCheckout();
      ctx.Twoinc.getInstance().customerCompany.country_prefix = "GB";
      ctx.$("#billing_country").val("ES");

      ctx.soleTrader.setCompany("B12345678", "Ejemplo SL");
      expect(ctx.Twoinc.getInstance().customerCompany.country_prefix).toBe("ES");

      // setMode("business") reaches setCompany with both arguments falsy to
      // CLEAR. There is no capture then for a country to belong to, so this
      // must not re-pin one — a witness written for an empty capture is the
      // kind of thing that reads as authoritative later.
      ctx.$("#billing_country").val("GB");
      ctx.soleTrader.setCompany("", "");
      expect(ctx.Twoinc.getInstance().customerCompany.country_prefix).toBe("ES");
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
      initializeCheckout();
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

    test("a response is discarded after a switch AWAY and BACK", () => {
      // The one case only the country handler's sequence bump covers. By the
      // time the response lands the country reads GB again, so the snapshot
      // comparison matches and waves it through — but the buyer has been to
      // Spain and back, the company that lookup belonged to was cleared on
      // the way out, and its address must not arrive behind them.
      initializeCheckout();
      const inFlight = lookup("gb-lookup-id");

      ctx.$("#billing_country").val("ES");
      fireCountryChange();
      ctx.$("#billing_country").val("GB");
      fireCountryChange();
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
