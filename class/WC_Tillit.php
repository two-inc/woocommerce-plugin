<?php

/**
 * Tillit Gateway
 *
 * Provides integration between WooCommerce and Tillit
 *
 * @class WC_Tillit
 * @extends WC_Payment_Gateway
 * @package WooCommerce/Classes/Payment
 * @author Tillit
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
        $this->order_button_text = __('Place order', 'tillit-payment-gateway');
        $this->method_title = __('Tillit', 'tillit-payment-gateway');
        $this->method_description = __('Making it easy for businesses to buy online.', 'tillit-payment-gateway');
        $this->icon = WC_HTTPS::force_https_url(WC_TILLIT_PLUGIN_URL . 'assets/images/logo.svg');
        $this->supports = ['products', 'refunds'];

        // Load the settings
        $this->init_form_fields();
        $this->init_settings();

        // Define user set variables
        $this->title = sprintf(__($this->get_option('title'), 'tillit-payment-gateway'), strval($this->get_option('days_on_invoice')));
        $this->description = sprintf(
            '<p>%s <span class="tillit-buyer-name-placeholder">%s</span><span class="tillit-buyer-name"></span>.</p>',
            __('By completing the purchase, you verify that you have the legal right to purchase on behalf of', 'tillit-payment-gateway'),
            __('your company', 'tillit-payment-gateway')
        );
        $this->api_key = $this->get_option('api_key');

        // Tillit api host
        $this->tillit_search_host_no = 'https://no.search.tillit.ai';
        $this->tillit_search_host_gb = 'https://gb.search.tillit.ai';
        $this->tillit_checkout_host = $this->get_tillit_checkout_host();

        $this->plugin_version = get_plugin_version();

        global $tillit_payment_gateway;
        if (isset($tillit_payment_gateway)) {
            return;
        }

        add_action('woocommerce_update_options_payment_gateways_' . $this->id, [$this, 'process_admin_options']);
        if(!$this->get_option('api_key') || !$this->get_option('tillit_merchant_id')) {
            add_action('admin_notices', [$this, 'tillit_account_init_notice']);
            add_action('network_admin_notices', [$this, 'tillit_account_init_notice']);
        }
        if(!$this->get_option('api_key') || !$this->get_option('tillit_merchant_id') || sizeof($this->available_account_types()) == 0) return;
        add_action('woocommerce_order_status_completed', [$this, 'on_order_completed']);
        add_action('woocommerce_order_status_cancelled', [$this, 'on_order_cancelled']);
        add_action('woocommerce_cancelled_order', [$this, 'on_order_cancelled']);
        add_action('rest_api_init', [$this, 'plugin_status_checking']);
        add_action('woocommerce_before_checkout_form', [$this, 'process_confirmation']);
        add_action('woocommerce_update_options_checkout', [$this, 'update_checkout_options']);
        add_action('woocommerce_admin_order_data_after_order_details', [$this, 'add_invoice_credit_note_urls']);
        add_action('woocommerce_cart_calculate_fees', [$this, 'add_invoice_fees']);
        add_action('admin_enqueue_scripts', [$this, 'tillit_admin_scripts']);

        add_filter('acf/settings/remove_wp_meta_box', '__return_false');

        $tillit_payment_gateway = $this;
        new WC_Tillit_Checkout($this);

    }

    /**
     * Get tillit checkout host based on current settings
     */
    public function get_tillit_checkout_host(){
        if (WC_Tillit_Helper::is_tillit_development()) {
            return $this->get_option('test_checkout_host');
        } else if ($this->get_option('checkout_env') === 'SANDBOX') {
            return 'https://test.api.tillit.ai';
        } else {
            return 'https://api.tillit.ai';
        }
    }

    /**
     * Add filter to gateway payment title
     */
    public function change_tillit_payment_title(){
        add_filter('woocommerce_gateway_title', function ($title, $payment_id) {
            if($payment_id === 'woocommerce-gateway-tillit') {
                $title = sprintf(
                    '%s<div class="tillit-subtitle">%s</div> ',
                    sprintf(__($this->get_option('title'), 'tillit-payment-gateway'), strval($this->get_option('days_on_invoice'))),
                    __('Enter company name to pay on invoice', 'tillit-payment-gateway')
                );
            }
            return $title;
        }, 10, 2);
    }

    /**
     * Send the merchant logo to Tillit API
     *
     * @return void
     */
    public function update_checkout_options()
    {

        if(!isset($_POST['woocommerce_woocommerce-gateway-tillit_merchant_logo']) && !isset($_POST['woocommerce_woocommerce-gateway-tillit_tillit_merchant_id'])) return;

        $image_id = sanitize_text_field($_POST['woocommerce_woocommerce-gateway-tillit_merchant_logo']);
        $merchant_id = sanitize_text_field($_POST['woocommerce_woocommerce-gateway-tillit_tillit_merchant_id']);

        $image = $image_id ? wp_get_attachment_image_src($image_id, 'full') : null;
        $image_src = $image ? $image[0] : null;

        if(!$image_src) return;

        $this->make_request("/v1/merchant/${merchant_id}/update", [
            'logo_path' => $image_src
        ]);

    }

    /**
     * Add invoice and credit note URLs
     */
    public function add_invoice_credit_note_urls(){
        global $post;
        $order = wc_get_order($post->ID);

        if (!WC_Tillit_Helper::is_tillit_order($order)) {
            return;
        }

        if ($order->get_status() !== 'completed' && $order->get_status() !== 'refunded') {
            return;
        }

        $tillit_order_id = $order->get_meta('tillit_order_id');

        if ($tillit_order_id) {

            $order_refunds = $order->get_refunds();
            $has_tillit_refund = false;
            foreach($order_refunds as $refund){
                if ($refund->get_refunded_payment()) {
                    $has_tillit_refund = true;
                    break;
                }
            }

            print('<div style="margin-top:20px;float:left;">');

            if ($has_tillit_refund) {
                print('<a href="' . $this->tillit_checkout_host . "/v1/invoice/${tillit_order_id}/pdf?lang="
                      . WC_Tillit_Helper::get_locale()
                      . '"><button type="button" class="button">Download credit note</button></a><br><br>');
                print('<a href="' . $this->tillit_checkout_host . "/v1/invoice/${tillit_order_id}/pdf?v=original&lang="
                      . WC_Tillit_Helper::get_locale()
                      . '"><button type="button" class="button">Download original invoice</button></a>');
            } else {
                print('<a href="' . $this->tillit_checkout_host . "/v1/invoice/${tillit_order_id}/pdf?v=original&lang="
                      . WC_Tillit_Helper::get_locale()
                      . '"><button type="button" class="button">Download invoice</button></a>');
            }

            print('</div>');
        }
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

        wp_enqueue_script('tillit.admin', WC_TILLIT_PLUGIN_URL . '/assets/js/admin.js', ['jquery']);
        wp_enqueue_style('tillit.admin', WC_TILLIT_PLUGIN_URL . '/assets/css/admin.css');

    }

    /**
     * Notify Tillit API after order item update
     *
     * @param $order
     */
    public function after_order_item_update($order)
    {
        if (!WC_Tillit_Helper::is_tillit_order($order)) {
            return;
        }

        if (!isset($_POST) || !isset($_POST['action'])) {
            return;
        }
        $action = sanitize_text_field($_POST['action']);

        if ($action == 'woocommerce_add_order_item') {
            $order->calculate_totals(true);
            $this->update_tillit_order($order);
            WC_Tillit_Helper::append_admin_force_reload();
        } else if ($action == 'woocommerce_remove_order_item') {
            $this->update_tillit_order($order);
            WC_Tillit_Helper::append_admin_force_reload();
        } else if ($action == 'woocommerce_add_order_fee') {
            $this->update_tillit_order($order);
            WC_Tillit_Helper::append_admin_force_reload();
        } else if ($action == 'woocommerce_add_order_shipping') {
            $this->update_tillit_order($order);
            WC_Tillit_Helper::append_admin_force_reload();
        // } else if ($action == 'woocommerce_add_order_tax') {
        // } else if ($action == 'woocommerce_remove_order_tax') {
        } else if ($action == 'woocommerce_calc_line_taxes') {
            $this->update_tillit_order($order);
            WC_Tillit_Helper::append_admin_force_reload();
        }
    }

    /**
     * Before the order update by post.php
     *
     * @param $order_id
     * @param $items
     */
    public function before_order_update($post_id, $post)
    {

        if (!isset($_POST) || !isset($_POST['action']) || 'editpost' !== sanitize_text_field($_POST['action'])) return;

        $order = wc_get_order($post_id);
        if (!$order || !WC_Tillit_Helper::is_tillit_order($order)) {
            return;
        }

        $tillit_order_id = $order->get_meta('tillit_order_id');

        $tillit_meta = $this->get_save_tillit_meta($order);
        if (!$tillit_meta) return;

        $original_order = WC_Tillit_Helper::compose_tillit_order(
            $order,
            $tillit_meta['order_reference'],
            $tillit_meta['days_on_invoice'],
            $tillit_meta['company_id'],
            $tillit_meta['department'],
            $tillit_meta['project'],
            $tillit_meta['product_type'],
            $tillit_meta['payment_reference_message'],
            $tillit_meta['tillit_original_order_id'],
            ''
        );

        if (!property_exists($this, 'original_orders')) $this->original_orders = array();
        $this->original_orders[$order->get_id()] = $original_order;

    }

    /**
     * After the order update by post.php
     *
     * @param $order_id
     * @param $items
     */
    public function after_order_update($post_id, $post, $update, $post_before)
    {

        if (!isset($_POST) || !isset($_POST['action']) || 'editpost' !== sanitize_text_field($_POST['action'])) return;

        $order = wc_get_order($post_id);
        if ('shop_order' !== $post->post_type || !WC_Tillit_Helper::is_tillit_order($order)) {
            return;
        }

        if (!$this->original_orders || !$this->original_orders[$order->get_id()]) return;

        $tillit_order_id = $order->get_meta('tillit_order_id');

        $tillit_meta = $this->get_save_tillit_meta($order);
        if (!$tillit_meta) return;

        $updated_order = WC_Tillit_Helper::compose_tillit_order(
            $order,
            $tillit_meta['order_reference'],
            $tillit_meta['days_on_invoice'],
            $tillit_meta['company_id'],
            $tillit_meta['department'],
            $tillit_meta['project'],
            $tillit_meta['product_type'],
            $tillit_meta['payment_reference_message'],
            $tillit_meta['tillit_original_order_id'],
            ''
        );

        $diff = WC_Tillit_Helper::array_diff_r($this->original_orders[$order->get_id()], $updated_order);

        if ($diff) {

            $this->update_tillit_order($order);

        }

    }

    /**
     * Before item "Save" button
     *
     * @param $order_id
     * @param $items
     */
    public function before_order_item_save($order_id, $items)
    {

        $order = wc_get_order($order_id);
        if (!WC_Tillit_Helper::is_tillit_order($order)) {
            return;
        }

        $original_line_items = WC_Tillit_Helper::get_line_items($order->get_items(), $order->get_items('shipping'), $order->get_items('fee'), $order);

        if (!property_exists($this, 'order_line_items')) $this->order_line_items = array();
        $this->order_line_items[$order_id] = $original_line_items;

    }

    /**
     * After item "Save" button
     * Notify Tillit API after the order is updated
     *
     * @param $order_id
     * @param $items
     */
    public function after_order_item_save($order_id, $items)
    {

        $order = wc_get_order($order_id);
        if (!WC_Tillit_Helper::is_tillit_order($order)) {
            return;
        }

        $original_line_items = $this->order_line_items[$order_id];
        $updated_line_items = WC_Tillit_Helper::get_line_items($order->get_items(), $order->get_items('shipping'), $order->get_items('fee'), $order);
        $diff = WC_Tillit_Helper::array_diff_r($original_line_items, $updated_line_items);

        if ($diff) {

            $this->update_tillit_order($order);

            WC_Tillit_Helper::append_admin_force_reload();

        }
    }

    /**
     * Add invoice fee as a line item
     *
     * @param $order_id
     */
    function add_invoice_fees() {

        if ($this->get_option('invoice_fee_to_buyer') === 'yes' && 'woocommerce-gateway-tillit' === WC()->session->get('chosen_payment_method')) {
            global $woocommerce;

            if (is_admin() && ! defined('DOING_AJAX')) {
                return;
            }

            // Get invoice fixed fee
            $tillit_merchant_id = $this->get_option('tillit_merchant_id');
            $response = $this->make_request("/v1/merchant/${tillit_merchant_id}", [], 'GET');

            if(is_wp_error($response)) {
                WC()->session->set('chosen_payment_method', 'cod');
                return;
            }

            $tillit_err = WC_Tillit_Helper::get_tillit_error_msg($response);
            if ($tillit_err) {
                WC()->session->set('chosen_payment_method', 'cod');
                return;
            }

            $body = json_decode($response['body'], true);

            $invoice_fixed_fee = $body['fixed_fee_per_order'];

            //$invoice_percentage_fee = ($woocommerce->cart->cart_contents_total + $woocommerce->cart->tax_total + $woocommerce->cart->shipping_total + $woocommerce->cart->shipping_tax_total) * $percentage;
            $woocommerce->cart->add_fee('Invoice fee', $invoice_fixed_fee, false, '');
        }

    }

    /**
     * Notify Tillit API when the order status is completed
     *
     * @param $order_id
     */
    public function on_order_completed($order_id)
    {
        if($this->get_option('finalize_purchase') !== 'yes') {
            return;
        }

        // Get the order
        $order = wc_get_order($order_id);

        // Check payment method
        if (!WC_Tillit_Helper::is_tillit_order($order)) {
            return;
        }

        // Get the Tillit order ID
        $tillit_order_id = $order->get_meta('tillit_order_id');

        // Change the order status
        $response = $this->make_request("/v1/order/${tillit_order_id}/fulfilled");

        if(is_wp_error($response)) {
            $order->add_order_note(__('Could not update status', 'tillit-payment-gateway'));
            return;
        }

        $tillit_err = WC_Tillit_Helper::get_tillit_error_msg($response);
        if ($tillit_err) {
            $order->add_order_note(sprintf(__('Could not update status to fulfilled on Tillit, please check with Tillit admin for id %s', 'tillit-payment-gateway'), $tillit_order_id));
            return;
        }

        // Decode the response
        $body = json_decode($response['body'], true);

        // Save invoice number
        if ($body['invoice_details'] && $body['invoice_details']['invoice_number']) {
            update_post_meta($order->get_id(), 'invoice_number', $body['invoice_details']['invoice_number']);
        }

    }

    /**
     * Notify Tillit API when the order status is cancelled
     *
     * @param $order_id
     */
    public function on_order_cancelled($order_id)
    {
        // Get the order
        $order = wc_get_order($order_id);

        // Check payment method
        if (!WC_Tillit_Helper::is_tillit_order($order)) {
            return;
        }

        // Get the Tillit order ID
        $tillit_order_id = $order->get_meta('tillit_order_id');

        // Change the order status
        $response = $this->make_request("/v1/order/${tillit_order_id}/cancel");

        if(is_wp_error($response)) {
            $order->add_order_note(__('Could not update status to cancelled', 'tillit-payment-gateway'));
            return;
        }

        $tillit_err = WC_Tillit_Helper::get_tillit_error_msg($response);
        if ($tillit_err) {
            $order->add_order_note(sprintf(__('Could not update status to cancelled, please check with Tillit admin for id %s', 'tillit-payment-gateway'), $tillit_order_id));
            return;
        }

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

        // Check payment method
        if (!WC_Tillit_Helper::is_tillit_order($order)) {
            return;
        }

        // Genereate an order reference string
        $order_reference = wp_generate_password(64, false, false);

        // Store the order meta
        update_post_meta($order_id, '_tillit_order_reference', $order_reference);
        update_post_meta($order_id, '_tillit_merchant_id', $this->get_option('tillit_merchant_id'));
        update_post_meta($order_id, '_days_on_invoice', $this->get_option('days_on_invoice'));
        update_post_meta($order_id, 'company_id', sanitize_text_field($_POST['company_id']));
        update_post_meta($order_id, 'department', sanitize_text_field($_POST['department']));
        update_post_meta($order_id, 'project', sanitize_text_field($_POST['project']));

        // Get payment details
        $product_type = $this->get_option('product_type');
        $payment_reference_message = '';

        // Backward compatible
        if ($product_type === 'MERCHANT_INVOICE') {
            $product_type = 'DIRECT_INVOICE';
        }

        if ($product_type === 'DIRECT_INVOICE') {
            $payment_reference_message = strval($order->get_id());
        }

        update_post_meta($order_id, '_product_type', $product_type);
        update_post_meta($order_id, '_payment_reference_message', $payment_reference_message);

        // Create order
        $response = $this->make_request('/v1/order', WC_Tillit_Helper::compose_tillit_order(
            $order,
            $order_reference,
            $this->get_option('days_on_invoice'),
            sanitize_text_field($_POST['company_id']),
            sanitize_text_field($_POST['department']),
            sanitize_text_field($_POST['project']),
            $product_type,
            $payment_reference_message,
            '',
            sanitize_text_field($_POST['tracking_id'])
        ));

        if(is_wp_error($response)) {
            $order->add_order_note(__('Could not request to create tillit order', 'tillit-payment-gateway'));
            return;
        }

        // Stop on process payment failure
        if(isset($response) && isset($response['result']) && $response['result'] === 'failure') {
            $order->add_order_note(__('Fail to process payment', 'tillit-payment-gateway'));
            return $response;
        }

        $tillit_err = WC_Tillit_Helper::get_tillit_error_msg($response);
        if ($tillit_err) {
            WC_Tillit_Helper::display_ajax_error(__('Invoice is not available for this purchase', 'tillit-payment-gateway'));
            return;
        }

        // Decode the response
        $body = json_decode($response['body'], true);

        // Store the Tillit Order Id for future use
        update_post_meta($order_id, 'tillit_order_id', $body['id']);
        update_post_meta($order_id, '_tillit_original_order_id', $body['id']);

        // Return the result
        if ($this->get_option('tillit_merchant_id') === 'morgenlevering' || $this->get_option('tillit_merchant_id') === 'arkwrightx') {
            return [
                'result'    => 'success',
                'redirect' => $body['merchant_urls']['merchant_confirmation_url']
            ];
        } else {
            return [
                'result'    => 'success',
                'redirect'  => $body['payment_url']
            ];
        }

    }

    /**
     * Process the order refund
     *
     * @return void
     */

    public function process_refund($order_id, $amount = null, $reason = '') {

        $order = wc_get_order($order_id);

        // Check payment method
        if (!WC_Tillit_Helper::is_tillit_order($order)) {
            return;
        }

        // Get the Tillit order ID
        $tillit_order_id = $order->get_meta('tillit_order_id');

        // Get and check refund data
        if ($order->get_status() !== 'completed') {
            return new WP_Error('invalid_tillit_refund',
                __('Only Completed order can be refunded by Tillit', 'tillit-payment-gateway'));
        }

        $order_refunds = $order->get_refunds();
        foreach($order_refunds as $refund){
            if (!$order_refund || $refund->get_date_created() > $order_refund->get_date_created()) {
                $order_refund = $refund;
            }
        }

        if (!$order_refund || !$tillit_order_id || !$amount) {
            return new WP_Error('invalid_tillit_refund',
                __('Could not initiate refund by Tillit', 'tillit-payment-gateway'));
        }

        // Send refund request
        $response = $this->make_request(
            "/v1/order/${tillit_order_id}/refund",
            WC_Tillit_Helper::compose_tillit_refund(
                $order_refund,
                -$amount,
                $order->get_currency(),
                $this->get_option('initiate_payment_to_buyer_on_refund') === 'yes'
            ),
            'POST'
        );

        // Stop if request error
        if(is_wp_error($response)) {
            $order->add_order_note(__('Failed to request refund order to Tillit', 'tillit-payment-gateway'));
            return false;
        }

        $tillit_err = WC_Tillit_Helper::get_tillit_error_msg($response);
        if ($tillit_err) {
            $order->add_order_note(sprintf(__('Failed to request refund order to Tillit, please check with Tillit admin for id %s', 'tillit-payment-gateway'), $tillit_order_id));
            return new WP_Error('invalid_tillit_refund',
                __('Request refund order to Tillit has errors', 'tillit-payment-gateway'));
        }

        // Decode the response
        $body = json_decode($response['body'], true);

        // Check if response is ok
        if (!$body['amount']) {
            $order->add_order_note(sprintf(__('Failed to refund order by Tillit, please check with Tillit admin for id %s', 'tillit-payment-gateway'), $tillit_order_id));
            return new WP_Error('invalid_tillit_refund',
                __('Failed to refund order by Tillit', 'tillit-payment-gateway'));
        }

        return [
            'result'    => 'success',
            'refresh'  => true
        ];

    }

    /**
     * Process the order confirmation
     *
     * @return void
     */
    public function process_confirmation()
    {

        // Stop if no Tillit order reference and no nonce
        if(!isset($_REQUEST['tillit_confirm_order']) || !isset($_REQUEST['nonce'])) return;

        // Get the order reference
        $order_reference = sanitize_text_field($_REQUEST['tillit_confirm_order']);

        // Get the nonce
        $nonce = $_REQUEST['nonce'];

        // Stop if the code is not valid
        if(!wp_verify_nonce($nonce, 'tillit_confirm')) wp_die(__('The security code is not valid.', 'tillit-payment-gateway'));

        /** @var wpdb $wpdb */
        global $wpdb;

        $sql = $wpdb->prepare("SELECT post_id FROM $wpdb->postmeta WHERE meta_key = %s AND meta_value = %s", '_tillit_order_reference', $order_reference);
        $row = $wpdb->get_row($sql , ARRAY_A);

        // Stop if no order found
        if(!isset($row['post_id'])) wp_die(__('Unable to find the requested order', 'tillit-payment-gateway'));

        // Get the order ID
        $order_id = $row['post_id'];

        // Get the order object
        $order = new WC_Order($order_id);

        // Check payment method
        if (!WC_Tillit_Helper::is_tillit_order($order)) {
            return;
        }

        // Get the Tillit order ID
        $tillit_order_id = get_post_meta($order_id, 'tillit_order_id', true);
        // $tillit_order_id = $order->get_meta('tillit_order_id');

        // Get the Tillit order details
        $response = $this->make_request("/v1/order/${tillit_order_id}", [], 'GET');

        // Stop if request error
        if(is_wp_error($response)) {
            $order->add_order_note(__('Unable to retrieve the order information', 'tillit-payment-gateway'));
            wp_die(__('Unable to retrieve the order information', 'tillit-payment-gateway'));
        }

        $tillit_err = WC_Tillit_Helper::get_tillit_error_msg($response);
        if ($tillit_err) {
            $order->add_order_note(__('Unable to retrieve the order payment information', 'tillit-payment-gateway'));
            wp_die(__('Unable to retrieve the order payment information', 'tillit-payment-gateway'));
        }

        // Decode the response
        $body = json_decode($response['body'], true);

        // Get the order state
        $state = $body['state'];

        if($state === 'VERIFIED') {

            // Mark order as processing
            $order->payment_complete();

            // Redirect the user to confirmation page
            wp_redirect(wp_specialchars_decode($order->get_checkout_order_received_url()));

        } else {

            // Redirect the user to Woocom cancellation page
            wp_redirect(wp_specialchars_decode($order->get_cancel_order_url()));

        }

    }

    /**
     * Return the status of the plugin
     *
     * @return void
     */
    public function plugin_status_checking()
    {
        register_rest_route(
            'tillit-payment-gateway',
            'tillit_plugin_status_checking',
            array(
                'methods' => 'GET',
                'callback' => function($request) {
                    return [
                        'version' => $this->plugin_version
                    ];
                },
            )
        );
    }

    /**
     * Setup Tillit settings
     *
     * @return void
     */
    public function one_click_setup()
    {

        // Stop if this is not setup request
        if(strtok($_SERVER["REQUEST_URI"], '?s') !== '/tillit-payment-gateway/init' || !isset($_REQUEST['m']) || !isset($_REQUEST['k']) || !isset($_REQUEST['t']) || !isset($_REQUEST['c'])) return;

        if (!current_user_can('manage_options')) {
            $redirect_to_signin = wp_login_url() . '?redirect_to=' . urlencode($_SERVER["REQUEST_URI"]);
            $error = new WP_Error(
                'init_failed',
                sprintf(
                    __('Wordpress admin privilege is required for Tillit payment One-click setup. %s', 'tillit-payment-gateway'),
                    sprintf('<a href="%s">» %s</a>', $redirect_to_signin, __('Log in', 'tillit-payment-gateway'))
                ),
                array('title' => _('Tillit payment setup failure'), 'response' => '401', 'back_link' => false));
            if(is_wp_error($error)){
                wp_die($error, '', $error->get_error_data());
            }
        }

        // Get the id and token to send to Tillit
        $merchant_id = sanitize_text_field($_REQUEST['m']);
        $tillit_init_tk = sanitize_text_field($_REQUEST['k']);
        $site_type = sanitize_text_field($_REQUEST['t']);
        $tillit_checkout_host = sanitize_text_field($_REQUEST['c']);

        if ($site_type === 'WOOCOMMERCE') {
            $params = [
                'm' => $merchant_id,
                'k' => $tillit_init_tk,
                't' => $site_type,
            ];
            $response = wp_remote_request(sprintf('%s%s?%s', $tillit_checkout_host, '/v1/portal/merchant/ocs', http_build_query($params)), [
                'method' => 'GET',
                'timeout' => 30,
                'body' => '',
                'data_format' => 'body'
            ]);

            $body = json_decode($response['body'], true);
            if ($response['response']['code'] === 200 && $body && $body['merchant_secret_api_key']) {
                $this->update_option('tillit_merchant_id', $body['merchant_short_name']);
                $this->update_option('api_key', $body['merchant_secret_api_key']);
                if (isset($body['enabled'])) $this->update_option('enabled', $body['enabled'] ? 'yes' : 'no');
                if (isset($body['title'])) $this->update_option('title', $body['title']);
                if (isset($body['subtitle'])) $this->update_option('subtitle', $body['subtitle']);
                if (isset($body['checkout_personal'])) $this->update_option('checkout_personal', $body['checkout_personal'] ? 'yes' : 'no');
                if (isset($body['checkout_sole_trader'])) $this->update_option('checkout_sole_trader', $body['checkout_sole_trader'] ? 'yes' : 'no');
                if (isset($body['checkout_business'])) $this->update_option('checkout_business', $body['checkout_business'] ? 'yes' : 'no');
                if (isset($body['product_type'])) $this->update_option('product_type', $body['product_type']);
                if (isset($body['days_on_invoice'])) $this->update_option('days_on_invoice', $body['days_on_invoice']);
                if (isset($body['display_other_payments'])) $this->update_option('display_other_payments', $body['display_other_payments'] ? 'yes' : 'no');
                if (isset($body['fallback_to_another_payment'])) $this->update_option('fallback_to_another_payment', $body['fallback_to_another_payment'] ? 'yes' : 'no');
                if (isset($body['enable_company_name'])) $this->update_option('enable_company_name', $body['enable_company_name'] ? 'yes' : 'no');
                if (isset($body['enable_company_id'])) $this->update_option('enable_company_id', $body['enable_company_id'] ? 'yes' : 'no');
                if (isset($body['finalize_purchase'])) $this->update_option('finalize_purchase', $body['finalize_purchase'] ? 'yes' : 'no');
                if (isset($body['mark_tillit_fields_required'])) $this->update_option('mark_tillit_fields_required', $body['mark_tillit_fields_required'] ? 'yes' : 'no');
                if (isset($body['enable_order_intent'])) $this->update_option('enable_order_intent', $body['enable_order_intent'] ? 'yes' : 'no');
                if (isset($body['default_to_b2c'])) $this->update_option('default_to_b2c', $body['default_to_b2c'] ? 'yes' : 'no');
                if (isset($body['invoice_fee_to_buyer'])) $this->update_option('invoice_fee_to_buyer', $body['invoice_fee_to_buyer'] ? 'yes' : 'no');
                if (isset($body['initiate_payment_to_buyer_on_refund'])) $this->update_option('initiate_payment_to_buyer_on_refund', $body['initiate_payment_to_buyer_on_refund'] ? 'yes' : 'no');
                if (isset($body['clear_options_on_deactivation'])) $this->update_option('clear_options_on_deactivation', $body['clear_options_on_deactivation'] ? 'yes' : 'no');
                if (WC_Tillit_Helper::is_tillit_development()) {
                    $this->update_option('test_checkout_host', $tillit_checkout_host);
                } else if (strpos($tillit_checkout_host, 'test.api.tillit.ai') !== false) {
                    $this->update_option('checkout_env', 'SANDBOX');
                } else {
                    $this->update_option('checkout_env', 'PROD');
                }

                // Init done
                $error = new WP_Error(
                    'init_ok',
                    sprintf(
                        'Successfully setup Tillit payment! Go to %s.',
                        sprintf('<a href="%s">%s</a>', get_dashboard_url(), __('Dashboard', 'tillit-payment-gateway'))
                    ),
                    array('title' => _('Tillit payment setup success'), 'response' => '200', 'back_link' => false));
                wp_die($error, '', $error->get_error_data());
            } else if ($response['response']['code'] === 400) {
                // Link expired or max attempts reached or wrong key
                $error = new WP_Error(
                    'init_failed',
                    sprintf(
                        'Magic setup link already used or expired, please contact %s for more information!',
                        sprintf('<a href="https://tillit.ai/">%s</a>', __('Tillit', 'tillit-payment-gateway'))
                    ),
                    array('title' => _('Tillit payment setup failure'), 'response' => '400', 'back_link' => false));
                wp_die($error, '', $error->get_error_data());
            }
        }

        // Other errors
        $error = new WP_Error(
            'init_failed',
            sprintf(
                'Could not setup Tillit payment on your website, please contact %s for more information!',
                sprintf('<a href="https://tillit.ai/">%s</a>', __('Tillit', 'tillit-payment-gateway'))
            ),
            array('title' => _('Tillit payment setup failure'), 'response' => '400', 'back_link' => false));
        wp_die($error, '', $error->get_error_data());

    }

    /**
     * Get customer types enabled in admin settings
     */
    public function available_account_types()
    {

        $available_types = [];

        if ($this->get_option('checkout_personal') === 'yes') {
            $available_types['personal'] = __('Personal', 'tillit-payment-gateway');
        }

        if ($this->get_option('checkout_sole_trader') === 'yes') {
            $available_types['sole_trader'] = __('Sole trader/other', 'tillit-payment-gateway');
        }

        if ($this->get_option('checkout_business') === 'yes') {
            $available_types['business'] = __('Business', 'tillit-payment-gateway');
        }

        return $available_types;

    }

    /**
     * Register Admin form fields
     *
     * @return void
     */
    public function init_form_fields()
    {
        $tillit_form_fields = [
            'enabled' => [
                'title'     => __('Enable/Disable', 'tillit-payment-gateway'),
                'type'      => 'checkbox',
                'label'     => __('Enable Tillit Payments', 'tillit-payment-gateway'),
                'default'   => 'yes'
            ],
            'title' => [
                'title'     => __('Title', 'tillit-payment-gateway'),
                'type'      => 'text',
                'default'   => __('Business invoice %s days', 'tillit-payment-gateway')
            ],
            'subtitle' => [
                'title'     => __('Subtitle', 'tillit-payment-gateway'),
                'type'      => 'text',
                'default'   => __('Receive the invoice via PDF and email', 'tillit-payment-gateway')
            ],
            'tillit_merchant_id' => [
                'title'     => __('Tillit Merchant ID', 'tillit-payment-gateway'),
                'type'      => 'text'
            ],
            'api_key' => [
                'title'     => __('API Key', 'tillit-payment-gateway'),
                'type'      => 'password'
            ],
            'merchant_logo' => [
                'title'     => __('Logo', 'tillit-payment-gateway'),
                'type'      => 'logo'
            ],
            'section_title_checkout_for' => [
                'type'      => 'separator',
                'title'     => __('Enable checkout for', 'tillit-payment-gateway')
            ],
            'checkout_personal' => [
                'title'     => __('Personal', 'tillit-payment-gateway'),
                'label'     => ' ',
                'type'      => 'checkbox',
                'default'   => 'yes'
            ],
            'checkout_sole_trader' => [
                'title'     => __('Sole trader/other', 'tillit-payment-gateway'),
                'label'     => ' ',
                'type'      => 'checkbox'
            ],
            'checkout_business' => [
                'title'     => __('Business', 'tillit-payment-gateway'),
                'label'     => ' ',
                'type'      => 'checkbox',
                'default'   => 'yes'
            ],
            'section_title_product' => [
                'type'      => 'separator',
                'title'     => __('Choose your product', 'tillit-payment-gateway')
            ],
            'product_type' => [
                'type'      => 'select',
                'title'     => __('Choose your product', 'tillit-payment-gateway'),
                'default'   => 'FUNDED_INVOICE',
                'options'   => array(
                      'FUNDED_INVOICE' => 'Funded Invoice',
                      'DIRECT_INVOICE' => 'Direct Invoice'
                 )
            ],
            'days_on_invoice' => [
                'title'     => __('Number of days on invoice', 'tillit-payment-gateway'),
                'type'      => 'text',
                'default'   => '14'
            ],
            'section_title_settings' => [
                'type'      => 'separator',
                'title'     => __('Settings', 'tillit-payment-gateway')
            ],
            'test_checkout_host' => [
                'type'      => 'text',
                'title'     => __('Tillit Test Server', 'tillit-payment-gateway'),
                'default'   => 'https://staging.api.tillit.ai'
            ],
            'checkout_env' => [
                'type'      => 'select',
                'title'     => __('Choose your settings', 'tillit-payment-gateway'),
                'default'   => 'Production',
                'options'   => array(
                      'PROD'     => 'Production',
                      'SANDBOX'  => 'Sandbox'
                 )
            ],
            'display_other_payments' => [
                'title'     => __('Always enable all available payment methods', 'tillit-payment-gateway'),
                'label'     => ' ',
                'type'      => 'checkbox',
                'default'   => 'yes'
            ],
            'fallback_to_another_payment' => [
                'title'     => __('Fallback to other payment methods if Tillit is not available', 'tillit-payment-gateway'),
                'label'     => ' ',
                'type'      => 'checkbox',
                'default'   => 'yes'
            ],
            'enable_company_name' => [
                'title'     => __('Activate company name auto-complete', 'tillit-payment-gateway'),
                'label'     => ' ',
                'type'      => 'checkbox'
            ],
            'enable_company_id' => [
                'title'     => __('Activate company org.id auto-complete', 'tillit-payment-gateway'),
                'label'     => ' ',
                'type'      => 'checkbox'
            ],
            'finalize_purchase' => [
                'title'     => __('Finalize purchase when order is fulfilled', 'tillit-payment-gateway'),
                'label'     => ' ',
                'type'      => 'checkbox'
            ],
            'mark_tillit_fields_required' => [
                'title'     => __('Always mark Tillit fields as required', 'tillit-payment-gateway'),
                'label'     => ' ',
                'type'      => 'checkbox',
                'default'   => 'yes'
            ],
            'enable_order_intent' => [
                'title'     => __('Pre-approve the buyer during checkout and disable Tillit if the buyer is declined', 'tillit-payment-gateway'),
                'label'     => ' ',
                'type'      => 'checkbox',
                'default'   => 'yes'
            ],
            'default_to_b2c' => [
                'title'     => __('Default to B2C check-out', 'tillit-payment-gateway'),
                'label'     => ' ',
                'type'      => 'checkbox'
            ],
            'invoice_fee_to_buyer' => [
                'title'     => __('Shift invoice fee to the buyers', 'tillit-payment-gateway'),
                'label'     => ' ',
                'type'      => 'checkbox'
            ],
            'initiate_payment_to_buyer_on_refund' => [
                'title'     => __('Initiate payment to buyer on refund', 'tillit-payment-gateway'),
                'label'     => ' ',
                'type'      => 'checkbox',
                'default'   => 'yes'
            ],
            'clear_options_on_deactivation' => [
                'title'     => __('Clear settings on deactivation', 'tillit-payment-gateway'),
                'label'     => ' ',
                'type'      => 'checkbox',
                'default'   => 'yes'
            ]
        ];

        if (WC_Tillit_Helper::is_tillit_development()) {
            unset($tillit_form_fields['checkout_env']);
        } else {
            unset($tillit_form_fields['test_checkout_host']);
        }

        $this->form_fields = apply_filters('wc_tillit_form_fields', $tillit_form_fields);
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
        $field_key = $this->get_field_key($key);
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

        $data = wp_parse_args($data, $defaults);

        if (! $data['label']) {
            $data['label'] = $data['title'];
        }

        ob_start();
        ?>
        <tr valign="top">
            <td class="forminp" colspan="2">
                <fieldset>
                    <legend class="screen-reader-text"><span><?php echo wp_kses_post($data['title']); ?></span></legend>
                    <label for="<?php echo esc_attr($field_key); ?>">
                        <input <?php disabled($data['disabled'], true); ?> class="<?php echo esc_attr($data['class']); ?>" type="radio" name="<?php echo esc_attr($field_key); ?>" id="<?php echo esc_attr($field_key); ?>" style="<?php echo esc_attr($data['css']); ?>" value="1" <?php checked($data['checked'] === true, true); ?> <?php echo $this->get_custom_attribute_html($data); // WPCS: XSS ok. ?> /> <?php echo wp_kses_post($data['label']); ?></label><br/>
                    <?php echo $this->get_description_html($data); // WPCS: XSS ok. ?>
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
                    <button class="button-secondary woocommerce-tillit-logo" type="button"><?php _e('Select image', 'tillit-payment-gateway'); ?></button>
                </fieldset>
            </td>
        </tr>
        <?php
        return ob_get_clean();
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
     * Get tillit meta from DB and Tillit server
     *
     * @param $order
     */
    private function get_save_tillit_meta($order)
    {

        $tillit_order_id = $order->get_meta('tillit_order_id');
        if (!$tillit_order_id) {
            return;
        }
        $tillit_original_order_id = $order->get_meta('_tillit_original_order_id');
        if (!$tillit_original_order_id) {
            $tillit_original_order_id = $tillit_order_id;
            update_post_meta($order->get_id(), '_tillit_original_order_id', $tillit_original_order_id);
        }

        $order_reference = $order->get_meta('_tillit_order_reference');
        $tillit_merchant_id = $order->get_meta('_tillit_merchant_id');
        if (!$tillit_merchant_id) {
            $tillit_merchant_id = $this->get_option('tillit_merchant_id');
            update_post_meta($order->get_id(), '_tillit_merchant_id', $tillit_merchant_id);
        }
        $days_on_invoice = $order->get_meta('_days_on_invoice');
        if (!$days_on_invoice) {
            $days_on_invoice = $this->get_option('days_on_invoice');
            update_post_meta($order->get_id(), '_days_on_invoice', $days_on_invoice);
        }

        $product_type = $order->get_meta('_product_type');
        $payment_reference_message = '';

        if (!$product_type) {
            $product_type = 'FUNDED_INVOICE'; // First product type as default for older orders
            update_post_meta($order->get_id(), '_product_type', $product_type);
        }
        if ($product_type === 'DIRECT_INVOICE') {
            $payment_reference_message = strval($order->get_id());
        }

        $company_id = $order->get_meta('company_id');
        if ($company_id) {
            $department = $order->get_meta('department');
            $project = $order->get_meta('project');
        } else {
            $response = $this->make_request("/v1/order/${tillit_order_id}", [], 'GET');

            $body = json_decode($response['body'], true);
            if (!$body || !$body['buyer'] || !$body['buyer']['company'] || !$body['buyer']['company']['organization_number']) {
                $order->add_order_note(sprintf(__('Missing company ID, please check with Tillit admin for id %s', 'tillit-payment-gateway'), $tillit_order_id));
                return;
            }
            $company_id = $body['buyer']['company']['organization_number'];
            $department = $body['buyer_department'];
            $project = $body['buyer_project'];
            update_post_meta($order->get_id(), 'company_id', $company_id);
            update_post_meta($order->get_id(), 'department', $department);
            update_post_meta($order->get_id(), 'project', $project);
        }

        return array(
            'order_reference' => $order_reference,
            'tillit_merchant_id' => $tillit_merchant_id,
            'days_on_invoice' => $days_on_invoice,
            'company_id' => $company_id,
            'department' => $department,
            'project' => $project,
            'tillit_order_id' => $tillit_order_id,
            'tillit_original_order_id' => $tillit_original_order_id,
            'product_type' => $product_type,
            'payment_reference_message' => $payment_reference_message
        );

    }

    /**
     * Run the update execution
     *
     * @param $order
     */
    private function update_tillit_order($order)
    {

        $tillit_order_id = $order->get_meta('tillit_order_id');


        // 1. Get information from the current order
        $tillit_meta = $this->get_save_tillit_meta($order);
        if (!$tillit_meta) return;


        // 2. Edit the order
        $response = $this->make_request("/v1/order/${tillit_order_id}", WC_Tillit_Helper::compose_tillit_edit_order(
                $order,
                $tillit_meta['days_on_invoice'],
                $tillit_meta['department'],
                $tillit_meta['project'],
                $tillit_meta['product_type'],
                $tillit_meta['payment_reference_message']
            ),
            'PUT'
        );

        if(is_wp_error($response)) {
            $order->add_order_note(__('Could not edit the Tillit order', 'tillit-payment-gateway'));
            return;
        }

        $tillit_err = WC_Tillit_Helper::get_tillit_error_msg($response);
        if ($tillit_err) {
            $order->add_order_note(__('Could not edit the Tillit order, please check with Tillit admin', 'tillit-payment-gateway'));
            return;
        }

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
    private function make_request($endpoint, $payload = [], $method = 'POST', $params = array())
    {
        $params['client'] = 'wp';
        $params['client_v'] = $this->plugin_version;
        return wp_remote_request(sprintf('%s%s?%s', $this->tillit_checkout_host, $endpoint, http_build_query($params)), [
            'method' => $method,
            'headers' => [
                'Accept-Language' => WC_Tillit_Helper::get_locale(),
                'Content-Type' => 'application/json; charset=utf-8',
                'X-API-Key' => $this->get_option('api_key')
            ],
            'timeout' => 30,
            'body' => empty($payload) ? '' : json_encode($payload),
            'data_format' => 'body'
        ]);
    }

    /**
     * Display admin banner notice for tillit account setup
     *
     * @return void
     */
    public function tillit_account_init_notice(){
        global $pagenow;
        if ($pagenow !== 'options-general.php') {
            echo '
            <div id="tillit-account-init-notice" class="notice notice-info is-dismissible" style="background-color: #e2e0ff;padding: 20px;display: flex;">
                <div style="width:60%;padding-right:40px;">
                    <h1 style="color: #000000;font-weight:700;">Set up your Tillit account</h1>
                    <p style="color: #000000;font-size: 1.3em;text-align: justify;">Happy to see you here! Before you can start selling with the Tillit buy now, pay later solution you need to complete our signup process. It\'s easy, fast and gives you immediate access to the <a target="_blank" href="https://portal.tillit.ai/merchant">Tillit Merchant Portal</a></p>
                </div>
                <div>
                    <img style="position: absolute;top: 40px;right: 40px;width: 100px;" src="/wp-content/plugins/tillit-payment-gateway/assets/images/logo.svg">
                    <div style="position: absolute;bottom: 20px;right:40px;">
                        <a href="#" id="dismiss-tillit-notice" class="button" style="margin-left: 20px;background: none;font-size: 1.1em;font-weight: 600;color: #3e16a2;padding: 7px 30px;border-color: #3e16a2;border-radius: 12px;">Not now, thanks</a>
                        <a href="https://portal.tillit.ai/merchant" target="_blank" class="button" style="margin-left: 20px;background: #3e16a2;font-size: 1.1em;font-weight: 600;color: #ffffff;padding: 7px 30px;border-color: #3e16a2;border-radius: 12px;">Set up my account</a>
                    </div>
                </div>
            </div>

            <script type="text/javascript">
                jQuery(document).ready(function($){
                    jQuery("#dismiss-tillit-notice").click(function(){
                        jQuery("#tillit-account-init-notice").slideUp();
                    });
                });
            </script>
            ';
        }
    }

    /**
     * On deactivating the plugin
     *
     * @return void
     */
    public function on_deactivate_plugin()
    {
        if($this->get_option('clear_options_on_deactivation') === 'yes') {
            delete_option('woocommerce_woocommerce-gateway-tillit_settings');
        }
    }

}
