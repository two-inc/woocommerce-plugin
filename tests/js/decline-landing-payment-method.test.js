/**
 * TWO-27397. A buyer Two declined comes back to the checkout to pay for the
 * same basket another way. The server has already moved the session's chosen
 * payment method off Two, and WooCommerce renders that choice as the checked
 * radio. The browser's saved-input snapshot was taken while Two was checked,
 * and the load-time restore must not put Two back: the payment method is the
 * WooCommerce session's to choose, on this landing and on every other load.
 * Every other stored radio is still restored.
 */

"use strict";

const harness = require("./wc-harness");

const TWO = "woocommerce-gateway-tillit";

describe("the load-time restore leaves the payment method to WooCommerce", () => {
  let ctx;
  let ajax;

  beforeEach(() => {
    // initialize() installs timers that would outlive the test.
    jest.useFakeTimers();
    ctx = harness.loadTwoinc({});
    harness.buildCheckoutForm({ country: "GB" });
    // The checkout-page gate initialize() returns on.
    ctx.$("form[name='checkout']").after('<div id="order_review"></div>');
    ctx.$("form[name='checkout']").append(
      [
        '<ul class="wc_payment_methods">',
        '  <li><input type="radio" id="payment_method_bacs" name="payment_method" value="bacs" /></li>',
        '  <li><input type="radio" id="payment_method_kco" name="payment_method" value="kco" /></li>',
        '  <li><input type="radio" id="payment_method_' +
          TWO +
          '" name="payment_method" value="' +
          TWO +
          '" /></li>',
        "</ul>",
        // A merchant's own radio field, which is not a payment method.
        '<p><input type="radio" id="delivery_slot_morning" name="delivery_slot" value="morning" />',
        '<input type="radio" id="delivery_slot_evening" name="delivery_slot" value="evening" /></p>'
      ].join("\n")
    );
    ajax = harness.stubAjax(ctx.$);
  });

  afterEach(() => {
    ajax.restore();
    harness.releasePanel(ctx.helper);
    ctx.$(document.body).off();
    document.body.innerHTML = "";
    window.sessionStorage.clear();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  /** Check exactly this payment method and delivery slot, as a page render or the buyer would. */
  function check([method, slot]) {
    ctx.$("input[type='radio']").prop("checked", false);
    ctx.$("#payment_method_" + method).prop("checked", true);
    ctx.$("#delivery_slot_" + slot).prop("checked", true);
  }

  function checkedValue(name) {
    return ctx.$("input[name='" + name + "']:checked").val();
  }

  test.each([
    {
      stored: [TWO, "morning"],
      rendered: ["bacs", "morning"],
      expected: ["bacs", "morning"],
      description:
        "the decline landing: the server renders another method, and the stored Two radio is not reselected"
    },
    {
      stored: ["kco", "morning"],
      rendered: ["bacs", "morning"],
      expected: ["bacs", "morning"],
      description: "a stored Klarna radio is not reselected either"
    },
    {
      stored: [TWO, "evening"],
      rendered: ["bacs", "morning"],
      expected: ["bacs", "evening"],
      description: "a stored radio that is not a payment method is still restored"
    },
    {
      stored: [TWO, "morning"],
      rendered: [TWO, "morning"],
      expected: [TWO, "morning"],
      description: "an ordinary reload: the session still names Two, so Two is checked as rendered"
    },
    {
      stored: ["bacs", "morning"],
      rendered: [TWO, "morning"],
      expected: [TWO, "morning"],
      description:
        "an ordinary reload whose snapshot disagrees with the session: the rendered choice stands"
    }
  ])("$description", ({ stored, rendered, expected, description }) => {
    // The snapshot taken while the buyer had `stored` checked.
    check(stored);
    ctx.dom.saveCheckoutInputs();
    // The page as the server renders it on the next load.
    check(rendered);

    ctx.Twoinc.getInstance().initialize(true);

    expect([description, checkedValue("payment_method"), checkedValue("delivery_slot")]).toEqual([
      description,
      ...expected
    ]);
  });
});
