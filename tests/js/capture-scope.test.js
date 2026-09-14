/** ABN-554. A remembered company replays in the cart it was captured in and the order it was captured on, nowhere else. */

"use strict";

const harness = require("./wc-harness");
// Emitted by CaptureScopeSpec in tests/unit/run.php, so the stamp format
// crosses the PHP/JS boundary once instead of being hand-written on each side.
const fixture = require("./fixtures/capture-scope.generated.json");

const ORDER_AND_ITS_CART = fixture.order_scopes;
const [ORDER, CART] = ORDER_AND_ITS_CART.split(/\s+/);
if (CART !== fixture.cart_scope) {
  throw new Error(
    "capture-scope fixture: the order stamp the server emits no longer lists its cart as a " +
      "space-separated element - reconcile this suite with WC_Twoinc_Checkout::capture_scopes_for_order()"
  );
}

const SCOPE_ADMIN = fixture.scope_admin;
const SCOPE_NONE = fixture.scope_none;

const OTHER_CART = "cart:fedcba9876543210";
const OTHER_ORDER = "order:4022";

const NAME = "ACME Widgets Ltd";
const NUMBER = "12345678";

// page scope, remembered scope, user-meta replay, snapshot replay, description
const SCOPE_CASES = [
  [CART, CART, true, true, "a reload of the same cart restores the capture"],
  [CART, OTHER_CART, false, false, "a capture from another cart is refused"],
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
  [CART, SCOPE_ADMIN, true, false, "a company the merchant typed into the profile prefills"],
  [CART, SCOPE_NONE, false, false, "a record marked replayable nowhere is refused"],
  [CART, "", false, false, "a record predating the stamp is refused, not read as the merchant's"],
  [CART, "  " + CART + "  ", true, true, "padding around the stamp changes nothing"],
  [CART, CART + "  " + OTHER_CART, true, true, "one element of the list is enough"],
  [CART, CART.slice(0, -1), false, false, "a prefix of this page's scope is not this page"],
  [CART, CART + "0", false, false, "this page's scope as a prefix of another is not this page"],
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

  test("every company field a capture can write is one a refused snapshot loses", () => {
    load(CART);
    const companyIds = ctx.captureScope.companyFieldIds();
    // The fields the server registers, plus the tile input the page mints:
    // a field added to either that the gate does not know would restore a
    // captured company into the next cart.
    fixture.registered_company_fields.forEach((id) => expect(companyIds).toContain(id));
    expect(companyIds).toContain(ctx.helper.tileFieldSelector.replace("#", ""));

    harness.seedCheckoutInputs(
      companyIds
        .map((id) => ({ htmlTag: "INPUT", id: id, type: "text", val: NAME }))
        .concat([{ htmlTag: "INPUT", id: "billing_phone", type: "tel", val: "+447700900123" }]),
      OTHER_CART
    );

    expect(ctx.dom.storedCheckoutInputs().map((inp) => inp.id)).toEqual(["billing_phone"]);
  });

  test("a refused snapshot keeps the address the buyer typed", () => {
    load(CART);
    ctx
      .$("#billing_company_field")
      .after(
        '<p id="billing_phone_field"><input type="tel" id="billing_phone" name="billing_phone" value="" /></p>'
      );
    const seeded = [
      { htmlTag: "INPUT", id: "billing_company", type: "text", val: NAME },
      { htmlTag: "INPUT", id: "company_id", type: "text", val: NUMBER },
      { htmlTag: "INPUT", id: "billing_phone", type: "tel", val: "+447700900123" }
    ];
    harness.seedCheckoutInputs(seeded, OTHER_CART);

    ctx.dom.loadStorageInputs();

    expect(ctx.$("#billing_phone").val()).toBe("+447700900123");
  });

  test("reading a refused snapshot leaves it where it was, for the cart it belongs to", () => {
    load(CART);
    const seeded = [
      { htmlTag: "INPUT", id: "billing_company", type: "text", val: NAME },
      { htmlTag: "INPUT", id: "billing_phone", type: "tel", val: "+447700900123" }
    ];
    harness.seedCheckoutInputs(seeded, OTHER_CART);

    ctx.dom.loadStorageInputs();
    ctx.dom.getCheckoutInput("INPUT", "tel", "billing_phone");

    expect(JSON.parse(sessionStorage.getItem("checkoutInputs"))).toEqual(seeded);
    expect(sessionStorage.getItem("twoincCaptureScope")).toBe(OTHER_CART);
  });

  test("a refused snapshot restores no capture mode, because it restores no pair to hold one", () => {
    load(CART);
    harness.seedCheckoutInputs(
      [
        { htmlTag: "INPUT", id: "billing_company", type: "text", val: NAME },
        { htmlTag: "INPUT", id: "company_id", type: "text", val: NUMBER }
      ],
      OTHER_CART
    );
    sessionStorage.setItem(
      "twoincCaptureMode",
      JSON.stringify({ mode: "sole_trader", tag: ctx.capture.pairingTag(NAME, NUMBER) })
    );

    ctx.dom.loadStorageInputs();
    ctx.dom.restoreCapturedCompany();

    expect(ctx.soleTrader.soleTraderAdopted).toBe(false);
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
