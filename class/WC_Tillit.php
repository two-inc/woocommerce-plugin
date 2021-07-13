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
        // $this->order_button_text = __('Proceed to Tillit', 'tillit-payment-gateway');
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
            '<p>%s <span class="tillit-buyer-name"></span>.</p>',
            __('By completing the purchase, you verify that you have the legal right to purchase on behalf of', 'tillit-payment-gateway')
        );
        $this->api_key = $this->get_option('api_key');

        // Tillit api host
        $checkout_env = $this->get_option('checkout_env');
        $this->tillit_search_host_no = 'https://no.search.tillit.ai';
        $this->tillit_search_host_gb = 'https://gb.search.tillit.ai';
        $this->tillit_checkout_host = $checkout_env == 'prod' ? 'https://api.tillit.ai'
                                    : ($checkout_env == 'demo' ? 'https://demo.api.tillit.ai'
                                    : ($checkout_env == 'dev' ? 'https://huynguyen.hopto.org:8083'
                                    : 'https://staging.api.tillit.ai'));

        global $tillit_payment_gateway;
        if (isset($tillit_payment_gateway)) {
            return;
        }

        add_action('woocommerce_update_options_payment_gateways_' . $this->id, [$this, 'process_admin_options']);
        if(!$this->get_option('api_key') || !$this->get_option('tillit_merchant_id')) return;
        add_action('woocommerce_order_status_completed', [$this, 'on_order_completed']);
        add_action('woocommerce_order_status_cancelled', [$this, 'on_order_cancelled']);
        add_action('woocommerce_cancelled_order', [$this, 'on_order_cancelled']);
        add_action('get_header', [$this, 'process_confirmation']);
        add_action('woocommerce_update_options_checkout', [$this, 'update_checkout_options']);
        add_action('woocommerce_admin_order_data_after_order_details', [$this, 'add_invoice_credit_note_urls']);
        add_action('woocommerce_cart_calculate_fees', [$this, 'add_invoice_fees']);
        add_action('admin_enqueue_scripts', [$this, 'tillit_admin_scripts']);

        $tillit_payment_gateway = $this;
        new WC_Tillit_Checkout($this);

    }

    /**
     * Add filter to gateway payment title
     */
    public function change_tillit_payment_title(){
        add_filter('woocommerce_gateway_title', function ($title, $payment_id) {
            if( $payment_id === 'woocommerce-gateway-tillit' ) {
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
            'merchant_id' => $merchant_id,
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

        wp_enqueue_script( 'tillit.admin', WC_TILLIT_PLUGIN_URL . '/assets/js/admin.js', ['jquery']);
        wp_enqueue_style( 'tillit.admin', WC_TILLIT_PLUGIN_URL . '/assets/css/admin.css');

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
            $tillit_meta['tillit_merchant_id'],
            $tillit_meta['days_on_invoice'],
            $tillit_meta['company_id'],
            $tillit_meta['department'],
            $tillit_meta['project'],
            $tillit_meta['tillit_original_order_id']
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
            $tillit_meta['tillit_merchant_id'],
            $tillit_meta['days_on_invoice'],
            $tillit_meta['company_id'],
            $tillit_meta['department'],
            $tillit_meta['project'],
            $tillit_meta['tillit_original_order_id']
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

        $original_line_items = WC_Tillit_Helper::get_line_items($order->get_items(), $order->get_items('shipping'), $order->get_items('fee'));

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
        $updated_line_items = WC_Tillit_Helper::get_line_items($order->get_items(), $order->get_items('shipping'), $order->get_items('fee'));
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
        if ($body['payment'] && $body['payment']['payment_details'] && $body['payment']['payment_details']['invoice_number']) {
            update_post_meta($order->get_id(), 'invoice_number', $body['payment']['payment_details']['invoice_number']);
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

        // Create order
        $response = $this->make_request('/v1/order', WC_Tillit_Helper::compose_tillit_order(
            $order,
            $order_reference,
            $this->get_option('tillit_merchant_id'),
            $this->get_option('days_on_invoice'),
            sanitize_text_field($_POST['company_id']),
            sanitize_text_field($_POST['department']),
            sanitize_text_field($_POST['project']),
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
            WC_Tillit_Helper::display_ajax_error(__('EHF Invoice is not available for this order', 'tillit-payment-gateway'));
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
                'redirect'  => $body['tillit_urls']['verify_order_url']
            ];
        }

    }

    /**
     * Process the order refund
     *
     * @return void
     */

    public function process_refund($order_id, $amount = null, $reason = '') {

        $order = wc_get_order( $order_id );

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
        $tillit_order_id = $order->get_meta('tillit_order_id');

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
     * Get default environment id
     *
     * @return string
     */
    public function get_default_env()
    {
        // To avoid running WC_Tillit_Helper::get_default_env() for every request
        if ($this->get_option('checkout_env')) return 'demo';

        return WC_Tillit_Helper::get_default_env();
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
                'default'   => __('Receive the invoice via EHF and email', 'tillit-payment-gateway')
            ],
            'tillit_merchant_id' => [
                'title'     => __('Tillit Merchant ID', 'tillit-payment-gateway'),
                'type'      => 'text'
            ],
            'api_key' => [
                'title'     => __('API Key', 'tillit-payment-gateway'),
                'type'      => 'password',
            ],
            'merchant_logo' => [
                'title'     => __('Logo', 'tillit-payment-gateway'),
                'type'      => 'logo'
            ],
            'section_title_product' => [
                'type'      => 'separator',
                'title'     => __('Choose your product', 'tillit-payment-gateway')
            ],
            'product_merchant' => [
                'type'      => 'radio',
                'name'      => 'product_type',
                'disabled'  => true,
                'label'     => __('Merchant Invoice (coming soon)', 'tillit-payment-gateway')
            ],
            'product_administered' => [
                'type'      => 'radio',
                'name'      => 'product_type',
                'disabled'  => true,
                'label'     => __('Administered invoice (coming soon)', 'tillit-payment-gateway')
            ],
            'product_funded' => [
                'type'      => 'radio',
                'name'      => 'product_type',
                'label'     => __('Funded invoice', 'tillit-payment-gateway'),
                'checked'   => true
            ],
            'days_on_invoice' => [
                'title'     => __('Number of days on invoice', 'tillit-payment-gateway'),
                'type'      => 'text',
                'default'   => '14',
            ],
            'section_title_settings' => [
                'type'      => 'separator',
                'title'     => __('Settings', 'tillit-payment-gateway')
            ],
            'checkout_env' => [
                'type'      => 'select',
                'title'     => __('Mode', 'tillit-payment-gateway'),
                'default'   => $this->get_default_env(),
                'options' => array(
                      'prod' => 'Production',
                      'demo' => 'Demo',
                      'stg'  => 'Staging',
                      'dev'  => 'Development'
                 )
            ],
            'enable_company_name' => [
                'title'     => __('Activate company name auto-complete', 'tillit-payment-gateway'),
                'label'     => ' ',
                'type'      => 'checkbox',
            ],
            'enable_company_id' => [
                'title'     => __('Activate company org.id auto-complete', 'tillit-payment-gateway'),
                'label'     => ' ',
                'type'      => 'checkbox',
            ],
            'finalize_purchase' => [
                'title'     => __('Finalize purchase when order is fulfilled', 'tillit-payment-gateway'),
                'label'     => ' ',
                'type'      => 'checkbox',
            ],
            'enable_order_intent' => [
                'title'     => __('Pre-approve the buyer during checkout and disable Tillit if the buyer is declined', 'tillit-payment-gateway'),
                'label'     => ' ',
                'type'      => 'checkbox',
                'default'   => 'yes',
            ],
            'enable_b2b_b2c_radio' => [
                'title'     => __('Activate B2C/B2B check-out radio button', 'tillit-payment-gateway'),
                'label'     => ' ',
                'type'      => 'checkbox',
                'default'   => 'yes',
            ],
            'default_to_b2c' => [
                'title'     => __('Default to B2C check-out', 'tillit-payment-gateway'),
                'label'     => ' ',
                'type'      => 'checkbox',
            ],
            'invoice_fee_to_buyer' => [
                'title'     => __('Shift invoice fee to the buyers', 'tillit-payment-gateway'),
                'label'     => ' ',
                'type'      => 'checkbox',
            ],
            'initiate_payment_to_buyer_on_refund' => [
                'title'     => __('Initiate payment to buyer on refund', 'tillit-payment-gateway'),
                'label'     => ' ',
                'type'      => 'checkbox',
                'default'   => 'yes',
            ],
            'clear_options_on_deactivation' => [
                'title'     => __('Clear settings on deactivation', 'tillit-payment-gateway'),
                'label'     => ' ',
                'type'      => 'checkbox',
                'default'   => 'yes',
            ]
        ]);
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
                $tillit_meta['project']
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
    private function make_request($endpoint, $payload = [], $method = 'POST')
    {
        return wp_remote_request(sprintf('%s%s', $this->tillit_checkout_host, $endpoint), [
            'method' => $method,
            'headers' => [
                'Accept-Language' => WC_Tillit_Helper::get_locale(),
                'Content-Type' => 'application/json; charset=utf-8',
                'Tillit-Merchant-Id' => $this->get_option('tillit_merchant_id'),
                'Authorization' => sprintf('Basic %s', base64_encode(
                    $this->get_option('tillit_merchant_id') . ':' . $this->get_option('api_key')
                ))
            ],
            'timeout' => 30,
            'body' => empty($payload) ? '' : json_encode($payload),
            'data_format' => 'body'
        ]);
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
