import { test, expect, type Page } from "@playwright/test";

import { getOrder } from "../two-api.js";
import { checkout } from "../pages/renderer.js";
import * as store from "../pages/store.js";
import * as wpAdmin from "../pages/wp-admin.js";
import { resetCartShapes, setOption } from "../wp-cli.js";

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
