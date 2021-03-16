<?php

/**
 * Tillit Gateway
 *
 * Provides integration between WooCommerce and Tillit
 *
 * @class WC_Tillit
 * @extends WC_Payment_Gateway
 * @version 0.0.1
 * @package WooCommerce/Classes/Payment
 * @author Dan
 */

class WC_Tillit extends WC_Payment_Gateway
{

    /**
     * WC_Tillit constructor.
     */

    public function __construct()
    {

        $this->id = 'woocommerce-gateway-tillit';
        $this->has_fields = false;
        // $this->order_button_text = __('Proceed to Tillit', 'woocommerce-gateway-tillit');
        $this->order_button_text = __('Place order', 'woocommerce-gateway-tillit');
        $this->method_title = __('Pay in 15 days with EHF invoice', 'woocommerce-gateway-tillit');
        $this->method_description = $this->generate_method_description();
        $this->icon = WC_HTTPS::force_https_url(WC_TILLIT_PLUGIN_URL . 'assets/images/logo.svg');
        $this->supports = ['products'];

        // Load the settings
        $this->init_form_fields();
        $this->init_settings();

        // Define user set variables
        $this->title = $this->get_option('title');
        $this->description = $this->get_option('description');
        $this->api_key = $this->get_option('api_key');

        // Actions
        add_action('woocommerce_update_options_payment_gateways_' . $this->id, [$this, 'process_admin_options']);
        add_action('woocommerce_order_status_processing', [$this, 'on_order_processing']);
        add_action('woocommerce_order_status_completed', [$this, 'on_order_completed']);

        // Custom fields
        add_action('woocommerce_admin_field_tillit_section_title', [$this, 'tillit_section_title']);

    }

    public function tillit_section_title($args)
    {
        var_dump($args); exit;
    }

    /**
     * Generate the payment method description
     *
     * @return string
     */

    private function generate_method_description()
    {
        return sprintf(
            '%s<br /><br />%s',
            __('Invoice will be sent to your email and accounting system if signed up for EHF.', 'woocommerce-gateway-tillit'),
            sprintf(
                '%s <a href="https://tillit.ai" target="_blank">%s</a>',
                __('Check', 'woocommerce-gateway-tillit'),
                __('personal information policy.', 'woocommerce-gateway-tillit')
            )
        );
    }

    /**
     * Update the order status
     *
     * @param $status
     * @param $order_id
     */

    private function update_order_status($status, $order_id)
    {
        // Get the order
        $order = wc_get_order($order_id);

        // Stop if no order found
        if(!$order) return;

        // Get the Tillit order ID
        $tillit_order_id = get_post_meta($order->get_id(), 'tillit_id', true);

        // Change the order status
        $response = $this->makeRequest("/order/${tillit_order_id}/${status}");

        if(is_wp_error($response)) {

            // Add the notice
            wc_add_notice(__('We couldn\'t update the Tillit Order status. Please try again later.', 'woocommerce-gateway-tillit'), 'error');

        }

    }

    /**
     * Notify Tillit API when the order status is processing
     *
     * @param $order_id
     */

    private function on_order_processing($order_id)
    {
        $this->update_order_status('shipped', $order_id);
    }

    /**
     * Notify Tillit API when the order status is completed
     *
     * @param $order_id
     */

    public function on_order_completed($order_id)
    {
        $this->update_order_status('delivered', $order_id);
    }

    /**
     * Register Admin form fields
     *
     * @return void
     */

    public function init_form_fields()
    {
        $this->form_fields = apply_filters('wc_tillit_form_fields', [
            'enabled' => [
                'title'     => __('Enable/Disable', 'woocommerce-gateway-tillit'),
                'type'      => 'checkbox',
                'label'     => __('Enable Tillit Payments', 'woocommerce-gateway-tillit'),
                'default'   => 'yes'
            ],
            'title' => [
                'title'         => __('Title', 'woocommerce-gateway-tillit'),
                'type'          => 'text',
                'description'   => __('This controls the title for the payment method the customer sees during checkout.', 'woocommerce-gateway-tillit'),
                'default'       => __('Pay with Tillit', 'woocommerce-gateway-tillit'),
                'desc_tip'      => true
            ],
            'description' => [
                'title'       => __('Description', 'woocommerce-gateway-tillit'),
                'type'        => 'textarea',
                'description' => __('Payment method description that the customer will see on your checkout.', 'woocommerce-gateway-tillit'),
                'default'     => __('Making b2b purchases a breeze.', 'woocommerce-gateway-tillit'),
                'desc_tip'    => true
            ],
            'tillit_merchant_id' => [
                'title'       => __('Tillit Merchant ID', 'woocommerce-gateway-tillit'),
                'type'        => 'text',
                'description' => __('Lorem ipsum dolor sit amet.', 'woocommerce-gateway-tillit')
            ],
            'api_key' => [
                'title'       => __('API Key', 'woocommerce-gateway-tillit'),
                'type'        => 'text',
                'description' => __('Lorem ipsum dolor sit amet.', 'woocommerce-gateway-tillit')
            ],
            // Settings
            'enable_company_name' => [
                'title'         => __('Activate company name auto-complete', 'woocommerce-gateway-tillit'),
                'label'         => __('Activate', 'woocommerce-gateway-tillit'),
                'type'          => 'checkbox',
                'description'   => __('Lorem ipsum dolor sit amet.', 'woocommerce-gateway-tillit')
            ],
            'enable_company_id' => [
                'title'         => __('Activate company org.id auto-complete', 'woocommerce-gateway-tillit'),
                'label'         => __('Activate', 'woocommerce-gateway-tillit'),
                'type'          => 'checkbox',
                'description'   => __('Lorem ipsum dolor sit amet.', 'woocommerce-gateway-tillit')
            ]
        ]);
    }

