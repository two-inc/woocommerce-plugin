/** The browser replays only the company the server rendered the page with, and keeps no copy of its own. */

"use strict";

const harness = require("./wc-harness");

const NAME = "ACME Widgets Ltd";
const NUMBER = "12345678";

describe("the captured company lives in the WC session", () => {
  let ctx;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    if (ctx) harness.releasePanel(ctx.helper);
    sessionStorage.clear();
    document.body.innerHTML = "";
    ctx = null;
  });

  /** @param {Object} [meta] extra `window.twoinc` values */
  function load(meta) {
    ctx = harness.loadTwoinc(
      Object.assign(
        {
          remember_company_url: harness.REMEMBER_COMPANY_URL,
          enable_order_intent: "no",
          enable_address_lookup: "no"
        },
        meta || {}
      )
    );
    harness.buildCheckoutForm({ country: "GB" });
    ctx
      .$("#billing_company_field")
      .after(
        '<p id="billing_phone_field"><input type="tel" id="billing_phone" name="billing_phone" /></p>'
      );
    ctx.helper.attach();
    return ctx;
  }

  test("the company the page was rendered with is restored", () => {
    load({ billing_company: NAME, company_id: NUMBER, company_country: "GB" });

    ctx.dom.loadUserMetaInputs();

    expect(ctx.$("#company_id").val()).toBe(NUMBER);
    expect(ctx.$("#billing_company").val()).toBe(NAME);
  });

  test("a page rendered with no company restores none", () => {
    load();

    ctx.dom.loadUserMetaInputs();

    expect(ctx.$("#company_id").val()).toBe("");
    expect(ctx.$("#billing_company").val()).toBe("");
  });

  test("the snapshot the browser keeps never carries a company", () => {
    load();
    ctx.capture.write(NAME, NUMBER);
    ctx.$("#billing_phone").val("+447700900123");

    ctx.dom.saveCheckoutInputs();

    const stored = JSON.parse(sessionStorage.getItem("checkoutInputs"));
    const ids = stored.map((inp) => inp.id);
    ctx.capture.capturedFieldIds().forEach((id) => expect(ids).not.toContain(id));
    expect(ids).toContain("billing_phone");
  });

  test("a snapshot left by the release before this one restores no company", () => {
    load();
    harness.seedCheckoutInputs([
      { htmlTag: "INPUT", id: "billing_company", type: "text", val: NAME },
      { htmlTag: "INPUT", id: "company_id", type: "text", val: NUMBER },
      { htmlTag: "INPUT", id: "billing_phone", type: "tel", val: "+447700900123" }
    ]);

    ctx.dom.loadStorageInputs();

    expect(ctx.$("#company_id").val()).toBe("");
    expect(ctx.$("#billing_company").val()).toBe("");
    expect(ctx.$("#billing_phone").val()).toBe("+447700900123");
  });

  test("capturing a company hands it to the session, and clearing it takes it back", () => {
    load();
    const ajax = harness.stubAjax(ctx.$);

    try {
      ctx.capture.write(NAME, NUMBER);
      jest.runAllTimers();

      const sent = harness.requestParams(ajax.calls[ajax.calls.length - 1]);
      expect(ajax.calls[ajax.calls.length - 1].url).toBe(harness.REMEMBER_COMPANY_URL);
      expect(sent.get("company_id")).toBe(NUMBER);
      expect(sent.get("company_name")).toBe(NAME);
      // With the country it was captured under, so a replay keeps the pair (TWO-26286).
      expect(sent.get("country")).toBe("GB");

      ctx.capture.write("", "");
      jest.runAllTimers();

      const cleared = harness.requestParams(ajax.calls[ajax.calls.length - 1]);
      expect(cleared.get("company_id")).toBe("");
      expect(cleared.get("company_name")).toBe("");
    } finally {
      ajax.restore();
    }
  });

  /** Enter manually keeps the name and gives up the number, so a reload can only replay the name (TWO-26775). */
  test("Enter manually hands the session the name with no number", () => {
    load();
    const ajax = harness.stubAjax(ctx.$);

    try {
      ctx.capture.write(NAME, NUMBER);
      jest.runAllTimers();

      ctx.helper.enterManualCompanyEntry();
      jest.runAllTimers();

      const sent = harness.requestParams(ajax.calls[ajax.calls.length - 1]);
      expect(ajax.calls[ajax.calls.length - 1].url).toBe(harness.REMEMBER_COMPANY_URL);
      expect(sent.get("company_id")).toBe("");
      expect(sent.get("company_name")).toBe(NAME);
    } finally {
      ajax.restore();
    }
  });

  /** A reload inside the debounce would otherwise replay the number the buyer had just let go (TWO-26775). */
  test.each([
    { beacon: true, description: "by beacon" },
    { beacon: false, description: "by request where the browser has no beacon" }
  ])("a write still held by the debounce is sent as the page goes, $description", ({ beacon }) => {
    load();
    const ajax = harness.stubAjax(ctx.$);
    const sendBeacon = jest.fn(() => true);
    const original = navigator.sendBeacon;
    navigator.sendBeacon = beacon ? sendBeacon : undefined;

    try {
      ctx.capture.write(NAME, NUMBER);
      jest.runAllTimers();
      const before = ajax.calls.length;
      ctx.capture.write(NAME, "");

      window.dispatchEvent(new window.Event("pagehide"));
      jest.runAllTimers();

      // The last one: a module an earlier test loaded holds its own listener on this window.
      const sent = beacon
        ? sendBeacon.mock.calls[sendBeacon.mock.calls.length - 1][1]
        : harness.requestParams(ajax.calls[ajax.calls.length - 1]);
      expect(sent.get("company_id")).toBe("");
      expect(sent.get("company_name")).toBe(NAME);
      // Sent once: the debounce does not fire it a second time.
      expect(ajax.calls.length - before).toBe(beacon ? 0 : 1);
    } finally {
      navigator.sendBeacon = original;
      ajax.restore();
    }
  });

  test("a capture made on the pay-for-order page is handed to no cart", () => {
    load({ order_pay: true });
    const ajax = harness.stubAjax(ctx.$);

    try {
      ctx.capture.write(NAME, NUMBER);
      jest.runAllTimers();

      expect(ajax.calls.filter((c) => c.url === harness.REMEMBER_COMPANY_URL)).toEqual([]);
    } finally {
      ajax.restore();
    }
  });

  test("restoring what the page already carried posts nothing back", () => {
    load({ billing_company: NAME, company_id: NUMBER, company_country: "GB" });
    const ajax = harness.stubAjax(ctx.$);

    try {
      ctx.dom.loadUserMetaInputs();
      jest.runAllTimers();

      expect(ajax.calls.filter((c) => c.url === harness.REMEMBER_COMPANY_URL)).toEqual([]);
    } finally {
      ajax.restore();
    }
  });
});
