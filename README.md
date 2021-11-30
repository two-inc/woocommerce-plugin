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

# Random Notes

* Copy code into `plugins`
* Update `wp-config(.php?)` for logs:

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
