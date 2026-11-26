import { test, expect } from "@playwright/test";

import { API_KEY, BUYER_COMPANY, PHONE_NUMBER, RECIPIENT_EMAIL } from "../config.js";
import { cancelOrderQuietly, createOrder } from "../two-api.js";

// TWO-26325. A canary on Two's staging API: an order whose lines do not add up to its totals is refused.
// The plugin leaves that arithmetic to the API, so if staging ever stops refusing it, this says so.

const address = {
  organization_name: BUYER_COMPANY,
  street_address: "1 Test Street",
  postal_code: "EC1A 1BB",
  city: "London",
  region: "",
  country: "GB"
};

// One line of 100.00 net and 20.00 tax; each total is far outside any rounding.
const body = {
  currency: "GBP",
  net_amount: "200.00",
  tax_amount: "40.00",
  gross_amount: "240.00",
  discount_amount: "0.00",
  buyer: {
    company: { company_name: BUYER_COMPANY, country_prefix: "GB", organization_number: "15717462" },
    representative: {
      email: RECIPIENT_EMAIL,
      first_name: "E2E",
      last_name: "Buyer",
      phone_number: PHONE_NUMBER
    }
  },
  billing_address: address,
  shipping_address: address,
  line_items: [
    {
      name: "Canary item",
      description: "",
      gross_amount: "120.00",
      net_amount: "100.00",
      discount_amount: "0.00",
      tax_amount: "20.00",
      tax_class_name: "VAT 20%",
      tax_rate: "0.20",
      unit_price: "100.00",
      quantity: 1,
      quantity_unit: "item",
      type: "PHYSICAL"
    }
  ],
  tax_subtotals: [{ tax_amount: "20.00", tax_rate: "0.20", taxable_amount: "100.00" }],
  merchant_urls: {
    merchant_confirmation_url: "https://example.com/confirm",
    merchant_cancel_order_url: "https://example.com/cancel"
  }
};

test("staging refuses an order whose lines do not add up to its totals", async () => {
  expect(API_KEY, "MERCHANT_API_KEY is not set: this test needs the staging merchant key").not.toBe(
    ""
  );

  const { status, body: answer } = await createOrder({
    ...body,
    merchant_order_id: `two-e2e-amounts-${Date.now()}`
  });

  try {
    expect(
      [status, answer.error_code],
      `Expected staging to refuse an order whose lines do not add up to its totals with 400 ` +
        `INVALID_ORDER_AMOUNT_DATA, and it answered ${status}. If it accepted the order, its order amount ` +
        `validation may have been switched off (TWO-26325). Response: ${JSON.stringify(answer)}`
    ).toEqual([400, "INVALID_ORDER_AMOUNT_DATA"]);
  } finally {
    if (status >= 200 && status < 300 && typeof answer.id === "string") {
      await cancelOrderQuietly(answer.id);
    }
  }
});

// Offline: the clean-up runs in a finally, so a cancel that throws would replace the canary's message above.
test("a failed clean-up cancel does not replace the canary's own failure", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  try {
    await expect(cancelOrderQuietly("o1")).resolves.toBeUndefined();
  } finally {
    globalThis.fetch = realFetch;
  }
});
