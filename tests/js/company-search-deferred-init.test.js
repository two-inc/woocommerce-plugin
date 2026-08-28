/**
 * TWO-25337. `initialize()`'s deferred second pass at enabling company search.
 *
 * `initialize()` calls `enableCompanySearch()` twice: once synchronously, and
 * once on an 800ms timer. The timer exists because the gate `initialize()`
 * returns on is `#order_review`, which a multi-step or late-rendering theme can
 * put in the document before the billing fragment — so the synchronous pass can
 * find no `#billing_company_display` to bind to. `updated_checkout` re-binds
 * too, but only once something triggers a fragment refresh, so on a checkout
 * the buyer does not disturb this timer is the one that has to work.
 *
 * The call is wrapped rather than passed as a bare method reference: with
 * `setTimeout(this.enableCompanySearch, 800)` the deferred pass runs with the
 * global as its receiver, and `attach(this)` then files `window` as the plugin
 * instance. Jest's fake timers pass `null` where a browser passes the global,
 * so that shape throws here instead of misbehaving quietly — which is why every
 * assertion below is on the panel and the DOM, not on `not.toThrow()`.
 */

"use strict";

const harness = require("./wc-harness");

describe("deferred company-search initialisation", () => {
  let ctx;
  let ajax;

  beforeEach(() => {
    // Fake timers here are not the usual "stop initialize()'s timers escaping
    // the test" guard — advancing them is the subject. Every advance below
    // stops AT 800ms, which is what keeps the other timers initialize()
    // installs out of the picture: a 1000ms setTimeout and a 3s setInterval,
    // both of which would fire against this DOM if a test advanced further.
    jest.useFakeTimers();
    ctx = harness.loadTwoinc({ supported_buyer_countries: ["GB"] });
    harness.buildCheckoutForm({ country: "GB" });
    // The checkout-page gate initialize() returns on, plus the gateway radio
    // the payment-method checks look for.
    ctx.$("form[name='checkout']").after('<div id="order_review"></div>');
    ctx
      .$("form[name='checkout']")
      .append(
        "<input type='radio' id='payment_method_woocommerce-gateway-tillit'" +
          " name='payment_method' value='woocommerce-gateway-tillit' />"
      );
    // No test here types, but the stub keeps a leaked request from reaching for
    // the network.
    ajax = harness.stubAjax(ctx.$);
  });

  afterEach(() => {
    ajax.restore();
    harness.releasePanel(ctx.helper);
    // Load-bearing, not tidying — initialize() binds delegated handlers on
    // document.body and jsdom's document outlives the test, so wiping innerHTML
    // removes the elements but leaves the bindings live for the next test.
    ctx.$(document.body).off();
    document.body.innerHTML = "";
    window.sessionStorage.clear();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  /**
   * Is the panel bound to the company field?
   *
   * Read through the panel's own `isBound()`: `attach()` builds a panel whether
   * or not it found a field to anchor to, so panel-exists says nothing about
   * whether the buyer has a control.
   *
   * @returns {boolean}
   */
  function panelBound() {
    return Boolean(ctx.helper.panel && ctx.helper.panel.isBound());
  }

  /**
   * How many panels the company field's own row holds.
   *
   * The duplicate-bind failure this guards is a SECOND panel next to the first,
   * so it has to be counted in the DOM. Scoped to the field's `<p>` rather than
   * counted document-wide, which would depend on no other field in the fixture
   * ever getting one.
   *
   * @returns {number}
   */
  function panelCount() {
    return ctx.$("#billing_company_display_field .two-company-dropdown").length;
  }

  /**
   * Witness that `enableCompanySearch` was called, synchronous pass included.
   *
   * Needed because most of what the retry does is idempotent: re-binding to a
   * field that already has a panel leaves the DOM as it was, so a test that
   * only checks the end state passes whether the timer fired or not. Removing
   * the `setTimeout` from `initialize()` must fail such a test.
   *
   * It spies on the PROTOTYPE, and it must be installed BEFORE `initialize()`.
   * An own-property spy installed afterwards would work against the fix as
   * written but not against `setTimeout(this.enableCompanySearch.bind(this), 800)`,
   * which is equally correct and resolves the method when the timer is
   * SCHEDULED. Spying the prototype up front is invariant to all three shapes.
   * The cost is that the synchronous pass is recorded too, so callers assert a
   * call count of 1 before advancing and 2 after.
   *
   * @param {Function} Twoinc the class from the harness's fresh evaluation
   * @returns {Object} jest spy on the prototype's enableCompanySearch
   */
  function witnessEnableCalls(Twoinc) {
    return jest.spyOn(Twoinc.prototype, "enableCompanySearch");
  }

  test("the deferred pass builds the panel back onto the company field", () => {
    const instance = ctx.Twoinc.getInstance();
    instance.initialize(false);

    // Tear down what the SYNCHRONOUS pass built. Without this the assertions
    // below pass on the synchronous pass's own work — deleting the `setTimeout`
    // from initialize() altogether would leave them green.
    harness.releasePanel(ctx.helper);
    expect(panelBound()).toBe(false);
    expect(panelCount()).toBe(0);

    jest.advanceTimersByTime(800);

    // Only the deferred pass can have put these back.
    expect(panelBound()).toBe(true);
    expect(panelCount()).toBe(1);
    expect(ctx.helper.panel.getField()[0]).toBe(ctx.$("#billing_company_display")[0]);
  });

  test("the deferred pass binds a panel the first pass could not find a host for", () => {
    // The late-render case the timer exists for: #order_review is present, so
    // initialize() runs in full, but the billing fragment is not there yet.
    const markup = ctx.$("#billing_company_display_field").prop("outerHTML");
    ctx.$("#billing_company_display_field").remove();

    const instance = ctx.Twoinc.getInstance();
    instance.initialize(false);

    // The synchronous pass found nothing to bind to. This is the state a real
    // late-rendering theme left the checkout in permanently.
    expect(panelBound()).toBe(false);

    // `attach()` still built a panel: it does that whether or not a host was
    // there for it, so panel-exists is not the same question as panel-bound.
    expect(ctx.helper.panel).not.toBeNull();
    expect(ctx.helper.panel.getField()).toHaveLength(0);

    // WooCommerce renders the billing fragment.
    ctx.$("form[name='checkout']").append(markup);
    expect(panelBound()).toBe(false);

    jest.advanceTimersByTime(800);

    // ...and the retry catches it.
    expect(panelBound()).toBe(true);
    expect(panelCount()).toBe(1);
    expect(ctx.helper.panel.getField()[0]).toBe(ctx.$("#billing_company_display")[0]);
  });

  test("the deferred pass renders no second panel on the ordinary path", () => {
    // Field present all along, so the retry re-runs against a panel that is
    // already live.
    const enableCalls = witnessEnableCalls(ctx.Twoinc);
    const instance = ctx.Twoinc.getInstance();
    instance.initialize(false);

    expect(enableCalls).toHaveBeenCalledTimes(1);
    expect(panelBound()).toBe(true);
    expect(panelCount()).toBe(1);

    jest.advanceTimersByTime(800);

    // Without this the test is vacuous: re-binding changes nothing observable on
    // this path, so the two assertions below hold even with no timer at all.
    expect(enableCalls).toHaveBeenCalledTimes(2);

    expect(panelBound()).toBe(true);
    expect(panelCount()).toBe(1);
    expect(ctx.$(".two-company-field-wrap")).toHaveLength(1);
  });

  test("the deferred pass leaves the field's handlers bound exactly once", () => {
    // TWO-25338: the retry re-binds a field that already has openers on it, and
    // a second copy of the `input` opener re-reads the field AFTER the first has
    // already put the captured name back into it — so the buyer's keystrokes
    // reach the query box as the company name instead.
    ctx.Twoinc.getInstance().initialize(false);
    ctx.capture.write("Acme Ltd", "12345678");

    jest.advanceTimersByTime(800);

    const field = ctx.$("#billing_company_display")[0];
    field.value = "beta";
    field.dispatchEvent(new window.Event("input", { bubbles: true }));

    expect(ctx.$(".two-company-dropdown__query").val()).toBe("beta");
    expect(field.value).toBe("Acme Ltd");
  });

  test("the deferred pass early-returns outside search capture mode", () => {
    // Manual entry must stay untouched by the retry — no control may appear on
    // the timer. Gated on the capture mode, never on `enable_company_search`,
    // which only relocates the control (#486).
    ctx.capture.mode = "manual";

    const enableCalls = witnessEnableCalls(ctx.Twoinc);
    const instance = ctx.Twoinc.getInstance();
    instance.initialize(false);

    expect(enableCalls).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(800);

    // The witness is what makes this about the DEFERRED early return rather than
    // the synchronous one. Both assertions below already hold straight out of
    // the constructor, so without proof the timer fired they say nothing.
    expect(enableCalls).toHaveBeenCalledTimes(2);

    expect(panelBound()).toBe(false);
    // The early return sits above the attach, so no panel was built at all —
    // not even one anchored to nothing.
    expect(ctx.helper.panel).toBeNull();
    expect(panelCount()).toBe(0);
  });
});
