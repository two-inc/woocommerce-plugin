#! /bin/bash
set -ex

cd /var/www/html
wp core install --url="$WORDPRESS_URL" --title="$WORDPRESS_TITLE" --admin_user=$WORDPRESS_ADMIN_USER --admin_password=$WORDPRESS_ADMIN_PASSWORD --admin_email=$WORDPRESS_ADMIN_EMAIL
wp theme install storefront --activate
wp plugin install woocommerce --activate
counter=$(($(wp post list --post_type=product --format=count) + 1))
until [ $counter -gt 15 ]; do
    product_id=$(wp post generate --post_type=product --count=1 --post_title="Product ${counter}" --format=ids)
    random_price=$(shuf -i 100-200 -n 1)
    wp media import 'https://picsum.photos/600/400.jpg' --post_id=$product_id --title="Image for Product ${counter}" --featured_image
    wp post meta set $product_id _price $random_price
    counter=$(($counter + 1))
done
wp option update permalink_structure /%year%/%monthnum%/%day%/%postname%/
wp plugin install tillit-payment-gateway --activate;
wp option update woocommerce_woocommerce-gateway-tillit_settings --format=json < /opt/tillit-payment-gateway/docker/${WOOCOM_CONFIG_JSON:-config-staging.json}
wp option update woocommerce_currency $WOOCOM_CURRENCY
sleep infinity
