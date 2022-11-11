<?php
/**
 * Plugin Name: Two - BNPL for businesses
 * Plugin URI: https://two.inc
 * Description: Integration between WooCommerce and Two
 * Version: 2.13.0
 * Author: Two
 * Author URI: https://two.inc
 * Text Domain: twoinc-payment-gateway
 * License: GPLv2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 */

// Ibrahim
// Make sure WooCommerce is active
// commented out because this will not work in multisites wordpress
// if (!in_array('woocommerce/woocommerce.php', apply_filters('active_plugins', get_option('active_plugins')))) return;
$activeplugins =  apply_filters('active_plugins', get_option('active_plugins'));
$activesiteplugins = apply_filters('active_sitewide_plugins', get_site_option('active_sitewide_plugins'));
if ($activesiteplugins) {
    $activeplugins = array_merge($activeplugins, array_keys($activesiteplugins));
}
if (!in_array('woocommerce/woocommerce.php', $activeplugins)) return;


// Define the plugin URL
define('WC_TWOINC_PLUGIN_URL', plugin_dir_url(__FILE__));
define('WC_TWOINC_PLUGIN_PATH', plugin_dir_path(__FILE__));

add_filter('woocommerce_payment_gateways', 'wc_twoinc_add_to_gateways');
add_action('plugins_loaded', 'load_twoinc_classes');

if (is_admin() && !defined('DOING_AJAX')) {
    add_filter("plugin_action_links_" . plugin_basename(__FILE__), 'twoinc_settings_link');
}

if (!is_admin() && !defined('DOING_AJAX')) {
    add_action('wp_enqueue_scripts', 'wc_twoinc_enqueue_styles');
    add_action('wp_enqueue_scripts', 'wc_twoinc_enqueue_scripts');
}


function load_twoinc_classes()
{
    // Support i18n
    init_twoinc_translation();

    // JSON endpoint to check plugin status
    add_action('rest_api_init', 'register_plugin_status_checking');

    // Load classes
    require_once __DIR__ . '/class/WC_Twoinc_Helper.php';
    require_once __DIR__ . '/class/WC_Twoinc_Checkout.php';
    require_once __DIR__ . '/class/WC_Twoinc.php';

    // JSON endpoint to list and sync status of orders
    add_action('rest_api_init', 'register_list_out_of_sync_order_ids');
    add_action('rest_api_init', 'register_sync_order_state');

    add_action('template_redirect', 'WC_Twoinc::one_click_setup');
    // Confirm order after returning from twoinc checkout-page, DO NOT CHANGE HOOKS
    add_action('template_redirect', 'WC_Twoinc::process_confirmation_header_redirect');
    // add_action('template_redirect', 'WC_Twoinc::before_process_confirmation');
    // add_action('get_header', 'WC_Twoinc::process_confirmation_header_redirect');
    // add_action('init', 'WC_Twoinc::process_confirmation_js_redirect'); // some theme does not call get_header()

    // Load user meta fields to user profile admin page
    add_action('show_user_profile', 'WC_Twoinc::display_user_meta_edit', 10, 1);
    add_action('edit_user_profile', 'WC_Twoinc::display_user_meta_edit', 10, 1);
    // Save user meta fields on profile update
    add_action('personal_options_update', 'WC_Twoinc::save_user_meta', 10, 1);
    add_action('edit_user_profile_update', 'WC_Twoinc::save_user_meta', 10, 1);

    // A fallback hook in case hook woocommerce_order_status_xxx is not called
    add_action('woocommerce_order_edit_status', 'WC_Twoinc::on_order_edit_status', 10, 2);
}

/**
 * Initiate the text translation for domain twoinc-payment-gateway
 */
function init_twoinc_translation()
{
    $plugin_rel_path = basename(dirname(__FILE__));
    load_plugin_textdomain('twoinc-payment-gateway', false, $plugin_rel_path);
}

/**
 * Return the status of the plugin
 */
function register_plugin_status_checking()
{
    register_rest_route(
        'twoinc-payment-gateway',
        'twoinc_plugin_status_checking',
        array(
            'methods' => 'GET',
            'callback' => function($request) {
                return [
                    'version' => get_plugin_version()
                ];
            },
            'permission_callback' => '__return_true'
        )
    );
}

/**
 * Return the id of orders with status out of sync with Two
 */
function register_list_out_of_sync_order_ids()
{
    register_rest_route(
        'twoinc-payment-gateway',
        'twoinc_list_out_of_sync_order_ids',
        array(
            'methods' => 'GET',
            'callback' => [WC_Twoinc::class, 'list_out_of_sync_order_ids_wrapper'],
            'permission_callback' => '__return_true'
        )
    );
}

/**
 * Sync latest order state with Two
 */
function register_sync_order_state()
{
    register_rest_route(
        'twoinc-payment-gateway',
        'twoinc_sync_order_state',
        array(
            'methods' => 'POST',
            'callback' => [WC_Twoinc::class, 'sync_order_state_wrapper'],
            'permission_callback' => '__return_true'
        )
    );
}

/**
 * Add plugin to payment gateways list
 */
function wc_twoinc_add_to_gateways($gateways)
{
    $gateways[] = 'WC_Twoinc';
    return $gateways;
}

/**
 * Enqueue plugin styles
 */
function wc_twoinc_enqueue_styles()
{
    wp_enqueue_style('twoinc-payment-gateway-css', WC_TWOINC_PLUGIN_URL . '/assets/css/twoinc.css', false, '1.2.6');
}

/**
 * Enqueue plugin javascripts
 */
function wc_twoinc_enqueue_scripts()
{
    wp_enqueue_script('twoinc-payment-gateway-js', WC_TWOINC_PLUGIN_URL . '/assets/js/twoinc.js', ['jquery'], '2.4.6');
}

/**
 * Add setting link next to plugin name in plugin list
 */
function twoinc_settings_link($links)
{
    $settings_link = '<a href="admin.php?page=wc-settings&tab=checkout&section=woocommerce-gateway-tillit">Settings</a>';
    array_unshift($links, $settings_link);
    return $links;
}

/**
 * Get the version of this Twoinc plugin
 */
function get_plugin_version()
{
    if(!function_exists('get_plugin_data')){
        require_once(ABSPATH . 'wp-admin/includes/plugin.php');
    }

    $plugin_data = get_plugin_data(__FILE__);
    return $plugin_data['Version'];
}
