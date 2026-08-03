/**
 * TWO-25337. `initialize()`'s deferred second pass at enabling company search.
 *
 * `initialize()` calls `enableCompanySearch()` twice: once synchronously, and
 * once on an 800ms timer. The timer exists because the gate `initialize()`
 * returns on is `#order_review`, which a multi-step or late-rendering theme can
 * put in the document before the billing fragment — so the synchronous pass can
 * find no `#billing_company_display` to attach to. That retry is the only one
 * `initialize()` owns: `updated_checkout` re-syncs a good deal of other state but
 * does not re-attach the picker itself. The other callers of
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
 * global as the receiver: the timer steps supply `window` as the this-value, and
 * a strict-mode class body does not change that, because the global is only
 * substituted for a null/undefined receiver in sloppy mode and here a receiver
 * was passed. Confirmed in real Chromium: receiver is `window`, the assignment
 * succeeds, the console stays clean.
 *
 * So the defect was a misdirected write, not a crash. The deferred pass put its
 * `billingCompanySelect` on `window`, and the instance property kept whatever
 * the synchronous pass had left there. The widget itself still attached, because
 * nothing outside `enableCompanySearch` reads that property. What remained was a
 * live selectWoo object leaked onto `window` and a stale instance property
 * waiting for its first reader; `clearSelectedCompany` already dodges that trap
 * by looking the widget up from the DOM instead of trusting the cached
 * reference.
 *
 * ## What this suite can and cannot see
 *
 * Be precise about this, because the obvious reading of these tests is wrong.
 * Jest's fake timers invoke the callback with `null`, not with the global, so
 * the pre-fix code throws `TypeError` HERE where a browser completes it. The
 * browser's actual misbehaviour — receiver is `window`, write lands on the
 * global — is therefore **not reproducible in this harness at all**, and the
 * evidence for it is the Chromium run recorded above and on the PR, not
 * anything below.
 *
 * What that means for these tests: pre-fix, four of the five fail on the Sinon
 * TypeError. That is the mechanism, and pretending otherwise would be dishonest.
 *
 * The company-search-off test is deliberately not one of them, and passes on the
 * broken code too. Its early return sits above the first use of the receiver, so
 * the bug never reached anything there — shops with search off were genuinely
 * unaffected, and the test exists to say that they stay unaffected. It still
 * discriminates the retry's existence: delete the `setTimeout` and it fails.
 *
 * They are still written to assert the deferred pass's *effect on the instance
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
    // the test" guard the rest of the suite installs them for — advancing them
    // is the subject. Every advance below stops AT 800ms, which is what keeps
    // the other timers initialize() installs out of the picture: a 1000ms
    // setTimeout (saveCheckoutInputs / getCompanyData / renderCompanySummary /
    // getApproval) and a 3s setInterval. Both would fire against this DOM if a
    // test ever advanced further, so a test that needs to should expect to deal
    // with them rather than assume 800 is the only timer in play.
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
    // enableCompanySearch builds a real selectWoo widget whose ajax transport
    // would otherwise reach for the network on the first keystroke. No test
    // here types, but the stub keeps a leaked request from failing elsewhere.
    ajax = harness.stubAjax(ctx.$);
  });

  afterEach(() => {
    ajax.restore();
    harness.releaseWidgets(ctx.$);
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
   * Is a selectWoo widget currently attached to the company field?
   *
   * Read from the DOM rather than from `billingCompanySelect`: that property is
   * assigned the result of `.selectWoo()` on a jQuery set that may have been
   * EMPTY, which is a truthy empty set and so says nothing about whether a
   * widget exists. `data("select2")` is set by the widget on the element it
   * actually initialised.
   *
   * @returns {boolean}
   */
  function pickerAttached() {
    return Boolean(ctx.$("#billing_company_display").data("select2"));
  }

  /**
   * How many widget containers the company field's own wrapper holds.
   *
   * The duplicate-attach failure this guards is a SECOND rendered container
   * next to the first, not a replaced instance, so it has to be counted in the
   * DOM rather than inferred from the element's `data`. Scoped to the field's
   * `<p>` rather than counted document-wide: a document-wide count would depend
   * on no other field in the fixture ever being given a widget, so it would
   * start failing here for a reason that has nothing to do with this timer.
   *
   * @returns {number}
   */
  function containerCount() {
    return ctx.$("#billing_company_display_field .select2-container").length;
  }

  /**
   * Witness that `enableCompanySearch` was called, synchronous pass included.
   *
   * Needed because most of what the retry does is idempotent: re-attaching to a
   * field that already has a picker leaves the DOM as it was, so a test that
   * only checks the end state passes whether the timer fired or not. Removing
   * the `setTimeout` from `initialize()` must fail such a test, and without a
   * witness it does not.
   *
   * Two things about the shape of this, both deliberate, because the obvious
   * version is a trap.
   *
   * It spies on the PROTOTYPE, and it must be installed BEFORE `initialize()`.
   * An own-property spy installed after `initialize()` returns would also work
   * against the fix as written — `self.enableCompanySearch()` is a property
   * lookup at invocation time, so it would resolve to the spy — but it would
   * work *only* against that shape. `setTimeout(this.enableCompanySearch.bind(this), 800)`
   * is an equally correct fix, and it resolves the method when the timer is
   * SCHEDULED, before any post-initialize spy exists; such a test would fail on
   * a correct implementation. Spying the prototype up front is invariant to all
   * three shapes — bare reference, `.bind()`, or a wrapper — because every one
   * of them ultimately reaches the prototype method.
   *
   * The cost of that is that the synchronous pass is recorded too, so callers
   * assert a call count of 1 before advancing and 2 after, rather than 1 after.
   *
   * @param {Function} Twoinc the class from the harness's fresh evaluation
   * @returns {Object} jest spy on the prototype's enableCompanySearch
   */
  function witnessEnableCalls(Twoinc) {
    return jest.spyOn(Twoinc.prototype, "enableCompanySearch");
  }

  /**
   * How many handlers are bound for one event on the company field.
   *
   * Read out of jQuery's own event store, because the duplication being counted
   * is invisible from the DOM and from the widget: the extra handler is a second
   * entry against the same element and event name.
   *
   * @param {string} eventName jQuery/select2 event name
   * @returns {number}
   */
  function handlerCount(eventName) {
    const el = ctx.$("#billing_company_display")[0];
    if (!el) return 0;
    const store = ctx.$._data(el, "events");
    if (!store || !store[eventName]) return 0;
    return store[eventName].length;
  }

  test("the deferred pass stores its widget on the instance", () => {
    const instance = ctx.Twoinc.getInstance();
    instance.initialize(false);

    // Discard what the SYNCHRONOUS pass stored. Without this the assertions
    // below pass on the synchronous pass's own work — deleting the `setTimeout`
    // from initialize() altogether would leave them green, which is exactly the
    // vacuity that made the first draft of this test worthless.
    instance.billingCompanySelect = null;

    jest.advanceTimersByTime(800);

    // Only the deferred pass can have put this back.
    expect(instance.billingCompanySelect).not.toBeNull();
    expect(instance.billingCompanySelect.length).toBe(1);
    expect(instance.billingCompanySelect[0]).toBe(ctx.$("#billing_company_display")[0]);

    // Deliberately NOT asserted: that `window.billingCompanySelect` is
    // undefined. Pre-fix this harness throws at the assignment before any write
    // reaches the global, so such an assertion could never fail and would be
    // decorative. The global leak is real but browser-only observable — see the
    // Chromium evidence in the file docblock.
  });

  test("the deferred pass attaches a picker the first pass could not find", () => {
    // The late-render case the timer exists for: #order_review is present, so
    // initialize() runs in full, but the billing fragment is not there yet.
    const markup = ctx.$("#billing_company_display_field").prop("outerHTML");
    ctx.$("#billing_company_display_field").remove();

    const instance = ctx.Twoinc.getInstance();
    instance.initialize(false);

    // The synchronous pass found nothing to attach to. This is the state a real
    // late-rendering theme left the checkout in permanently.
    expect(pickerAttached()).toBe(false);

    // And note what it stored, because it is NOT null: `.selectWoo()` on an
    // empty jQuery set returns that same empty set. The property holds a truthy
    // widget-shaped object wrapping no element, which is worse than null for
    // any caller testing it for presence — the stale value the fix stops the
    // deferred pass from leaving behind.
    expect(instance.billingCompanySelect).not.toBeNull();
    expect(instance.billingCompanySelect.length).toBe(0);

    // WooCommerce renders the billing fragment.
    ctx.$("form[name='checkout']").append(markup);
    expect(pickerAttached()).toBe(false);

    jest.advanceTimersByTime(800);

    // ...and the retry catches it. The picker attaching is what the buyer sees;
    // the instance holding the real reference is what the misdirected write
    // cost.
    expect(pickerAttached()).toBe(true);
    expect(containerCount()).toBe(1);
    expect(instance.billingCompanySelect.length).toBe(1);
  });

  test("the deferred pass renders no second widget on the ordinary path", () => {
    // Field present all along, so the retry re-runs against a widget that is
    // already live. That is not new — the retry did the same thing before the
    // fix, since the wrong receiver only changed where the reference was
    // stored and `selectWoo()` ran on the same element either way — so this
    // pins existing behaviour rather than behaviour the fix introduces.
    const enableCalls = witnessEnableCalls(ctx.Twoinc);
    const instance = ctx.Twoinc.getInstance();
    instance.initialize(false);

    expect(enableCalls).toHaveBeenCalledTimes(1);
    expect(pickerAttached()).toBe(true);
    expect(containerCount()).toBe(1);

    jest.advanceTimersByTime(800);

    // Without this the test is vacuous: re-attaching changes nothing observable
    // on this path, so the two assertions below hold even with no timer at all.
    expect(enableCalls).toHaveBeenCalledTimes(2);

    // selectWoo's re-init destroys the previous instance, so no second
    // container is rendered and the buyer sees one picker.
    expect(pickerAttached()).toBe(true);
    expect(containerCount()).toBe(1);
  });

  test("CHARACTERISATION: the deferred pass leaves the select handler bound twice", () => {
    // Records a real pre-existing defect rather than endorsing it (TWO-25338).
    //
    // Container count above is reassuring about the wrong thing. selectWoo's
    // `destroy()` unbinds with `.off(".select2")`, but the plugin binds its own
    // `select2:select` / `select2:open` handlers UNNAMESPACED and with no
    // preceding `.off()`, so a namespaced unbind cannot match them and they
    // survive the destroy. Every ordinary page load with company search on
    // therefore ends up with the handler bound twice, and one pick then runs
    // getApproval(), addressLookup() and renderCompanySummary() twice over.
    //
    // What the duplication costs, per handler. From `select2:select`:
    // `renderCompanySummary()` and `togglePaySubtitleDesc()` genuinely run
    // twice, and `addressLookup()` does too when address lookup is enabled; the
    // DOM and `customerCompany` writes are idempotent; and `getApproval()` costs
    // nothing, because the second entry finds `orderIntentCheck.interval` set,
    // flags `pendingCheck` and returns — and that flag cannot buy a later round
    // either, since every site that nulls the interval clears it in the same
    // block. The duplicated `select2:open` costs almost nothing, and explicitly
    // NOT a pair of racing focus pollers: `addSelectWooFocusFixHandler` guards
    // itself, and the `waitToFocus("billing_company_display", null, null)` call
    // defeats that helper's own defaults — it guards them with `isNaN`, and
    // `isNaN(null)` is false, so `attemptsLeft` becomes `null * 8` and the
    // interval clears on its first tick. Two single-shot focus nudges.
    //
    // Unchanged by TWO-25337 — the retry ran on the live widget before it too.
    // Left alone here deliberately: fixing it means touching how every handler
    // in enableCompanySearch is bound, which is wider than this ticket. When
    // TWO-25338 fixes it, both expectations below become 1 and this test flips
    // from characterisation to guarantee.
    ctx.Twoinc.getInstance().initialize(false);

    expect(handlerCount("select2:select")).toBe(1);
    expect(handlerCount("select2:open")).toBe(1);

    jest.advanceTimersByTime(800);

    expect(handlerCount("select2:select")).toBe(2);
    expect(handlerCount("select2:open")).toBe(2);
  });

  test("the deferred pass early-returns with company search off", () => {
    // The `enable_company_search !== "yes"` early return sits ABOVE the first
    // use of the receiver, so the unbound call never dereferenced anything on
    // shops with search off. They were unaffected by the bug and must stay
    // unaffected by the fix — no widget may appear on the timer. `ctx.twoinc`
    // and `window.twoinc` are the same object, so setting it once is enough.
    window.twoinc.enable_company_search = "no";

    const enableCalls = witnessEnableCalls(ctx.Twoinc);
    const instance = ctx.Twoinc.getInstance();
    instance.initialize(false);

    expect(enableCalls).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(800);

    // The witness is what makes this about the DEFERRED early return rather than
    // the synchronous one. Both assertions below already hold straight out of
    // the constructor, so without proof the timer fired they say nothing.
    expect(enableCalls).toHaveBeenCalledTimes(2);

    expect(pickerAttached()).toBe(false);
    // The one path that really does leave the property null: the early return
    // is above the assignment.
    expect(instance.billingCompanySelect).toBeNull();
  });
});
