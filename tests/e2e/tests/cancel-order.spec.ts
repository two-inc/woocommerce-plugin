import { test, expect } from "@playwright/test";

import { getOrderState } from "../checkout-api.js";
import * as checkout from "../pages/checkout.js";
import * as store from "../pages/store.js";
import * as wpAdmin from "../pages/wp-admin.js";

test("cancel order flow: place → cancel via WP admin", async ({ page }) => {
  await store.addProductToCart(page, "Product 2");
  await store.goToCheckout(page);

  await checkout.fillBillingDetails(page, "Test", "E2ECancel");
  await checkout.selectTwoPayment(page);
  await checkout.fillCompanySearch(page);
  await checkout.placeOrder(page);

  await wpAdmin.login(page);
  await wpAdmin.navigateToOrders(page);
  await wpAdmin.openOrder(page, "E2ECancel");

  const twoOrderId = await wpAdmin.getTwoOrderId(page);
  expect(await getOrderState(twoOrderId)).toBe("CONFIRMED");

  await wpAdmin.changeOrderStatus(page, "Cancelled");
  expect(await getOrderState(twoOrderId)).toBe("CANCELLED");
});
