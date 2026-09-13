/**
 * ABN-554 — the about icon belongs immediately right of the Two logo, as on
 * the other platforms, not stranded at the opposite end of the method row.
 * jsdom does no layout, so this reads the shipped stylesheet, the same way
 * the tooltip-open test does.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const STYLESHEET = fs.readFileSync(
  path.join(__dirname, "..", "..", "assets", "css", "twoinc.css"),
  "utf8"
);

const ruleBody = (selector) => {
  const match = STYLESHEET.match(
    new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([\\s\\S]*?)\\}")
  );

  if (!match) {
    throw new Error("no rule for " + selector);
  }

  return match[1];
};

const LABEL_RULE = "li.wc_payment_method:has(> .abt-twoinc) > label";

describe("the about control's place in the method row", () => {
  test("the title label does not grow, so the control stays against it", () => {
    // Given/When: a flex method row. Then: a zero grow factor.
    expect(ruleBody(LABEL_RULE)).toMatch(/flex:\s*0\s/);
    expect(ruleBody(LABEL_RULE)).not.toMatch(/flex:\s*(?:[1-9]|auto|none)/);
  });

  test.each([
    [/margin-left:\s*auto/, "no auto left margin"],
    [/margin-inline-start:\s*auto/, "no auto inline-start margin"],
    [/float:\s*right/, "no right float"]
  ])("%s — the control has %s", (pattern) => {
    expect(ruleBody(".abt-twoinc")).not.toMatch(pattern);
  });

  test("nothing on the row pushes its items to the far end", () => {
    expect(ruleBody("li.wc_payment_method:has(> .abt-twoinc)")).not.toMatch(
      /justify-content:\s*(?:flex-end|end|right|space-between)/
    );
  });

  test("the gap to the logo is the 12px the other tiles use", () => {
    expect(ruleBody(".abt-twoinc")).toMatch(/margin-left:\s*12px/);
  });

  test("the tooltip is centred on the control, which is no longer at the right edge", () => {
    const tooltip = ruleBody(".abt-twoinc-text");

    expect(tooltip).toMatch(/left:\s*50%/);
    expect(tooltip).toMatch(/transform:\s*translateX\(-50%\)/);
    expect(tooltip).not.toMatch(/right:\s*0/);
  });
});
