/**
 * TWO-25244. `processResults` and the request envelope of the company search
 * in assets/js/twoinc.js.
 *
 * `processResults` is fed three different shapes of body: a real search
 * response, the synthesised `{items: []}` the transport substitutes for a
 * degraded response, and — if the API or a proxy in front of it ever answers
 * with something unexpected — whatever that was. It runs inside select2's
 * query pipeline, so a throw there does not surface as an error message: it
 * leaves the dropdown stuck on "Searching…".
 */

"use strict";

const harness = require("./wc-harness");

describe("company search results", () => {
  let ctx;

  beforeEach(() => {
    ctx = harness.loadTwoinc();
    harness.buildCheckoutForm();
  });

  afterEach(() => {
    harness.releaseWidgets(ctx.$);
    document.body.innerHTML = "";
  });

  /** @returns {Function} the plugin's processResults callback */
  function processResults() {
    return ctx.helper.genSelectWooParams().ajax.processResults;
  }

  /**
   * One well-formed search hit, in the shape the companies endpoint returns.
   *
   * @param {string} name company name
   * @param {string} id national identifier
   * @returns {Object}
   */
  function hit(name, id) {
    return {
      name: name,
      highlight: "<em>" + name + "</em>",
      national_identifier: { id: id },
      lookup_id: "lookup-" + id
    };
  }

  describe("a well-formed response", () => {
    test("maps every field selectWoo and the selection handler need", () => {
      const out = processResults()({ items: [hit("Example Trading Co", "11111111")] }, {});

      expect(out.results).toEqual([
        {
          id: "Example Trading Co",
          text: "Example Trading Co",
          html: "<em>Example Trading Co</em> (11111111)",
          company_id: "11111111",
          lookup_id: "lookup-11111111",
          approved: false
        }
      ]);
    });

    test("preserves order and maps every item", () => {
      const out = processResults()(
        { items: [hit("Alpha Example", "1"), hit("Beta Example", "2")] },
        {}
      );

      expect(out.results.map((r) => r.text)).toEqual(["Alpha Example", "Beta Example"]);
    });

    test("never asks select2 for another page", () => {
      // The url() callback does compute an offset from params.page, but
      // pagination is switched off here; if that ever changes, `more`
      // has to start telling the truth or the last page repeats forever.
      const out = processResults()({ items: [hit("Example Co", "1")] }, {});

      expect(out.pagination).toEqual({ more: false });
    });
  });

  describe("response.items is not assumed to be an array", () => {
    test.each([
      ["an absent body", undefined],
      ["a null body", null],
      ["an empty object", {}],
      ["a string body", "not json"],
      ["a number body", 0],
      ["an array body", []],
      ["items as null", { items: null }],
      ["items as an object", { items: { 0: hit("Example Co", "1") } }],
      ["items as a string", { items: "Example Co" }],
      ["items as a number", { items: 3 }],
      ["the synthesised degraded body", { items: [] }]
    ])("%s yields no results and does not throw", (_label, response) => {
      const run = () => processResults()(response, {});

      expect(run).not.toThrow();
      expect(run().results).toEqual([]);
      expect(run().pagination).toEqual({ more: false });
    });
  });

  describe("malformed items", () => {
    test("an item missing national_identifier throws", () => {
      // Characterisation, not endorsement. `item.national_identifier.id`
      // is read unguarded, so a hit without that object throws inside
      // select2's query pipeline and the dropdown stays on "Searching…"
      // rather than showing an error. Pinned so that a future guard
      // (or its absence) is a deliberate decision — see README gaps.
      expect(() => processResults()({ items: [{ name: "Example Co" }] }, {})).toThrow();
    });
  });

  describe("request url", () => {
    /**
     * @param {Object} [params] select2 request params
     * @returns {URL} the url the plugin would request
     */
    function urlFor(params) {
      return new URL(ctx.helper.genSelectWooParams().ajax.url(params || { term: "exampleco" }));
    }

    test("targets the companies endpoint on the configured host", () => {
      const url = urlFor();

      expect(url.origin).toBe("https://api.example.test");
      expect(url.pathname).toBe("/companies/v2/company");
    });

    test("carries the country selected in the checkout form", () => {
      expect(urlFor().searchParams.get("country")).toBe("GB");

      harness.buildCheckoutForm({ country: "NO" });

      expect(urlFor().searchParams.get("country")).toBe("NO");
    });

    test("bounds the result set and pages by that same bound", () => {
      expect(urlFor({ term: "exampleco" }).searchParams.get("limit")).toBe("50");
      expect(urlFor({ term: "exampleco" }).searchParams.get("offset")).toBe("0");
      expect(urlFor({ term: "exampleco", page: 2 }).searchParams.get("offset")).toBe("100");
    });

    test("sends the search term decoded exactly once", () => {
      // select2 hands the raw term over; the plugin decodeURIComponent()s
      // it and then URLSearchParams re-encodes. A term containing a
      // percent sign is where a double-decode would show up.
      expect(urlFor({ term: "a%20b" }).searchParams.get("q")).toBe("a b");
      expect(urlFor({ term: "Example & Co" }).searchParams.get("q")).toBe("Example & Co");
    });

    test("the country is read at widget-creation time, not per keystroke", () => {
      // genSelectWooParams() closes over the country. That is why
      // clearSelectedCompany() re-runs selectWoo() with fresh params on
      // a country change instead of relying on url() to re-read the
      // field — pinned here so the closure is not "simplified" away
      // without noticing what depends on it.
      const url = ctx.helper.genSelectWooParams().ajax.url;
      ctx.$("#billing_country").append('<option value="SE">Sweden</option>').val("SE");

      expect(new URL(url({ term: "exampleco" })).searchParams.get("country")).toBe("GB");
    });

    test("client identification does not reach the query string", () => {
      // Characterisation, not endorsement. constructTwoincUrl() sets
      // `client` / `client_v` as PROPERTIES on the object it is handed;
      // the caller here hands it a URLSearchParams, whose entries are
      // what `new URLSearchParams(params)` copies — so both are dropped.
      // Other callers pass a plain object and do send them. Pinned so
      // that fixing it is a deliberate change with a test that flips.
      const url = urlFor();

      expect(url.searchParams.get("client")).toBeNull();
      expect(url.searchParams.get("client_v")).toBeNull();
    });
  });

  describe("widget params", () => {
    test("waits for three characters before searching", () => {
      expect(ctx.helper.genSelectWooParams().minimumInputLength).toBe(3);
    });

    test("debounces at 300ms, matching the other plugin checkouts", () => {
      expect(ctx.helper.genSelectWooParams().ajax.delay).toBe(300);
    });

    test("renders the highlighted markup unescaped in the list and plain text in the field", () => {
      // The endpoint returns `highlight` as markup, so escapeMarkup has
      // to be a pass-through for the list. templateSelection therefore
      // has to use `text` rather than `html`, or the markup would be
      // injected into the closed field too.
      const params = ctx.helper.genSelectWooParams();
      const data = { text: "Example Co", html: "<em>Example</em> Co" };

      expect(params.escapeMarkup("<em>x</em>")).toBe("<em>x</em>");
      expect(params.templateResult(data)).toBe("<em>Example</em> Co");
      expect(params.templateSelection(data)).toBe("Example Co");
    });

    test("borrows WooCommerce core copy for the non-error messages", () => {
      // These come from wc_country_select_params, so the buyer sees the
      // same wording the rest of the checkout uses.
      const language = ctx.helper.genSelectWooParams().language;

      expect(language.noResults()).toBe("No matches found");
      expect(language.searching()).toBe("Searching…");
      expect(language.inputTooShort({ minimum: 3, input: "ab" })).toBe(
        "Please enter 1 or more characters"
      );
      expect(language.inputTooShort({ minimum: 3, input: "" })).toBe(
        "Please enter 3 or more characters"
      );
    });
  });
});
