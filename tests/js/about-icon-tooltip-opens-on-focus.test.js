/**
 * ABN-554 — the about icon is a keyboard destination, so its tooltip has to
 * open on focus as well as on hover. jsdom has no hover and no real focus
 * ring, so this reads the shipped stylesheet rather than a computed value.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const STYLESHEET = fs.readFileSync(
  path.join(__dirname, "..", "..", "assets", "css", "twoinc.css"),
  "utf8"
);

describe("the about tooltip", () => {
  test.each([
    [/\.abt-twoinc:hover\s+\.abt-twoinc-text/, "opens on hover"],
    [/\.abt-twoinc:focus-within\s+\.abt-twoinc-text/, "opens on keyboard focus"]
  ])("%s — it %s", (pattern, description) => {
    expect(STYLESHEET).toMatch(pattern);
  });

  test("stays in the layout when closed, so it can transition rather than pop", () => {
    const closed = STYLESHEET.match(/\.abt-twoinc-text\s*\{([\s\S]*?)\}/)[1];

    expect(closed).toMatch(/opacity:\s*0;/);
    expect(closed).not.toMatch(/display:\s*none|visibility:\s*hidden/);
  });
});
