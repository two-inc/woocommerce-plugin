/**
 * ABN-554 — host themes space `.form-row` inside the payment box, and the tile
 * company row is a `.form-row` this plugin builds there. jsdom lays nothing
 * out, so this reads the shipped stylesheet rather than a computed value.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const STYLESHEET = fs.readFileSync(
  path.join(__dirname, "..", "..", "assets", "css", "twoinc.css"),
  "utf8"
);

const RULE =
  /\.twoinc-company-search-tile-slot\s+#twoinc_tile_company_row\.twoinc-inp-container\.form-row\.form-row-wide\s*\{([\s\S]*?)\}/;

describe("the tile company row", () => {
  test("is matched by one id and four classes, out-specifying a theme's id-plus-three", () => {
    expect(STYLESHEET).toMatch(RULE);
  });

  test.each([
    [/padding-bottom:\s*0;/, "carries no bottom padding"],
    [/margin-bottom:\s*0;/, "carries no bottom margin"]
  ])("%s — it %s", (declaration) => {
    expect(STYLESHEET.match(RULE)[1]).toMatch(declaration);
  });
});
