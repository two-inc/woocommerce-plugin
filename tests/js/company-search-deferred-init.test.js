/**
 * TWO-25337. `initialize()`'s deferred second pass at enabling company search.
 *
 * `initialize()` calls `enableCompanySearch()` twice: once synchronously, and
 * once on an 800ms timer. The timer exists because the gate `initialize()`
 * returns on is `#order_review`, which a multi-step or late-rendering theme can
 * put in the document before the billing fragment — so the synchronous pass can
 * find no `#billing_company_display` to bind to. That retry is the only one
 * `initialize()` owns: `updated_checkout` re-syncs a good deal of other state
 * but does not re-bind the control itself. The other callers of
 * `enableCompanySearch` are the manual-entry exit and the sole-trader mode
 * switch, so a checkout whose deferred pass misses is not necessarily stuck
 * forever — but nothing is aiming for that, and this timer is the one that has
 * to work.
 *
 * The call was `setTimeout(this.enableCompanySearch, 800)` — a bare method
 * reference, so the deferred pass ran with the wrong receiver.
 *
 * ## What that actually did, measured rather than assumed
 *
 * It did NOT throw in a browser. `setTimeout` invokes its callback with the
 * global as the receiver, and a strict-mode class body does not change that,
 * because the global is only substituted for a null/undefined receiver in
 * sloppy mode and here a receiver was passed. Confirmed in real Chromium:
 * receiver is `window`, the assignment succeeds, the console stays clean.
 *
 * So the defect was a misdirected write, not a crash. The deferred pass put its
 * control reference on `window`, and the instance property kept whatever the
 * synchronous pass had left there.
 *
 * ## What this suite can and cannot see
 *
 * Jest's fake timers invoke the callback with `null`, not with the global, so
 * the pre-fix code throws `TypeError` HERE where a browser completes it. The
 * browser's actual misbehaviour — receiver is `window`, write lands on the
 * global — is therefore **not reproducible in this harness at all**, and the
 * evidence for it is the Chromium run recorded above and on the PR.
 *
 * These are still written to assert the deferred pass's *effect on the instance
 * and the DOM* rather than `expect(...).not.toThrow()`, for two reasons. An
 * effect assertion says what the code must achieve, so it keeps its meaning if
 * the timer implementation ever stops manufacturing that TypeError, whereas a
 * not-throw assertion would silently become vacuous. And it forces each test to
 * name a specific consequence of the retry, which is what caught the first
 * draft of this file asserting things the synchronous pass alone satisfied.
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
   * Read through the panel's own `isBound()` rather than from
   * `billingCompanySelect`: `attach()` returns the panel whether or not it
   * found a field to anchor to, so a truthy property says nothing about
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

  /**
   * The event types the panel currently has bound on the company field.
   *
   * Read out of the panel's own listener ledger, because the duplication being
   * counted is invisible from the DOM: `addEventListener` exposes nothing, and
   * a second identical binding is a second entry against the same node.
   *
   * @returns {Array<string>}
   */
  function fieldListenerTypes() {
    const field = ctx.$("#billing_company_display")[0];
    if (!field || !ctx.helper.panel) return [];
    return ctx.helper.panel._listeners
      .filter((entry) => entry.target === field)
      .map((entry) => entry.type);
  }

  test("the deferred pass stores its panel on the instance", () => {
    const instance = ctx.Twoinc.getInstance();
    instance.initialize(false);

    // Discard what the SYNCHRONOUS pass stored. Without this the assertions
    // below pass on the synchronous pass's own work — deleting the `setTimeout`
    // from initialize() altogether would leave them green.
    instance.billingCompanySelect = null;

    jest.advanceTimersByTime(800);

    // Only the deferred pass can have put this back.
    expect(instance.billingCompanySelect).not.toBeNull();
    expect(instance.billingCompanySelect).toBe(ctx.helper.panel);
    expect(instance.billingCompanySelect.getField()[0]).toBe(ctx.$("#billing_company_display")[0]);

    // Deliberately NOT asserted: that `window.billingCompanySelect` is
    // undefined. Pre-fix this harness throws at the assignment before any write
    // reaches the global, so such an assertion could never fail. The global leak
    // is real but browser-only observable — see the file docblock.
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

    // And note what it stored, because it is NOT null: `attach()` hands back the
    // panel it built whether or not a host was there for it. The property holds
    // a control-shaped object anchored to nothing, which is worse than null for
    // any caller testing it for presence.
    expect(instance.billingCompanySelect).not.toBeNull();
    expect(instance.billingCompanySelect.getField()).toHaveLength(0);

    // WooCommerce renders the billing fragment.
    ctx.$("form[name='checkout']").append(markup);
    expect(panelBound()).toBe(false);

    jest.advanceTimersByTime(800);

    // ...and the retry catches it. The panel appearing is what the buyer sees;
    // the instance holding the real reference is what the misdirected write cost.
    expect(panelBound()).toBe(true);
    expect(panelCount()).toBe(1);
    expect(instance.billingCompanySelect.getField()).toHaveLength(1);
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
    // TWO-25338 was a real defect under selectWoo: the plugin bound its
    // `select2:select` / `select2:open` handlers unnamespaced with no preceding
    // `.off()`, so a namespaced destroy could not match them and every ordinary
    // page load ended with one pick running getApproval(), addressLookup() and
    // renderCompanySummary() twice over. The panel takes its own listeners back
    // before re-binding, so the retry is genuinely idempotent — this is the
    // guarantee that replaced the characterisation.
    ctx.Twoinc.getInstance().initialize(false);
    const before = fieldListenerTypes();
    expect(before.length).toBeGreaterThan(0);

    jest.advanceTimersByTime(800);

    const after = fieldListenerTypes();
    expect(after.slice().sort()).toEqual(before.slice().sort());
    expect(new Set(after).size).toBe(after.length);
  });

  test("the deferred pass early-returns outside search capture mode", () => {
    // The `twoincCompanyCapture.mode !== "search"` early return sits ABOVE the
    // first use of the receiver, so the unbound call never dereferenced anything
    // in manual entry. Those buyers were unaffected by the bug and must stay
    // unaffected by the fix — no control may appear on the timer.
    //
    // Driven off the capture mode rather than `enable_company_search` (#486):
    // that setting never suppressed the control in the first place, it only ever
    // relocated it, and it is no longer mutated at runtime at all.
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
    // The one path that really does leave the property null: the early return is
    // above the assignment.
    expect(instance.billingCompanySelect).toBeNull();
  });
});
