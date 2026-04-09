import { test } from "@playwright/test";

import * as checkout from "../pages/checkout.js";
import * as store from "../pages/store.js";

test("max limit: excessive quantity is rejected", async ({ page }) => {
  await store.addProductToCart(page, "Expensive Product");
  await store.goToCheckout(page);

  await checkout.fillBillingDetails(page, "Test", "E2EMaxLimit");
  await checkout.selectTwoPayment(page);
  await checkout.fillCompanySearch(page);
  await checkout.expectRejection(page);
});
