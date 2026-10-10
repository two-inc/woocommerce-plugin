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

Open a PR from `staging` into `main` titled `Release <version>` and merge it
with a merge commit. Everything after that is automated:

1.  `Deploy` runs php-lint on `main`.
2.  `.github/workflows/release.yml` tags the version already in the tree and
    creates the GitHub Release. It skips when that version is already tagged.
3.  The Release event runs the `release` job in `deploy.yaml`, which publishes
    to the WordPress plugin directory and attaches the zip to the Release.
4.  `merge-back.yml` fast-forwards `staging` to `main`. The merge commit is
    what keeps that a fast-forward.

`make patch` / `make minor` / `make major` are kept only for Makefile parity
with the other plugin repos. They bump and push straight to `main`, which the
branch ruleset rejects, so do not use them.

Brand overlay plugins built on this one (private repositories) require it, so
release this plugin first when both are going out.

## Set up Wordpress for local development

```bash
cp .env.example .env   # adjust TWO_API_KEY / TWO_API_BASE_URL / TWO_BRAND_CODE
make install           # docker compose up; first provision takes ~90s (make logs-wpcli)
```

Navigate to <http://localhost:8888/> (set `WORDPRESS_PORT` in `.env` to publish
it elsewhere, which is what lets a second stack run alongside this one).
`make configure` re-applies the
TWO\_\* env values to the gateway settings after you edit `.env` (run
`make run` first so the container env is recreated). Other targets:
`make logs`, `make stop`, `make clean` (full reset), `make test-unit`,
`make format`.

