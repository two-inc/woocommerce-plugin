/**
 * ABN-554. A remembered company belongs to the cart it was captured in — or,
 * on the pay-for-order page, to the order being paid — and is refused
 * anywhere else.
 *
 * Both remembering mechanisms are driven through the same table: the
 * server-side user-meta replay (`loadUserMetaInputs()`, fed by
 * `window.twoinc.company_scope`) and the `sessionStorage` snapshot
 * (`loadStorageInputs()`, stamped by `saveCheckoutInputs()`). Fixing one and
 * not the other leaves the defect reachable through the one left open.
 */

"use strict";

const harness = require("./wc-harness");

const CART = "cart:0123456789abcdef";
const OTHER_CART = "cart:fedcba9876543210";
const ORDER = "order:4021";
const OTHER_ORDER = "order:4022";

const NAME = "ACME Widgets Ltd";
const NUMBER = "12345678";

const SCOPE_CASES = [
  [CART, CART, true, "a reload of the same cart restores the capture"],
  [CART, OTHER_CART, false, "a capture from another cart is refused"],
  [ORDER, ORDER, true, "the order being paid restores its own capture"],
  [ORDER, OTHER_ORDER, false, "a capture from another order is refused"],
  [CART, ORDER, false, "a capture from an order is refused on the cart"],
  [ORDER, CART, false, "a capture from a cart is refused on the order"],
  [ORDER, "", false, "an unstamped capture is refused"],
  ["", CART, false, "a page that cannot name its scope restores nothing"]
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
    (pageScope, storedScope, restored, description) => {
      test("user meta: " + description, () => {
        load(pageScope, {
          company_scope: storedScope,
          billing_company: NAME,
          company_id: NUMBER
        });

        ctx.dom.loadUserMetaInputs();

        expect(ctx.$("#company_id").val()).toBe(restored ? NUMBER : "");
        expect(ctx.$("#billing_company").val()).toBe(restored ? NAME : "");
        expect(window.twoinc.user_meta_exists).toBe(restored);
      });

      test("sessionStorage: " + description, () => {
        load(pageScope);
        harness.seedCheckoutInputs(
          [
            { htmlTag: "INPUT", id: "billing_company", type: "text", val: NAME },
            { htmlTag: "INPUT", id: "company_id", type: "text", val: NUMBER }
          ],
          storedScope
        );

        ctx.dom.loadStorageInputs();

        expect(ctx.$("#company_id").val()).toBe(restored ? NUMBER : "");
        expect(ctx.$("#billing_company").val()).toBe(restored ? NAME : "");
        // A refused snapshot is dropped, not left for the next reader.
        expect(sessionStorage.getItem("checkoutInputs") === null).toBe(!restored);
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
});
