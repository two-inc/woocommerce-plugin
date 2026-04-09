#! /bin/bash
set -ex

cd /var/www/html
wp core install --url="$WORDPRESS_URL" --title="$WORDPRESS_TITLE" --admin_user=$WORDPRESS_ADMIN_USER --admin_password=$WORDPRESS_ADMIN_PASSWORD --admin_email=$WORDPRESS_ADMIN_EMAIL
# wp core update
wp theme install storefront --activate
wp plugin install loco-translate --activate
wp plugin install woocommerce --version=$WOOCOM_VERSION --activate --force
existing_products=$(wp wc product list --user=admin --format=count 2>/dev/null || echo 0)
if [ "$existing_products" -lt 4 ]; then
  for i in 1 2 3 4; do
    random_price=$(shuf -i 100-200 -n 1)
    wp wc product create --user=admin --name="Product ${i}" --type=simple --regular_price=$random_price --manage_stock=true --stock_quantity=999 --status=publish
  done
  wp wc product create --user=admin --name="Expensive Product" --type=simple --regular_price=500000 --manage_stock=true --stock_quantity=999 --status=publish
fi
wp option update permalink_structure /%year%/%monthnum%/%day%/%postname%/
set +e
until wp plugin activate tillit-payment-gateway; do
  echo "Waiting for tillit-payment-gateway plugin..."
  sleep 2
done
set -e
PLUGIN_CONFIG="/opt/tillit-payment-gateway/${WOOCOM_PLUGIN_CONFIG_JSON:-docker/config/local.json}"
if [ -f "$PLUGIN_CONFIG" ]; then
  wp option update woocommerce_woocommerce-gateway-tillit_settings --format=json <"$PLUGIN_CONFIG"
else
  echo "Warning: Plugin config not found at $PLUGIN_CONFIG, skipping settings load"
fi
wp post update $(wp option get woocommerce_checkout_page_id) --post_content='[woocommerce_checkout]'
wp post update $(wp option get woocommerce_cart_page_id) --post_content='[woocommerce_cart]'
wp option update woocommerce_coming_soon no
wp option update woocommerce_currency $WOOCOM_CURRENCY
wp option update woocommerce_default_country $WOOCOM_DEFAULT_COUNTRY
sleep infinity
