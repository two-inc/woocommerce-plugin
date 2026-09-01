/**
 * TWO-40 §1 + §2.6. Address ROLES, the independence of the two address forms,
 * and the field-routing table for an address that arrived in an external
 * payload.
 *
 *   §1 — country/company must be resolved ONE way and that answer reused. On
 *   WooCommerce the invoice role is `#billing_*` and it is also the
 *   always-shown form, which is the opposite of PrestaShop/Magento/Hyvä. So
 *   "the primary form" is never the question; "which form plays the invoice
 *   role" is.
 *
 *   Independence (Doug 2026-09-01) — the billing and shipping address forms
 *   never write to each other. The ONE thing that reads both is
 *   `resolveOrderCompany()`, choosing which captured company the order intent
 *   carries. Every other cross-form effect is a bug, and each test here is a
 *   live one that was reported.
 */

"use strict";

const harness = require("./wc-harness");
const loadTwoinc = harness.loadTwoinc;

/**
 * A checkout form carrying both address forms in full.
 *
 * `#shipping_state` is rendered as WooCommerce renders it for a country whose
 * address format HAS states — a `<select>` — because the region-routing
 * assertions need to tell the three shapes apart.
 *
 * @param {Object} [options]
 * @param {string} [options.billingCountry]
 * @param {string} [options.billingStateMarkup] override the invoice-role state control
 * @returns {void}
 */
function buildAddressForm(options) {
  const opts = options || {};
  const billingCountry = opts.billingCountry || "GB";
  const billingState =
    opts.billingStateMarkup === undefined
      ? '<input type="text" id="billing_state" name="billing_state" value="" />'
      : opts.billingStateMarkup;
  document.body.innerHTML = [
    '<form name="checkout" class="checkout woocommerce-checkout">',
    '  <select id="billing_country" name="billing_country">',
    '    <option value="' + billingCountry + '" selected>Billing country</option>',
    '    <option value="NO">Norway</option>',
    "  </select>",
    '  <input type="text" id="billing_company" name="billing_company" value="" />',
    '  <input type="text" id="company_id" name="company_id" value="" />',
    '  <input type="text" id="billing_address_1" name="billing_address_1" value="" />',
    '  <input type="text" id="billing_address_2" name="billing_address_2" value="" />',
    '  <input type="text" id="billing_city" name="billing_city" value="" />',
    '  <input type="text" id="billing_postcode" name="billing_postcode" value="" />',
    "  " + billingState,
    '  <input type="email" id="billing_email" name="billing_email" value="" />',
    '  <select id="shipping_country" name="shipping_country">',
    '    <option value="" selected></option>',
    '    <option value="GB">United Kingdom</option>',
    '    <option value="NO">Norway</option>',
    "  </select>",
    '  <input type="text" id="shipping_company" name="shipping_company" value="" />',
    '  <input type="text" id="shipping_address_1" name="shipping_address_1" value="" />',
    '  <input type="text" id="shipping_address_2" name="shipping_address_2" value="" />',
    '  <input type="text" id="shipping_city" name="shipping_city" value="" />',
    '  <input type="text" id="shipping_postcode" name="shipping_postcode" value="" />',
    '  <input type="text" id="shipping_state" name="shipping_state" value="" />',
    "</form>"
  ].join("\n");
}

