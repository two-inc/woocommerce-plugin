/**
 * TWO-25503. `assets/js/company-search-panel.js` is a copy of the panel the Two
 * Magento plugin maintains, so both checkouts render one control.
 *
 * `AGENTS.md` records that convention and `.prettierignore` keeps the formatter
 * off the file, but neither is enforceable: a one-line local edit passes every
 * other check in this repo silently. The digest below is the enforcement.
 *
 * It locks the file against being edited in place, and that alone: nothing
 * compares the two copies, which are out of step today. Changing the panel
 * means changing it upstream, re-copying the whole file and pasting the new
 * digest here — the only thing that puts them back in step.
 */

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const harness = require("./wc-harness");

const PANEL_PATH = "assets/js/company-search-panel.js";

/** sha256 of the panel as last copied in from upstream. */
const EDIT_LOCK_SHA256 = "1b15108cec2ce1b35feb6e8bd950b3853e0f1c6e3f69fbfb2c7b1cd5092ae554";

describe("the vendored company-search panel", () => {
  test("has not been edited in place", () => {
    const bytes = fs.readFileSync(path.join(harness.REPO_ROOT, PANEL_PATH));
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");

    expect(digest).toBe(EDIT_LOCK_SHA256);
  });
});
