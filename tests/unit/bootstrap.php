<?php

/**
 * Minimal WordPress/WooCommerce stubs for unit-testing the brand config
 * layer and the compose-order extension hooks without a WP install.
 * Only what the exercised code paths touch is stubbed.
 */

declare(strict_types=1);

error_reporting(E_ALL);

define('WC_TWOINC_PLUGIN_PATH', dirname(__DIR__, 2) . '/');
define('WC_TWOINC_PLUGIN_URL', 'https://shop.example/wp-content/plugins/tillit-payment-gateway/');

// ── Tiny WP hook system ─────────────────────────────────────────────

$GLOBALS['__twoinc_test_filters'] = [];

function add_filter($tag, $callback, $priority = 10, $accepted_args = 1)
{
    $GLOBALS['__twoinc_test_filters'][$tag][] = ['cb' => $callback, 'args' => $accepted_args];
    return true;
}

function add_action($tag, $callback, $priority = 10, $accepted_args = 1)
{
    return add_filter($tag, $callback, $priority, $accepted_args);
}

function apply_filters($tag, $value, ...$extra)
{
    foreach ($GLOBALS['__twoinc_test_filters'][$tag] ?? [] as $entry) {
        $params = array_slice(array_merge([$value], $extra), 0, max(1, $entry['args']));
        $value = call_user_func_array($entry['cb'], $params);
    }
    return $value;
}

function has_filter($tag)
{
    return !empty($GLOBALS['__twoinc_test_filters'][$tag]);
}

function remove_all_filters($tag)
{
    unset($GLOBALS['__twoinc_test_filters'][$tag]);
    return true;
}

// ── WP/WC function stubs ────────────────────────────────────────────

function __($text, $domain = 'default')
{
    return $text;
}

function esc_html($text)
{
    return htmlspecialchars((string) $text, ENT_QUOTES);
}

function esc_attr($text)
{
    return htmlspecialchars((string) $text, ENT_QUOTES);
}

function esc_html_e($text, $domain = 'default')
{
    echo esc_html(__($text, $domain));
}

function wp_kses_post($content)
{
    return $content;
}

function wp_parse_args($args, $defaults = [])
{
    if (is_object($args)) {
        $args = get_object_vars($args);
    }
    return is_array($args) ? array_merge($defaults, $args) : $defaults;
}

function get_home_url()
{
    return $GLOBALS['test_home_url'] ?? 'https://shop.example';
}

function wp_create_nonce($action = -1)
{
    return 'testnonce';
}

function wp_specialchars_decode($string, $quote_style = ENT_NOQUOTES)
{
    return $string;
}

function wc_get_price_decimals()
{
    return 2;
}

function get_user_locale()
{
    return 'en_US';
}

function is_admin()
{
    return false;
}

function is_wc_endpoint_url($endpoint = false)
{
    return $endpoint === 'order-pay' && !empty($GLOBALS['__twoinc_test_is_order_pay']);
}

function get_woocommerce_currency()
{
    return $GLOBALS['__twoinc_test_currency'] ?? 'EUR';
}

function get_woocommerce_currency_symbol($currency = '')
{
    return $currency !== '' ? $currency . ' ' : '';
}

function get_option($key, $default = false)
{
    if ($key === 'woocommerce_currency') {
        return $GLOBALS['__twoinc_test_store_currency'] ?? 'EUR';
    }
    return $GLOBALS['__twoinc_test_options'][$key] ?? $default;
}

function update_option($key, $value, $autoload = null)
{
    $GLOBALS['__twoinc_test_options'][$key] = $value;
    return true;
}

function delete_option($key)
{
    unset($GLOBALS['__twoinc_test_options'][$key]);
    return true;
}

function WC()
{
    static $wc = null;
    if ($wc === null) {
        $wc = new class () {
            public $countries;
            public $cart;
            public $customer;

            public function __construct()
            {
                $this->countries = new class () {
                    public function get_base_country()
                    {
                        return 'NO';
                    }
                };
            }
        };
    }
    return $wc;
}

class StubCart
{
    public $total;
    private $total_tax;
    private $is_empty;

    public function __construct($total, $total_tax = 0.0, $is_empty = false)
    {
        $this->total = $total;
        $this->total_tax = $total_tax;
        $this->is_empty = $is_empty;
    }

    public function get_total_tax()
    {
        return $this->total_tax;
    }

    public function is_empty()
    {
        return $this->is_empty;
    }
}

