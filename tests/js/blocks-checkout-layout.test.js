/**
 * ABN-554 — the Blocks-only stylesheet. jsdom lays nothing out, so this reads
 * the shipped file, the same way the tile row-spacing test does.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const STYLESHEET = fs.readFileSync(
  path.join(__dirname, "..", "..", "assets", "css", "blocks-checkout.css"),
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

describe("the Blocks checkout's own stylesheet", () => {
  test.each([
    [
      ".twoinc-blocks-label",
      /display:\s*inline-flex/,
      "lays the method label out on one line, in DOM order"
    ],
    [
      ".two-company-dropdown",
      /line-height:\s*normal/,
      "gives the popover a line box core's text-input row zeroes"
    ]
  ])("%s — it %s", (selector, declaration) => {
    expect(ruleBody(selector)).toMatch(declaration);
  });

  test("nothing here needs !important, which a brand overlay could not beat", () => {
    expect(STYLESHEET).not.toMatch(/!important/);
  });
});
