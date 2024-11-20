<?php
/**
 * Plugin Name: Achteraf betalen van ABN AMRO
 * Plugin URI: https://docs.achterafbetalen.co/developer-portal/plugins/woocommerce
 * Description: Integration between WooCommerce and Achteraf betalen van ABN AMRO
 * Version: 2.20.1
 * Author: ABN AMRO
 * Author URI: https://docs.achterafbetalen.co/developer-portal/plugins/woocommerce
 * Text Domain: abn-payment-gateway
 * Domain Path: /languages/
 * License: GPLv2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 */

// Make sure WooCommerce is active
// commented out because this will not work in multisites wordpress
// if (!in_array('woocommerce/woocommerce.php', apply_filters('active_plugins', get_option('active_plugins')))) return;
$activeplugins =  apply_filters('active_plugins', get_option('active_plugins'));
$activesiteplugins = apply_filters('active_sitewide_plugins', get_site_option('active_sitewide_plugins'));
if ($activesiteplugins) {
    $activeplugins = array_merge($activeplugins, array_keys($activesiteplugins));
}
if (!in_array('woocommerce/woocommerce.php', $activeplugins)) {
    return;
}


// Define the plugin URL
define('WC_ABN_PLUGIN_URL', plugin_dir_url(__FILE__));
define('WC_ABN_PLUGIN_PATH', plugin_dir_path(__FILE__));

add_filter('woocommerce_payment_gateways', 'wc_abn_add_to_gateways');
add_action('plugins_loaded', 'load_abn_classes');

if (is_admin() && !defined('DOING_AJAX')) {
    add_filter("plugin_action_links_" . plugin_basename(__FILE__), 'abn_settings_link');
}

if (!is_admin() && !defined('DOING_AJAX')) {
    add_action('wp_enqueue_scripts', 'wc_abn_enqueue_styles');
    add_action('wp_enqueue_scripts', 'wc_abn_enqueue_scripts');
}


function load_abn_classes()
{
    // Support i18n
    init_abn_translation();

    // JSON endpoint to check plugin status
    add_action('rest_api_init', 'register_abn_plugin_status_checking');

    // Load classes
    require_once __DIR__ . '/class/WC_ABN_Helper.php';
    require_once __DIR__ . '/class/WC_ABN_Checkout.php';
    require_once __DIR__ . '/class/WC_ABN.php';

    // JSON endpoint to list and sync status of orders
    add_action('rest_api_init', 'register_abn_list_out_of_sync_order_ids');
    add_action('rest_api_init', 'register_abn_sync_order_state');

    // JSON endpoint to get user configs of ABN plugin
    add_action('rest_api_init', 'register_abn_get_plugin_configs');

    // JSON endpoint to get ABN order info
    add_action('rest_api_init', 'register_abn_get_order_info');

    // Confirm order after returning from abn checkout-page, DO NOT CHANGE HOOKS
    add_action('template_redirect', 'WC_ABN::process_confirmation_header_redirect');
    // add_action('template_redirect', 'WC_ABN::before_process_confirmation');
    // add_action('get_header', 'WC_ABN::process_confirmation_header_redirect');
    // add_action('init', 'WC_ABN::process_confirmation_js_redirect'); // some theme does not call get_header()

    // Load user meta fields to user profile admin page
    add_action('show_user_profile', 'WC_ABN::display_user_meta_edit', 10, 1);
    add_action('edit_user_profile', 'WC_ABN::display_user_meta_edit', 10, 1);
    // Save user meta fields on profile update
    add_action('personal_options_update', 'WC_ABN::save_user_meta', 10, 1);
    add_action('edit_user_profile_update', 'WC_ABN::save_user_meta', 10, 1);

    // A fallback hook in case hook woocommerce_order_status_xxx is not called
    add_action('woocommerce_order_edit_status', 'WC_ABN::on_order_edit_status', 10, 2);

    // On order bulk action
    add_action('handle_bulk_actions-edit-shop_order', 'WC_ABN::on_order_bulk_edit_action', 10, 3);
    add_action('admin_notices', 'WC_ABN::on_order_bulk_edit_notices');
}

/**
 * Initiate the text translation for domain abn-payment-gateway
 */
function init_abn_translation()
{
    $plugin_rel_path = basename(dirname(__FILE__)) . '/languages/';
    load_plugin_textdomain('abn-payment-gateway', false, $plugin_rel_path);
}

/**
 * Return the status of the plugin
 */
function register_abn_plugin_status_checking()
{
    register_rest_route(
        'abn-payment-gateway',
        'abn_plugin_status_checking',
        array(
            'methods' => 'GET',
            'callback' => function ($request) {
                return [
                    'version' => get_abn_plugin_version()
                ];
            },
            'permission_callback' => '__return_true'
        )
    );
}

/**
 * Return the id of orders with status out of sync with ABN
 */
function register_abn_list_out_of_sync_order_ids()
{
    register_rest_route(
        'abn-payment-gateway',
        'abn_list_out_of_sync_order_ids',
        array(
            'methods' => 'GET',
            'callback' => [WC_ABN::class, 'list_out_of_sync_order_ids_wrapper'],
            'permission_callback' => '__return_true'
        )
    );
}

/**
 * Sync latest order state with ABN
 */
function register_abn_sync_order_state()
{
    register_rest_route(
        'abn-payment-gateway',
        'abn_sync_order_state',
        array(
            'methods' => 'POST',
            'callback' => [WC_ABN::class, 'sync_order_state_wrapper'],
            'permission_callback' => '__return_true'
        )
    );
}

/**
 * Get the plugin configs except api key
 */
function register_abn_get_plugin_configs()
{
    register_rest_route(
        'abn-payment-gateway',
        'abn_get_plugin_configs',
        array(
            'methods' => 'GET',
            'callback' => [WC_ABN::class, 'get_plugin_configs_wrapper'],
            'permission_callback' => '__return_true'
        )
    );
}

/**
 * Get the order information
 */
function register_abn_get_order_info()
{
    register_rest_route(
        'abn-payment-gateway',
        'abn_get_order_info',
        array(
            'methods' => 'GET',
            'callback' => [WC_ABN::class, 'get_order_info_wrapper'],
            'permission_callback' => '__return_true'
        )
    );
}

/**
 * Add plugin to payment gateways list
 */
function wc_abn_add_to_gateways($gateways)
{
    $gateways[] = 'WC_ABN';
    return $gateways;
}

/**
 * Enqueue plugin styles
 */
function wc_abn_enqueue_styles()
{
    wp_enqueue_style('abn-payment-gateway-css', WC_ABN_PLUGIN_URL . '/assets/css/abn.css', false, get_abn_plugin_version());
}

/**
 * Enqueue plugin javascripts
 */
function wc_abn_enqueue_scripts()
{
    wp_enqueue_script('abn-payment-gateway-js', WC_ABN_PLUGIN_URL . '/assets/js/abn.js', ['jquery'], get_abn_plugin_version());
}

/**
 * Add setting link next to plugin name in plugin list
 */
function abn_settings_link($links)
{
    $settings_link = '<a href="admin.php?page=wc-settings&tab=checkout&section=woocommerce-gateway-abn">Settings</a>';
    array_unshift($links, $settings_link);
    return $links;
}

/**
 * Get the version of this ABN plugin
 */
function get_abn_plugin_version()
{
    if (!function_exists('get_plugin_data')) {
        require_once(ABSPATH . 'wp-admin/includes/plugin.php');
    }

    $plugin_data = get_plugin_data(__FILE__);
    return $plugin_data['Version'];
}
