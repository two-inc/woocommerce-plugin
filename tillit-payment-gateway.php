<?php
/**
 * Plugin Name: Tillit Payment Gateway
 * Plugin URI: https://tillit.ai
 * Description: Integration between WooCommerce and Tillit.
 * Version: 1.2.5
 * Author: Tillit
 * Author URI: https://tillit.ai
 * Text Domain: tillit-payment-gateway
 * License: GPLv2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 */

// Make sure WooCommerce is active
if (!in_array('woocommerce/woocommerce.php', apply_filters('active_plugins', get_option('active_plugins')))) return;

// Define the plugin URL
define('WC_TILLIT_PLUGIN_URL', plugin_dir_url(__FILE__));
define('WC_TILLIT_PLUGIN_PATH', plugin_dir_path(__FILE__));

function woocommerce_gateway_tillit_classes()
{
    init_tillit_translation();
    require_once __DIR__ . '/class/WC_Tillit_Helper.php';
    require_once __DIR__ . '/class/WC_Tillit_Checkout.php';
    require_once __DIR__ . '/class/WC_Tillit.php';

    $tillit_payment_gateway = get_tillit_gateway();
    add_action('woocommerce_checkout_update_order_review', [$tillit_payment_gateway, 'change_tillit_payment_title']);
    // For order update by Save button
    add_action('woocommerce_before_save_order_items', [$tillit_payment_gateway, 'before_order_item_save'], 10, 2);
    add_action('woocommerce_saved_order_items', [$tillit_payment_gateway, 'after_order_item_save'], 10, 2);
    // For order update by add/remove item (product/fee/shipping) and recalculate (tax)
    add_action('woocommerce_admin_order_item_headers', [$tillit_payment_gateway, 'after_order_item_update'], 10, 1);
    // For order update using Update post
    add_action('save_post_shop_order', [$tillit_payment_gateway, 'before_order_update'], 10, 2);
    add_action('wp_after_insert_post', [$tillit_payment_gateway, 'after_order_update'], 10, 4);

    add_action('deactivate_' . plugin_basename(__FILE__), [$tillit_payment_gateway, 'on_deactivate_plugin']);
}

function init_tillit_translation()
{
    $plugin_rel_path = basename(dirname( __FILE__ ));
    load_plugin_textdomain('tillit-payment-gateway', false, $plugin_rel_path);
}

/**
 * Add plugin to payment gateways list
 *
 * @param $gateways
 *
 * @return array
 */
function wc_tillit_add_to_gateways($gateways)
{
    $gateways[] = 'WC_Tillit';
    return $gateways;
}

/**
 * Enqueue plugin styles
 *
 * @return void
 */
function wc_tillit_enqueue_styles()
{
    wp_enqueue_style('tillit-payment-gateway-css', WC_TILLIT_PLUGIN_URL . '/assets/css/tillit.css', false, '1.0.4');
}

function wc_tillit_enqueue_scripts()
{
    wp_enqueue_script('tillit-payment-gateway-js', WC_TILLIT_PLUGIN_URL . '/assets/js/tillit.js', ['jquery'], '1.0.9');
}

function tillit_settings_link($links)
{
    $settings_link = '<a href="admin.php?page=wc-settings&tab=checkout&section=woocommerce-gateway-tillit">Settings</a>';
    array_unshift($links, $settings_link);
    return $links;
}

function get_tillit_gateway()
{
    global $tillit_payment_gateway;
    if (!isset($tillit_payment_gateway)) {
        $tillit_payment_gateway = new WC_Tillit();
    }
    return $tillit_payment_gateway;
}


add_filter('woocommerce_payment_gateways', 'wc_tillit_add_to_gateways');
add_filter("plugin_action_links_" . plugin_basename(__FILE__), 'tillit_settings_link');

add_action('plugins_loaded', 'woocommerce_gateway_tillit_classes');
add_action('wp_enqueue_scripts', 'wc_tillit_enqueue_styles');
add_action('wp_enqueue_scripts', 'wc_tillit_enqueue_scripts');
