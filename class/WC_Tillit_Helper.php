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
     * @return float
     */
    public static function round_amt($amt)
    {
        return number_format($amt, wc_get_price_decimals(), '.', '');
    }

    /**
     * Return the tax rate
     *
     * @param WC_Product_Simple|WC_Order_Item_Product $product_simple
     *
     * @return int|mixed
     */
    public static function get_tax_percentage($product_simple)
    {
        $tax_rates = WC_Tax::get_rates($product_simple->get_tax_class());
        return $tax_rates && $tax_rates[1] ? $tax_rates[1]['rate'] : 0;
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
     * Format the cart items
     *
     * @return array
     */
    public static function get_line_items($line_items, $shippings, $fees)
    {

        $items = [];

        /** @var WC_Order_Item_Product $line_item */
        foreach($line_items as $line_item) {

            if(gettype($line_item) !== 'array' && get_class($line_item) === 'WC_Order_Item_Product') {
                /** @var WC_Order_Item_Product */
                $product_simple = $line_item->get_product();
            } else {
                /** @var WC_Product_Simple */
                $product_simple = $line_item['data'];
            }

            $tax_rate = 0;
            if ($line_item['line_tax'] && $line_item['line_total']) {
                $tax_rate = 1.0 * $line_item['line_tax'] / $line_item['line_total'];
            }

            $image_url = get_the_post_thumbnail_url($product_simple->get_id());

            $product = [
                'name' => $product_simple->get_name(),
                'description' => substr($product_simple->get_description(), 0, 255),
                'gross_amount' => strval(WC_Tillit_Helper::round_amt($line_item['line_total'] + $line_item['line_tax'])),
                'net_amount' =>  strval(WC_Tillit_Helper::round_amt($line_item['line_total'])),
                'discount_amount' => strval(WC_Tillit_Helper::round_amt($line_item['line_subtotal'] - $line_item['line_total'])),
                'tax_amount' => strval(WC_Tillit_Helper::round_amt($line_item['line_tax'])),
                'tax_class_name' => 'VAT ' . WC_Tillit_Helper::round_amt($tax_rate * 100) . '%',
                'tax_rate' => strval($tax_rate),
                'unit_price' => strval(WC_Tillit_Helper::round_amt(wc_get_price_excluding_tax($product_simple))),
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
            $tax_rate = 1.0 * $shipping->get_total_tax() / $shipping->get_total();
            $shipping_line = [
                'name' => 'Shipping - ' . $shipping->get_name(),
                'description' => '',
                'gross_amount' => strval(WC_Tillit_Helper::round_amt($shipping->get_total() + $shipping->get_total_tax())),
                'net_amount' =>  strval(WC_Tillit_Helper::round_amt($shipping->get_total())),
                'discount_amount' => '0',
                'tax_amount' => strval(WC_Tillit_Helper::round_amt($shipping->get_total_tax())),
                'tax_class_name' => 'VAT ' . WC_Tillit_Helper::round_amt($tax_rate * 100) . '%',
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
            $tax_rate = 1.0 * $fee->get_total_tax() / $fee->get_total();
            $fee_line = [
                'name' => 'Fee - ' . $fee->get_name(),
                'description' => '',
                'gross_amount' => strval(WC_Tillit_Helper::round_amt($fee->get_total() + $fee->get_total_tax())),
                'net_amount' =>  strval(WC_Tillit_Helper::round_amt($fee->get_total())),
                'discount_amount' => '0',
                'tax_amount' => strval(WC_Tillit_Helper::round_amt($fee->get_total_tax())),
                'tax_class_name' => 'VAT ' . WC_Tillit_Helper::round_amt($tax_rate * 100) . '%',
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
        $order, $order_reference, $tillit_merchant_id, $days_on_invoice,
        $company_id, $department, $project, $tillit_original_order_id = '',
        $tracking_id = '')
    {
        // Get the orde taxes
        $order_taxes = $order->get_taxes();

        // Get the taxes Ids
        $taxes = array_keys($order_taxes);

        if (count($taxes) == 0) {
            $tax_amount = 0;
            $tax_rate = 0;
        } else {
            /** @var WC_Order_Item_Tax $vat */
            $vat = $order_taxes[$taxes[0]];
            $tax_amount = $vat->get_tax_total() + $vat->get_shipping_tax_total();
            $tax_rate = $vat->get_rate_percent() / 100.0;
        }

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
            'line_items' => WC_Tillit_Helper::get_line_items($order->get_items(), $order->get_items('shipping'), $order->get_items('fee')),
            'recurring' => false,
            'merchant_additional_info' => '',
            'merchant_id' => $tillit_merchant_id,
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
            'payment' => [
                'currency' => $order->get_currency(),
                'gross_amount' => strval(WC_Tillit_Helper::round_amt($order->get_total())),
                'net_amount' => strval(WC_Tillit_Helper::round_amt($order->get_total() - $order->get_total_tax())),
                'tax_amount' => strval(WC_Tillit_Helper::round_amt($tax_amount)),
                'tax_rate' => strval($tax_rate),
                'discount_amount' => strval(WC_Tillit_Helper::round_amt($order->get_total_discount())),
                'discount_rate' => '0',
                'type' => 'FUNDED_INVOICE',
                'payment_details' => [
                    'due_in_days' => intval($days_on_invoice),
                    'bank_account' => '',
                    'bank_account_type' => 'IBAN',
                    'payee_company_name' => '',
                    'payee_organization_number' => '',
                    'payment_reference_message' => '',
                    'payment_reference_ocr' => '',
                ]
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
    public static function compose_tillit_edit_order($order, $days_on_invoice, $department, $project)
    {
        // Get the orde taxes
        $order_taxes = $order->get_taxes();

        // Get the taxes Ids
        $taxes = array_keys($order_taxes);

        if (count($taxes) == 0) {
            $tax_amount = 0;
            $tax_rate = 0;
        } else {
            /** @var WC_Order_Item_Tax $vat */
            $vat = $order_taxes[$taxes[0]];
            $tax_amount = $vat->get_tax_total() + $vat->get_shipping_tax_total();
            $tax_rate = $vat->get_rate_percent() / 100.0;
        }

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
            'buyer_department' => $department,
            'buyer_project' => $project,
            'order_note' => $order->get_customer_note(),
            'line_items' => WC_Tillit_Helper::get_line_items($order->get_items(), $order->get_items('shipping'), $order->get_items('fee')),
            'recurring' => false,
            'merchant_additional_info' => '',
            'merchant_reference' => '',
            'payment' => [
                'currency' => $order->get_currency(),
                'gross_amount' => strval(WC_Tillit_Helper::round_amt($order->get_total())),
                'net_amount' => strval(WC_Tillit_Helper::round_amt($order->get_total() - $order->get_total_tax())),
                'tax_amount' => strval(WC_Tillit_Helper::round_amt($tax_amount)),
                'tax_rate' => strval($tax_rate),
                'discount_amount' => strval(WC_Tillit_Helper::round_amt($order->get_total_discount())),
                'discount_rate' => '0',
                'type' => 'FUNDED_INVOICE',
                'payment_details' => [
                    'due_in_days' => intval($days_on_invoice),
                    'bank_account' => '',
                    'bank_account_type' => 'IBAN',
                    'payee_company_name' => '',
                    'payee_organization_number' => '',
                    'payment_reference_message' => '',
                    'payment_reference_ocr' => '',
                ]
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
            'line_items' => WC_Tillit_Helper::get_line_items($order_refund->get_items(), $order_refund->get_items('shipping'), $order_refund->get_items('fee'))
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
     * Get default environment id
     *
     * @return string
     */
    public static function get_default_env()
    {
        $hostname = str_replace(array('http://', 'https://'), '', get_home_url());

        if (in_array($hostname, array('staging.demo.tillit.ai'))) return 'stg';
        else if (in_array($hostname, array('demo.tillit.ai'))) return 'demo';
        else if (in_array($hostname, array('dev.tillitlocal.ai', 'localhost')) || substr($hostname, 0, 10) === 'localhost:') return 'dev';
        else return 'prod';
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

}
