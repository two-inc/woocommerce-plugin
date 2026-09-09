/**
 * TWO-25503. `assets/js/company-search-panel.js` is a copy of the panel the Two
 * Magento plugin maintains, so both checkouts render one control.
 *
 * `AGENTS.md` records that convention and `.prettierignore` keeps the formatter
 * off the file, but neither is enforceable: a one-line local edit passes every
 * other check in this repo silently. The digest below is the enforcement.
 *
 * It locks the file against being edited in place, and that alone: nothing
 * compares the two copies. Changing the panel means changing it upstream,
 * re-copying the whole file and pasting the new digest here — the only thing
 * that closes the gap between them.
 */

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const harness = require("./wc-harness");

const PANEL_PATH = "assets/js/company-search-panel.js";

/** sha256 of the panel as last copied in from upstream. */
const EDIT_LOCK_SHA256 = "c4324bc343927881cd8fff2f79a5191cabc8693f85067417fc955457996965d7";

describe("the vendored company-search panel", () => {
  test("has not been edited in place", () => {
    const bytes = fs.readFileSync(path.join(harness.REPO_ROOT, PANEL_PATH));
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");

    expect(digest).toBe(EDIT_LOCK_SHA256);
  });
});
