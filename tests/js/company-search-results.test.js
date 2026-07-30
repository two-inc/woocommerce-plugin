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

const fs = require("fs");
const path = require("path");

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

  describe("a hit with no usable national_identifier", () => {
    // `national_identifier` is optional in the search response and its `id`
    // may be null or empty, so every one of these shapes is reachable. A
    // throw here happens inside select2's query pipeline, which would take
    // the whole result list down with it and leave the dropdown on
    // "Searching…" — so the hit renders with whatever it has instead.
    test.each([
      ["national_identifier absent", { name: "Example Co", highlight: "<em>Example Co</em>" }],
      [
        "national_identifier null",
        { name: "Example Co", highlight: "<em>Example Co</em>", national_identifier: null }
      ],
      [
        "id null",
        {
          name: "Example Co",
          highlight: "<em>Example Co</em>",
          national_identifier: { id: null }
        }
      ],
      [
        "id empty",
        { name: "Example Co", highlight: "<em>Example Co</em>", national_identifier: { id: "" } }
      ]
    ])("%s renders the company without an identifier suffix", (_label, item) => {
      const run = () => processResults()({ items: [item] }, {});

      expect(run).not.toThrow();
      expect(run().results).toEqual([
        {
          id: "Example Co",
          text: "Example Co",
          html: "<em>Example Co</em>",
          company_id: "",
          lookup_id: undefined,
          approved: false
        }
      ]);
    });

    test("does not take the rest of the result list down with it", () => {
      // The point of the guard: one unusable hit must not cost the buyer
      // every other company that matched.
      const out = processResults()(
        {
          items: [
            { name: "Example Co", highlight: "<em>Example Co</em>" },
            hit("Other Example Co", "22222222")
          ]
        },
        {}
      );

      expect(out.results.map((r) => r.text)).toEqual(["Example Co", "Other Example Co"]);
      expect(out.results.map((r) => r.company_id)).toEqual(["", "22222222"]);
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

    test("identifies the plugin and its version to the API", () => {
      // The only attribution this endpoint can get: the widget runs in the
      // buyer's browser, so the user-agent is the shopper's. In the query
      // string rather than a header on purpose — a custom header would make
      // the request non-simple and cost a CORS preflight per keystroke.
      // This caller hands constructTwoincUrl() a URLSearchParams, which is
      // the shape that used to lose both fields.
      const url = urlFor();

      expect(url.searchParams.get("client")).toBe("woocommerce");
      expect(url.searchParams.get("client_v")).toBe("0.0.0-test");
    });

    test("keeps the search params it was given alongside them", () => {
      // Guards against a fix that replaces the params instead of adding to
      // them, which would lose the query itself.
      const url = urlFor({ term: "exampleco" });

      expect(url.searchParams.get("q")).toBe("exampleco");
      expect(url.searchParams.get("country")).toBe("GB");
      expect(url.searchParams.get("client")).toBe("woocommerce");
    });
  });

  describe("widget params", () => {
    test("waits for three characters before searching", () => {
      expect(ctx.helper.genSelectWooParams().minimumInputLength).toBe(3);
    });

    test("takes the threshold from the helper's constant, not a literal", () => {
      // The enforced minimum and the minimum the buyer is told about have to
      // be one value (TWO-25288), so this asserts the wiring rather than the
      // number: a second literal 3 anywhere in the widget params would
      // survive the number changing, and this test would not.
      ctx.helper.companySearchMinLength = 7;

      expect(ctx.helper.genSelectWooParams().minimumInputLength).toBe(7);
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
    });
  });
});

/**
 * TWO-25288, elements 3 and 4. The two hints the company-search field shows
 * before it can search: one in the empty closed field, one while the typed
 * term is below the threshold.
 *
 * Both strings are plugin-owned and translatable. The min-chars one used to be
 * borrowed from WooCommerce core's `wc_country_select_params`, whose copy
 * counts down the REMAINING characters — so the same field told the buyer "1
 * or more" after two keystrokes. These tests pin the fixed-number behaviour
 * and the single-source-of-truth wiring, not just the wording.
 */