describe("TWO-40 §1 — one address-role resolver", () => {
  let ctx;
  let $;

  beforeEach(() => {
    ctx = loadTwoinc({});
    $ = ctx.$;
    buildAddressForm();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("WooCommerce's invoice role is billing and its delivery role is shipping", () => {
    // The inversion this whole abstraction exists for: on the shipping-first
    // platforms the always-shown form is the DELIVERY one. Asserted rather
    // than merely commented, so a port that flips it has to flip this too.
    expect(ctx.roles.invoice()).toBe("billing");
    expect(ctx.roles.delivery()).toBe("shipping");
  });

  test("field() and value() address a role's own form, live and trimmed", () => {
    $("#billing_city").val("  Ashford  ");
    expect(ctx.roles.field("billing", "city")).toBe("#billing_city");
    expect(ctx.roles.value("billing", "city")).toBe("Ashford");
    // Absent field, not an exception.
    expect(ctx.roles.value("shipping", "nonexistent")).toBe("");
  });

  test.each([
    ["gb", "GB", "an already-lower-case option value"],
    ["GB", "GB", "an upper-case option value"]
  ])("every country reader agrees on %s -> %s (%s)", (fieldValue, expected, _description) => {
    // Given: the field holds a country in one particular case
    $("#billing_country").append('<option value="' + fieldValue + '">x</option>');
    $("#billing_country").val(fieldValue);

    // When/Then: both readers return the same normalised answer, so a
    // country pinned next to a captured company cannot be re-read in a
    // different spelling by the deferred re-read.
    expect(ctx.helper.currentCountry()).toBe(expected);
    expect(ctx.dom.getCompanyData().country_prefix).toBe(expected);
  });

  test("the sole-trader country delegates to the one country resolver", () => {
    $("#billing_country").val("NO");
    expect(ctx.soleTrader.currentCountry()).toBe(ctx.helper.currentCountry());
    expect(ctx.soleTrader.currentCountry()).toBe("NO");
  });
});

describe("the two address forms are independent (Doug 2026-09-01)", () => {
  let ctx;
  let $;
  let ajax;

  beforeEach(() => {
    ctx = loadTwoinc({ enable_address_lookup: "yes" });
    $ = ctx.$;
    ajax = harness.stubAjax($);
    buildAddressForm();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  const REGISTRY_ADDRESS = {
    street_address: "Registry Street 1",
    city: "Registryville",
    postal_code: "AB1 2CD"
  };

  /** Every field of one role, as one object. */
  function addressOf(role) {
    return ["company", "address_1", "address_2", "city", "postcode", "state"].reduce((o, f) => {
      o[f] = $("#" + role + "_" + f).val();
      return o;
    }, {});
  }

  const BLANK = { company: "", address_1: "", address_2: "", city: "", postcode: "", state: "" };

  test("a registry address written for billing leaves the whole shipping form alone", () => {
    ctx.Twoinc.getInstance().setAddress(REGISTRY_ADDRESS, "billing");

    expect(addressOf("billing").address_1).toBe("Registry Street 1");
    expect(addressOf("shipping")).toEqual(BLANK);
  });

  test("a registry address written for shipping lands on shipping, not billing", () => {
    // The live bug: the write went to a hardcoded invoice role, so a company
    // picked in the SHIPPING control filled the BILLING address.
    ctx.Twoinc.getInstance().setAddress(REGISTRY_ADDRESS, "shipping");

    expect(addressOf("shipping").address_1).toBe("Registry Street 1");
    expect(addressOf("shipping").city).toBe("Registryville");
    expect(addressOf("shipping").postcode).toBe("AB1 2CD");
    expect(addressOf("billing")).toEqual(BLANK);
  });

  test("an address lookup for the shipping control writes shipping only", () => {
    ctx.Twoinc.getInstance().addressLookup({ lookup_id: "shipping-lookup" }, "shipping");
    ajax.last().succeed({ addresses: [REGISTRY_ADDRESS] });

    expect(addressOf("shipping").address_1).toBe("Registry Street 1");
    expect(addressOf("billing")).toEqual(BLANK);
    expect(ctx.Twoinc.getInstance().addressStateFor("shipping").registryApplied).toBe(true);
    expect(ctx.Twoinc.getInstance().addressStateFor("billing").registryApplied).toBe(false);
  });

  test.each([
    ["billing", "shipping"],
    ["shipping", "billing"]
  ])("clearAddress(%s) leaves %s untouched", (cleared, kept) => {
    ctx.Twoinc.getInstance().setAddress(REGISTRY_ADDRESS, cleared);
    ctx.Twoinc.getInstance().setAddress(REGISTRY_ADDRESS, kept);

    ctx.Twoinc.getInstance().clearAddress(cleared);

    expect(addressOf(cleared).address_1).toBe("");
    expect(addressOf(cleared).city).toBe("");
    expect(addressOf(kept).address_1).toBe("Registry Street 1");
    expect(addressOf(kept).city).toBe("Registryville");
  });

  test("one role's lookup does not supersede the other's in flight", () => {
    // A shared supersession counter meant a pick on either control silently
    // discarded the other's answer.
    const shipping = (ctx.Twoinc.getInstance().addressLookup(
      { lookup_id: "shipping-lookup" },
      "shipping"
    ),
    ajax.last());
    ctx.Twoinc.getInstance().addressLookup({ lookup_id: "billing-lookup" }, "billing");
    const billing = ajax.last();

    billing.succeed({ addresses: [{ street_address: "Billing Street 9", city: "Billingham" }] });
    shipping.succeed({ addresses: [REGISTRY_ADDRESS] });

    expect(addressOf("billing").address_1).toBe("Billing Street 9");
    expect(addressOf("shipping").address_1).toBe("Registry Street 1");
  });

  test("editing the billing address never propagates to shipping", () => {
    // The address mirror this replaces copied billing onto shipping on every
    // billing edit and on every `updated_checkout`, which is what filled the
    // shipping form (company included) behind a billing company pick.
    ctx.Twoinc.getInstance().initialize(false);
    $("#billing_company").val("ACME Widgets Ltd");
    ["address_1", "city", "postcode"].forEach((f) => {
      $("#billing_" + f)
        .val("billing " + f)
        .trigger("input")
        .trigger("change");
    });
    $(document.body).trigger("updated_checkout");

    expect(addressOf("shipping")).toEqual(BLANK);
  });
});

describe("TWO-40 §2.6 — field routing for an externally supplied address", () => {
  let ctx;
  let $;

  beforeEach(() => {
    ctx = loadTwoinc({ enable_address_lookup: "yes" });
    $ = ctx.$;
    buildAddressForm();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test.each([
    [
      { building: "Building A", street: "Registry Street 1" },
      "Building A",
      "Registry Street 1",
      "building present pushes street onto line 2"
    ],
    [
      { apartment: "Flat 2", street: "Registry Street 1" },
      "Flat 2",
      "Registry Street 1",
      "apartment present pushes street onto line 2"
    ],
    [
      { building: "Building A", apartment: "Flat 2", street: "Registry Street 1" },
      "Building A Flat 2",
      "Registry Street 1",
      "both premises fields share line 1"
    ],
    [
      { street: "Registry Street 1" },
      "Registry Street 1",
      "",
      "no premises leaves street on line 1 and line 2 untouched"
    ],
    [
      { street_address: "Registry Street 1" },
      "Registry Street 1",
      "",
      "street_address is accepted as a synonym for street"
    ],
    [
      { building: "Registry Street 1", street: "Registry Street 1" },
      "Registry Street 1",
      "Registry Street 1",
      "textually identical lines are NOT deduped — real addresses repeat"
    ]
  ])("routes %o to line1=%s line2=%s (%s)", (payload, line1, line2, _description) => {
    ctx.Twoinc.getInstance().setAddress(payload);

    expect($("#billing_address_1").val()).toBe(line1);
    expect($("#billing_address_2").val()).toBe(line2);
  });

  test("a payload with no premises leaves an existing line 2 alone", () => {
    // "line 2 untouched" means untouched, not blanked: a payload carrying
    // nothing for line 2 says nothing about line 2.
    $("#billing_address_2").val("Buyer's own second line");
    ctx.Twoinc.getInstance().setAddress({ street: "Registry Street 1" });
    expect($("#billing_address_2").val()).toBe("Buyer's own second line");
  });

  test("clearAddress blanks line 2 as well, which is why it is not an empty setAddress", () => {
    ctx.Twoinc.getInstance().setAddress({
      building: "Building A",
      street: "Registry Street 1",
      city: "Registryville",
      postal_code: "AB1 2CD"
    });
    ctx.Twoinc.getInstance().clearAddress();

    expect($("#billing_address_1").val()).toBe("");
    expect($("#billing_address_2").val()).toBe("");
    expect($("#billing_city").val()).toBe("");
    expect($("#billing_postcode").val()).toBe("");
  });

  describe("region", () => {
    test("matches a state select by option TEXT", () => {
      buildAddressForm({
        billingStateMarkup:
          '<select id="billing_state" name="billing_state">' +
          '<option value=""></option><option value="KEN">Kent</option>' +
          "</select>"
      });
      ctx.Twoinc.getInstance().setAddress({ street: "x", city: "Ashford", region: "kent" });

      expect($("#billing_state").val()).toBe("KEN");
      expect($("#billing_city").val()).toBe("Ashford");
    });

    test("matches a state select by option VALUE", () => {
      buildAddressForm({
        billingStateMarkup:
          '<select id="billing_state" name="billing_state">' +
          '<option value=""></option><option value="KEN">Kent</option>' +
          "</select>"
      });
      ctx.Twoinc.getInstance().setAddress({ street: "x", city: "Ashford", region: "KEN" });

      expect($("#billing_state").val()).toBe("KEN");
    });

    test("falls back to the city, comma-separated, when no option matches", () => {
      buildAddressForm({
        billingStateMarkup:
          '<select id="billing_state" name="billing_state">' +
          '<option value=""></option><option value="FIF">Fife</option>' +
          "</select>"
      });
      ctx.Twoinc.getInstance().setAddress({ street: "x", city: "Ashford", region: "Kent" });

      // Lossy by nature — the registry's vocabulary and WooCommerce's are two
      // independent lists — so the region is kept on the city rather than
      // silently dropped.
      expect($("#billing_state").val()).toBe("");
      expect($("#billing_city").val()).toBe("Ashford, Kent");
    });

    test("writes straight into a free-text county field", () => {
      ctx.Twoinc.getInstance().setAddress({ street: "x", city: "Ashford", region: "Kent" });
      expect($("#billing_state").val()).toBe("Kent");
      expect($("#billing_city").val()).toBe("Ashford");
    });

    test("falls back to the city when the country's format has no state field", () => {
      // WooCommerce swaps the control for a hidden input on such a country.
      buildAddressForm({
        billingStateMarkup: '<input type="hidden" id="billing_state" name="billing_state" />'
      });
      ctx.Twoinc.getInstance().setAddress({ street: "x", city: "Ashford", region: "Kent" });

      expect($("#billing_city").val()).toBe("Ashford, Kent");
    });

    test("does not append the same region twice", () => {
      buildAddressForm({
        billingStateMarkup: '<input type="hidden" id="billing_state" name="billing_state" />'
      });
      const instance = ctx.Twoinc.getInstance();
      instance.setAddress({ street: "x", city: "Ashford", region: "Kent" });
      instance.setAddress({ street: "x", city: "Ashford, Kent", region: "Kent" });

      expect($("#billing_city").val()).toBe("Ashford, Kent");
    });

    test("an empty region writes nothing", () => {
      $("#billing_city").val("Ashford");
      ctx.Twoinc.getInstance().setAddress({ street: "x", city: "Ashford", region: "" });
      expect($("#billing_city").val()).toBe("Ashford");
      expect($("#billing_state").val()).toBe("");
    });
  });
});
