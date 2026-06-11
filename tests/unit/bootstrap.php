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

function get_home_url()
{
    return 'https://shop.example';
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

function get_woocommerce_currency()
{
    return $GLOBALS['__twoinc_test_currency'] ?? 'EUR';
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

    public function __construct($total, $total_tax = 0.0)
    {
        $this->total = $total;
        $this->total_tax = $total_tax;
    }

    public function get_total_tax()
    {
        return $this->total_tax;
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

    public function get_option($key, $empty_value = null)
    {
        return $empty_value ?? '';
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

require WC_TWOINC_PLUGIN_PATH . 'class/WC_Twoinc_Brand.php';
require WC_TWOINC_PLUGIN_PATH . 'class/WC_Twoinc_Helper.php';
require WC_TWOINC_PLUGIN_PATH . 'class/WC_Twoinc_Checkout.php';
require WC_TWOINC_PLUGIN_PATH . 'class/WC_Twoinc.php';
