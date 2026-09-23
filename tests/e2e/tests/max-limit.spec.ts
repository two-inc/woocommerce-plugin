import { test } from "@playwright/test";

import { checkout } from "../pages/renderer.js";
import * as store from "../pages/store.js";

test("max limit: excessive quantity is rejected", async ({ page }) => {
  await store.addProductToCart(page, "Expensive Product");
  await checkout.goto(page);

  await checkout.fillBuyerDetails(page, "Test", "E2EMaxLimit");
  await checkout.selectTwoPayment(page);
  await checkout.fillCompanySearch(page);
  await checkout.expectRejection(page);
});
