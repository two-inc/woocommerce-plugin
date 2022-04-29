# Tillit WooCommerce Plugin

## Installation

```bash
git clone git@github.com:tillit-dot-ai/tillit-woocommerce.git
cd tillit-woocommerce
docker-compose up
```

## End-to-end Test

```bash
npx cypress run --browser chrome --config baseUrl=http://localhost
```

## Set up wordpress for local development
For Mac users, follow this guide:
https://skillcrush.com/blog/install-wordpress-mac/

Once wordpress has been set up, the following plugins need to be installed:
- Elementor (optional but easy way to get started) - select an ecommerce template
- Loco translate
- WooCommerce
- WooCommerce Cart Abdandonment Recovery
- WooCommerce Shipping & Tax
- WPForms Lite

To install the two plugin, it can be found in the wp portal for plugins **'Two - BNPL for businesses'**, or you can manually add the files:
- create a zip file of this repo, which contains only the required folders and file types:
    `zip -r tillit-payment-gateway.zip 'assets' 'class' 'views' 'readme.txt' *.php *.pot *.mo *.po`
- Unzip the folder into `Sites/wp-content/plugins`

In the wordpress portal, update the WooCommerce plugin settings to suit, and add api credentials.

To enable logging, update `Sites/wp-config(.php?)` with:

```php
@ini_set( 'display_errors', 1 );
define('WP_DEBUG_LOG', true);
define( 'WP_DEBUG', true );
```

# Deploying Locally using Docker Compose

If you are developing on a Mac with M1 chip, you may want the following:

```bash
echo REPO=docker.io/arm64v8/ >> .env
```

Also, if you wish to use Checkout API backend running on a Kubernetes cluster deployed using [Skaffold][https://github.com/tillit-dot-ai/local-deploy-skaffold], you may need to create this entry:

```bash
echo WOOCOM_PLUGIN_CONFIG_JSON=config-local.json >> .env
```

Now you can bring up your Wordpress instance:

```bash
docker-compose up -d
```

Navigate to <http://localhost:5000/> on your brower to access the Wordpress site.

## Missing Functionality

* webhooks (merchant dashboard -> woocommerce)
* orders are stored in `wp_posts` and `wp_postmeta` (also some stuff in `wp_woocommerce_order_*` (`update_post_*` function in PHP)
