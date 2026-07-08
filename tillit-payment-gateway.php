<?php

/**
 * Plugin Name: Two - BNPL for businesses
 * Plugin URI: https://two.inc
 * Description: Integration between WooCommerce and Two
 * Version: 2.23.9
 * Author: Two
 * Author URI: https://two.inc
 * Text Domain: twoinc-payment-gateway
 * Domain Path: /languages/
 * License: GPLv2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Requires Plugins: woocommerce
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
define('WC_TWOINC_PLUGIN_URL', plugin_dir_url(__FILE__));
define('WC_TWOINC_PLUGIN_PATH', plugin_dir_path(__FILE__));

add_filter('woocommerce_payment_gateways', 'wc_twoinc_add_to_gateways');
add_action('plugins_loaded', 'load_twoinc_classes');

// Must be registered from the MAIN plugin file: register_deactivation_hook()
// keys the hook by this file's plugin basename. The old registration inside
// class/WC_Twoinc.php built the hook name from its own __FILE__, so it never
// fired and the "clear options on deactivation" setting was dead (TWO-25028).
register_deactivation_hook(__FILE__, 'twoinc_on_deactivate_plugin');

function twoinc_on_deactivate_plugin()
{
    // Deactivation runs after plugins_loaded, so load_twoinc_classes() has
    // already required the gateway class whenever WooCommerce is active.
    // If WooCommerce is inactive this file returns before registering the
    // hook at all, so cleanup only happens while WooCommerce is active.
    if (class_exists('WC_Twoinc')) {
        WC_Twoinc::get_instance()->on_deactivate_plugin();
    }
}

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

    // Add AJAX handlers for API key verification
    add_action('wp_ajax_twoinc_verify_api_key', 'twoinc_ajax_verify_api_key');

    // Admin inline merchant-rate fees beside the payment-term checkboxes
    add_action('wp_ajax_twoinc_term_fees', 'twoinc_ajax_term_fees');

    // Load classes
    require_once __DIR__ . '/class/WC_Twoinc_Brand.php';
    require_once __DIR__ . '/class/WC_Twoinc_Helper.php';
    require_once __DIR__ . '/class/WC_Twoinc_Payment_Terms.php';
    require_once __DIR__ . '/class/WC_Twoinc_Sole_Trader.php';
    require_once __DIR__ . '/class/WC_Twoinc_Checkout.php';
    require_once __DIR__ . '/class/WC_Twoinc.php';

    // Checkout AJAX endpoints (term-fee chips, term selection, sole-trader
    // availability/tokens). Registered here at plugins_loaded — NOT in the
    // gateway constructor — because a wc-ajax request is dispatched at
    // template_redirect priority 0, before WooCommerce instantiates the
    // payment gateways on demand. The constructor only runs on pages that
    // load the gateway (e.g. checkout), so handlers registered there are
    // absent on the standalone wc-ajax request and the action fires with no
    // listener (empty 200). The handlers are static and lazily fetch the
    // gateway via WC_Twoinc::get_instance(), so no instance is needed here.
    //
    // The surcharge cart fee is registered here for the same reason: on an
    // update_order_review recalc, calculate_totals() (which fires
    // woocommerce_cart_calculate_fees) can run before WooCommerce constructs
    // the gateway, so a constructor-registered hook is missed and the fee
    // never lands on the order total. apply_cart_fee is static and self-gates
    // (enabled + chosen-payment-method + selected-term), so registering it on
    // every request is safe.
    add_action('woocommerce_cart_calculate_fees', ['WC_Twoinc_Payment_Terms', 'apply_cart_fee']);
    add_action('wc_ajax_two_term_fees', ['WC_Twoinc_Payment_Terms', 'ajax_term_fees']);
    add_action('wc_ajax_two_select_term', ['WC_Twoinc_Payment_Terms', 'ajax_select_term']);
    add_action('wc_ajax_two_sole_trader_availability', ['WC_Twoinc_Sole_Trader', 'ajax_availability']);
    add_action('wc_ajax_two_sole_trader_tokens', ['WC_Twoinc_Sole_Trader', 'ajax_tokens']);

    // Admin invoice / credit-note PDF download from the order edit screen:
    // streams the PDF, or redirects back with a notice after the
    // ORDER_NOT_FULFILLED state check (TWO-25041). A static handler
    // registered here at plugins_loaded like the wc-ajax endpoints above,
    // since an admin-ajax request does not construct the payment gateway.
    add_action('wp_ajax_twoinc_download_invoice', ['WC_Twoinc', 'ajax_download_invoice']);

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

    // On order bulk action
    add_action('handle_bulk_actions-edit-shop_order', 'WC_Twoinc::on_order_bulk_edit_action', 10, 3);
    add_action('admin_notices', 'WC_Twoinc::on_order_bulk_edit_notices');
}

/**
 * Initiate the text translation for domain twoinc-payment-gateway
 */
