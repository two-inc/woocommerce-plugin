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
            $this->twoinc_search_host_no = 'https://no.search.two.inc';
            $this->twoinc_search_host_gb = 'https://gb.search.two.inc';
            $this->twoinc_search_host_gb = 'https://se.search.two.inc';
            $this->twoinc_checkout_host = $this->get_twoinc_checkout_host();

            $this->plugin_version = get_plugin_version();

            $this->title = sprintf(
                __($this->get_option('title'), 'twoinc-payment-gateway'),
                strval($this->get_merchant_default_days_on_invoice())
            );
            $this->description = sprintf(
                '%s%s',
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
                // For order update by Save button
                add_action('woocommerce_before_save_order_items', [$this, 'before_order_item_save'], 10, 2);
                add_action('woocommerce_saved_order_items', [$this, 'after_order_item_save'], 10, 2);
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
                return 'https://sandbox.api.two.inc';
            } else {
                return 'https://api.two.inc';
            }
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

            // Return val from DB if last checked is within 1 hour
            if ($days_on_invoice_last_checked_on && ($days_on_invoice_last_checked_on + 3600) > time()) {
                return $days_on_invoice;
            }

            $twoinc_merchant_id = $this->get_option('tillit_merchant_id');

            if ($twoinc_merchant_id && $this->get_option('api_key')) {

                // Get the latest due
                $response = $this->make_request("/v1/merchant/${twoinc_merchant_id}", [], 'GET');

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

            return $days_on_invoice;

        }

        /**
         * Get about twoinc html
         */
        private function get_abt_twoinc_html(){
            if ($this->get_option('show_abt_link') === 'yes') {
                $abt_url = 'https://twoinc.notion.site/What-is-Tillit-4e12960d8e834e5aa20f879d59e0b32f';
                if (WC_Twoinc_Helper::get_locale() === 'nb_NO') {
                    $abt_url = 'https://twoinc.notion.site/Hva-er-Two-964ee21e4da84819afb1b035ee8fe98b';
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
                    <div class="twoinc-pay-box err-country" style="display: none;">%s</div>
                    <div class="twoinc-pay-box declare-aggrement" style="display: none;">%s</div>
                    <div class="twoinc-pay-box payment-not-accepted" style="display: none;">%s</div>
                    <div class="twoinc-pay-box err-amt-max" style="display: none;">%s</div>
                    <div class="twoinc-pay-box err-amt-min" style="display: none;">%s</div>
                    <div class="twoinc-pay-box err-phone" style="display: none;">%s</div>
                </div>',
                sprintf(
                    '- %s<br>- <span class="payment-term-number">%s</span><span class="payment-term-nonumber">%s</span><br>- %s',
                    __('Express checkout', 'twoinc-payment-gateway'),
                    sprintf(
                        __('Pay in %s days, at no extra cost', 'twoinc-payment-gateway'),
                        '<span class="due-in-days">' . strval($this->get_merchant_default_days_on_invoice()) . '</span>'
                    ),
                    __('Pay on invoice with agreed terms', 'twoinc-payment-gateway'),
                    $this->get_payment_description_msg()
                ),
                __('Two is not available as a payment option in the selected region', 'twoinc-payment-gateway'),
                sprintf(
                    '%s <span class="twoinc-buyer-name-placeholder">%s</span><span class="twoinc-buyer-name"></span>.',
                    __('By completing the purchase, you verify that you have the legal right to purchase on behalf of', 'twoinc-payment-gateway'),
                    __('your company', 'twoinc-payment-gateway'),
                    $this->get_abt_twoinc_html()
                ),
                __('Invoice purchase is not available for this order', 'twoinc-payment-gateway'),
                __('Order value exceeds maximum limit', 'twoinc-payment-gateway'),
                __('Order value is below minimum limit', 'twoinc-payment-gateway'),
                __('Phone number is invalid', 'twoinc-payment-gateway')
            );

        }

        /**
         * Add filter to gateway payment title
         */
        public function change_twoinc_payment_title(){
            add_filter('woocommerce_gateway_title', function ($title, $payment_id) {
                if ($payment_id === 'woocommerce-gateway-tillit') {
                    $title = sprintf(
                        '<span class="payment-term-number">%s</span><span class="payment-term-nonumber">%s</span>
                        <div class="twoinc-subtitle">
                            <div class="twoinc-pay-sub require-inputs">%s</div>
                            <div class="twoinc-pay-sub explain-details" style="display: none;">%s</div>
                            <img class="twoinc-pay-sub loader" style="display: none;" src="%s" />
                        </div> ',
                        sprintf(
                            __($this->get_option('title'), 'twoinc-payment-gateway'),
                            '<span class="due-in-days">' . strval($this->get_merchant_default_days_on_invoice()) . '</span>'
                        ),
                        __('Pay on invoice with agreed terms', 'twoinc-payment-gateway'),
                        __('Enter company name to pay on invoice', 'twoinc-payment-gateway'),
                        sprintf(
                            '- %s<br>- <span class="payment-term-number">%s</span><span class="payment-term-nonumber">%s</span><br>- %s',
                            __('Express checkout', 'twoinc-payment-gateway'),
                            sprintf(
                                __('Pay in %s days, at no extra cost', 'twoinc-payment-gateway'),
                                '<span class="due-in-days">' . strval($this->get_merchant_default_days_on_invoice()) . '</span>'
                            ),
                            __('Pay on invoice with agreed terms', 'twoinc-payment-gateway'),
                            $this->get_payment_description_msg()
                        ),
                        WC_TWOINC_PLUGIN_URL . '/assets/images/loader.svg'
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
                $twoinc_meta['company_id'],
                $twoinc_meta['department'],
                $twoinc_meta['project'],
                $twoinc_meta['purchase_order_number'],
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
                $twoinc_meta['company_id'],
                $twoinc_meta['department'],
                $twoinc_meta['project'],
                $twoinc_meta['purchase_order_number'],
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
                $response = $this->make_request("/v1/merchant/${twoinc_merchant_id}", [], 'GET');

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
                $order->add_order_note(__('Could not update status', 'twoinc-payment-gateway'));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Could not find Twoinc order ID:"
                    . "\r\n- Request: Fulfill order"
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url());
                return;
            }

            // Change the order status
            $response = $this->make_request("/v1/order/${twoinc_order_id}/fulfilled");

            if (is_wp_error($response)) {
                $order->add_order_note(__('Could not update status', 'twoinc-payment-gateway'));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Could not send request to Twoinc server:"
                    . "\r\n- Request: Fulfill order"
                    . "\r\n- Twoinc order ID: " . $twoinc_order_id
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url());
                return;
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                $order->add_order_note(sprintf(__('Could not update status to "Fulfilled" with Two, please check with Two admin for id %s', 'twoinc-payment-gateway'), $twoinc_order_id));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Got error response from Twoinc server:"
                    . "\r\n- Request: Fulfill order"
                    . "\r\n- Response message: " . $twoinc_err
                    . "\r\n- Twoinc order ID: " . $twoinc_order_id
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url());
                return;
            }

            // Decode the response
            $body = json_decode($response['body'], true);

            // Save invoice number
            if ($body['invoice_details'] && $body['invoice_details']['invoice_number']) {
                update_post_meta($order->get_id(), 'invoice_number', $body['invoice_details']['invoice_number']);
            }

            // Add order note
            if (isset($body['invoice_type']) && $body['invoice_type'] == 'FUNDED_INVOICE' && strtolower(WC()->countries->get_base_country()) == 'no') {
                $order->add_order_note(__('Invoice has been sent from Two via email and EHF', 'twoinc-payment-gateway'));
            } else {
                $order->add_order_note(__('Invoice has been sent from Two via email', 'twoinc-payment-gateway'));
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
            $twoinc_order_id = $this->get_twoinc_order_id_from_post_id($order_id);

            if (!$twoinc_order_id) {
                $order->add_order_note(__('Could not update status to "Cancelled"', 'twoinc-payment-gateway'));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Could not find Twoinc order ID:"
                    . "\r\n- Request: Cancel order"
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url());
                return;
            }

            // Change the order status
            $response = $this->make_request("/v1/order/${twoinc_order_id}/cancel");

            if (is_wp_error($response)) {
                $order->add_order_note(__('Could not update status to "Cancelled"', 'twoinc-payment-gateway'));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Could not send request to Twoinc server:"
                    . "\r\n- Request: Cancel order"
                    . "\r\n- Twoinc order ID: " . $twoinc_order_id
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url());
                return;
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                $order->add_order_note(sprintf(__('Could not update status to "Cancelled", please check with Two admin for id %s', 'twoinc-payment-gateway'), $twoinc_order_id));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Got error response from Twoinc server:"
                    . "\r\n- Request: Cancel order"
                    . "\r\n- Response message: " . $twoinc_err
                    . "\r\n- Twoinc order ID: " . $twoinc_order_id
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url());
                return;
            }

        }

        /**
         * Display user meta fields on user edit admin page
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
                $product_type,
                $payment_reference_message,
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
                WC_Twoinc_Helper::display_ajax_error(__('Invoice purchase is not available for this order', 'twoinc-payment-gateway'));
                return;
            }

            // Store the Twoinc Order Id for future use
            update_post_meta($order_id, 'twoinc_order_id', $body['id']);

            // Return the result
            if ($this->get_option('tillit_merchant_id') === 'arkwrightx') {
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
            if ($order->get_status() !== 'completed') {
                return new WP_Error('invalid_twoinc_refund',
                    __('Only "Completed" orders can be refunded by Two', 'twoinc-payment-gateway'));
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

            $remaining_amt = $order->get_total() + (float) $body['amount'];
            if ($remaining_amt < 0.0001 && $remaining_amt > -0.0001) { // full refund, 0.0001 for float inaccuracy
                $order->add_order_note(__('Invoice has been refunded and credit note has been sent by Two', 'twoinc-payment-gateway'));
            } else { // partial refund
                $order->add_order_note(__('Invoice has been partially refunded and credit note has been sent by Two', 'twoinc-payment-gateway'));
            }

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
                $confirm_path = '/twoinc-payment-gateway/confirm';
                $req_path = strtok($_SERVER["REQUEST_URI"], '?');
                return strlen($req_path) >= strlen($confirm_path) && substr($req_path, -strlen($confirm_path)) === $confirm_path;
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
            $response = $this->make_request("/v1/order/${twoinc_order_id}/confirm", [], 'POST');

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

            // Add note
            $order->add_order_note(sprintf(__('Order ID: %s has been placed with Two', 'twoinc-payment-gateway'), $twoinc_order_id));

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

                $allowed_twoinc_checkout_hosts = array('https://api.two.inc/', 'https://staging.api.two.inc/', 'https://sandbox.api.two.inc/', 'http://localhost:8080');
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
                    if (isset($body['product_type'])) $wc_twoinc_instance->update_option('product_type', $body['product_type']);
                    if (isset($body['enable_company_name'])) $wc_twoinc_instance->update_option('enable_company_name', $body['enable_company_name'] ? 'yes' : 'no');
                    if (isset($body['address_search'])) $wc_twoinc_instance->update_option('address_search', $body['address_search'] ? 'yes' : 'no');
                    if (isset($body['enable_order_intent'])) $wc_twoinc_instance->update_option('enable_order_intent', $body['enable_order_intent'] ? 'yes' : 'no');
                    if (isset($body['default_to_b2c'])) $wc_twoinc_instance->update_option('default_to_b2c', $body['default_to_b2c'] ? 'yes' : 'no');
                    if (isset($body['invoice_fee_to_buyer'])) $wc_twoinc_instance->update_option('invoice_fee_to_buyer', $body['invoice_fee_to_buyer'] ? 'yes' : 'no');
                    if (isset($body['clear_options_on_deactivation'])) $wc_twoinc_instance->update_option('clear_options_on_deactivation', $body['clear_options_on_deactivation'] ? 'yes' : 'no');
                    if (WC_Twoinc_Helper::is_twoinc_development()) {
                        $wc_twoinc_instance->update_option('test_checkout_host', $twoinc_checkout_host);
                    } else if (strpos($twoinc_checkout_host, 'sandbox.api.two.inc') !== false) {
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
                    'default'     => 'https://staging.api.two.inc'
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
                'section_invoice_settings' => [
                    'type'        => 'title',
                    'title'       => __('Payment and Invoice settings', 'twoinc-payment-gateway')
                ],
                'product_type' => [
                    'type'        => 'select',
                    'title'       => __('Choose product', 'twoinc-payment-gateway'),
                    'default'     => 'FUNDED_INVOICE',
                    'options'     => array(
                          'FUNDED_INVOICE' => 'Funded Invoice',
                          'DIRECT_INVOICE' => 'Direct Invoice'
                     )
                ],
                'merchant_logo' => [
                    'title'       => __('Add a logo to the invoice', 'twoinc-payment-gateway'),
                    'type'        => 'logo'
                ],
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
                    'default'     => 'no'
                ],
                'default_to_b2c' => [
                    'title'       => __('Default to B2C check-out', 'twoinc-payment-gateway'),
                    'label'       => ' ',
                    'type'        => 'checkbox'
                ],
                'invoice_fee_to_buyer' => [
                    'title'       => __('Shift invoice fee to the buyers', 'twoinc-payment-gateway'),
                    'label'       => ' ',
                    'type'        => 'checkbox'
                ],
                'display_tooltips' => [
                    'title'       => __('Display input tooltips', 'twoinc-payment-gateway'),
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
                    'type'        => 'checkbox'
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
        private function get_save_twoinc_meta($order)
        {

            $twoinc_order_id = $this->get_twoinc_order_id($order);
            if (!$twoinc_order_id) {
                $order->add_order_note(__('Unable to retrieve the order information', 'twoinc-payment-gateway'));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Could not find Twoinc order ID:"
                    . "\r\n- Request: Get order: get_save_twoinc_meta"
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url());
                return;
            }

            $order_reference = $order->get_meta('_tillit_order_reference');
            $twoinc_merchant_id = $order->get_meta('_tillit_merchant_id');
            if (!$twoinc_merchant_id) {
                $twoinc_merchant_id = $this->get_option('tillit_merchant_id');
                update_post_meta($order->get_id(), '_tillit_merchant_id', $twoinc_merchant_id);
            }

            $product_type = $order->get_meta('_product_type');
            $payment_reference_message = '';

            if (!$product_type) {
                $product_type = 'FUNDED_INVOICE'; // First product type as default for older orders
                update_post_meta($order->get_id(), '_product_type', $product_type);
            }

            $payment_reference_message = strval($order->get_id());

            $company_id = $order->get_meta('company_id');
            if ($company_id) {
                $department = $order->get_meta('department');
                $project = $order->get_meta('project');
                $purchase_order_number = $order->get_meta('purchase_order_number');
            } else {
                $response = $this->make_request("/v1/order/${twoinc_order_id}", [], 'GET');

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
                update_post_meta($order->get_id(), 'company_id', $company_id);
                update_post_meta($order->get_id(), 'department', $department);
                update_post_meta($order->get_id(), 'project', $project);
                update_post_meta($order->get_id(), 'purchase_order_number', $purchase_order_number);
            }

            return array(
                'order_reference' => $order_reference,
                'tillit_merchant_id' => $twoinc_merchant_id,
                'company_id' => $company_id,
                'department' => $department,
                'project' => $project,
                'purchase_order_number' => $purchase_order_number,
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
            if (!$twoinc_order_id) {
                $order->add_order_note(__('Could not edit the Two order', 'twoinc-payment-gateway'));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Could not find Twoinc order ID:"
                    . "\r\n- Request: Edit order"
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url());
                return;
            }

            // 1. Get information from the current order
            $twoinc_meta = $this->get_save_twoinc_meta($order);
            if (!$twoinc_meta) return;

            // 2. Edit the order
            $response = $this->make_request("/v1/order/${twoinc_order_id}", WC_Twoinc_Helper::compose_twoinc_edit_order(
                    $order,
                    $twoinc_meta['department'],
                    $twoinc_meta['project'],
                    $twoinc_meta['purchase_order_number'],
                    $twoinc_meta['product_type'],
                    $twoinc_meta['payment_reference_message']
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
                return;
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
                return;
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
            return wp_remote_request(sprintf('%s%s?%s', $this->twoinc_checkout_host, $endpoint, http_build_query($params)), [
                'method' => $method,
                'headers' => [
                    'Accept-Language' => WC_Twoinc_Helper::get_locale(),
                    'Content-Type' => 'application/json; charset=utf-8',
                    'X-API-Key' => $this->get_option('api_key')
                ],
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
                <div id="twoinc-account-init-notice" class="notice notice-info is-dismissible" style="background-color: #e2e0ff;padding: 20px;display: flex;">
                    <div style="width:60%;padding-right:40px;">
                        <h1 style="color: #000000;font-weight:700;">Set up your Two account</h1>
                        <p style="color: #000000;font-size: 1.3em;text-align: justify;">Happy to see you here! Before you can start selling with the Two buy now, pay later solution you need to complete our signup process. It\'s easy, fast and gives you immediate access to the <a target="_blank" href="https://portal.two.inc/auth/merchant/signup">Two Merchant Portal</a></p>
                    </div>
                    <div>
                        <img style="position: absolute;top: 40px;right: 40px;width: 100px;" src="' . WC_TWOINC_PLUGIN_URL . 'assets/images/two-logo.svg">
                        <div style="position: absolute;bottom: 20px;right:40px;">
                            <a href="#" id="dismiss-twoinc-notice" class="button" style="margin-left: 20px;background: none;font-size: 1.1em;font-weight: 600;color: #3e16a2;padding: 7px 30px;border-color: #3e16a2;border-radius: 12px;">Not now, thanks</a>
                            <a href="https://portal.two.inc/auth/merchant/signup" target="_blank" class="button" style="margin-left: 20px;background: #3e16a2;font-size: 1.1em;font-weight: 600;color: #ffffff;padding: 7px 30px;border-color: #3e16a2;border-radius: 12px;">Set up my account</a>
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
