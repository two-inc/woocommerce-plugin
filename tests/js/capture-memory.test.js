/** ABN-554. The browser replays only the company the server rendered the page with, and keeps no copy of its own. */

"use strict";

const harness = require("./wc-harness");

const NAME = "ACME Widgets Ltd";
const NUMBER = "12345678";

describe("ABN-554 — the captured company lives in the WC session", () => {
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
      .after('<p id="billing_phone_field"><input type="tel" id="billing_phone" name="billing_phone" /></p>');
    ctx.helper.attach();
    return ctx;
  }

  test("the company the page was rendered with is restored", () => {
    load({ billing_company: NAME, company_id: NUMBER });

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

      ctx.capture.write("", "");
      jest.runAllTimers();

      const cleared = harness.requestParams(ajax.calls[ajax.calls.length - 1]);
      expect(cleared.get("company_id")).toBe("");
      expect(cleared.get("company_name")).toBe("");
    } finally {
      ajax.restore();
    }
  });

  test("restoring what the page already carried posts nothing back", () => {
    load({ billing_company: NAME, company_id: NUMBER });
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
