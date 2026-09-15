<?php

// Usage: wp eval-file docker/checkout-pages-seed.php
//
// Lays the two checkout renderers out at /blocks/checkout/ and /classic/checkout/
// and points WooCommerce's checkout-page option at the Blocks one.

if (! class_exists('WC_Install')) {
    WP_CLI::error('WooCommerce is not active');
}

// get_checkout_block_content() is protected; the public create_pages() passes the
// same markup through this filter, ahead of a theme's rewrite to the shortcode.
add_filter(
    'woocommerce_create_pages',
    function ($pages) {
        $GLOBALS['two_blocks_checkout_content'] = isset($pages['checkout']['content'])
            ? $pages['checkout']['content']
            : '';
        return $pages;
    },
    PHP_INT_MIN
);
// Create nothing: this call is only a content source.
add_filter('woocommerce_create_pages', '__return_empty_array', PHP_INT_MAX);
WC_Install::create_pages();

$blocks_content = isset($GLOBALS['two_blocks_checkout_content'])
    ? $GLOBALS['two_blocks_checkout_content']
    : '';
if (false === strpos($blocks_content, 'wp:woocommerce/checkout-fields-block')) {
    WP_CLI::error('WooCommerce no longer yields inner Blocks checkout markup');
}

/**
 * Put a page at $path, adopting $adopt_id if it is still at its old location.
 *
 * Content is rewritten only when $marker is absent, so an operator's edits survive.
 */
function two_place_page($path, $title, $parent_id, $content, $marker, $adopt_id = 0)
{
    $slug = basename($path);
    $page = get_page_by_path($path);

    if (! $page && $adopt_id) {
        $candidate = get_post($adopt_id);
        if ($candidate && 'page' === $candidate->post_type) {
            $page = $candidate;
        }
    }

    if (! $page) {
        $id = wp_insert_post(
            array(
                'post_type'    => 'page',
                'post_status'  => 'publish',
                'post_title'   => $title,
                'post_name'    => $slug,
                'post_parent'  => $parent_id,
                'post_content' => $content,
            ),
            true
        );
        if (is_wp_error($id)) {
            WP_CLI::error("could not create /$path/");
        }
        WP_CLI::log("[checkout-pages] created /$path/");
        return (int) $id;
    }

    $update = array('ID' => $page->ID);
    if ($page->post_name !== $slug) {
        $update['post_name'] = $slug;
    }
    if ((int) $page->post_parent !== (int) $parent_id) {
        $update['post_parent'] = $parent_id;
    }
    if ('publish' !== $page->post_status) {
        $update['post_status'] = 'publish';
    }
    if ('' !== $marker && false === strpos($page->post_content, $marker)) {
        $update['post_content'] = $content;
    }
    if (count($update) > 1) {
        wp_update_post($update);
        WP_CLI::log("[checkout-pages] moved /$path/");
    }

    return (int) $page->ID;
}

$blocks_parent  = two_place_page('blocks', 'Blocks', 0, '', '');
$classic_parent = two_place_page('classic', 'Classic', 0, '', '');

$legacy_blocks = 0;
foreach (array('blocks-checkout', 'checkout-blocks') as $legacy_slug) {
    $legacy_page = get_page_by_path($legacy_slug);
    if ($legacy_page) {
        $legacy_blocks = (int) $legacy_page->ID;
        break;
    }
}

$blocks_id = two_place_page(
    'blocks/checkout',
    'Checkout',
    $blocks_parent,
    $blocks_content,
    'wp:woocommerce/checkout-fields-block',
    $legacy_blocks
);
two_place_page(
    'classic/checkout',
    'Checkout',
    $classic_parent,
    '[woocommerce_checkout]',
    '[woocommerce_checkout]',
    (int) get_option('woocommerce_checkout_page_id')
);

// Blocks owns the option because the classic page still satisfies is_checkout()
// through WooCommerce's shortcode sniff, while a non-option Blocks page does not.
update_option('woocommerce_checkout_page_id', $blocks_id);
WP_CLI::log('[checkout-pages] checkout page option -> /blocks/checkout/');
