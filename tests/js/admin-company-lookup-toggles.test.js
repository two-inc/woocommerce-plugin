/**
 * ABN-562. "Enable company search in address entry" and "Autofill company
 * address" are two stored settings with one convenience between them: ticking
 * the first BY HAND switches the second on with it.
 *
 * That sync is edge-triggered. On render, and on the first being unticked, the
 * second is left exactly as stored — driving it from the first's level showed a
 * stored OFF as ON, and the next save of any unrelated setting posted that tick
 * back and switched autofill on again. The second is never disabled either: a
 * disabled input posts nothing, which WooCommerce stores as off.
 *
 * The first does not switch company search off — it only moves the control
 * between the address section and the payment tile (see
 * WC_Twoinc_Checkout::derive_company_search_location).
 */

"use strict";

const harness = require("./admin-harness");
const loadAdmin = harness.loadAdmin;
const FIELD_PREFIX = harness.FIELD_PREFIX;

describe("company-lookup toggles", () => {
  const search = () => "#" + FIELD_PREFIX + "enable_company_search";
  const autofill = () => "#" + FIELD_PREFIX + "enable_address_lookup";

  /** A merchant's own click: the value moves, then the browser fires `change`. */
  function tick($, selector, checked) {
    $(selector).prop("checked", checked).trigger("change");
  }

  // A page load is also what a save renders, so these cases are what survives one.
  test.each([
    [true, false, "autofill saved off renders off under company search on"],
    [true, true, "both on are left on"],
    [false, true, "autofill saved on survives company search being off"],
    [false, false, "both off are left off"]
  ])("search=%s autofill=%s — %s", async (storedSearch, storedAutofill, _description) => {
    const { $ } = await loadAdmin({
      companySearch: storedSearch,
      addressLookup: storedAutofill
    });

    expect($(search()).prop("checked")).toBe(storedSearch);
    expect($(autofill()).prop("checked")).toBe(storedAutofill);
    expect($(autofill()).prop("disabled")).toBe(false);
  });

  test.each([
    {
      storedSearch: true,
      storedAutofill: false,
      act: () => {},
      autofillAfter: false,
      description: "a load with company search already on leaves a stored off alone"
    },
    {
      storedSearch: false,
      storedAutofill: false,
      act: ($) => tick($, search(), true),
      autofillAfter: true,
      description: "ticking company search by hand switches autofill on with it"
    },
    {
      storedSearch: false,
      storedAutofill: false,
      act: ($) => {
        tick($, search(), true);
        tick($, autofill(), false);
      },
      autofillAfter: false,
      description: "unticking autofill after that edge sticks"
    },
    {
      storedSearch: true,
      storedAutofill: false,
      act: ($) => {
        tick($, search(), false);
        tick($, search(), true);
      },
      autofillAfter: true,
      description: "company search off then on again fires the edge again"
    },
    {
      storedSearch: true,
      storedAutofill: true,
      act: ($) => tick($, search(), false),
      autofillAfter: true,
      description: "unticking company search never switches autofill off"
    }
  ])("$description", async ({ storedSearch, storedAutofill, act, autofillAfter }) => {
    const { $ } = await loadAdmin({
      companySearch: storedSearch,
      addressLookup: storedAutofill
    });

    act($);

    expect($(autofill()).prop("checked")).toBe(autofillAfter);
    expect($(autofill()).prop("disabled")).toBe(false);
  });
});
