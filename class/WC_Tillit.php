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
        $this->method_title = __('Tillit', 'woocommerce-gateway-tillit');
        $this->method_description = __('Making it easy for businesses to buy online.', 'woocommerce-gateway-tillit');
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
        add_action('woocommerce_order_status_completed', [$this, 'on_order_completed']);
        add_action('admin_enqueue_scripts', [$this, 'tillit_admin_scripts']);
        add_action('woocommerce_update_options_checkout', [$this, 'update_checkout_options']);

        // Process confirmation
        add_action('get_header', [$this, 'process_confirmation']);

    }

    /**
     * Generate the section title
     *
     * @param $field_id
     * @param $field_args
     *
     * @return string
     */

    public function generate_separator_html($field_id, $field_args)
    {
        ob_start();
        ?>
        <tr valign="top">
            <th colspan="2">
                <h3 style="margin-bottom: 0;"><?php echo $field_args['title']; ?></h3>
            </th>
        </tr>
        <?php
        return ob_get_clean();
    }

    /**
     * Generate a radio input
     *
     * @param $key
     * @param $data
     *
     * @return false|string
     */

    public function generate_radio_html($key, $data)
    {
        $field_key = $this->get_field_key( $key );
        $defaults  = array(
            'title'             => '',
            'label'             => '',
            'disabled'          => false,
            'class'             => '',
            'css'               => '',
            'type'              => 'text',
            'desc_tip'          => false,
            'description'       => '',
            'custom_attributes' => array(),
            'checked'           => false
        );

        $data = wp_parse_args( $data, $defaults );

        if ( ! $data['label'] ) {
            $data['label'] = $data['title'];
        }

        ob_start();
        ?>
        <tr valign="top">
            <td class="forminp" colspan="2">
                <fieldset>
                    <legend class="screen-reader-text"><span><?php echo wp_kses_post( $data['title'] ); ?></span></legend>
                    <label for="<?php echo esc_attr( $field_key ); ?>">
                        <input <?php disabled( $data['disabled'], true ); ?> class="<?php echo esc_attr( $data['class'] ); ?>" type="radio" name="<?php echo esc_attr( $field_key ); ?>" id="<?php echo esc_attr( $field_key ); ?>" style="<?php echo esc_attr( $data['css'] ); ?>" value="1" <?php checked($data['checked'] === true, true); ?> <?php echo $this->get_custom_attribute_html( $data ); // WPCS: XSS ok. ?> /> <?php echo wp_kses_post( $data['label'] ); ?></label><br/>
                    <?php echo $this->get_description_html( $data ); // WPCS: XSS ok. ?>
                </fieldset>
            </td>
        </tr>
        <?php

        return ob_get_clean();

    }

    public function generate_logo_html($field_key, $data)
    {
        $image_id = $this->get_option($field_key);
        $image = $image_id ? wp_get_attachment_image_src($image_id, 'full') : null;
        $image_src = $image ? $image[0] : null;
        ob_start();
        ?>
        <tr valign="top">
            <th scope="row" class="titledesc">
                <label for="<?php echo esc_attr($field_key); ?>"><?php echo wp_kses_post($data['title']); ?></label>
            </th>
            <td class="forminp">
                <fieldset>
                    <input type="hidden" name="woocommerce_woocommerce-gateway-tillit_<?php echo $field_key; ?>" id="<?php echo esc_attr($field_key); ?>" class="logo_id" value="<?php echo $image_id; ?>" />
                    <div class="image-container woocommerce-tillit-image-container">
                        <?php if($image_src): ?>
                            <img src="<?php echo $image_src; ?>" alt="" />
                        <?php endif; ?>
                    </div>
                    <button class="button-secondary woocommerce-tillit-logo" type="button"><?php _e('Select image', 'woocommerce-gateway-tillit'); ?></button>
                </fieldset>
            </td>
        </tr>
        <?php
        return ob_get_clean();
    }

    /**
     * Generate the payment method description
     *
     * @return string
     */

    private function generate_method_description()
    {
        return sprintf(
            '<p>%s</p><p>%s</p><p>%s</p>',
            __('Receive your order first. Payment period up to 45 days', 'woocommerce-gateway-tillit'),
            __('All invoices are sent both a PDF and e-invoice', 'woocommerce-gateway-tillit'),
            sprintf(
                '%s <a href="https://tillit.ai/privacy-policy" target="_blank">%s</a>.',
                __('By paying with Tillit you agree with our', 'woocommerce-gateway-tillit'),
                __('Terms and conditions', 'woocommerce-gateway-tillit')
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
        $tillit_order_id = get_post_meta($order->get_id(), 'tillit_order_id', true);

        // Change the order status
        $response = $this->makeRequest("/v1/order/${tillit_order_id}/${status}");

        if(is_wp_error($response)) {

            // Add the notice
            wc_add_notice(__('We couldn\'t update the Tillit Order status. Please try again later.', 'woocommerce-gateway-tillit'), 'error');

        }

    }

    /**
     * Notify Tillit API when the order status is completed
     *
     * @param $order_id
     */

    public function on_order_completed($order_id)
    {
        if($this->get_option('finalize_purchase') === 'yes') {
            $this->update_order_status('shipped', $order_id);
        }
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
                'default'       => __('Pay in 15 days with invoice', 'woocommerce-gateway-tillit')
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
                'type'        => 'text'
            ],
            'api_key' => [
                'title'       => __('API Key', 'woocommerce-gateway-tillit'),
                'type'        => 'text',
            ],
            'merchant_logo' => [
                'title'         => __('Logo', 'woocommerce-gateway-tillit'),
                'type'          => 'logo'
            ],
            'section_title_product' => [
                'type' => 'separator',
                'title' => __('Choose your product', 'woocommerce-gateway-tillit')
            ],
            'product_funded' => [
                'type' => 'radio',
                'name' => 'product_type',
                'disabled' => true,
                'label' => __('Funded invoice (coming soon)', 'woocommerce-gateway-tillit')
            ],
            'product_administered' => [
                'type' => 'radio',
                'name' => 'product_type',
                'disabled' => true,
                'label' => __('Administered invoice (coming soon)', 'woocommerce-gateway-tillit')
            ],
            'product_merchant' => [
                'type' => 'radio',
                'name' => 'product_type',
                'label' => __('Merchant Invoice', 'woocommerce-gateway-tillit'),
                'checked' => true
            ],
            'bank_account_number' => [
                'title' => __('Bank account number', 'woocommerce-gateway-tillit'),
                'type' => 'text',
            ],
            'iban' => [
                'title' => __('IBAN', 'woocommerce-gateway-tillit'),
                'type' => 'text',
            ],
            'days_on_invoice' => [
                'title' => __('Number of days on invoice', 'woocommerce-gateway-tillit'),
                'type' => 'text',
            ],
            'section_title_settings' => [
                'type' => 'separator',
                'title' => __('Settings', 'woocommerce-gateway-tillit')
            ],
            'enable_company_name' => [
                'title'         => __('Activate company name auto-complete', 'woocommerce-gateway-tillit'),
                'label'         => ' ',
                'type'          => 'checkbox',
            ],
            'enable_company_id' => [
                'title'         => __('Activate company org.id auto-complete', 'woocommerce-gateway-tillit'),
                'label'         => ' ',
                'type'          => 'checkbox',
            ],
            'finalize_purchase' => [
                'title'         => __('Finalize purchase when order is shipped', 'woocommerce-gateway-tillit'),
                'label'         => ' ',
                'type'          => 'checkbox',
            ]
        ]);
    }

    /**
     * Make a request to Tillit API
     *
     * @param $endpoint
     * @param $payload
     * @param string $method
     *
     * @return WP_Error|array
     */

    private function makeRequest($endpoint, $payload = [], $method = 'POST')
    {
        return wp_remote_request(sprintf('%s%s', WC_TILLIT_URL, $endpoint), [
            'method' => $method,
            'headers' => [
                'Content-Type' => 'application/json; charset=utf-8',
                'Tillit-Merchant-Id' => $this->get_option('tillit_merchant_id'),
                'Authorization' => sprintf('Basic %s', $this->get_option('api_key'))
            ],
            'timeout' => 30,
            'body' => empty($payload) ? '' : json_encode($payload),
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

        // Genereate an order reference string
        $order_reference = wp_generate_password(64, false, false);

        // Store the order reference
        update_post_meta($order_id, '_tillit_order_reference', $order_reference);

        // Make the request
        $data = $this->makeRequest('/v1/order', [
            'billing_address' => [
                'city' => $order->get_billing_city(),
                'country' => $order->get_billing_country(),
                'organization_name' => $order->get_billing_company(),
                'postal_code' => $order->get_billing_postcode(),
                'region' => $order->get_billing_state(),
                'street_address' => $order->get_billing_address_1() . (null !== $order->get_billing_address_2() ? $order->get_billing_address_2() : '')
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
                    'phone_number' => $order->get_billing_phone()
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
                // 'merchant_confirmation_url' => $order->get_checkout_order_received_url(),
                'merchant_confirmation_url' => sprintf('%s?tillit_confirm_order=%s&nonce=%s', get_site_url(), $order_reference, wp_create_nonce('tillit_confirm')),
                'merchant_cancel_order_url' => $order->get_cancel_order_url(),
                'merchant_edit_order_url' => '',
                'merchant_order_verification_failed_url' => '',
                'merchant_invoice_url' => '',
                'merchant_shipping_document_url' => ''
            ],
            'merchant_reference' => '',
            'payment' => [
                'amount' => intval($order->get_total() * 10000),
                'currency' => 'NOK',
                'discount' => 0,
                'discount_percent' => 0,
                'type' => 'INVOICE',
                'payment_details' => [
                    'bank_account' => $this->get_option('bank_account_number'),
                    'bank_account_type' => 'IBAN',
                    'due_in_days' => intval($this->get_option('days_on_invoice')),
                    'invoice_number' => '1234567890',
                    'payee_company_name' => $order->get_billing_company(),
                    'payee_organization_number' => sanitize_text_field($_POST['company_id']),
                    'payment_reference_message' => 'no message',
                    'payment_reference_ocr' => '456',
                ],
                'type' => 'MERCHANT_INVOICE',
                'vat' => intval($vat->get_tax_total() * 10000),
                'vat_percent' => intval($vat->get_rate_percent() * 100)
            ],
            'shipping_address' => [
                'organization_name' => $order->get_billing_company(),
                'street_address' => $order->get_shipping_address_1(),
                'postal_code' => $order->get_shipping_postcode(),
                'city' => $order->get_shipping_city(),
                'region' => $order->get_shipping_state(),
                'country' => $order->get_shipping_country()
            ],
            'shipping_details' => [
                // 'carrier_name' => '',
                // 'tracking_number' => '',
                // 'carrier_tracking_url' => '',
                'expected_delivery_date' => '2021-01-31'
            ],
            'state' => 'UNVERIFIED',
            'status' => 'APPROVED'
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
            if (property_exists($body, 'message'))
                wc_add_notice(isset($errors[$body['message']]) ? $errors[$body['message']] : $body['message'], 'error');
            else
                wc_add_notice($body, 'error');

            // Return the error
            return [
                'result'    => 'failure',
                'messages'  => wc_print_notices(true)
            ];

        }

        // Store the Tillit Order Id for future use
        update_post_meta($order_id, 'tillit_order_id', $body['id']);

        // Remove cart
        WC()->cart->empty_cart();

        // Return the result
        return [
            'result'    => 'success',
            'redirect'  => sprintf('%s%s', WC_TILLIT_URL, $body['tillit_urls']['verify_order_url']),
        ];

    }

    /**
     * Send the merchant logo to Tillit API
     *
     * @return void
     */

    public function update_checkout_options()
    {

        if(!isset($_POST['woocommerce_woocommerce-gateway-tillit_merchant_logo']) && !isset($_POST['woocommerce_woocommerce-gateway-tillit_tillit_merchant_id'])) return;

        $image_id = $_POST['woocommerce_woocommerce-gateway-tillit_merchant_logo'];
        $merchant_id = $_POST['woocommerce_woocommerce-gateway-tillit_tillit_merchant_id'];

        $image = $image_id ? wp_get_attachment_image_src($image_id, 'full') : null;
        $image_src = $image ? $image[0] : null;

        if(!$image_src) return;

        $this->makeRequest(sprintf('/v1/merchant/%s/update', $merchant_id), [
            'merchant_id' => $merchant_id,
            'logo_path' => $image_src
        ]);

    }

    /**
     * Process the order confirmation
     *
     * @return void
     */

    public function process_confirmation()
    {

        // Stop if no Tillit order reference and no nonce
        if(!isset($_REQUEST['tillit_confirm_order']) && !isset($_REQUEST['nonce'])) return;

        // Get the order reference
        $order_reference = sanitize_text_field($_REQUEST['tillit_confirm_order']);

        // Get the nonce
        $nonce = $_REQUEST['nonce'];

        // Stop if the code is not valid
        if(!wp_verify_nonce($nonce, 'tillit_confirm')) wp_die(__('The security code is not valid.', 'woocommerce-gateway-tillit'));

        /** @var wpdb $wpdb */
        global $wpdb;

        $sql = $wpdb->prepare("SELECT post_id FROM $wpdb->postmeta WHERE meta_key = %s AND meta_value = %s", '_tillit_order_reference', $order_reference);
        $row = $wpdb->get_row($sql , ARRAY_A);

        // Stop if no order found
        if(!isset($row['post_id'])) wp_die(__('Unable to find the requested order.', 'woocommerce-gateway-tillit'));

        // Get the order ID
        $order_id = $row['post_id'];

        // Get the order object
        $order = new WC_Order($order_id);

        // Get the Tillit order ID
        $tillitOrderId = get_post_meta($order_id, 'tillit_order_id', true);

        // Get the Tillit order details
        $response = $this->makeRequest(sprintf('/v1/order/%s', $tillitOrderId), [], 'GET');

        // Stop if request error
        if(is_wp_error($response)) wp_die(__('Unable to retrieve the order information.', 'woocommerce-gateway-tillit'));

        // Decode the response
        $body = json_decode($response['body'], true);

        // Get the order state
        $state = $body['state'];

        // Mark order as processing
        if($state === 'VERIFIED') $order->update_status('processing');

        // Get the redirect URL by order state
        $redirect = $state === 'VERIFIED' ? $order->get_checkout_order_received_url() : $order->get_cancel_order_url();

        // Redirec the user to the requested page
        wp_redirect($redirect);

    }

    /**
     * Enqueue the admin scripts
     *
     * @return void
     */

    public function tillit_admin_scripts()
    {

        if (!did_action('wp_enqueue_media')) {
            wp_enqueue_media();
        }

        wp_enqueue_script( 'tillit.admin', WC_TILLIT_PLUGIN_URL . '/assets/js/admin.js', ['jquery']);
        wp_enqueue_style( 'tillit.admin', WC_TILLIT_PLUGIN_URL . '/assets/css/admin.css');

    }

}
