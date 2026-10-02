<?php

/**
 * Twoinc Helper utilities
 *
 * @class WC_Twoinc_Helper
 * @author Two
 */

if (!class_exists('WC_Twoinc_Helper')) {
    class WC_Twoinc_Helper
    {
        private const TAX_RECONCILE_TOLERANCE = 0.02;

        private const SHIPPING_TAX_RATE_META = 'shipping_tax_rate';

        public const ORDER_POSTPROCESSING_CONTRACT_VERSION = 1;

        /** The EU VAT area by ISO code, with Monaco, which counts as France for VAT (TWO-24877). */
        private const EU_VAT_COUNTRIES = [
            'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT', 'LV', 'LT',
            'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'HU', 'MC',
        ];

        /** Spanish postcodes outside the EU VAT area: the Canary Islands, Ceuta and Melilla. */
        private const ES_OUTSIDE_VAT_AREA_POSTCODES = ['35', '38', '51', '52'];

        /**
         * The code a Spanish merchant's 0% line derives when its tax class is unmapped (TWO-24877). First matching
         * row wins; a null zone matches any. Goods follow where they are delivered, services where the buyer is
         * established. Zones: `es` (mainland and Balearic Spain), `es_outside` (Canaries, Ceuta, Melilla), `eu`
         * (another EU state), `non_eu`.
         */
        private const ES_ZERO_RATE_DERIVATION = [
            ['line' => 'goods', 'destination' => 'non_eu', 'buyer' => null, 'code' => 'ES_IVA_EXPORT'],
            ['line' => 'goods', 'destination' => 'es_outside', 'buyer' => null, 'code' => 'ES_IVA_EXPORT'],
            ['line' => 'goods', 'destination' => 'eu', 'buyer' => 'eu', 'code' => 'ES_IVA_INTRA_COMMUNITY'],
            ['line' => 'service', 'destination' => null, 'buyer' => 'eu', 'code' => 'ES_IVA_REVERSE_CHARGE'],
        ];

        /**
         * Reduces buyer-facing copy to text plus links: an `<a>` with an
         * http(s) href survives, every other tag is dropped and its text kept,
         * and all other markup is escaped.
         *
         * Surviving anchors are rebuilt from their allowed attributes, so no
         * attribute this plugin does not itself emit can reach the page. The
         * href itself is only checked for scheme and userinfo, not vouched for
         * - whoever writes the copy chooses where an http(s) link points.
         * `target` and `rel` are matched case-insensitively, as browsers treat
         * those keywords; `rel` is read as a token set, and a kept
         * `target="_blank"` always carries `rel="noopener"`.
         *
         * @return string
         */
        public static function escape_anchor_only_html($html)
        {
            // Only a name-like tag opens markup; a stray '<' stays text rather
            // than swallowing the copy up to the next '>'.
            $parts = preg_split(
                '/(<\/?[a-zA-Z][^>]*>)/',
                self::strip_control_characters((string) $html),
                -1,
                PREG_SPLIT_DELIM_CAPTURE
            );
            if ($parts === false) {
                return '';
            }

            $result = '';
            $open_anchors = 0;
            foreach ($parts as $index => $part) {
                if ($index % 2 === 0) {
                    // ENT_SUBSTITUTE: without it one malformed byte blanks the whole run.
                    $result .= htmlspecialchars($part, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8', false);
                    continue;
                }

                if (preg_match('/^<\/a\s*>$/i', $part)) {
                    if ($open_anchors > 0) {
                        $result .= '</a>';
                        $open_anchors--;
                    }
                    continue;
                }

                // A nested anchor is invalid HTML the browser would unnest
                // anyway; its text is kept, its tag is not.
                if ($open_anchors === 0 && preg_match('/^<a\s[^>]*>$/i', $part)) {
                    $anchor = self::rebuild_allowed_anchor($part);
                    if ($anchor !== '') {
                        $result .= $anchor;
                        $open_anchors++;
                    }
                }
            }

            return $result . str_repeat('</a>', $open_anchors);
        }

        /**
         * Whether escaping leaves the value's content alone - the admin
         * accept/reject boundary, so it is the render boundary (ABN-554).
         * Entity encoding is not a change; only markup this escaper drops or
         * rewrites fails.
         *
         * @return bool
         */
        public static function renders_unchanged($html)
        {
            $html = (string) $html;

            return html_entity_decode(self::escape_anchor_only_html($html), ENT_QUOTES, 'UTF-8')
                === html_entity_decode($html, ENT_QUOTES, 'UTF-8');
        }

        /**
         * @return string
         */
        private static function strip_control_characters($text)
        {
            $stripped = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $text);

            return $stripped === null ? '' : $stripped;
        }

        /**
         * @return string the anchor rebuilt from its allowed attributes, or ''
         *                when the href is not a plain http(s) URL
         */
        private static function rebuild_allowed_anchor($tag)
        {
            preg_match_all(
                '/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s"\'>]+))/',
                $tag,
                $matches,
                PREG_SET_ORDER
            );

            $attributes = [];
            foreach ($matches as $match) {
                $name = strtolower($match[1]);
                if (!isset($attributes[$name])) {
                    // PREG_SET_ORDER truncates each set at the last participating
                    // group, so an empty quoted value leaves later groups absent.
                    $attributes[$name] = $match[2] !== ''
                        ? $match[2]
                        : ((isset($match[3]) && $match[3] !== '') ? $match[3] : (isset($match[4]) ? $match[4] : ''));
                }
            }

            $href = html_entity_decode(trim(isset($attributes['href']) ? $attributes['href'] : ''), ENT_QUOTES, 'UTF-8');
            if (!preg_match('/^https?:\/\//i', $href)) {
                return '';
            }
            // Userinfo is the classic spoof: everything before the '@' reads as the host.
            if (preg_match('/^https?:\/\/[^\/?#]*@/i', $href)) {
                return '';
            }

            $opens_new_tab = isset($attributes['target']) && strtolower(trim($attributes['target'])) === '_blank';
            $rel_tokens = preg_split('/\s+/', isset($attributes['rel']) ? strtolower(trim($attributes['rel'])) : '', -1, PREG_SPLIT_NO_EMPTY);

            $anchor = '<a href="' . htmlspecialchars($href, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '"';
            if ($opens_new_tab) {
                $anchor .= ' target="_blank"';
            }
            // A new tab without noopener hands the opener over, so the pair is not the copy's to split.
            if ($opens_new_tab || in_array('noopener', $rel_tokens, true)) {
                $anchor .= ' rel="noopener"';
            }

            return $anchor . '>';
        }

        /**
         * @return string
         */
        public static function round_amt($amt)
        {
            return number_format($amt, wc_get_price_decimals(), '.', '');
        }

        /**
         * 6dp precision.
         *
         * @return string
         */
        public static function round_rate($rate)
        {
            return number_format($rate, 6, '.', '');
        }

        /**
         * Round a computed discount once at the payload boundary and fail
         * loud if it is genuinely negative (TWO-25097).
         *
         * The discount must be derived at native precision and rounded
         * exactly once, here — rounding the operands first manufactures
         * phantom +/-0.01 discounts when they round in opposite directions.
         * The sign check runs on the once-rounded value so sub-cent float
         * residue doesn't fail an otherwise healthy checkout.
         *
         * A genuinely negative discount is a data inconsistency from an
         * upstream cart-rule/coupon bug — surfaced, never silently clamped
         * to zero.
         *
         * @param float  $discount_amount discount at native precision
         * @param string $subject         short surface identifier for the
         *                                exception (safe to surface to the
         *                                shopper as a checkout notice)
         * @param string $log_context     full diagnostic for the log only:
         *                                ids and raw operands
         *
         * @return string the once-rounded, non-negative discount amount
         * @throws Exception when the rounded discount is negative
         */
        public static function guard_negative_discount($discount_amount, $subject, $log_context)
        {
            $rounded = WC_Twoinc_Helper::round_amt($discount_amount);
            if ((float) $rounded < 0) {
                if (function_exists('wc_get_logger')) {
                    wc_get_logger()->error(
                        'Negative discount amount calculated for ' . $subject
                            . ': ' . $log_context
                            . ' (native ' . var_export($discount_amount, true)
                            . ', rounded ' . $rounded . ')',
                        ['source' => 'twoinc-payment-gateway']
                    );
                }
                throw new Exception(
                    sprintf(
                        __('Negative discount amount calculated for %s.', 'twoinc-payment-gateway'),
                        $subject
                    )
                );
            }
            // Strip negative zero ("-0.00") left by sub-cent float residue
            // so the payload always carries a plain non-negative amount.
            if ((float) $rounded == 0.0) {
                $rounded = WC_Twoinc_Helper::round_amt(0);
            }
            return $rounded;
        }

        /**
         * @return string|void
         */
        public static function get_twoinc_error_msg($response)
        {
            if (!$response) {
                return sprintf(__('Empty response from %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
            }

            if ($response['response'] && $response['response']['code'] && $response['response']['code'] >= 400) {
                return sprintf(__('Response code from %s: %d', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'), $response['response']['code'])
                    . ' (' . self::get_api_rejection_reason($response) . ')';
            }

            if ($response['body']) {
                $body = json_decode($response['body'], true);
                if (is_string($body)) {
                    return __($body, 'twoinc-payment-gateway');
                } elseif (isset($body['error_details']) && is_string($body['error_details'])) {
                    return __($body['error_details'], 'twoinc-payment-gateway');
                } elseif (isset($body['error_code']) && is_string($body['error_code'])) {
                    return __($body['error_code'], 'twoinc-payment-gateway');
                }
            }
        }

        /**
         * The API's own reason for refusing a request, as it sent it (TWO-26092).
         *
         * @return string
         */
        public static function get_api_rejection_reason($response)
        {
            $raw = (string) wp_remote_retrieve_body($response);
            $body = json_decode($raw, true);
            if (!is_array($body)) {
                return $raw === '' ? 'no response body' : substr($raw, 0, 500);
            }
            $parts = [];
            foreach (['error_code', 'error_message', 'error_details'] as $key) {
                if (isset($body[$key]) && is_string($body[$key]) && $body[$key] !== '') {
                    $parts[] = $body[$key];
                }
            }
            foreach (is_array($body['error_json'] ?? null) ? $body['error_json'] : [] as $error) {
                if (is_array($error) && isset($error['msg']) && is_string($error['msg'])) {
                    $parts[] = (is_array($error['loc'] ?? null) ? implode('.', $error['loc']) . ': ' : '') . $error['msg'];
                }
            }
            return $parts === [] ? substr($raw, 0, 500) : implode('; ', array_unique($parts));
        }

        /**
         * @return string|void
         */
        public static function get_twoinc_validation_msg($response)
        {
            $err_msg = sprintf(__('Invoice purchase with %s is not available for this order.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
            if (!$response) {
                return $err_msg;
            }

            if ($response['response'] && $response['response']['code'] && $response['response']['code'] >= 400) {
                if ($response['body']) {
                    $body = json_decode($response['body'], true);
                    if (!is_string($body) && isset($body['error_json']) && is_array($body['error_json'])) {
                        $errs = array();
                        foreach ($body['error_json'] as $err) {
                            if ($err) {
                                $display_msg = WC_Twoinc_Helper::get_msg_from_err($err);
                                if ($display_msg) {
                                    array_push($errs, $display_msg);
                                }
                            }
                        }
                        if (count($errs) > 0) {
                            return $errs;
                        }
                    }
                    if (isset($body['error_code']) && $body['error_code'] == 'SAME_BUYER_SELLER_ERROR') {
                        return __('Buyer and merchant may not be the same company', 'twoinc-payment-gateway');
                    }
                }

                return $err_msg;
            }
        }

        /**
         * @return string|void
         */
        public static function get_msg_from_err($err)
        {
            if (!isset($err['loc']) || !isset($err['msg'])) {
                return null;
            }

            $loc_str = json_encode(WC_Twoinc_Helper::utf8ize($err['loc']));
            $msg_str = $err['msg'];
            $generic_err_template = __('Please enter a valid %s to pay on invoice', 'twoinc-payment-gateway');
            $loc_str = preg_replace('/\s+/', '', $loc_str);

            if ($loc_str === '["buyer","representative","phone_number"]') {
                return sprintf($generic_err_template, __('Phone number', 'twoinc-payment-gateway'));
            }
            if ($loc_str === '["buyer"]' && strpos($msg_str, 'Invalid phone number') !== false) {
                return sprintf($generic_err_template, __('Phone number', 'twoinc-payment-gateway'));
            }
            if ($loc_str === '["buyer","company","organization_number"]') {
                return sprintf($generic_err_template, __('Organization number', 'twoinc-payment-gateway'));
            }
            if ($loc_str === '["buyer","company","company_name"]') {
                return sprintf($generic_err_template, __('Company name', 'twoinc-payment-gateway'));
            }
            if ($loc_str === '["buyer","representative","first_name"]') {
                return sprintf($generic_err_template, __('First name', 'twoinc-payment-gateway'));
            }
            if ($loc_str === '["buyer","representative","last_name"]') {
                return sprintf($generic_err_template, __('Last name', 'twoinc-payment-gateway'));
            }
            if ($loc_str === '["buyer","representative","email"]') {
                return sprintf($generic_err_template, __('Email', 'twoinc-payment-gateway'));
            }
            if ($loc_str === '["billing_address","street_address"]') {
                return sprintf($generic_err_template, __('Address', 'twoinc-payment-gateway'));
            }
            if ($loc_str === '["billing_address","city"]') {
                return sprintf($generic_err_template, __('City', 'twoinc-payment-gateway'));
            }
            if ($loc_str === '["billing_address","country"]') {
                return sprintf($generic_err_template, __('Country', 'twoinc-payment-gateway'));
            }
            if ($loc_str === '["billing_address","postal_code"]') {
                return sprintf($generic_err_template, __('Postal code', 'twoinc-payment-gateway'));
            }
            if (strpos($loc_str, '["invoice_details","invoice_emails"') === 0) {
                return sprintf($generic_err_template, __('Invoice email address', 'twoinc-payment-gateway'));
            }
        }

        /**
         * The Blocks checkout's Store API, whose payment route reads a
         * gateway's RETURN and never the notice queue.
         *
         * @return bool
         */
        public static function is_store_api_request()
        {
            if (!defined('REST_REQUEST') || !REST_REQUEST) {
                return false;
            }
            $uri = (string) ($_SERVER['REQUEST_URI'] ?? '');

            // The cart and checkout routes only — not products, not batch.
            return strpos($uri, '/wc/store/v1/cart') !== false
                || strpos($uri, '/wc/store/v1/checkout') !== false;
        }

        /**
         * @return void
         */
        public static function display_ajax_error($message)
        {
            if (is_string($message)) {
                wc_add_notice($message, 'error');
            } elseif (is_array($message)) {
                foreach ($message as $msg) {
                    wc_add_notice($msg, 'error');
                }
            } else {
                return;
            }
            global $wp_version;
            if ($wp_version > '5.0.0' && !wp_is_json_request()) {
                wc_print_notices();
            }
        }

        /**
         * @return bool
         */
        public static function is_twoinc_order($order)
        {
            return $order && $order->get_payment_method() && $order->get_payment_method() === WC_Twoinc_Brand::get('gateway_id');
        }

        /**
         * @return bool
         */
        public static function is_twoinc_address_empty($twoinc_address)
        {

            $is_empty = true;

            if ($twoinc_address) {
                $is_empty = WC_Twoinc_Helper::is_str_no_word($twoinc_address['city'])
                    && WC_Twoinc_Helper::is_str_no_word($twoinc_address['region'])
                    && WC_Twoinc_Helper::is_str_no_word($twoinc_address['country'])
                    && WC_Twoinc_Helper::is_str_no_word($twoinc_address['postal_code'])
                    && WC_Twoinc_Helper::is_str_no_word($twoinc_address['street_address']);
            }

            return $is_empty;
        }

        /**
         * @return bool
         */
        public static function is_str_no_word($s)
        {

            return !$s || !preg_replace('/[\s,.-]/', '', $s);
        }

        /**
         * @param bool $is_refund refund line items carry negated amounts, so
         *                        the negative-discount guard below does not
         *                        apply to them.
         * @param mixed $rate_order order whose tax rows declare the rates; a refund passes its parent,
         *                          because core restamps the refund's own rows from the live rate table.
         * @param array|null $shipping_rates receives each shipping line's resolved rate, keyed as $shippings.
         *
         * @return array
         */
        public static function get_line_items(
            $line_items,
            $shippings,
            $fees,
            $order,
            $is_refund = false,
            $rate_order = null,
            &$shipping_rates = null
        ) {
            $rate_order = $rate_order ?? $order;

            $items = [];
            // Per line, what the tax code resolver needs: the tax class it was charged under and, for a product,
            // whether it is goods.
            $sources = [];

            /** @var WC_Order_Item_Product $line_item */
            foreach ($line_items as $line_item) {
                $product_simple = WC_Twoinc_Helper::get_product($line_item);

                $tax_rate = WC_Twoinc_Helper::get_item_tax_rate(
                    self::get_rate_line($line_item, $rate_order, $is_refund),
                    $rate_order
                );

                if (! is_object($product_simple)) {
                    $name = method_exists($line_item, 'get_name') ? $line_item->get_name() : 'Item';
                    $description = '';
                    $image_url = '';
                    $product_page_url = '';
                    $sku = '';
                    $categories = [];
                } else {
                    $name = $product_simple->get_name();
                    $description = substr($product_simple->get_description(), 0, 255);
                    $image_url = '';
                    if ($product_simple->get_id()) {
                        $thumbnail = get_the_post_thumbnail_url($product_simple->get_id());
                        $image_url = $thumbnail ? $thumbnail : '';
                    }
                    $product_page_url = $product_simple->get_permalink();
                    $sku = $product_simple->get_sku();
                    $categories = wp_get_post_terms($product_simple->get_id(), 'product_cat');
                }

                // Guard rounds once at the payload boundary and fails loud on
                // a genuinely negative discount (TWO-25097); skipped for
                // refunds, whose negated line amounts make that check invalid.
                if ($is_refund) {
                    $discount_amount = WC_Twoinc_Helper::round_amt($line_item['line_subtotal'] - $line_item['line_total']);
                } else {
                    $discount_amount = WC_Twoinc_Helper::guard_negative_discount(
                        $line_item['line_subtotal'] - $line_item['line_total'],
                        sprintf('product "%s"', $name),
                        sprintf(
                            'order %s, line_subtotal %s - line_total %s',
                            $order->get_id(),
                            var_export($line_item['line_subtotal'], true),
                            var_export($line_item['line_total'], true)
                        )
                    );
                }

                $product = [
                    'name' => $name,
                    'description' => $description,
                    'gross_amount' => strval(WC_Twoinc_Helper::round_amt($line_item['line_total'] + $line_item['line_tax'])),
                    'net_amount' => strval(WC_Twoinc_Helper::round_amt($line_item['line_total'])),
                    'discount_amount' => $discount_amount,
                    'tax_amount' => strval(WC_Twoinc_Helper::round_amt($line_item['line_tax'])),
                    'tax_class_name' => $tax_rate['name'],
                    'tax_rate' => strval(WC_Twoinc_Helper::round_rate($tax_rate['rate'])),
                    'unit_price' => strval($order->get_item_subtotal($line_item, false, true)),
                    'quantity' => $line_item['quantity'],
                    'quantity_unit' => 'item',
                    'image_url' => $image_url,
                    'product_page_url' => $product_page_url,
                    'type' => 'PHYSICAL',
                    'details' => [
                        'barcodes' => [
                            [
                                'type' => 'SKU',
                                'value' => $sku
                            ]
                        ],
                        'categories' => []
                    ]
                ];

                if (! empty($categories) && is_array($categories)) {
                    foreach ($categories as $category) {
                        $product['details']['categories'][] = $category->name;
                    }
                }

                $items[] = $product;
                $sources[] = [
                    'tax_class' => self::get_line_tax_class(self::get_rate_line($line_item, $rate_order, $is_refund)),
                    'goods' => self::is_goods($product_simple),
                ];
            }

            $shipping_rates = [];
            foreach ($shippings as $key => $shipping) {
                if (self::is_zero_line($shipping)) {
                    continue;
                }
                $tax_rate = WC_Twoinc_Helper::get_shipping_tax_rate($shipping, $rate_order, $is_refund);
                $shipping_rates[$key] = $tax_rate;
                $shipping_line = [
                    'name' => 'Shipping - ' . $shipping->get_name(),
                    'description' => '',
                    'gross_amount' => strval(WC_Twoinc_Helper::round_amt($shipping->get_total() + $shipping->get_total_tax())),
                    'net_amount' => strval(WC_Twoinc_Helper::round_amt($shipping->get_total())),
                    'discount_amount' => '0',
                    'tax_amount' => strval(WC_Twoinc_Helper::round_amt($shipping->get_total_tax())),
                    'tax_class_name' => $tax_rate['name'],
                    'tax_rate' => strval(WC_Twoinc_Helper::round_rate($tax_rate['rate'])),
                    'unit_price' => strval(WC_Twoinc_Helper::round_amt($shipping->get_total())),
                    'quantity' => 1,
                    'quantity_unit' => 'sc', // shipment charge
                    'image_url' => '',
                    'product_page_url' => '',
                    'type' => 'SHIPPING_FEE'
                ];

                $items[] = $shipping_line;
                $sources[] = ['tax_class' => 'shipping', 'goods' => null];
            }

            foreach ($fees as $fee) {
                if (self::is_zero_line($fee)) {
                    continue;
                }
                $tax_rate = WC_Twoinc_Helper::get_item_tax_rate(
                    self::get_rate_line($fee, $rate_order, $is_refund),
                    $rate_order
                );
                $fee_line = [
                    // Already the resolved, translated, brand-correct label;
                    // no hardcoded prefix — 'type' => 'SERVICE' below carries
                    // the semantic instead.
                    'name' => $fee->get_name(),
                    'description' => '',
                    'gross_amount' => strval(WC_Twoinc_Helper::round_amt($fee->get_total() + $fee->get_total_tax())),
                    'net_amount' => strval(WC_Twoinc_Helper::round_amt($fee->get_total())),
                    'discount_amount' => '0',
                    'tax_amount' => strval(WC_Twoinc_Helper::round_amt($fee->get_total_tax())),
                    'tax_class_name' => $tax_rate['name'],
                    'tax_rate' => strval(WC_Twoinc_Helper::round_rate($tax_rate['rate'])),
                    'unit_price' => strval(WC_Twoinc_Helper::round_amt($fee->get_total())),
                    'quantity' => 1,
                    'quantity_unit' => 'fee',
                    'image_url' => '',
                    'product_page_url' => '',
                    'type' => 'SERVICE'
                ];

                $items[] = $fee_line;
                $sources[] = [
                    'tax_class' => self::get_line_tax_class(self::get_rate_line($fee, $rate_order, $is_refund)),
                    'goods' => null,
                ];
            }

            return self::apply_tax_codes($items, $sources, $rate_order);
        }

        /**
         * Adds `tax_code` to each line sent at 0% (TWO-24877). The merchant's mapping of the line's tax class wins;
         * an unmapped line of a Spanish merchant takes the code ES_ZERO_RATE_DERIVATION derives, if any. Any other
         * line is sent as built: the plugin never refuses, and Two's API validates what arrives. A non-zero line is
         * never touched. Runs inside the builder, so every hook after it sees the code and can change it.
         *
         * @param array $items   the built lines
         * @param array $sources per line, its tax class ('shipping' for a shipping line) and, for a product, whether
         *                       it is goods (null for shipping and fees, which follow the order)
         * @param mixed $order   the order whose addresses and products decide the derivation
         *
         * @return array
         */
        private static function apply_tax_codes(array $items, array $sources, $order)
        {
            $zero = [];
            foreach ($items as $i => $item) {
                if (0.0 === (float) $item['tax_rate']) {
                    $zero[] = $i;
                }
            }
            $map = WC_Twoinc::get_tax_code_map();
            $derive = 'ES' === WC_Twoinc::get_merchant_country();
            if (!$zero || (!$map && !$derive)) {
                return $items;
            }

            $context = $derive ? self::tax_code_context($order) : null;
            foreach ($zero as $i) {
                $source = $sources[$i];
                $tax_class = 'shipping' === $source['tax_class'] ? self::get_shipping_tax_class_key($order) : $source['tax_class'];
                $code = null !== $tax_class && isset($map[$tax_class]) ? $map[$tax_class] : null;
                if (null === $code && $context) {
                    $goods = $source['goods'] ?? $context['order_has_goods'];
                    $code = self::derive_es_zero_rate_code($goods, $context['destination'], $context['buyer']);
                }
                if (null !== $code) {
                    $items[$i]['tax_code'] = $code;
                }
            }
            return $items;
        }

        /**
         * The ES_ZERO_RATE_DERIVATION lookup, or null where no row matches.
         *
         * @param bool        $goods       a goods line, rather than a service line
         * @param string|null $destination the delivery zone
         * @param string|null $buyer       the buyer company's zone
         *
         * @return string|null
         */
        public static function derive_es_zero_rate_code($goods, $destination, $buyer)
        {
            $line = $goods ? 'goods' : 'service';
            foreach (self::ES_ZERO_RATE_DERIVATION as $row) {
                if (
                    $row['line'] === $line
                    && (null === $row['destination'] || $row['destination'] === $destination)
                    && (null === $row['buyer'] || $row['buyer'] === $buyer)
                ) {
                    return $row['code'];
                }
            }
            return null;
        }

        /**
         * What the derivation reads off the order: the delivery address (billing when the order has none), the buyer
         * company country the order payload sends as `buyer.company.country_prefix`, and whether any product line is
         * goods, which decides how its shipping and fees are treated.
         *
         * @return array|null null when the order carries no addresses
         */
        private static function tax_code_context($order)
        {
            if (!is_object($order) || !method_exists($order, 'get_billing_country')) {
                return null;
            }
            $country = $order->get_shipping_country();
            $postcode = $order->get_shipping_postcode();
            $shipping_address = [
                'organization_name' => $order->get_shipping_company(),
                'street_address' => $order->get_shipping_address_1() . $order->get_shipping_address_2(),
                'postal_code' => $postcode,
                'city' => $order->get_shipping_city(),
                'region' => $order->get_shipping_state(),
                'country' => $country,
            ];
            // The same fallback the order payload's shipping_address takes.
            if (self::is_twoinc_address_empty($shipping_address)) {
                $country = $order->get_billing_country();
                $postcode = $order->get_billing_postcode();
            }
            $has_goods = false;
            foreach ($order->get_items() as $line_item) {
                if (is_object($line_item) || is_array($line_item)) {
                    $has_goods = $has_goods || self::is_goods(self::get_product($line_item));
                }
            }
            return [
                'destination' => self::tax_zone($country, $postcode),
                'buyer' => self::tax_zone($order->get_billing_country()),
                'order_has_goods' => $has_goods,
            ];
        }

        /**
         * A country's zone for the derivation, or null when it is unknown. Only a destination passes a postcode, so
         * only a destination can be `es_outside`: a buyer company's establishment is judged by its country alone.
         *
         * @return string|null
         */
        private static function tax_zone($country, $postcode = null)
        {
            $country = strtoupper(trim((string) $country));
            if ('' === $country) {
                return null;
            }
            if ('ES' === $country) {
                $prefix = substr(trim((string) $postcode), 0, 2);
                return null !== $postcode && in_array($prefix, self::ES_OUTSIDE_VAT_AREA_POSTCODES, true) ? 'es_outside' : 'es';
            }
            return in_array($country, self::EU_VAT_COUNTRIES, true) ? 'eu' : 'non_eu';
        }

        /**
         * A product is a service when it is virtual or downloadable. A line whose product is gone is taken as goods,
         * the WooCommerce default for a product.
         *
         * @return bool
         */
        private static function is_goods($product)
        {
            if (!is_object($product)) {
                return true;
            }
            $virtual = method_exists($product, 'is_virtual') && $product->is_virtual();
            $downloadable = method_exists($product, 'is_downloadable') && $product->is_downloadable();
            return !$virtual && !$downloadable;
        }

        /**
         * The mapping key of a product or fee line's tax class: its slug, with the standard class ('') as `standard`.
         *
         * @return string
         */
        private static function get_line_tax_class($line)
        {
            if (is_object($line) && method_exists($line, 'get_tax_class')) {
                $tax_class = $line->get_tax_class();
            } elseif (is_array($line) || $line instanceof ArrayAccess) {
                $tax_class = $line['tax_class'] ?? '';
            } else {
                $tax_class = '';
            }
            return self::tax_class_key($tax_class);
        }

        /**
         * The mapping key of the class WooCommerce's shipping tax class setting resolves to for this order, or null
         * when it follows the cart items and finds none.
         *
         * @return string|null
         */
        private static function get_shipping_tax_class_key($order)
        {
            if (!is_object($order) || !method_exists($order, 'get_items_tax_classes')) {
                return null;
            }
            $tax_class = self::get_shop_shipping_tax_class($order);
            return null === $tax_class ? null : self::tax_class_key($tax_class);
        }

        /**
         * @return string
         */
        public static function tax_class_key($tax_class)
        {
            $tax_class = (string) $tax_class;
            return '' === $tax_class ? 'standard' : $tax_class;
        }

        /**
         * @return array
         */
        private static function get_internal_tax_key($tax_rate)
        {
            return strval(WC_Twoinc_Helper::round_rate($tax_rate['rate'])) . '|' . $tax_rate['name'];
        }

        /**
         * A refund can return the tax alone (or the net alone), so only a line with neither is left out.
         */
        private static function is_zero_line($line)
        {
            return !round((float) $line->get_total(), 2) && !round((float) $line->get_total_tax(), 2);
        }

        /**
         * @param array|null $shipping_rates the rates get_line_items() resolved, so shipping is not resolved twice.
         *
         * @return array
         */
        public static function get_tax_subtotals($line_items, $shippings, $fees, $order, $shipping_rates = null)
        {
            if ($shipping_rates === null) {
                self::get_line_items([], $shippings, [], $order, false, null, $shipping_rates);
            }

            $tax_subtotal_dict = array();
            $tax_subtotals = [];

            /** @var WC_Order_Item_Product $line_item */
            foreach ($line_items as $line_item) {
                $tax_rate = WC_Twoinc_Helper::get_item_tax_rate($line_item, $order);
                $tax_single_line = [
                    'tax_amount' => $line_item['line_tax'],
                    'tax_rate' => $tax_rate['rate'],
                    'net_amount' => $line_item['line_total']
                ];
                $tax_key = WC_Twoinc_Helper::get_internal_tax_key($tax_rate);
                if (!array_key_exists($tax_key, $tax_subtotal_dict)) {
                    $tax_subtotal_dict[$tax_key] = [];
                }
                $tax_subtotal_dict[$tax_key][] = $tax_single_line;
            }

            foreach ($shipping_rates as $key => $tax_rate) {
                $shipping = $shippings[$key];
                $tax_single_line = [
                    'tax_amount' => $shipping->get_total_tax(),
                    'tax_rate' => $tax_rate['rate'],
                    'net_amount' => $shipping->get_total()
                ];
                $tax_key = WC_Twoinc_Helper::get_internal_tax_key($tax_rate);
                if (!array_key_exists($tax_key, $tax_subtotal_dict)) {
                    $tax_subtotal_dict[$tax_key] = [];
                }
                $tax_subtotal_dict[$tax_key][] = $tax_single_line;
            }

            foreach ($fees as $fee) {
                if (self::is_zero_line($fee)) {
                    continue;
                }
                $tax_rate = WC_Twoinc_Helper::get_item_tax_rate($fee, $order);
                $tax_single_line = [
                    'tax_amount' => $fee->get_total_tax(),
                    'tax_rate' => $tax_rate['rate'],
                    'net_amount' => $fee->get_total()
                ];
                $tax_key = WC_Twoinc_Helper::get_internal_tax_key($tax_rate);
                if (!array_key_exists($tax_key, $tax_subtotal_dict)) {
                    $tax_subtotal_dict[$tax_key] = [];
                }
                $tax_subtotal_dict[$tax_key][] = $tax_single_line;
            }

            foreach ($tax_subtotal_dict as $tax_single_line_list) {
                $tax_subtotal = [
                    'tax_amount' => 0,
                    'tax_rate' => strval(WC_Twoinc_Helper::round_rate($tax_single_line_list[0]['tax_rate'])),
                    'taxable_amount' => 0
                ];
                foreach ($tax_single_line_list as $tax_single_line) {
                    $tax_subtotal['tax_amount'] += $tax_single_line['tax_amount'];
                    $tax_subtotal['taxable_amount'] += $tax_single_line['net_amount'];
                }
                $tax_subtotal['tax_amount'] = strval(WC_Twoinc_Helper::round_amt($tax_subtotal['tax_amount']));
                $tax_subtotal['taxable_amount'] = strval(WC_Twoinc_Helper::round_amt($tax_subtotal['taxable_amount']));
                $tax_subtotals[] = $tax_subtotal;
            }

            return $tax_subtotals;
        }

        /**
         * WooCommerce core has no stable tracking-number storage (Fulfillments
         * is still behind a beta flag), so tracking is sourced from the
         * `_wc_shipment_tracking_items` order meta shared by the official
         * WooCommerce Shipment Tracking extension and the zorem Advanced
         * Shipment Tracking plugin. Predefined carriers keep their tracking
         * URL in the plugin's carrier list, not in meta, so
         * `carrier_tracking_url` is only sent for custom entries. The most
         * recent entry wins.
         *
         * @param WC_Order $order
         *
         * @return array
         */
        public static function get_shipping_details($order)
        {
            $shipping_details = [
                'expected_delivery_date' => date('Y-m-d', strtotime('+ 7 days'))
            ];

            $tracking_items = $order->get_meta('_wc_shipment_tracking_items', true);
            if (is_array($tracking_items) && count($tracking_items) > 0) {
                $latest = end($tracking_items);
                // The meta key is world-writable, so every field is treated
                // as untrusted: non-scalar or whitespace-only values are
                // dropped rather than coerced into garbage.
                $tracking_number = is_array($latest) ? self::clean_tracking_field($latest, 'tracking_number') : '';
                if ($tracking_number !== '') {
                    $shipping_details['tracking_number'] = $tracking_number;
                    $carrier_name = self::clean_tracking_field($latest, 'custom_tracking_provider');
                    if ($carrier_name !== '') {
                        $carrier_tracking_url = self::clean_tracking_field($latest, 'custom_tracking_link');
                        if ($carrier_tracking_url !== '') {
                            $shipping_details['carrier_tracking_url'] = $carrier_tracking_url;
                        }
                    } else {
                        $carrier_name = self::clean_tracking_field($latest, 'tracking_provider');
                    }
                    if ($carrier_name !== '') {
                        $shipping_details['carrier_name'] = $carrier_name;
                    }
                }
            }

            /**
             * Escape hatch for merchants whose tracking data lives outside
             * the `_wc_shipment_tracking_items` meta convention (TWO-24762).
             *
             * Fires up to 3x per fulfilment (presence gate, change-detection
             * hash, edit body) plus on every checkout/edit body composition,
             * so callbacks must be fast, pure and deterministic — a
             * non-deterministic one churns the change hash and can make the
             * gate and the shipped body disagree. Non-array return discarded.
             *
             * @param array    $shipping_details Composed shipping details.
             * @param WC_Order $order            WooCommerce order.
             */
            $filtered = apply_filters('twoinc_shipping_details', $shipping_details, $order);
            return is_array($filtered) ? $filtered : $shipping_details;
        }

        /**
         * Trimmed string field from a shipment-tracking meta entry, or '' when
         * absent, non-scalar or whitespace-only.
         *
         * @param array  $entry
         * @param string $key
         *
         * @return string
         */
        private static function clean_tracking_field($entry, $key)
        {
            if (!isset($entry[$key])) {
                return '';
            }
            $value = $entry[$key];
            // Booleans are excluded from the scalar family on purpose:
            // strval(true) is '1', which would be kept as a "tracking
            // number" rather than dropped as the garbage it is.
            if (!is_string($value) && !is_int($value) && !is_float($value)) {
                return '';
            }
            return trim(strval($value));
        }

        /**
         * Brand extension hooks fire in this order, each seeing the
         * previous one's result (the same hooks fire in
         * compose_twoinc_edit_order so create and edit stay symmetric):
         *
         * 1. `twoinc_payment_terms_line` — filters the full line_items
         *    array (receive and return ALL line items, not a single
         *    line); second arg is the body draft BEFORE the payload
         *    filters below run.
         * 2. `two_order_create` — legacy body filter, kept for existing
         *    integrations.
         * 3. `twoinc_order_payload` — filters the final body; second
         *    arg is the WC_Order.
         *
         * @param WC_Order $order
         *
         * @return array
         */
        public static function compose_twoinc_order(
            $order,
            $order_reference,
            $company_id,
            $department,
            $project,
            $purchase_order_number,
            $invoice_emails,
            $payment_reference_message = '',
            $payment_reference_ocr = '',
            $payment_reference = '',
            $payment_reference_type = '',
            $vendor_name = '',
            $tracking_id = '',
            $skip_csrf_token = false,
            $payment_terms = null
        ) {

            $billing_address = [
                'organization_name' => $order->get_billing_company(),
                'street_address' => $order->get_billing_address_1() . ($order->get_billing_address_2() ? (', ' . $order->get_billing_address_2()) : ''),
                'postal_code' => $order->get_billing_postcode(),
                'city' => $order->get_billing_city(),
                'region' => $order->get_billing_state(),
                'country' => $order->get_billing_country()
            ];
            $shipping_address = [
                'organization_name' => $order->get_shipping_company(),
                'street_address' => $order->get_shipping_address_1() . ($order->get_shipping_address_2() ? (', ' . $order->get_shipping_address_2()) : ''),
                'postal_code' => $order->get_shipping_postcode(),
                'city' => $order->get_shipping_city(),
                'region' => $order->get_shipping_state(),
                'country' => $order->get_shipping_country()
            ];
            if (WC_Twoinc_Helper::is_twoinc_address_empty($shipping_address)) {
                $shipping_address = $billing_address;
            }

            $invoice_details = [
                'payment_reference_message' => $payment_reference_message,
                'payment_reference_ocr' => $payment_reference_ocr
            ];
            if ($payment_reference) {
                $invoice_details['payment_reference'] = $payment_reference;
            }
            if ($payment_reference_type) {
                $invoice_details['payment_reference_type'] = $payment_reference_type;
            }
            if ($invoice_emails && count($invoice_emails)) {
                $invoice_details['invoice_emails'] = $invoice_emails;
            }

            $req_body = ['currency' => $order->get_currency()] + self::order_totals($order) + [
                // Guard rounds once at the payload boundary, fails loud on a
                // negative (TWO-25097).
                'discount_amount' => WC_Twoinc_Helper::guard_negative_discount(
                    $order->get_total_discount(),
                    sprintf('order %s', $order->get_id()),
                    sprintf('total discount %s', var_export($order->get_total_discount(), true))
                ),
                'discount_rate' => '0',
                'invoice_type' => 'FUNDED_INVOICE',
                'invoice_details' => $invoice_details,
                'buyer' => [
                    'company' => [
                        'organization_number' => $company_id,
                        'country_prefix' => $order->get_billing_country(),
                        // The captured company, not the address's — the two may differ.
                        'company_name' => $order->get_meta('company_name') ?: $order->get_billing_company()
                    ],
                    'representative' => [
                        'email' => $order->get_billing_email(),
                        'first_name' => $order->get_billing_first_name(),
                        'last_name' => $order->get_billing_last_name(),
                        'phone_number' => $order->get_billing_phone()
                    ],
                ],
                'buyer_department' => $department,
                'buyer_project' => $project,
                'order_note' => $order->get_customer_note(),
                'line_items' => WC_Twoinc_Helper::get_line_items($order->get_items(), $order->get_items('shipping'), $order->get_items('fee'), $order, false, null, $shipping_rates),
                'recurring' => false,
                'merchant_additional_info' => '',
                'merchant_order_id' => strval($order->get_id()),
                'merchant_reference' => '',
                'merchant_urls' => [
                    'merchant_cancel_order_url' => wp_specialchars_decode($order->get_cancel_order_url()),
                    'merchant_edit_order_url' => wp_specialchars_decode($order->get_edit_order_url()),
                    'merchant_order_verification_failed_url' => wp_specialchars_decode($order->get_cancel_order_url()),
                    'merchant_invoice_url' => '',
                    'merchant_shipping_document_url' => ''
                ],
                'billing_address' => $billing_address,
                'shipping_address' => $shipping_address,
                'shipping_details' => WC_Twoinc_Helper::get_shipping_details($order)
            ];

            if ($vendor_name) {
                $req_body['vendor_name'] = $vendor_name;
            }

            // Shape from WC_Twoinc_Payment_Terms::get_order_payload_terms (TWO-24751).
            if ($payment_terms) {
                $req_body['terms'] = $payment_terms['terms'];
                $req_body['available_terms'] = $payment_terms['available_terms'];
            }

            if (!$skip_csrf_token) {
                // Param names and token action derive from the brand's
                // meta_prefix so process_confirmation matches what live
                // branded stores expect. Path segment is cosmetic —
                // confirmation detection is by param presence, not path.
                $confirmation_url = sprintf(
                    '%s/twoinc-payment-gateway/confirm?order_id=%s&%s=%s&%s=%s',
                    get_home_url(),
                    $order->get_id(),
                    WC_Twoinc_Brand::prefixed_name('order_reference'),
                    $order_reference,
                    WC_Twoinc_Brand::prefixed_name('csrf_token'),
                    wp_create_nonce(WC_Twoinc_Brand::prefixed_name('confirm_' . $order->get_id()))
                );
                // Brand overlays use their own confirmation route; without
                // this hook an overlay would have to duplicate process_payment().
                $req_body['merchant_urls']['merchant_confirmation_url'] =
                    apply_filters('twoinc_confirmation_url', $confirmation_url, $order->get_id());
            }

            if ($purchase_order_number) {
                $req_body['buyer_purchase_order_number'] = $purchase_order_number;
            }

            if (WC_Twoinc_Helper::is_tax_subtotals_required_by_twoinc()) {
                $req_body['tax_subtotals'] = WC_Twoinc_Helper::get_tax_subtotals($order->get_items(), $order->get_items('shipping'), $order->get_items('fee'), $order, $shipping_rates);
            }

            if ($tracking_id) {
                $req_body['tracking_id'] = $tracking_id;
            }

            // Must receive and return the FULL line_items array — append or
            // adjust entries, never return a single line.
            $req_body['line_items'] = apply_filters('twoinc_payment_terms_line', $req_body['line_items'], $req_body);

            // Legacy body filter, kept for existing integrations; runs before
            // twoinc_order_payload, which sees its result.
            if (has_filter('two_order_create')) {
                $req_body = apply_filters('two_order_create', $req_body);
            }

            $req_body = apply_filters('twoinc_order_payload', $req_body, $order);

            return $req_body;
        }

        /**
         * @param WC_Order $order
         * @param string   $department
         * @param string   $project
         * @param string   $purchase_order_number
         * @param string   $vendor_name
         *
         * @return array
         */
        public static function compose_twoinc_edit_order(
            $order,
            $department,
            $project,
            $purchase_order_number,
            $vendor_name
        ) {

            $billing_address = [
                'organization_name' => $order->get_billing_company(),
                'street_address' => $order->get_billing_address_1() . ($order->get_billing_address_2() ? (', ' . $order->get_billing_address_2()) : ''),
                'postal_code' => $order->get_billing_postcode(),
                'city' => $order->get_billing_city(),
                'region' => $order->get_billing_state(),
                'country' => $order->get_billing_country()
            ];
            $shipping_address = [
                'organization_name' => $order->get_shipping_company(),
                'street_address' => $order->get_shipping_address_1() . ($order->get_shipping_address_2() ? (', ' . $order->get_shipping_address_2()) : ''),
                'postal_code' => $order->get_shipping_postcode(),
                'city' => $order->get_shipping_city(),
                'region' => $order->get_shipping_state(),
                'country' => $order->get_shipping_country()
            ];
            if (WC_Twoinc_Helper::is_twoinc_address_empty($shipping_address)) {
                $shipping_address = $billing_address;
            }

            $req_body = ['currency' => $order->get_currency()] + self::order_totals($order) + [
                // Guard rounds once at the payload boundary, fails loud on a
                // negative (TWO-25097).
                'discount_amount' => WC_Twoinc_Helper::guard_negative_discount(
                    $order->get_total_discount(),
                    sprintf('order %s', $order->get_id()),
                    sprintf('total discount %s', var_export($order->get_total_discount(), true))
                ),
                'discount_rate' => '0',
                'invoice_type' => 'FUNDED_INVOICE',
                'buyer_department' => $department,
                'buyer_project' => $project,
                'order_note' => $order->get_customer_note(),
                'line_items' => WC_Twoinc_Helper::get_line_items($order->get_items(), $order->get_items('shipping'), $order->get_items('fee'), $order, false, null, $shipping_rates),
                'recurring' => false,
                'merchant_additional_info' => '',
                'merchant_reference' => '',
                'billing_address' => $billing_address,
                'shipping_address' => $shipping_address,
                'shipping_details' => WC_Twoinc_Helper::get_shipping_details($order)
            ];

            if ($vendor_name) {
                $req_body['vendor_name'] = $vendor_name;
            }

            if ($purchase_order_number) {
                $req_body['buyer_purchase_order_number'] = $purchase_order_number;
            }

            if (WC_Twoinc_Helper::is_tax_subtotals_required_by_twoinc()) {
                $req_body['tax_subtotals'] = WC_Twoinc_Helper::get_tax_subtotals($order->get_items(), $order->get_items('shipping'), $order->get_items('fee'), $order, $shipping_rates);
            }

            // Same brand hooks as compose_twoinc_order, in the same order, so
            // a mutation applied at creation isn't dropped from the edit PUT
            // body — which would also break the change-detection hash both
            // composers feed.
            $req_body['line_items'] = apply_filters('twoinc_payment_terms_line', $req_body['line_items'], $req_body);

            if (has_filter('two_order_edit')) {
                $req_body = apply_filters('two_order_edit', $req_body);
            }

            $req_body = apply_filters('twoinc_order_payload', $req_body, $order);

            return $req_body;
        }

        /**
         * @param mixed $order the parent order; a currency string (the pre-3.0.0 form) is still accepted.
         *
         * @return array
         */
        public static function compose_twoinc_refund($order_refund, $amount, $order)
        {
            $currency = is_string($order) ? $order : $order->get_currency();
            if (is_string($order)) {
                $order = wc_get_order($order_refund->get_parent_id()) ?: null;
            }

            $req_body = [
                'amount' => strval(WC_Twoinc_Helper::round_amt($amount)),
                'currency' => $currency,
                'line_items' => WC_Twoinc_Helper::get_line_items(
                    $order_refund->get_items(),
                    $order_refund->get_items('shipping'),
                    $order_refund->get_items('fee'),
                    $order_refund,
                    true,
                    $order
                )
            ];

            return $req_body;
        }

        /**
         * The order-intent body, from the same line builder as the order so intent and create declare the same
         * lines. `$order` is the unsaved order build_intent_order_from_cart() assembles from the cart.
         *
         * @param WC_Order $order
         * @param array    $buyer
         *
         * @return array
         */
        public static function compose_twoinc_intent($order, $buyer)
        {
            $req_body = self::order_totals($order) + [
                'invoice_type' => 'FUNDED_INVOICE',
                'buyer' => $buyer,
                'currency' => $order->get_currency(),
                'line_items' => WC_Twoinc_Helper::get_line_items($order->get_items(), $order->get_items('shipping'), $order->get_items('fee'), $order),
            ];
            $req_body['line_items'] = apply_filters('twoinc_payment_terms_line', $req_body['line_items'], $req_body);
            return $req_body;
        }

        /**
         * The order-level amounts every order body declares, copied from the order's own totals.
         *
         * @param WC_Order $order
         *
         * @return array
         */
        private static function order_totals($order)
        {
            return [
                'gross_amount' => strval(WC_Twoinc_Helper::round_amt($order->get_total())),
                'net_amount' => strval(WC_Twoinc_Helper::round_amt($order->get_total() - $order->get_total_tax())),
                'tax_amount' => strval(WC_Twoinc_Helper::round_amt($order->get_total_tax())),
            ];
        }

        /**
         * An unsaved order carrying the live cart's lines, totals and tax rows, so the intent reuses the order's
         * line builder. Nothing is persisted.
         *
         * @return WC_Order|null null when there is no cart to build from
         */
        public static function build_intent_order_from_cart()
        {
            if (!WC()->cart || WC()->cart->is_empty()) {
                return null;
            }
            // Fees and shipping packages are not held in the session, only recomputed.
            WC()->cart->calculate_totals();
            $order = new WC_Order();
            $order->set_currency(get_woocommerce_currency());
            $order->set_prices_include_tax('yes' === get_option('woocommerce_prices_include_tax'));
            $customer = WC()->customer;
            if ($customer) {
                foreach (['billing', 'shipping'] as $role) {
                    foreach (['company', 'address_1', 'address_2', 'postcode', 'city', 'state', 'country'] as $field) {
                        $order->{"set_{$role}_{$field}"}($customer->{"get_{$role}_{$field}"}());
                    }
                }
            }
            WC()->checkout()->set_data_from_cart($order);
            return $order;
        }

        /**
         * The context `twoinc_order_postprocessing` subscribers receive (TWO-26092). Keys are part of the stable
         * contract documented in the README: add, never remove or rename.
         *
         * @param string                    $request_type
         * @param string                    $trigger
         * @param string                    $endpoint
         * @param WC_Order                  $order
         * @param WC_Order_Refund|null      $refund
         *
         * @return array
         */
        public static function order_postprocessing_context($request_type, $trigger, $endpoint, $order, $refund = null)
        {
            $rate = self::get_configured_shipping_tax_rate($order);
            $fallback_option = WC_Twoinc_Brand::prefixed_name(WC_Twoinc::SHIPPING_TAX_FROM_SHOP_RATES_OPTION);

            return [
                'request_type' => $request_type,
                'trigger' => $trigger,
                'endpoint' => $endpoint,
                'order' => $order,
                'refund' => $refund,
                'shipping_tax_rate' => $rate,
                'fallback_shipping_tax_rate' => 'yes' === get_option($fallback_option) ? $rate : null,
                'contract_version' => self::ORDER_POSTPROCESSING_CONTRACT_VERSION,
            ];
        }

        /**
         * The one choke point every outbound order request passes before it is sent (TWO-26092): fires
         * `twoinc_order_postprocessing` and sends what it returns. The plugin does not check a subscriber's figures:
         * Two's API validates the request as it arrives. Only a subscriber that throws, returns something other
         * than an array, or returns something that cannot be encoded as JSON fails the request, as a code bug.
         *
         * @param array $payload the body exactly as it would be sent; [] for a request with no body
         * @param array $context from order_postprocessing_context()
         * @param bool  $record  false for a payload that is only hashed, never sent
         *
         * @return array the payload to send
         * @throws WC_Twoinc_Order_Postprocessing_Exception when a subscriber failed
         */
        public static function postprocess_order_request(array $payload, array $context, $record = true)
        {
            try {
                /**
                 * Stable extension contract, see README "Stable extension contract: order postprocessing".
                 *
                 * @param array $payload The complete request body.
                 * @param array $context request_type, trigger, endpoint, order, refund, shipping_tax_rate,
                 *                       fallback_shipping_tax_rate, contract_version.
                 */
                $processed = apply_filters('twoinc_order_postprocessing', $payload, $context);
            } catch (Throwable $e) {
                self::fail_postprocessing($context, 'a subscriber threw ' . get_class($e) . ': ' . $e->getMessage());
            }
            if (!is_array($processed)) {
                self::fail_postprocessing($context, 'a subscriber returned ' . gettype($processed) . ', not an array');
            }
            if (json_encode(self::utf8ize($processed)) === false) {
                self::fail_postprocessing($context, 'a subscriber returned a payload that cannot be encoded as JSON: ' . json_last_error_msg());
            }

            if ($record && function_exists('wc_get_logger')) {
                $diff = self::payload_diff($payload, $processed);
                if ($diff !== []) {
                    wc_get_logger()->debug(
                        sprintf('twoinc_order_postprocessing changed the %s request: %s', $context['request_type'], self::describe_payload_diff($diff)),
                        ['source' => 'twoinc-payment-gateway']
                    );
                }
            }

            return $processed;
        }

        /**
         * Opt-in for `twoinc_order_postprocessing` subscribers (TWO-26092): sets each order total, each per-rate tax
         * subtotal and a refund's amount to the sum over the payload's own lines plus the residual the original
         * carried beyond its lines (store credit, a gift card, rounding), touching only the fields the payload
         * already carries. `$original` is the payload as the subscriber received it. A total the subscriber edited
         * by hand before calling this is overwritten: the helper's result wins. Arithmetic only; part of the stable
         * contract.
         *
         * @param array $payload
         * @param array $original the payload before the subscriber's edits
         *
         * @return array
         */
        public static function recompute_totals_from_lines(array $payload, array $original)
        {
            $carry = self::residuals($original);
            $lines = isset($payload['line_items']) && is_array($payload['line_items']) ? $payload['line_items'] : [];
            $sums = self::sum_lines($lines);
            if (array_key_exists('gross_amount', $payload)) {
                foreach (['net_amount' => 'net', 'tax_amount' => 'tax', 'gross_amount' => 'gross'] as $field => $sum) {
                    $payload[$field] = self::format_amount($sums[$sum] + ($carry[$field] ?? 0.0));
                }
            }
            if (array_key_exists('tax_subtotals', $payload)) {
                $buckets = self::sum_lines_by_rate($lines);
                foreach ($carry as $key => $residual) {
                    if (round($residual, 2) && preg_match('/^tax_subtotals@([0-9.]+)\/(net|tax)$/', $key, $match)) {
                        $buckets[$match[1]] = $buckets[$match[1]] ?? ['net' => 0.0, 'tax' => 0.0];
                        $buckets[$match[1]][$match[2]] += $residual;
                    }
                }
                $payload['tax_subtotals'] = [];
                foreach ($buckets as $rate => $bucket) {
                    $payload['tax_subtotals'][] = [
                        'tax_amount' => self::format_amount($bucket['tax']),
                        'tax_rate' => (string) $rate,
                        'taxable_amount' => self::format_amount($bucket['net']),
                    ];
                }
            }
            if (array_key_exists('amount', $payload) && $lines !== []) {
                $sign = (float) $payload['amount'] < 0 ? -1 : 1;
                $payload['amount'] = self::format_amount($sign * (abs($sums['gross']) + ($carry['amount'] ?? 0.0)));
            }
            return $payload;
        }

        /**
         * What each figure a payload declares carries beyond what its lines sum to: zero for a shop whose totals
         * are its lines, not zero where store credit, a gift card or rounding sits outside them.
         *
         * @return array<string, float>
         */
        private static function residuals(array $payload)
        {
            $lines = isset($payload['line_items']) && is_array($payload['line_items']) ? $payload['line_items'] : [];
            $sums = self::sum_lines($lines);
            $residuals = [];
            if (isset($payload['tax_subtotals']) && is_array($payload['tax_subtotals'])) {
                $declared = [];
                foreach ($payload['tax_subtotals'] as $subtotal) {
                    $rate = self::round_rate((float) ($subtotal['tax_rate'] ?? 0));
                    $declared[$rate]['net'] = ($declared[$rate]['net'] ?? 0.0) + (float) ($subtotal['taxable_amount'] ?? 0);
                    $declared[$rate]['tax'] = ($declared[$rate]['tax'] ?? 0.0) + (float) ($subtotal['tax_amount'] ?? 0);
                }
                $from_lines = self::sum_lines_by_rate($lines);
                // A rate with lines but no declared bucket carries nothing (TWO-26117).
                foreach (array_keys($declared) as $rate) {
                    foreach (['net', 'tax'] as $part) {
                        $residuals["tax_subtotals@$rate/$part"] = ($declared[$rate][$part] ?? 0.0)
                            - ($from_lines[$rate][$part] ?? 0.0);
                    }
                }
            }
            foreach (['net_amount' => 'net', 'tax_amount' => 'tax', 'gross_amount' => 'gross'] as $field => $sum) {
                if (array_key_exists($field, $payload)) {
                    $residuals[$field] = (float) $payload[$field] - $sums[$sum];
                }
            }
            // Magnitudes: refund lines are negative while the amount may be either sign.
            if (array_key_exists('amount', $payload) && $lines !== []) {
                $residuals['amount'] = abs((float) $payload['amount']) - abs($sums['gross']);
            }
            return $residuals;
        }

        /**
         * @return never
         * @throws WC_Twoinc_Order_Postprocessing_Exception
         */
        private static function fail_postprocessing(array $context, $detail)
        {
            if (function_exists('wc_get_logger')) {
                wc_get_logger()->error(
                    sprintf('twoinc_order_postprocessing failed on the %s request, which was not sent: %s', $context['request_type'], $detail),
                    ['source' => 'twoinc-payment-gateway']
                );
            }
            throw new WC_Twoinc_Order_Postprocessing_Exception(sprintf(
                /* translators: 1: request type (e.g. order_update). 2: product name (e.g. Two). 3: what went wrong. */
                __('The %1$s request was not sent to %2$s: the twoinc_order_postprocessing filter failed (%3$s).', 'twoinc-payment-gateway'),
                $context['request_type'],
                WC_Twoinc_Brand::get('product_name'),
                $detail
            ));
        }

        /**
         * Leaf-level changes as JSON pointers; key order is not a change, list order is.
         *
         * @return array list of ['path', 'before', 'after']
         */
        private static function payload_diff($before, $after, $path = '')
        {
            if (!is_array($before) || !is_array($after)) {
                return $before === $after ? [] : [['path' => $path, 'before' => $before, 'after' => $after]];
            }
            $diff = [];
            foreach (array_unique(array_merge(array_keys($before), array_keys($after)), SORT_REGULAR) as $key) {
                $sub = $path . '/' . str_replace(['~', '/'], ['~0', '~1'], (string) $key);
                if (!array_key_exists($key, $before)) {
                    $diff[] = ['path' => $sub, 'before' => null, 'after' => $after[$key]];
                } elseif (!array_key_exists($key, $after)) {
                    $diff[] = ['path' => $sub, 'before' => $before[$key], 'after' => null];
                } else {
                    $diff = array_merge($diff, self::payload_diff($before[$key], $after[$key], $sub));
                }
            }
            return $diff;
        }

        /**
         * @return string
         */
        private static function describe_payload_diff(array $diff)
        {
            return implode('; ', array_map(static function ($entry) {
                return sprintf('%s: %s -> %s', $entry['path'], json_encode($entry['before']), json_encode($entry['after']));
            }, $diff));
        }

        /**
         * @return array ['net', 'tax', 'gross'] as floats
         */
        private static function sum_lines(array $lines)
        {
            $sums = ['net' => 0.0, 'tax' => 0.0, 'gross' => 0.0];
            foreach ($lines as $line) {
                $sums['net'] += (float) ($line['net_amount'] ?? 0);
                $sums['tax'] += (float) ($line['tax_amount'] ?? 0);
                $sums['gross'] += (float) ($line['gross_amount'] ?? 0);
            }
            return $sums;
        }

        /**
         * @return array rate (6dp string) => ['net', 'tax'], in first-seen order
         */
        private static function sum_lines_by_rate(array $lines)
        {
            $buckets = [];
            foreach ($lines as $line) {
                $rate = self::round_rate((float) ($line['tax_rate'] ?? 0));
                $buckets[$rate]['net'] = ($buckets[$rate]['net'] ?? 0.0) + (float) ($line['net_amount'] ?? 0);
                $buckets[$rate]['tax'] = ($buckets[$rate]['tax'] ?? 0.0) + (float) ($line['tax_amount'] ?? 0);
            }
            return $buckets;
        }

        /**
         * @return string
         */
        private static function format_amount($amount)
        {
            return number_format(round((float) $amount, 2) + 0.0, 2, '.', '');
        }

        /**
         * @return void
         */
        public static function append_admin_force_reload()
        {
            add_action('woocommerce_admin_order_items_after_line_items', function () {
                print('<script>location.reload();</script>');
            });
        }

        /**
         * @return bool
         */
        public static function is_country_supported($country)
        {
            return in_array($country, array('NO', 'GB'));
        }

        /**
         * The merchant's "Validate tax subtotals" setting is the only source
         * of truth (TWO-25502). Swedish shops need it on, which the one-time
         * backfill in WC_Twoinc::migrate_se_tax_subtotals() takes care of.
         *
         * @return bool
         */
        public static function is_tax_subtotals_required_by_twoinc()
        {
            $gateway = WC_Twoinc::get_instance();
            return $gateway && 'yes' === $gateway->get_option('enable_tax_subtotals');
        }

        /**
         * @return bool
         */
        public static function is_twoinc_development()
        {
            $hostname = str_replace(array('http://', 'https://'), '', get_home_url());

            if (preg_match('/^localhost(?::[0-9]{1,5})?$/', $hostname) === 1) {
                return true;
            }

            $env_dev_hostnames = getenv('TWOINC_DEV_HOSTNAMES');
            if ($env_dev_hostnames && in_array($hostname, explode(',', $env_dev_hostnames))) {
                return true;
            }

            $twoinc_dev_sites = '/^.*\.(?:staging|release|experimental|perf|cyber|demo|sandbox)\.two\.inc$/';
            if (preg_match($twoinc_dev_sites, $hostname) === 1) {
                return true;
            }

            return false;
        }

        /**
         * Environment modes the host builder accepts. The mode string is
         * spliced into the API hostname, and WooCommerce's select
         * validation does not restrict POSTed values to the options list —
         * so this allowlist is what keeps an admin-supplied string from
         * steering the gateway's API calls to an arbitrary host.
         */
        public const ENVIRONMENT_MODES = ['production', 'sandbox', 'staging'];

        /**
         * Mirrors the Magento config repository's mode setting: 'PROD' /
         * 'Production' map to 'production'; anything outside
         * ENVIRONMENT_MODES (including the empty default) also resolves to
         * 'production'.
         *
         * @param WC_Payment_Gateway $gateway
         *
         * @return string one of ENVIRONMENT_MODES
         */
        public static function get_environment_mode($gateway)
        {
            $mode = strtolower((string) $gateway->get_option('checkout_env'));
            if ($mode === 'prod') {
                $mode = 'production';
            }
            if (!in_array($mode, self::ENVIRONMENT_MODES, true)) {
                $mode = 'production';
            }
            return $mode;
        }

        /**
         * The environment the gateway actually talks to — not always the
         * configured mode: a dev-sniffed shop (see is_twoinc_development())
         * carrying the never-configured default 'production' mode is by
         * definition not a production shop. Local/dev tooling that needs the
         * API on an arbitrary host (e.g. `make install`'s docker-compose
         * stack, not on a *.staging.two.inc domain) uses the
         * TWOINC_DEV_API_HOST env var — a developer-set server var, never a
         * wp-admin field. Falls back to 'staging' when unset: a test
         * environment can neither take real money nor accept a production
         * token.
         *
         * @param WC_Payment_Gateway $gateway
         *
         * @return string one of ENVIRONMENT_MODES
         */
        public static function get_effective_environment_mode($gateway)
        {
            $mode = self::get_environment_mode($gateway);
            if ($mode !== 'production' || !self::is_twoinc_development()) {
                return $mode;
            }
            $dev_api_host = getenv('TWOINC_DEV_API_HOST');
            if ($dev_api_host) {
                return self::environment_mode_of_host($dev_api_host, $gateway);
            }
            return 'staging';
        }

        /**
         * Classifies an arbitrary API host (from TWOINC_DEV_API_HOST) so
         * every other host the gateway emits (checkout, signup) lands in the
         * same environment (TWO-25170). Production API host -> 'production';
         * `api.<mode>` labels -> that mode; anything else (localhost, a
         * bespoke tunnel) -> 'staging', since a dev-sniffed shop must not
         * resolve to production.
         *
         * @param string             $host
         * @param WC_Payment_Gateway $gateway
         *
         * @return string one of ENVIRONMENT_MODES
         */
        private static function environment_mode_of_host($host, $gateway)
        {
            $hostname = (string) parse_url($host, PHP_URL_HOST);
            $production = (string) parse_url(
                sprintf(WC_Twoinc_Brand::get('checkout_url_template'), 'api'),
                PHP_URL_HOST
            );
            if ($hostname !== '' && $hostname === $production) {
                return 'production';
            }
            $labels = explode('.', $hostname);
            if (
                count($labels) > 1
                && $labels[0] === 'api'
                && in_array($labels[1], self::ENVIRONMENT_MODES, true)
                && $labels[1] !== 'production'
            ) {
                return $labels[1];
            }
            return 'staging';
        }

        /**
         * Builds an environment host from the brand's URL template, mirroring
         * the Magento config repository: ('api', mode 'staging') on the Two
         * brand -> https://api.staging.two.inc; production drops the mode
         * suffix. Resolves off the *effective* mode, so every service host
         * sits in the same environment as the API host.
         *
         * @param string             $service 'api' or 'checkout'
         * @param WC_Payment_Gateway $gateway
         *
         * @return string
         */
        public static function get_environment_host($service, $gateway)
        {
            $override = self::get_dev_host_override($service, $gateway);
            if ($override !== '') {
                return $override;
            }
            $mode = self::get_effective_environment_mode($gateway);
            $prefix = $mode === 'production' ? $service : $service . '.' . $mode;
            return sprintf(WC_Twoinc_Brand::get('checkout_url_template'), $prefix);
        }

        /**
         * Developer env var backing each service host (TWO-40). Three
         * independent overrides:
         *
         *   - 'api'      the checkout/merchant API
         *   - 'checkout' Two's hosted checkout page — loaded by the BROWSER,
         *                so a Docker-network alias the shop's own server can
         *                reach is not necessarily one the buyer's browser can
         *                resolve
         *   - 'portal'   the merchant portal
         *
         * Server env vars, never wp-admin fields.
         */
        public const DEV_HOST_ENV_VARS = [
            'api' => 'TWOINC_DEV_API_HOST',
            'checkout' => 'TWOINC_DEV_CHECKOUT_HOST',
            'portal' => 'TWOINC_DEV_PORTAL_HOST',
        ];

        /**
         * A developer's override for one service host, or '' (TWO-40).
         *
         * Gated so a production instance can never honour one even if the
         * variable leaks into its process environment: the shop must BOTH
         * sniff as a development site AND still carry the never-configured
         * default mode.
         *
         * @param string             $service key of DEV_HOST_ENV_VARS
         * @param WC_Payment_Gateway $gateway
         *
         * @return string
         */
        public static function get_dev_host_override($service, $gateway)
        {
            if (!array_key_exists($service, self::DEV_HOST_ENV_VARS)) {
                return '';
            }
            if (
                self::get_environment_mode($gateway) !== 'production'
                || !self::is_twoinc_development()
            ) {
                return '';
            }
            $host = getenv(self::DEV_HOST_ENV_VARS[$service]);
            return is_string($host) && $host !== '' ? $host : '';
        }

        /**
         * Brand's merchant-portal signup URL, host swapped for a developer
         * override when one applies (TWO-40); only the origin is
         * replaced, so a brand overlay's own signup path is kept.
         *
         * @param WC_Payment_Gateway $gateway
         *
         * @return string
         */
        public static function get_merchant_portal_signup_url($gateway)
        {
            $url = (string) WC_Twoinc_Brand::get('sign_up_url');
            $override = self::get_dev_host_override('portal', $gateway);
            if ($override === '') {
                return $url;
            }
            $path = (string) parse_url($url, PHP_URL_PATH);
            return rtrim($override, '/') . $path;
        }

        /**
         * A brand-supplied URL, or '' unless it is http(s). Anything else
         * (javascript:, data:, a bare path) would survive to markup as an
         * empty href once esc_url blanked it, so it is refused here instead.
         *
         * @param mixed $url
         *
         * @return string
         */
        public static function http_url_or_empty($url)
        {
            if (!is_string($url)) {
                return '';
            }
            $scheme = strtolower((string) parse_url($url, PHP_URL_SCHEME));

            return in_array($scheme, ['http', 'https'], true) ? $url : '';
        }

        /**
         * Full-form locale (e.g. en_US) — sent as the invoice PDF `lang`
         * param and the Accept-Language header, both matching `lang`
         * literally against an allow-list (underscore, not hyphen).
         *
         * determine_locale(), not get_user_locale(): the storefront page
         * (including this plugin's own strings) renders in the
         * site/switched locale, which is the language the API should answer
         * in — get_user_locale() would instead return a logged-in buyer's WP
         * profile language, which can differ from the checkout page around
         * it.
         *
         * @return string
         */
        public static function get_locale()
        {
            $locale = determine_locale();
            if ($locale && strlen($locale) > 0) {
                return $locale;
            }
            return 'en_US';
        }

        /**
         * @return array
         */
        public static function utf8ize($d)
        {
            if (is_array($d)) {
                foreach ($d as $k => $v) {
                    $d[$k] = WC_Twoinc_Helper::utf8ize($v);
                }
            } elseif (is_object($d)) {
                foreach ($d as $k => $v) {
                    $d->$k = WC_Twoinc_Helper::utf8ize($v);
                }
            } elseif (is_string($d)) {
                if (mb_check_encoding($d, 'UTF-8')) {
                    return $d;
                }

                $encoding = mb_detect_encoding($d, mb_detect_order(), true);
                if ($encoding) {
                    return mb_convert_encoding($d, 'UTF-8', $encoding);
                }

                // Mimics removed utf8_encode()'s fallback behavior.
                return mb_convert_encoding($d, 'UTF-8', 'ISO-8859-1');
            }
            return $d;
        }

        /**
         * @return string
         */
        public static function hash_order($order, $twoinc_meta)
        {
            return self::hash_order_pair($order, $twoinc_meta)[0];
        }

        /**
         * The change hash, and a hash of only what the invoice bills: amounts,
         * addresses, and each line's name, quantity and amount. The second
         * judges whether an admin edit changed the order (TWO-26171). It
         * leaves out shipping_details, which moves on its own (a tracking
         * number added late, an expected delivery date taken from today) and
         * is no edit to warn about (TWO-24762), and the rest of the body, so
         * that a plugin update to it does not read as an edit.
         *
         * @return string[] [change hash, invoice hash]
         */
        public static function hash_order_pair($order, $twoinc_meta)
        {
            $twoinc_order = WC_Twoinc_Helper::compose_twoinc_order(
                $order,
                $twoinc_meta['order_reference'],
                $twoinc_meta['company_id'],
                $twoinc_meta['department'],
                $twoinc_meta['project'],
                $twoinc_meta['purchase_order_number'],
                $twoinc_meta['invoice_emails'],
                $twoinc_meta['payment_reference_message'],
                $twoinc_meta['payment_reference_ocr'],
                $twoinc_meta['payment_reference'],
                $twoinc_meta['payment_reference_type'],
                $twoinc_meta['vendor_name'],
                '',
                true
            );
            $context = self::order_postprocessing_context('order_create', 'change_hash', '/v1/order', $order);
            $body = self::postprocess_order_request($twoinc_order, $context, false);
            $invoiced = [];
            foreach (['currency', 'gross_amount', 'net_amount', 'tax_amount', 'discount_amount', 'billing_address', 'shipping_address'] as $key) {
                $invoiced[$key] = $body[$key] ?? null;
            }
            foreach ($body['line_items'] ?? [] as $line) {
                $invoiced['line_items'][] = [$line['name'] ?? null, $line['quantity'] ?? null, $line['gross_amount'] ?? null];
            }
            return [WC_Twoinc_Helper::hash_obj($body), WC_Twoinc_Helper::hash_obj($invoiced)];
        }

        /**
         * @return string
         */
        public static function hash_obj($obj)
        {
            return md5(json_encode(WC_Twoinc_Helper::utf8ize($obj)));
        }

        /**
         * @return array
         */
        public static function array_diff_r($src_arr, $dst_arr)
        {
            $diff = array();

            foreach ($src_arr as $key => $val) {
                if (array_key_exists($key, $dst_arr)) {
                    if (is_array($val)) {
                        $sub_diff = WC_Twoinc_Helper::array_diff_r($val, $dst_arr[$key]);
                        if (count($sub_diff)) {
                            $diff[$key] = $sub_diff;
                        }
                    } else {
                        if ($val != $dst_arr[$key]) {
                            $diff[$key] = $val;
                        }
                    }
                } else {
                    $diff[$key] = $val;
                }
            }
            return $diff;
        }

        /**
         * @return array
         */
        public static function get_product($line_item)
        {

            if (gettype($line_item) !== 'array' && get_class($line_item) === 'WC_Order_Item_Product') {
                return $line_item->get_product();
            } else {
                return $line_item['data'];
            }
        }

        /**
         * The rate the line's tax rows declare. `$declared` reports whether the line carries any rate row of the
         * order at all, including one charged 0 (a 0% rate), as distinct from a line with no rate row.
         *
         * @return array
         */
        private static function get_item_tax_rate($line_item, $order, &$declared = null)
        {
            $declared = false;
            $item_tax_rate_list = [];
            if ($line_item->get_taxes()['total']) {
                foreach ($line_item->get_taxes()['total'] as $rate_id => $tax_amt) {
                    foreach ($order->get_taxes() as $order_tax) {
                        if ($rate_id != $order_tax->get_rate_id()) {
                            continue;
                        }
                        $declared = true;
                        if ($tax_amt) {
                            $tax_name = isset($order_tax['label']) ? $order_tax['label'] : '';
                            array_push($item_tax_rate_list, [
                                'rate' => $order_tax->get_rate_percent() / 100,
                                'name' => $tax_name,
                                'compound' => (bool) $order_tax->get_compound(),
                            ]);
                        }
                    }
                }
            }
            return WC_Twoinc_Helper::get_tax_rate_from_tax_list($item_tax_rate_list);
        }

        /**
         * TWO-26117. A line with a rate row (including a 0% one) is sent at that rate, unchecked. A line with none is
         * sent as charged at 0% unless the shipping tax control is populated, in which case the rate comes from it
         * and the line's tax must reconcile with it. Two's API validates what is sent either way.
         * A refund line takes its rate from the parent line it refunds, which is what the order was charged at.
         *
         * @return array
         * @throws Exception
         */
        private static function get_shipping_tax_rate($shipping, $order, $is_refund = false)
        {
            $charged = $is_refund ? self::get_refunded_line($shipping, $order) : $shipping;
            if (!$charged) {
                self::refuse(
                    sprintf(
                        'Refund of shipping "%s" on order %s has no parent line to take the charged tax rate from.',
                        $shipping->get_name(),
                        $order->get_id()
                    ),
                    sprintf(
                        /* translators: %s: shipping method name */
                        __('Shipping "%s" cannot be refunded: the order line it refunds was not found.', 'twoinc-payment-gateway'),
                        $shipping->get_name()
                    )
                );
            }
            $resolved = self::get_item_tax_rate($charged, $order, $declared);
            if ($declared) {
                return $resolved;
            }
            $controlled = self::get_undeclared_shipping_tax_rate($charged, $order);
            if (null === $controlled) {
                return $resolved;
            }
            // A refund may return only the net or only the tax (e.g. VAT charged to a reverse-charge buyer).
            $partial = !round((float) $shipping->get_total(), 2) || !round((float) $shipping->get_total_tax(), 2);
            if (!$is_refund || !$partial) {
                self::assert_tax_reconciles($shipping, $controlled['rate']);
            }
            return $controlled;
        }

        /**
         * The order line a refund line refunds, or false when the refund records none or it was deleted.
         *
         * @return mixed
         */
        private static function get_refunded_line($line, $order)
        {
            $id = (int) $line->get_meta('_refunded_item_id');
            return $id ? $order->get_item($id) : false;
        }

        /**
         * A net-only refund line has no tax rows, so it takes the parent's; with no parent it keeps its own.
         *
         * @return mixed
         */
        private static function get_rate_line($line, $order, $is_refund)
        {
            return ($is_refund ? self::get_refunded_line($line, $order) : false) ?: $line;
        }

        /**
         * The rate for a shipping line with no rate row when the shipping tax control is populated, else null.
         * Decided from stored data after placement: the rate recorded on the line at checkout if the control was
         * populated then, else null. Only an order not yet placed reads the control and the shop's shipping tax class.
         *
         * @return array|null
         * @throws Exception
         */
        private static function get_undeclared_shipping_tax_rate($line, $order)
        {
            $meta_key = WC_Twoinc_Brand::meta_key(self::SHIPPING_TAX_RATE_META);
            $stored = $line->get_meta($meta_key);
            if (is_array($stored)) {
                return $stored;
            }
            $placed = $order->get_meta(WC_Twoinc_Brand::prefixed_name('order_id'))
                || $order->get_meta('tillit_order_id');
            $option = WC_Twoinc_Brand::prefixed_name(WC_Twoinc::SHIPPING_TAX_FROM_SHOP_RATES_OPTION);
            if ($placed || 'yes' !== get_option($option)) {
                return null;
            }
            $resolved = self::get_shop_shipping_tax_rate($line, $order);
            self::assert_tax_reconciles($line, $resolved['rate']);
            // Persisted by the order save that follows a successful create.
            $line->update_meta_data($meta_key, $resolved);
            return $resolved;
        }

        /**
         * Mirrors WC_Abstract_Order::calculate_taxes() and WC_Tax::get_shipping_tax_rates().
         *
         * @return array
         */
        private static function get_shop_shipping_tax_rate($shipping, $order)
        {
            $tax_class = self::get_shop_shipping_tax_class($order);
            $rates = [];
            // Core taxes nothing on a VAT-exempt order (e.g. a reverse-charge buyer), shipping included.
            $is_vat_exempt = apply_filters('woocommerce_order_is_vat_exempt', 'yes' === $order->get_meta('is_vat_exempt'), $order);
            if (!$is_vat_exempt && null !== $tax_class && wc_tax_enabled() && 'taxable' === $shipping->get_tax_status()) {
                $rates = WC_Tax::find_shipping_rates(array_merge($order->get_taxable_location(), ['tax_class' => $tax_class]));
            }
            return self::get_tax_rate_from_tax_list(self::shop_rate_list($rates));
        }

        /**
         * The rate WooCommerce's shipping tax class setting would apply at the order's tax address, whether or not
         * its shipping was taxed; null when none is configured. Deliberately separate from the reconciliation
         * resolvers above: this reports configuration, they describe the tax actually charged.
         *
         * @return float|null
         */
        public static function get_configured_shipping_tax_rate($order)
        {
            $tax_class = self::get_shop_shipping_tax_class($order);
            if (null === $tax_class || !wc_tax_enabled()) {
                return null;
            }
            $rates = WC_Tax::find_shipping_rates(array_merge($order->get_taxable_location(), ['tax_class' => $tax_class]));
            if (!$rates) {
                return null;
            }
            return (float) self::get_tax_rate_from_tax_list(self::shop_rate_list($rates))['rate'];
        }

        /**
         * @return string|null null when "based on cart items" finds no taxable item to follow
         */
        private static function get_shop_shipping_tax_class($order)
        {
            $tax_class = get_option('woocommerce_shipping_tax_class');
            if ('inherit' === $tax_class) {
                $found_classes = array_intersect(
                    array_merge([''], WC_Tax::get_tax_class_slugs()),
                    $order->get_items_tax_classes()
                );
                $tax_class = count($found_classes) ? current($found_classes) : (count($order->get_items()) ? null : '');
            }
            if (null === $tax_class) {
                return null;
            }
            return apply_filters(
                'woocommerce_shipping_tax_class',
                $tax_class,
                null,
                null,
                array_values($order->get_taxable_location())
            );
        }

        /**
         * @return array
         */
        private static function shop_rate_list($rates)
        {
            $tax_rate_list = [];
            foreach ($rates as $rate) {
                $tax_rate_list[] = [
                    'rate' => (float) $rate['rate'] / 100,
                    'name' => (string) ($rate['label'] ?? ''),
                    'compound' => 'yes' === $rate['compound'],
                ];
            }
            return $tax_rate_list;
        }

        /**
         * Same check and tolerance as the PrestaShop and Magento plugins.
         *
         * @throws Exception
         */
        private static function assert_tax_reconciles($line, $rate)
        {
            $net = round((float) $line->get_total(), 2);
            $tax = round((float) $line->get_total_tax(), 2);
            $expected = round($net * (float) $rate, 2);
            // Epsilon: 0.02 itself is not exactly representable.
            if (abs($tax - $expected) <= self::TAX_RECONCILE_TOLERANCE + 1e-9) {
                return;
            }
            self::refuse(
                sprintf(
                    'Declared tax rate does not reconcile with the tax charged on "%s":'
                        . ' rate %s, net %s, tax %s, expected tax %s.'
                        . ' Check the shop tax rates for this shipping method.',
                    $line->get_name(),
                    self::round_rate($rate),
                    $net,
                    $tax,
                    $expected
                ),
                sprintf(
                    /* translators: %s: shipping method name */
                    __('The tax charged on "%s" does not match the shop\'s tax rates.', 'twoinc-payment-gateway'),
                    $line->get_name()
                )
            );
        }

        /**
         * @throws Exception
         */
        private static function refuse($log, $message)
        {
            if (function_exists('wc_get_logger')) {
                wc_get_logger()->error($log, ['source' => 'twoinc-payment-gateway']);
            }
            throw new Exception($message);
        }

        /**
         * Compound rows tax the price plus the taxes before them (WC_Tax::calc_exclusive_tax).
         *
         * @return array
         */
        private static function get_tax_rate_from_tax_list($tax_rate_list)
        {
            $no_zero_list = [];
            foreach ($tax_rate_list as $tax_rate) {
                if ($tax_rate['rate']) {
                    $no_zero_list[] = $tax_rate;
                }
            }
            if (count($no_zero_list) == 0) {
                return [
                    'rate' => 0,
                    'name' => 'NA'
                ];
            } elseif (count($no_zero_list) == 1) {
                return reset($no_zero_list);
            }
            $rate = 0;
            foreach ($no_zero_list as $tax_rate) {
                if (empty($tax_rate['compound'])) {
                    $rate += $tax_rate['rate'];
                }
            }
            foreach ($no_zero_list as $tax_rate) {
                if (!empty($tax_rate['compound'])) {
                    $rate += (1 + $rate) * $tax_rate['rate'];
                }
            }
            return [
                'rate' => $rate,
                'name' => 'Compound Tax'
            ];
        }
    }
}
