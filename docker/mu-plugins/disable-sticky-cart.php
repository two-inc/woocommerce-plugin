<?php

/**
 * Disable Storefront sticky add-to-cart to avoid fatal error with WooCommerce 9.x.
 * The storefront_sticky_single_add_to_cart function calls is_purchasable() on a
 * string instead of a WC_Product object after order processing.
 */

add_action('init', function () {
    remove_action('storefront_after_footer', 'storefront_sticky_single_add_to_cart', 999);
});
