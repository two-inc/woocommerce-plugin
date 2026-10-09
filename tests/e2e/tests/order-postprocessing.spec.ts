import { test, expect, type Page } from "@playwright/test";

import { getOrder } from "../two-api.js";
import { checkout } from "../pages/renderer.js";
import * as store from "../pages/store.js";
import * as wpAdmin from "../pages/wp-admin.js";
import { resetCartShapes, setOption, wp } from "../wp-cli.js";

// TWO-26092. The intent is composed server-side from the real cart through WooCommerce's own checkout, and
// the shapes below are the ones that path has to get right. docker/mu-plugins/two-e2e-carts.php makes them.
const SHAPE_OPTION = "two_e2e_cart_shape";
const SUBSCRIBER_OPTION = "twoinc_order_postprocessing_fixture";

test.describe.configure({ mode: "serial" });

test.afterEach(() => {
  resetCartShapes();
});

async function fillCart(page: Page, products: string[]) {
  for (const product of products) {
    await store.addProductToCart(page, product);
  }
}

type Line = Record<string, string>;
const ofType = (lines: Line[], type: string) => lines.filter((line) => line.type === type);

// [cart shape, products, what the intent's lines must show of it, description]
const carts: [string, string[], (lines: Line[]) => boolean, string][] = [
  [
    "taxes,coupon",
    ["Product 1"],
    (lines) => Number(ofType(lines, "PHYSICAL")[0].discount_amount) > 0,
    "a coupon"
  ],
  [
    "taxes,fee",
    ["Product 1"],
    (lines) => ofType(lines, "SERVICE")[0]?.tax_amount === "1.00",
    "a taxed fee"
  ],
  [
    "taxes,packages",
    ["Product 1", "Product 2"],
    (lines) => ofType(lines, "SHIPPING_FEE").length === 2,
    "two shipping packages"
  ],
  [
    "taxes,inclusive",
    ["Product 1"],
    // Shipping costs are entered net of tax either way; a product's price includes it here.
    (lines) =>
      ofType(lines, "SHIPPING_FEE")[0]?.tax_amount === "5.80" &&
      ofType(lines, "PHYSICAL")[0].tax_rate === "0.200000",
    "tax-inclusive prices"
  ],
  [
    "taxes,exempt",
    ["Product 1"],
    (lines) => lines.every((line) => line.tax_amount === "0.00"),
    "a VAT-exempt buyer"
  ]
];

for (const [shape, products, check, description] of carts) {
  test(`order intent answers with a verdict for a cart with ${description}`, async ({ page }) => {
    // No order is placed, so a leg needs less than the suite's default; the job ceiling counts on this.
    test.setTimeout(120_000);
    setOption(SHAPE_OPTION, shape);
    await fillCart(page, products);
    await checkout.goto(page);

    const intent = page.waitForResponse((r) => r.url().includes("wc-ajax=two_order_intent"), {
      timeout: 60_000
    });
    await checkout.completeCheckoutForm(page, "Test", `E2EIntent${Date.now().toString(36)}`);
    const response = await intent;

    const body = await response.json();
    expect(response.ok(), `${description}: ${response.status()} ${JSON.stringify(body)}`).toBe(
      true
    );
    expect(typeof body.approved, description).toBe("boolean");
    expect(check(body.line_items), `${description}: ${JSON.stringify(body.line_items)}`).toBe(true);
  });
}

test("a subscriber re-splits untaxed shipping and the order is placed", async ({ page }) => {
  // Shipping recorded untaxed while the shop's shipping tax setting resolves to 20%.
  setOption(SHAPE_OPTION, "taxes,untaxed");
  setOption(SUBSCRIBER_OPTION, "resplit");
  const lastName = `E2EResplit${Date.now().toString(36)}`;
  await fillCart(page, ["Product 1"]);
  await checkout.goto(page);
  await checkout.completeCheckoutForm(page, "Test", lastName);
  expect(await checkout.placeOrder(page)).toBeTruthy();

  await wpAdmin.login(page);
  await wpAdmin.navigateToOrders(page);
  await wpAdmin.openOrder(page, lastName);
  const order = await getOrder(await wpAdmin.getTwoOrderId(page));
  const lines = order.line_items as Record<string, string>[];
  const shipping = lines.find((line) => line.type === "SHIPPING_FEE");

  // 29.00 at 20%, gross unchanged: 24.17 net + 4.83 tax.
  expect(shipping && [shipping.net_amount, shipping.tax_amount, shipping.gross_amount]).toEqual([
    "24.17",
    "4.83",
    "29.00"
  ]);
});

// TWO-26275. The plugin's default handler on the hook runs the shop-match check, here the shipping tax control's
// reconcile, unless a merchant handler is registered; a merchant handler can opt back in.
const CONTROL_OPTION = "twoinc_shipping_tax_from_shop_rates";
const LOCAL_REFUSAL = "Order intent refused";

