/**
 * TWO-26286. An order intent must never pair a country with a company found
 * under another country's register.
 *
 * Block checkout writes the buyer's address into the classic fields with no
 * `change` or `blur` event, so the handlers that clear a capture on a country
 * change never ran there: a company captured on the shipping form outlived a
 * country switch, and the next check sent the new country with the old
 * company's number. The same silence left the representative as it was at
 * page load. Each case below moves the country the way block checkout does,
 * by writing the field's value and firing nothing.
 */

"use strict";

const harness = require("./wc-harness");

function buildForm() {
  document.body.innerHTML = [
    '<form name="checkout" class="checkout woocommerce-checkout">',
    '  <select id="billing_country" name="billing_country">',
    '    <option value="GB" selected>United Kingdom</option>',
    '    <option value="ES">Spain</option>',
    "  </select>",
    '  <input type="text" id="billing_first_name" name="billing_first_name" value="" />',
    '  <input type="text" id="billing_last_name" name="billing_last_name" value="" />',
    '  <input type="text" id="billing_email" name="billing_email" value="" />',
    '  <input type="text" id="billing_phone" name="billing_phone" value="" />',
    '  <input type="text" id="billing_company" name="billing_company" value="" />',
    '  <input type="text" id="billing_company_display" name="billing_company_display" value="" />',
    '  <input type="text" id="company_id" name="company_id" value="" />',
    '  <select id="shipping_country" name="shipping_country">',
    '    <option value="GB" selected>United Kingdom</option>',
    '    <option value="ES">Spain</option>',
    "  </select>",
    '  <input type="text" id="shipping_company" name="shipping_company" value="" />',
    '  <input type="text" id="shipping_company_display" name="shipping_company_display" value="" />',
    '  <input type="text" id="shipping_company_id" name="shipping_company_id" value="" />',
    '  <input type="checkbox" id="ship-to-different-address-checkbox" checked />',
    "</form>"
  ].join("\n");
}

const GB_COMPANY = { name: "Fake Widgets Test Ltd", number: "00000001" };

describe("TWO-26286: a country move drops the company captured under the old country", () => {
  let ctx;
  let $;
  let ajax;
  let instance;

  beforeEach(() => {
    jest.useFakeTimers();
    ctx = harness.loadTwoinc({ enable_order_intent: "yes", enable_address_lookup: "no" });
    $ = ctx.$;
    buildForm();
    instance = ctx.Twoinc.getInstance();
    // Seeded as a loaded checkout seeds them, so a move reads as one.
    ctx.helper.countryDidChange("GB");
    ctx.shippingHelper.countryDidChange("GB");
    instance.customerRepresentative = {
      email: "buyer@example.test",
      first_name: "Ada",
      last_name: "Lovelace",
      phone_number: "+447700900000"
    };
    ajax = harness.stubAjax($);
  });

  afterEach(() => {
    ajax.restore();
    harness.releasePanel(ctx.helper);
    harness.releasePanel(ctx.shippingHelper);
    jest.clearAllTimers();
    jest.useRealTimers();
    document.body.innerHTML = "";
  });

  function sentIntents() {
    return ajax.calls
      .filter((call) => /two_order_intent/.test(call.url))
      .map((call) => JSON.parse(harness.requestParams(call).get("intent")));
  }

  /** Lets an armed check's interval tick, which is when its request goes out. */
  function tick() {
    jest.advanceTimersByTime(1000);
  }

  // [role captured on, field the country moves in, what runs after the move, description]
  const cases = [
    ["delivery", "#shipping_country", "updated", "shipping capture, block checkout resync"],
    ["invoice", "#billing_country", "updated", "billing capture, block checkout resync"],
    ["delivery", "#shipping_country", "approval", "shipping capture, a check with no resync"],
    ["invoice", "#billing_country", "approval", "billing capture, a check with no resync"],
    ["delivery", "#shipping_country", "armed", "shipping capture, moved after the check armed"],
    [
      "delivery",
      "#shipping_country",
      "change",
      "classic, ship to a different address, change event"
    ]
  ];

  test.each(cases)("%s / %s / %s: %s", (role, countryField, after) => {
    const captureRole = ctx.roles[role]();
    ctx.capture.write(GB_COMPANY.name, GB_COMPANY.number, { role: captureRole, country: "GB" });
    instance.customerCompany.country_prefix = "GB";

    if (after === "armed") instance.getApproval();
    $(countryField).val("ES");
    if (after === "updated") instance.onUpdatedCheckout();
    if (after === "approval") instance.getApproval();
    // What the classic checkout's `change` binding on the shipping country runs.
    if (after === "change") instance.syncShippingCountry();
    // A record re-derived from the live fields, as `updated_checkout` leaves it.
    if (after === "armed") ctx.capture.syncOrderCompany();
    tick();

    const leaked = sentIntents().filter(
      (intent) => intent.buyer.company.organization_number === GB_COMPANY.number
    );
    expect(leaked).toEqual([]);
    expect(ctx.capture.numberField(captureRole).val()).toBe("");
  });

  test("a capture under the country still selected is sent, and left alone", () => {
    const delivery = ctx.roles.delivery();
    ctx.capture.write(GB_COMPANY.name, GB_COMPANY.number, { role: delivery, country: "GB" });

    instance.onUpdatedCheckout();
    tick();

    expect(sentIntents().map((intent) => intent.buyer.company)).toEqual([
      {
        company_name: GB_COMPANY.name,
        country_prefix: "GB",
        organization_number: GB_COMPANY.number
      }
    ]);
    expect(ctx.capture.numberField(delivery).val()).toBe(GB_COMPANY.number);
  });

  test("a resync carries the buyer's details written with no blur", () => {
    ctx.capture.write(GB_COMPANY.name, GB_COMPANY.number, {
      role: ctx.roles.delivery(),
      country: "GB"
    });
    $("#billing_first_name").val("Grace");
    $("#billing_last_name").val("Hopper");
    $("#billing_email").val("grace@example.test");
    $("#billing_phone").val("+447700900001");

    instance.onUpdatedCheckout();
    tick();

    expect(sentIntents().map((intent) => intent.buyer.representative)).toEqual([
      {
        email: "grace@example.test",
        phone_number: "+447700900001",
        first_name: "Grace",
        last_name: "Hopper"
      }
    ]);
  });

  // [country remembered with the company, billing country now, restored, description]
  const restores = [
    ["GB", "ES", false, "remembered under GB, billing now ES"],
    ["GB", "GB", true, "remembered under the country still selected"],
    ["", "GB", false, "remembered before the country was kept"]
  ];

  test.each(restores)(
    "remembered under '%s', billing %s, restored %s: %s",
    (remembered, billing, restored) => {
      Object.assign(window.twoinc, {
        billing_company: GB_COMPANY.name,
        company_id: GB_COMPANY.number,
        company_country: remembered
      });
      $("#billing_country").val(billing);
      ctx.helper.attach();

      ctx.dom.loadUserMetaInputs();
      instance.getApproval();
      tick();

      expect($("#company_id").val()).toBe(restored ? GB_COMPANY.number : "");
      expect(sentIntents().map((intent) => intent.buyer.company)).toEqual(
        restored
          ? [
              {
                company_name: GB_COMPANY.name,
                country_prefix: "GB",
                organization_number: GB_COMPANY.number
              }
            ]
          : []
      );
    }
  );
});
