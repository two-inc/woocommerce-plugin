# Tillit WooCommerce Plugin

## Installation

```bash
  $ git clone git@github.com:tillit-dot-ai/tillit-woocommerce.git
  $ cd tillit-woocommerce
  $ docker-compose up
```

# Random Notes

* Copy code into `plugins`
* Update `wp-config(.php?)` for logs:

```php
@ini_set( 'display_errors', 1 );
define('WP_DEBUG_LOG', true);
define( 'WP_DEBUG', true );
```

## Missing Functionality

* webhooks (merchant dashboard -> woocommerce)
* orders are stored in `wp_posts` and `wp_postmeta` (also some stuff in `wp_woocommerce_order_*` (`update_post_*` function in PHP)
* testing is (probably?) impossible
