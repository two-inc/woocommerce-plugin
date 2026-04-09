import { test, expect } from "@playwright/test";

import { getOrderState, waitForOrderState } from "../checkout-api.js";
import * as checkout from "../pages/checkout.js";
import * as store from "../pages/store.js";
import * as wpAdmin from "../pages/wp-admin.js";

test("cancel order flow: place → cancel via WP admin", async ({ page }) => {
  const lastName = `E2ECancel${Date.now().toString(36)}`;
  await store.addProductToCart(page, "Product 2");
  await store.goToCheckout(page);

  await checkout.fillBillingDetails(page, "Test", lastName);
  await checkout.selectTwoPayment(page);
  await checkout.fillCompanySearch(page);
  await checkout.placeOrder(page);

  await wpAdmin.login(page);
  await wpAdmin.navigateToOrders(page);
  await wpAdmin.openOrder(page, lastName);

  const twoOrderId = await wpAdmin.getTwoOrderId(page);
  expect(await getOrderState(twoOrderId)).toBe("CONFIRMED");

  await wpAdmin.changeOrderStatus(page, "Cancelled");
  await waitForOrderState(twoOrderId, "CANCELLED");
});
