import { test, expect } from "@playwright/test";

import * as checkout from "../pages/checkout.js";
import * as store from "../pages/store.js";

test("company search request carries client, client_v and merchant params", async ({ page }) => {
  await store.addProductToCart(page, "Product 1");
  await store.goToCheckout(page);
  await checkout.selectTwoPayment(page);

  const searchRequest = page.waitForRequest((req) => req.url().includes("/companies/v2/company"));
  await checkout.fillCompanySearch(page);
  const url = new URL((await searchRequest).url());

  expect(url.searchParams.get("client")).toBeTruthy();
  expect(url.searchParams.get("client_v")).toBeTruthy();
  expect(url.searchParams.get("merchant")).toBeTruthy();
});
