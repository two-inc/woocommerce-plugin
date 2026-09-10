/**
 * ABN-562. The two company-lookup checkboxes are independent settings, and the
 * admin script must not rewrite either of them on render.
 *
 * "Enable company search in address entry" does not switch company search off
 * — it only moves the control between the address section and the payment tile
 * (see WC_Twoinc_Checkout::derive_company_search_location) — so "Autofill
 * company address" is not conditional on it. Driving the child's state from the
 * parent's showed a stored OFF as ON, and the next save of any unrelated
 * setting posted that tick back and switched autofill on again.
 */

"use strict";

const harness = require("./admin-harness");
const loadAdmin = harness.loadAdmin;
const FIELD_PREFIX = harness.FIELD_PREFIX;

describe("company-lookup toggles", () => {
  const search = () => "#" + FIELD_PREFIX + "enable_company_search";
  const autofill = () => "#" + FIELD_PREFIX + "enable_address_lookup";

  // [stored company search, stored autofill, description]
  test.each([
    [true, false, "autofill saved off stays off under company search on"],
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
    // A disabled input posts nothing, which WooCommerce stores as off — so the
    // stored value only survives an unrelated save while the input is enabled.
    expect($(autofill()).prop("disabled")).toBe(false);
  });

  test.each([
    [false, "ticking company search"],
    [true, "unticking company search"]
  ])(
    "company search starts checked=%s — %s does not touch the autofill value",
    async (startChecked, _description) => {
      const { $ } = await loadAdmin({ companySearch: startChecked, addressLookup: false });

      $(search()).prop("checked", !startChecked).trigger("change");

      expect($(autofill()).prop("checked")).toBe(false);
      expect($(autofill()).prop("disabled")).toBe(false);
    }
  );
});
