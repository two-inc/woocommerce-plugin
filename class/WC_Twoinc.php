<?php

/**
 * Twoinc Gateway
 *
 * Provides integration between WooCommerce and Twoinc
 *
 * @class WC_Twoinc
 * @extends WC_Payment_Gateway
 * @package WooCommerce/Classes/Payment
 * @author Two.
 */


if (!class_exists('WC_Twoinc')) {
    class WC_Twoinc extends WC_Payment_Gateway
    {

        private static $instance;

        /**
         * WC_Twoinc constructor.
         */
        public function __construct()
        {

            $this->id = 'woocommerce-gateway-tillit';
            $this->has_fields = false;
            $this->order_button_text = __('Place order', 'twoinc-payment-gateway');
            $this->method_title = __('Two.', 'twoinc-payment-gateway');
            $this->method_description = __('Making it easy for businesses to buy online.', 'twoinc-payment-gateway');
            $this->icon = WC_HTTPS::force_https_url(WC_TWOINC_PLUGIN_URL . 'assets/images/logo.svg');
            $this->supports = ['products', 'refunds'];

            // Load the settings
            $this->init_form_fields();
            $this->init_settings();

            // Define user set variables
            $this->title = sprintf(__($this->get_option('title'), 'twoinc-payment-gateway'), strval($this->get_option('days_on_invoice')));
            $this->description = sprintf(
                '<p>%s <span class="twoinc-buyer-name-placeholder">%s</span><span class="twoinc-buyer-name"></span>.</p>%s',
                __('By completing the purchase, you verify that you have the legal right to purchase on behalf of', 'twoinc-payment-gateway'),
                __('your company', 'twoinc-payment-gateway'),
                $this->get_abt_twoinc_html()
            );
            $this->api_key = $this->get_option('api_key');

            // Twoinc api host
            $this->twoinc_search_host_no = 'https://no.search.tillit.ai';
            $this->twoinc_search_host_gb = 'https://gb.search.tillit.ai';
            $this->twoinc_checkout_host = $this->get_twoinc_checkout_host();

            $this->plugin_version = get_plugin_version();

            // Skip hooks if another instance has already been created
            if (null !== self::$instance) {
                return;
            }

            if (is_admin()) {
                // Notice banner if plugin is not setup properly
                if(!$this->get_option('api_key') || !$this->get_option('tillit_merchant_id')) {
                    add_action('admin_notices', [$this, 'twoinc_account_init_notice']);
                    add_action('network_admin_notices', [$this, 'twoinc_account_init_notice']);
                }

                // On plugin deactivated
                add_action('deactivate_' . plugin_basename(__FILE__), [$this, 'on_deactivate_plugin']);

                // Add js css to admin page
                add_action('admin_enqueue_scripts', [$this, 'twoinc_admin_styles_scripts']);

                // On setting updated
                add_action('woocommerce_update_options_payment_gateways_' . $this->id, [$this, 'process_admin_options']); // Built-in process_admin_options
                add_action('woocommerce_update_options_checkout', [$this, 'update_checkout_options']);
            }

            // Return if plugin setup is not complete
            if(!$this->get_option('api_key') || !$this->get_option('tillit_merchant_id') || sizeof($this->available_account_types()) == 0) return;

            if (is_admin()) {
                // Add HTML in order edit page
                add_action('woocommerce_admin_order_data_after_order_details', [$this, 'add_invoice_credit_note_urls']);

                // Advanced Custom Fields plugin hides custom fields, we must display them
                add_filter('acf/settings/remove_wp_meta_box', '__return_false');

                // For order update
                // For order update by Save button
                add_action('woocommerce_before_save_order_items', [$this, 'before_order_item_save'], 10, 2);
                add_action('woocommerce_saved_order_items', [$this, 'after_order_item_save'], 10, 2);
                // For order update by add/remove item (product/fee/shipping) and recalculate (tax)
                add_action('woocommerce_admin_order_item_headers', [$this, 'after_order_item_update'], 10, 1);
                // For order update using Update post
                add_action('save_post_shop_order', [$this, 'before_order_update'], 10, 2);
                add_action('wp_after_insert_post', [$this, 'after_order_update'], 10, 4);
            } else {
                // Confirm order after returning from twoinc checkout-page
                add_action('woocommerce_before_checkout_form', [$this, 'process_confirmation']);

                // Calculate fees in order review panel on the right of shop checkout page
                add_action('woocommerce_cart_calculate_fees', [$this, 'add_invoice_fees']);

                // Change the text in Twoinc payment method in shop checkout page to reflect correct validation status
                add_action('woocommerce_checkout_update_order_review', [$this, 'change_twoinc_payment_title']);
            }

            // On order status changed to completed
            add_action('woocommerce_order_status_completed', [$this, 'on_order_completed']);

            // On order status changed to cancelled
            add_action('woocommerce_order_status_cancelled', [$this, 'on_order_cancelled']);
            add_action('woocommerce_cancelled_order', [$this, 'on_order_cancelled']);

            // This class use singleton
            self::$instance = $this;
            new WC_Twoinc_Checkout($this);

        }

        /**
         * Singleton call
         */
        public static function get_instance() {
            if (null === self::$instance) {
                self::$instance = new WC_Twoinc();
            }
            return self::$instance;
        }

        /**
         * Get twoinc checkout host based on current settings
         */
        private function get_twoinc_checkout_host(){
            if (WC_Twoinc_Helper::is_twoinc_development()) {
                return $this->get_option('test_checkout_host');
            } else if ($this->get_option('checkout_env') === 'SANDBOX') {
                return 'https://test.api.tillit.ai';
            } else {
                return 'https://api.tillit.ai';
            }
        }

        /**
         * Get about twoinc html
         */
        private function get_abt_twoinc_html(){
            if ($this->get_option('show_abt_link') === 'yes') {
                return '<div id="abt-twoinc-link"><a href="https://twoinc.notion.site/What-is-Tillit-4e12960d8e834e5aa20f879d59e0b32f" onclick="javascript:window.open(\'https://twoinc.notion.site/What-is-Tillit-4e12960d8e834e5aa20f879d59e0b32f\',\'WhatIsTwoinc\',\'toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=yes, resizable=yes, width=1060, height=700\'); return false;">What is Twoinc?</a>&nbsp;</div>';
            }
            return '';
        }

        /**
         * Add filter to gateway payment title
         */
        public function change_twoinc_payment_title(){
            add_filter('woocommerce_gateway_title', function ($title, $payment_id) {
                if($payment_id === 'woocommerce-gateway-tillit') {
                    $title = sprintf(
                        '%s<div class="twoinc-subtitle">%s</div> ',
                        sprintf(__($this->get_option('title'), 'twoinc-payment-gateway'), strval($this->get_option('days_on_invoice'))),
                        __('Enter company name to pay on invoice', 'twoinc-payment-gateway')
                    );
                }
                return $title;
            }, 10, 2);
        }

        /**
         * Send the merchant logo to Twoinc API
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

            if (!WC_Twoinc_Helper::is_twoinc_order($order)) {
                return;
            }

            if ($order->get_status() !== 'completed' && $order->get_status() !== 'refunded') {
                return;
            }

            $twoinc_order_id = $this->get_twoinc_order_id($order);

            if ($twoinc_order_id) {

                $order_refunds = $order->get_refunds();
                $has_twoinc_refund = false;
                foreach($order_refunds as $refund){
                    if ($refund->get_refunded_payment()) {
                        $has_twoinc_refund = true;
                        break;
                    }
                }

                print('<div style="margin-top:20px;float:left;">');

                if ($has_twoinc_refund) {
                    print('<a href="' . $this->twoinc_checkout_host . "/v1/invoice/${twoinc_order_id}/pdf?lang="
                          . WC_Twoinc_Helper::get_locale()
                          . '"><button type="button" class="button">Download credit note</button></a><br><br>');
                    print('<a href="' . $this->twoinc_checkout_host . "/v1/invoice/${twoinc_order_id}/pdf?v=original&lang="
                          . WC_Twoinc_Helper::get_locale()
                          . '"><button type="button" class="button">Download original invoice</button></a>');
                } else {
                    print('<a href="' . $this->twoinc_checkout_host . "/v1/invoice/${twoinc_order_id}/pdf?v=original&lang="
                          . WC_Twoinc_Helper::get_locale()
                          . '"><button type="button" class="button">Download invoice</button></a>');
                }

                print('</div>');
            }
        }

        /**
         * Enqueue the admin styles and scripts
         *
         * @return void
         */
        public function twoinc_admin_styles_scripts()
        {

            if (!did_action('wp_enqueue_media')) {
                wp_enqueue_media();
            }

            wp_enqueue_script('twoinc.admin', WC_TWOINC_PLUGIN_URL . '/assets/js/admin.js', ['jquery']);
            wp_enqueue_style('twoinc.admin', WC_TWOINC_PLUGIN_URL . '/assets/css/admin.css');

        }

        /**
         * Notify Twoinc API after order item update
         *
         * @param $order
         */
        public function after_order_item_update($order)
        {
            if (!WC_Twoinc_Helper::is_twoinc_order($order)) {
                return;
            }

            if (!isset($_POST) || !isset($_POST['action'])) {
                return;
            }
            $action = sanitize_text_field($_POST['action']);

            if ($action == 'woocommerce_add_order_item') {
                $order->calculate_totals(true);
                $this->update_twoinc_order($order);
                WC_Twoinc_Helper::append_admin_force_reload();
            } else if ($action == 'woocommerce_remove_order_item') {
                $this->update_twoinc_order($order);
                WC_Twoinc_Helper::append_admin_force_reload();
            } else if ($action == 'woocommerce_add_order_fee') {
                $this->update_twoinc_order($order);
                WC_Twoinc_Helper::append_admin_force_reload();
            } else if ($action == 'woocommerce_add_order_shipping') {
                $this->update_twoinc_order($order);
                WC_Twoinc_Helper::append_admin_force_reload();
            // } else if ($action == 'woocommerce_add_order_tax') {
            // } else if ($action == 'woocommerce_remove_order_tax') {
            } else if ($action == 'woocommerce_calc_line_taxes') {
                $this->update_twoinc_order($order);
                WC_Twoinc_Helper::append_admin_force_reload();
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
            if (!$order || !WC_Twoinc_Helper::is_twoinc_order($order)) {
                return;
            }

            $twoinc_order_id = $this->get_twoinc_order_id($order);

            $twoinc_meta = $this->get_save_twoinc_meta($order);
            if (!$twoinc_meta) return;

            $original_order = WC_Twoinc_Helper::compose_twoinc_order(
                $order,
                $twoinc_meta['order_reference'],
                $twoinc_meta['days_on_invoice'],
                $twoinc_meta['company_id'],
                $twoinc_meta['department'],
                $twoinc_meta['project'],
                $twoinc_meta['product_type'],
                $twoinc_meta['payment_reference_message'],
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
            if ('shop_order' !== $post->post_type || !WC_Twoinc_Helper::is_twoinc_order($order)) {
                return;
            }

            if (!$this->original_orders || !$this->original_orders[$order->get_id()]) return;

            $twoinc_order_id = $this->get_twoinc_order_id($order);

            $twoinc_meta = $this->get_save_twoinc_meta($order);
            if (!$twoinc_meta) return;

            $updated_order = WC_Twoinc_Helper::compose_twoinc_order(
                $order,
                $twoinc_meta['order_reference'],
                $twoinc_meta['days_on_invoice'],
                $twoinc_meta['company_id'],
                $twoinc_meta['department'],
                $twoinc_meta['project'],
                $twoinc_meta['product_type'],
                $twoinc_meta['payment_reference_message'],
                ''
            );

            $diff = WC_Twoinc_Helper::array_diff_r($this->original_orders[$order->get_id()], $updated_order);

            if ($diff) {

                $this->update_twoinc_order($order);

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
            if (!WC_Twoinc_Helper::is_twoinc_order($order)) {
                return;
            }

            $original_line_items = WC_Twoinc_Helper::get_line_items($order->get_items(), $order->get_items('shipping'), $order->get_items('fee'), $order);

            if (!property_exists($this, 'order_line_items')) $this->order_line_items = array();
            $this->order_line_items[$order_id] = $original_line_items;

        }

        /**
         * After item "Save" button
         * Notify Twoinc API after the order is updated
         *
         * @param $order_id
         * @param $items
         */
        public function after_order_item_save($order_id, $items)
        {

            $order = wc_get_order($order_id);
            if (!WC_Twoinc_Helper::is_twoinc_order($order)) {
                return;
            }

            $original_line_items = $this->order_line_items[$order_id];
            $updated_line_items = WC_Twoinc_Helper::get_line_items($order->get_items(), $order->get_items('shipping'), $order->get_items('fee'), $order);
            $diff = WC_Twoinc_Helper::array_diff_r($original_line_items, $updated_line_items);

            if ($diff) {

                $this->update_twoinc_order($order);

                WC_Twoinc_Helper::append_admin_force_reload();

            }
        }

        /**
         * Add invoice fee as a line item
         *
         * @param $order_id
         */
        public function add_invoice_fees() {

            if ($this->get_option('invoice_fee_to_buyer') === 'yes' && 'woocommerce-gateway-tillit' === WC()->session->get('chosen_payment_method')) {
                global $woocommerce;

                if (is_admin() && !defined('DOING_AJAX')) {
                    return;
                }

                // Get invoice fixed fee
                $twoinc_merchant_id = $this->get_option('tillit_merchant_id');
                $response = $this->make_request("/v1/merchant/${twoinc_merchant_id}", [], 'GET');

                if(is_wp_error($response)) {
                    WC()->session->set('chosen_payment_method', 'cod');
                    return;
                }

                $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
                if ($twoinc_err) {
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
         * Notify Twoinc API when the order status is completed
         *
         * @param $order_id
         */
        public function on_order_completed($order_id)
        {

            // Get the order
            $order = wc_get_order($order_id);

            // Check payment method
            if (!WC_Twoinc_Helper::is_twoinc_order($order)) {
                return;
            }

            // Get the Twoinc order ID
            $twoinc_order_id = $this->get_twoinc_order_id($order);

            // Change the order status
            $response = $this->make_request("/v1/order/${twoinc_order_id}/fulfilled");

            if(is_wp_error($response)) {
                $order->add_order_note(__('Could not update status', 'twoinc-payment-gateway'));
                return;
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                $order->add_order_note(sprintf(__('Could not update status to fulfilled on Two, please check with Two. admin for id %s', 'twoinc-payment-gateway'), $twoinc_order_id));
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
         * Notify Twoinc API when the order status is cancelled
         *
         * @param $order_id
         */
        public function on_order_cancelled($order_id)
        {
            // Get the order
            $order = wc_get_order($order_id);

            // Check payment method
            if (!WC_Twoinc_Helper::is_twoinc_order($order)) {
                return;
            }

            // Get the Twoinc order ID
            $twoinc_order_id = $this->get_twoinc_order_id($order);

            // Change the order status
            $response = $this->make_request("/v1/order/${twoinc_order_id}/cancel");

            if(is_wp_error($response)) {
                $order->add_order_note(__('Could not update status to cancelled', 'twoinc-payment-gateway'));
                return;
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                $order->add_order_note(sprintf(__('Could not update status to cancelled, please check with Two. admin for id %s', 'twoinc-payment-gateway'), $twoinc_order_id));
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
            if (!WC_Twoinc_Helper::is_twoinc_order($order)) {
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
            $response = $this->make_request('/v1/order', WC_Twoinc_Helper::compose_twoinc_order(
                $order,
                $order_reference,
                $this->get_option('days_on_invoice'),
                sanitize_text_field($_POST['company_id']),
                sanitize_text_field($_POST['department']),
                sanitize_text_field($_POST['project']),
                $product_type,
                $payment_reference_message,
                sanitize_text_field($_POST['tracking_id'])
            ));

            if(is_wp_error($response)) {
                $order->add_order_note(__('Could not request to create Two. order', 'twoinc-payment-gateway'));
                return;
            }

            // Stop on process payment failure
            if(isset($response) && isset($response['result']) && $response['result'] === 'failure') {
                $order->add_order_note(__('Fail to process payment', 'twoinc-payment-gateway'));
                return $response;
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                WC_Twoinc_Helper::display_ajax_error(__('Invoice is not available for this purchase', 'twoinc-payment-gateway'));
                return;
            }

            // Decode the response
            $body = json_decode($response['body'], true);

            if ($body['status'] == 'REJECTED') {
                WC_Twoinc_Helper::display_ajax_error(__('Invoice is not available for this purchase', 'twoinc-payment-gateway'));
                return;
            }

            // Store the Twoinc Order Id for future use
            update_post_meta($order_id, 'twoinc_order_id', $body['id']);

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
            if (!WC_Twoinc_Helper::is_twoinc_order($order)) {
                return;
            }

            // Get the Twoinc order ID
            $twoinc_order_id = $this->get_twoinc_order_id($order);

            // Get and check refund data
            if ($order->get_status() !== 'completed') {
                return new WP_Error('invalid_twoinc_refund',
                    __('Only Completed order can be refunded by Two', 'twoinc-payment-gateway'));
            }

            $order_refunds = $order->get_refunds();
            foreach($order_refunds as $refund){
                if (!$order_refund || $refund->get_date_created() > $order_refund->get_date_created()) {
                    $order_refund = $refund;
                }
            }

            if (!$order_refund || !$twoinc_order_id || !$amount) {
                return new WP_Error('invalid_twoinc_refund',
                    __('Could not initiate refund by Two', 'twoinc-payment-gateway'));
            }

            // Send refund request
            $response = $this->make_request(
                "/v1/order/${twoinc_order_id}/refund",
                WC_Twoinc_Helper::compose_twoinc_refund(
                    $order_refund,
                    -$amount,
                    $order->get_currency(),
                    $this->get_option('initiate_payment_to_buyer_on_refund') === 'yes'
                ),
                'POST'
            );

            // Stop if request error
            if(is_wp_error($response)) {
                $order->add_order_note(__('Failed to request refund order to Two', 'twoinc-payment-gateway'));
                return false;
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                $order->add_order_note(sprintf(__('Failed to request refund order to Two, please check with Two. admin for id %s', 'twoinc-payment-gateway'), $twoinc_order_id));
                return new WP_Error('invalid_twoinc_refund',
                    __('Request refund order to Two. has errors', 'twoinc-payment-gateway'));
            }

            // Decode the response
            $body = json_decode($response['body'], true);

            // Check if response is ok
            if (!$body['amount']) {
                $order->add_order_note(sprintf(__('Failed to refund order by Two, please check with Two. admin for id %s', 'twoinc-payment-gateway'), $twoinc_order_id));
                return new WP_Error('invalid_twoinc_refund',
                    __('Failed to refund order by Two', 'twoinc-payment-gateway'));
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

            // Stop if no Twoinc order reference and no nonce
            if(!isset($_REQUEST['twoinc_confirm_order']) || !isset($_REQUEST['nonce'])) return;

            // Get the order reference
            $order_reference = sanitize_text_field($_REQUEST['twoinc_confirm_order']);

            // Get the nonce
            $nonce = $_REQUEST['nonce'];

            // Stop if the code is not valid
            if(!wp_verify_nonce($nonce, 'twoinc_confirm')) wp_die(__('The security code is not valid.', 'twoinc-payment-gateway'));

            /** @var wpdb $wpdb */
            global $wpdb;

            $sql = $wpdb->prepare("SELECT post_id FROM $wpdb->postmeta WHERE meta_key = %s AND meta_value = %s", '_tillit_order_reference', $order_reference);
            $row = $wpdb->get_row($sql , ARRAY_A);

            // Stop if no order found
            if(!isset($row['post_id'])) wp_die(__('Unable to find the requested order', 'twoinc-payment-gateway'));

            // Get the order ID
            $order_id = $row['post_id'];

            // Get the order object
            $order = new WC_Order($order_id);

            // Check payment method
            if (!WC_Twoinc_Helper::is_twoinc_order($order)) {
                return;
            }

            // Get the Twoinc order ID from shop order ID
            $twoinc_order_id = $this->get_twoinc_order_id_from_post_id($order_id);

            // Get the Twoinc order details
            $response = $this->make_request("/v1/order/${twoinc_order_id}", [], 'GET');

            // Stop if request error
            if(is_wp_error($response)) {
                $order->add_order_note(__('Unable to retrieve the order information', 'twoinc-payment-gateway'));
                wp_die(__('Unable to retrieve the order information', 'twoinc-payment-gateway'));
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                $order->add_order_note(__('Unable to retrieve the order payment information', 'twoinc-payment-gateway'));
                wp_die(__('Unable to retrieve the order payment information', 'twoinc-payment-gateway'));
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
         * Setup Twoinc settings
         *
         * @return void
         */
        public function one_click_setup()
        {

            // Stop if this is not setup request
            if(strtok($_SERVER["REQUEST_URI"], '?s') !== '/twoinc-payment-gateway/init' || !isset($_REQUEST['m']) || !isset($_REQUEST['k']) || !isset($_REQUEST['t']) || !isset($_REQUEST['c'])) return;

            if (!current_user_can('manage_options')) {
                $redirect_to_signin = wp_login_url() . '?redirect_to=' . urlencode($_SERVER["REQUEST_URI"]);
                $error = new WP_Error(
                    'init_failed',
                    sprintf(
                        __('Wordpress admin privilege is required for Two. payment One-click setup. %s', 'twoinc-payment-gateway'),
                        sprintf('<a href="%s">» %s</a>', $redirect_to_signin, __('Log in', 'twoinc-payment-gateway'))
                    ),
                    array('title' => _('Two. payment setup failure'), 'response' => '401', 'back_link' => false));
                if(is_wp_error($error)){
                    wp_die($error, '', $error->get_error_data());
                }
            }

            // Get the id and token to send to Twoinc
            $merchant_id = sanitize_text_field($_REQUEST['m']);
            $twoinc_init_tk = sanitize_text_field($_REQUEST['k']);
            $site_type = sanitize_text_field($_REQUEST['t']);
            $twoinc_checkout_host = sanitize_text_field($_REQUEST['c']);

            if ($site_type === 'WOOCOMMERCE') {
                $params = [
                    'm' => $merchant_id,
                    'k' => $twoinc_init_tk,
                    't' => $site_type,
                ];
                $response = wp_remote_request(sprintf('%s%s?%s', $twoinc_checkout_host, '/v1/portal/merchant/ocs', http_build_query($params)), [
                    'method' => 'GET',
                    'timeout' => 30,
                    'body' => '',
                    'data_format' => 'body'
                ]);

                if(is_wp_error($response)) {
                    $error = new WP_Error(
                        'init_failed',
                        sprintf(
                            'Could not connect to setup server, please contact %s for more information!',
                            sprintf('<a href="https://tillit.ai/">%s</a>', __('Two.', 'twoinc-payment-gateway'))
                        ),
                        array('title' => _('Two. payment setup failure'), 'response' => '400', 'back_link' => false));
                    wp_die($error, '', $error->get_error_data());
                }

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
                    if (isset($body['mark_tillit_fields_required'])) $this->update_option('mark_tillit_fields_required', $body['mark_tillit_fields_required'] ? 'yes' : 'no');
                    if (isset($body['enable_order_intent'])) $this->update_option('enable_order_intent', $body['enable_order_intent'] ? 'yes' : 'no');
                    if (isset($body['default_to_b2c'])) $this->update_option('default_to_b2c', $body['default_to_b2c'] ? 'yes' : 'no');
                    if (isset($body['invoice_fee_to_buyer'])) $this->update_option('invoice_fee_to_buyer', $body['invoice_fee_to_buyer'] ? 'yes' : 'no');
                    if (isset($body['initiate_payment_to_buyer_on_refund'])) $this->update_option('initiate_payment_to_buyer_on_refund', $body['initiate_payment_to_buyer_on_refund'] ? 'yes' : 'no');
                    if (isset($body['clear_options_on_deactivation'])) $this->update_option('clear_options_on_deactivation', $body['clear_options_on_deactivation'] ? 'yes' : 'no');
                    if (WC_Twoinc_Helper::is_twoinc_development()) {
                        $this->update_option('test_checkout_host', $twoinc_checkout_host);
                    } else if (strpos($twoinc_checkout_host, 'test.api.tillit.ai') !== false) {
                        $this->update_option('checkout_env', 'SANDBOX');
                    } else {
                        $this->update_option('checkout_env', 'PROD');
                    }

                    // Init done
                    $error = new WP_Error(
                        'init_ok',
                        sprintf(
                            'Successfully setup Two. payment! Go to %s.',
                            sprintf('<a href="%s">%s</a>', get_dashboard_url(), __('Dashboard', 'twoinc-payment-gateway'))
                        ),
                        array('title' => _('Two. payment setup success'), 'response' => '200', 'back_link' => false));
                    wp_die($error, '', $error->get_error_data());
                } else if ($response['response']['code'] === 400) {
                    // Link expired or max attempts reached or wrong key
                    $error = new WP_Error(
                        'init_failed',
                        sprintf(
                            'Magic setup link already used or expired, please contact %s for more information!',
                            sprintf('<a href="https://tillit.ai/">%s</a>', __('Two.', 'twoinc-payment-gateway'))
                        ),
                        array('title' => _('Two. payment setup failure'), 'response' => '400', 'back_link' => false));
                    wp_die($error, '', $error->get_error_data());
                }
            }

            // Other errors
            $error = new WP_Error(
                'init_failed',
                sprintf(
                    'Could not setup Two. payment on your website, please contact %s for more information!',
                    sprintf('<a href="https://tillit.ai/">%s</a>', __('Two.', 'twoinc-payment-gateway'))
                ),
                array('title' => _('Two. payment setup failure'), 'response' => '400', 'back_link' => false));
            wp_die($error, '', $error->get_error_data());

        }

        /**
         * Get customer types enabled in admin settings
         */
        public function available_account_types()
        {

            $available_types = [];

            if ($this->get_option('checkout_personal') === 'yes') {
                $available_types['personal'] = __('Personal', 'twoinc-payment-gateway');
            }

            if ($this->get_option('checkout_sole_trader') === 'yes') {
                $available_types['sole_trader'] = __('Sole trader/other', 'twoinc-payment-gateway');
            }

            if ($this->get_option('checkout_business') === 'yes') {
                $available_types['business'] = __('Business', 'twoinc-payment-gateway');
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
            $twoinc_form_fields = [
                'enabled' => [
                    'title'     => __('Turn on/off', 'twoinc-payment-gateway'),
                    'type'      => 'checkbox',
                    'label'     => __('Enable Two. Payments', 'twoinc-payment-gateway'),
                    'default'   => 'yes'
                ],
                'title' => [
                    'title'     => __('Title', 'twoinc-payment-gateway'),
                    'type'      => 'text',
                    'default'   => __('Business invoice %s days', 'twoinc-payment-gateway')
                ],
                'subtitle' => [
                    'title'     => __('Description', 'twoinc-payment-gateway'),
                    'type'      => 'text',
                    'default'   => __('Receive the invoice via PDF and email', 'twoinc-payment-gateway')
                ],
                'test_checkout_host' => [
                    'type'      => 'text',
                    'title'     => __('Two. Test Server', 'twoinc-payment-gateway'),
                    'default'   => 'https://staging.api.tillit.ai'
                ],
                'checkout_env' => [
                    'type'      => 'select',
                    'title'     => __('Choose your settings', 'twoinc-payment-gateway'),
                    'default'   => 'Production',
                    'options'   => array(
                          'PROD'     => 'Production',
                          'SANDBOX'  => 'Sandbox'
                     )
                ],
                'clear_options_on_deactivation' => [
                    'title'     => __('Clear settings on deactivation', 'twoinc-payment-gateway'),
                    'label'     => ' ',
                    'type'      => 'checkbox',
                    'default'   => 'no'
                ],
                'section_api_credentials' => [
                    'type'      => 'title',
                    'title'     => __('API credentials', 'twoinc-payment-gateway')
                ],
                'tillit_merchant_id' => [
                    'title'     => __('Two. Merchant Username', 'twoinc-payment-gateway'),
                    'type'      => 'text'
                ],
                'api_key' => [
                    'title'     => __('Two. API Key', 'twoinc-payment-gateway'),
                    'type'      => 'password'
                ],
                'section_invoice_settings' => [
                    'type'      => 'title',
                    'title'     => __('Payment and Invoice settings', 'twoinc-payment-gateway')
                ],
                'product_type' => [
                    'type'      => 'select',
                    'title'     => __('Choose product', 'twoinc-payment-gateway'),
                    'default'   => 'FUNDED_INVOICE',
                    'options'   => array(
                          'FUNDED_INVOICE' => 'Funded Invoice',
                          'DIRECT_INVOICE' => 'Direct Invoice'
                     )
                ],
                'days_on_invoice' => [
                    'title'     => __('Default number of buyer payment days', 'twoinc-payment-gateway'),
                    'type'      => 'text',
                    'default'   => '14'
                ],
                'merchant_logo' => [
                    'title'     => __('Add a logo to the invoice', 'twoinc-payment-gateway'),
                    'type'      => 'logo'
                ],
                'section_checkout_options' => [
                    'type'      => 'title',
                    'title'     => __('Checkout options', 'twoinc-payment-gateway')
                ],
                'enable_order_intent' => [
                    'title'     => __('Pre-approve buyer during checkout', 'twoinc-payment-gateway'),
                    'description' => __('Approves buyer when phone and company name is filled out. Disables Two. payment method if buyer is declined.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'label'     => ' ',
                    'type'      => 'checkbox',
                    'default'   => 'yes'
                ],
                'checkout_personal' => [
                    'title'     => __('Show account type for Private Customer', 'twoinc-payment-gateway'),
                    'label'     => ' ',
                    'type'      => 'checkbox',
                    'default'   => 'yes'
                ],
                'checkout_sole_trader' => [
                    'title'     => __('Show account type for Sole trader/other Customer', 'twoinc-payment-gateway'),
                    'label'     => ' ',
                    'type'      => 'checkbox'
                ],
                'checkout_business' => [
                    'title'     => __('Show account type for Business Customer', 'twoinc-payment-gateway'),
                    'label'     => ' ',
                    'type'      => 'checkbox',
                    'default'   => 'yes'
                ],
                'mark_tillit_fields_required' => [
                    'title'     => __('Always mark Two. fields as required', 'twoinc-payment-gateway'),
                    'label'     => ' ',
                    'type'      => 'checkbox',
                    'default'   => 'yes'
                ],
                'add_field_department' => [
                    'title'     => __('Add department field to Checkout page', 'twoinc-payment-gateway'),
                    'label'     => ' ',
                    'type'      => 'checkbox',
                    'default'   => 'yes'
                ],
                'add_field_project' => [
                    'title'     => __('Add project field to Checkout page', 'twoinc-payment-gateway'),
                    'label'     => ' ',
                    'type'      => 'checkbox',
                    'default'   => 'yes'
                ],
                'use_account_type_buttons' => [
                    'title'     => __('Use buttons instead of radios to select account type', 'twoinc-payment-gateway'),
                    'label'     => ' ',
                    'type'      => 'checkbox',
                    'default'   => 'no'
                ],
                'show_abt_link' => [
                    'title'     => __('Show "What is Two." link in Checkout', 'twoinc-payment-gateway'),
                    'label'     => ' ',
                    'type'      => 'checkbox',
                    'default'   => 'no'
                ],
                'default_to_b2c' => [
                    'title'     => __('Default to B2C check-out', 'twoinc-payment-gateway'),
                    'label'     => ' ',
                    'type'      => 'checkbox'
                ],
                'invoice_fee_to_buyer' => [
                    'title'     => __('Shift invoice fee to the buyers', 'twoinc-payment-gateway'),
                    'label'     => ' ',
                    'type'      => 'checkbox'
                ],
                'initiate_payment_to_buyer_on_refund' => [
                    'title'     => __('Initiate payment to buyer on refund', 'twoinc-payment-gateway'),
                    'label'     => ' ',
                    'type'      => 'checkbox',
                    'default'   => 'yes'
                ],
                'display_other_payments' => [
                    'title'     => __('Always enable all available payment methods', 'twoinc-payment-gateway'),
                    'label'     => ' ',
                    'type'      => 'checkbox',
                    'default'   => 'yes'
                ],
                'fallback_to_another_payment' => [
                    'title'     => __('Fallback to other payment methods if Two. is not available', 'twoinc-payment-gateway'),
                    'label'     => ' ',
                    'type'      => 'checkbox',
                    'default'   => 'yes'
                ],
                'section_auto_complete_settings' => [
                    'type'      => 'title',
                    'title'     => __('Auto-complete settings', 'twoinc-payment-gateway')
                ],
                'enable_company_name' => [
                    'title'     => __('Activate company name auto-complete', 'twoinc-payment-gateway'),
                    'label'     => ' ',
                    'type'      => 'checkbox'
                ],
                'enable_company_id' => [
                    'title'     => __('Activate company org.id auto-complete', 'twoinc-payment-gateway'),
                    'label'     => ' ',
                    'type'      => 'checkbox'
                ]
            ];

            if (WC_Twoinc_Helper::is_twoinc_development()) {
                unset($twoinc_form_fields['checkout_env']);
            } else {
                unset($twoinc_form_fields['test_checkout_host']);
            }

            $this->form_fields = apply_filters('wc_tillit_form_fields', $twoinc_form_fields);
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
                        <div class="image-container woocommerce-twoinc-image-container">
                            <?php if($image_src): ?>
                                <img src="<?php echo $image_src; ?>" alt="" />
                            <?php endif; ?>
                        </div>
                        <button class="button-secondary woocommerce-twoinc-logo" type="button"><?php _e('Select image', 'twoinc-payment-gateway'); ?></button>
                    </fieldset>
                </td>
            </tr>
            <?php
            return ob_get_clean();
        }

        /**
         * Get twoinc meta from DB and Twoinc server
         *
         * @param $order
         */
        private function get_save_twoinc_meta($order)
        {

            $twoinc_order_id = $this->get_twoinc_order_id($order);
            if (!$twoinc_order_id) {
                return;
            }

            $order_reference = $order->get_meta('_tillit_order_reference');
            $twoinc_merchant_id = $order->get_meta('_tillit_merchant_id');
            if (!$twoinc_merchant_id) {
                $twoinc_merchant_id = $this->get_option('tillit_merchant_id');
                update_post_meta($order->get_id(), '_tillit_merchant_id', $twoinc_merchant_id);
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
                $response = $this->make_request("/v1/order/${twoinc_order_id}", [], 'GET');

                $body = json_decode($response['body'], true);
                if (!$body || !$body['buyer'] || !$body['buyer']['company'] || !$body['buyer']['company']['organization_number']) {
                    $order->add_order_note(sprintf(__('Missing company ID, please check with Two. admin for id %s', 'twoinc-payment-gateway'), $twoinc_order_id));
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
                'tillit_merchant_id' => $twoinc_merchant_id,
                'days_on_invoice' => $days_on_invoice,
                'company_id' => $company_id,
                'department' => $department,
                'project' => $project,
                'twoinc_order_id' => $twoinc_order_id,
                'product_type' => $product_type,
                'payment_reference_message' => $payment_reference_message
            );

        }

        /**
         * Run the update execution
         *
         * @param $order
         */
        private function update_twoinc_order($order)
        {

            $twoinc_order_id = $this->get_twoinc_order_id($order);


            // 1. Get information from the current order
            $twoinc_meta = $this->get_save_twoinc_meta($order);
            if (!$twoinc_meta) return;


            // 2. Edit the order
            $response = $this->make_request("/v1/order/${twoinc_order_id}", WC_Twoinc_Helper::compose_twoinc_edit_order(
                    $order,
                    $twoinc_meta['days_on_invoice'],
                    $twoinc_meta['department'],
                    $twoinc_meta['project'],
                    $twoinc_meta['product_type'],
                    $twoinc_meta['payment_reference_message']
                ),
                'PUT'
            );

            if(is_wp_error($response)) {
                $order->add_order_note(__('Could not edit the Two. order', 'twoinc-payment-gateway'));
                return;
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                $order->add_order_note(__('Could not edit the Two. order, please check with Two. admin', 'twoinc-payment-gateway'));
                return;
            }

        }

        /**
         * Get twoinc order id with backward compatibility
         *
         * @param $order
         */
        private function get_twoinc_order_id($order)
        {

            $twoinc_order_id = $order->get_meta('twoinc_order_id');

            if (!isset($twoinc_order_id)) {
                $twoinc_order_id = $order->get_meta('tillit_order_id');
            }

            return $twoinc_order_id;

        }

        /**
         * Get twoinc order id from post id with backward compatibility
         *
         * @param $post_id
         */
        private function get_twoinc_order_id_from_post_id($post_id)
        {

            $twoinc_order_id = get_post_meta($order_id, 'twoinc_order_id', true);

            if (!isset($twoinc_order_id)) {
                $twoinc_order_id = get_post_meta($order_id, 'tillit_order_id', true);
            }

            return $twoinc_order_id;

        }

        /**
         * Make a request to Twoinc API
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
            return wp_remote_request(sprintf('%s%s?%s', $this->twoinc_checkout_host, $endpoint, http_build_query($params)), [
                'method' => $method,
                'headers' => [
                    'Accept-Language' => WC_Twoinc_Helper::get_locale(),
                    'Content-Type' => 'application/json; charset=utf-8',
                    'X-API-Key' => $this->get_option('api_key')
                ],
                'timeout' => 30,
                'body' => empty($payload) ? '' : json_encode($payload),
                'data_format' => 'body'
            ]);
        }

        /**
         * Display admin banner notice for twoinc account setup
         *
         * @return void
         */
        public function twoinc_account_init_notice(){
            global $pagenow;
            if ($pagenow !== 'options-general.php') {
                echo '
                <div id="twoinc-account-init-notice" class="notice notice-info is-dismissible" style="background-color: #e2e0ff;padding: 20px;display: flex;">
                    <div style="width:60%;padding-right:40px;">
                        <h1 style="color: #000000;font-weight:700;">Set up your Two. account</h1>
                        <p style="color: #000000;font-size: 1.3em;text-align: justify;">Happy to see you here! Before you can start selling with the Two. buy now, pay later solution you need to complete our signup process. It\'s easy, fast and gives you immediate access to the <a target="_blank" href="https://portal.tillit.ai/merchant">Two. Merchant Portal</a></p>
                    </div>
                    <div>
                        <img style="position: absolute;top: 40px;right: 40px;width: 100px;" src="/wp-content/plugins/tillit-payment-gateway/assets/images/logo.svg">
                        <div style="position: absolute;bottom: 20px;right:40px;">
                            <a href="#" id="dismiss-twoinc-notice" class="button" style="margin-left: 20px;background: none;font-size: 1.1em;font-weight: 600;color: #3e16a2;padding: 7px 30px;border-color: #3e16a2;border-radius: 12px;">Not now, thanks</a>
                            <a href="https://portal.tillit.ai/merchant" target="_blank" class="button" style="margin-left: 20px;background: #3e16a2;font-size: 1.1em;font-weight: 600;color: #ffffff;padding: 7px 30px;border-color: #3e16a2;border-radius: 12px;">Set up my account</a>
                        </div>
                    </div>
                </div>

                <script type="text/javascript">
                    jQuery(document).ready(function($){
                        jQuery("#dismiss-twoinc-notice").click(function(){
                            jQuery("#twoinc-account-init-notice").slideUp();
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

}
