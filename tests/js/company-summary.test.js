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
  let helper;

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
    helper = ctx.helper;
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

    // The payment tile, minimally. The captured company now renders INSIDE the
    // intent-approved notice's own sentence (TWO-25326 §7.2/§7.3, ruling
    // 2026-08-03) rather than in a separate label element — the
    // now-removed `.twoinc-company-tile-label` — so without this notice
    // element every tile-text assertion below would be checking an element
    // that does not exist. Deliberately outside the billing field wrapper,
    // which is what the address-area assertions are scoped to.
    //
    // The template is deliberately just the bare token, and the fallback text
    // a distinctive marker: this suite's tile assertions care about WHICH
    // string is on screen (raw company text vs. the served fallback), not
    // about a production sentence's wording — that belongs to
    // WC_Twoinc.php's own tests.
    $(document.body).append(
      '<li class="wc_payment_method"><div class="payment_box">' +
        '<div class="twoinc-pay-box twoinc-intent-approved hidden" ' +
        'data-company-template="{company}">' +
        "NO_COMPANY_APPROVED" +
        "</div>" +
        '<div class="twoinc-pay-box twoinc-err-payment-default hidden" ' +
        'data-company-template="{company}">' +
        "NO_COMPANY_DECLINED" +
        "</div>" +
        "</div></li>"
    );

    // Intent approved is this suite's baseline state, because it is the only
    // state in which the tile carries any company text at all. Tests about
    // WHEN it shows live in their own describe block below and drive the
    // notice themselves; everything else here is about WHAT it renders, and
    // would be asserting against a permanently hidden element without this.
    approveIntent();
  }

  /**
   * Put the tile into the intent-approved state — the notice on screen, and
   * so the label with it.
   *
   * @returns {void}
   */
  function approveIntent() {
    dom.togglePaySubtitleDesc("intent-approved");
  }

  /** @returns {Object} the payment tile's intent-approved notice */
  function intentNotice() {
    return $(".twoinc-pay-box.twoinc-intent-approved");
  }

  /** @returns {boolean} whether the intent-approved notice is on screen */
  function intentShown() {
    return intentNotice().length > 0 && !intentNotice().hasClass("hidden");
  }

  /** @returns {Object} the summary element, or an empty set */
  function summary() {
    return $("#" + helper.companySummaryId);
  }

  /**
   * @returns {string} the intent-approved notice's own text, `<name>
   *   (<number>)` when shown with a company substituted in — this is where
   *   the now-removed `.twoinc-company-tile-label` used to render it
   *   (TWO-25326 §7.2/§7.3).
   */
  function tileText() {
    return intentNotice().hasClass("hidden") ? "" : intentNotice().text();
  }

  /**
   * The captured company NAME, read straight off the posted field.
   *
   * Used to render in a `.twoinc-company-summary-name` span under the
   * company field; TWO-25326 §7 removed it from there — it was a second copy
   * of what the company-name control immediately above already shows. It then
   * briefly lived in the payment tile's `.twoinc-company-tile-label`
   * (PR #431) before that too was removed and replaced with the company
   * embedded directly in the intent-message sentences (§7.2/§7.3, ruling
   * 2026-08-03) — which only render it while an intent check has actually
   * run. Reading `#billing_company` directly is what makes this assertion
   * independent of that: it is the one thing every capture mode always
   * writes, tile state notwithstanding, and it is also literally what
   * WooCommerce posts — which is the property these tests care about.
   *
   * @returns {string}
   */
  function renderedName() {
    return $("#billing_company").val();
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
    test("renders the picked company's number under the field and its name in the tile", () => {
      pickCompany("ACME Widgets Ltd", "12345678");

      // Picking a company invalidates the intent that was approved for the
      // PREVIOUS one, so the pick itself takes the notice back off screen —
      // and its embedded company text with it (TWO-25326 §7.2/§7.3, ruling 2026-08-03). That is the
      // behaviour, not a harness quirk; re-approve to get back to the state
      // this test is about, which is what the notice renders once shown.
      approveIntent();

      expect(isShown()).toBe(true);
      expect(renderedNumber()).toBe("12345678");
      expect(renderedName()).toBe("ACME Widgets Ltd");
      expect(tileText()).toBe("ACME Widgets Ltd (12345678)");
    });

    test("the name does NOT render anywhere in the address area (TWO-25326 §7)", () => {
      // Doug's finding, live 2026-08-02: the address area showed the company
      // name twice — once in the company-name control the buyer picked it in,
      // and again in this block underneath. §7 allows the company-name field
      // and the number label below it, and nothing else.
      pickCompany("ACME Widgets Ltd", "12345678");

      expect(summary().find(".twoinc-company-summary-name").length).toBe(0);
      expect(summary().text()).not.toContain("ACME Widgets Ltd");
      expect(summary().text()).toBe("12345678");
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

      // The re-render clears the intent state (toggleBusinessFields calls
      // togglePaySubtitleDesc with no action), which hides the notice and the
      // label together — correct, since nothing is approved mid-re-render.
      // Re-approve: the question here is whether the NAME survives the
      // re-render, and the label has to be on screen to answer it.
      approveIntent();

      expect(isShown()).toBe(true);
      expect(renderedName()).toBe("ACME Widgets Ltd");
      expect(renderedNumber()).toBe("12345678");
      expect(tileText()).toBe("ACME Widgets Ltd (12345678)");
    });

    test("the picked values are still the posted ones", () => {
      // The summary is a display beside the fields, not instead of them. If it
      // ever became the only carrier of the identity, the order would reach
      // WooCommerce with no company on it at all.
      pickCompany("ACME Widgets Ltd", "12345678");

      expect($("#billing_company").val()).toBe("ACME Widgets Ltd");
      expect($("#company_id").val()).toBe("12345678");

      // And re-rendering must not disturb them.
      helper.renderCompanySummary();
      expect($("#billing_company").val()).toBe("ACME Widgets Ltd");
      expect($("#company_id").val()).toBe("12345678");
    });

    test("self-heals its position after WooCommerce core's own field resort (#30.x.9, found by live post-merge verification)", () => {
      // Reported live: after picking a company, the summary rendered ABOVE
      // the company field instead of below it. Root cause, documented in
      // WC_Twoinc_Checkout.php above move_country_field(): WooCommerce
      // core's own address-i18n.js detaches and re-appends every
      // `.form-row` in the billing wrapper by priority, on EVERY checkout
      // load — not only on country change. This summary is a plain <div>,
      // not a `.form-row`, so it never takes part in that resort; the OLD
      // code positioned it once on first creation and never again, so once
      // WC moved the real fields past it, it stayed stranded above all of
      // them for the rest of the page's life.
      pickCompany("ACME Widgets Ltd", "12345678");
      expect(summary().prev().is("#company_id_field")).toBe(true);

      // Simulate WC's own resort: detach the real fields and re-append them
      // AFTER the summary — exactly what `rows.detach().appendTo(wrapper)`
      // does, and exactly the shape of the reported bug (summary now
      // precedes the fields it's meant to sit below).
      const $form = $("form[name='checkout']");
      $("#billing_company_display_field, #billing_company_field, #company_id_field")
        .detach()
        .appendTo($form);
      const children = () => $form.children().toArray();
      const indexOf = (sel) => children().indexOf($(sel)[0]);
      expect(indexOf("#" + helper.companySummaryId)).toBeLessThan(
        indexOf("#billing_company_display_field")
      );

      // Any subsequent render (payment-method switch, country change,
      // another pick — toggleBusinessFields is the common path for all of
      // them) must snap the summary back into place, not leave it stranded.
      helper.renderCompanySummary();

      expect(summary().prev().is("#company_id_field")).toBe(true);
      expect(indexOf("#" + helper.companySummaryId)).toBeGreaterThan(
        indexOf("#billing_company_display_field")
      );
    });

    test("does not physically move the node when it is already correctly positioned (round 1 review — Han)", () => {
      // Repositioning unconditionally on every call — the first version of
      // this fix — physically detaches and re-inserts the node even when
      // nothing has drifted, which collapses any text selection inside the
      // summary (the only interaction this read-only display affords is
      // selecting the org number to copy it) and forces an avoidable
      // reflow. Guarded on `$node.prev()` matching the anchor: spy on
      // jQuery's own `insertAfter` and assert it is NOT called on an
      // ordinary re-render once the summary is already positioned right —
      // a plain node-identity check can't tell "moved but same reference"
      // from "never touched", since jQuery never clones the element either
      // way.
      pickCompany("ACME Widgets Ltd", "12345678");

      const insertAfterSpy = jest.spyOn($.fn, "insertAfter");
      helper.renderCompanySummary();

      expect(insertAfterSpy).not.toHaveBeenCalled();
      insertAfterSpy.mockRestore();
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

      // The pick invalidated the previous intent; re-approve so the tile's
      // company text is on screen to be read (see the first test in this
      // block).
      approveIntent();

      // No number means no number label at all — not an empty one taking up a
      // row under the field (TWO-25326 §5).
      expect(isShown()).toBe(false);
      expect(renderedNumber()).toBe("");

      // The tile drops the parenthesised number rather than rendering
      // `ACME Widgets Ltd ()`, which would read as a rendering fault.
      expect(tileText()).toBe("ACME Widgets Ltd");
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

      const idStyle = window.getComputedStyle(summary().find(".twoinc-company-summary-id")[0]);

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
      const idBody = /\.twoinc-company-summary-id\s*\{([^}]*)\}/.exec(stylesheetSource());
      expect(idBody).not.toBeNull();
      expect(idBody[1]).toMatch(/overflow-wrap:\s*anywhere/);

      // The name rule is gone with the name span (TWO-25326 §7); the same
      // protection now has to be on the intent-message boxes, which carry the
      // company text directly (§7.2/§7.3) and are narrower than the address
      // column, so they need it more.
      expect(stylesheetSource()).not.toMatch(/\.twoinc-company-summary-name\s*\{/);
      const tileBody =
        /\.twoinc-pay-box\.twoinc-intent-approved,\s*\n\.twoinc-pay-box\.twoinc-err-payment-default\s*\{([^}]*)\}/.exec(
          stylesheetSource()
        );
      expect(tileBody).not.toBeNull();
      expect(tileBody[1]).toMatch(/overflow-wrap:\s*anywhere/);
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
      // The regex test above only proves the rule EXISTS, not that it WINS
      // against a real rendered element. `.custom-checkout
      // .twoinc-company-summary-id` outranks the bare `.twoinc-company-
      // summary-id` on specificity (0,2,0 vs 0,1,0) regardless of source
      // order, so this isn't guarding against reordering — it's guarding
      // against the override rule silently stopping applying at all (typo'd
      // selector, wrong class, etc.), which a source-only regex can't catch.
      // Render the summary inside a `.custom-checkout` ancestor and read the
      // actual computed value.
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

      helper.enterManualCompanyEntry();
      typeCompanyName("Sole Proprietor Bakery");

      // The pick above invalidated the previous intent; re-approve so the tile
      // label is on screen to be read (see the first test in this file's
      // company-search block).
      approveIntent();

      expect(renderedName()).toBe("Sole Proprietor Bakery");
      expect(tileText()).toBe("Sole Proprietor Bakery");
      // enterManualCompanyEntry clears #company_id: the buyer has said the
      // registry company is not theirs, so its number must not survive.
      // §5 goes further — manual entry shows no number label at all, so the
      // block is hidden outright rather than rendered empty.
      expect(isShown()).toBe(false);
      expect(renderedNumber()).toBe("");
      expect($("#company_id").val()).toBe("");
    });

    test("what is displayed is what gets posted", () => {
      helper.enterManualCompanyEntry();
      typeCompanyName("Sole Proprietor Bakery");

      // The posted field on its own would be vacuous here — typeCompanyName is
      // what set it. The pairing is the assertion: the summary renders the same
      // string the checkout will post, not a copy that can drift from it.
      expect(renderedName()).toBe("Sole Proprietor Bakery");
      expect($("#billing_company").val()).toBe(renderedName());
    });

    test("hides #company_id_field — manual entry is name-only, no id (#30.x.13)", () => {
      // Settled cross-platform three-mode company-capture model: search gets
      // name+id, sole-trader gets name+synthetic id, manual entry gets name
      // ONLY — Two's payment method cannot function without an id, and
      // showing this field in manual entry invites one that was never
      // validated against anything (see the `manual_company_entry_active`
      // comment in toggleBusinessFields). Previously this platform diverged
      // and kept the field visible/required in manual entry — that was the
      // bug (#30.x.13, live-reported by Doug).
      pickCompany("ACME Widgets Ltd", "12345678");
      helper.enterManualCompanyEntry();
      typeCompanyName("Sole Proprietor Bakery");

      expect($("#company_id_field").hasClass("hidden")).toBe(true);
      expect($("#company_id").prop("required")).toBe(false);
    });

    test("stays name-only after a round trip through sole-trader mode (#30.x.13, round 1 review — Vader)", () => {
      // Real dead end found live by Vader's review: sole-trader mode is
      // reachable WHILE in manual entry — the mode chip is not hidden during
      // manual entry, and the email-driven autofill prefetch can call
      // twoincSoleTrader.setMode("sole_trader") on its own regardless of
      // capture mode. setMode saves/restores `enable_company_search` around
      // the trip, so a buyer who was in manual entry correctly lands back on
      // enable_company_search === "no" — but without also saving/restoring
      // `manual_company_entry_active`, toggleBusinessFields cannot tell that
      // "no" apart from sole-trader's own, and would show + REQUIRE
      // #company_id_field with no working search widget behind it
      // (enableCompanySearch early-returns) and no way back to name-only.
      pickCompany("ACME Widgets Ltd", "12345678");
      helper.enterManualCompanyEntry();
      typeCompanyName("Sole Proprietor Bakery");

      ctx.soleTrader.setMode("sole_trader");
      ctx.soleTrader.setMode("business");

      expect($("#company_id_field").hasClass("hidden")).toBe(true);
      expect($("#company_id").prop("required")).toBe(false);
    });
  });

  describe("sole trader", () => {
    test("renders the name and number held for the buyer", () => {
      ctx.soleTrader.setCompany("99887766", "Jo Bloggs Trading");

      expect(isShown()).toBe(true);
      expect(renderedName()).toBe("Jo Bloggs Trading");
      expect(renderedNumber()).toBe("99887766");

      // The tile only carries the company once an intent check has actually
      // run (§7.2/§7.3) — setCompany() alone does not trigger one.
      approveIntent();
      expect(tileText()).toBe("Jo Bloggs Trading (99887766)");
      expect($("#billing_company").val()).toBe("Jo Bloggs Trading");
      expect($("#company_id").val()).toBe("99887766");
    });
  });

  describe("it is genuinely read-only", () => {
    test("there is no field in it to type into", () => {
      pickCompany("ACME Widgets Ltd", "12345678");

      expect(summary().find("input, select, textarea, [contenteditable]").length).toBe(0);
      // The value lives in an element a user cannot put a caret in.
      expect(summary().find(".twoinc-company-summary-id").prop("tagName")).toBe("SPAN");

      // Same for the tile: the company now renders as plain text inside the
      // intent-approved notice, which is itself a <div> with no controls in
      // it (TWO-25326 §7.2/§7.3).
      expect(intentNotice().find("input, select, textarea, [contenteditable]").length).toBe(0);
      expect(intentNotice().prop("tagName")).toBe("DIV");
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
      helper.renderCompanySummary("ACME Widgets Ltd", "12345678");
      expect(isShown()).toBe(true);

      helper.renderCompanySummary("", "");
      expect(isShown()).toBe(false);
    });

    test("hidden when the buyer is paying by another method", () => {
      pickCompany("ACME Widgets Ltd", "12345678");
      expect(isShown()).toBe(true);

      $('input[name="payment_method"]').prop("checked", false);
      helper.renderCompanySummary();

      expect(isShown()).toBe(false);
      // Still rendered, just not shown — and the fields still post.
      expect($("#billing_company").val()).toBe("ACME Widgets Ltd");
    });

    test("cleared when the captured company is cleared, and stays cleared", () => {
      jest.useFakeTimers();
      pickCompany("ACME Widgets Ltd", "12345678");
      expect(isShown()).toBe(true);

      helper.clearSelectedCompany();

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
      helper.renderCompanySummary("\u00a0", "");

      expect(renderedName()).toBe("");
      expect(isShown()).toBe(false);

      // And through the live read, against the real unselected state: the empty
      // option's VALUE is "" — the non-breaking space is only its label, which
      // is why the live read cannot see one and the guard above is defensive.
      $("#billing_company").val("");
      expect($("#billing_company_display").val()).toBe("");
      helper.renderCompanySummary();

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

      helper.renderCompanySummary();

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

  /**
   * The captured company now renders INSIDE the intent-message sentences
   * themselves — the approved notice and the declined ("not available") box
   * both carry it — rather than in a separate `.twoinc-company-tile-label`
   * element (TWO-25326 §7.2/§7.3, ruling 2026-08-03, superseding the label
   * PR #431 shipped the night before).
   *
   * There is no longer a second element whose visibility has to be kept in
   * sync with the notice's — the company text and the notice are the same
   * element now, so "shown" and "carries the company" collapse into one
   * question per box. What is still worth asserting: which template each box
   * substitutes from, that they do not cross-contaminate, and that the
   * no-company fallback still works exactly as it did before this ticket
   * touched either box.
   */
  describe("intent-message boxes carry the captured company (TWO-25326 §7.2/§7.3, 2026-08-03)", () => {
    /** Capture a company without leaving the intent notice on screen. */
    function captureCompanyOnly() {
      const ajax = harness.stubAjax($);
      pickCompany("ACME Widgets Ltd", "12345678");
      ajax.restore();
    }

    /** @returns {Object} the payment tile's declined ("not available") box */
    function declinedBox() {
      return $(".twoinc-pay-box.twoinc-err-payment-default");
    }

    test("a captured company alone shows neither box yet", () => {
      // Picking a company does not itself approve or decline anything — an
      // order-intent check has to run first.
      captureCompanyOnly();

      expect($("#billing_company").val()).toBe("ACME Widgets Ltd");
      expect(intentShown()).toBe(false);
      expect(declinedBox().hasClass("hidden")).toBe(true);
    });

    test("the approved notice carries the captured company", () => {
      captureCompanyOnly();
      approveIntent();

      expect(intentShown()).toBe(true);
      expect(intentNotice().text()).toBe("ACME Widgets Ltd (12345678)");
    });

    test("the declined box carries the captured company too, on its own template", () => {
      captureCompanyOnly();

      dom.togglePaySubtitleDesc("errored", ".twoinc-err-payment-default");

      expect(declinedBox().hasClass("hidden")).toBe(false);
      expect(declinedBox().text()).toBe("ACME Widgets Ltd (12345678)");
      // The approved notice's own template is untouched by a declined action.
      expect(intentNotice().hasClass("hidden")).toBe(true);
    });

    test("the phone-number error box is never substituted, even with a company captured", () => {
      // Only `.twoinc-err-payment-default` gets the company-template
      // treatment — the phone-number box is a fixed, unrelated message.
      $(document.body)
        .find(".payment_box")
        .append(
          '<div class="twoinc-pay-box twoinc-err-phone-number hidden" ' +
            'data-company-template="{company}">' +
            "Phone number is invalid." +
            "</div>"
        );
      captureCompanyOnly();

      dom.togglePaySubtitleDesc("errored", ".twoinc-err-phone-number");

      expect($(".twoinc-pay-box.twoinc-err-phone-number").text()).toBe("Phone number is invalid.");
    });

    test("switching from approved to declined swaps which box carries the company", () => {
      captureCompanyOnly();
      approveIntent();
      expect(intentNotice().text()).toBe("ACME Widgets Ltd (12345678)");

      dom.togglePaySubtitleDesc("errored", ".twoinc-err-payment-default");

      expect(intentNotice().hasClass("hidden")).toBe(true);
      expect(declinedBox().hasClass("hidden")).toBe(false);
      expect(declinedBox().text()).toBe("ACME Widgets Ltd (12345678)");
    });

    test("a brand that suppressed the approved notice leaves it absent, but the declined box is unaffected", () => {
      // 'intent_approved_notice_enabled: false' => get_intent_approved_notice()
      // returns '' and the approved div is never rendered. The declined box
      // is NEVER gated on that switch (TWO-25224: "a merchant who wants no
      // reassurance still needs failures surfaced") — proven here by driving
      // it with the approved notice removed from the DOM entirely.
      intentNotice().remove();
      captureCompanyOnly();

      dom.togglePaySubtitleDesc("errored", ".twoinc-err-payment-default");

      expect(intentNotice().length).toBe(0);
      expect(declinedBox().hasClass("hidden")).toBe(false);
      expect(declinedBox().text()).toBe("ACME Widgets Ltd (12345678)");
    });

    test("re-substitutes from live inputs on every toggle call, not a stale snapshot", () => {
      // togglePaySubtitleDesc holds no company values of its own; each call
      // re-reads #billing_company/#company_id. If it did not, a second
      // approval after the inputs changed would keep showing the FIRST
      // company.
      captureCompanyOnly();
      approveIntent();
      expect(intentNotice().text()).toBe("ACME Widgets Ltd (12345678)");

      $("#billing_company").val("Beta Traders Ltd");
      $("#company_id").val("87654321");
      dom.togglePaySubtitleDesc("checking-intent");
      approveIntent();

      expect(intentNotice().text()).toBe("Beta Traders Ltd (87654321)");
    });

    test("a company with no organisation number substitutes the bare name, never a dangling '()'", () => {
      captureCompanyOnly();
      $("#company_id").val("");

      approveIntent();
      expect(intentNotice().text()).toBe("ACME Widgets Ltd");

      dom.togglePaySubtitleDesc("errored", ".twoinc-err-payment-default");
      expect(declinedBox().text()).toBe("ACME Widgets Ltd");
    });

    test("an intent-approved checkout with no company falls back to the served no-company sentence", () => {
      $("#billing_company").val("");
      $("#company_id").val("");

      dom.togglePaySubtitleDesc("intent-approved");

      expect(intentShown()).toBe(true);
      expect(intentNotice().text()).toBe("NO_COMPANY_APPROVED");
    });

    test("a declined checkout with no company falls back to its own served sentence", () => {
      $("#billing_company").val("");
      $("#company_id").val("");

      dom.togglePaySubtitleDesc("errored", ".twoinc-err-payment-default");

      expect(declinedBox().hasClass("hidden")).toBe(false);
      expect(declinedBox().text()).toBe("NO_COMPANY_DECLINED");
    });
  });
});
