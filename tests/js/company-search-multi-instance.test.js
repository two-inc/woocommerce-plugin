/**
 * TWO-25503. `TwoCompanySearch` must be genuinely instantiable: two live
 * instances on one page each hold their own state, own their own DOM nodes,
 * and neither one's mutation reaches the other.
 *
 * The class was instance-SHAPED but global-BOUND — every method resolved its
 * fields through the module-level `twoincSelectWooHelper`, so a second
 * construction was silently ignored. These tests fail against that shape, so
 * they are what stops it coming back.
 *
 * WooCommerce ships one control, on the primary (= invoice = billing) role.
 * The second instance here is mounted on the delivery role, which is why the
 * fixture carries `#shipping_*` company rows the plugin does not register
 * server-side.
 */

"use strict";

const { loadTwoinc } = require("./wc-harness");

/**
 * A checkout carrying company rows for BOTH address roles, so two controls
 * have somewhere to mount.
 *
 * @returns {void}
 */
function buildTwoRoleCheckout() {
  const row = function (prefix) {
    return [
      '<p id="' + prefix + '_company_display_field" class="form-row">',
      '  <label for="' + prefix + '_company_display">Company name</label>',
      '  <span class="woocommerce-input-wrapper">',
      '    <input type="text" id="' + prefix + '_company_display" autocomplete="off" />',
      "  </span>",
      "</p>",
      '<p id="' + prefix + '_company_field" class="form-row">',
      '  <label for="' + prefix + '_company">Company name</label>',
      '  <span class="woocommerce-input-wrapper">',
      '    <input type="text" id="' + prefix + '_company" name="' + prefix + '_company" />',
      "  </span>",
      "</p>"
    ].join("\n");
  };
  document.body.innerHTML = [
    '<form name="checkout" class="checkout woocommerce-checkout">',
    '  <select id="billing_country" name="billing_country">',
    '    <option value="GB" selected>GB</option>',
    "  </select>",
    row("billing"),
    '  <p id="company_id_field" class="form-row">',
    '    <input type="text" id="company_id" name="company_id" />',
    "  </p>",
    row("shipping"),
    '  <p id="shipping_company_id_field" class="form-row">',
    '    <input type="text" id="shipping_company_id" name="shipping_company_id" />',
    "  </p>",
    "</form>"
  ].join("\n");
}

/**
 * Load the plugin and construct a second control on the delivery role, with
 * its own id for every node the class builds.
 *
 * @returns {Object} the harness bundle plus `second`
 */
function loadTwoControls() {
  const ctx = loadTwoinc();
  buildTwoRoleCheckout();
  ctx.second = new ctx.TwoCompanySearch({
    role: ctx.roles.delivery(),
    addressFieldSelector: "#shipping_company_display",
    tileFieldSelector: "#twoinc_second_tile_company_name",
    searchCompanyBtnId: "second_search_company_btn",
    tileRowId: "twoinc_second_tile_company_row",
    companySummaryId: "twoinc_second_company_summary"
  });
  return ctx;
}

