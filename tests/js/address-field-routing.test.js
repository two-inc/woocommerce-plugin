/**
 * TWO-40. How a looked-up address is routed into the billing fields.
 *
 * There is no existing address-focused suite — `country-switch` and
 * `company-search-manual-entry` reach `setAddress()` only as a side effect of
 * what they are really about — so the routing rules live here.
 *
 * Three rules, each of which used to be broken in its own way:
 *
 *   - a sub-premise leads on line 1 and pushes the street to line 2; with no
 *     sub-premise the street leads and line 2 is left alone. Line 2 used to be
 *     blanked unconditionally, which destroyed a buyer-entered second line.
 *   - the two lines are never deduplicated. An address whose sub-premise and
 *     street read alike is a real address, not a mistake to clean up.
 *   - the region is not dropped. It reaches a state field where the country's
 *     address format has one, and the city otherwise.
 *
 * The clear path is asserted here too, because it is the one caller that DOES
 * need line 2 blanked and the rules above are exactly what stopped it
 * happening for free.
 */

"use strict";

const harness = require("./wc-harness");

/**
 * Add the billing address inputs to the checkout fixture.
 *
 * @param {Function} $ jQuery instance
 * @param {Object} [options]
 * @param {string} [options.address2] starting value for line 2
 * @param {string} [options.city] starting value for the city
 * @param {string} [options.state] markup for the state field: "select",
 *   "text", or "none"
 * @returns {void}
 */
function givenAddressFields($, options) {
  const opts = options || {};
  const stateKind = opts.state === undefined ? "none" : opts.state;
  // Values are assigned through .val() below rather than inlined into the
  // markup: an apostrophe in a fixture value silently truncates a
  // single-quoted attribute, and "Buyer's own line 2" is exactly the kind of
  // value these tests need to survive intact.
  const rows = [
    "<input type='text' id='billing_address_1' />",
    "<input type='text' id='billing_address_2' />",
    "<input type='text' id='billing_city' />",
    "<input type='text' id='billing_postcode' />"
  ];
  if (stateKind === "select") {
    rows.push(
      [
        "<select id='billing_state' name='billing_state'>",
        "  <option value=''>Select a county</option>",
        "  <option value='KEN'>Kent</option>",
        "  <option value='ESS'>Essex</option>",
        "</select>"
      ].join("\n")
    );
  } else if (stateKind === "text") {
    rows.push("<input type='text' id='billing_state' name='billing_state' value='' />");
  }
  $("form[name='checkout']").append(rows.join("\n"));
  $("#billing_address_2").val(opts.address2 || "");
  $("#billing_city").val(opts.city || "");
}

