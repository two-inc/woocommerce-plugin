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

### Using the CLI

```bash
wp plugin install tillit-payment-gateway --activate
```

This will produce a zip file which can be uploaded to your Wordpress site.

## Releasing a new version

Ensure that you have `bumpver` installed.

    pip install -r dev-requirements.txt

To bump version:

    bumpver update --major | --minor | --patch

Now, go to Github to create a new release which triggers publication of the new version to Wordpress plugin directory.

## Set up Wordpress for local development

Also, if you wish to use a locally running Checkout API backend, no additional setup is required.

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
  "invoice_fee_to_buyer": "no",
  "section_auto_complete_settings": "",
  "enable_company_search": "yes",
  "enable_company_search_for_others": "yes",
  "enable_address_lookup": "yes"
}
EOF
```

Now you can bring up your Wordpress instance:

```bash
docker-compose up -d
```

Navigate to <http://localhost:8888/> on your browser to access the Wordpress site.

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
