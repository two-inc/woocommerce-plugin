/**
 * TWO-25289. The admin surcharge grid's LIVE row rebuild.
 *
 * The grid has two renderers that must agree about what a stored cell holds:
 * the PHP one that draws the page (generate_two_surcharge_grid_html) and the
 * JS one that re-creates a row when a term is un-ticked and re-ticked without
 * a save (buildGridRow in assets/js/admin.js). They disagreed.
 *
 * PHP tests presence with isset(), so a stored cap of 0 renders as value="0".
 * The JS read `stored[col] || ""`, and 0 is falsy in JS — so the re-created row
 * came back BLANK. The save then dropped the blanked cell, and an absent cap
 * means NO cap, so the term's percentage relayed UNCAPPED. That is the exact
 * overcharge this ticket exists to prevent, reachable through the JS path while
 * the PHP path was correct, and reachable by a merchant who only fiddled with
 * the term ticks and pressed Save.
 *
 * The stored value arrives via wp_localize_script, which JSON-encodes, so a
 * numeric 0 is a real shape here and not a hypothetical.
 */

"use strict";

const harness = require("./admin-harness");

describe("surcharge grid live row rebuild", () => {
  test("a stored cap of 0 survives untick + retick", async () => {
    // Numeric 0 — the falsy shape that was silently blanked.
    const stored = { 30: { fixed: "", percentage: "2.5", limit: 0 } };
    const { $ } = await harness.loadAdmin({ checked: [30], stored: stored });

    // The server-rendered row starts correct; the JS path is what regressed.
    expect(harness.cellValue($, 30, "limit")).toBe("0");

    harness.untickAndRetick($, 30);

    // Rebuilt by buildGridRow, not by PHP.
    expect(harness.cellValue($, 30, "limit")).toBe("0");
    expect(harness.cellValue($, 30, "percentage")).toBe("2.5");
  });

  test("a stored cap of 0 survives as a string too", async () => {
    // The option is written as canonical numeric STRINGS on save, so this is
    // the shape a freshly-saved shop has. It was never broken — asserted so a
    // future "fix" cannot repair the number case by breaking the string one.
    const stored = { 30: { percentage: "2.5", limit: "0" } };
    const { $ } = await harness.loadAdmin({ checked: [30], stored: stored });
    harness.untickAndRetick($, 30);
    expect(harness.cellValue($, 30, "limit")).toBe("0");
  });

  test("other falsy-but-real stored values survive too", async () => {
    // Same defect, same cells: a percentage of 0 and a fixed fee of 0 are the
    // pair the cap refusal tells merchants to use instead of a cap of 0, so
    // blanking THEM would break the sanctioned way out of it.
    const stored = { 60: { fixed: 0, percentage: 0, limit: "" } };
    const { $ } = await harness.loadAdmin({ checked: [60], stored: stored });
    harness.untickAndRetick($, 60);
    expect(harness.cellValue($, 60, "fixed")).toBe("0");
    expect(harness.cellValue($, 60, "percentage")).toBe("0");
  });

  test("an absent cell rebuilds blank, and absence stays distinct from zero", async () => {
    // The other half of the invariant. Empty is the legitimate "no cap" and
    // must NOT become "0" — the two are different instructions upstream
    // (absent = uncapped, 0 = fee clamped to zero), so a presence test that
    // over-corrected into printing "0" for undefined would be just as wrong.
    const stored = { 30: { percentage: "2.5" } };
    const { $ } = await harness.loadAdmin({ checked: [30], stored: stored });
    harness.untickAndRetick($, 30);
    expect(harness.cellValue($, 30, "limit")).toBe("");
    expect(harness.cellValue($, 30, "fixed")).toBe("");
  });

  test("a term with no stored row at all rebuilds blank", async () => {
    const { $ } = await harness.loadAdmin({ checked: [30], stored: {} });
    harness.untickAndRetick($, 30);
    expect(harness.cellValue($, 30, "limit")).toBe("");
  });

  test("newly ticking a term inserts its stored row in day order", async () => {
    // The rebuild path is also how a term the merchant ticks for the FIRST
    // time in this session gets its row, which is where a stored zero from an
    // earlier configuration re-enters the form.
    const stored = { 14: { percentage: "1", limit: 0 }, 30: { percentage: "2.5" } };
    const { $ } = await harness.loadAdmin({ checked: [30], stored: stored });
    expect(harness.cellValue($, 14, "limit")).toBeNull();

    $('.twoinc-term-checkbox[value="14"]').prop("checked", true).trigger("change");

    expect(harness.cellValue($, 14, "limit")).toBe("0");
    const order = $(".twoinc-surcharge-grid tbody tr")
      .map(function () {
        return Number($(this).attr("data-days"));
      })
      .get();
    expect(order).toEqual([14, 30]);
  });

  test("the rebuilt input keeps the name the validator reads", async () => {
    // The row is only useful if it POSTS under the same key the PHP validator
    // walks; a rebuilt row with a wrong name would look right on screen and
    // silently save nothing.
    const stored = { 30: { limit: 0 } };
    const { $ } = await harness.loadAdmin({ checked: [30], stored: stored });
    harness.untickAndRetick($, 30);
    const name = $('.twoinc-surcharge-grid tbody tr[data-days="30"] .twoinc-col-limit input').attr(
      "name"
    );
    expect(name).toBe(harness.FIELD_PREFIX + "surcharge_grid[30][limit]");
  });
});
