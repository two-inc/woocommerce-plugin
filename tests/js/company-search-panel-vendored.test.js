/**
 * TWO-25503. `assets/js/company-search-panel.js` is one of two copies of the same
 * panel module, so two checkouts render one control. Nothing compares the copies,
 * and they have drifted, so a whole-file re-copy is not the route.
 *
 * The digest below locks this copy against being edited in place, and that alone —
 * `AGENTS.md` and `.prettierignore` are not enforceable. To change shared panel
 * behaviour: edit here, apply the identical edit to the other copy, re-run the JS
 * suite, and move the digest in the same commit.
 */

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const harness = require("./wc-harness");

const PANEL_PATH = "assets/js/company-search-panel.js";

/** sha256 of this copy of the panel. */
const EDIT_LOCK_SHA256 = "2db46b6e52df92173c95ab080c1f5717494c2a847afe7e1dae1514a6bac83ff6";

describe("the vendored company-search panel", () => {
  test("has not been edited in place", () => {
    const bytes = fs.readFileSync(path.join(harness.REPO_ROOT, PANEL_PATH));
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");

    expect(digest).toBe(EDIT_LOCK_SHA256);
  });
});
