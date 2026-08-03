/**
 * Jest config for the plugin's browser JS.
 *
 * Mirrors prestashop-plugin's tests/js/jest.config.js (itself mirroring
 * magento-plugin's Test/Js/jest.config.js): config lives next to the tests,
 * rootDir points back at the repo root so tests read the shipped source files
 * by their real repo-relative paths, and jsdom supplies the document jQuery
 * and selectWoo need.
 *
 * tests/e2e/ is a separate Playwright project with its own package.json, so
 * testMatch is deliberately narrow rather than a repo-wide glob.
 */

module.exports = {
  rootDir: "../..",
  testMatch: ["<rootDir>/tests/js/**/*.test.js"],
  testEnvironment: "jsdom",
  // Most of the suite stubs jQuery.ajax by hand and restores it in afterEach.
  // These two are the net under the tests that do reach for jest.spyOn — the
  // deferred-init suite spies on `Twoinc.prototype.enableCompanySearch` — since
  // a leaked spy on a shared prototype or helper object fails somewhere other
  // than where it was created. Both fire before each test, so a spy created
  // inside a test body still calls through.
  restoreMocks: true,
  resetMocks: true
};
