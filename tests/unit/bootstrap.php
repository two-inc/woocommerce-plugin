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
            public $session;

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

class StubSession
{
    private $data = [];

    public function get($key, $default = null)
    {
        return $this->data[$key] ?? $default;
    }

    public function set($key, $value)
    {
        $this->data[$key] = $value;
    }
}

/**
 * WC_Tax stub: additional tax classes from
 * $GLOBALS['__twoinc_test_tax_classes'] (display names, as core stores
 * them); destination-matched rate rows per class slug from
 * $GLOBALS['__twoinc_test_tax_rates'] ('' = Standard). The rate rows
 * model what core's WC_Tax::get_matched_tax_rates() returns for the
 * current destination: a LIST of percentages (multi-rate jurisdictions
 * have several rows, applied additively), empty when nothing matches.
 */
class WC_Tax
{
    public static function get_tax_classes()
    {
        return $GLOBALS['__twoinc_test_tax_classes'] ?? [];
    }

    public static function get_tax_class_slugs()
    {
        return array_filter(array_map('sanitize_title', self::get_tax_classes()));
    }

    /** @return float[] matched rate percentages for a class slug */
    public static function get_rates_for_class($slug)
    {
        return $GLOBALS['__twoinc_test_tax_rates'][$slug] ?? [];
    }
}

function sanitize_title($title)
{
    $title = strtolower(trim((string) $title));
    $title = preg_replace('/[^a-z0-9]+/', '-', $title);
    return trim($title, '-');
}

/**
 * Cart stub for the surcharge cart-fee hook. add_fee() records its exact
 * arguments (argc included, so tests can pin the 3-arg pre-feature call
 * shape) and computes the fee tax the way core does:
 *
 *  - $taxable false → no tax, unconditionally (never consults rates).
 *  - a $tax_class that doesn't match a live class silently reverts to
 *    Standard (the WC_Cart_Fees::add_fee / WC_Tax::get_rates gotcha the
 *    plugin-side validation defends against — mirrored here faithfully
 *    so a regression in that validation shows up as the WRONG TAX, not
 *    as a stub error).
 *  - matched rate rows apply additively (US state+local, CA GST+PST).
 */
class StubFeeCart
{
    public $fees = [];

    public function get_cart_contents_total()
    {
        return 100.0;
    }

    public function get_cart_contents_tax()
    {
        return 25.0;
    }

    public function get_shipping_total()
    {
        return 10.0;
    }

    public function get_shipping_tax()
    {
        return 2.5;
    }

