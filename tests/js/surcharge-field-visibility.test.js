/**
 * TWO-25498. Admin settings-page row visibility that follows the surcharge
 * method (and, for Rounding step, the rounding basis too) without a save.
 *
 * `:visible` is unusable under jsdom — nothing has layout — so these assert
 * on `.css("display")`. jQuery's `.show()` restores a `<tr>` to its cached
 * default ("table-row"), not `""`, so a shown row is asserted with
 * `not.toBe("none")` rather than an exact value — the same reasoning
 * sole-trader-flow.test.js documents for its own `.css("display")` checks.
 *
 * Every case ticks at least one term (`checked: [14]` where the scenario
 * itself doesn't care) so admin.js's Default Payment Term dropdown gets at
 * least one option — the harness's own bootstrap proof.
 */

"use strict";

const harness = require("./admin-harness");

function expectRow($, id, hidden) {
  const display = $("#" + harness.FIELD_PREFIX + id)
    .closest("tr")
    .css("display");
  if (hidden) {
    expect(display).toBe("none");
  } else {
    expect(display).not.toBe("none");
  }
}

describe("surcharge option field visibility", () => {
  test.each([
    ["none", true],
    ["fixed", false],
    ["percentage", false],
    ["fixed_and_percentage", false]
  ])(
    "surcharge_type=%s hides Calculation Basis/Line Description/Rounding rows: hidden=%s",
    async (type, hidden) => {
      const { $ } = await harness.loadAdmin({ type: type, checked: [14] });
      expectRow($, "surcharge_differential", hidden);
      expectRow($, "surcharge_line_description", hidden);
      expectRow($, "surcharge_rounding_basis", hidden);
    }
  );

  test.each([
    ["none", "none", true, "surcharge disabled hides the row regardless of basis"],
    ["fixed", "none", true, "basis=none hides Rounding step even with a surcharge method"],
    ["fixed", "up", false, "a real basis with a surcharge method shows Rounding step"],
    ["none", "up", true, "surcharge disabled hides Rounding step even with a real basis"]
  ])(
    "surcharge_type=%s, rounding_basis=%s -> Rounding step hidden=%s (%s)",
    async (type, basis, hidden) => {
      const { $ } = await harness.loadAdmin({ type: type, checked: [14] });
      $("#" + harness.FIELD_PREFIX + "surcharge_rounding_basis")
        .val(basis)
        .trigger("change");
      expectRow($, "surcharge_rounding_step", hidden);
    }
  );
});