describe("looked-up address field routing", () => {
  let ctx;
  let $;
  let instance;

  beforeEach(() => {
    ctx = harness.loadTwoinc({
      supported_buyer_countries: ["GB"],
      enable_company_search: "yes",
      enable_address_lookup: "yes",
      text: {}
    });
    $ = ctx.$;
    harness.buildCheckoutForm({ country: "GB" });
    instance = ctx.Twoinc.getInstance();
  });

  afterEach(() => {
    harness.releaseWidgets($);
    document.body.innerHTML = "";
  });

  describe("street / sub-premise line routing", () => {
    const cases = [
      {
        payload: { building: "Unit 4", street_address: "Example Street" },
        startingLine2: "",
        line1: "Unit 4",
        line2: "Example Street",
        description: "a building leads on line 1 and pushes the street to line 2"
      },
      {
        payload: { apartment: "Flat 12", street_address: "Example Street" },
        startingLine2: "",
        line1: "Flat 12",
        line2: "Example Street",
        description: "an apartment routes the same way as a building"
      },
      {
        payload: { street_address: "Example Street" },
        startingLine2: "Buyer's own line 2",
        line1: "Example Street",
        line2: "Buyer's own line 2",
        description: "with no sub-premise the street leads and line 2 is untouched"
      },
      {
        payload: { building: "Example Street", street_address: "Example Street" },
        startingLine2: "",
        line1: "Example Street",
        line2: "Example Street",
        description: "identical lines are both written, with no dedup"
      },
      {
        payload: { building: "Unit 4", street_address: "" },
        startingLine2: "Buyer's own line 2",
        line1: "Unit 4",
        line2: "",
        description: "a sub-premise with no street still owns line 2"
      },
      {
        payload: { building: "   ", street_address: "Example Street" },
        startingLine2: "Buyer's own line 2",
        line1: "Example Street",
        line2: "Buyer's own line 2",
        description: "a whitespace-only sub-premise is not a sub-premise"
      }
    ];

    test.each(cases)("$description", ({ payload, startingLine2, line1, line2 }) => {
      givenAddressFields($, { address2: startingLine2 });

      instance.setAddress(Object.assign({ city: "London", postal_code: "EC1A 1BB" }, payload));

      expect($("#billing_address_1").val()).toBe(line1);
      expect($("#billing_address_2").val()).toBe(line2);
      expect($("#billing_city").val()).toBe("London");
      expect($("#billing_postcode").val()).toBe("EC1A 1BB");
    });
  });

  describe("region placement", () => {
    // `state: null` means the country's address format has no state field at
    // all, so there is nothing to assert a value on.
    const cases = [
      {
        stateKind: "select",
        city: "Ashford",
        region: "Kent",
        state: "KEN",
        expectedCity: "Ashford",
        description: "a county matching an option label is selected"
      },
      {
        stateKind: "select",
        city: "Ashford",
        region: "KEN",
        state: "KEN",
        expectedCity: "Ashford",
        description: "a county matching an option code is selected"
      },
      {
        stateKind: "select",
        city: "Ashford",
        region: "kent",
        state: "KEN",
        expectedCity: "Ashford",
        description: "the option match ignores case"
      },
      {
        stateKind: "select",
        city: "Ashford",
        region: "Nowhereshire",
        state: "",
        expectedCity: "Ashford, Nowhereshire",
        description: "a county the option list cannot hold falls back to the city"
      },
      {
        stateKind: "text",
        city: "Ashford",
        region: "Kent",
        state: "Kent",
        expectedCity: "Ashford",
        description: "a free-text state field takes the region verbatim"
      },
      {
        stateKind: "none",
        city: "Ashford",
        region: "Kent",
        state: null,
        expectedCity: "Ashford, Kent",
        description: "with no state field the region is appended to the city"
      },
      {
        stateKind: "none",
        city: "",
        region: "Kent",
        state: null,
        expectedCity: "Kent",
        description: "an empty city becomes the region alone, with no stray comma"
      },
      {
        stateKind: "select",
        city: "Ashford",
        region: "",
        state: "",
        expectedCity: "Ashford",
        description: "no region leaves the state and city alone"
      }
    ];

    test.each(cases)("$description", ({ stateKind, city, region, state, expectedCity }) => {
      givenAddressFields($, { state: stateKind, city: city });

      instance.setAddress({
        street_address: "Example Street",
        city: city,
        postal_code: "TN23 1AA",
        region: region
      });

      expect($("#billing_city").val()).toBe(expectedCity);
      if (state !== null) {
        expect($("#billing_state").val()).toBe(state);
      } else {
        expect($("#billing_state")).toHaveLength(0);
      }
    });
  });

  describe("clearing a disowned company's address", () => {
    test("blanks both lines, including the one setAddress would leave alone", () => {
      givenAddressFields($, { address2: "Flat 2", city: "Registryville", state: "select" });
      $("#billing_address_1").val("Registry Street 1");
      $("#billing_postcode").val("0001");

      instance.clearAddress();

      expect($("#billing_address_1").val()).toBe("");
      expect($("#billing_address_2").val()).toBe("");
      expect($("#billing_city").val()).toBe("");
      expect($("#billing_postcode").val()).toBe("");
    });

    test("does not append an empty region to the cleared city", () => {
      givenAddressFields($, { address2: "Flat 2", city: "Registryville" });

      instance.clearAddress();

      expect($("#billing_city").val()).toBe("");
    });
  });
});