function init_twoinc_translation()
{
    $plugin_rel_path = basename(dirname(__FILE__)) . '/languages/';
    load_plugin_textdomain('twoinc-payment-gateway', false, $plugin_rel_path);
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
    wp_enqueue_style('twoinc-payment-gateway-css', WC_TWOINC_PLUGIN_URL . '/assets/css/twoinc.css', false, get_twoinc_plugin_version());
}

/**
 * Enqueue plugin javascripts
 */
function wc_twoinc_enqueue_scripts()
{
    wp_enqueue_script('twoinc-payment-gateway-js', WC_TWOINC_PLUGIN_URL . '/assets/js/twoinc.js', ['jquery'], get_twoinc_plugin_version());
}

/**
 * Add setting link next to plugin name in plugin list
 */
function twoinc_settings_link($links)
{
    $settings_link = '<a href="admin.php?page=wc-settings&tab=checkout&section=' . WC_Twoinc_Brand::get('gateway_id') . '">Settings</a>';
    array_unshift($links, $settings_link);
    return $links;
}

/**
 * Get the version of this Twoinc plugin
 */
function get_twoinc_plugin_version()
{
    if (!function_exists('get_plugin_data')) {
        require_once(ABSPATH . 'wp-admin/includes/plugin.php');
    }

    $plugin_data = get_plugin_data(__FILE__);
    return $plugin_data['Version'];
}

/**
 * AJAX handler for API key verification
 */
function twoinc_ajax_verify_api_key()
{
    // Check if request method is POST
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        wp_send_json_error('Invalid request method');
        return;
    }

    // Check if required data is present
    if (!isset($_POST['nonce']) || !isset($_POST['api_key'])) {
        wp_send_json_error('Missing required data');
        return;
    }

    // Verify nonce
    if (!wp_verify_nonce($_POST['nonce'], 'twoinc_admin_nonce')) {
        wp_send_json_error('Security check failed');
        return;
    }

    // Check user capabilities
    if (!current_user_can('manage_options')) {
        wp_send_json_error('Insufficient permissions');
        return;
    }

    $api_key = sanitize_text_field($_POST['api_key']);

    if (empty($api_key)) {
        wp_send_json_error('API key is required');
        return;
    }

    // Get the Two instance and verify the API key
    $twoinc_instance = WC_Twoinc::get_instance();
    $result = $twoinc_instance->verify_api_key($api_key);

    if ($result && isset($result['code']) && $result['code'] == 200) {
        // Echo the merchant identity back so the settings page can refresh the
        // displayed Merchant ID + short name as soon as validation completes,
        // without a reload (the key being typed is not persisted here).
        $body = isset($result['body']) && is_array($result['body']) ? $result['body'] : [];
        wp_send_json_success([
            'message' => 'API key is valid',
            'merchant_id' => isset($body['id']) ? (string) $body['id'] : '',
            'merchant_short_name' => isset($body['short_name']) ? (string) $body['short_name'] : '',
        ]);
    } else {
        $debug_info = [
            'result' => $result,
            'api_key_length' => strlen($api_key),
            'host' => $twoinc_instance->get_twoinc_checkout_host()
        ];
        wp_send_json_error(['message' => 'API key is invalid', 'debug' => $debug_info]);
    }
}

/**
 * AJAX endpoint for the admin inline merchant-rate fees beside the payment-term
 * checkboxes. Resolves the merchant's per-term pricing rate (percentage +
 * fixed) so the config page can preview what Two charges the merchant for each
 * offered term. Mirrors Magento's Controller\Adminhtml\Config\Fees.
 *
 * Fail-soft: on any error returns success:false; the admin JS leaves the fee
 * spans empty so the config page never breaks on a pricing-API outage.
 */
function twoinc_ajax_term_fees()
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        wp_send_json_error('Invalid request method');
        return;
    }

    if (!isset($_POST['nonce']) || !wp_verify_nonce($_POST['nonce'], 'twoinc_admin_nonce')) {
        wp_send_json_error('Security check failed');
        return;
    }

    if (!current_user_can('manage_options')) {
        wp_send_json_error('Insufficient permissions');
        return;
    }

    $raw_terms = isset($_POST['terms']) ? wp_unslash($_POST['terms']) : '';
    $decoded = is_string($raw_terms) ? json_decode($raw_terms, true) : $raw_terms;
    $terms = is_array($decoded) ? array_map('intval', $decoded) : [];
    if (count(array_filter($terms, static function ($d) {
        return $d > 0;
    })) === 0) {
        wp_send_json_error('No terms');
        return;
    }

    $twoinc_instance = WC_Twoinc::get_instance();
    // No admin-side buyer-country config exists; use the shop base country as
    // a stand-in for the rate preview (matches Magento's resolveBuyerCountry).
    $buyer_country = strtoupper((string) WC()->countries->get_base_country());

    $rates = WC_Twoinc_Payment_Terms::fetch_merchant_rates($twoinc_instance, $terms, $buyer_country);

    if (empty($rates['success'])) {
        wp_send_json_error('Could not fetch merchant rates');
        return;
    }

    wp_send_json_success([
        'currency' => $rates['currency'] ?? '',
        'fees' => $rates['fees'] ?? [],
    ]);
}
