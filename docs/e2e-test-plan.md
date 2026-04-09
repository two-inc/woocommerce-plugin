# INF-956: WooCommerce Plugin E2E Tests

Linear: https://linear.app/tillit/issue/INF-956

## Context

WooCommerce e2e tests were deleted from the e2e-tests repo during the API migration (INF-940). They now live in the woocommerce-plugin repo, running against the local Docker dev environment (WordPress + WooCommerce + Two plugin at localhost:8888).

Tests focus on plugin-specific behaviour: WooCommerce store checkout with Two payment, order lifecycle through WP admin, and Two API state verification.

## Docker environment

- Store: `http://localhost:8888` (Storefront theme, NL, EUR)
- Admin: `http://localhost:8888/wp-admin` (admin / twoinb2b)
- Products: "Product 1"–"Product 4", random prices 100–200
- Plugin config: `docker/config/staging-tillittestuk.json` → `api.staging.two.inc`
- Merchant: tillittestuk (UK, org 13078389) — has merchant-wide `skip_verification` rule

## Checklist

### Docker bootstrap

- [x] **`docker/wpcli.sh`**: Uncomment plugin activation (line 19)
- [x] Add `_regular_price` and `_stock_status` meta so products display correctly in Storefront

### Test infrastructure (`tests/e2e/`)

- [x] `package.json` — Playwright Test, TypeScript
- [x] `playwright.config.ts` — chromium, baseURL localhost:8888, trace/video on failure
- [x] `config.ts` — reads `MERCHANT_API_KEY` from env var, defaults to staging Two API
- [x] `checkout-api.ts` — Two API client (get order state, verify, confirm, cancel)
- [x] `docker/config/staging-tillittestuk.json.tpl` — template for Docker plugin config, populated at CI time

### Page objects

- [x] `pages/store.ts` — add product to cart, go to checkout
- [x] `pages/checkout.ts` — select Two payment, company search (Select2), billing details, place order
- [x] `pages/wp-admin.ts` — login, navigate to orders, change status, refund

### Tests

- [x] `tests/order-flow.spec.ts` — place order → verify CONFIRMED → fulfil via WP admin → verify FULFILLED → refund → verify REFUNDED
- [x] `tests/cancel-order.spec.ts` — place order → cancel via WP admin → verify CANCELLED
- [x] `tests/max-limit.spec.ts` — excessive quantity → rejection on checkout

### CI/CD

- [x] `.github/workflows/e2e-tests.yaml` — GCP auth via WIF, fetch API key from Secret Manager, generate Docker config, start WordPress, run Playwright tests, upload artifacts on failure
- [x] Makefile targets: `e2e-install`, `e2e-test`, `e2e-test-headed`

### Infrastructure

- [x] Generated new API key for tillittestuk merchant via `POST /admin/v1/merchant/{id}/api_key`
- [x] Stored as `STAGING_SHOP_MERCHANT_API_KEY_TILLITTESTUK` in GCP Secret Manager (two-beta)
- [x] `GCP_E2E_TESTS_SA_NAME_TWO_BETA` org var: added woocommerce-plugin to selected repos
- [x] `WORKLOAD_IDENTITY_PROVIDER_PREFIX_TWO_BETA` org var: changed from "private" to "selected", added e2e-tests + woocommerce-plugin
- [ ] Verify CI passes end-to-end

## Running locally

```bash
docker compose up -d
# wait for wpcli to finish bootstrapping (~60s)
make e2e-install
MERCHANT_API_KEY=secret_test_xxx make e2e-test
```

The API key comes from your local `docker/config/staging-tillittestuk.json` (gitignored). In CI it's fetched from GCP Secret Manager.

## Out of scope

- Identity verification / SCA flow (covered in e2e-tests repo)
- Merchant portal tests (covered in e2e-tests repo)
- Multi-country support (single NL environment)
