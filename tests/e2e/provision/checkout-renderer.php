<?php

// Usage: wp eval-file tests/e2e/provision/checkout-renderer.php <blocks|classic>
//
// Configures the shop's one checkout page for a renderer, the way a merchant
// does: the page content decides which renderer WooCommerce runs. The e2e
// suite then drives a plain /checkout/ with nothing to switch at runtime.

if (! class_exists('WC_Install')) {
    WP_CLI::error('WooCommerce is not active');
}

$renderer = isset($args[0]) ? $args[0] : '';
if (! in_array($renderer, array('blocks', 'classic'), true)) {
    WP_CLI::error('usage: wp eval-file <this file> <blocks|classic>');
}

/**
 * WooCommerce's own canonical Blocks checkout markup.
 *
 * get_checkout_block_content() is protected; the public create_pages() passes
 * the same markup through this filter, ahead of a theme's rewrite to the
 * shortcode.
 */
function two_e2e_blocks_checkout_content()
{
    add_filter(
        'woocommerce_create_pages',
        function ($pages) {
            $GLOBALS['two_e2e_blocks_checkout_content'] = isset($pages['checkout']['content'])
                ? $pages['checkout']['content']
                : '';
            return $pages;
        },
        PHP_INT_MIN
    );
    // Create nothing: this call is only a content source.
    add_filter('woocommerce_create_pages', '__return_empty_array', PHP_INT_MAX);
    WC_Install::create_pages();

    $content = isset($GLOBALS['two_e2e_blocks_checkout_content'])
        ? $GLOBALS['two_e2e_blocks_checkout_content']
        : '';
    if (false === strpos($content, 'wp:woocommerce/checkout-fields-block')) {
        WP_CLI::error('WooCommerce no longer yields inner Blocks checkout markup');
    }

    return $content;
}

$page_id = (int) get_option('woocommerce_checkout_page_id');
$page    = $page_id ? get_post($page_id) : null;
if (! $page || 'page' !== $page->post_type) {
    $page = get_page_by_path('checkout');
}
if (! $page) {
    WP_CLI::error('the shop has no checkout page');
}

$content = 'blocks' === $renderer ? two_e2e_blocks_checkout_content() : '[woocommerce_checkout]';

$updated = wp_update_post(
    array(
        'ID'           => $page->ID,
        'post_name'    => 'checkout',
        'post_parent'  => 0,
        'post_status'  => 'publish',
        'post_content' => $content,
    ),
    true
);
if (is_wp_error($updated)) {
    WP_CLI::error('could not write the checkout page: ' . $updated->get_error_message());
}

update_option('woocommerce_checkout_page_id', $page->ID);

WP_CLI::log(sprintf('[checkout-renderer] %s -> %s', $renderer, get_permalink($page->ID)));
