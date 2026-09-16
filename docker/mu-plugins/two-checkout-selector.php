<?php

/**
 * Header control picking which checkout renderer this browser gets.
 *
 * Development affordance only: docker/ is export-ignored and distignored, so
 * this file cannot reach a released plugin zip.
 */

const TWO_CHECKOUT_COOKIE  = 'two_checkout_variant';
const TWO_CHECKOUT_QUERY   = 'two-checkout';
const TWO_CHECKOUT_DEFAULT = 'blocks';

function two_checkout_variants()
{
    return array(
        'blocks'  => array('label' => 'Blocks', 'path' => 'blocks/checkout'),
        'classic' => array('label' => 'Classic', 'path' => 'classic/checkout'),
    );
}

function two_checkout_variant()
{
    $variant = isset($_COOKIE[TWO_CHECKOUT_COOKIE])
        ? sanitize_key(wp_unslash($_COOKIE[TWO_CHECKOUT_COOKIE]))
        : '';

    return isset(two_checkout_variants()[$variant]) ? $variant : TWO_CHECKOUT_DEFAULT;
}

function two_checkout_page_id($variant)
{
    $variants = two_checkout_variants();
    if (! isset($variants[$variant])) {
        return 0;
    }
    $page = get_page_by_path($variants[$variant]['path']);

    return $page ? (int) $page->ID : 0;
}

add_action('init', function () {
    if (! isset($_GET[TWO_CHECKOUT_QUERY])) {
        return;
    }
    $variant = sanitize_key(wp_unslash($_GET[TWO_CHECKOUT_QUERY]));
    if (! isset(two_checkout_variants()[$variant])) {
        return;
    }
    setcookie(
        TWO_CHECKOUT_COOKIE,
        $variant,
        array(
            'expires'  => time() + (30 * 24 * 60 * 60),
            'path'     => '/',
            'samesite' => 'Lax',
        )
    );
    $_COOKIE[TWO_CHECKOUT_COOKIE] = $variant;
    wp_safe_redirect(remove_query_arg(TWO_CHECKOUT_QUERY));
    exit;
});

add_filter('woocommerce_get_checkout_url', function ($url) {
    $id = two_checkout_page_id(two_checkout_variant());

    return $id ? get_permalink($id) : $url;
});

// The Blocks cart button reads get_permalink() off the checkout-page option
// directly, out of reach of the filter above, so bounce the unwanted page.
add_action('template_redirect', function () {
    if (! is_page() || (function_exists('is_wc_endpoint_url') && is_wc_endpoint_url())) {
        return;
    }
    $variant  = two_checkout_variant();
    $unwanted = two_checkout_page_id('blocks' === $variant ? 'classic' : 'blocks');
    $wanted   = two_checkout_page_id($variant);
    if (! $unwanted || ! $wanted || ! is_page($unwanted)) {
        return;
    }
    wp_safe_redirect(get_permalink($wanted));
    exit;
});

function two_checkout_selector_render()
{
    static $rendered = false;
    if ($rendered) {
        return;
    }
    $rendered = true;

    $current = two_checkout_variant();
    $links   = '';
    foreach (two_checkout_variants() as $variant => $spec) {
        $style = $variant === $current
            ? 'background:#333;color:#fff;'
            : 'background:#fff;color:#333;';
        $links .= sprintf(
            '<a href="%s" style="%spadding:2px 8px;border-radius:3px;text-decoration:none;">%s</a>',
            esc_url(add_query_arg(TWO_CHECKOUT_QUERY, $variant)),
            $style,
            esc_html($spec['label'])
        );
    }

    printf(
        '<div id="two-checkout-selector" style="position:fixed;top:0;right:0;z-index:99999;'
        . 'display:flex;gap:6px;align-items:center;padding:6px 10px;font:12px/1.6 sans-serif;'
        . 'background:#eee;border-left:1px solid #ccc;border-bottom:1px solid #ccc;"><span>Checkout</span>%s</div>',
        $links
    );
}

// Storefront and Astra both fire wp_body_open; the wp_footer registration is the
// fallback for a theme that does not, and no-ops when the first one ran.
add_action('wp_body_open', 'two_checkout_selector_render');
add_action('wp_footer', 'two_checkout_selector_render', 1);
