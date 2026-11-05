import { type Page, test, expect } from "@playwright/test";

import { STORE_URL } from "../config.js";
import { cancelOrder, getOrderState, verifyOrder, waitForOrderState } from "../two-api.js";
import { checkout } from "../pages/renderer.js";
import * as store from "../pages/store.js";
import * as wpAdmin from "../pages/wp-admin.js";
import { wp } from "../wp-cli.js";

/**
 * An order the buyer verified with Two but never returned from is recovered by the scheduled check, by the
 * admin "Check status with Two" order action, and is cancelled here when Two has cancelled it (TWO-26300).
 * The order is placed with the browser held back from Two's payment page, so the shop never hears from the
 * buyer, and backdated past the scheduled check's 30-minute threshold so the real selection runs.
 */

const HOOK = "twoinc_check_pending_orders";

type Placed = { wcOrderId: number; twoOrderId: string };

/** Places a Two order and stops the browser at Two's payment page, as a buyer closing the tab would. */
async function placeWithoutReturning(page: Page, lastName: string): Promise<Placed> {
  await page.route("**/*", (route) => {
    const request = route.request();
    if (request.isNavigationRequest() && !request.url().startsWith(STORE_URL)) {
      return route.abort();
    }
    return route.continue();
  });
  await store.addProductToCart(page, "Product 1");
  await checkout.goto(page);
  await checkout.completeCheckoutForm(page, "Test", lastName);
  const leftForTwo = page.waitForEvent(
    "requestfailed",
    (request) => request.isNavigationRequest() && !request.url().startsWith(STORE_URL)
  );
  await checkout.submitOrder(page);
  await leftForTwo;
  await page.unroute("**/*");

  const wcOrderId = Number(
    wp(
      "eval",
      `echo implode(',', wc_get_orders(['billing_last_name' => '${lastName}', 'limit' => 1, 'return' => 'ids']));`
    ).trim()
  );
  expect(wcOrderId, "the order exists in the shop").toBeGreaterThan(0);
  const twoOrderId = wp(
    "eval",
    `echo wc_get_order(${wcOrderId})->get_meta('twoinc_order_id');`
  ).trim();
  expect(twoOrderId, "the order was created at Two").toBeTruthy();
  expect(orderStatus(wcOrderId), "waiting for the buyer").toBe("pending");
  return { wcOrderId, twoOrderId };
}

function orderStatus(wcOrderId: number): string {
  return wp("eval", `echo wc_get_order(${wcOrderId})->get_status();`).trim();
}

function orderNotes(wcOrderId: number): string[] {
  return JSON.parse(
    wp(
      "eval",
      `echo wp_json_encode(wp_list_pluck(wc_get_order_notes(['order_id' => ${wcOrderId}]), 'content'));`
    )
  ) as string[];
}

/** Moves the order past the 30-minute threshold, and its last check (if any) past the 15-minute skip. */
function backdate(wcOrderId: number): void {
  wp(
    "eval",
    `$o = wc_get_order(${wcOrderId}); $o->set_date_created(time() - 31 * 60); if ($o->get_meta('_twoinc_pending_checked_at')) { $o->update_meta_data('_twoinc_pending_checked_at', time() - 16 * 60); } $o->save();`
  );
}

/** Makes the recurring action due now and runs it through Action Scheduler, as the queue runner would. */
function runScheduledCheck(): void {
  wp(
    "eval",
    `global $wpdb; $wpdb->query($wpdb->prepare("UPDATE {$wpdb->prefix}actionscheduler_actions SET scheduled_date_gmt = %s, scheduled_date_local = %s WHERE hook = %s AND status = 'pending'", gmdate('Y-m-d H:i:s', time() - 60), current_time('mysql'), '${HOOK}'));`
  );
  wp("action-scheduler", "run", `--hooks=${HOOK}`, "--force");
}

test("scheduled check: waits while unverified, confirms once verified, late return lands on order-received", async ({
  page
}) => {
  const lastName = `E2ERecover${Date.now().toString(36)}`;
  const { wcOrderId, twoOrderId } = await placeWithoutReturning(page, lastName);

  // The recurring action is registered every 15 minutes.
  expect(
    wp("eval", `echo (int) as_has_scheduled_action('${HOOK}');`).trim(),
    "the check is scheduled"
  ).toBe("1");

  expect(await getOrderState(twoOrderId)).toBe("UNVERIFIED");
  backdate(wcOrderId);
  runScheduledCheck();
  expect(orderStatus(wcOrderId), "unverified: still waiting").toBe("pending");

  const confirmationUrl = await verifyOrder(twoOrderId);
  backdate(wcOrderId);
  runScheduledCheck();
  expect(orderStatus(wcOrderId), "verified: processed").toBe("processing");
  await waitForOrderState(twoOrderId, "CONFIRMED");
  const recovered = orderNotes(wcOrderId).filter((note) =>
    note.includes("Found by the scheduled check")
  );
  expect(recovered, "one note naming the scheduled check").toHaveLength(1);
  expect(recovered[0]).toContain("Confirmed with Two");

  // The buyer comes back after all: same browser session, so the confirmation link still authenticates.
  expect(confirmationUrl, "Two returned the confirmation link").toBeTruthy();
  await page.goto(confirmationUrl);
  await expect(page).toHaveURL(/\/checkout\/order-received\/\d+\//);
  const notes = orderNotes(wcOrderId);
  expect(
    notes.filter((note) => note.includes("Confirmed with Two")),
    "confirmed once"
  ).toHaveLength(1);
  expect(
    notes.some((note) => note.includes("has been placed with")),
    "the return confirmed nothing"
  ).toBe(false);
});

test("admin order action: Check status with Two confirms a verified order straight away", async ({
  page
}) => {
  const lastName = `E2ERecoverAdmin${Date.now().toString(36)}`;
  const { wcOrderId, twoOrderId } = await placeWithoutReturning(page, lastName);
  await verifyOrder(twoOrderId);

  await wpAdmin.login(page);
  await wpAdmin.navigateToOrders(page);
  await wpAdmin.openOrder(page, lastName);
  await wpAdmin.runOrderAction(page, "Check status with Two");

  await expect(page.locator(".notice", { hasText: "Confirmed with Two" })).toBeVisible();
  await expect(page.locator("#order_status")).toHaveValue("wc-processing");
  expect(orderStatus(wcOrderId)).toBe("processing");
  await waitForOrderState(twoOrderId, "CONFIRMED");
  expect(orderNotes(wcOrderId).some((note) => note.includes("Checked by"))).toBe(true);
});

test("scheduled check: an order Two cancelled is cancelled here without a cancel sent back", async ({
  page
}) => {
  const lastName = `E2ERecoverCancel${Date.now().toString(36)}`;
  const { wcOrderId, twoOrderId } = await placeWithoutReturning(page, lastName);
  await cancelOrder(twoOrderId);

  backdate(wcOrderId);
  runScheduledCheck();

  expect(orderStatus(wcOrderId)).toBe("cancelled");
  const notes = orderNotes(wcOrderId);
  expect(notes.some((note) => note.includes("reports this order as cancelled"))).toBe(true);
  // The note the cancel handler leaves when it sends nothing to Two, and none of the notes a sent cancel leaves.
  expect(notes.some((note) => note.includes("already cancelled with Two"))).toBe(true);
  expect(notes.some((note) => note.includes("Could not update status"))).toBe(false);
  expect(await getOrderState(twoOrderId)).toBe("CANCELLED");
});
