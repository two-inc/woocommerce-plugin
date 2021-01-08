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
        $this->form_fields = apply_filters('wc_offline_form_fields', [
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
            'api_key' => [
                'title'       => __('API Key', 'woocommerce-gateway-tillit'),
                'type'        => 'text',
                'description' => __('Enter the Tillit API Key. We\'re using this for security purposes.', 'woocommerce-gateway-tillit')
            ],
            'disable_company_name' => [
                'title'       => __('Disable Search API: Company name', 'woocommerce-gateway-tillit'),
                'type'        => 'checkbox',
                'description' => __('Disable autocompletion for the company name input.', 'woocommerce-gateway-tillit')
            ],
            'disable_company_address' => [
                'title'       => __('Disable Search API: Company address', 'woocommerce-gateway-tillit'),
                'type'        => 'checkbox',
                'description' => __('Disable autocompletion for the company address input.', 'woocommerce-gateway-tillit')
            ],
            'disable_order_intent' => [
                'title'       => __('Disable Order Intent', 'woocommerce-gateway-tillit'),
                'type'        => 'checkbox',
                'description' => __('Disable the order intent feature.', 'woocommerce-gateway-tillit')
            ],
            'disable_funded_invoice' => [
                'title'       => __('Disable Funded Invoice', 'woocommerce-gateway-tillit'),
                'type'        => 'checkbox',
                'description' => __('Disable the funded invoice feature.', 'woocommerce-gateway-tillit')
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

        /*// Get the API Key
        $apiKey = $this->get_option('api_key');

        // Stop if no API key
        if(!$apiKey) return [
            'result' => 'failure',
            'messages' => __('Tillit API key is missing.', 'woocommerce-gateway-tillit')
        ];*/

        // Add the API key
        $payload['api_key'] = 'Hello World';

        // Create the order and get the payment url
        return wp_remote_post(sprintf('%s%s', WC_TILLIT_URL, $endpoint), [
            'headers' => ['Content-Type' => 'application/json; charset=utf-8'],
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

        // For storing the items
        $items = [];

        // For each order item
        foreach($order->get_items() as $item_id => $item_data){

            // Get the product
            /** @var WC_Product $product */
            $product = $item_data->get_product();

            // Store the item data
            array_push($items, [
                'name' => $product->get_name(),
                'quantity' => $item_data->get_quantity(),
                'total' => $item_data->get_total()
            ]);

        }

        // Make the request
        $data = $this->makeRequest('/order', [
            'line_items' => $this->get_items($order),
            'state' => '',
            'recurring' => false,
            'buyer' => [
                'representative' => [
                    'first_name' => $order->get_billing_first_name(),
                    'last_name' => $order->get_billing_last_name(),
                    'phone_number' => $order->get_billing_phone(),
                    // @todo
                    'phone_number_prefix' => '',
                    'email' => $order->get_billing_email()
                ],
                'company' => [
                    'organization_number' => sanitize_text_field($_POST['company_id']),
                    'company_name' => $order->get_billing_company()
                ]
            ],
            'billing_address' => [
                // @todo
                'id' => '',
                'organization_name' => $order->get_billing_company(),
                'street_address' => $order->get_billing_address_1(),
                'postal_code' => $order->get_billing_postcode(),
                'city' => $order->get_billing_city(),
                'region' => $order->get_billing_state(),
                'country' => $order->get_billing_country(),
                'references' => [
                    // @todo
                    'co' => '',
                    // @todo
                    'reference' => '',
                    // @todo
                    'attn' => ''
                ]
            ],
            'shipping_address' => [
                // @todo
                'id' => '',
                'organization_name' => $order->get_billing_company(),
                'street_address' => $order->get_shipping_address_1(),
                'postal_code' => $order->get_shipping_postcode(),
                'city' => $order->get_shipping_city(),
                'region' => $order->get_shipping_state(),
                'country' => $order->get_shipping_country(),
                // @todo
                'references' => [
                    // @todo
                    'co' => '',
                    // @todo
                    'reference' => '',
                    // @todo
                    'attn' => ''
                ]
            ],
            // @todo
            'merchant_reference' => '',
            'merchant_additional_info' => $order->get_customer_order_notes(),
            // @todo
            'payment' => [
                // @todo
                'amount' => '',
                // @todo
                'currency' => '',
                // @todo
                'vat' => '',
                // @todo
                'discount' => '',
                // @todo
                'discount_percent' => '',
                // @todo
                'vat_percent' => '',
                // @todo
                'type' => 'INVOICE',
                // @todo
                'payment_details' => [
                    // @todo
                    'payment_reference_message' => '',
                    // @todo
                    'bank_account' => '',
                    // @todo
                    'bank_account_type' => '',
                    // @todo
                    'payment_reference_ocr' => '',
                    // @todo
                    'due_in_days' => '',
                    // @todo
                    'invoice_number' => ''
                ]
            ],
            'merchant_urls' => [
                'merchant_confirmation_url' => $order->get_checkout_order_received_url(),
                'merchant_cancel_order_url' => $order->get_cancel_order_url(),
                // @todo
                'merchant_edit_order_url' => '',
                // @todo
                'merchant_order_verification_failed_url' => '',
                // @todo
                'merchant_invoice_url' => '',
                // @todo
                'merchant_shipping_document_url' => ''

            ],
            'shipping_details' => [
                // @todo
                'tracking_number' => '',
                // @todo
                'carrier_name' => '',
                // @todo
                'expected_delivery_date' => '',
                // @todo
                'carrier_tracking_url' => ''
            ],
            // @todo
            'order_intent_id' => ''
        ]);

        // Stop on failure
        if(isset($data['result']) && $data['result'] === 'failure') return $data;

        // Parse the response
        $body = json_decode($data['body'], true);

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
            // 'redirect'  => $body['verify_order_url'],
            'redirect' => $this->get_return_url($order)
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