    public function add_fee($name, $amount, $taxable = false, $tax_class = '')
    {
        $tax = 0.0;
        if ($taxable) {
            $class = (string) $tax_class;
            if ($class !== '' && !in_array($class, WC_Tax::get_tax_class_slugs(), true)) {
                $class = ''; // core's silent revert-to-Standard
            }
            foreach (WC_Tax::get_rates_for_class($class) as $percent) {
                $tax += (float) $amount * (float) $percent / 100;
            }
        }
        $this->fees[] = [
            'name' => $name,
            'amount' => $amount,
            'taxable' => $taxable,
            'tax_class' => $tax_class,
            'argc' => func_num_args(),
            'tax' => $tax,
        ];
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

    // Mirrors WC_Settings_API::get_post_data (the submitted settings form),
    // injectable per test for cross-field save validation.
    public $test_post_data = [];

    public function get_post_data()
    {
        return $this->test_post_data;
    }

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

/**
 * Product line item stub: WC_Order_Item_Product is ArrayAccess-backed,
 * and get_line_items() reads it both ways (['line_subtotal'] and
 * ->get_taxes()). Only what the exercised code paths touch is stubbed.
 */
class StubProductLineItem implements ArrayAccess
{
    private $data;

    public function __construct(array $data)
    {
        $this->data = array_merge(
            ['line_tax' => 0.0, 'quantity' => 1, 'data' => null],
            $data
        );
    }

    #[\ReturnTypeWillChange]
    public function offsetExists($offset)
    {
        return isset($this->data[$offset]);
    }

    #[\ReturnTypeWillChange]
    public function offsetGet($offset)
    {
        return $this->data[$offset] ?? null;
    }

    #[\ReturnTypeWillChange]
    public function offsetSet($offset, $value)
    {
        $this->data[$offset] = $value;
    }

    #[\ReturnTypeWillChange]
    public function offsetUnset($offset)
    {
        unset($this->data[$offset]);
    }

    public function get_name()
    {
        return $this->data['name'] ?? 'Stub product';
    }

    public function get_taxes()
    {
        return ['total' => []];
    }
}

class StubOrder
{
    // Meta store mirroring WC_Order::get_meta single-value behaviour.
    public $meta = [];

    public function get_item_subtotal($item, $inc_tax = false, $round = true)
    {
        $qty = max(1, (int) $item['quantity']);
        $subtotal = $item['line_subtotal'] / $qty;
        return $round ? round($subtotal, 2) : $subtotal;
    }

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

    // Settable per test: '' means "not a Two order" (is_twoinc_order false).
    public $payment_method = '';

    public function get_payment_method()
    {
        return $this->payment_method;
    }

    public $status = 'completed';

    public function get_status()
    {
        return $this->status;
    }

    public function get_refunds()
    {
        return [];
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

// ── Admin-ajax handler stubs (invoice download gate tests) ─────────

function absint($maybeint)
{
    return abs((int) $maybeint);
}

function sanitize_key($key)
{
    return preg_replace('/[^a-z0-9_\-]/', '', strtolower((string) $key));
}

function wp_unslash($value)
{
    return is_string($value) ? stripslashes($value) : $value;
}

function check_admin_referer($action = -1, $query_arg = '_wpnonce')
{
    // Record the action so tests can assert the nonce is scoped to the
    // resource it authorizes.
    $GLOBALS['__twoinc_test_referer_actions'][] = $action;
    return 1;
}

// Capability set injected per test via $GLOBALS['__twoinc_test_caps'].
// Meta-capability checks against a specific object (e.g.
// current_user_can('edit_shop_order', $order_id)) resolve against
// $GLOBALS['__twoinc_test_object_caps'] as "capability:object_id" strings,
// so tests can distinguish the blanket type capability from the per-object
// grant.
function current_user_can($capability, ...$args)
{
    if ($args !== []) {
        return in_array($capability . ':' . $args[0], $GLOBALS['__twoinc_test_object_caps'] ?? [], true);
    }
    return in_array($capability, $GLOBALS['__twoinc_test_caps'] ?? [], true);
}

function get_current_user_id()
{
    return $GLOBALS['__twoinc_test_user_id'] ?? 1;
}

// ── Transients (invoice-download one-shot notice) ───────────────────

function set_transient($key, $value, $expiration = 0)
{
    $GLOBALS['__twoinc_test_transients'][$key] = $value;
    return true;
}

function get_transient($key)
{
    return $GLOBALS['__twoinc_test_transients'][$key] ?? false;
}

function delete_transient($key)
{
    unset($GLOBALS['__twoinc_test_transients'][$key]);
    return true;
}

// wp_safe_redirect must halt the handler (it is followed by exit, which
// would kill the test runner): surface it as an exception the test catches.
function wp_safe_redirect($location, $status = 302)
{
    throw new RuntimeException('redirect:' . $location);
}

function esc_url_raw($url, $protocols = null)
{
    return $url;
}

function esc_url($url, $protocols = null)
{
    return $url;
}

function admin_url($path = '')
{
    return 'https://shop.example/wp-admin/' . ltrim($path, '/');
}

function add_query_arg($args, $url)
{
    return $url . (strpos($url, '?') === false ? '?' : '&') . http_build_query($args);
}

function wp_nonce_url($actionurl, $action = -1, $name = '_wpnonce')
{
    // Record the action so tests can assert mint-side scoping matches the
    // verify-side check_admin_referer action.
    $GLOBALS['__twoinc_test_nonce_url_actions'][] = $action;
    return add_query_arg([$name => 'testnonce'], $actionurl);
}

// wp_die must halt the handler: surface it as an exception the test catches.
function wp_die($message = '', $title = '', $args = [])
{
    throw new RuntimeException(is_string($message) ? $message : 'wp_die');
}

function wc_get_order($order_id)
{
    return $GLOBALS['__twoinc_test_wc_orders'][$order_id] ?? false;
}

// ── Action Scheduler stubs (FX recurring refresh, TWO-25104) ────────
// Minimal: enough to exercise WC_Twoinc_FX::maybe_schedule_refresh's
// has-scheduled-action guard and the $unique argument it passes, without
// a real Action Scheduler install. Calls recorded in
// $GLOBALS['__twoinc_test_as_schedule_calls'] for assertions.

function as_has_scheduled_action($hook, $args = null, $group = '')
{
    return !empty($GLOBALS['__twoinc_test_as_scheduled'][$hook]);
}

function as_schedule_recurring_action($timestamp, $interval, $hook, $args = [], $group = '', $unique = false)
{
    $GLOBALS['__twoinc_test_as_schedule_calls'][] = ['hook' => $hook, 'unique' => $unique];
    $GLOBALS['__twoinc_test_as_scheduled'][$hook] = true;
    return 1;
}

function as_unschedule_all_actions($hook, $args = [], $group = '')
{
    unset($GLOBALS['__twoinc_test_as_scheduled'][$hook]);
    return true;
}

require WC_TWOINC_PLUGIN_PATH . 'class/WC_Twoinc_Brand.php';
require WC_TWOINC_PLUGIN_PATH . 'class/WC_Twoinc_Helper.php';
require WC_TWOINC_PLUGIN_PATH . 'class/WC_Twoinc_FX.php';
require WC_TWOINC_PLUGIN_PATH . 'class/WC_Twoinc_Payment_Terms.php';
require WC_TWOINC_PLUGIN_PATH . 'class/WC_Twoinc_Sole_Trader.php';
require WC_TWOINC_PLUGIN_PATH . 'class/WC_Twoinc_Checkout.php';
require WC_TWOINC_PLUGIN_PATH . 'class/WC_Twoinc.php';
