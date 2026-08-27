/**
 * Every path that creates or clears a capture must re-evaluate which company
 * name surface the buyer is looking at.
 *
 * `toggleBusinessFields()` is the only place that decision is made, and
 * `twoincCompanyCapture.write()` is the only sanctioned writer of the capture.
 * A write with no re-evaluation leaves the rule computed but never read — the
 * defect this file exists to stop, found twice: an ordinary registry pick
 * (which left the picked company on screen in the address area beside the tile
 * that owned it), and a country change (which left the address row hidden with
 * nothing captured to justify it).
 *
 * Structural rather than behavioural on purpose. A behavioural test per path
 * only ever covers the paths someone thought of; this fails when a SIXTH
 * `write()` call site is added without a re-evaluation, which is the way this
 * class of bug has actually arrived each time.
 */
const fs = require("fs");
const path = require("path");
const harness = require("./wc-harness");

/** Source of the shipped plugin JS. @returns {string} */
function source() {
  return fs.readFileSync(path.join(harness.REPO_ROOT, harness.SOURCE_PATH), "utf8");
}

/**
 * The enclosing function body for each `twoincCompanyCapture.write(` call,
 * taken as the window from the call to the next top-level member declaration.
 *
 * @returns {Array<{line: number, body: string}>}
 */
function writeCallSites() {
  const lines = source().split("\n");
  const sites = [];

  lines.forEach(function (line, index) {
    if (line.indexOf("twoincCompanyCapture.write(") === -1) return;
    if (/^\s*(\*|\/\/)/.test(line)) return;
    sites.push({ line: index + 1, body: lines.slice(index, index + 60).join("\n") });
  });

  return sites;
}

describe("every capture path reaches the visibility rule", () => {
  test("there are call sites to check at all", () => {
    // Guard against the scan silently matching nothing and passing vacuously.
    expect(writeCallSites().length).toBeGreaterThanOrEqual(5);
  });

  test("each `capture.write()` re-evaluates the visible company-name surface", () => {
    const stranded = writeCallSites()
      .filter(function (site) {
        return site.body.indexOf("toggleBusinessFields()") === -1;
      })
      .map(function (site) {
        return "twoinc.js:" + site.line;
      });

    expect(stranded).toEqual([]);
  });
});