async function checkIntent(page: Page, products: string[] = ["Product 1"]) {
  await fillCart(page, products);
  await checkout.goto(page);
  const intent = page.waitForResponse((r) => r.url().includes("wc-ajax=two_order_intent"), {
    timeout: 60_000
  });
  const lastName = `E2EHook${Date.now().toString(36)}`;
  await checkout.completeCheckoutForm(page, "Test", lastName);
  const response = await intent;
  return { status: response.status(), body: await response.json(), lastName };
}

// [cart shape, subscriber mode ("" for none), refused locally, description]
const shopMatch: [string, string, boolean, string][] = [
  ["taxes,rowless", "", false, "no subscriber, shipping tax that reconciles: sent"],
  [
    "taxes,rowless,skewed",
    "",
    true,
    "no subscriber, shipping tax that does not reconcile: refused"
  ],
  ["taxes,rowless,skewed", "record", false, "a subscriber: the check stands down and it is sent"],
  ["taxes,rowless,skewed", "checked", true, "a subscriber opting back in: refused"]
];

for (const [shape, subscriber, refused, description] of shopMatch) {
  test(`order intent with the shipping tax control on: ${description}`, async ({ page }) => {
    test.setTimeout(120_000);
    setOption(SHAPE_OPTION, shape);
    setOption(CONTROL_OPTION, "yes");
    if (subscriber) {
      setOption(SUBSCRIBER_OPTION, subscriber);
    }
    const { status, body } = await checkIntent(page);
    const local = status === 500 && body.data === LOCAL_REFUSAL;
    expect(local, `${description}: ${status} ${JSON.stringify(body)}`).toBe(refused);
    if (!refused && shape === "taxes,rowless") {
      const shipping = ofType(body.line_items, "SHIPPING_FEE")[0];
      expect([shipping?.tax_rate, shipping?.tax_amount], description).toEqual(["0.200000", "5.80"]);
    }
  });
}

test("a subscriber that changes gross is sent as returned", async ({ page }) => {
  test.setTimeout(120_000);
  setOption(SHAPE_OPTION, "taxes,untaxed");
  setOption(SUBSCRIBER_OPTION, "gross");
  const { status, body } = await checkIntent(page);
  expect(status >= 200 && status < 300, `${status} ${JSON.stringify(body)}`).toBe(true);
  expect(ofType(body.line_items, "SHIPPING_FEE")[0]?.gross_amount).toBe("30.00");
});

test("a subscriber adds a line for a cost outside the carrier, sent at intent, create and update", async ({
  page
}) => {
  // 10.00 on the cart total that no line carries: the subscriber sends it as its own line at 21%.
  setOption(SHAPE_OPTION, "taxes,surcharge");
  setOption(SUBSCRIBER_OPTION, "extra_line");
  const handling = (lines: Line[]) =>
    lines.find((line) => line.name === "Handling") ?? ({} as Line);
  const split = (line: Line) => [
    line.net_amount,
    line.tax_amount,
    line.gross_amount,
    line.tax_rate
  ];
  const expected = ["8.26", "1.74", "10.00", "0.210000"];

  const { status, body, lastName } = await checkIntent(page);
  expect(status >= 200 && status < 300, `${status} ${JSON.stringify(body)}`).toBe(true);
  expect(split(handling(body.line_items)), "intent").toEqual(expected);

  const orderId = await checkout.placeOrder(page);
  const twoOrderId = wp(
    "eval",
    `echo wc_get_order(${Number(orderId)})->get_meta('twoinc_order_id');`
  ).trim();
  const created = await getOrder(twoOrderId);
  expect(split(handling(created.line_items as Line[])), "create").toEqual(expected);

  // An admin edit the plugin sends as an order update. The address is changed from WP-CLI, which does not load
  // the e2e mu-plugin and so has no subscriber, and the order is then saved from its admin screen, which does.
  wp(
    "eval",
    `$o = wc_get_order(${Number(orderId)}); $o->set_billing_city('E2E Updated'); $o->save();`
  );
  await wpAdmin.login(page);
  await wpAdmin.navigateToOrders(page);
  await wpAdmin.openOrder(page, lastName);
  await page.locator("button.save_order").click();
  await page.waitForLoadState("load");
  // The plugin notes an update the API accepted, and its reason when the API refused one.
  const notes = wp(
    "eval",
    `echo implode(' | ', wp_list_pluck(wc_get_order_notes(['order_id' => ${Number(
      orderId
    )}, 'limit' => 3]), 'content'));`
  );
  expect(notes, "update sent and accepted").toContain("order edit request has been accepted");
  const updated = await getOrder(twoOrderId);
  expect(split(handling(updated.line_items as Line[])), "update").toEqual(expected);
});
