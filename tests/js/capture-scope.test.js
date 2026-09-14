/** ABN-554. A remembered company replays in the cart it was captured in and the order it was captured on, nowhere else. */

"use strict";

const harness = require("./wc-harness");

const CART = "cart:0123456789abcdef";
const OTHER_CART = "cart:fedcba9876543210";
const ORDER = "order:4021";
const OTHER_ORDER = "order:4022";

// What WC_Twoinc::process_payment() stamps on the user meta: the order, and
// the cart that became it.
const ORDER_AND_ITS_CART = ORDER + " " + CART;

const NAME = "ACME Widgets Ltd";
const NUMBER = "12345678";

// page scope, remembered scope, user-meta replay, snapshot replay, description
const SCOPE_CASES = [
  [CART, CART, true, true, "a reload of the same cart restores the capture"],
  [CART, OTHER_CART, false, false, "a capture from another cart is refused"],
  [ORDER, ORDER, true, true, "the order being paid restores its own capture"],
  [ORDER, OTHER_ORDER, false, false, "a capture from another order is refused"],
  [CART, ORDER, false, false, "a capture from another order is refused on a cart"],
  [ORDER, CART, false, false, "a capture from another cart is refused on an order"],
  [
    CART,
    ORDER_AND_ITS_CART,
    true,
    true,
    "the cart that became the order still restores the capture"
  ],
  [
    ORDER,
    ORDER_AND_ITS_CART,
    true,
    true,
    "the order restores the capture made in the cart that became it"
  ],
  [OTHER_CART, ORDER_AND_ITS_CART, false, false, "the next cart in the same session is refused"],
  [ORDER, "", true, false, "an unstamped record is the merchant's own, not a capture"],
  ["", CART, false, false, "a page that cannot name its scope restores nothing"]
];

describe("ABN-554 — a remembered capture is scoped to its cart or order", () => {
  let ctx;

  afterEach(() => {
    if (ctx) harness.releasePanel(ctx.helper);
    sessionStorage.clear();
    document.body.innerHTML = "";
    ctx = null;
  });

  /**
   * @param {string} pageScope the scope the page bootstraps with
   * @param {Object} [meta] extra `window.twoinc` values
   */
  function load(pageScope, meta) {
    ctx = harness.loadTwoinc(
      Object.assign(
        {
          capture_scope: pageScope,
          enable_order_intent: "no",
          enable_address_lookup: "no"
        },
        meta || {}
      )
    );
    harness.buildCheckoutForm({ country: "GB" });
    ctx.helper.attach();
    return ctx;
  }

  describe.each(SCOPE_CASES)(
    "page %s, remembered %s",
    (pageScope, storedScope, metaRestored, snapshotRestored, description) => {
      test("user meta: " + description, () => {
        load(pageScope, {
          company_scope: storedScope,
          billing_company: NAME,
          company_id: NUMBER
        });

        ctx.dom.loadUserMetaInputs();

        expect(ctx.$("#company_id").val()).toBe(metaRestored ? NUMBER : "");
        expect(ctx.$("#billing_company").val()).toBe(metaRestored ? NAME : "");
        expect(window.twoinc.user_meta_exists).toBe(metaRestored);
      });

      test("sessionStorage: " + description, () => {
        load(pageScope);
        harness.seedCheckoutInputs(
          [
            { htmlTag: "INPUT", id: "billing_company", type: "text", val: NAME },
            { htmlTag: "INPUT", id: "company_id", type: "text", val: NUMBER },
            { htmlTag: "INPUT", id: "billing_phone", type: "tel", val: "+447700900123" }
          ],
          storedScope
        );

        ctx.dom.loadStorageInputs();

        expect(ctx.$("#company_id").val()).toBe(snapshotRestored ? NUMBER : "");
        expect(ctx.$("#billing_company").val()).toBe(snapshotRestored ? NAME : "");
      });
    }
  );

  test("saveCheckoutInputs stamps the page's own scope", () => {
    load(ORDER);
    ctx.$("#billing_company").val(NAME);

    ctx.dom.saveCheckoutInputs();

    expect(sessionStorage.getItem("twoincCaptureScope")).toBe(ORDER);
  });

  test("a capture saved on this page is restored by the next load of it", () => {
    load(CART);
    ctx.capture.write(NAME, NUMBER);
    ctx.dom.saveCheckoutInputs();
    harness.releasePanel(ctx.helper);

    load(CART);
    ctx.dom.loadStorageInputs();

    expect(ctx.$("#company_id").val()).toBe(NUMBER);
    expect(ctx.$("#billing_company").val()).toBe(NAME);
  });

  test("a refused snapshot keeps every field but the company", () => {
    load(CART);
    ctx
      .$("#billing_company_field")
      .after(
        '<p id="billing_phone_field"><input type="tel" id="billing_phone" name="billing_phone" value="" /></p>'
      );
    harness.seedCheckoutInputs(
      [
        { htmlTag: "INPUT", id: "billing_company", type: "text", val: NAME },
        { htmlTag: "INPUT", id: "company_id", type: "text", val: NUMBER },
        { htmlTag: "INPUT", id: "billing_phone", type: "tel", val: "+447700900123" }
      ],
      OTHER_CART
    );

    ctx.dom.loadStorageInputs();

    expect(ctx.$("#billing_phone").val()).toBe("+447700900123");
    expect(JSON.parse(sessionStorage.getItem("checkoutInputs")).map((inp) => inp.id)).toEqual([
      "billing_phone"
    ]);
  });

  test("a refused snapshot takes its capture mode with it", () => {
    load(CART);
    harness.seedCheckoutInputs(
      [{ htmlTag: "INPUT", id: "company_id", type: "text", val: NUMBER }],
      OTHER_CART
    );
    sessionStorage.setItem("twoincCaptureMode", JSON.stringify({ mode: "sole_trader", tag: "t" }));
    sessionStorage.setItem(
      "twoincCaptureMode_shipping",
      JSON.stringify({ mode: "search", tag: "t" })
    );

    ctx.dom.loadStorageInputs();

    expect(sessionStorage.getItem("twoincCaptureMode")).toBe(null);
    expect(sessionStorage.getItem("twoincCaptureMode_shipping")).toBe(null);
  });

  test("a page with no scope of its own leaves the snapshot for the page that has one", () => {
    load("");
    harness.seedCheckoutInputs(
      [{ htmlTag: "INPUT", id: "company_id", type: "text", val: NUMBER }],
      CART
    );

    ctx.dom.loadStorageInputs();
    harness.releasePanel(ctx.helper);

    expect(sessionStorage.getItem("twoincCaptureScope")).toBe(CART);

    load(CART);
    ctx.dom.loadStorageInputs();

    expect(ctx.$("#company_id").val()).toBe(NUMBER);
  });
});
