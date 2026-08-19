/**
 * TWO-25469. A widget's underlying `<select>` can be discarded outright —
 * WooCommerce's checkout-AJAX fragment `replaceWith()` is the documented
 * trigger, see `closeCompanySearchBeforeCheckoutUpdate`'s own comment in
 * twoinc.js — without a `select2("destroy")` call ever reaching it. The
 * widget's inline container goes with the removed `<select>`, but selectWoo's
 * AttachBody decorator renders the actual DROPDOWN as a separate node
 * appended straight to `<body>` (vendored bundle, `AttachBody.render`/
 * `.bind`), so it survives untouched — nothing but that same discarded
 * instance's own `destroy()`/`close()` ever detaches it, and nothing calls
 * either once every reference to the instance is gone with the element.
 *
 * Confirmed live on staging: reopening the freshly re-attached widget then
 * renders a SECOND open dropdown alongside the orphan, i.e. two
 * `.select2-container--open` elements for the one field.
 */

"use strict";

const harness = require("./wc-harness");

describe("company-search dropdown-clone orphan sweep (TWO-25469)", () => {
  let ctx;

  beforeEach(() => {
    ctx = harness.loadTwoinc();
    harness.buildCheckoutForm();
  });

  afterEach(() => {
    harness.releaseWidgets(ctx.$);
    document.body.innerHTML = "";
  });

  /** @returns {number} every `.select2-container` anywhere in the document */
  function containerCount() {
    return ctx.$(".select2-container").length;
  }

  /** @returns {number} every `.select2-container--open` in the document */
  function openContainerCount() {
    return ctx.$(".select2-container--open").length;
  }

  test("an ordinary attach + open renders exactly one open container", () => {
    ctx.helper.attach();
    ctx.$("#billing_company_display").select2("open");

    expect(openContainerCount()).toBe(2);
  });

  test(
    "re-attaching after the field was discarded while its dropdown was open " +
      "leaves no orphaned open dropdown behind",
    () => {
      ctx.helper.attach();
      ctx.$("#billing_company_display").select2("open");
      expect(openContainerCount()).toBe(2);

      // Simulate the documented mechanism: WooCommerce's own AJAX discards
      // the fragment holding the field wholesale — never a select2("destroy")
      // call — and replaces it with a brand new, un-initialised `<select>`
      // of the same id. The old widget's AttachBody dropdown clone is a
      // sibling of <body>, not a descendant of the removed field, so it is
      // NOT taken down by this removal.
      ctx.$("#billing_company_display_field").remove();
      ctx
        .$("form[name='checkout']")
        .append(
          '<p id="billing_company_display_field"><select id="billing_company_display">' +
            '<option value="">&nbsp;</option></select></p>'
        );

      // The removal took the inline container down with the rest of the
      // field's subtree; only the body-appended dropdown clone survives,
      // still marked open — the orphan, and the whole defect on its own
      // before any re-attach happens.
      expect(openContainerCount()).toBe(1);

      // The re-attach every retry/mode-switch/manual-entry-exit path performs.
      ctx.helper.attach();

      // Nothing is open yet on the freshly attached widget — the orphan must
      // be gone, not just outnumbered.
      expect(openContainerCount()).toBe(0);

      // And reopening the new widget must show exactly the one dropdown a
      // buyer expects, not a second copy of the orphan alongside it — the
      // literal defect reported live (TWO-25469).
      ctx.$("#billing_company_display").select2("open");
      expect(openContainerCount()).toBe(2);
      expect(containerCount()).toBe(2); // one inline container + one open dropdown clone
    }
  );

  test("the ordinary re-attach path (widget still live on the SAME field) is unaffected", () => {
    // Guards the exclusion in the sweep: re-attaching a live, OPEN widget on
    // the field it is already attached to must still leave exactly one
    // dropdown clone, via selectWoo's own reinit — not because the sweep
    // tore it down first, which would double up with that reinit's own
    // cleanup instead of leaving it alone.
    ctx.helper.attach();
    ctx.$("#billing_company_display").select2("open");
    expect(openContainerCount()).toBe(2);

    ctx.helper.attach();

    expect(openContainerCount()).toBe(0);
    ctx.$("#billing_company_display").select2("open");
    expect(openContainerCount()).toBe(2);
  });
});
