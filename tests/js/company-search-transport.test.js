/**
 * TWO-25244, re-pinned for TWO-25503. The company-search transport in
 * assets/js/twoinc.js — `searchApi()` and `searchCompanies()`.
 *
 * The transport exists for one reason, unchanged by the panel replacing
 * selectWoo: a cancelled request and a timed-out one are indistinguishable by
 * jqXHR status — jQuery reports `status 0` for both — so the outcome has to be
 * decided from `textStatus`. Get that wrong and a timeout renders as "no
 * companies found", which is a wrong answer rather than a missing one.
 *
 * What changed is the shape, not the subject. `searchCompanies()` RESOLVES on
 * every outcome with one of three answers — `{items}`, `{aborted: true}`,
 * `{unavailable: true}` — and the panel decides what to paint from that. So the
 * three answers are asserted directly at the transport, and the rendering they
 * produce is asserted separately by driving the real panel.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const harness = require("./wc-harness");

describe("company search transport", () => {
  let ctx;
  let ajax;

  beforeEach(() => {
    ctx = harness.loadTwoinc();
    harness.buildCheckoutForm();
    ajax = harness.stubAjax(ctx.$);
  });

  afterEach(() => {
    ajax.restore();
    harness.releasePanel(ctx.helper);
    document.body.innerHTML = "";
  });

  /**
   * Issue one search through the transport the panel is given, and hand back
   * both the promise the panel awaits and the request on the wire.
   *
   * The panel's own debounce is deliberately out of the picture here: two
   * overlapping searches are the subject of half this file, and driving them
   * through the query field would have the newer one abort the older before it
   * could be settled out of order.
   *
   * @param {Object} [options]
   * @param {string} [options.term]
   * @param {Object} [options.token] bind identity, as the panel supplies
   * @returns {{answer: Promise<Object>, request: Object}}
   */
  function search(options) {
    const opts = options || {};
    const answer = ctx.helper.searchApi().searchCompanies({
      config: {},
      token: opts.token || {},
      term: opts.term || "exampleco",
      getCountryCode: function () {
        return ctx.helper.currentCountry();
      }
    });
    return { answer: answer, request: ajax.last() };
  }

  describe("timeout is not a cancellation", () => {
    test.each([
      ["timeout", "unavailable"],
      ["error", "unavailable"],
      ["parsererror", "unavailable"],
      ["abort", "aborted"]
    ])("a %s resolves as %s", async (textStatus, answered) => {
      const run = search();

      run.request.fail(textStatus);

      await expect(run.answer).resolves.toEqual({ [answered]: true });
    });

    test("a timeout and an abort are indistinguishable by jqXHR status alone", async () => {
      // The premise of the whole transport, asserted rather than assumed: if
      // these ever diverged, keying off textStatus would be unnecessary. The
      // jqXHR is read off the helper because that is where the transport keeps
      // the live request.
      const timedOut = search();
      const timedOutXHR = ctx.helper.activeRequest;
      timedOut.request.fail("timeout");
      const aborted = search();
      const abortedXHR = ctx.helper.activeRequest;
      aborted.request.fail("abort");

      await Promise.all([timedOut.answer, aborted.answer]);
      expect(timedOutXHR.status).toBe(0);
      expect(abortedXHR.status).toBe(0);
    });

    test("no failure resolves as a result set", async () => {
      // An empty `items` reaching the panel would render as "no matches",
      // which reads to the buyer as "my company is not registered".
      const timedOut = search();
      timedOut.request.fail("timeout");
      const aborted = search();
      aborted.request.fail("abort");

      expect(await timedOut.answer).not.toHaveProperty("items");
      expect(await aborted.answer).not.toHaveProperty("items");
    });
  });

  describe("request envelope", () => {
    test("carries the 30s client timeout", () => {
      // 30s deliberately sits outside the checkout API's own retry envelope, so
      // the client never abandons a request the server is still retrying.
      const run = search();

      expect(ctx.helper.companySearchTimeoutMs).toBe(30000);
      expect(run.request.timeout).toBe(30000);
    });

    test("targets the companies endpoint on the configured host", () => {
      const url = new URL(search().request.url);

      expect(url.origin).toBe("https://api.example.test");
      expect(url.pathname).toBe("/companies/v2/company");
      expect(url.searchParams.get("q")).toBe("exampleco");
      expect(url.searchParams.get("country")).toBe("GB");
    });

    test("bounds the result set, and takes the bound from the helper's constant", () => {
      expect(new URL(search().request.url).searchParams.get("limit")).toBe("50");
      expect(new URL(search().request.url).searchParams.get("offset")).toBe("0");

      ctx.helper.companySearchLimit = 7;

      expect(new URL(search().request.url).searchParams.get("limit")).toBe("7");
    });

    test("sends the buyer's term verbatim, encoded exactly once", () => {
      // A term containing a percent sign is where a stray decode would show up.
      expect(new URL(search({ term: "a%20b" }).request.url).searchParams.get("q")).toBe("a%20b");
      expect(new URL(search({ term: "Example & Co" }).request.url).searchParams.get("q")).toBe(
        "Example & Co"
      );
    });

    test("the country is read per request, not captured when the panel is built", () => {
      // TWO-24867: the panel outlives a country change on every path that does
      // not rebuild it, and a captured value searched the previous country's
      // register while the form said otherwise.
      ctx.$("#billing_country").append('<option value="SE">Sweden</option>').val("SE");

      expect(new URL(search().request.url).searchParams.get("country")).toBe("SE");
    });

    test("identifies the plugin and its version to the API", () => {
      // The only attribution this endpoint can get: the search runs in the
      // buyer's browser, so the user-agent is the shopper's. In the query
      // string rather than a header on purpose — a custom header would make the
      // request non-simple and cost a CORS preflight per keystroke.
      const url = new URL(search().request.url);

      expect(url.searchParams.get("client")).toBe("woocommerce");
      expect(url.searchParams.get("client_v")).toBe("0.0.0-test");
    });
  });

  describe("degraded responses", () => {
    test("degraded === true resolves as unavailable, with no items", async () => {
      // The API answers HTTP 200 with a near-empty result set when its upstream
      // provider lookup timed out. Rendering that as results would present an
      // unreliable list as a complete one.
      const run = search();

      run.request.succeed({ degraded: true, items: [{ name: "Example Co" }] });

      await expect(run.answer).resolves.toEqual({ unavailable: true });
    });

    test.each([
      ["absent", undefined],
      ["a truthy string", "true"],
      ["the number 1", 1],
      ["an object", {}],
      ["false", false],
      ["null", null]
    ])("degraded as %s reads as not degraded", async (_label, value) => {
      // Explicit `=== true`, not truthiness. Absent must read as not degraded:
      // the field may not be deployed yet.
      const run = search();
      const body = { items: [{ name: "Example Co" }] };
      if (value !== undefined) body.degraded = value;

      run.request.succeed(body);

      expect((await run.answer).items).toHaveLength(1);
    });

    test("a null response body does not throw and yields no results", async () => {
      const run = search();

      expect(() => run.request.succeed(null)).not.toThrow();
      await expect(run.answer).resolves.toEqual({ items: [] });
    });
  });

  describe("supersession guard", () => {
    test("a superseded FAILURE resolves as aborted, not unavailable", async () => {
      const first = search();
      search();

      first.request.fail("timeout");

      // Silent, so the older request's timeout cannot paint an error over the
      // newer search's results.
      await expect(first.answer).resolves.toEqual({ aborted: true });
    });

    test("a superseded SUCCESS resolves as aborted, not as a result set", async () => {
      // Regression: the guard was originally on the failure path only, so a
      // slow first response could overwrite a newer search's results.
      const first = search();
      const second = search();

      first.request.succeed({ items: [{ name: "Stale Co" }] });
      second.request.succeed({ items: [{ name: "Fresh Co" }] });

      await expect(first.answer).resolves.toEqual({ aborted: true });
      expect((await second.answer).items[0].text).toBe("Fresh Co");
    });

    test("a superseded DEGRADED success neither empties nor warns", async () => {
      const first = search();
      search();

      first.request.succeed({ degraded: true, items: [] });

      await expect(first.answer).resolves.toEqual({ aborted: true });
    });

    test("the sequence number advances once per dispatched search", () => {
      expect(ctx.helper.companySearchSeq).toBe(0);

      search();
      expect(ctx.helper.companySearchSeq).toBe(1);
      search();
      expect(ctx.helper.companySearchSeq).toBe(2);
    });
  });

  describe("abortActiveRequest", () => {
    test("cancels the live request for the bind it belongs to, and says so", async () => {
      const token = {};
      const run = search({ token: token });

      expect(ctx.helper.searchApi().abortActiveRequest(token)).toBe(true);

      expect(run.request.abortedWhilePending).toBe(true);
      await expect(run.answer).resolves.toEqual({ aborted: true });
    });

    test("refuses a token that is not the live bind's", () => {
      // The identity is minted fresh whenever the panel re-points at another
      // host, so a search issued by the node it left must not be cancellable
      // by — or cancel — the new one's.
      const run = search({ token: {} });

      expect(ctx.helper.searchApi().abortActiveRequest({})).toBe(false);
      expect(run.request.aborted).toBe(false);
    });

    test("is inert once the request has settled", () => {
      const token = {};
      const run = search({ token: token });
      run.request.succeed({ items: [] });

      expect(ctx.helper.searchApi().abortActiveRequest(token)).toBe(false);
      expect(run.request.abortedWhilePending).toBe(false);
    });
  });

  describe("the six-member contract the panel asks for", () => {
    test("every member the panel checks for is supplied", () => {
      const api = ctx.helper.searchApi();

      expect(Object.keys(api).sort()).toEqual(
        window.TwoCompanySearchPanel.SEARCH_API_CONTRACT.slice().sort()
      );
    });

    test("the thresholds are the helper's own constants, not literals", () => {
      // The enforced minimum and the minimum the buyer is told about have to be
      // one value (TWO-25288).
      ctx.helper.companySearchMinLength = 7;
      ctx.helper.companySearchDebounceMs = 900;
      const api = ctx.helper.searchApi();

      expect(api.MIN_INPUT_LENGTH).toBe(7);
      expect(api.SEARCH_DEBOUNCE_MS).toBe(900);
      expect(api.minInputLengthMessage()).toBe("Enter 7 or more characters");
    });

    test("borrows WooCommerce core copy for the no-matches message", () => {
      // From wc_country_select_params, so the buyer sees the same wording the
      // rest of the checkout uses.
      expect(ctx.helper.searchApi().noResultsMessage()).toBe("No matches found");
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
  });

  describe("driven through the real panel, not the transport directly", () => {
    /*
     * Everything above proves the transport answers correctly. It proves
     * nothing about whether the panel ever reaches it, or about what the buyer
     * ends up looking at — the gap that let a live search on staging show no
     * spinner at all while results came back normally (2026-08-02).
     */

    beforeEach(() => {
      jest.useFakeTimers();
      harness.openCompanyPanel(ctx.$, ctx.helper);
    });

    afterEach(() => {
      jest.clearAllTimers();
      jest.useRealTimers();
    });

    /**
     * Type into the panel's query field. The panel binds with
     * `addEventListener`, which jQuery's `.trigger()` does not reach.
     *
     * @param {string} term
     * @param {boolean} [runDebounce] let the debounce elapse and dispatch
     */
    function typeQuery(term, runDebounce) {
      const query = document.querySelector(".two-company-dropdown__query");
      query.value = term;
      query.dispatchEvent(new window.Event("input", { bubbles: true }));
      if (runDebounce !== false) jest.advanceTimersByTime(ctx.helper.companySearchDebounceMs);
    }

    /** The transport resolves a Promise, so its answer lands on a microtask. */
    function flushPromises() {
      return Promise.resolve().then(() => Promise.resolve());
    }

    /** @returns {boolean} is the panel's spinner currently showing */
    function spinnerVisible() {
      const spinner = document.querySelector(".two-company-dropdown__spinner");
      return !!spinner && spinner.classList.contains("two-company-dropdown__spinner--active");
    }

    test("typing a searchable term dispatches one request carrying that term", () => {
      typeQuery("kaffe");

      expect(ajax.calls).toHaveLength(1);
      expect(new URL(ajax.last().url).searchParams.get("q")).toBe("kaffe");
    });

    test("the spinner is up during the debounce, before any request goes out", () => {
      // The buyer waits 300ms before the request is even dispatched. Hanging
      // the spinner off the transport alone left that window blank, which on a
      // fast connection is most of the visible wait.
      typeQuery("kaffe", false);

      expect(ajax.calls).toHaveLength(0);
      expect(spinnerVisible()).toBe(true);
    });

    test("a below-threshold term dispatches nothing and leaves no spinner running", () => {
      typeQuery("ka");

      expect(ajax.calls).toHaveLength(0);
      expect(spinnerVisible()).toBe(false);
    });

    test("a timeout raises the unavailable message and clears the spinner", async () => {
      typeQuery("kaffe");
      expect(spinnerVisible()).toBe(true);

      ajax.last().fail("timeout");
      await flushPromises();

      expect(harness.resultsText(ctx.$)).toContain("temporarily unavailable");
      expect(spinnerVisible()).toBe(false);
    });

    test("the unavailable message is styled apart from the other two", async () => {
      // TWO-25326: "the search is down" and "your company is not here" are
      // different answers and must not read alike.
      typeQuery("kaffe");
      ajax.last().fail("error");
      await flushPromises();

      const message = document.querySelector(".two-company-dropdown__message");
      expect(message.classList.contains("two-company-dropdown__message--unavailable")).toBe(true);
    });

    test("the buyer sees the localised unavailable string, not the panel's own", async () => {
      ctx.twoinc.text.company_search_unavailable = "Søk er utilgjengelig";
      typeQuery("kaffe");

      ajax.last().fail("timeout");
      await flushPromises();

      expect(harness.resultsText(ctx.$)).toContain("Søk er utilgjengelig");
    });

    test("a degraded 200 raises it too, with no rows painted", async () => {
      typeQuery("kaffe");

      ajax.last().succeed({ degraded: true, items: [{ name: "Example Co" }] });
      await flushPromises();

      expect(document.querySelectorAll(".two-company-dropdown__row")).toHaveLength(0);
      expect(harness.resultsText(ctx.$)).toContain("temporarily unavailable");
    });

    test("an empty result set says no matches, never that the search is down", async () => {
      typeQuery("kaffe");

      ajax.last().succeed({ items: [] });
      await flushPromises();

      expect(harness.resultsText(ctx.$)).toContain("No matches found");
      expect(harness.resultsText(ctx.$)).not.toContain("temporarily unavailable");
      expect(spinnerVisible()).toBe(false);
    });

    test("results paint and clear the spinner", async () => {
      typeQuery("kaffe");

      ajax.last().succeed({ items: [{ name: "Kaffe AS", highlight: "<em>Kaffe</em> AS" }] });
      await flushPromises();

      expect(document.querySelectorAll(".two-company-dropdown__row")).toHaveLength(1);
      expect(spinnerVisible()).toBe(false);
    });

    test("the next keystroke cancels the request still on the wire", async () => {
      typeQuery("kaffe");
      const first = ajax.last();

      typeQuery("kaffebar");

      expect(first.abortedWhilePending).toBe(true);
      expect(ajax.calls).toHaveLength(2);
      // Silent: an abort on every keystroke is routine and must not read as an
      // error to the buyer.
      await flushPromises();
      expect(harness.resultsText(ctx.$)).not.toContain("temporarily unavailable");
    });

    test("a superseded response cannot paint over the newer search", async () => {
      typeQuery("kaffe");
      const first = ajax.last();
      typeQuery("kaffebar");

      first.succeed({ items: [{ name: "Stale Co", highlight: "Stale Co" }] });
      await flushPromises();

      expect(harness.resultsText(ctx.$)).not.toContain("Stale Co");
      // ...and the request that IS current still paints.
      ajax.last().succeed({ items: [{ name: "Fresh Co", highlight: "Fresh Co" }] });
      await flushPromises();
      expect(harness.resultsText(ctx.$)).toContain("Fresh Co");
    });

    test("closing the panel drops the in-flight request and the spinner with it", () => {
      typeQuery("kaffe");
      const inFlight = ajax.last();
      expect(spinnerVisible()).toBe(true);

      ctx.helper.closeCompanySearchDropdown();

      expect(inFlight.abortedWhilePending).toBe(true);
      expect(spinnerVisible()).toBe(false);
    });

    test("the spinner is a single childless element carrying the styling hook", () => {
      // The figure (TWO-25288) is a background-image on this one node, which
      // needs it to stay empty: inner markup would sit on top of the painted
      // background as dead weight the stylesheet does not style.
      typeQuery("kaffe");

      const spinners = document.querySelectorAll(".two-company-dropdown__spinner");
      expect(spinners).toHaveLength(1);
      expect(spinners[0].children).toHaveLength(0);
      expect(spinners[0].textContent).toBe("");
      // Decoration only: the panel announces search state through its results
      // list, so an exposed spinner would double up on it.
      expect(spinners[0].getAttribute("aria-hidden")).toBe("true");
    });

    test("the spinner sits inside the search row, beside the query field", () => {
      // It is positioned absolutely against that row, so the wrong parent means
      // it renders in the wrong place — or nowhere visible — with everything
      // else here still green.
      typeQuery("kaffe");

      const row = document.querySelector(".two-company-dropdown__search");
      expect(row.querySelector(":scope > .two-company-dropdown__spinner")).not.toBeNull();
      expect(row.querySelector(":scope > .two-company-dropdown__query")).not.toBeNull();
      expect(document.querySelectorAll(".two-company-dropdown__spinner")).toHaveLength(1);
    });

    test("many searches leave exactly one spinner node", () => {
      typeQuery("kaffe");
      typeQuery("kaffeb");
      typeQuery("kaffeba");
      typeQuery("kaffebar");

      expect(document.querySelectorAll(".two-company-dropdown__spinner")).toHaveLength(1);
    });

    test("the spinner is painted with the animated loading image", () => {
      // Everything else here pins markup, which stays green whether the spinner
      // paints anything at all — the earlier attempt on this ticket shipped a
      // node that rendered nothing visible with the suite green. So resolve the
      // real stylesheet and read back what the node paints.
      //
      // Two halves, both needed: the computed rule proves the CSS points at the
      // asset, and the existence check proves the asset is in the tree. A
      // correct url() aimed at a missing file satisfies the first on its own,
      // so the URL is resolved relative to the stylesheet's own directory
      // exactly as a browser would rather than spelled out here.
      harness.injectStylesheet();
      typeQuery("kaffe");

      const painted = window.getComputedStyle(
        document.querySelector(".two-company-dropdown__spinner")
      );
      expect(painted.backgroundImage).toContain("loader.gif");
      expect(painted.backgroundRepeat).toBe("no-repeat");

      const declared = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(painted.backgroundImage);
      expect(declared).not.toBeNull();

      const stylesheetDir = path.dirname(path.join(harness.REPO_ROOT, harness.STYLESHEET_PATH));
      const assetPath = path.resolve(stylesheetDir, declared[1]);
      expect(fs.existsSync(assetPath)).toBe(true);

      // And that the file found there is the animated 16x16 figure the rule is
      // sized for. A still image would be a spinner that never spins, and no
      // CSS assertion can tell the two apart — jsdom evaluates no animation.
      const bytes = fs.readFileSync(assetPath);
      expect(bytes.slice(0, 6).toString("latin1")).toBe("GIF89a");
      expect(bytes.readUInt16LE(6)).toBe(16);
      expect(bytes.readUInt16LE(8)).toBe(16);
      expect(harness.countGifFrames(bytes)).toBeGreaterThan(1);
    });
  });
});
