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

## Versioning and releasing

The version is computed from the change itself, not from the branch it lands on:

| Change                | What happens                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| PR into `staging`     | The version is computed and committed onto the PR's own branch — `.github/workflows/version-bump.yml` |
| merge into `staging`  | Nothing. The merge brings in the version its PR already computed.                                     |
| `staging` into `main` | Nothing is computed. `main` tags the version already in the tree and cuts the Release.                |

With `M` the version on `origin/main` and `C` the version on the PR head, the
PR's own commits (`origin/staging..HEAD`, `--no-merges`) are classified by
conventional-commit type:

- a `!` on the type (`feat!:`, `TWO-1/fix(scope)!:`) or a `BREAKING CHANGE:`
  footer → `(M.major + 1).0.0`
- a `feat:` → `M.major.(M.minor + 1).0`
- anything else — `fix`, and `chore` / `docs` / `ci` / `test` / `refactor`
  alike → `M.major.M.minor.(M.patch + 1)`

The candidate is then clamped with `max(C, candidate)`. That clamp is what makes
the whole thing idempotent: a re-run, the `synchronize` event fired by the bump
commit itself, and a second fix commit on the same PR all compute the same
answer and write nothing. It also means the version can never regress while
`main` is behind `staging`.

**Do not hand-run a bump for a PR into `staging`.** CI owns it. `make bump`
previews the decision and writes nothing.

A major is not chosen by hand either. Two independent signals are considered and
the higher wins:

- **Declared** — a root `.next-major` file whose first token is the target
  major, with a short reason on the same line:

      3  # dropped PHP 7.4, 3.0.0 release

  This covers a _planned_ major that no single commit happens to mark. It is
  reviewable in the PR that decides it, and it is not cleared afterwards — it
  disarms itself once the major it names has shipped. A `.next-major` naming a
  major _below the major on `main`_ is a hard failure, not a no-op.

- **Discovered** — a `!` on a conventional-commit type or a `BREAKING CHANGE:`
  footer, in **this PR's own commits** only. Deliberately not the cumulative
  `main..staging` range: a break that already landed on `staging` must not be
  re-discovered by every later PR.

`.github/scripts/decide-bump-level.sh` implements all of this, is unit-tested by
`.github/scripts/test-decide-bump-level.sh`, and logs its full reasoning on every
run. It is identical in every Two plugin repository.

### Releasing

Ensure that you have `bumpver` installed:

    pip install -r dev-requirements.txt

A release does not bump anything: the version in the tree on `main` is already
the version the change computed on its PR. So on `main`, tag it and cut the
Release, which triggers publication to the WordPress plugin directory:

    v=$(bumpver show --environ | grep '^CURRENT_VERSION=' | cut -d= -f2)
    git tag "$v" && git push origin "$v"
    gh release create "$v" --generate-notes

`make patch` / `make minor` / `make major` remain available for the case where
you genuinely mean to override the computed version — note that they bump as
well as release, which is normally not what you want any more.

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

### Pointing a service somewhere else

The plugin talks to three Two services, and each one can be sent to an
arbitrary host independently — they are reached by different clients and
routinely need different hosts during a local loop. Each falls back on its
own to the brand's host for the configured environment, so overriding one
leaves the other two alone.

| Env var                    | Service                                          | `.env` key             |
| -------------------------- | ------------------------------------------------ | ---------------------- |
| `TWOINC_DEV_API_HOST`      | Checkout / merchant API                          | `TWO_API_BASE_URL`     |
| `TWOINC_DEV_CHECKOUT_HOST` | Hosted checkout-page app (company search, signup) | `TWO_CHECKOUT_BASE_URL` |
| `TWOINC_DEV_PORTAL_HOST`   | Merchant portal (settings-screen signup link)     | `TWO_PORTAL_BASE_URL`  |

These are server env vars on the container serving checkout requests, never
wp-admin fields — the merchant-editable test-host control was removed
deliberately (TWO-25386) and must not come back. `docker-compose.yaml` wires
all three from the `.env` keys above.

**The gate.** All three are honoured only where WordPress's own
`wp_get_environment_type()` reports `development` or `local`, i.e. where the
install sets `WP_ENVIRONMENT_TYPE` (constant in `wp-config.php`, or
WordPress's env var). WordPress resolves anything unset or unrecognised to
`production`, so a shop that has not declared itself non-production honours
no override, whatever is in its process environment. `docker-compose.yaml`
sets it to `development` for this stack; an existing local stack needs
`make run` to pick it up.

`TWOINC_DEV_HOSTNAMES` is separate and older: a comma-separated hostname
allow-list feeding the legacy dev-environment sniffer, which still decides
which *environment* an install predating the explicit `checkout_env` setting
resolves to. It has no say over the host overrides above.

**Reaching a laptop-hosted checkout page.** `TWOINC_DEV_CHECKOUT_HOST` is the
one the browser resolves, because the browser is what opens the company-search
and sole-trader signup flows. Once the shop itself is remote, `localhost` and
`host.docker.internal` resolve to nothing useful from a browser pointed at
that remote domain — a reverse tunnel's public host is what belongs here. The
API and portal hosts have no such constraint: the shop's own PHP process
reaches those, so a Docker network alias is fine.

If you wish to use the staging site,

```bash
echo WOOCOM_PLUGIN_CONFIG_JSON=docker/config/staging.json >> .env
cat > docker/config/staging.json <<EOF
{
  "enabled": "yes",
  "title": "Business invoice %s days",
  "subtitle": "Receive the invoice via PDF and email",
  "checkout_env": "staging",
  "clear_options_on_deactivation": "no",
  "section_api_credentials": "",
  "api_key": "secret_test_xxx",
  "section_checkout_options": "",
  "enable_order_intent": "yes",
  "add_field_invoice_email": "yes",
  "add_field_purchase_order_number": "yes",
  "add_field_project": "yes",
  "add_field_department": "yes",
  "show_abt_link": "yes",
  "section_auto_complete_settings": "",
  "enable_company_search": "yes",
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

| Test                               | What it does                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| `order-flow.spec.ts`               | Place order → verify CONFIRMED → fulfil via WP admin → verify FULFILLED → refund → verify REFUNDED |
| `cancel-order.spec.ts`             | Place order → cancel via WP admin → verify CANCELLED                                               |
| `max-limit.spec.ts`                | Add "Expensive Product" → expect rejection on checkout                                             |
| `sole-trader-availability.spec.ts` | Sole-trader chooser appears only where the registry supports it (GB yes, NO no)                    |

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