class StubCustomer
{
    private $country;

    public function __construct($country)
    {
        $this->country = $country;
    }

    public function get_billing_country()
    {
        return $this->country;
    }
}

class WC_Payment_Gateway
{
    public $id;

    public $plugin_id = 'woocommerce_';

    public function get_option($key, $empty_value = null)
    {
        return $empty_value ?? '';
    }

    public function get_field_key($key)
    {
        return $this->plugin_id . $this->id . '_' . $key;
    }

    public function get_option_key()
    {
        return $this->plugin_id . $this->id . '_settings';
    }
}

class WC_HTTPS
{
    public static function force_https_url($url)
    {
        return $url;
    }
}

// ── Order stub for compose_twoinc_order ─────────────────────────────

class StubOrder
{
    // Meta store mirroring WC_Order::get_meta single-value behaviour.
    public $meta = [];

    public function get_meta($key, $single = true)
    {
        return $this->meta[$key] ?? '';
    }

    public function get_billing_company()
    {
        return 'Test Buyer AS';
    }

    public function get_billing_address_1()
    {
        return 'Testgata 1';
    }

    public function get_billing_address_2()
    {
        return '';
    }

    public function get_billing_postcode()
    {
        return '0150';
    }

    public function get_billing_city()
    {
        return 'Oslo';
    }

    public function get_billing_state()
    {
        return '';
    }

    public function get_billing_country()
    {
        return 'NO';
    }

    public function get_billing_email()
    {
        return 'buyer@example.com';
    }

    public function get_billing_first_name()
    {
        return 'Test';
    }

    public function get_billing_last_name()
    {
        return 'Buyer';
    }

    public function get_billing_phone()
    {
        return '+4712345678';
    }

    public function get_shipping_company()
    {
        return '';
    }

    public function get_shipping_address_1()
    {
        return '';
    }

    public function get_shipping_address_2()
    {
        return '';
    }

    public function get_shipping_postcode()
    {
        return '';
    }

    public function get_shipping_city()
    {
        return '';
    }

    public function get_shipping_state()
    {
        return '';
    }

    public function get_shipping_country()
    {
        return '';
    }

    public function get_currency()
    {
        return 'NOK';
    }

    public function get_total()
    {
        return 125.0;
    }

    public function get_total_tax()
    {
        return 25.0;
    }

    public function get_total_discount()
    {
        return 0.0;
    }

    public function get_customer_note()
    {
        return '';
    }

    public function get_items($type = 'line_item')
    {
        return [];
    }

    public function get_id()
    {
        return 42;
    }

    public function get_cancel_order_url()
    {
        return 'https://shop.example/cancel';
    }

    public function get_edit_order_url()
    {
        return 'https://shop.example/edit';
    }
}

function wp_json_encode($data, $options = 0, $depth = 512)
{
    return json_encode($data, $options, $depth);
}

function is_wp_error($thing)
{
    return $thing instanceof WP_Error;
}

class WP_Error
{
}

// wp_remote_* accessors over the ['response' => ['code' => …], 'body' => …,
// 'headers' => …] response-array shape the gateway's make_request returns.

function wp_remote_retrieve_response_code($response)
{
    if (is_wp_error($response) || !is_array($response)) {
        return '';
    }
    return $response['response']['code'] ?? '';
}

function wp_remote_retrieve_body($response)
{
    if (is_wp_error($response) || !is_array($response)) {
        return '';
    }
    return $response['body'] ?? '';
}

function wp_remote_retrieve_header($response, $header)
{
    if (is_wp_error($response) || !is_array($response)) {
        return '';
    }
    foreach (($response['headers'] ?? []) as $name => $value) {
        if (strtolower($name) === strtolower($header)) {
            return $value;
        }
    }
    return '';
}

require WC_TWOINC_PLUGIN_PATH . 'class/WC_Twoinc_Brand.php';
require WC_TWOINC_PLUGIN_PATH . 'class/WC_Twoinc_Helper.php';
require WC_TWOINC_PLUGIN_PATH . 'class/WC_Twoinc_Payment_Terms.php';
require WC_TWOINC_PLUGIN_PATH . 'class/WC_Twoinc_Sole_Trader.php';
require WC_TWOINC_PLUGIN_PATH . 'class/WC_Twoinc_Checkout.php';
require WC_TWOINC_PLUGIN_PATH . 'class/WC_Twoinc.php';
