/**
 * TWO-25503. `assets/js/company-search-panel.js` is one of two copies of the same
 * panel module, so two checkouts render one control. The copies are byte-identical
 * and the Magento plugin's suite locks its copy to the same digest, so two matching
 * constants are the whole parity check — neither repo can read the other.
 *
 * To change shared panel behaviour: edit here, apply the identical edit to the other
 * copy, re-run both JS suites, and move both digests in the same change set.
 */

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const harness = require("./wc-harness");

const PANEL_PATH = "assets/js/company-search-panel.js";

/** sha256 of this copy of the panel. */
const EDIT_LOCK_SHA256 = "2e08d09014bfd8c05e885058fa6f3589852b9daae24aa57f7fb07d81d9d72359";

describe("the vendored company-search panel", () => {
  test("has not been edited in place", () => {
    const bytes = fs.readFileSync(path.join(harness.REPO_ROOT, PANEL_PATH));
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");

    expect(digest).toBe(EDIT_LOCK_SHA256);
  });
});