describe("company search hints", () => {
  let ctx;

  afterEach(() => {
    if (ctx) harness.releaseWidgets(ctx.$);
    document.body.innerHTML = "";
  });

  describe("the min-chars hint", () => {
    test("states the threshold, ignoring how much is still missing", () => {
      // `text` left empty on purpose: the assertion is then against the
      // plugin's own English source string — the msgid PHP registers — and
      // not against a wording the harness invented.
      ctx = harness.loadTwoinc();
      const language = ctx.helper.genSelectWooParams().language;

      // Both of these produced DIFFERENT copy under the core strings: "1 or
      // more" for two characters typed, "3 or more" for none.
      expect(language.inputTooShort({ minimum: 3, input: "ab" })).toBe(
        "Please enter 3 or more characters"
      );
      expect(language.inputTooShort({ minimum: 3, input: "" })).toBe(
        "Please enter 3 or more characters"
      );
    });

    test("does not read WooCommerce core's countdown strings any more", () => {
      // The borrow is what element 4 removes. Blanking core's strings must
      // not change the hint; if it does, something still reads them.
      ctx = harness.loadTwoinc();
      global.wc_country_select_params.i18n_input_too_short_1 = "CORE ONE";
      global.wc_country_select_params.i18n_input_too_short_n = "CORE %qty%";
      const language = ctx.helper.genSelectWooParams().language;

      expect(language.inputTooShort({ minimum: 3, input: "ab" })).toBe(
        "Please enter 3 or more characters"
      );
    });

    test("interpolates the localised template with the enforced threshold", () => {
      // The %d reaches the browser unresolved so that PHP cannot state a
      // number the widget does not enforce. Translation-shaped template plus
      // a non-default threshold: only code that interpolates one from the
      // other can satisfy both at once.
      ctx = harness.loadTwoinc({ text: { company_search_too_short: "minst %d tegn" } });
      ctx.helper.companySearchMinLength = 4;

      expect(ctx.helper.genSelectWooParams().language.inputTooShort({})).toBe("minst 4 tegn");
    });

    test("renders into the real dropdown once the buyer starts typing", () => {
      ctx = harness.loadTwoinc();
      harness.buildCheckoutForm();
      const $select = harness.openCompanyWidget(ctx.$, ctx.helper);
      const $search = ctx.$('input[aria-owns="select2-billing_company_display-results"]');

      // Guard: the widget has to be open and its search input present, or
      // every assertion below is vacuous.
      expect($search.length).toBe(1);

      $search.val("ab").trigger("input");

      expect(harness.resultsText(ctx.$)).toContain("Please enter 3 or more characters");
      expect(harness.resultsText(ctx.$)).not.toContain("1 or more");
      expect($select.data("select2")).toBeTruthy();
    });
  });

  describe("the empty-field hint", () => {
    test("is passed to the widget as its placeholder", () => {
      ctx = harness.loadTwoinc();

      expect(ctx.helper.genSelectWooParams().placeholder).toBe("Enter company name to search");
    });

    test("uses the localised string when PHP supplies one", () => {
      ctx = harness.loadTwoinc({ text: { company_search_placeholder: "Zoek een bedrijf" } });

      expect(ctx.helper.genSelectWooParams().placeholder).toBe("Zoek een bedrijf");
    });

    test("is what the closed field actually renders", () => {
      // Against the real widget and the real empty-option markup: the
      // non-breaking-space label must not defeat the placeholder.
      ctx = harness.loadTwoinc();
      harness.buildCheckoutForm();
      const $select = ctx.$("#billing_company_display");
      $select.selectWoo(ctx.helper.genSelectWooParams());

      const $rendered = ctx.$("#select2-billing_company_display-container");

      // Guard: no rendered container means the widget never attached.
      expect($rendered.length).toBe(1);
      expect($rendered.find(".select2-selection__placeholder").text()).toBe(
        "Enter company name to search"
      );
    });

    test("would be suppressed by an empty option carrying a value", () => {
      // Pins WHY the shipped markup needs value="": with the option's value
      // defaulting to its own label, the widget treats the field as having a
      // selection and paints that label instead of the hint. This is the
      // regression the pay-for-order template had.
      ctx = harness.loadTwoinc();
      harness.buildCheckoutForm({ companyOptions: "<option>&nbsp;</option>" });
      ctx.$("#billing_company_display").selectWoo(ctx.helper.genSelectWooParams());

      expect(
        ctx.$("#select2-billing_company_display-container").find(".select2-selection__placeholder")
          .length
      ).toBe(0);
    });

    test("the pay-for-order template's empty option carries an empty value", () => {
      // That page renders the company select from its own template rather
      // than through WooCommerce's field API, so it needs the attribute in
      // its own markup. Asserted against the shipped file.
      const markup = fs.readFileSync(
        path.join(harness.REPO_ROOT, "views/woocommerce_order_pay.php"),
        "utf8"
      );
      const select = markup.match(/<select[^>]*id="billing_company_display"[\s\S]*?<\/select>/);

      expect(select).not.toBeNull();
      expect(select[0]).toMatch(/<option value="">/);
    });
  });

  describe("the strings PHP registers", () => {
    // The keys are the contract between the checkout's localisation array and
    // the helper functions above, and nothing else in the suite can see both
    // sides: a renamed key would leave the browser silently falling back to
    // the untranslated English and every other test here still passing.
    const checkout = fs.readFileSync(
      path.join(harness.REPO_ROOT, "class/WC_Twoinc_Checkout.php"),
      "utf8"
    );

    test.each([
      ["company_search_placeholder", "Enter company name to search"],
      ["company_search_too_short", "Please enter %d or more characters"]
    ])("%s is registered as a translatable string", (key, source) => {
      const entry = new RegExp(
        "'" + key + "' *=> *__\\('" + source.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&") + "'"
      );

      expect(checkout).toMatch(entry);
    });

    test("leaves the min-chars placeholder for the browser to resolve", () => {
      // A %d resolved in PHP would put the claimed minimum out of reach of
      // the constant the widget enforces — the drift this design prevents.
      expect(checkout).not.toMatch(/'company_search_too_short' *=> *__\('Please enter \d/);
    });
  });
});
