/**
 * TWO-25244, re-pinned for TWO-25503. `toResultItems()` — the shaping step
 * between the companies endpoint's response and the rows the panel renders.
 *
 * It is fed three different shapes of body: a real search response, an empty
 * one, and — if the API or a proxy in front of it ever answers with something
 * unexpected — whatever that was. It runs inside the transport's own `done`
 * handler, so a throw there does not surface as an error message: it leaves the
 * panel showing whatever the previous search left in it, spinner still up.
 *
 * The request envelope itself is asserted in company-search-transport.test.js,
 * where the URL is now built.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const harness = require("./wc-harness");

describe("company search results", () => {
  let ctx;
  let ajax;

  beforeEach(() => {
    ctx = harness.loadTwoinc();
    harness.buildCheckoutForm();
    // Binding the panel (below, via openCompanyPanel/attach) renders its mode
    // chips, which kicks off the one page-wide supported-countries fetch —
    // irrelevant here, but real and unstubbed it hits the network and fails
    // noisily.
    ajax = harness.stubAjax(ctx.$);
  });

  afterEach(() => {
    ajax.restore();
    harness.releasePanel(ctx.helper);
    document.body.innerHTML = "";
  });

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
    test("maps every field the panel and the selection handler need", () => {
      const rows = ctx.helper.toResultItems({ items: [hit("Example Trading Co", "11111111")] });

      expect(rows).toEqual([
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
      const rows = ctx.helper.toResultItems({
        items: [hit("Alpha Example", "1"), hit("Beta Example", "2")]
      });

      expect(rows.map((r) => r.text)).toEqual(["Alpha Example", "Beta Example"]);
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
      ["an empty result set", { items: [] }]
    ])("%s yields no rows and does not throw", (_label, response) => {
      const run = () => ctx.helper.toResultItems(response);

      expect(run).not.toThrow();
      expect(run()).toEqual([]);
    });
  });

  describe("a hit with no usable national_identifier", () => {
    // `national_identifier` is optional in the search response and its `id` may
    // be null or empty, so every one of these shapes is reachable. A throw here
    // would take the whole result list down with it, so the hit renders with
    // whatever it has instead.
    test.each([
      ["national_identifier absent", { name: "Example Co", highlight: "<em>Example Co</em>" }],
      [
        "national_identifier null",
        { name: "Example Co", highlight: "<em>Example Co</em>", national_identifier: null }
      ],
      [
        "id null",
        { name: "Example Co", highlight: "<em>Example Co</em>", national_identifier: { id: null } }
      ],
      [
        "id empty",
        { name: "Example Co", highlight: "<em>Example Co</em>", national_identifier: { id: "" } }
      ]
    ])("%s renders the company without an identifier suffix", (_label, item) => {
      const run = () => ctx.helper.toResultItems({ items: [item] });

      expect(run).not.toThrow();
      expect(run()).toEqual([
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
      // The point of the guard: one unusable hit must not cost the buyer every
      // other company that matched.
      const rows = ctx.helper.toResultItems({
        items: [
          { name: "Example Co", highlight: "<em>Example Co</em>" },
          hit("Other Example Co", "22222222")
        ]
      });

      expect(rows.map((r) => r.text)).toEqual(["Example Co", "Other Example Co"]);
      expect(rows.map((r) => r.company_id)).toEqual(["", "22222222"]);
    });
  });

  describe("what the buyer sees", () => {
    let ajax;

    beforeEach(() => {
      jest.useFakeTimers();
      ajax = harness.stubAjax(ctx.$);
      harness.openCompanyPanel(ctx.$, ctx.helper);
    });

    afterEach(() => {
      ajax.restore();
      jest.clearAllTimers();
      jest.useRealTimers();
    });

    /**
     * Type into the panel's query field and settle the search it dispatches.
     * The panel binds with `addEventListener`, which jQuery's `.trigger()` does
     * not reach.
     *
     * @param {string} term
     * @param {Array<Object>} items response items
     * @returns {Promise}
     */
    function searchYielding(term, items) {
      const query = document.querySelector(".two-company-dropdown__query");
      query.value = term;
      query.dispatchEvent(new window.Event("input", { bubbles: true }));
      jest.advanceTimersByTime(ctx.helper.companySearchDebounceMs);
      ajax.last().succeed({ items: items });
      return Promise.resolve().then(() => Promise.resolve());
    }

    test("the highlighted markup renders as markup in the list", async () => {
      // The endpoint returns `highlight` as markup built from the buyer's own
      // query server-side, so the row renders it rather than escaping it.
      await searchYielding("example", [hit("Example Trading Co", "11111111")]);

      const row = document.querySelector(".two-company-dropdown__row");
      expect(row.querySelector("em").textContent).toBe("Example Trading Co");
      expect(row.textContent).toBe("Example Trading Co (11111111)");
    });

    test("the field takes the plain name, never the markup", async () => {
      await searchYielding("example", [hit("Example Trading Co", "11111111")]);

      document
        .querySelector(".two-company-dropdown__row")
        .dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, cancelable: true }));

      expect(ctx.$("#billing_company_display").val()).toBe("Example Trading Co");
      expect(ctx.$("#billing_company").val()).toBe("Example Trading Co");
      expect(ctx.$("#company_id").val()).toBe("11111111");
    });
  });
});

