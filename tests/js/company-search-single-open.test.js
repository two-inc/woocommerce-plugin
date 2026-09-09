/**
 * ABN-510 — only one company-search popover may be open at a time, and the
 * popover that closes gives its field's tab stop back.
 *
 * Two live controls on the two address roles, the way the multi-instance suite
 * mounts them. jsdom has no sequential focus navigation and cannot tell a
 * pointer-delivered event from a focus-delivered one, so what is pinned here is
 * the observable state — which popover is open, and what each field's
 * `tabindex` reads — never the event ordering that motivated the fix.
 */

"use strict";

const { loadTwoinc } = require("./wc-harness");

const FIELDS = { invoice: "#billing_company_display", delivery: "#shipping_company_display" };
const OTHER = { invoice: "delivery", delivery: "invoice" };
const PANEL = ".two-company-dropdown";

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
      '  <span class="woocommerce-input-wrapper">',
      '    <input type="text" id="' + prefix + '_company_display" autocomplete="off" />',
      "  </span>",
      "</p>",
      '<p id="' + prefix + '_company_field" class="form-row">',
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
    '  <select id="shipping_country" name="shipping_country">',
    '    <option value="GB" selected>GB</option>',
    "  </select>",
    row("billing"),
    row("shipping"),
    "</form>"
  ].join("\n");
}

/** @returns {Object} a mounted panel per address role, both from one module instance */
function setup() {
  const ctx = loadTwoinc();
  buildTwoRoleCheckout();
  const second = new ctx.TwoCompanySearch({
    role: ctx.roles.delivery(),
    addressFieldSelector: FIELDS.delivery,
    tileFieldSelector: "#twoinc_second_tile_company_name",
    searchCompanyBtnId: "second_search_company_btn",
    tileRowId: "twoinc_second_tile_company_row",
    companySummaryId: "twoinc_second_company_summary"
  });
  ctx.helper.attach();
  second.attach();
  return { invoice: ctx.helper.panel, delivery: second.panel };
}

function field(which) {
  return document.querySelector(FIELDS[which]);
}

function panelOf(which) {
  return field(which).parentElement.querySelector(PANEL);
}

function isOpen(which) {
  const node = panelOf(which);
  return !!node && !node.hasAttribute("hidden");
}

function tabIndexOf(which) {
  return field(which).getAttribute("tabindex");
}

/** A real pointer press, which is what the defect turned on. */
function mouseDownOn(node) {
  node.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
}

describe("single-open invariant", () => {
  test.each([
    ["invoice"],
    ["delivery"]
  ])("%s open first, so opening the other one closes it", (first) => {
    // Given one popover open
    const panels = setup();
    const second = OTHER[first];
    panels[first].open();

    // When the other opens
    panels[second].open();

    // Then only the second is up
    expect([isOpen(first), isOpen(second)]).toEqual([false, true]);
  });

  test("re-opening the already-open popover leaves it open", () => {
    const panels = setup();
    panels.invoice.open();
    panels.invoice.open();
    expect(isOpen("invoice")).toBe(true);
  });

  test("a closed popover frees the slot, so the other one can take it back", () => {
    const panels = setup();
    panels.invoice.open();
    panels.delivery.open();
    panels.delivery.close();
    panels.invoice.open();
    expect([isOpen("invoice"), isOpen("delivery")]).toEqual([true, false]);
  });
});

describe("tab stop of the popover that closes", () => {
  test.each([
    ["at rest, neither field is a tab stop", function () {}, [null, null]],
    ["invoice open, only that field holds it", function (p) { p.invoice.open(); }, ["-1", null]],
    ["delivery taking over gives invoice its own back", function (p) { p.invoice.open(); p.delivery.open(); }, [null, "-1"]],
    ["both closed again leaves no field at -1", function (p) { p.invoice.open(); p.delivery.open(); p.delivery.close(); }, [null, null]]
  ])("%s", (name, act, expected) => {
    const panels = setup();
    act(panels);
    expect([tabIndexOf("invoice"), tabIndexOf("delivery")]).toEqual(expected);
  });
});

describe("a pointer press outside the open popover", () => {
  test("closes it", () => {
    const panels = setup();
    panels.invoice.open();
    mouseDownOn(field("delivery"));
    expect(isOpen("invoice")).toBe(false);
  });

  test("gives its field the tab stop back", () => {
    const panels = setup();
    panels.invoice.open();
    mouseDownOn(field("delivery"));
    expect(tabIndexOf("invoice")).toBeNull();
  });

  test("inside it, leaves it open", () => {
    const panels = setup();
    panels.invoice.open();
    mouseDownOn(panelOf("invoice"));
    expect(isOpen("invoice")).toBe(true);
  });
});