The first provision shapes the shop (theme, products, permalinks, currency,
country, gateway settings JSON) and records that it has. Later starts only repair what
is missing (WooCommerce, the admin user, the gateway plugin's activation) and
re-apply the TWO\_\* env values, so shop settings changed by hand survive a
restart. To reshape from `.env`, start from a clean stack (`make clean`).

The default `.env` targets a locally running Checkout API backend
(`portal.localhost`) — no additional setup required.

### The shop is up but serves no Two payment method

First check that the plugin's files are actually visible inside the container:

```bash
docker compose exec -T wordpress ls /var/www/html/wp-content/plugins/tillit-payment-gateway
```

An empty directory means Docker Desktop's bind mapping went stale. It resolves
the host path once, when the container is CREATED, and re-establishes that
mapping on every start — a WSL or Docker Desktop restart in between can break
it, and the shop then comes up healthy, serves no plugin, and reports nothing
anywhere. `docker compose up -d` does not repair it, because the container is
already running and nothing gets recreated:

```bash
docker compose up -d --force-recreate
```

`make run` runs the same check itself and says this when it fails.

### Environment selector, key and hosts have to agree

`docker/config/local.json` pins `checkout_env` to `PROD`, which
`WC_Twoinc_Helper::get_environment_mode()` resolves to `production`. On a
localhost shop that is not the environment the gateway talks to:
`get_effective_environment_mode()` treats a dev-sniffed shop still carrying the
default mode as non-production and resolves it from `TWOINC_DEV_API_HOST`
instead — `https://api.staging.two.inc` gives `staging`, and an unset variable
falls back to `staging` as well. So a `secret_test_` staging merchant key is
the key that belongs in `TWO_API_KEY` here, and a production key would never
be used even if it were set.

`make run` exports `TWO_API_BASE_URL` (staging for an `@two.inc` gcloud
account, sandbox otherwise) and docker-compose threads it through as
`TWOINC_DEV_API_HOST`. A bare `docker compose up -d` does not, which leaves
that variable empty in the container — harmless on localhost, but check it with
`docker compose exec -T wordpress env | grep TWOINC_DEV` before concluding the key is
wrong.

### Clearing a cached API-key verdict

The gateway caches its key-verification outcome for 300s in the
`twoinc_api_key_status_<hash>` transient, keyed by the key itself. A verdict
recorded while the configuration was wrong therefore keeps the payment method
withheld for up to five minutes after the fix, and the expired row stays
visible in `wp_options` long after it stopped being served — so a
`status: invalid_key` row found by hand is not evidence of a live failure.
Clear it:

```bash
docker compose exec -T wpcli wp transient delete --all
```

Confirm the key itself independently of the shop:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "X-API-Key: $TWO_API_KEY" https://api.staging.two.inc/v1/merchant/verify_api_key
```

`200` is a good key for that environment; `401` means the key and the resolved
environment disagree.

If you wish to use the staging site,

```bash
echo WOOCOM_PLUGIN_CONFIG_JSON=docker/config/staging.json >> .env
cat > docker/config/staging.json <<EOF
{
  "enabled": "yes",
  "title": "Business invoice",
  "subtitle": "Receive the invoice via PDF and email",
  "checkout_env": "staging",
  "clear_options_on_uninstall": "no",
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

- Store: <http://localhost:8888>, admin at `/wp-admin` (`exampleuser@two.inc` / `examplepassword123`).
  Set `WORDPRESS_PORT` to move it; the suite reads the same variable, so both follow together
- Checkout: one page at `/checkout/`, as a merchant's shop has. Its content
  decides the renderer — `make checkout-renderer RENDERER=blocks` writes
  WooCommerce's own Blocks markup, `RENDERER=classic` the
  `[woocommerce_checkout]` shortcode. A fresh stack comes up on WooCommerce's
  own install default, which is Blocks
- Products: "Product 1"–"Product 4" (random prices 100–200) plus "Expensive
  Product" (500000) for the max-limit test
- Merchant: `demostoregb` (UK). This is a temporary repoint: `tillittestuk`
  has accumulated too much e2e order volume to pass fraud velocity checks, so
  every order it places is declined. It goes back to `tillittestuk` once CI is
  trusted again.

### Prerequisites

- Docker running with the plugin config (see above)
- Node.js 22+
- A merchant API key (from GCP Secret Manager or your local config)
- Two admin password (for the fulfilment batch trigger)

### Setup

```bash
# The compose default seeds the LOCAL dev config; e2e runs against the
# staging shop, so pin the staging config first (CI does the same):
echo WOOCOM_PLUGIN_CONFIG_JSON=docker/config/staging-demostoregb.json > .env
docker compose up -d
# wait ~90s for wpcli bootstrap to finish (installs WooCommerce, creates products, activates plugin).
# An existing stack keeps its gateway settings: run `make clean` first so the staging config is applied

make e2e-install
```

### Running

The suite drives whichever renderer the shop is configured for, so the shop and
`E2E_CHECKOUT_RENDERER` have to name the same one. CI runs both as matrix legs.

```bash
export MERCHANT_API_KEY=$(gcloud secrets versions access latest --secret=STAGING_SHOP_MERCHANT_API_KEY_GB --project=two-beta)
export TWO_ADMIN_PASSWORD=$(gcloud secrets versions access latest --secret=STAGING_TWO_ADMIN_PASSWORD --project=two-beta)

make checkout-renderer RENDERER=blocks
E2E_CHECKOUT_RENDERER=blocks make e2e-test          # headless
E2E_CHECKOUT_RENDERER=blocks make e2e-test-headed   # with browser visible

make checkout-renderer RENDERER=classic
E2E_CHECKOUT_RENDERER=classic make e2e-test
```

Or if you have a local `docker/config/staging-demostoregb.json`:

```bash
export MERCHANT_API_KEY=$(python3 -c "import json; print(json.load(open('docker/config/staging-demostoregb.json'))['api_key'])")
```

### Tests

| Test                               | What it does                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| `order-flow.spec.ts`               | Place order → verify CONFIRMED → fulfil via WP admin → verify FULFILLED → refund → verify REFUNDED |
| `cancel-order.spec.ts`             | Place order → cancel via WP admin → verify CANCELLED                                               |
| `max-limit.spec.ts`                | Add "Expensive Product" → expect rejection on checkout                                             |
| `sole-trader-availability.spec.ts` | Sole-trader chooser appears only where the registry supports it (GB yes, NO no)                    |
| `checkout-renderer.spec.ts`        | `/checkout/` renders the configured renderer and only it, and offers Two there                     |

### Clean restart

If products stop showing or the store behaves oddly between runs:

```bash
make clean && make run
```

## Shipping tax from the shop's rates

The plugin sends each shipping line at the tax rate the shop recorded for it.
A shipping line either has a rate provided (WooCommerce stored a tax rate row
on it, including a 0% rate) or has none (for example a non-taxable shipping
method, or a third-party shipping module that adds tax without a WooCommerce
rate row).

What the plugin does depends on the shipping tax control, a hidden per-shop
option. It is blank by default. There is no admin setting; populate it with
WP-CLI:

```bash
wp option update twoinc_shipping_tax_from_shop_rates yes
```

`wp option delete twoinc_shipping_tax_from_shop_rates` makes it blank again.
When populated, the rate comes from WooCommerce's own "Shipping tax class"
setting under WooCommerce > Settings > Tax, including "based on cart items", at
the order's tax location.

| Shipping line                                            | Control blank (the default)                                                                                                   | Control populated                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rate provided by the shop, including an explicit 0% rate | Sent at the recorded rate as is. No plugin check. Then the `twoinc_order_postprocessing` hook runs, then Two's API validates. | Same as control blank.                                                                                                                                                                                                                                                                |
| No rate provided (whatever the line's tax, including 0)  | Sent as is: rate 0, tax as charged. No plugin check. Then the hook runs, then Two's API validates.                            | The rate is resolved from the control, and the line is sent at that rate. Its tax must reconcile with it (within 0.02): unless a merchant handler is registered, the default handler checks that after the hook and refuses the request with an error naming the line if it does not. |

The reconcile check is a shop-match check. It runs after the
`twoinc_order_postprocessing` hook, in the plugin's default handler, on the
shipping line as the plugin built it, and only when no merchant handler is
registered on the hook (see "What the plugin checks" below). With the control
blank, the plugin never refuses a request over shipping tax. A shipping or fee
line with zero net but non-zero tax is sent with its tax rather than dropped.

A rate resolved from the control is recorded on the shipping line at checkout.
Order edits, captures and refunds decide from that record, not from the
option or the shop's rates as they are later: a line with a recorded rate uses
it and must still reconcile with it, and a line with no rate row and no
recorded rate is sent as is. Refunds take the rate the parent line was charged
at.

**Note for integrators.** A `twoinc_order_postprocessing` subscriber that
re-splits a shipping line with no rate (for example, treating untaxed shipping
as VAT-inclusive) owns that line's figures: while it is registered, the
reconcile check stands down. A populated control still decides the rate the
line arrives at the hook with.

If an upgrade removes a non-empty "Default shipping tax class" value, the plugin
logs a notice naming the old class (source `twoinc-payment-gateway`).

## Tax codes for 0% lines

Two's API accepts a `tax_code` on each order line. For a Spanish merchant a line
at 0% tax must carry one, because a 0% rate on its own does not say why the
line is untaxed. The plugin adds the code to every line it sends at 0%: order
create, order edit and refund lines. Fulfilment sends no lines, so there is
nothing to add. The availability check (order intent) carries no codes, because
the buyer's details, such as the VAT number, may still be incomplete then. A line at any other rate is sent exactly as before,
and so is every line of a merchant outside Spain who has mapped nothing.

**Mapping.** Under WooCommerce > Settings > Payments > Two, "Tax codes for 0%
lines" lists the standard tax class and every tax class the shop defines. Each
has a dropdown of the tax codes Two offers for the merchant's country, fetched
from Two's API and cached for a day, plus "(none)", the default. A code that
needs an exemption reason Two cannot supply itself is not offered. A shipping
line is looked up by the class WooCommerce's "Shipping tax class" setting gives
it. A mapped class always wins, whatever the merchant's country.

**Derivation.** For a Spanish merchant, a 0% line whose class is unmapped gets
a code worked out from the order. A product line is a service when its product
is virtual or downloadable, and goods otherwise. A shipping or fee line is goods
when the order has at least one goods line, and a service otherwise. Goods
follow the delivery address (the billing address when the order has no separate
one). Services follow the buyer company's country, which is the billing
country the order sends as `buyer.company.country_prefix`. The EU below is the
27 member states plus Monaco. The Canary Islands, Ceuta and Melilla are Spanish
postcodes starting 35 or 38, 51 and 52.

| Line     | Where it goes, or who buys                                     | Code sent                |
| -------- | -------------------------------------------------------------- | ------------------------ |
| Goods    | Delivered outside the EU                                       | `ES_IVA_EXPORT`          |
| Goods    | Delivered to the Canary Islands, Ceuta or Melilla              | `ES_IVA_EXPORT`          |
| Goods    | Delivered to another EU state, for a buyer in another EU state | `ES_IVA_INTRA_COMMUNITY` |
| Goods    | Delivered in mainland Spain or the Balearics                   | none                     |
| Goods    | Delivered to another EU state, for a Spanish buyer             | none                     |
| Services | Buyer in another EU state                                      | `ES_IVA_REVERSE_CHARGE`  |
| Services | Buyer in Spain, or outside the EU                              | none                     |

Where the table gives no code, the line is sent without one. **The plugin never
refuses; the API does.** Two's API checks every code it receives, and refuses a
Spanish merchant's 0% line that has none, with a reason the plugin logs and
writes to the order note. To send those lines, map their tax class. The codes
are added in the line builder, before `twoinc_payment_terms_line`,
`twoinc_order_payload` and `twoinc_order_postprocessing`, so any of them can
change or remove a code. A code that needs an exemption reason, such as
`ES_IVA_EXEMPT_OTHER`, can be sent from `twoinc_order_postprocessing` with
`tax_exemption_reason_code` set beside it.

Known limits: goods to Northern Ireland derive as an export, and other member
states' special territories derive by their ISO country code. Map the class, or
use the hook, where that is wrong for you.

## Stable extension contract: order postprocessing

`twoinc_order_postprocessing` is the one place for merchant code to change what
is sent to Two. It presents the complete request body and lets a subscriber edit
any of it: lines, net/tax splits, gross amounts, totals, fields the plugin does
not send itself. The plugin fires it and sends the payload exactly as it is
returned. Two's API validates whatever arrives; if it passes, Two accepts what
the merchant declared. The merchant owns what their code declares: with a
subscriber that changes amounts, the Two invoice can differ from what the shop
itself recorded.

```php
add_filter('twoinc_order_postprocessing', function (array $payload, array $context): array {
    // ...edit $payload...
    return $payload;
}, 10, 2);
```

**Parameters**

- `$payload` (array): the request body exactly as it would be sent, amounts as
  2dp decimal strings. `[]` for a request the API defines with no body.
- `$context` (array):

  | Key                          | Type                      | Meaning                                                                                                                                                                          |
  | ---------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `request_type`               | string                    | `order_intent`, `order_create`, `order_update`, `order_confirm`, `capture`, `refund` or `cancel`                                                                                 |
  | `trigger`                    | string                    | What caused it, for diagnosis: `checkout`, `change_hash`, `admin_edit`, `tracking_number`, `confirmation_redirect`, `status_change`, `order_refund`                              |
  | `endpoint`                   | string                    | The API path, e.g. `/v1/order/<id>/refund`                                                                                                                                       |
  | `order`                      | `WC_Order`                | The order; for `order_intent` an unsaved order built from the cart                                                                                                               |
  | `refund`                     | `WC_Order_Refund` or null | The refund being sent, for `refund`                                                                                                                                              |
  | `shipping_tax_rate`          | float or null             | The rate WooCommerce's shipping tax class setting applies at the order's tax address, whether or not the shipping line was taxed. `0.21` means 21%. Null when none is configured |
  | `fallback_shipping_tax_rate` | float or null             | The same rate when the shop-rate shipping tax fallback above is on, else null                                                                                                    |
  | `contract_version`           | int                       | `1`                                                                                                                                                                              |

**Return**: the full payload. Callbacks chain in priority order; the final
payload is sent.

**When it fires**: once for every request the plugin sends to an order endpoint:

| `request_type`  | When                                                                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `order_intent`  | Every availability check at checkout. The plugin composes the intent itself from the cart, with the same line builder as the order; the browser supplies only the buyer |
| `order_create`  | Placing the order; also, with `trigger` `change_hash`, whenever the plugin recomposes the order to detect an edit (nothing is sent then)                                |
| `order_update`  | An admin edit or a tracking number reaching the order                                                                                                                   |
| `order_confirm` | The buyer returning from Two's checkout                                                                                                                                 |
| `capture`       | The fulfilment trigger status                                                                                                                                           |
| `refund`        | A refund                                                                                                                                                                |
| `cancel`        | Cancellation                                                                                                                                                            |

To build the intent, the plugin has WooCommerce copy the cart onto an unsaved
order, so third-party `woocommerce_checkout_create_order_line_item`,
`woocommerce_checkout_create_order_shipping_item`,
`woocommerce_checkout_create_order_fee_item`,
`woocommerce_checkout_create_order_tax_item` and
`woocommerce_checkout_create_order_coupon_item` actions fire on every intent check,
with an order whose id is `0`. Code on those actions that writes elsewhere
should skip an order with id `0`.

**What the plugin checks**. The plugin registers its own handler on the hook,
`WC_Twoinc_Helper::default_order_postprocessing`, at priority `PHP_INT_MAX`.
It runs the shop-match checks: whether what the request sends matches what
the shop worked out. Today there is one: a shipping line with no rate row,
sent at the rate the shipping tax control resolves, must carry the tax that
rate gives, within 0.02 (see "Shipping tax from the shop's rates"). Each check
is made on a line as the plugin built it, and the default handler refuses the
request if any check made for that request failed: with the same error, at
the same level, as when the builders checked it. A request that will be
refused now runs the deprecated filters below before it is refused.

The default handler stands down when any other callback is registered on
`twoinc_order_postprocessing`. That merchant handler then owns shop-match
correctness: the plugin does not compare what it returns with the shop's
figures, whether or not it changed them. Each request sent says so in one
line in the WooCommerce log at info level, naming the handler (a function,
`Class::method`, or where a closure was defined). The change hash, which
sends nothing, logs nothing.

What always runs, with or without a merchant handler: the builders' own
refusals where they cannot build a payload at all (a negative discount, a
shipping refund with no order line to take its rate from), the code-fault
checks below, and Two's API. The plugin has no internal-consistency checks of
its own: whether the lines add up to the totals and subtotals is validated by
Two's API, and a request the API refuses is logged at error level with the
API's reason and, on a saved order, the reason is written to an order note.

**Opting back in**. A merchant handler can run the shop-match checks itself
with
`WC_Twoinc_Helper::check_shop_match(array $payload, string $scope = WC_Twoinc_Helper::SHOP_MATCH_ALL): array`.
It returns the payload unchanged, or throws `WC_Twoinc_Shop_Match_Exception`
with the error the default handler would have raised; the plugin lets it
through unwrapped. It applies each check to the line it was made for while
that line's name, type, amounts and rate are as built. Called on the payload
the handler returns, it checks every line the handler left as built. Called on
the payload it received, before any edit, it checks them all. Register a
handler that calls it at a priority below `PHP_INT_MAX`: the plugin's default
handler runs at `PHP_INT_MAX` and clears the record of the build's refusals,
so a call from a handler that runs after it finds nothing to refuse.

`$scope` chooses which checks run. `SHOP_MATCH_ALL`, the default, runs every
shop-match check. `SHOP_MATCH_PER_LINE` runs only the checks made for single
lines, on the lines the handler left as built: use it when the handler
declares its own split of the order, so that a whole-order comparison with the
shop's totals cannot refuse that split. Every shop-match check this plugin has
today is per line, so the two scopes currently run the same checks.

The example sends a cost the shop adds to the cart total outside any carrier
as its own line, taxed at 21%. It splits off only what the order total
carries beyond the lines, so a create and a later update of the same order
send the same lines, and an order with nothing beyond its lines is left alone.

```php
add_filter('twoinc_order_postprocessing', function (array $payload, array $context): array {
    if (!isset($payload['gross_amount']) || empty($payload['line_items'])) {
        return $payload;
    }
    $beyond = (float) $payload['gross_amount']
        - array_sum(array_map('floatval', array_column($payload['line_items'], 'gross_amount')));
    if (round($beyond, 2) > 0) {
        $net = round($beyond / 1.21, 2);
        $payload['line_items'][] = [
            'name' => 'Handling',
            'type' => 'SERVICE',
            'quantity' => 1,
            'quantity_unit' => 'fee',
            'unit_price' => number_format($net, 2, '.', ''),
            'net_amount' => number_format($net, 2, '.', ''),
            'tax_amount' => number_format($beyond - $net, 2, '.', ''),
            'gross_amount' => number_format($beyond, 2, '.', ''),
            'discount_amount' => '0',
            'tax_rate' => '0.210000',
            'tax_class_name' => 'VAT 21%',
        ];
        // The edited lines are passed as the original, with no totals, so no residual is carried over:
        // the line just added already holds the cost, and every total becomes the sum of the lines.
        $payload = WC_Twoinc_Helper::recompute_totals_from_lines($payload, ['line_items' => $payload['line_items']]);
    }
    // The shop's own lines, which this handler did not touch, are still checked against the shop.
    return WC_Twoinc_Helper::check_shop_match($payload, WC_Twoinc_Helper::SHOP_MATCH_PER_LINE);
}, 10, 2);
```

A subscriber that throws, or returns something other than an array or
something that cannot be encoded as JSON, is a code fault rather than a
declaration: the request is not sent, and the failure is logged at error level
naming `twoinc_order_postprocessing` and the request type. Checkout then shows
the buyer the usual "not available" message; a failed intent check is answered
as an error rather than a decline, so the next check asks again; admin actions
leave an order note; a refund returns the error to the refund screen.

The plugin never recomputes anything after the hook: a subscriber that changes
a line also updates the totals and subtotals it affects. It can do that with
the opt-in helper
`WC_Twoinc_Helper::recompute_totals_from_lines(array $payload, array $original): array`.
`$original` is required: the payload as the subscriber received it. The helper
sets each order total, each per-rate entry in `tax_subtotals` and a refund
`amount` to the sum over the payload's lines plus the residual `$original`
carried beyond its lines, such as store credit or a gift card. It touches only
the fields the payload already carries. A total the subscriber edited by hand
before calling it is overwritten: the helper's result wins.

When a subscriber changes a payload, the changed fields are logged at debug
level with their before and after values.

**Determinism**: a subscriber must be a pure function of its inputs. The plugin
recomposes the order and compares hashes of the post-hook payload to detect
edits; a subscriber that answers differently each time makes every order save
send an update.

**Performance**: it runs on every intent check during checkout. Keep it cheap.

**A subscriber that is switched off** (a deactivated plugin, a removed
snippet, a callback taken off with `remove_filter()`) is indistinguishable
from none: orders then go out with the shop's figures, and the default
handler's checks apply again. Removing the default handler itself switches the
shop-match checks off.

**Example**: the shop records shipping as untaxed, while the business books
VAT inside that charge at the shop's configured shipping rate. For 29.00 of
shipping at 21%, the line goes out as 23.97 net + 5.03 tax, gross unchanged.

```php
add_filter('twoinc_order_postprocessing', function (array $payload, array $context): array {
    $rate = $context['shipping_tax_rate'];
    if (!$rate || empty($payload['line_items'])) {
        return $payload;
    }
    $original = $payload;
    foreach ($payload['line_items'] as &$line) {
        if ($line['type'] !== 'SHIPPING_FEE' || (float) $line['tax_amount'] != 0.0) {
            continue;
        }
        $gross = (float) $line['gross_amount'];
        $net = round($gross / (1 + $rate), 2);
        $line['net_amount'] = number_format($net, 2, '.', '');
        $line['tax_amount'] = number_format($gross - $net, 2, '.', '');
        $line['unit_price'] = $line['net_amount'];
        $line['tax_rate'] = number_format($rate, 6, '.', '');
        $line['tax_class_name'] = 'VAT ' . number_format($rate * 100, 2) . '%';
    }
    unset($line);
    return WC_Twoinc_Helper::recompute_totals_from_lines($payload, $original);
}, 10, 2);
```

The CI fixture `tests/unit/fixtures/orderpostprocessing.php` is a working
subscriber. The unit suite drives it through every request type, and the e2e
suite loads it as an mu-plugin to place a real order with re-split shipping.

**The older filters are deprecated** in favour of this one:
`twoinc_payment_terms_line`, `two_order_create`, `two_order_edit` and
`twoinc_order_payload` (see `docs/two-order-hook.md`). They still run, inside
the order builders and before `twoinc_order_postprocessing`, so their output is
the plugin's payload and goes out as it always has. They are not merchant
handlers: with no merchant handler, a request whose build failed a shop-match
check is refused whatever they did to its lines, as when the builders checked
before they ran.

**Versioning**: this hook must remain for all time and must fire consistently
in response to the same events.

- It is never removed or renamed, and its version 1 context keys and
  `request_type` values keep their meaning.
- Allowed without a new version: new context keys, new `request_type` or
  `trigger` values.
- Never allowed: removing or renaming a context key, changing units (rates stay
  decimal fractions), checking the figures a merchant handler returns unless
  it calls `check_shop_match()`, or firing on fewer requests.
- An incompatible version 2 would be a new hook name, with this one still
  firing alongside it. Any contract change is recorded in the changelog, and the
  CI fixture pins version 1.

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
