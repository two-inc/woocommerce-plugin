/**
 * TWO-25244. The custom selectWoo `ajax.transport` in assets/js/twoinc.js.
 *
 * The transport exists for one reason: select2's own failure handler cannot
 * tell a cancelled request from a timed-out one. It treats any jqXHR with
 * `status 0` as a cancellation, and a jQuery `timeout` also reports `status 0`
 * — so with the default transport a timeout rendered as "no companies found",
 * which is a wrong answer rather than a missing one. Every assertion here is
 * about that distinction and about which request owns the shared UI.
 */

"use strict";

const harness = require("./wc-harness");

describe("company search ajax transport", () => {
  let ctx;
  let ajax;

  beforeEach(() => {
    ctx = harness.loadTwoinc();
    harness.buildCheckoutForm();
    ajax = harness.stubAjax(ctx.$);
  });

  afterEach(() => {
    ajax.restore();
    harness.releaseWidgets(ctx.$);
    document.body.innerHTML = "";
  });

  /**
   * Open the real widget once per test, and keep it.
   *
   * Re-attaching selectWoo on every search would be the wrong shape: two
   * concurrent searches in the field the buyer is typing into share ONE
   * widget, and that shared spinner and results list are exactly what the
   * supersession guard protects.
   *
   * @returns {Object} the jQuery-wrapped select
   */
  function widget() {
    const $select = ctx.$("#billing_company_display");
    if (!$select.data("select2")) {
      return harness.openCompanyWidget(ctx.$, ctx.helper);
    }
    return $select;
  }

  /**
   * Run one search through the plugin's own transport, with the real widget
   * open so the spinner node and the results container both exist.
   *
   * @param {Object} [params] select2 request params
   * @returns {{success: Object, jqXHR: Object, request: Object}}
   */
  function search(params) {
    widget();
    const transport = ctx.helper.genSelectWooParams().ajax.transport;
    const success = harness.successRecorder();
    const jqXHR = transport(params || { term: "exampleco", page: 0 }, success.fn);
    return { success: success, jqXHR: jqXHR, request: ajax.last() };
  }

  /** @returns {boolean} is the in-field spinner currently showing */
  function spinnerVisible() {
    return ctx.$(".twoinc-searching").length > 0;
  }

  describe("timeout is not a cancellation", () => {
    test("a timeout raises the unavailable message", () => {
      const run = search();

      run.request.fail("timeout");

      expect(harness.resultsText(ctx.$)).toContain("temporarily unavailable");
    });

    test("an abort stays silent", () => {
      const run = search();

      run.request.fail("abort");

      expect(harness.resultsText(ctx.$)).not.toContain("temporarily unavailable");
    });

    test("select2 cancelling the request through the returned jqXHR stays silent", () => {
      // The route an abort actually arrives by: select2 aborts the in-flight
      // search on every keystroke by calling abort() on the jqXHR the
      // transport returned. Driven through that here rather than through the
      // failure handler directly, so the returned handle is proven to be the
      // one select2 can cancel.
      const run = search();

      run.jqXHR.abort();

      expect(run.request.aborted).toBe(true);
      expect(run.success.calls).toHaveLength(0);
      expect(harness.resultsText(ctx.$)).not.toContain("temporarily unavailable");
      expect(spinnerVisible()).toBe(false);
    });

    test("a transport error raises the unavailable message", () => {
      const run = search();

      run.request.fail("error");

      expect(harness.resultsText(ctx.$)).toContain("temporarily unavailable");
    });

    test("a parser error raises the unavailable message", () => {
      const run = search();

      run.request.fail("parsererror");

      expect(harness.resultsText(ctx.$)).toContain("temporarily unavailable");
    });

    test("a timeout and an abort are indistinguishable by jqXHR status alone", () => {
      // The premise of the whole transport, asserted rather than assumed:
      // if these ever diverged, keying off textStatus would be
      // unnecessary. Both are status 0, which is what select2's own
      // failure handler reads.
      const timedOut = search();
      timedOut.request.fail("timeout");
      const aborted = search();
      aborted.request.fail("abort");

      expect(timedOut.jqXHR.status).toBe(0);
      expect(aborted.jqXHR.status).toBe(0);
    });

    test("neither a timeout nor an abort feeds results to select2", () => {
      // A failure must not reach `success` as an empty result set: an
      // empty dropdown reads to the buyer as "my company is not
      // registered".
      const timedOut = search();
      timedOut.request.fail("timeout");
      const aborted = search();
      aborted.request.fail("abort");

      expect(timedOut.success.calls).toHaveLength(0);
      expect(aborted.success.calls).toHaveLength(0);
    });
  });

  describe("request envelope", () => {
    test("carries the 30s client timeout", () => {
      const run = search();

      // 30s deliberately sits outside the checkout API's own retry
      // envelope, so the client never abandons a request the server is
      // still legitimately retrying.
      expect(ctx.helper.companySearchTimeoutMs).toBe(30000);
      expect(run.request.timeout).toBe(30000);
    });

    test("passes select2 params through to jQuery.ajax", () => {
      const run = search({ term: "exampleco", page: 0, dataType: "json" });

      expect(run.request.settings.dataType).toBe("json");
    });

    test("does not mutate the params object select2 owns", () => {
      widget();
      const transport = ctx.helper.genSelectWooParams().ajax.transport;
      const params = { term: "exampleco", page: 0 };

      transport(params, harness.successRecorder().fn);

      expect(params).toEqual({ term: "exampleco", page: 0 });
    });

    test("returns the jqXHR so select2 can abort it", () => {
      const run = search();

      expect(typeof run.jqXHR.abort).toBe("function");
    });
  });

  describe("degraded responses", () => {
    test("degraded === true yields an empty result set and the unavailable message", () => {
      // The API answers HTTP 200 with a near-empty result set when its
      // upstream provider lookup timed out. Rendering that as results
      // would be presenting an unreliable list as a complete one.
      const run = search();

      run.request.succeed({ degraded: true, items: [{ name: "Example Co" }] });

      expect(run.success.calls).toEqual([{ items: [] }]);
      expect(harness.resultsText(ctx.$)).toContain("temporarily unavailable");
    });

    test("an absent degraded field reads as not degraded", () => {
      // The field may not be deployed yet, so today's healthy responses
      // must keep working unchanged.
      const run = search();

      run.request.succeed({ items: [{ name: "Example Co" }] });

      expect(run.success.calls).toHaveLength(1);
      expect(run.success.calls[0].items).toHaveLength(1);
      expect(harness.resultsText(ctx.$)).not.toContain("temporarily unavailable");
    });

    test.each([
      ["a truthy string", "true"],
      ["the number 1", 1],
      ["an object", {}],
      ["false", false],
      ["null", null]
    ])("degraded as %s reads as not degraded", (_label, value) => {
      // Explicit `=== true`, not truthiness.
      const run = search();

      run.request.succeed({ degraded: value, items: [{ name: "Example Co" }] });

      expect(run.success.calls).toHaveLength(1);
      expect(run.success.calls[0].items).toHaveLength(1);
      expect(harness.resultsText(ctx.$)).not.toContain("temporarily unavailable");
    });

    test("a null response body does not throw and is passed straight through", () => {
      const run = search();

      expect(() => run.request.succeed(null)).not.toThrow();
      expect(run.success.calls).toEqual([null]);
    });
  });

  describe("supersession guard", () => {
    test("a superseded FAILURE does not paint over the newer request", () => {
      const first = search();
      const second = search();

      first.request.fail("timeout");

      // The newer search is still running; the older one's timeout must
      // not replace its (pending) results with an error.
      expect(harness.resultsText(ctx.$)).not.toContain("temporarily unavailable");
      // ...and the request that IS current still reports its own timeout.
      second.request.fail("timeout");
      expect(harness.resultsText(ctx.$)).toContain("temporarily unavailable");
    });

    test("a superseded SUCCESS does not repopulate the list", () => {
      // Regression: the guard was originally on the failure path only, so
      // a slow first response could overwrite a newer search's results.
      const first = search();
      const second = search();

      first.request.succeed({ items: [{ name: "Stale Co" }] });

      expect(first.success.calls).toHaveLength(0);

      second.request.succeed({ items: [{ name: "Fresh Co" }] });
      expect(second.success.calls).toHaveLength(1);
      expect(second.success.calls[0].items[0].name).toBe("Fresh Co");
    });

    test("a superseded DEGRADED success neither empties nor warns", () => {
      const first = search();
      search();

      first.request.succeed({ degraded: true, items: [] });

      expect(first.success.calls).toHaveLength(0);
      expect(harness.resultsText(ctx.$)).not.toContain("temporarily unavailable");
    });

    test("the sequence number advances once per dispatched search", () => {
      expect(ctx.helper.companySearchSeq).toBe(0);

      search();
      expect(ctx.helper.companySearchSeq).toBe(1);
      search();
      expect(ctx.helper.companySearchSeq).toBe(2);
    });
  });

  describe("spinner lifecycle", () => {
    test("shows while in flight and clears on success", () => {
      const run = search();
      expect(spinnerVisible()).toBe(true);

      run.request.succeed({ items: [] });

      expect(spinnerVisible()).toBe(false);
    });

    test.each([["timeout"], ["error"], ["abort"]])("clears on %s", (textStatus) => {
      // Zero calls to the hide leaks the spinner for the rest of the
      // session, including on the paths that stay silent.
      const run = search();
      expect(spinnerVisible()).toBe(true);

      run.request.fail(textStatus);

      expect(spinnerVisible()).toBe(false);
    });

    test("a superseded request leaves the spinner up for the request that replaced it", () => {
      const first = search();
      search();
      expect(spinnerVisible()).toBe(true);

      first.request.succeed({ items: [] });

      expect(spinnerVisible()).toBe(true);
    });

    test("the newest request still clears the spinner after an older one settles", () => {
      const first = search();
      const second = search();
      first.request.fail("abort");

      second.request.succeed({ items: [] });

      expect(spinnerVisible()).toBe(false);
    });

    test("creates exactly one spinner node however many searches run", () => {
      // The search input lives inside the dropdown, which select2 tears
      // down and rebuilds on every open, so the node is created lazily
      // per search — that must not accumulate duplicates within one open
      // dropdown.
      search().request.succeed({ items: [] });
      search().request.succeed({ items: [] });
      search().request.fail("timeout");

      expect(ctx.$(".twoinc-search-spinner").length).toBe(1);
    });

    test("does not throw when the dropdown is closed", () => {
      // No open dropdown means no search input to hang the spinner on.
      // The plugin returns early; a search dispatched in that state (a
      // country change re-creating the widget mid-flight) must not blow
      // up.
      const transport = ctx.helper.genSelectWooParams().ajax.transport;

      expect(() => transport({ term: "exampleco" }, harness.successRecorder().fn)).not.toThrow();
      expect(() => ajax.last().fail("timeout")).not.toThrow();
    });
  });

  describe("unavailable message copy", () => {
    test("falls back to the built-in string when no localisation is supplied", () => {
      expect(ctx.helper.companySearchUnavailableText()).toBe(
        "Company search is temporarily unavailable. Please try again."
      );
    });

    test("prefers the localised string when the plugin supplies one", () => {
      ctx.twoinc.text.company_search_unavailable = "Søk er utilgjengelig";

      expect(ctx.helper.companySearchUnavailableText()).toBe("Søk er utilgjengelig");
    });

    test("the widget renders the localised string, not the select2 default", () => {
      // errorLoading() is select2's own hook; the point of overriding it
      // is that the buyer sees our sentence instead of "The results
      // could not be loaded."
      ctx.twoinc.text.company_search_unavailable = "Søk er utilgjengelig";
      const run = search();

      run.request.fail("timeout");

      expect(harness.resultsText(ctx.$)).toContain("Søk er utilgjengelig");
    });

    test("showCompanySearchUnavailable is inert when the widget is absent", () => {
      document.body.innerHTML = "";

      expect(() => ctx.helper.showCompanySearchUnavailable()).not.toThrow();
    });
  });
});
