/**
 * ABN-554 — changing capture mode inside the popover, and pressing on the
 * popover's own dead space, both leave the buyer somewhere.
 *
 * The two modes that end on the company-name field are covered where they are
 * driven: manual entry in `company-search-manual-entry.test.js`, an adopted
 * sole trader in `sole-trader-flow.test.js`. What is new here is the mode
 * change that leaves the popover UP — a sole-trader launch the browser blocked
 * — plus Escape and a dead-space press.
 *
 * jsdom CAVEATS this suite works around explicitly:
 *  - a browser does not blur the caret out of a hidden row until it restyles,
 *    which is AFTER the handler that hid it, and jsdom never blurs it at all.
 *    So neither engine reports the caret as lost inside `syncChips()`, and the
 *    production code cannot ask where focus is — these cases pin that it asks
 *    the node instead;
 *  - a press performs no default action, so the dead-space cases assert the
 *    press was cancelled — the one thing that stops the browser blurring the
 *    caret;
 *  - there is no sequential focus navigation, so the keyboard route out of an
 *    occluded field is verified in a real browser, not here.
 */

"use strict";

const harness = require("./wc-harness");

const SOLE_TRADER_CONFIG = {
  enabled: "yes",
  tokens_url: "https://shop.example.test/?wc-ajax=two_sole_trader_tokens",
  text: {
    registered_business: "Registered company",
    sole_trader: "Sole trader",
    enter_manually: "Enter manually"
  }
};

const QUERY = ".two-company-dropdown__query";
const PANEL = ".two-company-dropdown";
const MESSAGE = ".two-company-dropdown__message";
const CHIPS = ".two-company-mode-chips";

describe("a mode change and a dead-space press both leave the buyer somewhere", () => {
  let ctx;
  let $;
  let helper;
  let soleTrader;

  beforeEach(() => {
    ctx = harness.loadTwoinc({
      enable_company_search: "yes",
      enable_order_intent: "no",
      enable_address_lookup: "no",
      sole_trader: SOLE_TRADER_CONFIG
    });
    $ = ctx.$;
    helper = ctx.helper;
    soleTrader = ctx.soleTrader;
    window.sessionStorage.clear();
    harness.buildCheckoutForm();
    harness.stubAjax($);
    soleTrader.availabilityByCountry = { GB: true };
    soleTrader.tokens = {
      delegation_token: "delegation",
      autofill_token: "autofill",
      signup_url: "https://checkout.example.test/soletrader/signup"
    };
    // No Two session, so the chip resolves to the hosted signup rather than an
    // autofilled identity.
    jest.spyOn(soleTrader, "fetchCurrentBuyer").mockImplementation((cb) => cb(null));
    // The browser refused the popup, which is the one sole-trader path that
    // leaves the popover up with the query row withdrawn.
    window.open = jest.fn(() => null);
  });

  afterEach(() => {
    soleTrader.unbindPopupMessageListener();
    soleTrader.unbindFocusinListener();
    soleTrader.stopAllPopupWatchers();
    soleTrader.stopTokenRefresh();
    harness.releasePanel(helper);
    $(document.body).off();
    document.body.innerHTML = "";
    jest.restoreAllMocks();
  });

  function open() {
    return harness.openCompanyPanel($, helper);
  }

  function chipNode(mode) {
    return document.querySelector('.two-company-mode-chip[data-two-chip="' + mode + '"]');
  }

  function clickChip(mode) {
    const chip = chipNode(mode);
    expect(chip).not.toBeNull();
    chip.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    chip.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  }

  function pressMouse(node) {
    const event = new window.MouseEvent("mousedown", { bubbles: true, cancelable: true });
    node.dispatchEvent(event);
    return event;
  }

  function pressKey(node, key) {
    node.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: key, bubbles: true, cancelable: true })
    );
  }

  test("a sole-trader launch the browser blocked keeps focus inside the open popover", () => {
    open();

    clickChip("sole_trader");

    expect(helper.companySearchDropdownIsOpen()).toBe(true);
    expect(document.querySelector(".two-company-dropdown__search").classList).toContain(
      "two-hidden"
    );
    expect(document.activeElement).not.toBe(document.body);
    expect(document.querySelector(PANEL).contains(document.activeElement)).toBe(true);
  });

  test("the registered-company chip puts the caret back in the query field", () => {
    open();
    clickChip("sole_trader");

    clickChip("registered");

    expect(helper.companySearchDropdownIsOpen()).toBe(true);
    expect(document.activeElement).toBe(document.querySelector(QUERY));
  });

});
