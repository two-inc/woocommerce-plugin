/**
 * TWO-25288. The read-only summary of the captured company.
 *
 * The design this replaces showed the organisation number as a grey overlay
 * floating over the picker's selection box, with an x-button beside it that
 * deleted the captured company. The reversal: name AND number, both shown as
 * text, in one place, for every capture mode, with nothing to type into and
 * nothing that removes them.
 *
 * So what is worth asserting here is mostly negative — the absence of an
 * editable or removing control — plus the three capture modes rendering the
 * right pair of values. The submitted fields are checked alongside, because
 * "read-only" must mean the buyer cannot edit the display, NOT that the values
 * stopped being posted: `#billing_company` and `#company_id` are the inputs
 * WooCommerce serialises, and the summary is a sibling of them, not a
 * replacement for them.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const harness = require("./wc-harness");

/** @returns {string} the raw twoinc.css source */
function stylesheetSource() {
  return fs.readFileSync(path.join(harness.REPO_ROOT, harness.STYLESHEET_PATH), "utf8");
}

const GATEWAY_ID = "woocommerce-gateway-tillit";

describe("read-only captured-company summary", () => {
  let ctx;
  let $;
  let dom;

  beforeEach(() => {
    ctx = harness.loadTwoinc({
      gateway_id: GATEWAY_ID,
      supported_buyer_countries: ["GB"],
      enable_company_search: "yes",
      enable_company_search_for_others: "yes",
      enable_address_lookup: "no",
      text: {}
    });
    $ = ctx.$;
    dom = ctx.dom;
    harness.buildCheckoutForm();
    selectTwo();
  });

  afterEach(() => {
    harness.releaseWidgets($);
    document.body.innerHTML = "";
  });

  /**
   * Add the payment-method radio and check it.
   *
   * The summary is gated on Two being the chosen method — a buyer paying by
   * another gateway may well have typed a company name into WooCommerce's own
   * field — and `isTwoincSelected()` reads that radio, so without this every
   * assertion below would be checking a permanently hidden element.
   *
   * @returns {void}
   */
  function selectTwo() {
    $("form[name='checkout']").append(
      '<input type="radio" name="payment_method" value="' + GATEWAY_ID + '" checked />'
    );
  }

  /** @returns {Object} the summary element, or an empty set */
  function summary() {
    return $("#" + dom.companySummaryId);
  }

  /** @returns {string} the rendered company name */
  function renderedName() {
    return summary().find(".twoinc-company-summary-name").text();
  }

  /** @returns {string} the rendered organisation number */
  function renderedNumber() {
    return summary().find(".twoinc-company-summary-id").text();
  }

  /** @returns {boolean} whether the summary is currently shown */
  function isShown() {
    return summary().length > 0 && !summary().hasClass("hidden");
  }

  /**
   * Pick a company the way the picker's own select handler does.
   *
   * Driven through `enableCompanySearch`'s real `select2:select` binding rather
   * than by calling the render function: the point of the test is that picking
   * a company renders the summary, and a direct call would pass even if the
   * handler had never been wired to it.
   *
   * @param {string} name the company name (the picker's `data.id`)
   * @param {string} companyId the organisation number
   * @returns {void}
   */
  function pickCompany(name, companyId) {
    const ajax = harness.stubAjax($);
    ctx.Twoinc.getInstance().enableCompanySearch();
    // The <option> select2's array adapter appends for the chosen result, and
    // leaves behind on destroy. Modelled explicitly because the event below is
    // dispatched rather than driven through a real result list, and its being
    // left behind is the whole subject of the resurrection tests further down —
    // without it those tests assert against a select that was never populated.
    $("#billing_company_display").append(
      '<option value="' + name + '" selected>' + name + "</option>"
    );
    $("#billing_company_display").trigger({
      type: "select2:select",
      params: { data: { id: name, company_id: companyId } }
    });
    ajax.restore();
  }

  describe("company search", () => {
    test("renders the picked company's name and number", () => {
      pickCompany("ACME Widgets Ltd", "12345678");

      expect(isShown()).toBe(true);
      expect(renderedName()).toBe("ACME Widgets Ltd");
      expect(renderedNumber()).toBe("12345678");
    });

    test("survives a re-render with no sessionStorage snapshot behind it", () => {
      // The summary's no-argument path used to go through getCompanyData(),
      // which in search mode reads the company name out of the `checkoutInputs`
      // sessionStorage snapshot — refreshed on a 3-second interval, and absent
      // entirely until the first save. So a re-render showed the name as it was
      // up to three seconds ago, or blanked it and hid the summary, while the
      // number (read live) stayed. Switching payment method away and back is
      // enough to trigger one, via toggleBusinessFields.
      pickCompany("ACME Widgets Ltd", "12345678");
      sessionStorage.removeItem("checkoutInputs");

      dom.toggleBusinessFields();

      expect(isShown()).toBe(true);
      expect(renderedName()).toBe("ACME Widgets Ltd");
      expect(renderedNumber()).toBe("12345678");
    });

    test("the picked values are still the posted ones", () => {
      // The summary is a display beside the fields, not instead of them. If it
      // ever became the only carrier of the identity, the order would reach
      // WooCommerce with no company on it at all.
      pickCompany("ACME Widgets Ltd", "12345678");

      expect($("#billing_company").val()).toBe("ACME Widgets Ltd");
      expect($("#company_id").val()).toBe("12345678");

      // And re-rendering must not disturb them.
      dom.renderCompanySummary();
      expect($("#billing_company").val()).toBe("ACME Widgets Ltd");
      expect($("#company_id").val()).toBe("12345678");
    });

    test("nothing inside the summary posts a value of its own", () => {
      pickCompany("ACME Widgets Ltd", "12345678");

      // A `name` attribute anywhere in here would be serialised by
      // WooCommerce's checkout form alongside the real fields.
      expect(summary().find("[name]").length).toBe(0);
      expect($("form[name='checkout']").serialize()).not.toContain("twoinc_company_summary");
    });

    test("a company carrying no organisation number renders its name alone", () => {
      // The organisation number is optional on a registry hit; the name is not.
      pickCompany("ACME Widgets Ltd", "");

      expect(isShown()).toBe(true);
      expect(renderedName()).toBe("ACME Widgets Ltd");
      expect(renderedNumber()).toBe("");
    });
  });

  describe("number rendered below the name, right-aligned, not sharing its line (#30.x.9)", () => {
    // Reported live: picking a search result left the company number
    // effectively invisible. Root cause was layout, not logic — the number
    // used to sit on the SAME line as the name, `margin-left: 8px` away from
    // it, `white-space: nowrap`. A long company name pushed it toward, and
    // on a narrow viewport past, the right edge of the summary's own box.
    // Doug's canonical cross-platform ruling: the number gets its own row,
    // immediately below the name, right-aligned to the input's right edge —
    // so it can never again compete with the name for the same horizontal
    // space regardless of how long the name is.
    test("the number is a block of its own, not inline with the name", () => {
      harness.injectStylesheet();
      pickCompany("A Very Long International Holdings Group Company Ltd", "12345678");

      const nameStyle = window.getComputedStyle(summary().find(".twoinc-company-summary-name")[0]);
      const idStyle = window.getComputedStyle(summary().find(".twoinc-company-summary-id")[0]);

      expect(nameStyle.display).toBe("block");
      expect(idStyle.display).toBe("block");
      expect(idStyle.textAlign).toBe("end");
    });

    test("the summary box carries WooCommerce core's own form-row padding, so the id lines up with the input's real edge (round 2 review — Vader)", () => {
      // Mutation-caught gap: deleting `padding-left`/`padding-right` from
      // `.twoinc-company-summary` (round 1's fix for the ~3px offset
      // against the input) passed the full suite with nothing to catch it.
      // Asserted against computed style, not a stylesheet-source regex —
      // the `[^}]*` capture used elsewhere in this file terminates early on
      // the `}` inside this rule's own CSS *comment* (`.form-row { padding:
      // 3px }`), so a naive regex test would silently pass regardless of
      // what the rule actually declares.
      harness.injectStylesheet();
      pickCompany("ACME Widgets Ltd", "12345678");

      const summaryStyle = window.getComputedStyle(summary()[0]);
      expect(summaryStyle.paddingLeft).toBe("3px");
      expect(summaryStyle.paddingRight).toBe("3px");
    });

    test("the id element carries no same-line margin from the name any more", () => {
      // The old inline layout's `margin-left: 8px` on the id is exactly what
      // let it be squeezed off the visible line by a long name. Asserted
      // directly against the shipped rule, not just the computed style,
      // because jsdom does not lay out real text wrapping to prove the
      // collision — the CSS declaration itself is the fix.
      const m = /\.twoinc-company-summary-id\s*\{([^}]*)\}/.exec(stylesheetSource());
      expect(m).not.toBeNull();
      expect(m[1]).not.toMatch(/margin-left/);
      expect(m[1]).toMatch(/text-align:\s*end/);
      expect(m[1]).toMatch(/display:\s*block/);
    });

    test("neither the name nor the id can overflow past the row on a single unbroken token", () => {
      // Round 1 review (Vader): the block-row fix stops the NUMBER competing
      // with the name for space, but does nothing on its own for a single
      // unbroken token — routine in DE/NL/NO registry names — which would
      // otherwise overflow the row horizontally instead of wrapping.
      const nameBody = /\.twoinc-company-summary-name\s*\{([^}]*)\}/.exec(stylesheetSource());
      const idBody = /\.twoinc-company-summary-id\s*\{([^}]*)\}/.exec(stylesheetSource());
      expect(nameBody).not.toBeNull();
      expect(idBody).not.toBeNull();
      expect(nameBody[1]).toMatch(/overflow-wrap:\s*anywhere/);
      expect(idBody[1]).toMatch(/overflow-wrap:\s*anywhere/);
      // The old nowrap protected the (inline, same-line) id from wrapping
      // onto an ugly second line — but now that it has its own row, nowrap
      // would instead let an exceptionally long identifier run past the
      // row's edge, invisible, which is the exact bug this PR fixes.
      expect(idBody[1]).not.toMatch(/white-space:\s*nowrap/);
    });
  });

  describe("pay-for-order page: number stays aligned with the name, not the full-width row (#30.x.9)", () => {
    // Round 1 review (Han): that page lays the company fields out as
    // flex-wrap items and gives the summary `flex-basis: 100%` — a
    // full-page-width row, unlike the checkout page where the summary is
    // only as wide as the (narrower) field above it. Right-aligning the id
    // against that full width would detach it from the actual input, which
    // sits centred between the two. Assert the override lands.
    test("the id's alignment is overridden back to the leading edge on .custom-checkout", () => {
      const m = /\.custom-checkout\s+\.twoinc-company-summary-id\s*\{([^}]*)\}/.exec(
        stylesheetSource()
      );
      expect(m).not.toBeNull();
      expect(m[1]).toMatch(/text-align:\s*start/);
    });

    test("the override actually wins the cascade, not just exists in source (round 2 review — Han)", () => {
      // The regex test above only proves the rule EXISTS, not that it WINS.
      // Both the general `.twoinc-company-summary-id` rule and this
      // `.custom-checkout` override are live in the same stylesheet — if a
      // future edit ever reordered them so the general rule landed after
      // the override in source, `text-align` would resolve to "end" here
      // regardless of what this file's regex still matches. Render the
      // summary inside a `.custom-checkout` ancestor and read the actual
      // computed value.
      harness.injectStylesheet();
      pickCompany("ACME Widgets Ltd", "12345678");
      summary().wrap('<div class="custom-checkout"></div>');

      const idStyle = window.getComputedStyle(summary().find(".twoinc-company-summary-id")[0]);
      expect(idStyle.textAlign).toBe("start");
    });
  });

  describe("manual entry", () => {
    /**
     * Type a company name the way the buyer does in manual entry, and let the
     * checkout re-render.
     *
     * `toggleBusinessFields` is the re-render entry point, not a test hook: it
     * runs on every payment-method, country and capture-mode switch, and it is
     * production code. The `change` handler that also re-renders is installed
     * by `Twoinc.initialize`, whose bootstrap (intervals, order-intent polling)
     * this suite deliberately does not stand up — see wc-harness.
     *
     * @param {string} name what the buyer typed
     * @returns {void}
     */
    function typeCompanyName(name) {
      $("#billing_company").val(name);
      dom.toggleBusinessFields();
    }

    test("renders the typed name with no number", () => {
      // Manual entry is reached with a company already picked, which is the
      // case that used to leave the disowned company's number on screen.
      pickCompany("ACME Widgets Ltd", "12345678");
      expect(renderedNumber()).toBe("12345678");

      dom.enterManualCompanyEntry();
      typeCompanyName("Sole Proprietor Bakery");

      expect(isShown()).toBe(true);
      expect(renderedName()).toBe("Sole Proprietor Bakery");
      // enterManualCompanyEntry clears #company_id: the buyer has said the
      // registry company is not theirs, so its number must not survive.
      expect(renderedNumber()).toBe("");
      expect($("#company_id").val()).toBe("");
    });

    test("what is displayed is what gets posted", () => {
      dom.enterManualCompanyEntry();
      typeCompanyName("Sole Proprietor Bakery");

      // The posted field on its own would be vacuous here — typeCompanyName is
      // what set it. The pairing is the assertion: the summary renders the same
      // string the checkout will post, not a copy that can drift from it.
      expect(renderedName()).toBe("Sole Proprietor Bakery");
      expect($("#billing_company").val()).toBe(renderedName());
    });

    test("the blur handler picks up a number the buyer supplies themselves", () => {
      // On this platform manual entry keeps its own organisation-number field
      // (toggleBusinessFields reveals and requires `#company_id_field`), so
      // "blank" above means "not carried over from the abandoned pick", not
      // "unobtainable".
      //
      // The handler is invoked directly rather than by dispatching a blur: the
      // `$body.on("blur", "#company_id", …)` delegation is installed by
      // Twoinc.initialize, whose bootstrap this suite does not stand up. So
      // this covers the handler's body, NOT that it is wired to the event —
      // hence the test name.
      const ajax = harness.stubAjax($);
      dom.enterManualCompanyEntry();
      typeCompanyName("Sole Proprietor Bakery");

      $("#company_id").val("55554444");
      ctx.Twoinc.prototype.onCompanyManualInputBlur.call($("#company_id")[0]);

      expect(renderedName()).toBe("Sole Proprietor Bakery");
      expect(renderedNumber()).toBe("55554444");
      ajax.restore();
    });
  });

  describe("sole trader", () => {
    test("renders the name and number held for the buyer", () => {
      ctx.soleTrader.setCompany("99887766", "Jo Bloggs Trading");

      expect(isShown()).toBe(true);
      expect(renderedName()).toBe("Jo Bloggs Trading");
      expect(renderedNumber()).toBe("99887766");
      expect($("#billing_company").val()).toBe("Jo Bloggs Trading");
      expect($("#company_id").val()).toBe("99887766");
    });
  });

  describe("it is genuinely read-only", () => {
    test("there is no field in it to type into", () => {
      pickCompany("ACME Widgets Ltd", "12345678");

      expect(summary().find("input, select, textarea, [contenteditable]").length).toBe(0);
      // Both values live in elements a user cannot put a caret in.
      expect(summary().find(".twoinc-company-summary-name").prop("tagName")).toBe("SPAN");
      expect(summary().find(".twoinc-company-summary-id").prop("tagName")).toBe("SPAN");
    });

    test("there is no control in it that removes the captured company", () => {
      pickCompany("ACME Widgets Ltd", "12345678");

      // The x-button this replaces was an <img> with an inline onclick. Assert
      // the shape, not the one element: any button, link, image or click
      // handler in here is the affordance the reversal removes.
      expect(summary().find("button, a, img, [onclick], [role='button']").length).toBe(0);
      expect(
        summary()
          .find("*")
          .filter(function () {
            return $._data(this, "events") !== undefined;
          }).length
      ).toBe(0);
      expect($._data(summary()[0], "events")).toBeUndefined();
    });

    test("nothing in it can be tabbed to", () => {
      pickCompany("ACME Widgets Ltd", "12345678");

      // Guard: `.find()` on an empty set is empty, so without this the
      // assertion below holds just as well on a page with no summary at all.
      expect(summary().length).toBe(1);
      const focusable = summary()
        .find("[tabindex]")
        .filter(function () {
          return Number($(this).attr("tabindex")) >= 0;
        });
      expect(focusable.length).toBe(0);
    });
  });

  describe("visibility", () => {
    test("absent from the page until something is captured", () => {
      // Prove the mechanism is live in this test before asserting the absence,
      // so the assertion cannot pass merely because nothing ever ran.
      dom.renderCompanySummary("ACME Widgets Ltd", "12345678");
      expect(isShown()).toBe(true);

      dom.renderCompanySummary("", "");
      expect(isShown()).toBe(false);
    });

    test("hidden when the buyer is paying by another method", () => {
      pickCompany("ACME Widgets Ltd", "12345678");
      expect(isShown()).toBe(true);

      $('input[name="payment_method"]').prop("checked", false);
      dom.renderCompanySummary();

      expect(isShown()).toBe(false);
      // Still rendered, just not shown — and the fields still post.
      expect($("#billing_company").val()).toBe("ACME Widgets Ltd");
    });

    test("cleared when the captured company is cleared, and stays cleared", () => {
      jest.useFakeTimers();
      pickCompany("ACME Widgets Ltd", "12345678");
      expect(isShown()).toBe(true);

      dom.clearSelectedCompany();

      expect(isShown()).toBe(false);
      expect(renderedName()).toBe("");
      expect(renderedNumber()).toBe("");

      // clearSelectedCompany re-reads the inputs 3s later and re-renders, and
      // every later payment-method or country switch re-renders too. Both used
      // to bring the cleared company back on screen, because #billing_company
      // still held it — the field WooCommerce posts. Asserting only the
      // synchronous clear is what let that through.
      jest.advanceTimersByTime(3500);
      expect(isShown()).toBe(false);
      expect(renderedName()).toBe("");

      dom.toggleBusinessFields();
      expect(isShown()).toBe(false);
      expect(renderedName()).toBe("");
      // And the cleared company is not posted either.
      expect($("#billing_company").val()).toBe("");
      expect($("#company_id").val()).toBe("");
      jest.useRealTimers();
    });

    test("the picker's empty placeholder is not rendered as a name", () => {
      // The empty option's label is U+00A0, not a plain space: truthy,
      // invisible, and rendered as a company by anything that only checks for
      // "". Written as the escape rather than pasted in, so neither a reader
      // nor an editor has to tell the two space characters apart — pasted, it
      // was mistaken for U+0020 in review.
      dom.renderCompanySummary("\u00a0", "");

      expect(renderedName()).toBe("");
      expect(isShown()).toBe(false);

      // And through the live read, against the real unselected state: the empty
      // option's VALUE is "" — the non-breaking space is only its label, which
      // is why the live read cannot see one and the guard above is defensive.
      $("#billing_company").val("");
      expect($("#billing_company_display").val()).toBe("");
      dom.renderCompanySummary();

      expect(renderedName()).toBe("");
      expect(isShown()).toBe(false);
    });
  });

  describe("a company that is no longer captured stays off screen", () => {
    test("the sole-trader round trip does not resurrect the picked company", () => {
      // The picker appends an <option> to #billing_company_display for every
      // pick, and neither select2("destroy") nor the clearing setCompany("", "")
      // removes it. So after search → sole trader → back to business, that
      // select still held the company while both posted fields were empty. A
      // summary that read the select back showed a company the order did not
      // carry.
      const ajax = harness.stubAjax($);
      pickCompany("ACME Widgets Ltd", "12345678");
      expect(isShown()).toBe(true);

      ctx.soleTrader.setMode("sole_trader");
      ctx.soleTrader.setMode("business");

      expect($("#billing_company").val()).toBe("");
      expect($("#company_id").val()).toBe("");
      expect($("#billing_company_display").val()).toBe("");
      expect(renderedName()).toBe("");
      expect(isShown()).toBe(false);
      ajax.restore();
    });

    test("the summary never shows a name the checkout is not posting", () => {
      // The invariant behind the test above, asserted directly: whatever is on
      // screen is what #billing_company holds. Stale options on the display
      // select are exactly what used to break it.
      const ajax = harness.stubAjax($);
      pickCompany("ACME Widgets Ltd", "12345678");
      $("#billing_company").val("");
      $("#company_id").val("");

      dom.renderCompanySummary();

      // The stale option is still on the select — that is the point.
      expect($("#billing_company_display").val()).toBe("ACME Widgets Ltd");
      expect(renderedName()).toBe("");
      expect(isShown()).toBe(false);
      ajax.restore();
    });
  });

  describe("the restored-from-user-meta path", () => {
    test("renders both values even though #company_id is written afterwards", () => {
      // loadUserMetaInputs fills the select first, calls the summary, and only
      // then writes #company_id. A summary that read the DOM at that moment
      // would show the name with an empty number.
      ctx.twoinc.billing_company = "ACME Widgets Ltd";
      ctx.twoinc.company_id = "12345678";
      $("#company_id").val("");

      dom.loadUserMetaInputs();

      expect(renderedName()).toBe("ACME Widgets Ltd");
      expect(renderedNumber()).toBe("12345678");
      expect($("#company_id").val()).toBe("12345678");
    });
  });
});
