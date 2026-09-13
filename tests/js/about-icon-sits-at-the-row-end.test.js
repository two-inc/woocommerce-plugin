/**
 * ABN-554 — the about icon belongs at the right-hand end of the payment
 * method row. jsdom does no layout, so this reads the shipped stylesheet,
 * the same way the tooltip-open test does.
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

const ROW_RULE = "li.wc_payment_method:has(> .abt-twoinc)";
const LABEL_RULE = "li.wc_payment_method:has(> .abt-twoinc) > label";

describe("the about control's place in the method row", () => {
  test("the row distributes free space, so an item can be pushed along it", () => {
    // Given: a method row carrying the control. When/Then: it is a flex row.
    expect(ruleBody(ROW_RULE)).toMatch(/display:\s*flex/);
  });

  test("the title label takes that free space, carrying the control to the end", () => {
    expect(ruleBody(LABEL_RULE)).toMatch(/flex:\s*1\s+1\b/);
  });

  test("the row does not shift its items itself, which would drag the radio too", () => {
    expect(ruleBody(ROW_RULE)).not.toMatch(
      /justify-content:\s*(?:flex-end|end|right|space-between)/
    );
  });

  test("the tooltip body stays anchored right, under the control it belongs to", () => {
    const tooltip = ruleBody(".abt-twoinc-text");

    expect(tooltip).toMatch(/right:\s*0/);
    expect(tooltip).not.toMatch(/left:\s*50%|transform:\s*translateX/);
  });
});
