/**
 * "Enable company search in address entry" and "Autofill company address" are
 * two stored settings with one rule between them: autofill is only offered
 * while company search is on.
 *
 * Company search OFF withdraws the autofill row and unticks it, so the next
 * save stores it off and a stale `yes` cannot outlive the checkbox (ABN-554).
 * Company search ticked ON by hand switches autofill on with it (ABN-562) —
 * that direction stays edge-triggered: driving an ON from the level showed a
 * stored off as on, and the next save of any unrelated setting posted that tick
 * back. Neither is ever `disabled`, since a disabled input posts nothing, which
 * WooCommerce stores as off regardless of the row's state.
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

  /** @returns {boolean} whether the autofill setting's own row is on screen */
  function autofillRowShown($) {
    return $(autofill()).closest("tr").css("display") !== "none";
  }

  // A page load is also what a save renders, so these cases are what survives one.
  test.each([
    {
      storedSearch: true,
      storedAutofill: false,
      autofillAfter: false,
      rowShown: true,
      description: "autofill saved off renders off, row offered"
    },
    {
      storedSearch: true,
      storedAutofill: true,
      autofillAfter: true,
      rowShown: true,
      description: "both on are left on, row offered"
    },
    {
      storedSearch: false,
      storedAutofill: true,
      autofillAfter: false,
      rowShown: false,
      description: "autofill saved on is unticked and withdrawn"
    },
    {
      storedSearch: false,
      storedAutofill: false,
      autofillAfter: false,
      rowShown: false,
      description: "both off stay off, row withdrawn"
    }
  ])("$description", async ({ storedSearch, storedAutofill, autofillAfter, rowShown }) => {
    const { $ } = await loadAdmin({
      companySearch: storedSearch,
      addressLookup: storedAutofill
    });

    expect($(search()).prop("checked")).toBe(storedSearch);
    expect($(autofill()).prop("checked")).toBe(autofillAfter);
    expect(autofillRowShown($)).toBe(rowShown);
    expect($(autofill()).prop("disabled")).toBe(false);
  });

  test.each([
    {
      storedSearch: true,
      storedAutofill: false,
      act: () => {},
      autofillAfter: false,
      rowShown: true,
      description: "a load with company search already on leaves a stored off alone"
    },
    {
      storedSearch: false,
      storedAutofill: false,
      act: ($) => tick($, search(), true),
      autofillAfter: true,
      rowShown: true,
      description: "ticking company search by hand switches autofill on and reveals its row"
    },
    {
      storedSearch: false,
      storedAutofill: false,
      act: ($) => {
        tick($, search(), true);
        tick($, autofill(), false);
      },
      autofillAfter: false,
      rowShown: true,
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
      rowShown: true,
      description: "company search off then on again fires the edge again"
    },
    {
      storedSearch: true,
      storedAutofill: true,
      act: ($) => tick($, search(), false),
      autofillAfter: false,
      rowShown: false,
      description: "unticking company search switches autofill off and withdraws its row"
    }
  ])("$description", async ({ storedSearch, storedAutofill, act, autofillAfter, rowShown }) => {
    const { $ } = await loadAdmin({
      companySearch: storedSearch,
      addressLookup: storedAutofill
    });

    act($);

    expect($(autofill()).prop("checked")).toBe(autofillAfter);
    expect(autofillRowShown($)).toBe(rowShown);
    expect($(autofill()).prop("disabled")).toBe(false);
  });
});