    /**
     * Make a request to Tillit API
     *
     * @param $endpoint
     * @param $payload
     *
     * @return WP_Error|array
     */

    private function makeRequest($endpoint, $payload = [])
    {
        return wp_remote_post(sprintf('%s%s', WC_TILLIT_URL, $endpoint), [
            'headers' => [
                'Content-Type' => 'application/json; charset=utf-8',
                'Tillit-Merchant-Id' => $this->get_option('tillit_merchant_id'),
                'Authorization' => sprintf('Basic %s', $this->get_option('api_key'))
            ],
            'timeout' => 30,
            'body' => json_encode($payload),
            'method' => 'POST',
            'data_format' => 'body'
        ]);
    }

    /**
     * Return the order items
     *
     * @param WC_Order|WC_Order_Refund $order
     *
     * @return array
     */

    private function get_items($order)
    {

        // For storing the order items
        $items = [];

        // For each item
        foreach($order->get_items() as $item_id => $item) {

            // Get the product data
            /** @var WC_Product $product */
            $product = $item->get_product();

            // Get the product image
            $productImage = wp_get_attachment_image_src($product->get_id(), 'full');

            // Get the tax rates
            $taxRates = WC_Tax::get_rates($product->get_tax_class());

            // True if we have a tax rate defined
            $withTaxRates = count($taxRates) > 0;

            $items[] = [
                'id' => $item->get_id(),
                'name' => $item->get_name(),
                'description' => $product->get_description(),
                'price' => $product->get_price(),
                'quantity' => $item->get_quantity(),
                'unit_price' => $product->get_price(),
                'tax_class_rate' => $withTaxRates ? $taxRates[1]['rate'] : false,
                'quantity_unit' => 'piece',
                'type' => '',
                'tax_class_name' => $withTaxRates ? $taxRates[1]['label'] : false,
                'image_url' => $productImage ? $productImage['url'] : null,
                'product_page_url' => get_permalink($product->get_id()),
                'details' => [
                    'brand' => '',
                    'categories' => [],
                    'barcodes' => [

                    ],
                    'part_number' => ''
                ]
            ];

        }

        // Return the items
        return $items;

    }

    /**
     * Process the payment
     *
     * @param int $order_id
     *
     * @return array
     */

