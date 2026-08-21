/**
 * TWO-40 §1 + §2. Address ROLES, the invoice→delivery mirror, and the
 * field-routing table for an address that arrived in an external payload.
 *
 * The two things under test here are the ones the platform this ports from got
 * wrong repeatedly:
 *
 *   §1 — country/company must be resolved ONE way and that answer reused. On
 *   WooCommerce the invoice role is `#billing_*` and it is also the
 *   always-shown form, which is the opposite of PrestaShop/Magento/Hyvä. So
 *   "the primary form" is never the question; "which form plays the invoice
 *   role" is.
 *
 *   §2 — the delivery address mirrors the invoice address until the buyer
 *   edits it, at which point the WHOLE delivery address is pinned, decided by
 *   a pure content match against what the mirror last wrote rather than by a
 *   flag hung off UI events.
 */

"use strict";

const { loadTwoinc } = require("./wc-harness");

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
    ctx = loadTwoinc({ supported_buyer_countries: ["GB", "NO"] });
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

    // When/Then: all three readers return the same normalised answer, so a
    // country pinned next to a captured company cannot be re-read in a
    // different spelling by the deferred re-read.
    expect(ctx.helper.currentCountry()).toBe(expected);
    expect(ctx.dom.getCompanyData().country_prefix).toBe(expected);
    expect(ctx.dom.isCountrySupported()).toBe(true);
  });

  test("the sole-trader country delegates to the one country resolver", () => {
    $("#billing_country").val("NO");
    expect(ctx.soleTrader.currentCountry()).toBe(ctx.helper.currentCountry());
    expect(ctx.soleTrader.currentCountry()).toBe("NO");
  });
});

