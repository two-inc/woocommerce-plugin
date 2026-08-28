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

  beforeEach(() => {
    ctx = harness.loadTwoinc();
    harness.buildCheckoutForm();
  });

  afterEach(() => {
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
 * TWO-25288, elements 3 and 4. The two hints the company-search control shows
 * before it can search: one on the closed company field, one while the typed
 * term is below the threshold.
 *
 * Both strings are plugin-owned and translatable, and the min-chars one names a
 * fixed number rather than counting down the remaining characters. These pin
 * that and the single-source-of-truth wiring, not just the wording.
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
  });

  describe("the empty-field hint", () => {
    test("is what the closed company field renders", () => {
      // Set by the panel rather than left to the host form: core renders this
      // field with no placeholder at all, so nothing would say what clicking it
      // does.
      ctx = harness.loadTwoinc();
      harness.buildCheckoutForm();
      ctx.helper.attach();

      expect(ctx.$("#billing_company_display").attr("placeholder")).toBe(
        "Enter company name to search"
      );
    });

    test("uses the localised string when PHP supplies one", () => {
      ctx = harness.loadTwoinc({ text: { company_search_placeholder: "Zoek een bedrijf" } });
      harness.buildCheckoutForm();
      ctx.helper.attach();

      expect(ctx.$("#billing_company_display").attr("placeholder")).toBe("Zoek een bedrijf");
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
   * The empty-field hint must never be mistaken for a company the buyer chose:
   * `#billing_company` is POSTED WITH THE ORDER, and `saveCheckoutInputs()`
   * snapshots it. A `placeholder` attribute leaves that snapshot nothing to
   * read.
   */
  describe("the empty-field hint and the saved-input snapshot", () => {
    afterEach(() => {
      sessionStorage.clear();
      jest.useRealTimers();
    });

    /**
     * Attach the panel to the real form so the hint is rendered, then snapshot
     * the form the way the plugin does at page load.
     *
     * @returns {Object} the snapshot entry for the company-search field
     */
    function snapshotUntouchedField() {
      ctx = harness.loadTwoinc();
      harness.buildCheckoutForm();
      ctx.helper.attach();

      // Guard: no rendered hint means the rest of this asserts nothing.
      expect(ctx.$("#billing_company_display").attr("placeholder")).toBe(
        "Enter company name to search"
      );

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
      expect(ctx.$("#billing_company_display").attr("placeholder")).toBe(
        "Enter company name to search"
      );
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
      ["company_search_placeholder", "Enter company name to search"],
      ["company_search_too_short", "Enter %d or more characters"]
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
