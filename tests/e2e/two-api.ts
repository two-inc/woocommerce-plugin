import { expect } from "@playwright/test";

import { API_BASE_URL, API_KEY, TWO_ADMIN_LOGIN, TWO_ADMIN_PASSWORD } from "./config.js";

const headers = {
  "X-API-Key": API_KEY,
  "Content-Type": "application/json"
};

export async function getOrder(orderId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE_URL}/v1/order/${orderId}`, { headers });
  if (!res.ok) throw new Error(`get order failed: ${res.status}`);
  return res.json();
}

export async function getOrderState(orderId: string): Promise<string> {
  const order = await getOrder(orderId);
  return order.state as string;
}

export async function waitForOrderState(
  orderId: string,
  expectedState: string,
  timeoutMs = 30_000,
  intervalMs = 1_000
): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          return (await getOrder(orderId)).state as string;
        } catch {
          return null;
        }
      },
      {
        message: `Order ${orderId} did not reach ${expectedState}`,
        timeout: timeoutMs,
        intervals: [intervalMs]
      }
    )
    .toBe(expectedState);
}

export async function verifyOrder(orderId: string): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/test/verify_order/${orderId}`, {
    method: "POST",
    headers
  });
  if (!res.ok) throw new Error(`verify order failed: ${res.status}`);
  const data = await res.json();
  return data.merchant_confirmation_url ?? "";
}

export async function confirmOrder(orderId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/v1/order/${orderId}/confirm`, {
    method: "POST",
    headers
  });
  if (!res.ok) throw new Error(`confirm order failed: ${res.status}`);
}

export async function cancelOrder(orderId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/v1/order/${orderId}/cancel`, {
    method: "POST",
    headers
  });
  if (!res.ok) throw new Error(`cancel order failed: ${res.status}`);
}

export async function triggerFulfilBatch(): Promise<void> {
  if (!TWO_ADMIN_PASSWORD) throw new Error("TWO_ADMIN_PASSWORD env var not set");
  const basic = Buffer.from(`${TWO_ADMIN_LOGIN}:${TWO_ADMIN_PASSWORD}`).toString("base64");
  const loginRes = await fetch(`${API_BASE_URL}/admin/v1/login`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}` }
  });
  if (!loginRes.ok) {
    const body = await loginRes.text();
    throw new Error(`admin login failed: ${loginRes.status} ${body}`);
  }

  const cookies = loginRes.headers.getSetCookie?.() ?? [];
  const cookieHeader = cookies.join("; ");

  const res = await fetch(`${API_BASE_URL}/v1/batch/order_fulfillment_batch`, {
    method: "POST",
    headers: { Cookie: cookieHeader }
  });
  if (!res.ok) throw new Error(`trigger fulfil batch failed: ${res.status}`);
}
