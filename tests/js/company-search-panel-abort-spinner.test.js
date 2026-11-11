/**
 * TWO-27235: the panel's own `abortActiveRequest()` leaves the spinner off.
 *
 * An aborted search never settles, so `_runSearch()` never reaches its own
 * `_setSearching(false)`. A host that aborts with the panel open (a country
 * clear arriving on a re-render) would otherwise leave the spinner turning
 * over a search that is no longer running.
 */

"use strict";

const harness = require("./wc-harness");

const SPINNER_ACTIVE = ".two-company-dropdown__spinner--active";

function searchDouble(debounceMs) {
  return {
    MIN_INPUT_LENGTH: 3,
    SEARCH_DEBOUNCE_MS: debounceMs,
    minInputLengthMessage: () => "Keep typing",
    noResultsMessage: () => "No companies found",
    // Never settles: the request is still on the wire when the abort comes.
    searchCompanies: () => new Promise(() => {}),
    abortActiveRequest: () => true
  };
}

function flushTimers() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("the panel's abortActiveRequest()", () => {
  let panel;

  beforeEach(() => {
    harness.loadTwoinc();
    document.body.innerHTML = '<div id="host"><input id="company" class="company-field" type="text" /></div>';
  });

  afterEach(() => {
    panel.destroy();
    document.body.innerHTML = "";
  });

  test.each([
    { debounceMs: 0, description: "a search on the wire" },
    { debounceMs: 60000, description: "a debounced search not yet sent" }
  ])("turns the spinner off ($description)", async ({ debounceMs, description }) => {
    panel = new global.TwoCompanySearchPanel({
      fieldSelector: ".company-field",
      config: {},
      search: searchDouble(debounceMs),
      getChips: () => []
    });
    panel.bind();
    panel.open();
    const query = document.querySelector(".two-company-dropdown__query");
    query.value = "acme";
    query.dispatchEvent(new Event("input", { bubbles: true }));
    await flushTimers();
    expect({ description, spinning: !!document.querySelector(SPINNER_ACTIVE) }).toEqual({ description, spinning: true });

    panel.abortActiveRequest();

    expect({ description, open: panel.isOpen(), spinning: !!document.querySelector(SPINNER_ACTIVE) }).toEqual({
      description,
      open: true,
      spinning: false
    });
  });
});
