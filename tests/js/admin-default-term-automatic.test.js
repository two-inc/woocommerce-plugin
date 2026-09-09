/**
 * ABN-548. The Default Payment Term dropdown the admin JS rebuilds leads with
 * an empty Automatic option and never selects a day count the admin did not
 * choose. The select posts on save, so a synthesised one is stored and becomes
 * the checkout resolver's first step, making every later step unreachable.
 */

"use strict";

const harness = require("./admin-harness");

function optionValues($) {
  return $("#" + harness.FIELD_PREFIX + "default_payment_term option")
    .map(function () {
      return this.value;
    })
    .get();
}

function selection($) {
  return $("#" + harness.FIELD_PREFIX + "default_payment_term").val();
}

describe("the rebuilt Default Payment Term dropdown", () => {
  test("labels the empty option with the localised string, not English", async () => {
    const { $ } = await harness.loadAdmin({
      checked: [14, 30],
      terms: [7, 14, 30, 60],
      merchantTerms: [7, 14, 30, 60]
    });

    expect(
      $("#" + harness.FIELD_PREFIX + "default_payment_term option")
        .first()
        .text()
    ).toBe("Any term");
  });

  test.each([
    [[14, 30], ["", "14", "30"], "the empty option leads the ticked terms"],
    [[7, 14], ["", "7", "14"], "the same with no 30 ticked"],
    [[], [""], "nothing ticked still offers the empty option"]
  ])("ticked %s -> options %s — %s", async (checked, expected) => {
    const { $ } = await harness.loadAdmin({
      checked: checked,
      terms: [7, 14, 30, 60],
      merchantTerms: [7, 14, 30, 60]
    });

    expect(optionValues($)).toEqual(expected);
  });

  test.each([
    [[14, 30], "a selection nobody made is not synthesised"],
    [[7, 14], "not even where 30 is not ticked"]
  ])("ticked %s selects nothing — %s", async (checked) => {
    const { $ } = await harness.loadAdmin({
      checked: checked,
      terms: [7, 14, 30, 60],
      merchantTerms: [7, 14, 30, 60]
    });

    expect(selection($)).toBe("");
  });

  test("a term the admin picked survives another term being unticked", async () => {
    const { $ } = await harness.loadAdmin({
      checked: [14, 30],
      terms: [7, 14, 30, 60],
      merchantTerms: [7, 14, 30, 60]
    });
    $("#" + harness.FIELD_PREFIX + "default_payment_term").val("30");

    harness.untickAndRetick($, 14);

    expect(selection($)).toBe("30");
  });

  test("unticking the picked term itself falls back to Automatic", async () => {
    const { $ } = await harness.loadAdmin({
      checked: [14, 30],
      terms: [7, 14, 30, 60],
      merchantTerms: [7, 14, 30, 60]
    });
    $("#" + harness.FIELD_PREFIX + "default_payment_term").val("14");

    $('.twoinc-term-checkbox[value="14"]').prop("checked", false).trigger("change");

    expect(selection($)).toBe("");
  });
});
