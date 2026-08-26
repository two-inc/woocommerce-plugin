import { test, expect } from "@playwright/test";

import { LONG_TIMEOUT } from "../config.js";
import * as checkout from "../pages/checkout.js";
import * as store from "../pages/store.js";

test("company search request carries client, client_v and merchant params", async ({ page }) => {
  await store.addProductToCart(page, "Product 1");
  await store.goToCheckout(page);
  await checkout.selectTwoPayment(page);

  // fillCompanySearch retries up to 3x on its own timeouts, so give the request a matching budget.
  const searchRequest = page.waitForRequest((req) => req.url().includes("/companies/v2/company"), {
    timeout: LONG_TIMEOUT
  });
  await checkout.fillCompanySearch(page);
  const url = new URL((await searchRequest).url());

  expect(url.searchParams.get("client")).toBeTruthy();
  expect(url.searchParams.get("client_v")).toBeTruthy();
  expect(url.searchParams.get("merchant")).toBeTruthy();
});
