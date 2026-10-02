#! /bin/bash
# Entrypoint of the wpcli container, which restarts with the stack, so this
# runs on every start. Each step checks before it acts: a restart must not
# reinstall WooCommerce under the active gateway plugin, nor undo shop setup
# done by hand since first provision.
set -ex

cd /var/www/html

# Steps up to WooCommerce's activation skip plugins, so a missing or broken
# WooCommerce can't fatal wp-cli through the gateway plugin and block its own
# repair.
SAFE="--skip-plugins --skip-themes"

# Set once the shop has been shaped below: a restart leaves a finished shop
# alone, while an interrupted first provision finishes on the next start.
if wp option get twoinc_dev_provisioned $SAFE >/dev/null 2>&1; then
  provisioned=yes
else
  provisioned=no
fi

wp core is-installed $SAFE ||
  wp core install $SAFE --url="$WORDPRESS_URL" --title="$WORDPRESS_TITLE" --admin_user="$WORDPRESS_ADMIN_USER" --admin_password="$WORDPRESS_ADMIN_PASSWORD" --admin_email="$WORDPRESS_ADMIN_EMAIL"
# core install is a no-op on an existing database, which may predate this user.
wp user get "$WORDPRESS_ADMIN_USER" $SAFE >/dev/null 2>&1 ||
  wp user create "$WORDPRESS_ADMIN_USER" "$WORDPRESS_ADMIN_EMAIL" --role=administrator --user_pass="$WORDPRESS_ADMIN_PASSWORD" $SAFE

wp theme is-installed storefront $SAFE || wp theme install storefront $SAFE
wp theme activate storefront $SAFE
wp plugin is-installed loco-translate $SAFE || wp plugin install loco-translate $SAFE

# Reinstall WooCommerce only when it is missing, at another version, or an
# interrupted install left files missing or altered.
if [ "$(wp plugin get woocommerce --field=version $SAFE 2>/dev/null)" != "$WOOCOM_VERSION" ] ||
  ! wp plugin verify-checksums woocommerce $SAFE; then
  wp plugin install woocommerce --version="$WOOCOM_VERSION" --force $SAFE
fi
wp plugin activate woocommerce loco-translate $SAFE

set +e
until wp plugin activate tillit-payment-gateway; do
  echo "Waiting for tillit-payment-gateway plugin..."
  sleep 2
done
set -e

if [ "$provisioned" = no ]; then
  existing_products=$(wp wc product list --user="$WORDPRESS_ADMIN_USER" --format=count 2>/dev/null || echo 0)
  if [ "$existing_products" -lt 4 ]; then
    for i in 1 2 3 4; do
      random_price=$(shuf -i 100-200 -n 1)
      wp wc product create --user="$WORDPRESS_ADMIN_USER" --name="Product ${i}" --type=simple --regular_price=$random_price --manage_stock=true --stock_quantity=999 --status=publish
    done
  fi
  expensive_exists=$(wp wc product list --user="$WORDPRESS_ADMIN_USER" --search="Expensive Product" --format=count 2>/dev/null || echo 0)
  if [ "$expensive_exists" -lt 1 ]; then
    wp wc product create --user="$WORDPRESS_ADMIN_USER" --name="Expensive Product" --type=simple --regular_price=500000 --manage_stock=true --stock_quantity=999 --status=publish
  fi
  wp option update permalink_structure /%year%/%monthnum%/%day%/%postname%/
  PLUGIN_CONFIG="/opt/tillit-payment-gateway/${WOOCOM_PLUGIN_CONFIG_JSON:-docker/config/local.json}"
  # Static fallback matching the two brand's gateway id; running the
  # harness as an overlay brand requires TWO_GATEWAY_ID to be set to the
  # overlay's id (and its plugin to be installed in the container)
  OPTION_KEY="woocommerce_${TWO_GATEWAY_ID:-woocommerce-gateway-tillit}_settings"
  if [ -f "$PLUGIN_CONFIG" ]; then
    wp option update "$OPTION_KEY" --format=json <"$PLUGIN_CONFIG"
  else
    echo "Warning: Plugin config not found at $PLUGIN_CONFIG, skipping settings load"
  fi
  wp post update $(wp option get woocommerce_cart_page_id) --post_content='[woocommerce_cart]'
  wp option update woocommerce_coming_soon no
  wp option update woocommerce_currency $WOOCOM_CURRENCY
  wp option update woocommerce_default_country $WOOCOM_DEFAULT_COUNTRY
  wp option update twoinc_dev_provisioned yes
fi

# Env values (TWO_API_KEY / TWO_API_BASE_URL) override the JSON
bash /opt/tillit-payment-gateway/dev/configure
sleep infinity
