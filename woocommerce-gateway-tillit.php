<?php
/**
 * Plugin Name: WooCommerce Tillit Gateway
 * Plugin URI: https://tillit.ai
 * Description: Integration between WooCommerce and Tillit.
 * Version: 0.0.1
 * Author: Tillit
 * Author URI: https://tillit.ai
 * Text Domain: woocommerce-gateway-tillit
 * License: GPLv2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 */

// Make sure WooCommerce is active
if (!in_array('woocommerce/woocommerce.php', apply_filters('active_plugins', get_option('active_plugins')))) return;

// Define the plugin URL
define('WC_TILLIT_PLUGIN_URL', plugin_dir_url(__FILE__));
define('WC_TILLIT_PLUGIN_PATH', plugin_dir_path(__FILE__));

function woocommerce_gateway_tillit_init()
{
    init_tillit_translation();
    require_once __DIR__ . '/class/WC_Tillit.php';
    require_once __DIR__ . '/class/WC_Tillit_Checkout.php';
}

function init_tillit_translation()
{
    $plugin_rel_path = basename(dirname( __FILE__ ));
    load_plugin_textdomain('woocommerce-gateway-tillit', false, $plugin_rel_path);
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
    wp_enqueue_style('woocommerce-gateway-tillit-css', WC_TILLIT_PLUGIN_URL . '/assets/css/tillit.css', false, '1.0.0');
}

function wc_tillit_enqueue_scripts()
{
    wp_enqueue_script('woocommerce-gateway-tillit-js', WC_TILLIT_PLUGIN_URL . '/assets/js/tillit.js', ['jquery'], '1.0.1');
}

function wc_approve_order()
{

    // Stop if no `wc_tillit_confirm` query var
    if(!isset($_GET['wc_tillit_confirm'])) return null;

    // Get the transaction code
    $transactionCode = $_GET['transaction_code'];

    // Get the order id
    $orderId = $_GET['order_id'];

    // Approve the order
    return (new WC_Tillit())->approve_order($transactionCode, $orderId);

}

function tillit_settings_link($links)
{
    $settings_link = '<a href="admin.php?page=wc-settings&tab=checkout&section=woocommerce-gateway-tillit">Settings</a>';
    array_unshift($links, $settings_link);
    return $links;
}


add_filter('woocommerce_payment_gateways', 'wc_tillit_add_to_gateways');
add_action('plugins_loaded', 'woocommerce_gateway_tillit_init');
add_action('wp_enqueue_scripts', 'wc_tillit_enqueue_styles');
add_action('wp_enqueue_scripts', 'wc_tillit_enqueue_scripts');
add_action('init', 'wc_approve_order');
add_filter("plugin_action_links_" . plugin_basename(__FILE__), 'tillit_settings_link');
