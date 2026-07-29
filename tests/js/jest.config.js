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
  // The suite restores its own stubs by hand; these are the net for the next
  // test that forgets to, since a leaked spy on a shared helper fails
  // somewhere other than where it was created.
  restoreMocks: true,
  resetMocks: true
};
