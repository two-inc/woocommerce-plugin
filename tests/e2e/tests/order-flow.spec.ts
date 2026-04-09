import { test, expect } from "@playwright/test";

import { getOrderState, triggerFulfilBatch, waitForOrderState } from "../checkout-api.js";
import * as checkout from "../pages/checkout.js";
import * as store from "../pages/store.js";
import * as wpAdmin from "../pages/wp-admin.js";

test("normal order flow: place → fulfil → refund", async ({ page }) => {
  await store.addProductToCart(page, "Product 1");
  await store.goToCheckout(page);

  await checkout.fillBillingDetails(page, "Test", "E2EOrder");
  await checkout.selectTwoPayment(page);
  await checkout.fillCompanySearch(page);
  const wcOrderId = await checkout.placeOrder(page);

  expect(wcOrderId).toBeTruthy();

  await wpAdmin.login(page);
  await wpAdmin.navigateToOrders(page);
  await wpAdmin.openOrder(page, "E2EOrder");

  const twoOrderId = await wpAdmin.getTwoOrderId(page);
  expect(twoOrderId).toBeTruthy();

  expect(await getOrderState(twoOrderId)).toBe("CONFIRMED");

  await wpAdmin.changeOrderStatus(page, "Completed");
  await triggerFulfilBatch();
  expect(await getOrderState(twoOrderId)).toBe("FULFILLED");

  await wpAdmin.refundOrder(page, 1);
  await waitForOrderState(twoOrderId, "REFUNDED");
});