describe("TwoCompanySearch is instantiable", () => {
  test.each([
    ["companyFieldSelector", "#billing_company_display", "#shipping_company_display"],
    ["nativeCompanyRowSelector", "#billing_company_field", "#shipping_company_field"]
  ])(
    "%s resolves per instance, not through the module singleton",
    (method, primaryValue, secondValue) => {
      // Given two controls on different address roles
      const { helper, second } = loadTwoControls();
      // When each is asked which nodes it owns
      // Then each answers for itself
      expect(helper[method]()).toBe(primaryValue);
      expect(second[method]()).toBe(secondValue);
    }
  );

  test("each instance holds its own request state", () => {
    // Given two controls
    const { helper, second } = loadTwoControls();
    const request = { abort: jest.fn() };

    // When one is put mid-flight
    helper.activeRequest = request;
    helper.activeToken = "token-a";
    helper.companySearchSeq = 7;

    // Then the other is untouched
    expect(second.activeRequest).toBeNull();
    expect(second.activeToken).toBeNull();
    expect(second.companySearchSeq).toBe(0);
  });

  test("each instance builds its own panel, bound to its own field", () => {
    // Given two controls
    const { helper, second } = loadTwoControls();

    // When both attach
    helper.attach();
    second.attach();

    // Then neither shares the other's panel or mount
    expect(helper.panel).not.toBe(second.panel);
    expect(helper.panel.fieldSelector).toBe("#billing_company_display");
    expect(second.panel.fieldSelector).toBe("#shipping_company_display");
  });

  test("each instance builds its own back-to-search button, in its own row", () => {
    // Given two controls
    const { $, helper, second } = loadTwoControls();

    // When both build their affordance
    const $primaryBtn = helper.getSearchCompanyBtnNode();
    const $secondBtn = second.getSearchCompanyBtnNode();

    // Then two distinct buttons exist, one per company row
    expect($primaryBtn.attr("id")).toBe("search_company_btn");
    expect($secondBtn.attr("id")).toBe("second_search_company_btn");
    expect($primaryBtn.closest("#billing_company_field").length).toBe(1);
    expect($secondBtn.closest("#shipping_company_field").length).toBe(1);
    expect($("#second_search_company_btn").closest("#billing_company_field").length).toBe(0);
  });

  test("each instance builds its own company-number label, anchored to its own row", () => {
    // Given two controls
    const { $, helper, second } = loadTwoControls();

    // When both render their summary
    helper.renderCompanySummary("Alpha Ltd", "111111");
    second.renderCompanySummary("Beta Ltd", "222222");

    // Then each label carries its own instance's number
    expect($("#twoinc_company_summary .twoinc-company-summary-id").text()).toBe("111111");
    expect($("#twoinc_second_company_summary .twoinc-company-summary-id").text()).toBe("222222");
  });

  test("a capture on one role does not reach the other", () => {
    // Given two controls on different address roles
    const { capture, roles, helper, second } = loadTwoControls();

    // When each captures a different company
    capture.write("Alpha Ltd", "111111", { role: roles.invoice() });
    capture.write("Beta Ltd", "222222", { role: roles.delivery() });

    // Then each control reads back only its own
    expect(helper.getCompanyName()).toBe("Alpha Ltd");
    expect(second.getCompanyName()).toBe("Beta Ltd");
    expect(capture.numberField(roles.invoice()).val()).toBe("111111");
    expect(capture.numberField(roles.delivery()).val()).toBe("222222");
    expect(capture.nameField(roles.invoice()).attr(capture.PAIRING_ATTR)).toBe("alpha ltd|111111");
    expect(capture.nameField(roles.delivery()).attr(capture.PAIRING_ATTR)).toBe("beta ltd|222222");
  });

  test("switching one control into manual entry leaves the other in search", () => {
    // Given two controls
    const { $, capture, roles, helper, second } = loadTwoControls();
    helper.attach();
    second.attach();

    // When only the second switches to manual entry
    second.enterManualCompanyEntry();

    // Then the modes, the selected chip and the affordances stay apart
    expect(capture.modeFor(roles.delivery())).toBe("manual");
    expect(capture.modeFor(roles.invoice())).toBe("search");
    expect(second.selectedMode()).toBe("manual");
    expect(helper.selectedMode()).toBe("registered");
    // Inline style, not `:visible` — jsdom lays nothing out, so every element
    // reads as hidden there.
    expect($("#second_search_company_btn")[0].style.display).not.toBe("none");
    expect($("#search_company_btn").length).toBe(0);
  });

  test("the module singleton is one of these instances, not a separate path", () => {
    // Given the shipped singleton
    const { helper, TwoCompanySearch, roles } = loadTwoControls();

    // Then it is an ordinary instance on the primary role
    expect(helper).toBeInstanceOf(TwoCompanySearch);
    expect(helper.role).toBe(roles.primary());
  });
});
