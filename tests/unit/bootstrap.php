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

// ── WooCommerce logger ──────────────────────────────────────────────
// The plugin logs through wc_get_logger() behind function_exists(), so a
// stub here is what makes "the error was reported" assertable. Every call
// is recorded as ['level' => …, 'message' => …, 'context' => …] in
// $GLOBALS['__twoinc_test_logs'] (cleared per test).

$GLOBALS['__twoinc_test_logs'] = [];

class StubWcLogger
{
    public function __call($level, $args)
    {
        $GLOBALS['__twoinc_test_logs'][] = [
            'level' => $level,
            'message' => (string) ($args[0] ?? ''),
            'context' => $args[1] ?? [],
        ];
    }
}

function wc_get_logger()
{
    static $logger = null;
    if ($logger === null) {
        $logger = new StubWcLogger();
    }
    return $logger;
}

// ── WP/WC function stubs ────────────────────────────────────────────

function __($text, $domain = 'default')
{
    // Identity by default, so every other spec sees the untranslated source
    // string. A test that needs a specific msgid to come back "translated" —
    // e.g. to exercise a runtime catalogue whose placeholders do not match the
    // source — stands one in through this map; reset() clears it.
    return $GLOBALS['__twoinc_test_translations'][$text] ?? $text;
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

function disabled($actual, $expected = true, $echo = true)
{
    $html = ((string) $actual === (string) $expected) ? ' disabled="disabled"' : '';
    if ($echo) {
        echo $html;
    }
    return $html;
}

function checked($actual, $expected = true, $echo = true)
{
    $html = ((string) $actual === (string) $expected) ? ' checked="checked"' : '';
    if ($echo) {
        echo $html;
    }
    return $html;
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
    // Overridable so a test can exercise a store configured for more price
    // precision than the pricing API accepts (TWO-25289).
    return isset($GLOBALS['__twoinc_test_price_decimals'])
        ? (int) $GLOBALS['__twoinc_test_price_decimals']
        : 2;
}

function determine_locale()
{
    return $GLOBALS['__twoinc_test_locale'] ?? 'en_US';
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

function wp_strip_all_tags($text, $remove_breaks = false)
{
    return strip_tags((string) $text);
}

/**
 * Shaped like the real wc_price(): entity-encoded symbol wrapped in the
 * WooCommerce price markup. Deliberately NOT built on the
 * get_woocommerce_currency_symbol() stub above, which returns the currency
 * CODE — the point of the callers under test is that they show the symbol.
 */
function wc_price($price, $args = [])
{
    $symbols = ['EUR' => '&euro;', 'GBP' => '&pound;', 'NOK' => 'kr'];
    $currency = strtoupper((string) ($args['currency'] ?? get_woocommerce_currency()));
    return '<span class="woocommerce-Price-amount amount"><bdi>'
        . '<span class="woocommerce-Price-currencySymbol">'
        . ($symbols[$currency] ?? $currency)
        . '</span>' . number_format((float) $price, 2, '.', ',')
        . '</bdi></span>';
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
                        return $GLOBALS['__twoinc_test_base_country'] ?? 'NO';
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
 * shape) and computes fee tax the way core does:
 *
 *  - $taxable false → no tax, unconditionally (never consults rates).
 *  - a $tax_class that doesn't match a live class silently reverts to
 *    Standard (the WC_Cart_Fees::add_fee / WC_Tax::get_rates gotcha the
 *    plugin-side validation defends against — mirrored faithfully so a
 *    regression there shows up as the WRONG TAX, not a stub error).
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

    private $shipping_country;

    public function __construct($country, $shipping_country = '')
    {
        $this->country = $country;
        $this->shipping_country = $shipping_country;
    }

    public function get_billing_country()
    {
        return $this->country;
    }

    public function get_shipping_country()
    {
        return $this->shipping_country;
    }
}

class WC_Payment_Gateway
{
    public $id;

    public $plugin_id = 'woocommerce_';

    // Defaults to disabled like core (not 'yes'), so is_available() below
    // isn't silently true in tests that never touch this.
    public $enabled = 'no';

    // Mirrors WC_Settings_API::get_post_data (the submitted settings form),
    // injectable per test for cross-field save validation.
    public $test_post_data = [];

    // Declared rather than left dynamic: get_option() below reads it for the
    // field defaults, and WC_Twoinc::init_form_fields() assigns it.
    public $form_fields = [];

    // Enough for WC_Twoinc's override to call parent::is_available() safely;
    // core's cart-totals/needs_setup checks aren't reproduced (unused here).
    public function is_available()
    {
        return 'yes' === $this->enabled;
    }

    public function get_post_data()
    {
        return $this->test_post_data;
    }

    // Mirrors WC_Settings_API::get_option: the stored row wins, an absent key
    // falls back to the field's declared default (empty() => ''), and
    // $empty_value substitutes for ''; resolution is memoised into $settings.
    //
    // Three deliberate divergences from core, all in default-resolution:
    //  - does not lazily call init_settings() — a test that seeds
    //    $GLOBALS['__twoinc_test_options'] without calling init_settings()
    //    fails loudly on the field default instead of silently working.
    //  - resolves defaults from raw $form_fields, not get_form_fields(), so
    //    an overlay's suppression filter is not applied here.
    //  - collapses a falsy-but-non-empty default to '' (core preserves it).
    //    Only surcharge_differential declares such a default, compared
    //    against '1' by its one consumer.
    public function get_option($key, $empty_value = null)
    {
        if (!isset($this->settings[$key])) {
            $default = $this->form_fields[$key]['default'] ?? '';
            $this->settings[$key] = empty($default) ? '' : $default;
        }
        if ($this->settings[$key] === '' && !is_null($empty_value)) {
            $this->settings[$key] = $empty_value;
        }
        return $this->settings[$key];
    }

    // Mirrors WC_Settings_API::update_option: writes one field into the
    // settings blob and persists the whole blob, the same partial-update
    // surface WC_Twoinc::reconcile_custom_payment_term() relies on outside
    // the process_admin_options() save loop.
    public function update_option($key, $value = '')
    {
        $this->settings[$key] = $value;
        return update_option($this->get_option_key(), $this->settings, 'yes');
    }

    public function get_field_key($key)
    {
        return $this->plugin_id . $this->id . '_' . $key;
    }

    public function get_option_key()
    {
        return $this->plugin_id . $this->id . '_settings';
    }

    // Stored settings blob (mirrors WC_Settings_API::$settings). Unlike
    // core it does NOT merge form-field defaults over stored values — tests
    // that care about defaults read form_fields directly.
    public $settings = [];

    public function init_settings()
    {
        $stored = get_option($this->get_option_key(), []);
        $this->settings = is_array($stored) ? $stored : [];
    }

    // ── WC_Settings_API save + error surface (TWO-25289) ─────────────
    // Mirrors WC_Settings_API::$errors/add_error/get_errors/display_errors/
    // get_field_value/process_admin_options: each field validates
    // independently, a throwing validator skips only its own assignment,
    // and the error lands in a bucket core never prints — the partial save
    // + silent error these tests assert.

    /** @var string[] */
    public $errors = [];

    public function add_error($error)
    {
        $this->errors[] = $error;
    }

    public function get_errors()
    {
        return $this->errors;
    }

    // Core wraps the messages in <div id="woocommerce_errors" class="error
    // notice is-dismissible"> and one <p> per message, and prints NOTHING when
    // the bucket is empty. The empty case is load-bearing: it is why a gateway
    // can call this unconditionally on every settings pageload.
    public function display_errors()
    {
        if (!$this->get_errors()) {
            return;
        }
        echo '<div id="woocommerce_errors" class="error notice is-dismissible">';
        foreach ($this->get_errors() as $error) {
            echo '<p>' . wp_kses_post($error) . '</p>';
        }
        echo '</div>';
    }

    public function get_form_fields()
    {
        return $this->form_fields;
    }

    // Mirrors WC_Settings_API::get_tooltip_html / get_description_html /
    // get_custom_attribute_html closely enough for the custom field
    // renderers under test: desc_tip true shows the description as a
    // tooltip instead of inline text, mirroring core's mutual exclusion.
    public function get_tooltip_html($data)
    {
        if (($data['desc_tip'] ?? false) === true) {
            $tip = $data['description'] ?? '';
        } elseif (!empty($data['desc_tip'])) {
            $tip = $data['desc_tip'];
        } else {
            $tip = '';
        }
        return $tip !== '' ? '<span class="woocommerce-help-tip" data-tip="' . esc_attr($tip) . '"></span>' : '';
    }

    public function get_description_html($data)
    {
        if (empty($data['description']) || ($data['desc_tip'] ?? false) === true) {
            return '';
        }
        return '<p class="description">' . wp_kses_post($data['description']) . '</p>';
    }

    public function get_custom_attribute_html($data)
    {
        $attributes = [];
        foreach ((array) ($data['custom_attributes'] ?? []) as $attribute => $value) {
            $attributes[] = esc_attr($attribute) . '="' . esc_attr($value) . '"';
        }
        return implode(' ', $attributes);
    }

    public function get_field_type($field)
    {
        return empty($field['type']) ? 'text' : $field['type'];
    }

    // Core's resolution order: sanitize_callback, then validate_<KEY>_field,
    // then validate_<TYPE>_field, then validate_text_field. Only the two the
    // plugin actually declares are reproduced; anything else passes the raw
    // posted value through, which is enough for the fields these tests post.
    public function get_field_value($key, $field, $post_data = [])
    {
        $field_key = $this->get_field_key($key);
        $value = array_key_exists($field_key, $post_data) ? $post_data[$field_key] : null;
        $by_key = 'validate_' . $key . '_field';
        if (is_callable([$this, $by_key])) {
            return $this->{$by_key}($key, $value);
        }
        $by_type = 'validate_' . $this->get_field_type($field) . '_field';
        if (is_callable([$this, $by_type])) {
            return $this->{$by_type}($key, $value);
        }
        return is_null($value) ? '' : $value;
    }

    // On a throw, $this->settings[$key] is NOT assigned (keeps the value
    // init_settings() read), while every non-throwing sibling still saves —
    // producing the partial save.
    public function process_admin_options()
    {
        $this->init_settings();
        $post_data = $this->get_post_data();
        foreach ($this->get_form_fields() as $key => $field) {
            if ($this->get_field_type($field) === 'title') {
                continue;
            }
            try {
                $this->settings[$key] = $this->get_field_value($key, $field, $post_data);
            } catch (Exception $e) {
                $this->add_error($e->getMessage());
            }
        }
        return update_option($this->get_option_key(), $this->settings, 'yes');
    }

    // Reduced to the table marker — tests only need WHERE the error notice
    // lands relative to the form, not what the form looks like.
    public function admin_options()
    {
        echo '<table class="form-table"></table>';
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

function sanitize_text_field($str)
{
    return is_string($str) ? trim(strip_tags($str)) : '';
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

// Capability set via $GLOBALS['__twoinc_test_caps']. A meta-capability check
// against an object id resolves against $GLOBALS['__twoinc_test_object_caps']
// as "capability:object_id", distinguishing blanket vs per-object grants.
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

// Defaults to true: most tests exercising checkout-hooked methods do so
// AS IF on the checkout page, and only a test specifically about the
// is_checkout() guard needs to override it.
function is_checkout()
{
    return $GLOBALS['__twoinc_test_is_checkout'] ?? true;
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

// A minimal but representative status list — enough for the fulfilment-
// trigger multiselect options builder (TWO-25386) to run during
// init_form_fields() without a full WC install.
function wc_get_order_statuses()
{
    return [
        'wc-pending'    => 'Pending payment',
        'wc-processing' => 'Processing',
        'wc-on-hold'    => 'On hold',
        'wc-completed'  => 'Completed',
        'wc-cancelled'  => 'Cancelled',
        'wc-refunded'   => 'Refunded',
        'wc-failed'     => 'Failed',
    ];
}

// ── wc-ajax handler stubs (sole-trader availability / token minting) ─
// The real wp_send_json_* die; these record the outcome instead, which is
// enough because every handler returns immediately after calling them.
// $GLOBALS['__twoinc_test_ajax_nonce_ok'] drives the nonce branch and
// $GLOBALS['__twoinc_test_ajax_json'] holds the last response.

function check_ajax_referer($action = -1, $query_arg = false, $stop = true)
{
    $GLOBALS['__twoinc_test_ajax_referer_actions'][] = $action;
    return $GLOBALS['__twoinc_test_ajax_nonce_ok'] ?? true;
}

function wp_send_json_success($data = null, $status_code = null, $flags = 0)
{
    $GLOBALS['__twoinc_test_ajax_json'] = ['success' => true, 'data' => $data];
}

function wp_send_json_error($data = null, $status_code = null, $flags = 0)
{
    $GLOBALS['__twoinc_test_ajax_json'] = ['success' => false, 'data' => $data];
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
    $GLOBALS['__twoinc_test_as_schedule_calls'][] = [
        'hook' => $hook,
        'unique' => $unique,
        'timestamp' => $timestamp,
        'interval' => $interval,
    ];
    $GLOBALS['__twoinc_test_as_scheduled'][$hook] = true;
    return 1;
}

function as_unschedule_all_actions($hook, $args = [], $group = '')
{
    unset($GLOBALS['__twoinc_test_as_scheduled'][$hook]);
    return true;
}

// The real one lives in tillit-payment-gateway.php, which the suite does
// not load (it bootstraps WordPress hooks on include). Tests that care
// override $GLOBALS['__twoinc_test_plugin_version'].
function get_twoinc_plugin_version()
{
    return isset($GLOBALS['__twoinc_test_plugin_version'])
        ? $GLOBALS['__twoinc_test_plugin_version']
        : '2.23.9';
}

// The real one lives in tillit-payment-gateway.php (not loaded, see above);
// this mirrors its filemtime-with-fallback logic exactly so the asset-cache
// -busting tests exercise the real behaviour against the real files on disk.
function twoinc_get_asset_version($relative_path)
{
    $path = WC_TWOINC_PLUGIN_PATH . ltrim($relative_path, '/');
    $mtime = file_exists($path) ? @filemtime($path) : false;

    return $mtime !== false ? (string) $mtime : get_twoinc_plugin_version();
}

// Read by admin_options() for the provenance footer. Only 'version' is asked
// for; anything else returns '' rather than guessing at WordPress semantics.
function get_bloginfo($show = '', $filter = 'raw')
{
    return $show === 'version' ? '6.8' : '';
}

require WC_TWOINC_PLUGIN_PATH . 'class/WC_Twoinc_Brand.php';
require WC_TWOINC_PLUGIN_PATH . 'class/WC_Twoinc_Helper.php';
require WC_TWOINC_PLUGIN_PATH . 'class/WC_Twoinc_FX.php';
require WC_TWOINC_PLUGIN_PATH . 'class/WC_Twoinc_Payment_Terms.php';
require WC_TWOINC_PLUGIN_PATH . 'class/WC_Twoinc_Sole_Trader.php';
require WC_TWOINC_PLUGIN_PATH . 'class/WC_Twoinc_Checkout.php';
require WC_TWOINC_PLUGIN_PATH . 'class/WC_Twoinc.php';
