/**
 * The browser-side half of the firewall-token work: which checkout calls go
 * through the store's own wc-ajax proxy, and the single one that does not.
 *
 * The address lookup, the payment-terms lookup and the autofill read that stays
 * browser-direct are asserted here. Company search has its own file
 * (company-search-transport.test.js), and order intent lives with the rest of
 * its behaviour in intent-loading-state.test.js.
 */

"use strict";

const harness = require("./wc-harness");

describe("checkout API calls and the firewall-token proxy", () => {
  let ctx;
  let ajax;

  beforeEach(() => {
    ctx = harness.loadTwoinc();
    harness.buildCheckoutForm();
    ajax = harness.stubAjax(ctx.$);
  });

  afterEach(() => {
    ajax.restore();
    harness.releasePanel(ctx.helper);
    document.body.innerHTML = "";
  });

  describe("the registry address lookup", () => {
    test("addresses the proxy, and names the company in the body rather than the path", () => {
      // A lookup id in the URL path was what the API host took; the proxy takes
      // it as a parameter and rebuilds the path server-side, so a slash in an
      // id cannot retarget the request.
      ctx.Twoinc.getInstance().addressLookup({ lookup_id: "GB/12345678" });

      const request = ajax.last();
      const params = harness.requestParams(request);

      expect(request.url).toBe(harness.API_PROXY.company_by_id_url);
      expect(params.get("lookup_id")).toBe("GB/12345678");
      expect(params.get("csrf_token")).toBe(harness.API_PROXY.csrf_token);
    });
  });

  describe("the payment-terms lookup", () => {
    beforeEach(() => {
      ctx.Twoinc.getInstance().customerCompany = {
        organization_number: "12345678",
        country_prefix: "GB"
      };
    });

    test("addresses the proxy and carries the buyer, not the merchant", () => {
      // Merchant identity is resolved from the store's own settings. Accepting
      // it from the page would let a caller bill a lookup to another merchant.
      ctx.Twoinc.getInstance().getDueInDays();

      const request = ajax.last();
      const params = harness.requestParams(request);

      expect(request.url).toBe(harness.API_PROXY.payment_terms_url);
      expect(params.get("buyer_organization_number")).toBe("12345678");
      expect(params.get("country_prefix")).toBe("GB");
      expect(params.get("csrf_token")).toBe(harness.API_PROXY.csrf_token);
      expect(params.get("merchant_id")).toBeNull();
      expect(params.get("merchant_short_name")).toBeNull();
    });
  });

  test("the proxied calls never carry a custom header from the browser", () => {
    // They get them server-side in make_request(), flagged or not. A second
    // copy travelling from the page would be a header value in a buyer's
    // request for no gain.
    window.twoinc.custom_headers = { "X-WAF-TOKEN": "waf-token-1" };
    ctx.soleTrader.tokens = { custom_headers: { "X-WAF-TOKEN": "waf-token-1" } };
    ctx.Twoinc.getInstance().customerCompany = {
      organization_number: "12345678",
      country_prefix: "GB"
    };

    ctx.Twoinc.getInstance().addressLookup({ lookup_id: "12345678" });
    ctx.Twoinc.getInstance().getDueInDays();

    expect(ajax.calls.length).toBeGreaterThan(0);
    ajax.calls.forEach((record) => {
      expect(record.settings.headers).toBeUndefined();
      expect(JSON.stringify(record.settings)).not.toContain("waf-token-1");
    });
  });

  describe("the sole-trader autofill read stays browser-direct", () => {
    let fetchMock;

    beforeEach(() => {
      fetchMock = jest.fn(() => Promise.resolve({ ok: false, status: 404 }));
      global.fetch = fetchMock;
      ctx.soleTrader.tokens = { autofill_token: "autofill" };
    });

    afterEach(() => {
      delete global.fetch;
    });

    test("goes to the API host with credentials, not through the proxy", () => {
      // The subject is whoever holds the API-domain cookie the hosted signup
      // set, which no server hop carries — proxying resolves no buyer at all.
      ctx.soleTrader.fetchCurrentBuyer(function () {});

      const [url, options] = fetchMock.mock.calls[0];

      expect(url).toBe("https://api.example.test/autofill/v1/buyer/current");
      expect(options.credentials).toBe("include");
      expect(options.headers["two-delegated-authority-token"]).toBe("autofill");
    });

    test("sends no custom header by default, whatever the page holds", () => {
      // Default state: the server withheld the headers, so none are sent — and
      // a value on the bootstrap is not a back door into sending one.
      window.twoinc.custom_headers = { "X-WAF-TOKEN": "waf-token-1" };

      ctx.soleTrader.fetchCurrentBuyer(function () {});

      const headers = fetchMock.mock.calls[0][1].headers;
      expect(Object.keys(headers)).toEqual(["two-delegated-authority-token"]);
      expect(JSON.stringify(headers)).not.toContain("waf-token-1");
    });

    test.each([
      {
        minted: { "X-WAF-TOKEN": "waf-token-1" },
        expected: { "X-WAF-TOKEN": "waf-token-1" },
        description: "an opted-in merchant's header is sent"
      },
      {
        minted: { "X-WAF-TOKEN": "waf-token-1", "X-Tenant": "tenant-7" },
        expected: { "X-WAF-TOKEN": "waf-token-1", "X-Tenant": "tenant-7" },
        description: "every flagged header is sent, not just the first"
      },
      { minted: {}, expected: {}, description: "an empty map sends no header" },
      { minted: undefined, expected: {}, description: "no minted map sends no header" }
    ])("$description", ({ minted, expected }) => {
      // The opt-in is decided server-side: a header is in the mint response or
      // it is not, and this call carries it only in the former case.
      ctx.soleTrader.tokens.custom_headers = minted;

      ctx.soleTrader.fetchCurrentBuyer(function () {});

      const headers = fetchMock.mock.calls[0][1].headers;
      expect(headers).toEqual({
        "two-delegated-authority-token": "autofill",
        ...expected
      });
    });
  });
});
