/**
 * TWO-25503. `assets/js/company-search-panel.js` is a byte-identical copy of
 * the file the Two Magento plugin maintains, so both checkouts render one
 * control rather than two that drift.
 *
 * `AGENTS.md` says so and `.prettierignore` keeps the formatter off it, but
 * neither is enforceable: a one-line local edit passes every other check in
 * this repo silently. This is the enforcement.
 *
 * Updating the panel means changing it upstream, re-copying the whole file and
 * pasting the new digest here — never editing the copy.
 */

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const harness = require("./wc-harness");

const PANEL_PATH = "assets/js/company-search-panel.js";

/** sha256 of magento-plugin's `company-search-panel.js` as vendored. */
const VENDORED_SHA256 = "e969ceab91471966260c6c82ade39f57a65c29b8874ac194ea7541d581b30670";

describe("the vendored company-search panel", () => {
  test("matches the upstream copy byte for byte", () => {
    const bytes = fs.readFileSync(path.join(harness.REPO_ROOT, PANEL_PATH));
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");

    expect(digest).toBe(VENDORED_SHA256);
  });
});
