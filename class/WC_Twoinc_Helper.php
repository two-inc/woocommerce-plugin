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
         * Round the amount in woocommerce way
         *
         * @return string
         */
        public static function round_amt($amt)
        {
            return number_format($amt, wc_get_price_decimals(), '.', '');
        }

        /**
         * Round the rate to 6dp
         *
         * @return string
         */
        public static function round_rate($rate)
        {
            return number_format($rate, 6, '.', '');
        }

        /**
         * Get error message from twoinc response
         *
         * @param $response
         *
         * @return string|void
         */
        public static function get_twoinc_error_msg($response)
        {
            if (!$response) {
                return __('Two empty response', 'twoinc-payment-gateway');
            }

            if($response['response'] && $response['response']['code'] && $response['response']['code'] >= 400) {
                return sprintf(__('Two response code %d', 'twoinc-payment-gateway'), $response['response']['code']);
            }

            if($response['body']) {
                $body = json_decode($response['body'], true);
                if (is_string($body)) {
                    return __($body, 'twoinc-payment-gateway');
                } else if (isset($body['error_details']) && is_string($body['error_details'])) {
                    return __($body['error_details'], 'twoinc-payment-gateway');
                } else if (isset($body['error_code']) && is_string($body['error_code'])) {
                    return __($body['error_code'], 'twoinc-payment-gateway');
                }
            }
        }

        /**
         * Get validation message from twoinc response
         *
         * @param $response
         *
         * @return string|void
         */
        public static function get_twoinc_validation_msg($response)
        {
            $err_msg = __('Invoice purchase is not available for this order', 'twoinc-payment-gateway');
            if (!$response) {
                return $err_msg;
            }

            if($response['response'] && $response['response']['code'] && $response['response']['code'] >= 400) {
                if($response['body']) {
                    $body = json_decode($response['body'], true);
                    // Parameters validation errors
                    if (!is_string($body) && isset($body['error_json']) && is_array($body['error_json'])) {
                        $errs = array();
                        foreach ($body['error_json'] as $er) {
                            if ($er && $er['loc']) {
                                $display_msg = WC_Twoinc_Helper::get_msg_from_loc(json_encode(WC_Twoinc_Helper::utf8ize($er['loc'])));
                                if ($display_msg) {
                                    array_push($errs, $display_msg);
                                }
                            }
                        }
                        if (count($errs) > 0) {
                            return $errs;
                        }
                    }
                    // Custom errors
                    if (isset($body['error_code']) && $body['error_code'] == 'SAME_BUYER_SELLER_ERROR') {
                        return __('Buyer and merchant may not be the same company', 'twoinc-payment-gateway');
                    }
                }

                return $err_msg;
            }
        }

        /**
         * Get validation message
         *
         * @param $loc_str
         *
         * @return string|void
         */
        public static function get_msg_from_loc($loc_str)
        {
            $generic_err_template = __('Please enter a valid %s to pay on invoice', 'twoinc-payment-gateway');
            $loc_str = preg_replace('/\s+/', '', $loc_str);

            if ($loc_str === '["buyer","representative","phone_number"]') {
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
        }

        /**
         * Display notice message in website for buyers
         *
         * @param $message
         *
         * @return void
         */
        public static function display_ajax_error($message)
        {
            if (is_string($message)) {
                wc_add_notice($message, 'error');
            } else if (is_array($message)) {
                foreach ($message as $msg) {
                    wc_add_notice($msg, 'error');
                }
            } else {
                return;
            }

            if ($wp_version > '5.0.0' && !wp_is_json_request()) {
                wc_print_notices();
            }
        }

        /**
         * Authenticate external REST requests
         *
         * @param $wc_twoinc
         *
         * @return bool
         */
        public static function auth_rest_request($wc_twoinc)
        {
	    // TODO: Drop comparison against HTTP_X_API_KEY in a future release
            return hash('sha256', $wc_twoinc->api_key) === $_SERVER['HTTP_X_API_KEY_HASH'] || $wc_twoinc->api_key === $_SERVER['HTTP_X_API_KEY'];
        }

        /**
         * Send alert email to twoinc tech support
         *
         * @param $subject
         * @param $content
         *
         * @return bool
         */
        public static function send_twoinc_alert_email($content, $subject = 'WooCommerce operation alert')
        {
            do_action('twoinc_send_alert_email', $content, $subject);

            $email = 'woocom-alerts@two.inc';
            return wp_mail($email, $subject, $content, "Reply-To: " . $email . "\r\n");

        }

        /**
         * Check if order is paid by twoinc
         *
         * @param $order
         *
         * @return bool
         */
        public static function is_twoinc_order($order)
        {
            return $order && $order->get_payment_method() && $order->get_payment_method() === 'woocommerce-gateway-tillit';
        }

        /**
         * Check if address json to send to Twoinc is empty
         *
         * @param $twoinc_address
         *
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
         * Check if string has no content except special characters
         *
         * @param $twoinc_address
         *
         * @return bool
         */
        public static function is_str_no_word($s)
        {

            return !$s || !preg_replace('/[\s,.-]/', '', $s);

        }

        /**
         * Compose the cart items
         *
         * @return array
         */
        public static function get_line_items($line_items, $shippings, $fees, $order)
        {

            $items = [];

            /** @var WC_Order_Item_Product $line_item */
            foreach ($line_items as $line_item) {

                $product_simple = WC_Twoinc_Helper::get_product($line_item);

                $tax_rate = WC_Twoinc_Helper::get_item_tax_rate($line_item, $order);

                $image_url = get_the_post_thumbnail_url($product_simple->get_id());

                $product = [
                    'name' => $product_simple->get_name(),
                    'description' => substr($product_simple->get_description(), 0, 255),
                    'gross_amount' => strval(WC_Twoinc_Helper::round_amt($line_item['line_total'] + $line_item['line_tax'])),
                    'net_amount' => strval(WC_Twoinc_Helper::round_amt($line_item['line_total'])),
                    'discount_amount' => strval(WC_Twoinc_Helper::round_amt($line_item['line_subtotal'] - $line_item['line_total'])),
                    'tax_amount' => strval(WC_Twoinc_Helper::round_amt($line_item['line_tax'])),
                    'tax_class_name' => $tax_rate['name'],
                    'tax_rate' => strval(WC_Twoinc_Helper::round_rate($tax_rate['rate'])),
                    'unit_price' => strval($order->get_item_subtotal($line_item, false, true)),
                    'quantity' => $line_item['quantity'],
                    'quantity_unit' => 'item',
                    'image_url' => $image_url ? $image_url : '',
                    'product_page_url' => $product_simple->get_permalink(),
                    'type' => 'PHYSICAL',
                    'details' => [
                        'barcodes' => [
                            [
                                'type' => 'SKU',
                                'value' => $product_simple->get_sku()
                            ]
                        ]
                    ]
                ];

                $categories = wp_get_post_terms($product_simple->get_id(), 'product_cat');

                $product['details']['categories'] = [];

                foreach ($categories as $category) {
                    $product['details']['categories'][] = $category->name;
                }

                $items[] = $product;

            }

            // Shipping
            foreach ($shippings as $shipping) {
                if ($shipping->get_total() == 0) continue;
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

            // Fee
            foreach ($fees as $fee) {
                if ($fee->get_total() == 0) continue;
                $tax_rate = WC_Twoinc_Helper::get_item_tax_rate($fee, $order);
                $fee_line = [
                    'name' => 'Fee - ' . $fee->get_name(),
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
         * Get internally convened tax key for twoinc computation
         *
         * @return array
         */
        private static function get_internal_tax_key($tax_rate)
        {
            return strval(WC_Twoinc_Helper::round_rate($tax_rate['rate'])) . '|' . $tax_rate['name'];
        }

        /**
         * Compose the tax subtotals
         *
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

            // Shipping
            foreach ($shippings as $shipping) {
                if ($shipping->get_total() == 0) continue;
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

            // Fee
            foreach ($fees as $fee) {
                if ($fee->get_total() == 0) continue;
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

            // Aggregate the tax_subtotals
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
         * Compose request body for twoinc create order
         *
         * @param $order
         *
         * @return bool
         */
        public static function compose_twoinc_order(
            $order, $order_reference, $company_id, $department, $project, $purchase_order_number, $invoice_emails,
            $payment_reference_message = '', $payment_reference_ocr = '', $payment_reference = '', $payment_reference_type = '',
            $tracking_id = '', $skip_nonce = false)
        {

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
                'discount_amount' => strval(WC_Twoinc_Helper::round_amt($order->get_total_discount())),
                'discount_rate' => '0',
                'invoice_type' => 'FUNDED_INVOICE',
                'invoice_details' => $invoice_details,
                'buyer' => [
                    'company' => [
                        'organization_number' => $company_id,
                        'country_prefix' => $order->get_billing_country(),
                        'company_name' => $order->get_billing_company()
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
                    // 'merchant_confirmation_url' => $order->get_checkout_order_received_url(),
                    'merchant_cancel_order_url' => wp_specialchars_decode($order->get_cancel_order_url()),
                    'merchant_edit_order_url' => wp_specialchars_decode($order->get_edit_order_url()),
                    'merchant_order_verification_failed_url' => wp_specialchars_decode($order->get_cancel_order_url()),
                    'merchant_invoice_url' => '',
                    'merchant_shipping_document_url' => ''
                ],
                'billing_address' => $billing_address,
                'shipping_address' => $shipping_address,
                'shipping_details' => [
                    // 'carrier_name' => '',
                    // 'tracking_number' => '',
                    // 'carrier_tracking_url' => '',
                    'expected_delivery_date' => date('Y-m-d', strtotime('+ 7 days'))
                ]
            ];
            if (!$skip_nonce) {
                $req_body['merchant_urls']['merchant_confirmation_url'] = sprintf(
                    '%s/twoinc-payment-gateway/confirm?twoinc_confirm_order=%s&nonce=%s',
                    get_home_url(), $order_reference, wp_create_nonce('twoinc_confirm'));
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

            if(has_filter('two_order_create')) {
                $req_body = apply_filters('two_order_create', $req_body);
            }

            return $req_body;
        }

        /**
         * Compose request body for twoinc edit order
         *
         * @param $order
         *
         * @return bool
         */
        public static function compose_twoinc_edit_order(
            $order, $department, $project, $purchase_order_number)
        {

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
                'discount_amount' => strval(WC_Twoinc_Helper::round_amt($order->get_total_discount())),
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
                'shipping_details' => [
                    // 'carrier_name' => '',
                    // 'tracking_number' => '',
                    // 'carrier_tracking_url' => '',
                    'expected_delivery_date' => date('Y-m-d', strtotime('+ 7 days'))
                ]
            ];

            if ($purchase_order_number) {
                $req_body['buyer_purchase_order_number'] = $purchase_order_number;
            }

            if (WC_Twoinc_Helper::is_tax_subtotals_required_by_twoinc()) {
                $req_body['tax_subtotals'] = WC_Twoinc_Helper::get_tax_subtotals($order->get_items(), $order->get_items('shipping'), $order->get_items('fee'), $order);
            }

            if(has_filter('two_order_edit')) {
                $req_body = apply_filters('two_order_edit', $req_body);
            }

            return $req_body;
        }

        /**
         * Compose request body for twoinc refund order
         *
         * @param $order_refund
         * @param $amount
         * @param $currency
         *
         * @return array
         */
        public static function compose_twoinc_refund($order_refund, $amount, $currency)
        {

            $req_body = [
                'amount' => strval(WC_Twoinc_Helper::round_amt($amount)),
                'currency' => $currency,
                'initiate_payment_to_buyer' => true,
                'line_items' => WC_Twoinc_Helper::get_line_items($order_refund->get_items(), $order_refund->get_items('shipping'), $order_refund->get_items('fee'), $order_refund)
            ];

            return $req_body;
        }

        /**
         * Compose request body for twoinc refund order
         *
         * @param $order_id
         *
         * @return array
         */
        public static function get_private_order_notes($order_id){
            global $wpdb;

            $results = $wpdb->get_results("" .
                "SELECT * FROM $wpdb->comments" .
                "  WHERE `comment_post_ID` = $order_id" .
                "    AND `comment_type` LIKE 'order_note'");

            foreach($results as $note){
                $order_note[]  = array(
                    'note_id'      => $note->comment_ID,
                    'note_date'    => $note->comment_date,
                    'note_author'  => $note->comment_author,
                    'note_content' => $note->comment_content,
                );
            }
            return $order_note;
        }

        /**
         * Force reload after admin ajax request
         *
         * @return void
         */
        public static function append_admin_force_reload()
        {
            add_action('woocommerce_admin_order_items_after_line_items', function(){
                print('<script>location.reload();</script>');
            });
        }

        /**
         * Check if country is supported by twoinc
         *
         * @param $country
         *
         * @return bool
         */
        public static function is_country_supported($country)
        {
            return in_array($country, array('NO', 'GB'));
        }

        /**
         * Check if tax subtotals is required in twoinc order request body
         *
         * @return bool
         */
        public static function is_tax_subtotals_required_by_twoinc()
        {
            return strtolower(WC()->countries->get_base_country()) == 'se';
        }

        /**
         * Check if current server is twoinc development
         *
         * @return bool
         */
        public static function is_twoinc_development()
        {
            $hostname = str_replace(array('http://', 'https://'), '', get_home_url());

            // Local or configured in env var
            if (preg_match('/^localhost(?::[0-9]{1,5})?$/', $hostname) === 1) return true;
            $env_dev_hostnames = getenv('TWOINC_DEV_HOSTNAMES');
            if ($env_dev_hostnames && in_array($hostname, explode(',', $env_dev_hostnames))) return true;

            if (str_ends_with($hostname, "two.inc")) {
                // Production sites using two.inc subdomains
                $twoinc_prod_sites = '/^(?:www\.)?(?:(?:.+\.)?shop|tellit|iem|cubelighting|digg|morgenlevering|arkwrightx|kandidate|kandidate-internal)\.two\.inc$/';
                if (preg_match($twoinc_prod_sites, $hostname) === 1){
                    return false;
                } else {
                    return true;
                }
            }

            // Merchant's staging
            if (in_array($hostname, array('staging.torn.no', 'proof-3.redflamingostudio.com', 'icecreamextreme.no', 'www.staging83.avshop.no'))) return true;

            // Neither local nor twoinc development site
            return false;
        }

        /**
         * Get short locale, e.g. en_US to en
         *
         * @return string
         */
        public static function get_locale()
        {
            $locale = get_user_locale();
            if ($locale && strlen($locale) > 0) {
                return $locale;
            }
            return 'en_US';
        }

        /**
         * Recursively utf8 encode object
         *
         * @return array
         */
        public static function utf8ize($d) {
            if (is_array($d)) {
                foreach ($d as $k => $v) {
                    $d[$k] = WC_Twoinc_Helper::utf8ize($v);
                }
            } else if(is_object($d)) {
                foreach ($d as $k => $v) {
                    $d->$k = WC_Twoinc_Helper::utf8ize($v);
                }
            } else if (is_string($d)) {
                if (mb_detect_encoding($d, ['UTF-8'], true)) { // already in UTF-8
                    return $d;
                } else {
                    return utf8_encode($d);
                }
            }
            return $d;
        }

        /**
         * Get Order Unsecured Hash
         *
         * @param $obj
         *
         * @return string
         */
        public static function hash_order($order, $twoinc_meta) {
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
                '',
                true
            );
            return WC_Twoinc_Helper::hash_obj($twoinc_order);
        }

        /**
         * Get Unsecured Hash
         *
         * @param $obj
         *
         * @return string
         */
        public static function hash_obj($obj) {
            return md5(json_encode(WC_Twoinc_Helper::utf8ize($obj)));
        }

        /**
         * Recursively compare arrays
         *
         * @param $src_arr
         * @param $dst_arr
         *
         * @return array
         */
        public static function array_diff_r($src_arr, $dst_arr) {
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
         * Get product from a line item
         *
         * @param $line_item
         *
         * @return array
         */
        public static function get_product($line_item) {

            if(gettype($line_item) !== 'array' && get_class($line_item) === 'WC_Order_Item_Product') {
                /** @var WC_Product_Variation */
                //if ($line_item->get_product()->get_type() === 'variation') {
                //    return new WC_Product_Variation($line_item->get_product()->get_variation_id());
                //}
                /** @var WC_Order_Item_Product */
                return $line_item->get_product();
            } else {
                /** @var WC_Product_Simple */
                return $line_item['data'];
            }

        }

        /**
         * Get tax rate from a line item
         *
         * @param $line_item
         * @param $order
         *
         * @return array
         */
        private static function get_item_tax_rate($line_item, $order) {
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
         * Get tax rate element from a list of tax rate
         *
         * @param $tax_rate_list
         *
         * @return array
         */
        private static function get_tax_rate_from_tax_list($tax_rate_list) {
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
            } else if (count($no_zero_list) == 1) {
                // return the 1st element
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
