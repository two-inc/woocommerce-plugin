import { test, expect } from "@playwright/test";

import { triggerFulfilBatch, waitForOrderState } from "../checkout-api.js";
import * as checkout from "../pages/checkout.js";
import * as store from "../pages/store.js";
import * as wpAdmin from "../pages/wp-admin.js";

test("normal order flow: place → fulfil → refund", async ({ page }) => {
  const lastName = `E2EOrder${Date.now().toString(36)}`;
  await store.addProductToCart(page, "Product 1");
  await store.goToCheckout(page);

  await checkout.fillBillingDetails(page, "Test", lastName);
  await checkout.selectTwoPayment(page);
  await checkout.fillCompanySearch(page);
  const wcOrderId = await checkout.placeOrder(page);

  expect(wcOrderId).toBeTruthy();

  await wpAdmin.login(page);
  await wpAdmin.navigateToOrders(page);
  await wpAdmin.openOrder(page, lastName);

  const twoOrderId = await wpAdmin.getTwoOrderId(page);
  expect(twoOrderId).toBeTruthy();

  await waitForOrderState(twoOrderId, "CONFIRMED");

  await wpAdmin.changeOrderStatus(page, "Completed");
  await triggerFulfilBatch();
  await waitForOrderState(twoOrderId, "FULFILLED");

  await wpAdmin.refundOrder(page, 1);
  await waitForOrderState(twoOrderId, "REFUNDED");
});