/**
 * TWO-25288, element 4. The one hint the company-search control shows before it
 * can search: the below-threshold message on the panel's query field.
 *
 * It is plugin-owned, translatable, and names a fixed number rather than
 * counting down the remaining characters. These pin that and the
 * single-source-of-truth wiring, not just the wording.
 */
describe("company search hints", () => {
  let ctx;

  afterEach(() => {
    if (ctx) harness.releasePanel(ctx.helper);
    document.body.innerHTML = "";
  });

  describe("the min-chars hint", () => {
    test.each([
      [undefined, undefined, "Enter 3 or more characters", "the plugin's own English msgid"],
      ["minst %d tegn", 4, "minst 4 tegn", "a localised template plus a non-default threshold"],
      ["Skriv %1$d tegn", undefined, "Skriv 3 tegn", "gettext's positional placeholder form"]
    ])("states the enforced threshold: %s / %s", (template, minLength, expected, description) => {
      // The %d reaches the browser unresolved so PHP cannot state a number the
      // control does not enforce; `%1$d` is legitimate because `#, php-format`
      // entitles a translator to reorder arguments. `template` left undefined
      // asserts against the msgid PHP registers, not a wording the harness
      // invented.
      ctx = harness.loadTwoinc(template ? { text: { company_search_too_short: template } } : {});
      if (minLength) ctx.helper.companySearchMinLength = minLength;

      expect(ctx.helper.companySearchTooShortText()).toBe(expected, description);
    });

    test("is the query field's own watermark, and states a fixed number", () => {
      // Doug 2026-08-20, live: two hints for one rule, the second sitting
      // directly beneath the field the first is in. The panel folds them into
      // one surface — the wording is ON the query input, and the results host
      // carries nothing at all until the buyer types.
      ctx = harness.loadTwoinc();
      harness.buildCheckoutForm();
      harness.openCompanyPanel(ctx.$, ctx.helper);

      const query = document.querySelector(".two-company-dropdown__query");
      expect(query.getAttribute("placeholder")).toBe("Enter 3 or more characters");
      expect(harness.resultsText(ctx.$)).toBe("");
    });

    test("a below-threshold term is answered inside the panel, not under the field", () => {
      // Where the buyer needs telling why nothing came back — and core's
      // countdown copy, which is what said "1 or more" after two keystrokes,
      // must not have crept back in.
      ctx = harness.loadTwoinc();
      harness.buildCheckoutForm();
      harness.openCompanyPanel(ctx.$, ctx.helper);

      const query = document.querySelector(".two-company-dropdown__query");
      query.value = "ab";
      query.dispatchEvent(new window.Event("input", { bubbles: true }));

      expect(harness.resultsText(ctx.$)).toBe("Enter 3 or more characters");
      expect(harness.resultsText(ctx.$)).not.toContain("1 or more");
      // One surface, inside the panel: nothing is appended beside the field.
      expect(
        document.querySelectorAll(".two-company-field-wrap > .two-company-dropdown__message")
      ).toHaveLength(0);
    });

    test("the watermark survives the panel being closed and reopened", () => {
      ctx = harness.loadTwoinc();
      harness.buildCheckoutForm();
      harness.openCompanyPanel(ctx.$, ctx.helper);

      ctx.helper.closeCompanySearchDropdown();
      ctx.helper.openCompanySearchDropdown();

      expect(
        document.querySelector(".two-company-dropdown__query").getAttribute("placeholder")
      ).toBe("Enter 3 or more characters");
    });

    test("hovers the FULL hint, not the form the field has room for", () => {
      ctx = harness.loadTwoinc();
      harness.buildCheckoutForm();
      harness.openCompanyPanel(ctx.$, ctx.helper);

      const query = document.querySelector(".two-company-dropdown__query");
      expect(query.getAttribute("title")).toBe("Enter 3 or more characters");
      expect(query.getAttribute("title")).toBe(query.getAttribute("placeholder"));
    });

    // jsdom does not lay text out, so nothing here proves the hint visibly
    // clips; it proves the declarations that do the clipping are shipped.
    test.each([
      [".two-company-dropdown__query {", "text-overflow: ellipsis;", "the input itself (Firefox)"],
      [
        ".two-company-dropdown__query::placeholder {",
        "text-overflow: ellipsis;",
        "the pseudo-element (Chrome, Safari)"
      ],
      [
        ".two-company-dropdown__query::placeholder {",
        "overflow: hidden;",
        "the pseudo-element clips"
      ],
      [
        ".two-company-dropdown__query::placeholder {",
        "white-space: nowrap;",
        "the hint stays on one line"
      ]
    ])("%s declares %s for %s", (selector, declaration) => {
      const css = fs.readFileSync(path.join(harness.REPO_ROOT, "assets/css/twoinc.css"), "utf8");
      const block = css.slice(css.indexOf(selector));

      expect(css).toContain(selector);
      expect(block.slice(0, block.indexOf("}"))).toContain(declaration);
    });
  });

  describe("the closed company field", () => {
    test("carries no watermark", () => {
      ctx = harness.loadTwoinc();
      harness.buildCheckoutForm();
      ctx.helper.attach();

      // Guard: an unattached panel would leave any placeholder assertion vacuous.
      expect(document.querySelector(".two-company-field-wrap")).not.toBeNull();
      expect(ctx.$("#billing_company_display").attr("placeholder")).toBeUndefined();
    });

    test.each([
      ["assets/js/twoinc.js", "the checkout script"],
      ["assets/js/company-search-panel.js", "the vendored panel"],
      ["class/WC_Twoinc_Checkout.php", "the localisation array"],
      ["languages/twoinc-payment-gateway.pot", "the template catalogue"],
      ["languages/twoinc-payment-gateway-nb_NO.po", "the nb_NO catalogue"],
      ["languages/twoinc-payment-gateway-nl_NL.po", "the nl_NL catalogue"],
      ["languages/twoinc-payment-gateway-sv_SE.po", "the sv_SE catalogue"]
    ])("%s keeps no trace of the removed watermark (%s)", (relPath) => {
      const source = fs.readFileSync(path.join(harness.REPO_ROOT, relPath), "utf8");

      expect(source).not.toContain("Enter company name to search");
      expect(source).not.toContain("company_search_placeholder");
    });

    test("the pay-for-order template renders a field the panel can anchor to", () => {
      // That page renders the company field from its own template rather than
      // through WooCommerce's field API, so the input shape has to be right in
      // its own markup — a `<select>` there would leave the panel with nothing
      // to write a value into.
      const markup = fs.readFileSync(
        path.join(harness.REPO_ROOT, "views/woocommerce_order_pay.php"),
        "utf8"
      );
      const field = markup.match(/<input[^>]*id="billing_company_display"[^>]*>/);

      expect(field).not.toBeNull();
      expect(field[0]).toMatch(/type="text"/);
      expect(markup).not.toMatch(/<select[^>]*id="billing_company_display"/);
    });
  });

  /**
   * `#billing_company` is POSTED WITH THE ORDER and `saveCheckoutInputs()`
   * snapshots it, so an untouched company field has to snapshot as empty.
   */
  describe("the untouched company field and the saved-input snapshot", () => {
    afterEach(() => {
      sessionStorage.clear();
      jest.useRealTimers();
    });

    /**
     * Attach the panel to the real form, then snapshot the form the way the
     * plugin does at page load.
     *
     * @returns {Object} the snapshot entry for the company-search field
     */
    function snapshotUntouchedField() {
      ctx = harness.loadTwoinc();
      harness.buildCheckoutForm();
      ctx.helper.attach();

      // Guard: an unattached panel means the rest of this asserts nothing.
      expect(document.querySelector(".two-company-field-wrap")).not.toBeNull();

      ctx.dom.saveCheckoutInputs();
      const saved = JSON.parse(sessionStorage.getItem("checkoutInputs"));

      // Guard: the snapshot has to have found the checkout form at all. It
      // looks the form up by `form[name="checkout"]`, so a harness form missing
      // that attribute would take the early return and leave every assertion
      // below vacuously true.
      expect(saved).not.toHaveLength(0);

      return saved.find((inp) => inp.id === "billing_company_display");
    }

    test("is not snapshotted as the buyer's company name", () => {
      const entry = snapshotUntouchedField();

      expect(entry).toBeDefined();
      expect(entry.val).toBe("");
    });

    test("survives a restore from storage without being written into the field", () => {
      snapshotUntouchedField();
      jest.useFakeTimers();
      ctx.dom.loadStorageInputs();
      // The restore path defers part of its work a second.
      jest.advanceTimersByTime(2000);

      expect(ctx.$("#billing_company_display").val()).toBe("");
    });

    test("is not what getCompanyName and getCompanyData report", () => {
      snapshotUntouchedField();

      expect(ctx.helper.getCompanyName()).toBe("");
      expect(ctx.dom.getCompanyData().company_name).toBe("");
    });

    test("is not written into the company field posted with the order", async () => {
      // Real timers, awaited: jQuery runs its ready callbacks — the bootstrap
      // that reads the snapshot among them — on a macrotask, which fake timers
      // installed first would freeze before it registers anything.
      snapshotUntouchedField();
      await new Promise((resolve) => setTimeout(resolve, 1200));

      expect(ctx.$("#billing_company").val()).toBe("");
      expect(ctx.$("#billing_company").val()).not.toContain("Enter company name");
    });

    test("gives way to a real selection once the buyer picks a company", () => {
      // The mirror image: the fix must not blank a field that legitimately
      // holds a chosen company, which is the snapshot's whole purpose.
      ctx = harness.loadTwoinc();
      harness.buildCheckoutForm();
      ctx.capture.write("Example Trading Co", "11111111", { country: "GB" });
      ctx.helper.attach();
      ctx.dom.saveCheckoutInputs();

      expect(ctx.helper.getCompanyName()).toBe("Example Trading Co");
      expect(ctx.$("#billing_company_display").val()).toBe("Example Trading Co");
    });
  });

  describe("the strings PHP registers", () => {
    // The keys are the contract between the checkout's localisation array and
    // the helper functions above, and nothing else in the suite can see both
    // sides: a renamed key would leave the browser silently falling back to the
    // untranslated English and every other test here still passing.
    const checkout = fs.readFileSync(
      path.join(harness.REPO_ROOT, "class/WC_Twoinc_Checkout.php"),
      "utf8"
    );

    test.each([
      ["company_search_too_short", "Enter %d or more characters"],
      ["company_search_unavailable", "Company search is temporarily unavailable. Please try again."]
    ])("%s is registered as a translatable string", (key, source) => {
      const entry = new RegExp(
        "'" + key + "' *=> *__\\('" + source.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&") + "'"
      );

      expect(checkout).toMatch(entry);
    });

    test("leaves the min-chars placeholder for the browser to resolve", () => {
      // A %d resolved in PHP would drift from the constant the control enforces.
      // Asserted positively as well as negatively: a sprintf() wrapped around
      // the string leaves the source literal reading "%d" either way.
      expect(checkout).not.toMatch(/'company_search_too_short' *=> *__\('Please enter \d/);
      const emitted = checkout.match(/'company_search_too_short' *=> *([^\n]*),\n/);

      expect(emitted).not.toBeNull();
      expect(emitted[1]).toContain("%d");
      expect(emitted[1]).not.toMatch(/sprintf|number_format|str_replace/);
    });
  });
});
