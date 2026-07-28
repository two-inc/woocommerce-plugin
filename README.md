# Two WooCommerce Plugin

## Installation

Up to date instructions on how to install the plugin via the GUI can be found on our [docs site](https://docs.two.inc/developer-portal/plugins/woocommerce).

The following instructions are for developers who wish to install the plugin manually.

### Using zip file

```bash
git clone git@github.com:two-inc/woocommerce-plugin.git
cd woocommerce-plugin
make archive
```

This produces `tillit-payment-gateway.zip`, which can be uploaded to your Wordpress site.

### Using the CLI

```bash
wp plugin install tillit-payment-gateway --activate
```

## Releasing a new version

Ensure that you have `bumpver` installed.

    pip install -r dev-requirements.txt

To bump version:

    bumpver update --major | --minor | --patch

Now, go to Github to create a new release which triggers publication of the new version to Wordpress plugin directory.

## Set up Wordpress for local development

```bash
cp .env.example .env   # adjust TWO_API_KEY / TWO_API_BASE_URL / TWO_BRAND_CODE
make install           # docker compose up; first provision takes ~90s (make logs-wpcli)
```

Navigate to <http://localhost:8888/>. `make configure` re-applies the
TWO\_\* env values to the gateway settings after you edit `.env` (run
`make run` first so the container env is recreated). Other targets:
`make logs`, `make stop`, `make clean` (full reset), `make test-unit`,
`make format`.

The default `.env` targets a locally running Checkout API backend
(`portal.localhost`) — no additional setup required.

If you wish to use the staging site,

```bash
echo WOOCOM_PLUGIN_CONFIG_JSON=docker/config/staging.json >> .env
cat > docker/config/staging.json <<EOF
{
  "enabled": "yes",
  "title": "Business invoice %s days",
  "subtitle": "Receive the invoice via PDF and email",
  "test_checkout_host": "https://api.staging.two.inc",
  "clear_options_on_deactivation": "no",
  "section_api_credentials": "",
  "api_key": "secret_test_xxx",
  "section_checkout_options": "",
  "enable_order_intent": "yes",
  "add_field_department": "yes",
  "add_field_project": "yes",
  "add_field_purchase_order_number": "yes",
  "add_field_invoice_email": "yes",
  "show_abt_link": "yes",
  "section_auto_complete_settings": "",
  "enable_company_search": "yes",
  "enable_company_search_for_others": "yes",
  "enable_address_lookup": "yes"
}
EOF
make run
```

## E2E tests

Playwright e2e tests live in `tests/e2e/`. They run against the local Docker
environment and verify the full checkout flow with Two payment: WooCommerce
store checkout, order lifecycle through WP admin, and Two API state
verification.

Identity verification / SCA, merchant-portal flows and multi-country coverage
are out of scope here — they live in the `e2e-tests` repo.

### Environment

- Store: <http://localhost:8888>, admin at `/wp-admin` (`admin` / `twoinb2b`)
- Products: "Product 1"–"Product 4" (random prices 100–200) plus "Expensive
  Product" (500000) for the max-limit test
- Merchant: `tillittestuk` (UK, org 13078389) — has a merchant-wide
  `skip_verification` rule, so checkout completes without an identity step

### Prerequisites

- Docker running with the plugin config (see above)
- Node.js 22+
- A merchant API key (from GCP Secret Manager or your local config)
- Two admin password (for the fulfilment batch trigger)

### Setup

```bash
# The compose default seeds the LOCAL dev config; e2e runs against the
# staging shop, so pin the staging config first (CI does the same):
echo WOOCOM_PLUGIN_CONFIG_JSON=docker/config/staging-tillittestuk.json > .env
docker compose up -d
# wait ~90s for wpcli bootstrap to finish (installs WooCommerce, creates products, activates plugin)

make e2e-install
```

### Running

```bash
export MERCHANT_API_KEY=$(gcloud secrets versions access latest --secret=STAGING_SHOP_MERCHANT_API_KEY_TILLITTESTUK --project=two-beta)
export TWO_ADMIN_PASSWORD=$(gcloud secrets versions access latest --secret=STAGING_TWO_ADMIN_PASSWORD --project=two-beta)

make e2e-test              # headless
make e2e-test-headed       # with browser visible
```

Or if you have a local `docker/config/staging-tillittestuk.json`:

```bash
export MERCHANT_API_KEY=$(python3 -c "import json; print(json.load(open('docker/config/staging-tillittestuk.json'))['api_key'])")
```

### Tests

| Test                   | What it does                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| `order-flow.spec.ts`   | Place order → verify CONFIRMED → fulfil via WP admin → verify FULFILLED → refund → verify REFUNDED |
| `cancel-order.spec.ts` | Place order → cancel via WP admin → verify CANCELLED                                               |
| `max-limit.spec.ts`    | Add "Expensive Product" → expect rejection on checkout                                             |
| `sole-trader-availability.spec.ts` | Sole-trader chooser appears only where the registry supports it (GB yes, NO no)         |

### Clean restart

If products stop showing or the store behaves oddly between runs:

```bash
make clean && make run
```

## Post installation optional steps

Once Wordpress has been set up, a recommended plugin theme to install is:

- Elementor, select an e-commerce template
  WooCommerce then needs to be installed as a plugin
  Other recommended WooCommerce plugins are:
- WooCommerce Cart Abdandonment Recovery
- WooCommerce Shipping & Tax

## Missing Functionality

- Webhooks (merchant dashboard -> woocommerce)
- Orders are stored in `wp_posts` and `wp_postmeta` (also some stuff in `wp_woocommerce_order_*` (`update_post_*` function in PHP)
