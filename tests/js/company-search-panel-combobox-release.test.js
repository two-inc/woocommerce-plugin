/**
 * TWO-25554 — the combobox attributes `_attach()` writes come back off every
 * field this panel stops driving.
 *
 * A field left carrying `role="combobox"` and an `aria-controls` pointing at a
 * removed popover advertises a listbox that is not there, which no sighted pass
 * over the checkout can see.
 */

"use strict";

const harness = require("./wc-harness");

const COMBOBOX_ATTRIBUTES = ["role", "aria-haspopup", "aria-controls", "aria-expanded"];

const SEARCH_DOUBLE = {
  MIN_INPUT_LENGTH: 3,
  SEARCH_DEBOUNCE_MS: 0,
  minInputLengthMessage: () => "Keep typing",
  noResultsMessage: () => "No companies found",
  searchCompanies: () => Promise.resolve({ items: [] }),
  abortActiveRequest: () => false
};

function buildFields() {
  document.body.innerHTML =
    '<div id="host"><input id="company_a" class="company-field" type="text" /></div>';
}

function field(id) {
  return document.getElementById(id);
}

function comboboxAttributes(node) {
  return COMBOBOX_ATTRIBUTES.filter((attr) => node.hasAttribute(attr));
}

/** A second field the selector finds first, so `bind()` moves the panel off the original. */
function insertFieldAhead() {
  const first = field("company_a");
  const next = document.createElement("input");
  next.type = "text";
  next.id = "company_b";
  next.className = "company-field";
  const wrap = first.parentElement;
  wrap.parentNode.insertBefore(next, wrap);
  return first;
}

describe("the panel's combobox attributes", () => {
  let ctx;
  let panel;

  beforeEach(() => {
    ctx = harness.loadTwoinc();
    buildFields();
    panel = new global.TwoCompanySearchPanel({
      fieldSelector: ".company-field",
      config: {},
      search: SEARCH_DOUBLE,
      getChips: () => []
    });
    panel.bind();
  });

  afterEach(() => {
    panel.destroy();
    document.body.innerHTML = "";
    ctx = null;
  });

  test("are on the field the panel is driving", () => {
    expect(comboboxAttributes(field("company_a"))).toEqual(COMBOBOX_ATTRIBUTES);
  });

  test.each([
    {
      release: (p) => {
        const left = insertFieldAhead();
        p.bind();
        return left;
      },
      description: "a re-bind onto a re-rendered field"
    },
    {
      release: (p) => {
        const held = field("company_a");
        p.unmount();
        return held;
      },
      description: "unmount, which stays re-mountable"
    }
  ])("come off the field left behind ($description)", ({ release }) => {
    expect(comboboxAttributes(field("company_a"))).toEqual(COMBOBOX_ATTRIBUTES);

    const left = release(panel);

    expect(comboboxAttributes(left)).toEqual([]);
  });
});
