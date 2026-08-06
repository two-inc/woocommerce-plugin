/**
 * The harness's own contract, for the parts of it that tests rely on as evidence.
 *
 * `stubAjax()`'s abort bookkeeping earned a test of its own in review round 6: the
 * `settled` guard behind `abortedWhilePending` could be deleted without failing
 * anything, because no production path calls `abort()` on an already-settled request
 * — so the distinction it exists to draw was unreachable from the suites that depend
 * on it. Asserted directly instead.
 */

"use strict";

const harness = require("./wc-harness");

describe("stubAjax abort bookkeeping", () => {
  let ctx;
  let $;

  beforeEach(() => {
    ctx = harness.loadTwoinc({ text: {} });
    $ = ctx.$;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("aborting a PENDING request records both flags and fails it", () => {
    const ajax = harness.stubAjax($);
    try {
      const xhr = $.ajax({ url: "/x" });
      let failed = false;
      xhr.fail(function () {
        failed = true;
      });

      xhr.abort();

      expect(ajax.calls[0].aborted).toBe(true);
      expect(ajax.calls[0].abortedWhilePending).toBe(true);
      expect(failed).toBe(true);
    } finally {
      ajax.restore();
    }
  });

  test("aborting a SETTLED request is a no-op, as a real jqXHR's abort is", () => {
    // This is the whole point of the two flags: `aborted` says the call was made,
    // `abortedWhilePending` says a live request was actually cancelled. A test that
    // asserts only `aborted` proves the former and is routinely read as the latter.
    const ajax = harness.stubAjax($);
    try {
      const xhr = $.ajax({ url: "/x" });
      let failures = 0;
      xhr.fail(function () {
        failures += 1;
      });
      ajax.calls[0].succeed({ ok: true });

      xhr.abort();

      expect(ajax.calls[0].aborted).toBe(true);
      expect(ajax.calls[0].abortedWhilePending).toBe(false);
      // And the settled deferred is not re-rejected.
      expect(failures).toBe(0);
    } finally {
      ajax.restore();
    }
  });

  test("a failed request is settled too, so a later abort is a no-op", () => {
    const ajax = harness.stubAjax($);
    try {
      const xhr = $.ajax({ url: "/x" });
      ajax.calls[0].fail("error", "error");

      xhr.abort();

      expect(ajax.calls[0].abortedWhilePending).toBe(false);
    } finally {
      ajax.restore();
    }
  });
});