    public function process_payment($order_id)
    {

        // Get the order
        $order = wc_get_order($order_id);

        // Get the orde taxes
        $orderTaxes = $order->get_taxes();

        // Get the taxes Ids
        $taxes = array_keys($orderTaxes);

        /** @var WC_Order_Item_Tax $vat */
        $vat = $orderTaxes[$taxes[0]];

        // Make the request
        $data = $this->makeRequest('/order', [
            'billing_address' => [
                'city' => $order->get_billing_city(),
                'country' => $order->get_billing_country(),
                'organization_name' => $order->get_billing_company(),
                'postal_code' => $order->get_billing_postcode(),
                'references' => [
                    'co' => 'MAKE IT OPTIONAL',
                    'reference' => 'MAKE IT OPTIONAL',
                    'attn' => 'MAKE IT OPTIONAL'
                ],
                'region' => $order->get_billing_state(),
                'street_address' => $order->get_billing_address_1()
            ],
            'buyer' => [
                'company' => [
                    'organization_number' => sanitize_text_field($_POST['company_id']),
                    'country_prefix' => $order->get_billing_country(),
                    'company_name' => $order->get_billing_company()
                ],
                'representative' => [
                    'email' => $order->get_billing_email(),
                    'first_name' => $order->get_billing_first_name(),
                    'last_name' => $order->get_billing_last_name(),
                    'phone_number' => $order->get_billing_phone(),
                    'phone_number_prefix' => 'MAKE IT OPTIONAL'
                ],
            ],
            'date_created' => '2021-04-20T10:10:10',
            'date_updated' => '2021-04-21T10:10:10',
            'line_items' => WC_Tillit_Checkout::get_line_items($order->get_items()),
            'recurring' => false,
            'merchant_additional_info' => 'lorem ipsum',
            'merchant_id' => $this->get_option('tillit_merchant_id'),
            'merchant_reference' => '45aa52f387871e3a210645d4',
            'merchant_urls' => [
                'merchant_confirmation_url' => $order->get_checkout_order_received_url(),
                'merchant_cancel_order_url' => $order->get_cancel_order_url(),
                'merchant_edit_order_url' => '',
                'merchant_order_verification_failed_url' => '',
                'merchant_invoice_url' => '',
                'merchant_shipping_document_url' => ''
            ],
            'merchant_reference' => '',
            'payment' => [
                'amount' => intval($order->get_subtotal() * 100),
                'currency' => 'NOK',
                'discount' => 0,
                'discount_percent' => 0,
                'type' => 'INVOICE',
                'payment_details' => [
                    'bank_account' => 'ROINGB 1234567890',
                    'bank_account_type' => 'IBAN',
                    'due_in_days' => 14,
                    'invoice_number' => '1234567890',
                    'payee_company_name' => 'Facebook',
                    'payee_organization_number' => '1234567890',
                    'payment_reference_message' => 'no message',
                    'payment_reference_ocr' => '456',
                ],
                'type' => 'MERCHANT_INVOICE',
                'vat' => intval($vat->get_tax_total() * 100),
                'vat_percent' => intval($vat->get_rate_percent() * 100)
            ],
            'shipping_address' => [
                'organization_name' => $order->get_billing_company(),
                'street_address' => $order->get_shipping_address_1(),
                'postal_code' => $order->get_shipping_postcode(),
                'city' => $order->get_shipping_city(),
                'region' => $order->get_shipping_state(),
                'country' => $order->get_shipping_country(),
                'references' => [
                    'co' => 'Company CEO',
                    'reference' => 'Firs floor office',
                    'attn' => 'jdifjsldf'
                ]
            ],
            'shipping_details' => [
                'carrier_name' => 'MAKE IT OPTIONAL',
                'tracking_number' => 'MAKE IT OPTIONAL',
                'expected_delivery_date' => '2021-01-31',
                'carrier_tracking_url' => 'MAKE IT OPTIONAL'
            ],
            'state' => 'PENDING',
            'status' => 'APPROVED',
            'tillit_urls' => [
                'event_log_url' => 'REMOVE THIS',
                'invoice_url' => 'REMOVE THIS',
                'verify_order_url' => 'REMOVE THIS'
            ]
        ]);

        // Stop on failure
        if(isset($data['result']) && $data['result'] === 'failure') return $data;

        // Parse the response
        $body = json_decode($data['body'], true);

        echo '<pre>';
        print_r($body);
        exit;

        // If we have an error
        if($data['response']['code'] === 400) {

            // Default errors
            $errors = [
                'app.shops.no_api_key' => __('We couldn\'t validate your API key. Make sure it\'s set and valid.', 'woocommerce-gateway-tillit'),
                'app.shops.none_or_not_active' => __('We couldn\'t find your shop in our system. Make sure the API key is valid.', 'woocommerce-gateway-tillit')
            ];

            // Add the notice
            wc_add_notice(isset($errors[$body['message']]) ? $errors[$body['message']] : $body['message'], 'error');

            // Return the error
            return [
                'result'    => 'failure',
                'messages'  => wc_print_notices(true)
            ];

        }

        // Reduce stock levels
        wc_reduce_stock_levels($order_id);

        // Remove cart
        WC()->cart->empty_cart();

        // Return the result
        return [
            'result'    => 'success',
            'redirect'  => $body['verify_order_url'],
        ];

    }

    /**
     * Approve the order
     *
     * @param $transaction_code
     * @param $order_id
     *
     * @return bool|void
     */

    public function approve_order($transaction_code, $order_id)
    {

        // Make the request
        $data = $this->makeRequest('/shops/order_status', [
            'transaction_code' => $transaction_code,
            'order_id' => $order_id
        ]);

        if($data['response']['code'] === 400) {

            // Add the notice
            wc_add_notice(__('We couldn\'t update the Tillit Order status. Please try again later.', 'woocommerce-gateway-tillit'), 'error');

            // Stop
            return;

        }

        // Get the body
        $body = json_decode($data['body'], true);

        // Get the order
        $order = wc_get_order($order_id);

        // Get transaction
        $transaction = $body['transaction'];

        // If transaction is approved
        if($transaction['transaction_status'] === 'approved'){

            // Mark order as completed
            $order->update_status('completed');

        }

        // Redirect user to success page
        wp_redirect($this->get_return_url($order));

        // Stop
        exit;

    }

}
