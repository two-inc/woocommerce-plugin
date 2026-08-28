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
                return sprintf(__('Response code from %s: %d', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'), $response['response']['code']);
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
         *
         * @return array
         */
        public static function get_line_items($line_items, $shippings, $fees, $order, $is_refund = false)
        {

            $items = [];

            /** @var WC_Order_Item_Product $line_item */
            foreach ($line_items as $line_item) {
                $product_simple = WC_Twoinc_Helper::get_product($line_item);

                $tax_rate = WC_Twoinc_Helper::get_item_tax_rate($line_item, $order);

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
            }

            foreach ($shippings as $shipping) {
                if ($shipping->get_total() == 0) {
                    continue;
                }
                $tax_rate = WC_Twoinc_Helper::get_item_tax_rate($shipping, $order);
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
            }

            foreach ($fees as $fee) {
                if ($fee->get_total() == 0) {
                    continue;
                }
                $tax_rate = WC_Twoinc_Helper::get_item_tax_rate($fee, $order);
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
            }

            return $items;
        }

        /**
         * @return array
         */
        private static function get_internal_tax_key($tax_rate)
        {
            return strval(WC_Twoinc_Helper::round_rate($tax_rate['rate'])) . '|' . $tax_rate['name'];
        }

        /**
         * @return array
         */
        public static function get_tax_subtotals($line_items, $shippings, $fees, $order)
        {

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

            foreach ($shippings as $shipping) {
                if ($shipping->get_total() == 0) {
                    continue;
                }
                $tax_rate = WC_Twoinc_Helper::get_item_tax_rate($shipping, $order);
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
                if ($fee->get_total() == 0) {
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
            $skip_nonce = false,
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

            $req_body = [
                'currency' => $order->get_currency(),
                'gross_amount' => strval(WC_Twoinc_Helper::round_amt($order->get_total())),
                'net_amount' => strval(WC_Twoinc_Helper::round_amt($order->get_total() - $order->get_total_tax())),
                'tax_amount' => strval(WC_Twoinc_Helper::round_amt($order->get_total_tax())),
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
                        // The captured company, not the billing address's
                        // organisation name: in payment-tile placement the two
                        // are allowed to differ, and this is the one the
                        // organisation number belongs to.
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
                'line_items' => WC_Twoinc_Helper::get_line_items($order->get_items(), $order->get_items('shipping'), $order->get_items('fee'), $order),
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

            if (!$skip_nonce) {
                // Param names and nonce action derive from the brand's
                // meta_prefix so process_confirmation matches what live
                // branded stores expect. Path segment is cosmetic —
                // confirmation detection is by param presence, not path.
                $confirmation_url = sprintf(
                    '%s/twoinc-payment-gateway/confirm?order_id=%s&%s=%s&%s=%s',
                    get_home_url(),
                    $order->get_id(),
                    WC_Twoinc_Brand::prefixed_name('order_reference'),
                    $order_reference,
                    WC_Twoinc_Brand::prefixed_name('nonce'),
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
                $req_body['tax_subtotals'] = WC_Twoinc_Helper::get_tax_subtotals($order->get_items(), $order->get_items('shipping'), $order->get_items('fee'), $order);
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

            $req_body = [
                'currency' => $order->get_currency(),
                'gross_amount' => strval(WC_Twoinc_Helper::round_amt($order->get_total())),
                'net_amount' => strval(WC_Twoinc_Helper::round_amt($order->get_total() - $order->get_total_tax())),
                'tax_amount' => strval(WC_Twoinc_Helper::round_amt($order->get_total_tax())),
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
                'line_items' => WC_Twoinc_Helper::get_line_items($order->get_items(), $order->get_items('shipping'), $order->get_items('fee'), $order),
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
                $req_body['tax_subtotals'] = WC_Twoinc_Helper::get_tax_subtotals($order->get_items(), $order->get_items('shipping'), $order->get_items('fee'), $order);
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
         * @return array
         */
        public static function compose_twoinc_refund($order_refund, $amount, $currency)
        {

            $req_body = [
                'amount' => strval(WC_Twoinc_Helper::round_amt($amount)),
                'currency' => $currency,
                'line_items' => WC_Twoinc_Helper::get_line_items($order_refund->get_items(), $order_refund->get_items('shipping'), $order_refund->get_items('fee'), $order_refund, true)
            ];

            return $req_body;
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
         * Developer env var backing each service host (TWO-40 §9). Three
         * independent overrides:
         *
         *   - 'api'      the checkout/merchant API
         *   - 'checkout' the hosted checkout-page app — loaded by the BROWSER,
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
         * A developer's override for one service host, or '' (TWO-40 §9).
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
         * override when one applies (TWO-40 §9); only the origin is
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
            return WC_Twoinc_Helper::hash_obj($twoinc_order);
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
         * @return array
         */
        private static function get_item_tax_rate($line_item, $order)
        {
            $item_tax_rate_list = [];
            if ($line_item->get_taxes()['total']) {
                foreach ($line_item->get_taxes()['total'] as $rate_id => $tax_amt) {
                    if ($tax_amt) {
                        foreach ($order->get_taxes() as $order_tax) {
                            if ($rate_id == $order_tax->get_rate_id()) {
                                $tax_name = isset($order_tax['label']) ? $order_tax['label'] : '';
                                array_push($item_tax_rate_list, [
                                    'rate' => $order_tax->get_rate_percent() / 100,
                                    'name' => $tax_name
                                ]);
                            }
                        }
                    }
                }
            }
            return WC_Twoinc_Helper::get_tax_rate_from_tax_list($item_tax_rate_list);
        }

        /**
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
            } else {
                $sum_rate = 0;
                foreach ($no_zero_list as $id => $tax_rate) {
                    $sum_rate += $tax_rate['rate'];
                }
                return [
                    'rate' => $sum_rate,
                    'name' => 'Compound Tax'
                ];
            }
        }
    }
}
