/**
 * Company-search focus trap (TWO-25288 follow-up).
 *
 * `waitToFocus` polls to land focus in the dropdown's search field after
 * `select2:open`, because the picker's own focus-on-open does not land
 * reliably on every host theme. The poll used to run for its full window
 * (up to ~4.8s from `select2:open`, up to ~12.8s from a results re-render,
 * per `addSelectWooFocusFixHandler`) regardless of what happened after it
 * was scheduled — including the buyer deliberately Tabbing to a completely
 * different field. Each tick only checked "is the search input focused?",
 * never "is the dropdown even still open?", so a buyer who tabbed away
 * got yanked back into the search field until the poll's hit count ran
 * out or they hit Esc (which destroys the dropdown and its search input,
 * so the selector the poll uses stops matching anything).
 *
 * These tests drive the REAL selectWoo widget (see wc-harness) so the
 * dropdown's actual open/close state is what is being asserted against,
 * not a mock of it.
 */

"use strict";

const harness = require("./wc-harness");

const TEXT = {
  company_not_in_list: "My company is not on the list",
  search_company: "Search for company"
};

describe("company-search focus trap", () => {
  let ctx;
  let $;
  let helper;

  beforeEach(() => {
    jest.useFakeTimers();
    ctx = harness.loadTwoinc({
      text: TEXT,
      supported_buyer_countries: ["GB"],
      enable_company_search: "yes",
      enable_address_lookup: "no"
    });
    $ = ctx.$;
    helper = ctx.helper;
    harness.buildCheckoutForm();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    harness.releaseWidgets($);
    document.body.innerHTML = "";
  });

  test("tabbing away from an open dropdown keeps focus on the field the buyer tabbed to", () => {
    const $select = harness.openCompanyWidget($, helper);

    // Mirrors enableCompanySearch's own select2:open wiring: schedule the
    // focus poll the way production code does.
    helper.waitToFocus("billing_company_display", null, null);

    // Let the poll's first tick or two land, same as it would while the
    // buyer is still looking at the freshly-opened dropdown.
    jest.advanceTimersByTime(300);

    const $searchInput = $('input[aria-owns="select2-billing_company_display-results"]');
    expect($searchInput.length).toBe(1);
    expect(document.activeElement).toBe($searchInput.get(0));

    // The buyer tabs to a completely different field. Note the picker does
    // NOT consider itself closed just because native focus moved elsewhere
    // (`isOpen()` stays true here) — which is exactly why the poll cannot
    // rely on the picker's own open/closed state and must look at
    // `document.activeElement` directly.
    $("#billing_company").get(0).focus();
    expect(document.activeElement).toBe($("#billing_company").get(0));

    // Run the poll's remaining window (up to 16 ticks * 300ms = 4.8s).
    jest.advanceTimersByTime(5000);

    // The buyer's own navigation must win: focus stays on #billing_company,
    // not yanked back into the (closed) dropdown's search field.
    expect(document.activeElement).toBe($("#billing_company").get(0));
  });

  test("the re-render-triggered poll (addSelectWooFocusFixHandler) is scoped the same way", () => {
    const $select = harness.openCompanyWidget($, helper);
    helper.addSelectWooFocusFixHandler("billing_company_display");

    // Simulate a results re-render adding a node under the results list,
    // which is what the MutationObserver in addSelectWooFocusFixHandler
    // reacts to by scheduling its own (80-hit, 20ms) waitToFocus poll.
    const $results = $("#select2-billing_company_display-results");
    $results.append('<li class="select2-results__option">Example Co</li>');

    jest.advanceTimersByTime(40);

    // Buyer tabs away.
    $("#billing_company").get(0).focus();

    // Run well past the 80 * 20ms = 1.6s window this poll would otherwise run for.
    jest.advanceTimersByTime(2000);

    expect(document.activeElement).toBe($("#billing_company").get(0));
  });
});
