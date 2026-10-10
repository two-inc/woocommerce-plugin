import { test, expect, type Page } from "@playwright/test";

import { checkout } from "../pages/renderer.js";
import * as store from "../pages/store.js";
import { resetCartShapes, setOption } from "../wp-cli.js";

/**
 * A company belongs to the country it was found under. Switching the buyer's
 * country after picking a company must drop that company before any
 * availability check goes out, or the check pairs one country with another
 * country's company number (TWO-26286).
 *
 * The cart needs shipping, so block checkout shows its shipping form and the
 * company is captured there: the shape the bug needed.
 *
 * The company search, the registry address lookup and the availability check
 * are answered here in the browser, with invented companies, so the test
 * depends on no registry data and never sends a mismatched pair upstream.
 */
const COMPANIES: Record<string, { name: string; number: string; lookup: string; address: object }> =
  {
    GB: {
      name: "FAKE WIDGETS TEST LTD",
      number: "00000001",
      lookup: "gb-fake-1",
      address: { street_address: "1 Fake Street", city: "London", postal_code: "N1 1AA" }
    },
    ES: {
      name: "EMPRESA FICTICIA PRUEBA SL",
      number: "B00000001",
      lookup: "es-fake-1",
      address: { street_address: "Calle Falsa 1", city: "Madrid", postal_code: "28001" }
    }
  };

const FIRST_NAME = "Test";
const LAST_NAME = "E2ECountrySwitch";

/** Long enough for every check a country switch arms (a 1s interval, a 3s poller) to have gone out. */
const SETTLE_MS = 6_000;

type Intent = {
  buyer?: {
    company?: { company_name?: string; country_prefix?: string; organization_number?: string };
    representative?: { first_name?: string; last_name?: string };
  };
};

test.afterEach(() => {
  resetCartShapes();
});

/** Answer the plugin's own wc-ajax relays, and record every availability check the browser sends. */
async function fakeTwoRelays(page: Page): Promise<Intent[]> {
  const intents: Intent[] = [];

  await page.route(/[?&]wc-ajax=two_company_search\b/, async (route) => {
    const country = (
      new URL(route.request().url()).searchParams.get("country") || ""
    ).toUpperCase();
    const hit = COMPANIES[country];
    await route.fulfill({
      json: {
        items: hit
          ? [{ name: hit.name, national_identifier: { id: hit.number }, lookup_id: hit.lookup }]
          : []
      }
    });
  });
  await page.route(/[?&]wc-ajax=two_company_by_id\b/, async (route) => {
    const lookup = new URL(route.request().url()).searchParams.get("lookup_id");
    const hit = Object.values(COMPANIES).find((c) => c.lookup === lookup);
    await route.fulfill({ json: { addresses: hit ? [hit.address] : [] } });
  });
  await page.route(/[?&]wc-ajax=two_order_intent\b/, async (route) => {
    const posted = new URLSearchParams(route.request().postData() || "").get("intent");
    intents.push(JSON.parse(posted || "{}"));
    await route.fulfill({ json: { approved: true } });
  });

  return intents;
}

/** Every check sent pairs a country with that country's own company, and carries the buyer. */
function expectEveryIntentConsistent(intents: Intent[]) {
  for (const intent of intents) {
    const sent = intent.buyer?.company ?? {};
    const country = String(sent.country_prefix || "").toUpperCase();
    expect(
      { name: sent.company_name, number: sent.organization_number },
      `intent pairs ${country} with another country's company: ${JSON.stringify(sent)}`
    ).toEqual({ name: COMPANIES[country]?.name, number: COMPANIES[country]?.number });
  }
  for (const intent of intents) {
    expect(
      intent.buyer?.representative,
      `intent representative: ${JSON.stringify(intent.buyer?.representative)}`
    ).toMatchObject({ first_name: FIRST_NAME, last_name: LAST_NAME });
  }
}

async function expectLastIntentFor(intents: Intent[], country: string) {
  await expect
    .poll(() => intents[intents.length - 1]?.buyer?.company?.organization_number, {
      timeout: 30_000
    })
    .toBe(COMPANIES[country].number);
}

test("switching country drops the company picked under the previous country", async ({ page }) => {
  setOption("two_e2e_cart_shape", "untaxed");
  const intents = await fakeTwoRelays(page);

  await store.addProductToCart(page, "Product 1");
  await checkout.goto(page);
  if (checkout.renderer === "blocks") {
    await page.locator("#shipping-country").waitFor({ state: "visible" });
  }
  await checkout.fillBuyerDetails(page, FIRST_NAME, LAST_NAME);
  await checkout.selectTwoPayment(page);

  await checkout.fillCompanySearch(page, "FAKE");
  await expectLastIntentFor(intents, "GB");

  await checkout.setBillingCountry(page, "Spain");
  await page.waitForTimeout(SETTLE_MS);
  expectEveryIntentConsistent(intents);

  await checkout.fillCompanySearch(page, "EMPRESA");
  await expectLastIntentFor(intents, "ES");

  await checkout.setBillingCountry(page, "United Kingdom (UK)");
  await page.waitForTimeout(SETTLE_MS);
  expectEveryIntentConsistent(intents);
});