describe("TWO-40 §2 — invoice→delivery mirror", () => {
  let ctx;
  let $;
  let mirror;

  beforeEach(() => {
    ctx = loadTwoinc({ supported_buyer_countries: ["GB", "NO"] });
    $ = ctx.$;
    mirror = ctx.mirror;
    buildAddressForm();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  /** Fill the invoice-role address the way a registry autofill would. */
  function givenInvoiceAddress() {
    $("#billing_company").val("ACME Widgets Ltd");
    $("#billing_country").val("GB");
    $("#billing_address_1").val("Registry Street 1");
    $("#billing_address_2").val("Flat 2");
    $("#billing_city").val("Registryville");
    $("#billing_postcode").val("AB1 2CD");
    $("#billing_state").val("Kent");
  }

  test("an untouched delivery address takes the whole invoice address", () => {
    // Given: nothing has been written to the delivery form
    mirror.seed();
    givenInvoiceAddress();

    // When
    expect(mirror.sync()).toBe(true);

    // Then
    expect($("#shipping_company").val()).toBe("ACME Widgets Ltd");
    expect($("#shipping_country").val()).toBe("GB");
    expect($("#shipping_address_1").val()).toBe("Registry Street 1");
    expect($("#shipping_address_2").val()).toBe("Flat 2");
    expect($("#shipping_city").val()).toBe("Registryville");
    expect($("#shipping_postcode").val()).toBe("AB1 2CD");
    expect($("#shipping_state").val()).toBe("Kent");
  });

  test("the delivery address is never locked or made required", () => {
    mirror.seed();
    givenInvoiceAddress();
    mirror.sync();

    // The rejected design was a read-only mirrored address. One legal entity
    // with a branch across a border needs a genuinely different, editable
    // country/company on the second address.
    ["company", "country", "address_1", "address_2", "city", "postcode", "state"].forEach(
      (name) => {
        const $field = $("#shipping_" + name);
        // `readOnly` exists on inputs only; a <select> has no such property,
        // which is why this reads it conditionally rather than asserting
        // `undefined` for the country control.
        if ($field.is("input")) expect($field.prop("readOnly")).toBe(false);
        expect($field.prop("disabled")).toBe(false);
        expect($field.prop("required")).toBe(false);
      }
    );
  });

  test.each([
    ["company", "Buyer's Own Ltd", "a company typed on the delivery form"],
    ["country", "NO", "a different delivery country"],
    ["address_1", "Somewhere Else 9", "an edited first address line"],
    ["address_2", "Second floor", "an edited SECOND address line"],
    ["city", "Ashford", "an edited city"],
    ["postcode", "ZZ9 9ZZ", "an edited postcode"],
    ["state", "Fife", "an edited state/county"]
  ])("editing shipping_%s pins the WHOLE delivery address (%s)", (field, value, _description) => {
    // Given: a synced pair
    mirror.seed();
    givenInvoiceAddress();
    mirror.sync();

    // When: the buyer edits exactly one delivery field
    $("#shipping_" + field).val(value);

    // Then: the pin covers every field, not only the edited one — a buyer
    // correcting one line is editing the address, not that line.
    expect(mirror.isPinned()).toBe(true);
    $("#billing_city").val("Newtown");
    expect(mirror.sync()).toBe(false);
    expect($("#shipping_city").val()).toBe(field === "city" ? value : "Registryville");
  });

  test("clearing the edited delivery fields resumes the mirror with no resume control", () => {
    mirror.seed();
    givenInvoiceAddress();
    mirror.sync();
    $("#shipping_city").val("Ashford");
    expect(mirror.isPinned()).toBe(true);

    // When: the buyer empties what they typed. There is deliberately no
    // "resume sync" button — the content match is the whole mechanism.
    $("#shipping_city").val("");

    // Then
    expect(mirror.isPinned()).toBe(false);
    $("#billing_city").val("Newtown");
    expect(mirror.sync()).toBe(true);
    expect($("#shipping_city").val()).toBe("Newtown");
  });

  test("the pin check is case- and whitespace-insensitive", () => {
    mirror.seed();
    givenInvoiceAddress();
    mirror.sync();

    // WooCommerce, a theme or the buyer's own browser can re-case or re-pad a
    // field without the buyer having touched it.
    $("#shipping_city").val("  registryVILLE ");
    expect(mirror.isPinned()).toBe(false);
  });

  test("a delivery address already agreeing with the invoice one at seed time stays synced", () => {
    // Given: WooCommerce prefilled a logged-in buyer's saved shipping address,
    // and it happens to match their billing one
    givenInvoiceAddress();
    $("#shipping_company").val("ACME Widgets Ltd");
    $("#shipping_country").val("GB");
    $("#shipping_address_1").val("Registry Street 1");
    $("#shipping_address_2").val("Flat 2");
    $("#shipping_city").val("Registryville");
    $("#shipping_postcode").val("AB1 2CD");
    $("#shipping_state").val("Kent");
    mirror.seed();

    // When: the buyer corrects their billing country
    $("#billing_country").val("NO");

    // Then: that propagates — this buyer never edited the delivery address
    expect(mirror.sync()).toBe(true);
    expect($("#shipping_country").val()).toBe("NO");
  });

  test("a genuinely different saved delivery address is pinned from the start", () => {
    // Given: the NI-entity-with-an-RoI-branch case — same legal entity, a
    // different valid country/company pairing on the second address
    givenInvoiceAddress();
    $("#shipping_country").val("NO");
    $("#shipping_city").val("Oslo");
    mirror.seed();

    // Then: nothing overwrites it
    expect(mirror.isPinned()).toBe(true);
    expect(mirror.sync()).toBe(false);
    expect($("#shipping_city").val()).toBe("Oslo");
  });

  test("seeding before the first invoice edit is what keeps an unedited pair synced", () => {
    // Given: a matching pair at page load, seeded then (as initialize() does)
    givenInvoiceAddress();
    $("#shipping_city").val("Registryville");
    mirror.seed();

    // When: the buyer edits the invoice city
    $("#billing_city").val("Newtown");

    // Then: the mirror still owns the delivery address. Seeded lazily on the
    // first sync instead, the record would have captured "Newtown" and the
    // untouched "Registryville" would have read as a buyer edit.
    expect(mirror.sync()).toBe(true);
    expect($("#shipping_city").val()).toBe("Newtown");
  });

  test('does not touch the delivery form while "ship to a different address" is unchecked', () => {
    // WooCommerce keeps those fields in the DOM permanently and ignores every
    // one of them on submit while the box is unchecked. This checkout is also
    // live for other payment methods, so quietly rewriting a form with no
    // bearing on the order is not something a payment gateway should do.
    $("form[name=checkout]").append(
      '<input type="checkbox" id="ship-to-different-address-checkbox" />'
    );
    mirror.seed();
    givenInvoiceAddress();

    expect(mirror.sync()).toBe(false);
    expect($("#shipping_city").val()).toBe("");

    // Ticking it fires WooCommerce's own checkout update, which is what runs
    // this again — so the form is filled the moment it starts to matter.
    $("#ship-to-different-address-checkbox").prop("checked", true);
    expect(mirror.sync()).toBe(true);
    expect($("#shipping_city").val()).toBe("Registryville");
  });

  test("a theme with no ship-to-different-address toggle counts as in play", () => {
    // Absence of the checkbox means the delivery form is unconditional.
    mirror.seed();
    givenInvoiceAddress();
    expect(mirror.sync()).toBe(true);
  });

  test("a checkout with no delivery form at all is a no-op, not an error", () => {
    document.body.innerHTML = [
      '<form name="checkout">',
      '  <select id="billing_country"><option value="GB" selected>GB</option></select>',
      '  <input type="text" id="billing_city" value="Registryville" />',
      "</form>"
    ].join("\n");
    mirror.reset();
    expect(mirror.sync()).toBe(false);
  });

  test("a delivery country the store cannot ship to does not pin the mirror", () => {
    // The delivery country <select> lists the countries the store SHIPS to,
    // which is not always the set it BILLS to. Given a value it has no option
    // for, a <select> keeps its current selection silently — so recording the
    // INTENDED value would leave the record disagreeing with the field, and
    // the next pin check would read that as a buyer edit the buyer never made.
    mirror.seed();
    $("#billing_country").append('<option value="JP">Japan</option>');
    $("#billing_country").val("JP");
    $("#billing_city").val("Kyoto");

    expect(mirror.sync()).toBe(true);
    // The select refused the value, as it must — no such option.
    expect($("#shipping_country").val()).not.toBe("JP");
    // And the mirror is still live rather than pinned on its own write.
    expect(mirror.isPinned()).toBe(false);
    $("#billing_city").val("Osaka");
    expect(mirror.sync()).toBe(true);
    expect($("#shipping_city").val()).toBe("Osaka");
  });

  test("the mirror's own writes are not read back as buyer edits", () => {
    // Re-entrancy: writing #shipping_country fires `change`, which WooCommerce
    // turns into a checkout update, which re-enters sync().
    mirror.seed();
    givenInvoiceAddress();
    let reentered = 0;
    $("#shipping_country").on("change", () => {
      reentered += 1;
      expect(mirror.sync()).toBe(false);
    });

    expect(mirror.sync()).toBe(true);
    expect(reentered).toBe(1);
    expect(mirror.isPinned()).toBe(false);
  });
});

describe("TWO-40 §2.6 — field routing for an externally supplied address", () => {
  let ctx;
  let $;

  beforeEach(() => {
    ctx = loadTwoinc({ supported_buyer_countries: ["GB"], enable_address_lookup: "yes" });
    $ = ctx.$;
    buildAddressForm();
    ctx.mirror.seed();
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

  test("a written address propagates to the delivery address in the same pass", () => {
    ctx.Twoinc.getInstance().setAddress({
      street: "Registry Street 1",
      city: "Registryville",
      postal_code: "AB1 2CD"
    });
    expect($("#shipping_address_1").val()).toBe("Registry Street 1");
    expect($("#shipping_city").val()).toBe("Registryville");
  });

  describe("region", () => {
    test("matches a state select by option TEXT", () => {
      buildAddressForm({
        billingStateMarkup:
          '<select id="billing_state" name="billing_state">' +
          '<option value=""></option><option value="KEN">Kent</option>' +
          "</select>"
      });
      ctx.mirror.reset();
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
      ctx.mirror.reset();
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
      ctx.mirror.reset();
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
      ctx.mirror.reset();
      ctx.Twoinc.getInstance().setAddress({ street: "x", city: "Ashford", region: "Kent" });

      expect($("#billing_city").val()).toBe("Ashford, Kent");
    });

    test("does not append the same region twice", () => {
      buildAddressForm({
        billingStateMarkup: '<input type="hidden" id="billing_state" name="billing_state" />'
      });
      ctx.mirror.reset();
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
