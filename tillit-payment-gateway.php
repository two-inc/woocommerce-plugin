<?php
/**
 * Plugin Name: Tillit Payment Gateway
 * Plugin URI: https://tillit.ai
 * Description: Integration between WooCommerce and Tillit.
 * Version: 2.0.0
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

add_filter('woocommerce_payment_gateways', 'wc_tillit_add_to_gateways');
add_action('plugins_loaded', 'woocommerce_gateway_tillit_classes');

if (is_admin() && !defined('DOING_AJAX')) {
    add_filter("plugin_action_links_" . plugin_basename(__FILE__), 'tillit_settings_link');
}

if (!is_admin() && !defined('DOING_AJAX')) {
    add_action('wp_enqueue_scripts', 'wc_tillit_enqueue_styles');
    add_action('wp_enqueue_scripts', 'wc_tillit_enqueue_scripts');
}


function woocommerce_gateway_tillit_classes()
{
    // Support i18n
    init_tillit_translation();

    // JSON endpoint to check plugin status
    add_action('rest_api_init', 'plugin_status_checking');

    // Load classes
    require_once __DIR__ . '/class/WC_Tillit_Helper.php';
    require_once __DIR__ . '/class/WC_Tillit_Checkout.php';
    require_once __DIR__ . '/class/WC_Tillit.php';

    // Endpoint for plugin setting in one click
    $tillit_payment_gateway = WC_Tillit::get_instance();
    $tillit_payment_gateway->one_click_setup();
}

/**
 * Initiate the text translation for domain tillit-payment-gateway
 */
function init_tillit_translation()
{
    $plugin_rel_path = basename(dirname(__FILE__));
    load_plugin_textdomain('tillit-payment-gateway', false, $plugin_rel_path);
}

/**
 * Return the status of the plugin
 */
function plugin_status_checking()
{
    register_rest_route(
        'tillit-payment-gateway',
        'tillit_plugin_status_checking',
        array(
            'methods' => 'GET',
            'callback' => function($request) {
                return [
                    'version' => get_plugin_version()
                ];
            },
        )
    );
}

/**
 * Add plugin to payment gateways list
 */
function wc_tillit_add_to_gateways($gateways)
{
    $gateways[] = 'WC_Tillit';
    return $gateways;
}

/**
 * Enqueue plugin styles
 */
function wc_tillit_enqueue_styles()
{
    wp_enqueue_style('tillit-payment-gateway-css', WC_TILLIT_PLUGIN_URL . '/assets/css/tillit.css', false, '1.0.8');
}

/**
 * Enqueue plugin javascripts
 */
function wc_tillit_enqueue_scripts()
{
    wp_enqueue_script('tillit-payment-gateway-js', WC_TILLIT_PLUGIN_URL . '/assets/js/tillit.js', ['jquery'], '2.0.0');
}

/**
 * Add setting link next to plugin name in plugin list
 */
function tillit_settings_link($links)
{
    $settings_link = '<a href="admin.php?page=wc-settings&tab=checkout&section=woocommerce-gateway-tillit">Settings</a>';
    array_unshift($links, $settings_link);
    return $links;
}

/**
 * Get the version of this Tillit plugin
 */
function get_plugin_version()
{
    if(!function_exists('get_plugin_data')){
        require_once(ABSPATH . 'wp-admin/includes/plugin.php');
    }

    $plugin_data = get_plugin_data(__FILE__);
    return $plugin_data['Version'];
}
