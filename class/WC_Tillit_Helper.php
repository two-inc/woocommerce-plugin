<?php

/**
 * Tillit Helper utilities
 *
 * @class WC_Tillit_Helper
 * @author Tillit
 */

class WC_Tillit_Helper
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
     * Get error message from tillit response
     *
     * @param $message
     *
     * @return string|void
     */
    public static function get_tillit_error_msg($response)
    {
        if (!$response) {
            return __('Tillit empty response', 'tillit-payment-gateway');
        }

        if($response['response']['code'] && $response['response'] && $response['response']['code'] && $response['response']['code'] >= 400) {
            return sprintf(__('Tillit response code %d', 'tillit-payment-gateway'), $response['response']['code']);
        }

        if($response && $response['body']) {
            $body = json_decode($response['body'], true);
            if (is_string($body))
                return __($body, 'tillit-payment-gateway');
            else if (isset($body['error_details']) && is_string($body['error_details']))
                return __($body['error_details'], 'tillit-payment-gateway');
            else if (isset($body['error_code']) && is_string($body['error_code']))
                return __($body['error_code'], 'tillit-payment-gateway');
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
        if (!is_string($message)) return;
        wc_add_notice($message, 'error');
        if (!wp_is_json_request()) {
            wc_print_notices();
        }
    }

    /**
     * Check if order is paid by tillit
     *
     * @param $order
     *
     * @return bool
     */
    public static function is_tillit_order($order)
    {
        return $order && $order->get_payment_method() && $order->get_payment_method() === 'woocommerce-gateway-tillit';
    }

    /**
     * Check if address json to send to Tillit is empty
     *
     * @param $tillit_address
     *
     * @return bool
     */
    public static function is_tillit_address_empty($tillit_address)
    {

        $is_empty = true;

        if ($tillit_address) {
            $is_empty = !$tillit_address['city'] && !$tillit_address['region'] && !$tillit_address['country']
                        && !$tillit_address['postal_code'] && !$tillit_address['street_address'];
        }

        return $is_empty;

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
        foreach($line_items as $line_item) {

            $product_simple = WC_Tillit_Helper::get_product($line_item);

            $tax_rate = WC_Tillit_Helper::get_item_tax_rate($line_item, $product_simple);

            $image_url = get_the_post_thumbnail_url($product_simple->get_id());

            $product = [
                'name' => $product_simple->get_name(),
                'description' => substr($product_simple->get_description(), 0, 255),
                'gross_amount' => strval(WC_Tillit_Helper::round_amt($line_item['line_total'] + $line_item['line_tax'])),
                'net_amount' =>  strval(WC_Tillit_Helper::round_amt($line_item['line_total'])),
                'discount_amount' => strval(WC_Tillit_Helper::round_amt($line_item['line_subtotal'] - $line_item['line_total'])),
                'tax_amount' => strval(WC_Tillit_Helper::round_amt($line_item['line_tax'])),
                'tax_class_name' => 'VAT ' . strval($tax_rate * 100) . '%',
                'tax_rate' => strval($tax_rate),
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
                            'id' => $product_simple->get_sku()
                        ]
                    ]
                ]
            ];

            $categories = wp_get_post_terms($product_simple->get_id(), 'product_cat');

            $product['details']['categories'] = [];

            foreach($categories as $category) {
                $product['details']['categories'][] = $category->name;
            }

            $items[] = $product;

        }

        // Shipping
        foreach($shippings as $shipping) {
            if ($shipping->get_total() == 0) continue;
            $tax_rate = WC_Tillit_Helper::get_shipping_tax_rate($shipping, $order);
            $shipping_line = [
                'name' => 'Shipping - ' . $shipping->get_name(),
                'description' => '',
                'gross_amount' => strval(WC_Tillit_Helper::round_amt($shipping->get_total() + $shipping->get_total_tax())),
                'net_amount' =>  strval(WC_Tillit_Helper::round_amt($shipping->get_total())),
                'discount_amount' => '0',
                'tax_amount' => strval(WC_Tillit_Helper::round_amt($shipping->get_total_tax())),
                'tax_class_name' => 'VAT ' . strval($tax_rate * 100) . '%',
                'tax_rate' => strval($tax_rate),
                'unit_price' => strval(WC_Tillit_Helper::round_amt($shipping->get_total())),
                'quantity' => 1,
                'quantity_unit' => 'sc', // shipment charge
                'image_url' => '',
                'product_page_url' => '',
                'type' => 'SHIPPING_FEE'
            ];

            $items[] = $shipping_line;
        }

        // Fee
        foreach($fees as $fee) {
            if ($fee->get_total() == 0) continue;
            $tax_rate = WC_Tillit_Helper::get_fee_tax_rate($fee, $order);
            $fee_line = [
                'name' => 'Fee - ' . $fee->get_name(),
                'description' => '',
                'gross_amount' => strval(WC_Tillit_Helper::round_amt($fee->get_total() + $fee->get_total_tax())),
                'net_amount' =>  strval(WC_Tillit_Helper::round_amt($fee->get_total())),
                'discount_amount' => '0',
                'tax_amount' => strval(WC_Tillit_Helper::round_amt($fee->get_total_tax())),
                'tax_class_name' => 'VAT ' . strval($tax_rate * 100) . '%',
                'tax_rate' => strval($tax_rate),
                'unit_price' => strval(WC_Tillit_Helper::round_amt($fee->get_total())),
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
     * Compose request body for tillit create order
     *
     * @param $order
     *
     * @return bool
     */
    public static function compose_tillit_order(
        $order, $order_reference, $days_on_invoice,
        $company_id, $department, $project, $product_type,
        $payment_reference_message = '', $tillit_original_order_id = '', $tracking_id = '')
    {

        $billing_address = [
            'organization_name' => $order->get_billing_company(),
            'street_address' => $order->get_billing_address_1() . (null !== $order->get_billing_address_2() ? $order->get_billing_address_2() : ''),
            'postal_code' => $order->get_billing_postcode(),
            'city' => $order->get_billing_city(),
            'region' => $order->get_billing_state(),
            'country' => $order->get_billing_country()
        ];
        $shipping_address = [
            'organization_name' => $order->get_billing_company(),
            'street_address' => $order->get_shipping_address_1() . (null !== $order->get_shipping_address_2() ? $order->get_shipping_address_2() : ''),
            'postal_code' => $order->get_shipping_postcode(),
            'city' => $order->get_shipping_city(),
            'region' => $order->get_shipping_state(),
            'country' => $order->get_shipping_country()
        ];
        if (WC_Tillit_Helper::is_tillit_address_empty($shipping_address)) {
            $shipping_address = $billing_address;
        }

        $req_body = [
            'currency' => $order->get_currency(),
            'gross_amount' => strval(WC_Tillit_Helper::round_amt($order->get_total())),
            'net_amount' => strval(WC_Tillit_Helper::round_amt($order->get_total() - $order->get_total_tax())),
            'tax_amount' => strval(WC_Tillit_Helper::round_amt($order->get_total_tax())),
            'tax_rate' => strval(WC_Tillit_Helper::round_rate(1.0 * $order->get_total_tax() / $order->get_total())),
            'discount_amount' => strval(WC_Tillit_Helper::round_amt($order->get_total_discount())),
            'discount_rate' => '0',
            'payment_type' => $product_type,
            'payment_details' => [
                'due_in_days' => intval($days_on_invoice),
                'payment_reference_message' => $payment_reference_message,
                'payment_reference_ocr' => ''
            ],
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
            'line_items' => WC_Tillit_Helper::get_line_items($order->get_items(), $order->get_items('shipping'), $order->get_items('fee'), $order),
            'recurring' => false,
            'merchant_additional_info' => '',
            'merchant_order_id' => strval($order->get_id()),
            'merchant_reference' => '',
            'merchant_urls' => [
                // 'merchant_confirmation_url' => $order->get_checkout_order_received_url(),
                'merchant_confirmation_url' => sprintf('%s?tillit_confirm_order=%s&nonce=%s',
                                                    wc_get_checkout_url(),
                                                    $order_reference,
                                                    wp_create_nonce('tillit_confirm')),
                'merchant_cancel_order_url' => wp_specialchars_decode($order->get_cancel_order_url()),
                'merchant_edit_order_url' => wp_specialchars_decode($order->get_edit_order_url()),
                'merchant_order_verification_failed_url' => '',
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

        if ($tillit_original_order_id) {
            $req_body['original_order_id'] = $tillit_original_order_id;
        }

        if ($tracking_id) {
            $req_body['tracking_id'] = $tracking_id;
        }

        return $req_body;
    }

    /**
     * Compose request body for tillit edit order
     *
     * @param $order
     *
     * @return bool
     */
    public static function compose_tillit_edit_order(
        $order, $days_on_invoice, $department, $project, $product_type, $payment_reference_message = '')
    {

        $billing_address = [
            'organization_name' => $order->get_billing_company(),
            'street_address' => $order->get_billing_address_1() . (null !== $order->get_billing_address_2() ? $order->get_billing_address_2() : ''),
            'postal_code' => $order->get_billing_postcode(),
            'city' => $order->get_billing_city(),
            'region' => $order->get_billing_state(),
            'country' => $order->get_billing_country()
        ];
        $shipping_address = [
            'organization_name' => $order->get_billing_company(),
            'street_address' => $order->get_shipping_address_1() . (null !== $order->get_shipping_address_2() ? $order->get_shipping_address_2() : ''),
            'postal_code' => $order->get_shipping_postcode(),
            'city' => $order->get_shipping_city(),
            'region' => $order->get_shipping_state(),
            'country' => $order->get_shipping_country()
        ];
        if (WC_Tillit_Helper::is_tillit_address_empty($shipping_address)) {
            $shipping_address = $billing_address;
        }

        $req_body = [
            'currency' => $order->get_currency(),
            'gross_amount' => strval(WC_Tillit_Helper::round_amt($order->get_total())),
            'net_amount' => strval(WC_Tillit_Helper::round_amt($order->get_total() - $order->get_total_tax())),
            'tax_amount' => strval(WC_Tillit_Helper::round_amt($order->get_total_tax())),
            'tax_rate' => strval(WC_Tillit_Helper::round_rate(1.0 * $order->get_total_tax() / $order->get_total())),
            'discount_amount' => strval(WC_Tillit_Helper::round_amt($order->get_total_discount())),
            'discount_rate' => '0',
            'payment_type' => $product_type,
            'payment_details' => [
                'due_in_days' => intval($days_on_invoice),
                'payment_reference_message' => $payment_reference_message,
                'payment_reference_ocr' => ''
            ],
            'buyer_department' => $department,
            'buyer_project' => $project,
            'order_note' => $order->get_customer_note(),
            'line_items' => WC_Tillit_Helper::get_line_items($order->get_items(), $order->get_items('shipping'), $order->get_items('fee'), $order),
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

        return $req_body;
    }

    /**
     * Compose request body for tillit create order
     *
     * @param $order
     *
     * @return bool
     */
    public static function compose_tillit_refund($order_refund, $amount, $currency, $initiate_payment_to_buyer)
    {

        $req_body = [
            'amount' => strval(WC_Tillit_Helper::round_amt($amount)),
            'currency' => $currency,
            'initiate_payment_to_buyer' => $initiate_payment_to_buyer,
            'line_items' => WC_Tillit_Helper::get_line_items($order_refund->get_items(), $order_refund->get_items('shipping'), $order_refund->get_items('fee'), $order_refund)
        ];

        return $req_body;
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
     * Check if current server is tillit development
     *
     * @return string
     */
    public static function is_tillit_development()
    {
        $hostname = str_replace(array('http://', 'https://'), '', get_home_url());

        // Local
        if (in_array($hostname, array('dev.tillitlocal.ai', 'localhost')) || substr($hostname, 0, 10) === 'localhost:') return true;

        // Production sites
        if (strlen($hostname) > 10 && substr($hostname, -10) === '.tillit.ai') {
            $tillit_prod_sites = array('shop', 'morgenlevering', 'arkwrightx', 'paguro');
            $host_prefix = substr($hostname, 0, -10);

            foreach($tillit_prod_sites as $tillit_prod_site) {
                if ($host_prefix === $tillit_prod_site || $host_prefix === ('www.' . $tillit_prod_site)) {
                    // Tillit site but not for development
                    return false;
                }
            }

            // Tillit development site
            return true;
        }

        // Merchant's staging
        if (in_array($hostname, array('staging.torn.no', 'proof-3.redflamingostudio.com'))) return true;

        // Neither local nor tillit development site
        return false;

    }

    /**
     * Get short locale, e.g. en_US to en
     *
     * @return string
     */
    public static function get_locale()
    {
        $locale = get_locale();
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
                $d[$k] = WC_Tillit_Helper::utf8ize($v);
            }
        } else if(is_object($d)) {
            foreach ($d as $k => $v) {
                $d->$k = WC_Tillit_Helper::utf8ize($v);
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
                    $sub_diff = WC_Tillit_Helper::array_diff_r($val, $dst_arr[$key]);
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
     * @param $product
     *
     * @return float
     */
    private static function get_item_tax_rate($line_item, $product) {
        if ($product->is_taxable() && $line_item['line_subtotal_tax'] != 0) {
            $tax_rates = WC_Tax::get_rates($product->get_tax_class());
            $tax_rate = array_shift($tax_rates);
            if (isset($tax_rate['rate'])) {
                return round($tax_rate['rate'] / 100, 3); // e.g. 0.125 for 12.5%
            }
        }
        return 0;
    }

    /**
     * Get tax rate from a shipping line
     *
     * @param $shipping
     * @param $order
     *
     * @return float
     */
    private static function get_shipping_tax_rate($shipping, $order) {
        $shipping_tax_rate = 0;
        if ($shipping->get_taxes()['total']) {
            foreach ($shipping->get_taxes()['total'] as $rate_id => $tax_amt) {
                foreach ($order->get_taxes() as $order_tax) {
                    if ($rate_id == $order_tax->get_rate_id()) {
                        $shipping_tax_rate += $order_tax->get_rate_percent();
                    }
                }
            }
        }
        return round($shipping_tax_rate / 100, 3);
    }

    /**
     * Get tax rate from a fee line
     *
     * @param $fee
     * @param $order
     *
     * @return float
     */
    private static function get_fee_tax_rate($fee, $order) {
        $fee_tax_rate = 0;
        if ($fee->get_taxes()['total']) {
            foreach ($fee->get_taxes()['total'] as $rate_id => $tax_amt) {
                foreach ($order->get_taxes() as $order_tax) {
                    if ($rate_id == $order_tax->get_rate_id()) {
                        $fee_tax_rate += $order_tax->get_rate_percent();
                    }
                }
            }
        }
        return round($fee_tax_rate / 100, 3);
    }

}
