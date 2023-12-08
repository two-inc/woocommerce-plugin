<?php

/**
 * Twoinc Gateway
 *
 * Provides integration between WooCommerce and Twoinc
 *
 * @class WC_Twoinc
 * @extends WC_Payment_Gateway
 * @package WooCommerce/Classes/Payment
 * @author Two
 */


if (!class_exists('WC_Twoinc')) {
    class WC_Twoinc extends WC_Payment_Gateway
    {

        private static $instance;

        private static $status_to_states = array(
            'completed' => ['FULFILLED', 'REFUNDED'],
            'cancelled' => ['CANCELLED'],
            'refunded' => ['REFUNDED'],
        );

        /**
         * WC_Twoinc constructor.
         */
        public function __construct()
        {

            $this->id = 'woocommerce-gateway-tillit';
            $this->has_fields = false;
            $this->order_button_text = __('Place order', 'twoinc-payment-gateway');
            $this->method_title = __('Two', 'twoinc-payment-gateway');
            $this->method_description = __('Making it easy for businesses to buy online.', 'twoinc-payment-gateway');
            $this->icon = WC_HTTPS::force_https_url(WC_TWOINC_PLUGIN_URL . 'assets/images/two-logo.svg');
            $this->supports = ['products', 'refunds'];

            // Load the settings
            $this->init_form_fields();
            $this->init_settings();

            // Twoinc api host
            $this->api_key = $this->get_option('api_key');
            $this->twoinc_search_host_no = $this->get_twoinc_search_host('no');
            $this->twoinc_search_host_gb = $this->get_twoinc_search_host('gb');
            $this->twoinc_search_host_se = $this->get_twoinc_search_host('se');
            $this->twoinc_checkout_host = $this->get_twoinc_checkout_host();

            $this->plugin_version = get_plugin_version();

            $this->title = sprintf(
                __($this->get_option('title'), 'twoinc-payment-gateway'),
                strval($this->get_merchant_default_days_on_invoice())
            );
            $this->description = sprintf(
                '%s%s%s',
                $this->get_pay_subtitle(),
                $this->get_pay_box_description(),
                $this->get_abt_twoinc_html()
            );

            // Skip hooks if another instance has already been created
            if (null !== self::$instance) {
                return;
            }

            if (is_admin()) {
                // Notice banner if plugin is not setup properly
                if (!$this->get_option('api_key') || !$this->get_option('tillit_merchant_id')) {
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
            if (!$this->get_option('api_key') || !$this->get_option('tillit_merchant_id') || sizeof($this->available_account_types()) == 0) return;

            if (is_admin()) {
                // Add HTML in order edit page
                add_action('woocommerce_admin_order_data_after_order_details', [$this, 'add_invoice_credit_note_urls']);

                // Advanced Custom Fields plugin hides custom fields, we must display them
                add_filter('acf/settings/remove_wp_meta_box', '__return_false');

                // For order update
                /* To be removed
                // For order update by Save button
                add_action('woocommerce_before_save_order_items', [$this, 'before_order_item_save'], 10, 2);
                add_action('woocommerce_saved_order_items', [$this, 'after_order_item_save'], 10, 2);
                */
                // For order update by add/remove item (product/fee/shipping) and recalculate (tax)
                add_action('woocommerce_admin_order_item_headers', [$this, 'after_order_item_update'], 10, 1);
                // For order update using Update post
                add_action('save_post_shop_order', [$this, 'before_order_update'], 10, 2);
                add_action('wp_after_insert_post', [$this, 'after_order_update'], 10, 4);
            } else {
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
                return 'https://api.sandbox.two.inc';
            } else {
                return 'https://api.two.inc';
            }
        }

        /**
         * Get twoinc company seach host based on current settings
         */
        private function get_twoinc_search_host($countryCode){
            if (WC_Twoinc_Helper::is_twoinc_development()) {
                if ($this->get_option('use_prod_company_search') === 'yes') {
                    return "https://{$countryCode}.search.two.inc";
                } else {
                    return "https://{$countryCode}.search.staging.two.inc";
                }
            }
            return "https://{$countryCode}.search.two.inc";
        }

        /**
         * Get merchant's default due in day from DB, or from Twoinc DB
         */
        public function get_merchant_default_days_on_invoice(){

            $days_on_invoice = $this->get_option('days_on_invoice');
            $days_on_invoice_last_checked_on = $this->get_option('days_on_invoice_last_checked_on');

            // Default to 14 days
            if (!$days_on_invoice) {
                $days_on_invoice = 14;
            }

            // if last checked is not within 1 hour, ask Twoinc server
            if (!$days_on_invoice_last_checked_on || ($days_on_invoice_last_checked_on + 3600) <= time()) {

                $twoinc_merchant_id = $this->get_option('tillit_merchant_id');

                if ($twoinc_merchant_id && $this->get_option('api_key')) {

                    // Get the latest due
                    $response = $this->make_request("/v1/merchant/{$twoinc_merchant_id}", [], 'GET');

                    if (is_wp_error($response)) {
                        WC_Twoinc_Helper::send_twoinc_alert_email(
                            "Could not send request to Twoinc server:"
                            . "\r\n- Request: Get merchant default due in days"
                            . "\r\n- Twoinc merchant ID/shortname: " . $twoinc_merchant_id
                            . "\r\n- Site: " . get_site_url());
                    } else {

                        $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
                        if ($twoinc_err) {
                            // Send alert, except when the api key is wrong
                            if(!($response['response'] && $response['response']['code'] && $response['response']['code'] == 401)) {
                                WC_Twoinc_Helper::send_twoinc_alert_email(
                                    "Got error response from Twoinc server:"
                                    . "\r\n- Request: Get merchant default due in days"
                                    . "\r\n- Response message: " . $twoinc_err
                                    . "\r\n- Twoinc merchant ID/shortname: " . $twoinc_merchant_id
                                    . "\r\n- Site: " . get_site_url());
                            }
                        } else {

                            if($response && $response['body']) {
                                $body = json_decode($response['body'], true);
                                if($body['due_in_days']) {
                                    $days_on_invoice = $body['due_in_days'];
                                } else {
                                    // If Twoinc DB has null value, also default to 14 days
                                    $days_on_invoice = 14;
                                }
                            }

                        }

                    }

                }

                $this->update_option('days_on_invoice', $days_on_invoice);
                $this->update_option('days_on_invoice_last_checked_on', time());
            }

            return $days_on_invoice;

        }

        /**
         * Get about twoinc html
         */
        private function get_abt_twoinc_html(){
            if ($this->get_option('show_abt_link') === 'yes') {
                $abt_url = 'https://www.two.inc/what-is-two';
                if (WC_Twoinc_Helper::get_locale() === 'nb_NO') {
                    $abt_url = 'https://www.two.inc/no/what-is-two';
                }
                return '<div id="abt-twoinc-link"><a href="' . $abt_url . '" onclick="javascript:window.open(\'' . $abt_url . '\',\'WhatIsTwoinc\',\'toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=yes, resizable=yes, width=1060, height=700\'); return false;">' . __('What is Two?', 'twoinc-payment-gateway') . '</a>&nbsp;</div>';
            }
            return '';
        }

        /**
         * Get payment description message
         */
        private function get_payment_description_msg(){

            return sprintf(
                '<span class="twoinc-payment-desc payment-desc-global">%s</span><span class="twoinc-payment-desc payment-desc-no-funded">%s</span>',
                __('Receive invoice and payment details via email', 'twoinc-payment-gateway'),
                __('Receive invoice and payment details via email and EHF', 'twoinc-payment-gateway')
            );

        }

        /**
         * Get payment box description
         */
        private function get_pay_box_description(){

            return sprintf(
                '<div>
                    <div class="twoinc-pay-box explain-details">%s</div>
                    <div class="twoinc-pay-box declare-aggrement" style="display: none;">%s</div>
                    <div class="twoinc-pay-box err-payment-default" style="display: none;">%s</div>
                    <div class="twoinc-pay-box err-payment-rejected" style="display: none;">%s</div>
                    <div class="twoinc-pay-box err-buyer-same-seller" style="display: none;">%s</div>
                    <div class="twoinc-pay-box err-amt-max" style="display: none;">%s</div>
                    <div class="twoinc-pay-box err-amt-min" style="display: none;">%s</div>
                    <div class="twoinc-pay-box err-phone" style="display: none;">%s</div>
                </div>',
                __('The latest way to pay for your online business purchases. You will receive an invoice from Two when your order has been processed.', 'twoinc-payment-gateway'),
                sprintf(
                    '%s <span class="twoinc-buyer-name-placeholder">%s</span><span class="twoinc-buyer-name"></span>.',
                    __('By completing the purchase, you verify that you have the legal right to purchase on behalf of', 'twoinc-payment-gateway'),
                    __('your company', 'twoinc-payment-gateway'),
                    $this->get_abt_twoinc_html()
                ),
                __('Invoice purchase is not available for this order', 'twoinc-payment-gateway'),
                __('We\'ve checked your company\'s details and are unable to provide invoice credit for this order', 'twoinc-payment-gateway'),
                __('Buyer and merchant may not be the same company', 'twoinc-payment-gateway'),
                __('Order value exceeds maximum limit', 'twoinc-payment-gateway'),
                __('Order value is below minimum limit', 'twoinc-payment-gateway'),
                __('Phone number is invalid', 'twoinc-payment-gateway')
            );

        }

        /**
         * Get payment subtitle
         */
        public function get_pay_subtitle(){
            return sprintf(
                '<div class="twoinc-subtitle">
                    <div class="twoinc-pay-sub explain-phrase">
                        %s <span class="twoinc-pay-sub require-inputs">%s</span>
                    </div>
                    <img class="twoinc-pay-sub loader" style="display: none!important;" src="%s" />
                </div> ',
                __('Two lets your business pay later for the goods you purchase online.', 'twoinc-payment-gateway'),
                __('Enter your company name to get started.', 'twoinc-payment-gateway'),
                WC_TWOINC_PLUGIN_URL . '/assets/images/loader.svg'
            );
        }

        /**
         * Get payment HTML title
         */
        public function get_pay_html_title(){
            return sprintf(
                '<span class="payment-term-number">%s</span><span class="payment-term-nonumber">%s</span>',
                sprintf(
                    __($this->get_option('title'), 'twoinc-payment-gateway'),
                    '<span class="due-in-days">' . strval($this->get_merchant_default_days_on_invoice()) . '</span>'
                ),
                __('Pay on invoice with agreed terms', 'twoinc-payment-gateway')
            );
        }

        /**
         * Add filter to gateway payment title
         */
        public function change_twoinc_payment_title(){
            add_filter('woocommerce_gateway_title', function ($title, $payment_id) {
                if ($payment_id === 'woocommerce-gateway-tillit') {
                    $title = $this->get_pay_html_title();
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

            if (!isset($_POST['woocommerce_woocommerce-gateway-tillit_merchant_logo']) && !isset($_POST['woocommerce_woocommerce-gateway-tillit_tillit_merchant_id'])) return;

            $image_id = sanitize_text_field($_POST['woocommerce_woocommerce-gateway-tillit_merchant_logo']);

            $image = $image_id ? wp_get_attachment_image_src($image_id, 'full') : null;
            $image_src = $image ? $image[0] : null;

            if (!$image_src) return;

            // Update the logo url for the invoice
            $response = $this->make_request("/v1/merchant/update", [
                'logo_path' => $image_src
            ]);

            if (is_wp_error($response)) {
                WC_Admin_Settings::add_error(__('Could not forward invoice image url to Two', 'twoinc-payment-gateway'));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Could not send request to Twoinc server:"
                    . "\r\n- Request: Update merchant logo"
                    . "\r\n- Site: " . get_site_url());
                return;
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                WC_Admin_Settings::add_error(__('Could not forward invoice image url to Two', 'twoinc-payment-gateway'));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Got error response from Twoinc server:"
                    . "\r\n- Request: Update merchant logo"
                    . "\r\n- Response message: " . $twoinc_err
                    . "\r\n- Site: " . get_site_url());
                //$this->update_option('merchant_logo');
                return;
            }

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
                foreach ($order_refunds as $refund){
                    if ($refund->get_refunded_payment()) {
                        $has_twoinc_refund = true;
                        break;
                    }
                }

                print('<div style="margin-top:20px;float:left;">');

                if ($has_twoinc_refund) {
                    print('<a href="' . $this->twoinc_checkout_host . "/v1/invoice/{$twoinc_order_id}/pdf?lang="
                          . WC_Twoinc_Helper::get_locale()
                          . '"><button type="button" class="button">Download credit note</button></a><br><br>');
                    print('<a href="' . $this->twoinc_checkout_host . "/v1/invoice/{$twoinc_order_id}/pdf?v=original&lang="
                          . WC_Twoinc_Helper::get_locale()
                          . '"><button type="button" class="button">Download original invoice</button></a>');
                } else {
                    print('<a href="' . $this->twoinc_checkout_host . "/v1/invoice/{$twoinc_order_id}/pdf?v=original&lang="
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

            $twoinc_meta = $this->get_save_twoinc_meta($order);
            if (!$twoinc_meta) return;

            if ($action == 'woocommerce_add_order_item') {
                $order->calculate_totals(true);
                $this->process_update_twoinc_order($order, $twoinc_meta, true);
            } else if ($action == 'woocommerce_remove_order_item') {
                $this->process_update_twoinc_order($order, $twoinc_meta, true);
            } else if ($action == 'woocommerce_save_order_items') {
                $this->process_update_twoinc_order($order, $twoinc_meta, true);
            } else if ($action == 'woocommerce_add_order_fee') {
                $this->process_update_twoinc_order($order, $twoinc_meta, true);
            } else if ($action == 'woocommerce_add_order_shipping') {
                $this->process_update_twoinc_order($order, $twoinc_meta, true);
            // } else if ($action == 'woocommerce_add_order_tax') {
            // } else if ($action == 'woocommerce_remove_order_tax') {
            } else if ($action == 'woocommerce_calc_line_taxes') {
                $this->process_update_twoinc_order($order, $twoinc_meta, true);
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
            // @TODO: Edit rework: remove this function after edit is stable

            if (!isset($_POST) || !isset($_POST['action']) || 'editpost' !== sanitize_text_field($_POST['action'])) return;

            $order = wc_get_order($post_id);
            if (!$order || !WC_Twoinc_Helper::is_twoinc_order($order)) {
                return;
            }

            $twoinc_meta = $this->get_save_twoinc_meta($order);
            if (!$twoinc_meta) return;

            // Store hash of twoinc req body
            update_post_meta($order->get_id(), '_twoinc_req_body_hash', WC_Twoinc_Helper::hash_order($order, $twoinc_meta));

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

            $twoinc_meta = $this->get_save_twoinc_meta($order);
            if (!$twoinc_meta) return;

            $this->process_update_twoinc_order($order, $twoinc_meta);

        }

        /**
         * Before item "Save" button
         *
         * @param $order_id
         * @param $items
         */
        /* To be removed
        public function before_order_item_save($order_id, $items)
        {

            $order = wc_get_order($order_id);
            if (!WC_Twoinc_Helper::is_twoinc_order($order)) {
                return;
            }

            $twoinc_meta = $this->get_save_twoinc_meta($order);
            if (!$twoinc_meta) return;

            // Store hash of twoinc req body
            update_post_meta($order->get_id(), '_twoinc_req_body_hash', WC_Twoinc_Helper::hash_order($order, $twoinc_meta));

        }
        */

        /**
         * After item "Save" button
         * Notify Twoinc API after the order is updated
         *
         * @param $order_id
         * @param $items
         */
        /* To be removed
        public function after_order_item_save($order_id, $items)
        {

            $order = wc_get_order($order_id);
            if (!WC_Twoinc_Helper::is_twoinc_order($order)) {
                return;
            }

            $twoinc_meta = $this->get_save_twoinc_meta($order);
            if (!$twoinc_meta) return;

            $this->process_update_twoinc_order($order, $twoinc_meta, true);

        }
        */

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

                $twoinc_merchant_id = $this->get_option('tillit_merchant_id');
                if (!$twoinc_merchant_id) {
                    WC()->session->set('chosen_payment_method', 'cod');
                    WC_Twoinc_Helper::send_twoinc_alert_email(
                        "Could not find Twoinc merchant ID/shortname:"
                        . "\r\n- Request: Get invoice fee"
                        . "\r\n- Site: " . get_site_url());
                    return;
                }

                // Get invoice fixed fee
                $response = $this->make_request("/v1/merchant/{$twoinc_merchant_id}", [], 'GET');

                if (is_wp_error($response)) {
                    WC()->session->set('chosen_payment_method', 'cod');
                    WC_Twoinc_Helper::send_twoinc_alert_email(
                        "Could not send request to Twoinc server:"
                        . "\r\n- Request: Get invoice fee"
                        . "\r\n- Twoinc merchant ID/shortname: " . $twoinc_merchant_id
                        . "\r\n- Site: " . get_site_url());
                    return;
                }

                $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
                if ($twoinc_err) {
                    WC()->session->set('chosen_payment_method', 'cod');
                    WC_Twoinc_Helper::send_twoinc_alert_email(
                        "Got error response from Twoinc server:"
                        . "\r\n- Request: Get invoice fee"
                        . "\r\n- Response message: " . $twoinc_err
                        . "\r\n- Twoinc merchant ID/shortname: " . $twoinc_merchant_id
                        . "\r\n- Site: " . get_site_url());
                    return;
                }

                $body = json_decode($response['body'], true);

                $invoice_fixed_fee = $body['fixed_fee_per_order'];

                //$invoice_percentage_fee = ($woocommerce->cart->cart_contents_total + $woocommerce->cart->tax_total + $woocommerce->cart->shipping_total + $woocommerce->cart->shipping_tax_total) * $percentage;
                $woocommerce->cart->add_fee('Invoice fee', $invoice_fixed_fee, false, '');
            }

        }

        /**
         * Another hook to call the function on_order_completed
         *
         * @param $order_id
         * @param $to_status
         */
        public static function on_order_edit_status($order_id, $to_status){
            $wc_twoinc_instance = WC_Twoinc::get_instance();

            $to_status = strtolower($to_status);
            if ($to_status == 'completed') {
                $wc_twoinc_instance->on_order_completed($order_id);
            } else if ($to_status == 'cancelled') {
                $wc_twoinc_instance->on_order_cancelled($order_id);
            }
        }

        /**
         * Hook to call upon bulk order update to completed or cancelled status
         *
         * @param $redirect
         * @param $doaction
         * @param $object_ids
         */
        public static function on_order_bulk_edit_action($redirect, $doaction, $object_ids){
            $wc_twoinc_instance = WC_Twoinc::get_instance();
            $success = [];
            $failure = [];
            if('mark_completed' === $doaction) {
                foreach ($object_ids as $order_id) {
                    $result = $wc_twoinc_instance->on_order_completed($order_id);
                    if ($result === true) {
                        $success[] = $order_id;
                    } else if ($result === false) {
                        $failure[] = $order_id;
                    }
                }
                $redirect = add_query_arg(
                    array(
                        'bulk_action' => 'marked_completed',
                        'two_success' => implode(",", $success),
                        'two_failure' => implode(",", $failure),
                    ),
                    $redirect
                );
            } else if ('mark_cancelled' === $doaction){
                foreach ($object_ids as $order_id) {
                    $result = $wc_twoinc_instance->on_order_cancelled($order_id);
                    if ($result === true) {
                        $success[] = $order_id;
                    } else if ($result === false) {
                        $failure[] = $order_id;
                    }
                }
                $redirect = add_query_arg(
                    array(
                        'bulk_action' => 'marked_cancelled',
                        'two_success' => implode(",", $success),
                        'two_failure' => implode(",", $failure),
                    ),
                    $redirect
                );
            }
            return $redirect;
        }

        /**
         * Notice for when orders are bulk edited
         *
         */
        public static function on_order_bulk_edit_notices() {
            if (!isset($_REQUEST['bulk_action'])) return;

            $bulk_action = $_REQUEST['bulk_action'];
            if (!in_array($bulk_action, ["marked_completed", "marked_cancelled"])) return;

            $failure_order_ids = [];
            if (isset($_REQUEST['two_failure']) && $_REQUEST['two_failure']) {
                $failure_order_ids = explode(",", $_REQUEST['two_failure']);
            }
            $success_order_ids = [];
            if (isset($_REQUEST['two_success']) && $_REQUEST['two_success']) {
                $success_order_ids = explode(",", $_REQUEST['two_success']);
            }
            $success = count($success_order_ids);
            if ($_REQUEST[ 'bulk_action' ] == "marked_completed") {
                if ($success) {
                    $success_notice = _n(
                        'Two has acknowledged request to fulfill %d order. An invoice will be sent to the buyer when the fulfilment is complete.',
                        'Two has acknowledged request to fulfill %d orders. Invoices will be sent to the buyers when the fulfilments are complete.',
                        $success, 'twoinc-payment-gateway'
                    );
                    printf('<div id="message" class="notice notice-success is-dismissible"><p>' . $success_notice . '</p></div>', $success);
                }
                foreach ($failure_order_ids as $order_id) {
                    $failure_notice = __('Two has failed to issue invoice for order <a href="%s">%s</a>.', 'twoinc-payment-gateway');
                    printf('<div id="message" class="notice notice-error is-dismissible"><p>' . $failure_notice . '</p></div>', wc_get_order($order_id)->get_edit_order_url(), $order_id);
                }
            } else if ($_REQUEST['bulk_action'] == "marked_cancelled") {
                if ($success) {
                    $success_notice = _n('Two has cancelled %d order.', 'Two has cancelled %d orders.', $success, 'twoinc-payment-gateway');
                    printf('<div id="message" class="notice notice-success is-dismissible"><p>' . $success_notice . '</p></div>', $success);
                }
                foreach ($failure_order_ids as $order_id) {
                    $failure_notice = __('Two has failed to cancel order <a href="%s">%s</a>.', 'twoinc-payment-gateway');
                    printf('<div id="message" class="notice notice-error is-dismissible"><p>' . $failure_notice . '</p></div>', wc_get_order($order_id)->get_edit_order_url(), $order_id);
                }
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
            if (!$twoinc_order_id) {
                $order->add_order_note(__('Could not update status to "Fulfilled" with Two because the order is missing Two order ID.', 'twoinc-payment-gateway'));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Could not find Two order ID:"
                    . "\r\n- Request: Fulfill order"
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url());
                return false;
            }

            $state = get_post_meta($order_id, '_twoinc_order_state', true);
            $skip = ["FULFILLING", "FULFILLED", "DELIVERED", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED"];
            if (in_array($state, $skip)) {
                // $order->add_order_note(sprintf(__('Order is already fulfilled with Two.', 'twoinc-payment-gateway'), $twoinc_order_id));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Order already fulfilled:"
                        . "\r\n- Request: Fulfill order"
                        . "\r\n- Twoinc order ID: " . $twoinc_order_id
                        . "\r\n- Merchant post ID: " . strval($order_id)
                        . "\r\n- Site: " . get_site_url());
                return;
            }

            // Change the order status
            $response = $this->make_request("/v1/order/{$twoinc_order_id}/fulfillments");

            if (is_wp_error($response)) {
                $order->add_order_note(sprintf(__('Could not update status to "Fulfilled" with Two, please check with Two admin for id %s.', 'twoinc-payment-gateway'), $twoinc_order_id));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Could not send request to Twoinc server:"
                    . "\r\n- Request: Fulfill order"
                    . "\r\n- Twoinc order ID: " . $twoinc_order_id
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url());
                return false;
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                $order->add_order_note(sprintf(__('Could not update status to "Fulfilled" with Two, please check with Two admin for id %s. Response message: %s', 'twoinc-payment-gateway'), $twoinc_order_id, $twoinc_err));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Got error response from Twoinc server:"
                    . "\r\n- Request: Fulfill order"
                    . "\r\n- Response message: " . $twoinc_err
                    . "\r\n- Twoinc order ID: " . $twoinc_order_id
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url());
                return false;
            }

            // Add order note
            $order->add_order_note(__('Two has acknowledged the request to fulfil the order. An invoice will be sent to the buyer when the fulfilment is complete.', 'twoinc-payment-gateway'));

            // Decode the response
            $body = json_decode($response['body'], true);
            update_post_meta($order->get_id(), '_twoinc_order_state', 'FULFILLING');
            do_action('twoinc_order_completed', $order, $body);
            return true;
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
            $twoinc_order_id = $this->get_twoinc_order_id_from_post_id($order_id);

            if (!$twoinc_order_id) {
                $order->add_order_note(__('Could not update status to "Cancelled" with Two because the order is missing Two order ID.', 'twoinc-payment-gateway'));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Could not find Twoinc order ID:"
                    . "\r\n- Request: Cancel order"
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url());
                return false;
            }

            $state = get_post_meta($order->get_id(), '_twoinc_order_state', true);
            if ($state == 'CANCELLED') {
                // $order->add_order_note(sprintf(__('Order is already cancelled with Two.', 'twoinc-payment-gateway'), $twoinc_order_id));
                return;
            }

            // Change the order status
            $response = $this->make_request("/v1/order/{$twoinc_order_id}/cancel");

            if (is_wp_error($response)) {
                $order->add_order_note(sprintf(__('Could not update status to "Cancelled", please check with Two admin for id %s', 'twoinc-payment-gateway'), $twoinc_order_id));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Could not send request to Twoinc server:"
                    . "\r\n- Request: Cancel order"
                    . "\r\n- Twoinc order ID: " . $twoinc_order_id
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url());
                return false;
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                $order->add_order_note(sprintf(__('Could not update status to "Cancelled", please check with Two admin for id %s. Response message: %s', 'twoinc-payment-gateway'), $twoinc_order_id, $twoinc_err));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Got error response from Twoinc server:"
                    . "\r\n- Request: Cancel order"
                    . "\r\n- Response message: " . $twoinc_err
                    . "\r\n- Twoinc order ID: " . $twoinc_order_id
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url());
                return false;
            }

            update_post_meta($order->get_id(), '_twoinc_order_state', "CANCELLED");
            do_action('twoinc_order_cancelled', $order, $response);
            return true;
        }

        /**
         * Static function wrapper for List out-of-sync orders
         *
         * @param request
         */
        public static function list_out_of_sync_order_ids_wrapper(){
            $start_time = null;
            if ($_REQUEST['start_time']) {
                $start_time = strtotime($_REQUEST['start_time']);
                if (!$start_time) {
                    return new WP_Error('invalid_request', 'invalid start_time', array('status' => 400));
                }
            }
            $end_time = null;
            if ($_REQUEST['end_time']) {
                $end_time = strtotime($_REQUEST['end_time']);
                if (!$end_time) {
                    return new WP_Error('invalid_request', 'invalid end_time', array('status' => 400));
                }
            }

            $wc_twoinc_instance = WC_Twoinc::get_instance();

            if (!WC_Twoinc_Helper::auth_rest_request($wc_twoinc_instance)) {
                return new WP_Error('unauthorized', 'Unauthorized', array('status' => 401));
            }

            return $wc_twoinc_instance->list_out_of_sync_order_ids($start_time, $end_time);
        }

        /**
         * List all out-of-sync orders
         */
        public function list_out_of_sync_order_ids($start_time, $end_time){
            global $wpdb;
            $ids = array();

            // Get orders with Two and Woocommerce status not in sync
            $pair_conditions = [];
            $query_args = [
                'twoinc_order_id', 'tillit_order_id', '_twoinc_order_state', 'shop_order',
                'wc-pending', 'wc-failed', 'trash'];
            foreach (self::$status_to_states as $wc_status => $states) {
                $pair_condition = ['p.post_status = %s'];
                $query_args[] = 'wc-' . $wc_status;
                foreach ($states as $state) {
                    $pair_condition[] = 'pm2.meta_value != %s';  // twoinc_state
                    $query_args[] = $state;
                }
                $pair_conditions[] = '(' . implode(' AND ', $pair_condition) . ')';
            }
            $time_conditions = '';
            if ($start_time) {
                $time_conditions .= ' AND p.post_modified >= "' . date('Y-m-d H:i:s', $start_time) . '"';
            }
            if ($end_time) {
                $time_conditions .= ' AND p.post_modified <= "' . date('Y-m-d H:i:s', $end_time) . '"';
            }
            $select_out_of_sync_q_str = "" .
                "SELECT pm.post_id, p.post_status, p.post_modified, pm.meta_value AS twoinc_oid, pm2.meta_value AS twoinc_state" .
                "  FROM $wpdb->posts p" .
                "  LEFT JOIN $wpdb->postmeta pm ON p.id = pm.post_id AND (pm.meta_key = %s OR pm.meta_key = %s)" .
                "  LEFT JOIN $wpdb->postmeta pm2 ON p.id = pm2.post_id AND pm2.meta_key = %s" .
                "  WHERE p.post_type = %s AND p.post_status NOT IN (%s, %s, %s)" . $time_conditions .
                "    AND (" . implode(' OR ', $pair_conditions) . ")";
            $select_out_of_sync = call_user_func_array(
                [$wpdb, 'prepare'],
                array_merge([$select_out_of_sync_q_str], $query_args));
            $results = $wpdb->get_results($select_out_of_sync);
            foreach ($results as $row) {
                $ids[$row->post_id] = [
                    'two_state' => $row->twoinc_state,
                    'two_id' => $row->twoinc_oid,
                    'wp_status' => $row->post_status,
                    'modified_on' => $row->post_modified
                ];
            }
            // Get Two orders without Two state meta
            $select_no_two_state = $wpdb->prepare(
                "SELECT p.id, p.post_status, p.post_modified, pm.meta_value AS twoinc_oid" .
                "  FROM $wpdb->posts p" .
                "  LEFT JOIN $wpdb->postmeta pm ON p.id = pm.post_id AND (pm.meta_key = %s OR pm.meta_key = %s)" .
                "  WHERE p.post_type = %s AND p.post_status NOT IN (%s, %s, %s)" . $time_conditions .
                "    AND p.id IN (SELECT post_id FROM $wpdb->postmeta WHERE meta_key = %s AND meta_value = %s)" .
                "    AND p.id NOT IN (SELECT post_id FROM $wpdb->postmeta WHERE meta_key = %s)",
                'twoinc_order_id', 'tillit_order_id', 'shop_order', 'wc-pending', 'wc-failed', 'trash',
                '_payment_method', 'woocommerce-gateway-tillit', '_twoinc_order_state');
            $results = $wpdb->get_results($select_no_two_state);
            foreach ($results as $row) {
                $ids[$row->id] = [
                    'two_state' => null,
                    'two_id' => $row->twoinc_oid,
                    'wp_status' => $row->post_status,
                    'modified_on' => $row->post_modified
                ];
            }

            return ['out_of_sync_orders' => $ids, 'count' => sizeof($ids), 'plugin_version' => get_plugin_version()];
        }

        /**
         * Static function wrapper for Sync orders
         */
        public static function sync_order_state_wrapper(){
            $order_id = $_REQUEST['post_id'];
            $persist = $_REQUEST['persist'] === 'true';
            if (!isset($order_id)) {
                return new WP_Error('invalid_request', 'Missing post id', array('status' => 400));
            }

            $wc_twoinc_instance = WC_Twoinc::get_instance();

            if (!WC_Twoinc_Helper::auth_rest_request($wc_twoinc_instance)) {
                return new WP_Error('unauthorized', 'Unauthorized', array('status' => 401));
            }

            return $wc_twoinc_instance->sync_order_state($order_id, $persist);
        }

        /**
         * Sync orders
         *
         * @param $order_id
         */
        public function sync_order_state($order_id, $persist){
            // Get the order object
            $order = new WC_Order($order_id);

            // Check payment method
            if (!WC_Twoinc_Helper::is_twoinc_order($order)) {
                return new WP_Error('invalid_request', 'The order is not paid by Two', array('status' => 400));
            }

            // Get the Twoinc order ID from shop order ID
            $twoinc_order_id = $this->get_twoinc_order_id_from_post_id($order_id);
            if (!$twoinc_order_id) {
                return new WP_Error('invalid_data', 'Could not find Twoinc order ID', array('status' => 422));
            }

            // Get the Twoinc order details
            $response = $this->make_request("/v1/order/{$twoinc_order_id}", [], 'GET');

            // Stop if request error or $response['response']['code'] < 400
            if (is_wp_error($response)) {
                return new WP_Error('internal_server_error', 'Could not send request to Twoinc server', array('status' => 500));
            }
            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                return new WP_Error('internal_server_error', 'Got error response from Twoinc server: ' . $twoinc_err, array('status' => 500));
            }

            // Got the latest state from Two server
            $messages = [];
            $state = null;
            if ($response && $response['body']) {
                $body = json_decode($response['body'], true);
                if (isset($body['state'])) {
                    $state = strval($body['state']);
                }
            }
            if (!isset($state)) {
                return new WP_Error('internal_server_error', 'Could not get Two state from response body', array('status' => 500));
            }
            // If the order is an old one without state, update it
            $current_state_in_db = get_post_meta($order_id, '_twoinc_order_state', true);
            if (!isset($current_state_in_db) || $current_state_in_db != $state) {
                $messages[] = 'Updated state from [' . $current_state_in_db . '] to [' . $state . '] for order ID [' . $order_id . ']';
                if ($persist) {
                    update_post_meta($order_id, '_twoinc_order_state', $state);
                }
            }

            // Forward actions to Two when necessary
            $wc_status = $order->get_status();
            if (!array_key_exists($wc_status, self::$status_to_states) || in_array($state, self::$status_to_states[$wc_status], true)) {
                $messages[] = 'No action needed: status[' . $wc_status . '], state[' . $state . ']';
            } else {
                $result = false;
                if ($wc_status == 'completed') {
                    if ($persist) {
                        $result = $this->on_order_completed($order_id);
                    }
                    $messages[] = 'Fulfilled order ID [' . $order_id . ']';
                } else if ($wc_status == 'cancelled') {
                    if ($persist) {
                        $result = $this->on_order_cancelled($order_id);
                    }
                    $messages[] = 'Cancelled order ID [' . $order_id . ']';
                } else if ($wc_status == 'refunded') {
                    return new WP_Error('not_implemented', 'Refund update coming soon', array('status' => 501));
                    //$this->process_refund($order_id);
                }
                if (!$result) {
                    return new WP_Error('internal_server_error', 'Unable to sync: status[' . $wc_status . '], state[' . $state . ']', array('status' => 500));
                }
            }
            return [
                'message' => $messages,
                'persist' => $persist,
                'data' => [
                    'status' => 200
                ]
            ];

        }

        /**
         * Static function wrapper for getting configs
         */
        public static function get_plugin_configs_wrapper(){
            $wc_twoinc_instance = WC_Twoinc::get_instance();

            if (!WC_Twoinc_Helper::auth_rest_request($wc_twoinc_instance)) {
                return new WP_Error('unauthorized', 'Unauthorized', array('status' => 401));
            }

            return $wc_twoinc_instance->get_plugin_configs();
        }

        /**
         * Get config values
         */
        public function get_plugin_configs(){
            return [
                'config' => array_diff_key($this->settings, array_flip(['api_key'])),
                'plugin_version' => get_plugin_version(),
                'data' => [
                    'status' => 200
                ]
            ];

        }

        /**
         * Static function wrapper for getting order info
         */
        public static function get_order_info_wrapper(){
            $order_id = $_REQUEST['post_id'];
            if (!isset($order_id)) {
                return new WP_Error('invalid_request', 'Missing post id', array('status' => 400));
            }

            $wc_twoinc_instance = WC_Twoinc::get_instance();

            if (!WC_Twoinc_Helper::auth_rest_request($wc_twoinc_instance)) {
                return new WP_Error('unauthorized', 'Unauthorized', array('status' => 401));
            }

            return $wc_twoinc_instance->get_order_info($order_id);
        }

        /**
         * Get order info: state, current create request, notes
         */
        public function get_order_info($order_id){
            // Get the order object
            $order = new WC_Order($order_id);

            // Check payment method
            if (!WC_Twoinc_Helper::is_twoinc_order($order)) {
                return new WP_Error('invalid_request', 'The order is not paid by Two', array('status' => 400));
            }

            // Get the Twoinc order ID from shop order ID
            $twoinc_order_id = $this->get_twoinc_order_id_from_post_id($order_id);
            if (!$twoinc_order_id) {
                return new WP_Error('invalid_data', 'Could not find Twoinc order ID', array('status' => 422));
            }

            $twoinc_order_body = null;
            // If the order is an old one without state, update it
            $current_state_in_db = get_post_meta($order_id, '_twoinc_order_state', true);
            $twoinc_meta = $this->get_save_twoinc_meta($order);
            if ($twoinc_meta) {
                $twoinc_order_body = WC_Twoinc_Helper::compose_twoinc_order(
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
            }

            return [
               'twoinc_state' => $current_state_in_db,
               'wp_status' => 'wc-' . $order->get_status(),
               'order_note' => WC_Twoinc_Helper::get_private_order_notes($order_id),
               'twoinc_order_body' => $twoinc_order_body,
               'data' => [
                   'status' => 200
               ]
           ];
        }

        /**
         * Display user meta fields on user edit admin page
         *
         * @param $user
         *
         * @return void
         */
        static public function display_user_meta_edit($user)
        {
            ?>
                <h3><?php _e('Two pre-filled fields', 'twoinc-payment-gateway'); ?></h3>

                <table class="form-table">
                <tr>
                    <th><label for="twoinc_billing_company"><?php _e('Billing Company name', 'twoinc-payment-gateway'); ?></label></th>
                    <td>
                        <input type="text" name="twoinc_billing_company" id="twoinc_billing_company" value="<?php echo esc_attr(get_the_author_meta('twoinc_billing_company', $user->ID)); ?>" class="regular-text" />
                    </td>
                </tr>
                <tr>
                    <th><label for="twoinc_company_id"><?php _e('Billing Company ID', 'twoinc-payment-gateway'); ?></label></th>
                    <td>
                        <input type="text" name="twoinc_company_id" id="twoinc_company_id" value="<?php echo esc_attr(get_the_author_meta('twoinc_company_id', $user->ID)); ?>" class="regular-text" />
                    </td>
                </tr>
                <tr>
                    <th><label for="twoinc_department"><?php _e('Department', 'twoinc-payment-gateway'); ?></label></th>
                    <td>
                        <input type="text" name="twoinc_department" id="twoinc_department" value="<?php echo esc_attr(get_the_author_meta('twoinc_department', $user->ID)); ?>" class="regular-text" />
                        <br />
                        <span class="description"><?php _e("The department displayed on the invoices"); ?></span>
                    </td>
                </tr>
                <tr>
                    <th><label for="twoinc_project"><?php _e('Project', 'twoinc-payment-gateway'); ?></label></th>
                    <td>
                        <input type="text" name="twoinc_project" id="twoinc_project" value="<?php echo esc_attr(get_the_author_meta('twoinc_project', $user->ID)); ?>" class="regular-text" />
                        <br />
                        <span class="description"><?php _e("The project displayed on the invoices"); ?></span>
                    </td>
                </tr>
                </table>
            <?php
        }

        /**
         * Save user meta to DB on user edit
         *
         * @param $user_id
         *
         * @return void
         */
        static public function save_user_meta($user_id)
        {

            if (empty($_POST['_wpnonce']) || ! wp_verify_nonce($_POST['_wpnonce'], 'update-user_' . $user_id)) {
                return;
            }

            if (!current_user_can('edit_user', $user_id)) {
                return false;
            }

            update_user_meta($user_id, 'twoinc_company_id', $_POST['twoinc_company_id']);
            update_user_meta($user_id, 'twoinc_billing_company', $_POST['twoinc_billing_company']);
            update_user_meta($user_id, 'twoinc_department', $_POST['twoinc_department']);
            update_user_meta($user_id, 'twoinc_project', $_POST['twoinc_project']);

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

            // Temporarily disable the feature
            // if (!WC_Twoinc_Helper::is_country_supported($order->get_billing_country())) {
            //     WC_Twoinc_Helper::display_ajax_error(__('Two is not available as a payment option in the selected region', 'twoinc-payment-gateway') . $order->get_billing_country());
            //     return;
            // }

            // Get data
            $company_id = array_key_exists('company_id', $_POST) ? sanitize_text_field($_POST['company_id']) : '';
            $department = array_key_exists('department', $_POST) ? sanitize_text_field($_POST['department']) : '';
            $project = array_key_exists('project', $_POST) ? sanitize_text_field($_POST['project']) : '';
            $purchase_order_number = array_key_exists('purchase_order_number', $_POST) ? sanitize_text_field($_POST['purchase_order_number']) : '';
            $tracking_id = array_key_exists('tracking_id', $_POST) ? sanitize_text_field($_POST['tracking_id']) : '';
            $tillit_merchant_id = $this->get_option('tillit_merchant_id');
            $order_reference = wp_generate_password(64, false, false);
            // For requests from order pay page
            $billing_country = array_key_exists('billing_country', $_POST) ? sanitize_text_field($_POST['billing_country']) : '';
            $billing_company = array_key_exists('billing_company', $_POST) ? sanitize_text_field($_POST['billing_company']) : '';
            $billing_phone = array_key_exists('billing_phone', $_POST) ? sanitize_text_field($_POST['billing_phone']) : '';
            $invoice_email = array_key_exists('invoice_email', $_POST) ? sanitize_text_field($_POST['invoice_email']) : '';
            $invoice_emails = $invoice_email ? [$invoice_email] : [];

            // Store the order meta
            update_post_meta($order_id, '_tillit_order_reference', $order_reference);
            update_post_meta($order_id, '_tillit_merchant_id', $tillit_merchant_id);
            update_post_meta($order_id, 'company_id', $company_id);
            update_post_meta($order_id, 'department', $department);
            update_post_meta($order_id, 'project', $project);
            update_post_meta($order_id, 'purchase_order_number', $purchase_order_number);
            // For requests from order pay page: Store in order object, not DB
            if ($billing_country) {
                $order->set_billing_country($billing_country);
            }
            if ($billing_company) {
                $order->set_billing_company($billing_company);
            }
            if ($billing_phone) {
                $order->set_billing_phone($billing_phone);
            }

            // Get payment details
            $payment_reference_message = '';// strval($order_id);
            if(has_filter('two_payment_reference_message')) {
                $payment_reference_message = apply_filters('two_payment_reference_message', $order_id);
                update_post_meta($order_id, '_payment_reference_message', $payment_reference_message);
            }
            $payment_reference_ocr = '';
            if(has_filter('two_payment_reference_ocr')) {
                $payment_reference_ocr = apply_filters('two_payment_reference_ocr', $order_id);
                update_post_meta($order_id, '_payment_reference_ocr', $payment_reference_ocr);
            }
            $payment_reference = '';
            $payment_reference_type = '';
            if(has_filter('two_payment_reference')) {
                $payment_reference = apply_filters('two_payment_reference', $order_id);
                update_post_meta($order_id, '_payment_reference', $payment_reference);
                $payment_reference_type = 'assigned_by_merchant';
                update_post_meta($order_id, '_payment_reference_type', $payment_reference_type);
            }
            update_post_meta($order_id, '_invoice_emails', $invoice_emails);

            // Save to user meta
            $user_id = wp_get_current_user()->ID;
            if ($user_id) {
                if (!get_the_author_meta('twoinc_company_id', $user_id)) update_user_meta($user_id, 'twoinc_company_id', $company_id);
                if (!get_the_author_meta('twoinc_billing_company', $user_id)) update_user_meta($user_id, 'twoinc_billing_company', $billing_company);
                if (!get_the_author_meta('twoinc_department', $user_id)) update_user_meta($user_id, 'twoinc_department', $department);
                if (!get_the_author_meta('twoinc_project', $user_id)) update_user_meta($user_id, 'twoinc_project', $project);
            }

            // Create order
            $response = $this->make_request('/v1/order', WC_Twoinc_Helper::compose_twoinc_order(
                $order,
                $order_reference,
                $company_id,
                $department,
                $project,
                $purchase_order_number,
                $invoice_emails,
                $payment_reference_message,
                $payment_reference_ocr,
                $payment_reference,
                $payment_reference_type,
                $tracking_id
            ));

            if (is_wp_error($response)) {
                $order->add_order_note(__('Could not request to create Two order', 'twoinc-payment-gateway'));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Could not send request to Twoinc server:"
                    . "\r\n- Request: Create order"
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url());
                return;
            }

            // Stop on process payment failure
            if (isset($response) && isset($response['result']) && $response['result'] === 'failure') {
                $order->add_order_note(__('Failed to process payment', 'twoinc-payment-gateway'));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Got error response from Twoinc server:"
                    . "\r\n- Request: Create order"
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url());
                return $response;
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_validation_msg($response);
            if ($twoinc_err) {
                WC_Twoinc_Helper::display_ajax_error($twoinc_err);
                return;
            }

            // Decode the response
            $body = json_decode($response['body'], true);

            if ($body['status'] == 'REJECTED') {
                WC_Twoinc_Helper::display_ajax_error(__('We\'ve checked your company\'s details and are unable to provide invoice credit for this order', 'twoinc-payment-gateway'));
                return;
            }

            // Store the Twoinc Order Id for future use
            update_post_meta($order_id, 'twoinc_order_id', $body['id']);
            $twoinc_meta = $this->get_save_twoinc_meta($order, $body['id']);
            $twoinc_updated_order_hash = WC_Twoinc_Helper::hash_order($order, $twoinc_meta);
            update_post_meta($order->get_id(), '_twoinc_req_body_hash', $twoinc_updated_order_hash);

            if (isset($body['state'])) {
                update_post_meta($order_id, '_twoinc_order_state', $body['state']);
            }
            do_action('twoinc_order_created', $order, $body);

            // Return the result
            if ($body['state'] == 'VERIFIED' && isset($body['merchant_urls']) && isset($body['merchant_urls']['merchant_confirmation_url'])) {
                return [
                    'result'    => 'success',
                    'redirect'  => $body['merchant_urls']['merchant_confirmation_url']
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
            if (!$twoinc_order_id) {
                $order->add_order_note(__('Failed to request refund order to Two', 'twoinc-payment-gateway'));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Could not find Twoinc order ID:"
                    . "\r\n- Request: Refund order"
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url());
                return new WP_Error('invalid_twoinc_refund',
                    __('Could not find Two order ID', 'twoinc-payment-gateway'));
            }

            // Get and check refund data
            $state = get_post_meta($order_id, '_twoinc_order_state', true);
            if ($state === 'REFUNDED') {
                return new WP_Error(
                    'invalid_twoinc_refund',
                    $order_id . ': ' . __('This order has already been fully refunded', 'twoinc-payment-gateway')
                );
            }
            // if ($order->get_status() !== 'completed') {
            //     return new WP_Error('invalid_twoinc_refund',
            //         __('Only "Completed" orders can be refunded by Two', 'twoinc-payment-gateway'));
            // }

            $order_refunds = $order->get_refunds();
            // Need to loop instead of getting the last element because the last element is not always the latest refund
            $order_refund = null;
            foreach ($order_refunds as $refund){
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
                "/v1/order/{$twoinc_order_id}/refund",
                WC_Twoinc_Helper::compose_twoinc_refund(
                    $order_refund,
                    -$amount,
                    $order->get_currency()
                ),
                'POST'
            );

            // Stop if request error
            if (is_wp_error($response)) {
                $order->add_order_note(__('Failed to request refund order to Two', 'twoinc-payment-gateway'));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Could not send request to Twoinc server:"
                    . "\r\n- Request: Refund order"
                    . "\r\n- Twoinc order ID: " . $twoinc_order_id
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url());
                return false;
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                $order->add_order_note(sprintf(__('Failed to request refund order to Two, please check with Two admin for id %s', 'twoinc-payment-gateway'), $twoinc_order_id));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Got error response from Twoinc server:"
                    . "\r\n- Request: Refund order"
                    . "\r\n- Response message: " . $twoinc_err
                    . "\r\n- Twoinc order ID: " . $twoinc_order_id
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url());
                return new WP_Error('invalid_twoinc_refund',
                    __('Request refund order to Two has errors', 'twoinc-payment-gateway'));
            }

            // Decode the response
            $body = json_decode($response['body'], true);

            // Check if response is ok
            if (!$body['amount']) {
                $order->add_order_note(sprintf(__('Failed to refund order with Two, please check with Two admin for id %s', 'twoinc-payment-gateway'), $twoinc_order_id));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Got invalid response from Twoinc server:"
                    . "\r\n- Request: Refund order"
                    . "\r\n- Response details: missing amount"
                    . "\r\n- Twoinc order ID: " . $twoinc_order_id
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url());
                return new WP_Error('invalid_twoinc_refund',
                    __('Failed to refund order with Two', 'twoinc-payment-gateway'));
            }

            $state = "";
            $remaining_amt = $order->get_total() + (float) $body['amount'];
            if ($remaining_amt < 0.0001 && $remaining_amt > -0.0001) { // full refund, 0.0001 for float inaccuracy
                $order->add_order_note(__('Invoice has been refunded and credit note has been sent by Two', 'twoinc-payment-gateway'));
                $state = "REFUNDED";
            } else { // partial refund
                $order->add_order_note(__('Invoice has been partially refunded and credit note has been sent by Two', 'twoinc-payment-gateway'));
                $state = "PARTIALLY_REFUNDED";
            }

            update_post_meta($order_id, '_twoinc_order_state', $state);
            do_action('twoinc_order_refunded', $order, $body);

            return [
                'result'    => 'success',
                'refresh'  => true
            ];

        }

        /**
         * Process the order confirmation, with redirection to confirmation/cancel page using response header
         *
         * @return void
         */
        static public function process_confirmation_header_redirect()
        {

            $wc_twoinc_instance = WC_Twoinc::get_instance();
            $redirect_url = $wc_twoinc_instance->process_confirmation();

            // Execute redirection by header
            if (isset($redirect_url)) {
                wp_redirect($redirect_url);
                exit;
            }

        }

        /**
         * Process the order confirmation, with redirection to confirmation/cancel page using JS
         *
         * @return void
         */
        static public function process_confirmation_js_redirect()
        {

            $wc_twoinc_instance = WC_Twoinc::get_instance();
            $redirect_url = $wc_twoinc_instance->process_confirmation();

            // Execute redirection JS
            if (isset($redirect_url)) {
                printf('<script>window.location.href = "%s";</script>', $redirect_url);
            }

        }

        /**
         * Set header to avoid 404 on confirmation page
         *
         * @return void
         */
        static public function before_process_confirmation()
        {

            $wc_twoinc_instance = WC_Twoinc::get_instance();
            // Set status to avoid 404 for confirmation page
            if ($wc_twoinc_instance->is_confirmation_page()) status_header(200);

        }

        /**
         * Check if current page is Two confirmation page
         *
         * @return bool
         */
        private function is_confirmation_page()
        {

            if (isset($_REQUEST['twoinc_confirm_order']) && isset($_REQUEST['nonce'])) {
                return true;
                // Temporarily commented out until we find a solution for redirect plugins
                // $confirm_path = '/twoinc-payment-gateway/confirm';
                // $req_path = strtok($_SERVER["REQUEST_URI"], '?');
                // return strlen($req_path) >= strlen($confirm_path) && substr($req_path, -strlen($confirm_path)) === $confirm_path;
            }
            return false;
        }

        /**
         * Process the order confirmation
         *
         * @return void|string
         */
        private function process_confirmation()
        {

            // Stop if this is not confirmation page
            if (!$this->is_confirmation_page()) return;

            // Make sure this function is called only once per run
            if (property_exists($this, 'twoinc_process_confirmation_called')) return;

            // Make sure this function is called only once per run
            $this->twoinc_process_confirmation_called = true;

            // Add status header to avoid being mistaken as 404 by other plugins
            status_header(200);

            // Get the order reference
            $order_reference = sanitize_text_field($_REQUEST['twoinc_confirm_order']);

            if ($this->get_option('skip_confirm_auth') !== 'yes') {
                // Get the nonce
                $nonce = $_REQUEST['nonce'];

                // Stop if the code is not valid
                if (!wp_verify_nonce($nonce, 'twoinc_confirm')) {
                    WC_Twoinc_Helper::send_twoinc_alert_email(
                        "Invalid nonce:"
                        . "\r\n- Request: Confirm order"
                        . "\r\n- Order reference: " . $order_reference
                        . "\r\n- Site: " . get_site_url());
                    wp_die(__('The security code is not valid.', 'twoinc-payment-gateway'));
                }
            }

            /** @var wpdb $wpdb */
            global $wpdb;

            $sql = $wpdb->prepare("SELECT post_id FROM $wpdb->postmeta WHERE meta_key = %s AND meta_value = %s", '_tillit_order_reference', $order_reference);
            $row = $wpdb->get_row($sql , ARRAY_A);

            // Stop if no order found
            if (!isset($row['post_id'])) {
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Could not find order:"
                    . "\r\n- Request: Confirm order"
                    . "\r\n- Order reference: " . $order_reference
                    . "\r\n- Site: " . get_site_url());
                wp_die(__('Unable to find the requested order', 'twoinc-payment-gateway'));
            }

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
            if (!$twoinc_order_id) {
                $order->add_order_note(__('Unable to retrieve the order information', 'twoinc-payment-gateway'));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Could not find Twoinc order ID:"
                    . "\r\n- Request: Confirm order"
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url());
                wp_die(__('Unable to retrieve the order information', 'twoinc-payment-gateway'));
            }

            // Get the Twoinc order details
            $response = $this->make_request("/v1/order/{$twoinc_order_id}/confirm", [], 'POST');

            // Stop if request error
            if (is_wp_error($response)) {
                $order->add_order_note(__('Unable to retrieve the order information', 'twoinc-payment-gateway'));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Could not send request to Twoinc server:"
                    . "\r\n- Request: Confirm order"
                    . "\r\n- Twoinc order ID: " . $twoinc_order_id
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url());
                wp_die(__('Unable to retrieve the order information', 'twoinc-payment-gateway'));
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                $order->add_order_note(__('Unable to confirm the order with Two', 'twoinc-payment-gateway'));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Got error response from Twoinc server:"
                    . "\r\n- Request: Confirm order"
                    . "\r\n- Response message: " . $twoinc_err
                    . "\r\n- Twoinc order ID: " . $twoinc_order_id
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url());

                // Redirect the user to Woocom cancellation page
                return wp_specialchars_decode($order->get_cancel_order_url());

            }
            // After get_twoinc_error_msg, we can assume $response['response']['code'] < 400

            // Add note and update Two state
            $order->add_order_note(sprintf(__('Order ID: %s has been placed with Two', 'twoinc-payment-gateway'), $twoinc_order_id));
            update_post_meta($order_id, '_twoinc_order_state', 'CONFIRMED');

            // Mark order as processing
            $order->payment_complete();

            // Redirect the user to confirmation page
            return wp_specialchars_decode($order->get_checkout_order_received_url());

        }

        /**
         * Setup Twoinc settings
         *
         * @return void
         */
        public static function one_click_setup()
        {
            // Stop if this is not setup request
            if (!isset($_REQUEST['m']) || !isset($_REQUEST['k']) || !isset($_REQUEST['t']) || !isset($_REQUEST['c'])) return;
            $ocs_path = '/twoinc-payment-gateway/init';
            $req_path = strtok($_SERVER["REQUEST_URI"], '?');
            if (strlen($req_path) < strlen($ocs_path) || substr($req_path, -strlen($ocs_path)) !== $ocs_path) return;

            if (!current_user_can('manage_options')) {
                $redirect_to_signin = wp_login_url() . '?redirect_to=' . urlencode($_SERVER["REQUEST_URI"]);
                $error = new WP_Error(
                    'init_failed',
                    sprintf(
                        __('Wordpress admin privilege is required for Two payment One-click setup. %s', 'twoinc-payment-gateway'),
                        sprintf('<a href="%s">» %s</a>', $redirect_to_signin, __('Log in', 'twoinc-payment-gateway'))
                    ),
                    array('title' => _('Two payment setup failure'), 'response' => '401', 'back_link' => false));
                if (is_wp_error($error)){
                    wp_die($error, '', $error->get_error_data());
                }
            }

            // Get the id and token to send to Twoinc
            $merchant_id = sanitize_text_field($_REQUEST['m']);
            $twoinc_init_tk = sanitize_text_field($_REQUEST['k']);
            $site_type = sanitize_text_field($_REQUEST['t']);
            $twoinc_checkout_host = sanitize_text_field($_REQUEST['c']);

            if ($site_type === 'WOOCOMMERCE') {

                $allowed_twoinc_checkout_hosts = array('https://api.two.inc/', 'https://api.staging.two.inc/', 'https://api.sandbox.two.inc/', 'http://localhost:8080');
                if (!in_array($twoinc_checkout_host, $allowed_twoinc_checkout_hosts)) {
                    $error = new WP_Error(
                        'init_failed',
                        __('Two checkout host name is not correct', 'twoinc-payment-gateway'),
                        array('title' => _('Two payment setup failure'), 'response' => '401', 'back_link' => false));
                    if (is_wp_error($error)){
                        wp_die($error, '', $error->get_error_data());
                    }
                }

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

                if (is_wp_error($response)) {
                    $error = new WP_Error(
                        'init_failed',
                        sprintf(
                            'Could not connect to setup server, please contact %s for more information!',
                            sprintf('<a href="https://two.inc/">%s</a>', __('Two', 'twoinc-payment-gateway'))
                        ),
                        array('title' => _('Two payment setup failure'), 'response' => '400', 'back_link' => false));
                    wp_die($error, '', $error->get_error_data());
                }

                $body = json_decode($response['body'], true);
                if ($response['response']['code'] === 200 && $body && $body['merchant_secret_api_key']) {
                    $wc_twoinc_instance = WC_Twoinc::get_instance();
                    $wc_twoinc_instance->update_option('tillit_merchant_id', $body['merchant_short_name']);
                    $wc_twoinc_instance->update_option('api_key', $body['merchant_secret_api_key']);
                    if (isset($body['enabled'])) $wc_twoinc_instance->update_option('enabled', $body['enabled'] ? 'yes' : 'no');
                    if (isset($body['title'])) $wc_twoinc_instance->update_option('title', $body['title']);
                    if (isset($body['checkout_personal'])) $wc_twoinc_instance->update_option('checkout_personal', $body['checkout_personal'] ? 'yes' : 'no');
                    if (isset($body['checkout_sole_trader'])) $wc_twoinc_instance->update_option('checkout_sole_trader', $body['checkout_sole_trader'] ? 'yes' : 'no');
                    if (isset($body['checkout_business'])) $wc_twoinc_instance->update_option('checkout_business', $body['checkout_business'] ? 'yes' : 'no');
                    if (isset($body['enable_company_name'])) $wc_twoinc_instance->update_option('enable_company_name', $body['enable_company_name'] ? 'yes' : 'no');
                    if (isset($body['address_search'])) $wc_twoinc_instance->update_option('address_search', $body['address_search'] ? 'yes' : 'no');
                    if (isset($body['enable_order_intent'])) $wc_twoinc_instance->update_option('enable_order_intent', $body['enable_order_intent'] ? 'yes' : 'no');
                    if (isset($body['default_to_b2c'])) $wc_twoinc_instance->update_option('default_to_b2c', $body['default_to_b2c'] ? 'yes' : 'no');
                    if (isset($body['invoice_fee_to_buyer'])) $wc_twoinc_instance->update_option('invoice_fee_to_buyer', $body['invoice_fee_to_buyer'] ? 'yes' : 'no');
                    if (isset($body['clear_options_on_deactivation'])) $wc_twoinc_instance->update_option('clear_options_on_deactivation', $body['clear_options_on_deactivation'] ? 'yes' : 'no');
                    if (WC_Twoinc_Helper::is_twoinc_development()) {
                        $wc_twoinc_instance->update_option('test_checkout_host', $twoinc_checkout_host);
                        if (isset($body['use_prod_company_search'])) $wc_twoinc_instance->update_option('use_prod_company_search', $body['use_prod_company_search'] ? 'yes' : 'no');
                    } else if (strpos($twoinc_checkout_host, 'api.sandbox.two.inc') !== false) {
                        $wc_twoinc_instance->update_option('checkout_env', 'SANDBOX');
                    } else {
                        $wc_twoinc_instance->update_option('checkout_env', 'PROD');
                    }

                    // Init done
                    $error = new WP_Error(
                        'init_ok',
                        sprintf(
                            'Successfully setup Two payment! Go to %s.',
                            sprintf('<a href="%s">%s</a>', get_dashboard_url(), __('Dashboard', 'twoinc-payment-gateway'))
                        ),
                        array('title' => _('Two payment setup success'), 'response' => '200', 'back_link' => false));
                    wp_die($error, '', $error->get_error_data());
                } else if ($response['response']['code'] === 400) {
                    // Link expired or max attempts reached or wrong key
                    $error = new WP_Error(
                        'init_failed',
                        sprintf(
                            'Magic setup link already used or expired, please contact %s for more information!',
                            sprintf('<a href="https://two.inc/">%s</a>', __('Two', 'twoinc-payment-gateway'))
                        ),
                        array('title' => _('Two payment setup failure'), 'response' => '400', 'back_link' => false));
                    wp_die($error, '', $error->get_error_data());
                }
            }

            // Other errors
            $error = new WP_Error(
                'init_failed',
                sprintf(
                    'Could not setup Two payment on your website, please contact %s for more information!',
                    sprintf('<a href="https://two.inc/">%s</a>', __('Two', 'twoinc-payment-gateway'))
                ),
                array('title' => _('Two payment setup failure'), 'response' => '400', 'back_link' => false));
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
                    'title'       => __('Turn on/off', 'twoinc-payment-gateway'),
                    'type'        => 'checkbox',
                    'label'       => __('Enable Two Payments', 'twoinc-payment-gateway'),
                    'default'     => 'yes'
                ],
                'title' => [
                    'title'       => __('Title', 'twoinc-payment-gateway'),
                    'type'        => 'text',
                    'default'     => __('Business invoice %s days', 'twoinc-payment-gateway')
                ],
                'test_checkout_host' => [
                    'type'        => 'text',
                    'title'       => __('Two Test Server', 'twoinc-payment-gateway'),
                    'default'     => 'https://api.staging.two.inc'
                ],
                'use_prod_company_search' => [
                    'title'       => __('Company search', 'twoinc-payment-gateway'),
                    'type'        => 'checkbox',
                    'label'       => __('Use production search API', 'twoinc-payment-gateway'),
                    'default'     => 'no'
                ],
                'checkout_env' => [
                    'type'        => 'select',
                    'title'       => __('Choose your settings', 'twoinc-payment-gateway'),
                    'default'     => 'Production',
                    'options'     => array(
                          'PROD'     => 'Production',
                          'SANDBOX'  => 'Sandbox'
                     )
                ],
                'clear_options_on_deactivation' => [
                    'title'       => __('Clear settings on deactivation of plug-in', 'twoinc-payment-gateway'),
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'no'
                ],
                'section_api_credentials' => [
                    'type'        => 'title',
                    'title'       => __('API credentials', 'twoinc-payment-gateway')
                ],
                'tillit_merchant_id' => [
                    'title'       => __('Two username', 'twoinc-payment-gateway'),
                    'type'        => 'text'
                ],
                'api_key' => [
                    'title'       => __('Two API Key', 'twoinc-payment-gateway'),
                    'type'        => 'password'
                ],
                // 'section_invoice_settings' => [
                //     'type'        => 'title',
                //     'title'       => __('Invoice settings', 'twoinc-payment-gateway')
                // ],
                // 'merchant_logo' => [
                //     'title'       => __('Add a logo to the invoice', 'twoinc-payment-gateway'),
                //     'type'        => 'logo'
                // ],
                'section_checkout_options' => [
                    'type'        => 'title',
                    'title'       => __('Checkout options', 'twoinc-payment-gateway')
                ],
                'enable_order_intent' => [
                    'title'       => __('Pre-approve buyer during checkout', 'twoinc-payment-gateway'),
                    'description' => __('Approve buyer when phone and company name is filled out.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'yes'
                ],
                'checkout_business' => [
                    'title'       => __('Separate checkout for business customers', 'twoinc-payment-gateway'),
                    'description' => __('Adds a separate checkout for business customers. Two is only available in the business checkout.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'yes'
                ],
                'checkout_personal' => [
                    'title'       => __('Separate checkout for private customers', 'twoinc-payment-gateway'),
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'yes'
                ],
                'checkout_sole_trader' => [
                    'title'       => __('Separate checkout for private sole traders', 'twoinc-payment-gateway'),
                    'label'       => ' ',
                    'type'        => 'checkbox'
                ],
                'add_field_department' => [
                    'title'       => __('Add input field for "Department"', 'twoinc-payment-gateway'),
                    'description' => __('Adds an input field where buyers can input their department, input is shown on invoice.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'yes'
                ],
                'add_field_project' => [
                    'title'       => __('Add input field for "Project"', 'twoinc-payment-gateway'),
                    'description' => __('Adds an input field where buyers can input their project in the company, input is shown on invoice.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'yes'
                ],
                'add_field_purchase_order_number' => [
                    'title'       => __('Add input field for "Purchase order number"', 'twoinc-payment-gateway'),
                    'description' => __('Adds an input field where buyers can input their purchase order number, input is shown on invoice.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'yes'
                ],
                'use_account_type_buttons' => [
                    'title'       => __('Use buttons instead of radios to select account type', 'twoinc-payment-gateway'),
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'no'
                ],
                'show_abt_link' => [
                    'title'       => __('Show "What is Two" link in checkout', 'twoinc-payment-gateway'),
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'yes'
                ],
                'default_to_b2c' => [
                    'title'       => __('Default to B2C check-out', 'twoinc-payment-gateway'),
                    'label'       => ' ',
                    'type'        => 'checkbox'
                ],
                'invoice_fee_to_buyer' => [
                    'title'       => __('Shift invoice fee to the buyers', 'twoinc-payment-gateway'),
                    'description' => __('This feature only works for merchants set up with a fixed fee per order.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'label'       => ' ',
                    'type'        => 'checkbox'
                ],
                'display_tooltips' => [
                    'title'       => __('Display input tooltips', 'twoinc-payment-gateway'),
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'no'
                ],
                'skip_confirm_auth' => [
                    'title'       => __('Skip user validation at order confirmation', 'twoinc-payment-gateway'),
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'no'
                ],
                'section_auto_complete_settings' => [
                    'type'        => 'title',
                    'title'       => __('Auto-complete settings', 'twoinc-payment-gateway')
                ],
                'enable_company_name' => [
                    'title'       => __('Enable company name search and auto-complete', 'twoinc-payment-gateway'),
                    'description' => __('Enables searching for company name in the national registry and automatically filling in name and national ID.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'yes'
                ],
                'address_search' => [
                    'title'       => __('Address auto-complete', 'twoinc-payment-gateway'),
                    'description' => __('Enables automatically filling in the registered address from the national registry.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'yes'
                ]
            ];

            if (WC_Twoinc_Helper::is_twoinc_development()) {
                unset($twoinc_form_fields['checkout_env']);
            } else {
                unset($twoinc_form_fields['test_checkout_host']);
                unset($twoinc_form_fields['use_prod_company_search']);
            }

            $this->form_fields = apply_filters('wc_two_form_fields', $twoinc_form_fields);
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
        private function get_save_twoinc_meta($order, $optional_order_id = null)
        {

            $twoinc_order_id = $this->get_twoinc_order_id($order);
            if (!$twoinc_order_id) {
                if ($optional_order_id) {
                    $twoinc_order_id = $optional_order_id;
                } else {
                    $order->add_order_note(__('Unable to retrieve the order information', 'twoinc-payment-gateway'));
                    WC_Twoinc_Helper::send_twoinc_alert_email(
                        "Could not find Twoinc order ID:"
                        . "\r\n- Request: Get order: get_save_twoinc_meta"
                        . "\r\n- Merchant post ID: " . strval($order->get_id())
                        . "\r\n- Site: " . get_site_url());
                    return;
                }
            }

            $order_reference = $order->get_meta('_tillit_order_reference');
            $twoinc_merchant_id = $order->get_meta('_tillit_merchant_id');
            if (!$twoinc_merchant_id) {
                $twoinc_merchant_id = $this->get_option('tillit_merchant_id');
                update_post_meta($order->get_id(), '_tillit_merchant_id', $twoinc_merchant_id);
            }

            $company_id = $order->get_meta('company_id');
            if ($company_id) {
                $department = $order->get_meta('department');
                $project = $order->get_meta('project');
                $purchase_order_number = $order->get_meta('purchase_order_number');
                $purchase_order_number = $body['buyer_purchase_order_number'];
                $invoice_emails = $order->get_meta('_invoice_emails', true);
            } else {
                $response = $this->make_request("/v1/order/{$twoinc_order_id}", [], 'GET');

                // Stop if request error
                if (is_wp_error($response)) {
                    $order->add_order_note(__('Unable to retrieve the order information', 'twoinc-payment-gateway'));
                    WC_Twoinc_Helper::send_twoinc_alert_email(
                        "Could not send request to Twoinc server:"
                        . "\r\n- Request: Get order: get_save_twoinc_meta"
                        . "\r\n- Twoinc order ID: " . $twoinc_order_id
                        . "\r\n- Merchant post ID: " . strval($order->get_id())
                        . "\r\n- Site: " . get_site_url());
                    return;
                }

                $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
                if ($twoinc_err) {
                    $order->add_order_note(__('Unable to retrieve the order payment information', 'twoinc-payment-gateway'));
                    WC_Twoinc_Helper::send_twoinc_alert_email(
                        "Got error response from Twoinc server:"
                        . "\r\n- Request: Get order: get_save_twoinc_meta"
                        . "\r\n- Response message: " . $twoinc_err
                        . "\r\n- Twoinc order ID: " . $twoinc_order_id
                        . "\r\n- Merchant post ID: " . strval($order->get_id())
                        . "\r\n- Site: " . get_site_url());
                    return;
                }

                $body = json_decode($response['body'], true);
                if (!$body || !$body['buyer'] || !$body['buyer']['company'] || !$body['buyer']['company']['organization_number']) {
                    $order->add_order_note(sprintf(__('Missing company ID, please check with Two admin for id %s', 'twoinc-payment-gateway'), $twoinc_order_id));
                    WC_Twoinc_Helper::send_twoinc_alert_email(
                        "Could not send request to Twoinc server:"
                        . "\r\n- Request: Get order: get_save_twoinc_meta"
                        . "\r\n- Response details: Missing company ID"
                        . "\r\n- Twoinc order ID: " . $twoinc_order_id
                        . "\r\n- Merchant post ID: " . strval($order->get_id())
                        . "\r\n- Site: " . get_site_url());
                    return;
                }
                $company_id = $body['buyer']['company']['organization_number'];
                $department = $body['buyer_department'];
                $project = $body['buyer_project'];
                $purchase_order_number = $body['buyer_purchase_order_number'];
                $invoice_emails = $body['invoice_details']['invoice_emails'];
                update_post_meta($order->get_id(), 'company_id', $company_id);
                update_post_meta($order->get_id(), 'department', $department);
                update_post_meta($order->get_id(), 'project', $project);
                update_post_meta($order->get_id(), 'purchase_order_number', $purchase_order_number);
                update_post_meta($order->get_id(), '_invoice_emails', $invoice_emails);
            }

            return array(
                'order_reference' => $order_reference,
                'tillit_merchant_id' => $twoinc_merchant_id,
                'company_id' => $company_id,
                'department' => $department,
                'project' => $project,
                'purchase_order_number' => $purchase_order_number,
                'twoinc_order_id' => $twoinc_order_id,
                'payment_reference_message' => $order->get_meta('payment_reference_message'),
                'payment_reference_ocr' => $order->get_meta('payment_reference_ocr'),
                'payment_reference' => $order->get_meta('payment_reference'),
                'payment_reference_type' => $order->get_meta('payment_reference_type'),
                'invoice_emails' => $invoice_emails
            );

        }

        /**
         * Run the update execution
         *
         * @param $order
         */
        private function process_update_twoinc_order($order, $twoinc_meta, $forced_reload = false)
        {

            $twoinc_order_hash = $order->get_meta('_twoinc_req_body_hash');
            $twoinc_updated_order_hash = WC_Twoinc_Helper::hash_order($order, $twoinc_meta);
            if (!$twoinc_order_hash || $twoinc_order_hash != $twoinc_updated_order_hash) {
                if ($this->update_twoinc_order($order)) {
                    update_post_meta($order->get_id(), '_twoinc_req_body_hash', $twoinc_updated_order_hash);
                }
                if ($forced_reload) {
                    WC_Twoinc_Helper::append_admin_force_reload();
                }
            }

        }

        /**
         * Run the update
         *
         * @param $order
         *
         * @return boolean
         */
        private function update_twoinc_order($order)
        {

            $twoinc_order_id = $this->get_twoinc_order_id($order);
            if (!$twoinc_order_id) {
                $order->add_order_note(__('Could not edit the Two order', 'twoinc-payment-gateway'));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Could not find Twoinc order ID:"
                    . "\r\n- Request: Edit order"
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url());
                return false;
            }

            // 1. Get information from the current order
            $twoinc_meta = $this->get_save_twoinc_meta($order);
            if (!$twoinc_meta) return false;

            // 2. Edit the order
            $order = wc_get_order($order->get_id());
            $response = $this->make_request("/v1/order/{$twoinc_order_id}", WC_Twoinc_Helper::compose_twoinc_edit_order(
                    $order,
                    $twoinc_meta['department'],
                    $twoinc_meta['project'],
                    $twoinc_meta['purchase_order_number']
                ),
                'PUT'
            );

            if (is_wp_error($response)) {
                $order->add_order_note(__('Could not edit the Two order', 'twoinc-payment-gateway'));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Could not send request to Twoinc server:"
                    . "\r\n- Request: Edit order"
                    . "\r\n- Twoinc order ID: " . $twoinc_order_id
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url());
                return false;
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                $order->add_order_note(__('Could not edit the Two order, please check with Two admin', 'twoinc-payment-gateway'));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Got error response from Twoinc server:"
                    . "\r\n- Request: Edit order"
                    . "\r\n- Response message: " . $twoinc_err
                    . "\r\n- Twoinc order ID: " . $twoinc_order_id
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url());
                return false;
            }

            // Get returned gross amount
            $gross_amount = null;
            if($response && $response['body']) {
                $body = json_decode($response['body'], true);
                if($body['gross_amount']) {
                    $gross_amount = $body['gross_amount'];
                }
            }

            // Add note
            if ($gross_amount) {
                $order->add_order_note(sprintf(__('The order has been edited in the Two order system. Order is now registered for %s Amount in Two', 'twoinc-payment-gateway'), strval($gross_amount)));
            } else {
                $order->add_order_note(__('The order has been edited in the Two order system', 'twoinc-payment-gateway'));
            }

            return true;
        }

        /**
         * Get twoinc order id with backward compatibility
         *
         * @param $order
         */
        private function get_twoinc_order_id($order)
        {

            $twoinc_order_id = $order->get_meta('twoinc_order_id');

            if (!$twoinc_order_id) {
                $twoinc_order_id = $order->get_meta('tillit_order_id');
            }

            return $twoinc_order_id;

        }

        /**
         * Get twoinc order id from post id with backward compatibility
         * This function uses get_post_meta() instead of $order->get_meta() in get_twoinc_order_id()
         * The intention is to query from DB in case the meta has not been loaded into $order object
         *
         * @param $post_id
         */
        private function get_twoinc_order_id_from_post_id($post_id)
        {

            $twoinc_order_id = get_post_meta($post_id, 'twoinc_order_id', true);

            if (!$twoinc_order_id) {
                $twoinc_order_id = get_post_meta($post_id, 'tillit_order_id', true);
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
            $headers = [
               'Accept-Language' => WC_Twoinc_Helper::get_locale(),
               'Content-Type' => 'application/json; charset=utf-8',
               'X-API-Key' => $this->get_option('api_key')
            ];
            if (isset($_SERVER['HTTP_X_CLOUD_TRACE_CONTEXT'])) {
                $headers['HTTP_X_CLOUD_TRACE_CONTEXT'] = $_SERVER['HTTP_X_CLOUD_TRACE_CONTEXT'];
            }
            return wp_remote_request(sprintf('%s%s?%s', $this->twoinc_checkout_host, $endpoint, http_build_query($params)), [
                'method' => $method,
                'headers' => $headers,
                'timeout' => 30,
                'body' => empty($payload) ? '' : json_encode(WC_Twoinc_Helper::utf8ize($payload)),
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
                <div id="twoinc-account-init-notice" class="notice notice-info is-dismissible" style="background-image: url(\'' . WC_TWOINC_PLUGIN_URL . 'assets/images/banner.png\');background-size: cover;border-left-width: 0;background-color: #e2e0ff;padding: 20px;display: flex;">
                    <div style="width:60%;padding-right:40px;">
                        <img style="width: 100px;" src="' . WC_TWOINC_PLUGIN_URL . 'assets/images/two-logo-w.svg">
                        <p style="color: #ffffff;font-size: 1.3em;text-align: justify;font-weight:700;">' . __('Grow your b2b sales with Buy Now, Pay Later!', 'twoinc-payment-gateway') . '</p>
                        <p style="color: #ffffff;font-size: 1.3em;text-align: justify;">' . __('Two credit approves 90% of business buyers, pays you upfront and minimise your risk. To offer Two in your checkout, you need to signup. It’s quick, easy and gives you immediate access to the Two Merchant Portal.', 'twoinc-payment-gateway') . '</p>
                    </div>
                    <div>
                        <div style="position: absolute;top: 50%;transform: translateY(-50%);right: 40px;">
                            <a href="https://portal.two.inc/auth/merchant/signup" target="_blank" class="button" style="margin-left: 20px;background: #edf3ff;font-size: 1.1em;font-weight: 600;color: #4848e6;padding: 7px 30px;border-color: #edf3ff;border-radius: 12px;">' . __('Set up my Two account', 'twoinc-payment-gateway') . '</a>
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
            if ($this->get_option('clear_options_on_deactivation') === 'yes') {
                delete_option('woocommerce_woocommerce-gateway-tillit_settings');
            }
        }

    }

}
