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

        public const PROVIDER = 'Two';
        public const PROVIDER_FULL_NAME = 'Two';
        public const PRODUCT_NAME = 'Two';
        public const MERCHANT_SIGNUP_URL = 'https://portal.two.inc/auth/merchant/signup';
        public const ALERT_EMAIL_ADDRESS = 'woocom-alerts@two.inc';

        private bool $twoinc_process_confirmation_called = false;

        /**
         * WC_Twoinc constructor.
         */
        public function __construct()
        {

            $this->id = 'woocommerce-gateway-tillit';
            $this->has_fields = false;
            $this->order_button_text = __('Place order', 'twoinc-payment-gateway');
            $this->method_title = self::PRODUCT_NAME;
            $this->method_description = __('Making it easy for businesses to buy online.', 'twoinc-payment-gateway');
            $this->icon = WC_HTTPS::force_https_url(WC_TWOINC_PLUGIN_URL . 'assets/images/two-logo.svg');
            $this->supports = ['products', 'refunds'];

            // Load the settings
            $this->init_form_fields();
            $this->init_settings();

            $this->title = sprintf(
                __($this->get_option('title'), 'twoinc-payment-gateway'),
                strval($this->get_merchant_default_days_on_invoice())
            );
            $this->description = $this->get_pay_box_description() . $this->get_pay_subtitle();

            // Skip hooks if another instance has already been created
            if (null !== self::$instance) {
                return;
            }

            if (is_admin()) {
                // Notice banner if plugin is not setup properly
                if (!$this->get_option('api_key') || !$this->get_merchant_id()) {
                    add_action('admin_notices', [$this, 'twoinc_account_init_notice']);
                    add_action('network_admin_notices', [$this, 'twoinc_account_init_notice']);
                }

                // Verify API key on save with success/failure message
                add_action(
                    'woocommerce_settings_saved',
                    function () {
                        global $pagenow, $current_section;
                        if ($pagenow != 'admin.php' || $current_section != 'woocommerce-gateway-tillit') {
                            return;
                        }

                        $result = $this->verifyAPIKey();

                        $general_error_message = sprintf(__('Failed to verify API key.', 'twoinc-payment-gateway'), self::PRODUCT_NAME);
                        if (isset($result['body']) && isset($result['code'])) {
                            if ($result['code'] == 200 && $result['body']['id']) {
                                WC_Admin_Settings::add_message(sprintf(__('%s API key verified.', 'twoinc-payment-gateway'), self::PRODUCT_NAME));
                            } else {
                                if ($result['code'] == 401) {
                                    //WC_Admin_Settings::add_error($general_error_message);
                                    WC_Admin_Settings::add_error(sprintf('%s %s', $general_error_message, $result['body']));
                                } else {
                                    WC_Admin_Settings::add_error(sprintf('%s %s', $general_error_message, $result['body']));
                                }
                            }
                        } else {
                            WC_Admin_Settings::add_error($general_error_message);
                        }
                    }
                );

                // Verify API key quietly
                add_action('admin_enqueue_scripts', [$this, 'verifyAPIKey']);

                // On plugin deactivated
                add_action('deactivate_' . plugin_basename(__FILE__), [$this, 'on_deactivate_plugin']);

                // Add js css to admin page
                add_action('admin_enqueue_scripts', [$this, 'twoinc_admin_styles_scripts']);

                // On setting updated
                add_action('woocommerce_update_options_payment_gateways_' . $this->id, [$this, 'process_admin_options']); // Built-in process_admin_options
                add_action('woocommerce_update_options_checkout', [$this, 'update_checkout_options']);
            }

            // Return if plugin setup is not complete
            if (!$this->get_option('api_key') || !$this->get_merchant_id()) {
                return;
            }

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

            // On order status changed to refunded
            add_action('woocommerce_order_status_refunded', [$this, 'on_order_refunded']);


            // This class use singleton
            self::$instance = $this;
            new WC_Twoinc_Checkout($this);

        }

        /**
         * Singleton call
         */
        public static function get_instance()
        {
            if (null === self::$instance) {
                self::$instance = new WC_Twoinc();
            }
            return self::$instance;
        }

        /**
         * Get twoinc checkout host based on current settings
         */
        public function get_twoinc_checkout_host()
        {
            if (WC_Twoinc_Helper::is_twoinc_development()) {
                return $this->get_option('test_checkout_host');
            } elseif ($this->get_option('checkout_env') === 'SANDBOX') {
                return 'https://api.sandbox.two.inc';
            } else {
                return 'https://api.two.inc';
            }
        }

        /**
         * Get merchant ID
         *
         * @return string
         */
        public function get_merchant_id()
        {
            return $this->get_option('merchant_id') ?? $this->get_option('tillit_merchant_id');
        }

        /**
         * Get merchant's default due in day from DB, or from Twoinc DB
         */
        public function get_merchant_default_days_on_invoice()
        {

            $days_on_invoice = $this->get_option('days_on_invoice');
            $days_on_invoice_last_checked_on = $this->get_option('days_on_invoice_last_checked_on');

            // Default to 14 days
            if (!$days_on_invoice) {
                $days_on_invoice = 14;
            }

            // if last checked is not within 1 hour, ask Two server
            if (!$days_on_invoice_last_checked_on || ($days_on_invoice_last_checked_on + 3600) <= time()) {

                $merchant_id = $this->get_merchant_id();

                if ($merchant_id && $this->get_option('api_key')) {

                    // Get the latest due
                    $response = $this->make_request("/v1/merchant/{$merchant_id}", [], 'GET');

                    if (is_wp_error($response)) {
                        WC_Twoinc_Helper::send_twoinc_alert_email(
                            "Could not send request to Two server:"
                            . "\r\n- Request: Get merchant default due in days"
                            . "\r\n- Twoinc merchant ID: " . $merchant_id
                            . "\r\n- Site: " . get_site_url()
                        );
                    } else {

                        $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
                        if ($twoinc_err) {
                            // Send alert, except when the api key is wrong
                            if(!($response['response'] && $response['response']['code'] && $response['response']['code'] == 401)) {
                                WC_Twoinc_Helper::send_twoinc_alert_email(
                                    "Got error response from Two server:"
                                    . "\r\n- Request: Get merchant default due in days"
                                    . "\r\n- Response message: " . $twoinc_err
                                    . "\r\n- Twoinc merchant ID: " . $merchant_id
                                    . "\r\n- Site: " . get_site_url()
                                );
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
        private function get_abt_twoinc_html()
        {
            if ($this->get_option('show_abt_link') === 'yes') {
                $abt_url = __('https://www.two.inc/what-is-two');
                $link = '<a href="' . $abt_url . '" target="_blank">' . sprintf(__('What is %s?', 'twoinc-payment-gateway'), self::PRODUCT_NAME) . '</a>';
                $text = sprintf(
                    '<p>%s</p><p><b>%s</b></p>',
                    sprintf(__('%s is a payment solution for B2B purchases online, allowing you to buy from your favourite merchants and suppliers on trade credit. Using %s, you can access flexible trade credit instantly to make purchasing simple.', 'twoinc-payment-gateway'), self::PRODUCT_NAME, self::PRODUCT_NAME),
                    __('Buy now, receive your goods, pay your invoice later.', 'twoinc-payment-gateway'),
                    $abt_url,
                );
                return sprintf('<div class="abt-twoinc-text">%s</div><div class="abt-twoinc-link">%s</div>', $text, $link);
            }
            return '';
        }

        /**
         * Get payment description message
         */
        private function get_payment_description_msg()
        {
            return sprintf(
                '<span class="twoinc-payment-desc payment-desc-global">%s</span><span class="twoinc-payment-desc payment-desc-no-funded">%s</span>',
                __('Receive invoice and payment details via email', 'twoinc-payment-gateway'),
                __('Receive invoice and payment details via email and EHF', 'twoinc-payment-gateway')
            );

        }

        /**
         * Get payment box description
         */
        private function get_pay_box_description()
        {

            return sprintf(
                '<div>
                    <div class="twoinc-pay-box twoinc-explainer">%s</div>
                    <div class="twoinc-pay-box twoinc-loader hidden"></div>
                    <div class="twoinc-pay-box twoinc-intent-approved hidden">%s</div>
                    <div class="twoinc-pay-box twoinc-err-payment-default hidden">%s</div>
                    <div class="twoinc-pay-box twoinc-err-phone-number hidden">%s</div>
                </div>',
                sprintf(__('%s lets your business pay later for the goods you purchase online.', 'twoinc-payment-gateway'), self::PRODUCT_NAME),
                sprintf(__('Your invoice purchase with %s is likely to be accepted subject to additional checks.', 'twoinc-payment-gateway'), self::PRODUCT_NAME),
                sprintf(__('Invoice purchase with %s is not available for this order.', 'twoinc-payment-gateway'), self::PRODUCT_NAME),
                __('Phone number is invalid.', 'twoinc-payment-gateway')
            );

        }

        /**
         * Get payment subtitle
         */
        public function get_pay_subtitle()
        {
            return sprintf(
                '<div class="abt-twoinc">%s</div>',
                $this->get_abt_twoinc_html(),
            );
        }

        /**
         * Get payment HTML title
         */
        public function get_pay_html_title()
        {
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
        public function change_twoinc_payment_title()
        {
            add_filter('woocommerce_gateway_title', function ($title, $payment_id) {
                if ($payment_id === 'woocommerce-gateway-tillit') {
                    $title = $this->get_pay_html_title();
                }
                return $title;
            }, 10, 2);
        }


        public function verifyAPIKey()
        {
            if (!$this->get_option('api_key') || !$this->get_twoinc_checkout_host()) {
                return;
            }
            $response = $this->make_request("/v1/merchant/verify_api_key", [], 'GET');
            if (!$response || is_wp_error($response)) {
                return;
            }
            if (isset($response['body'])) {
                $body = json_decode($response['body'], true);
                $code = $response['response']['code'];
                if ($code == 200 && $body['id']) {
                    $this->update_option('merchant_id', $body['id']);
                }
                return ['body' => $body, 'code' => $code];
            }
        }

        /**
         * Send the merchant logo to Twoinc API
         *
         * @return void
         */
        public function update_checkout_options()
        {
            if (!isset($_POST['woocommerce_woocommerce-gateway-tillit_merchant_logo']) || !isset($_POST['woocommerce_woocommerce-gateway-tillit_merchant_id'])) {
                return;
            }

            $image_id = sanitize_text_field($_POST['woocommerce_woocommerce-gateway-tillit_merchant_logo']);

            $image = $image_id ? wp_get_attachment_image_src($image_id, 'full') : null;
            $image_src = $image ? $image[0] : null;

            if (!$image_src) {
                return;
            }

            // Update the logo url for the invoice
            $response = $this->make_request("/v1/merchant/update", [
                'logo_path' => $image_src
            ]);

            if (is_wp_error($response)) {
                WC_Admin_Settings::add_error(sprintf(__('Could not forward invoice image URL to %s', 'twoinc-payment-gateway'), self::PRODUCT_NAME));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Could not send request to Two server:"
                    . "\r\n- Request: Update merchant logo"
                    . "\r\n- Site: " . get_site_url()
                );
                return;
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                WC_Admin_Settings::add_error(sprintf(__('Could not forward invoice image URL to %s', 'twoinc-payment-gateway'), self::PRODUCT_NAME));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Got error response from Two server:"
                    . "\r\n- Request: Update merchant logo"
                    . "\r\n- Response message: " . $twoinc_err
                    . "\r\n- Site: " . get_site_url()
                );
                //$this->update_option('merchant_logo');
                return;
            }

        }

        /**
         * Add invoice and credit note URLs
         */
        public function add_invoice_credit_note_urls($order)
        {
            if (!WC_Twoinc_Helper::is_twoinc_order($order)) {
                return;
            }

            if ($order->get_status() !== 'completed' && $order->get_status() !== 'refunded') {
                return;
            }

            $twoinc_order_id = $this->get_twoinc_order_id($order);

            if ($twoinc_order_id) {

                print('<div style="margin-top:20px;float:left;">');

                print('<p><a href="' . $this->get_twoinc_checkout_host() . "/v1/invoice/{$twoinc_order_id}/pdf?v=original&lang="
                      . WC_Twoinc_Helper::get_locale()
                      . '"><button type="button" class="button">'
                      . sprintf(__('Download %s invoice'), self::PRODUCT_NAME)
                      . '</button></a></p>');
                $state = $order->get_meta('_twoinc_order_state', true);
                if ($state == 'REFUNDED') {
                    print('<p><a href="' . $this->get_twoinc_checkout_host() . "/v1/invoice/{$twoinc_order_id}/pdf?lang="
                          . WC_Twoinc_Helper::get_locale()
                          . '"><button type="button" class="button">'
                          . sprintf(__('Download %s credit note'), self::PRODUCT_NAME)
                          .'</button></a><p>');
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
            if (!$twoinc_meta) {
                return;
            }

            if ($action == 'woocommerce_add_order_item') {
                $order->calculate_totals(true);
                $this->process_update_twoinc_order($order, $twoinc_meta, true);
            } elseif ($action == 'woocommerce_remove_order_item') {
                $this->process_update_twoinc_order($order, $twoinc_meta, true);
            } elseif ($action == 'woocommerce_save_order_items') {
                $this->process_update_twoinc_order($order, $twoinc_meta, true);
            } elseif ($action == 'woocommerce_add_order_fee') {
                $this->process_update_twoinc_order($order, $twoinc_meta, true);
            } elseif ($action == 'woocommerce_add_order_shipping') {
                $this->process_update_twoinc_order($order, $twoinc_meta, true);
                // } else if ($action == 'woocommerce_add_order_tax') {
                // } else if ($action == 'woocommerce_remove_order_tax') {
            } elseif ($action == 'woocommerce_calc_line_taxes') {
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

            if (!isset($_POST) || !isset($_POST['action']) || 'editpost' !== sanitize_text_field($_POST['action'])) {
                return;
            }

            $order = wc_get_order($post_id);
            if (!$order || !WC_Twoinc_Helper::is_twoinc_order($order)) {
                return;
            }

            $twoinc_meta = $this->get_save_twoinc_meta($order);
            if (!$twoinc_meta) {
                return;
            }

            // Store hash of twoinc req body
            $order->update_meta_data('_twoinc_req_body_hash', WC_Twoinc_Helper::hash_order($order, $twoinc_meta));
            $order->save();
        }

        /**
         * After the order update by post.php
         *
         * @param $order_id
         * @param $items
         */
        public function after_order_update($post_id, $post, $update, $post_before)
        {

            if (!isset($_POST) || !isset($_POST['action']) || 'editpost' !== sanitize_text_field($_POST['action'])) {
                return;
            }

            $order = wc_get_order($post_id);
            if ('shop_order' !== $post->post_type || !WC_Twoinc_Helper::is_twoinc_order($order)) {
                return;
            }

            $twoinc_meta = $this->get_save_twoinc_meta($order);
            if (!$twoinc_meta) {
                return;
            }

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
            $order->update_meta_data('_twoinc_req_body_hash', WC_Twoinc_Helper::hash_order($order, $twoinc_meta));

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
        public function add_invoice_fees()
        {

            if ($this->get_option('invoice_fee_to_buyer') === 'yes' && 'woocommerce-gateway-tillit' === WC()->session->get('chosen_payment_method')) {
                global $woocommerce;

                if (is_admin() && !defined('DOING_AJAX')) {
                    return;
                }

                $merchant_id = $this->get_merchant_id();

                if (!$merchant_id) {
                    WC()->session->set('chosen_payment_method', 'cod');
                    WC_Twoinc_Helper::send_twoinc_alert_email(
                        "Could not find Twoinc merchant ID:"
                        . "\r\n- Request: Get invoice fee"
                        . "\r\n- Site: " . get_site_url()
                    );
                    return;
                }

                // Get invoice fixed fee
                $response = $this->make_request("/v1/merchant/{$merchant_id}", [], 'GET');

                if (is_wp_error($response)) {
                    WC()->session->set('chosen_payment_method', 'cod');
                    WC_Twoinc_Helper::send_twoinc_alert_email(
                        "Could not send request to Two server:"
                        . "\r\n- Request: Get invoice fee"
                        . "\r\n- Twoinc merchant ID: " . $merchant_id
                        . "\r\n- Site: " . get_site_url()
                    );
                    return;
                }

                $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
                if ($twoinc_err) {
                    WC()->session->set('chosen_payment_method', 'cod');
                    WC_Twoinc_Helper::send_twoinc_alert_email(
                        "Got error response from Two server:"
                        . "\r\n- Request: Get invoice fee"
                        . "\r\n- Response message: " . $twoinc_err
                        . "\r\n- Twoinc merchant ID: " . $merchant_id
                        . "\r\n- Site: " . get_site_url()
                    );
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
        public static function on_order_edit_status($order_id, $to_status)
        {
            $wc_twoinc_instance = WC_Twoinc::get_instance();

            $to_status = strtolower($to_status);
            if ($to_status == 'completed') {
                $wc_twoinc_instance->on_order_completed($order_id);
            } elseif ($to_status == 'cancelled') {
                $wc_twoinc_instance->on_order_cancelled($order_id);
            } elseif ($to_status == 'refunded') {
                $wc_twoinc_instance->on_order_refunded($order_id);
            }
        }

        /**
         * Hook to call upon bulk order update to completed or cancelled status
         *
         * @param $redirect
         * @param $doaction
         * @param $object_ids
         */
        public static function on_order_bulk_edit_action($redirect, $doaction, $object_ids)
        {
            $wc_twoinc_instance = WC_Twoinc::get_instance();
            $success = [];
            $failure = [];
            if('mark_completed' === $doaction) {
                foreach ($object_ids as $order_id) {
                    $result = $wc_twoinc_instance->on_order_completed($order_id);
                    if ($result === true) {
                        $success[] = $order_id;
                    } elseif ($result === false) {
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
            } elseif ('mark_cancelled' === $doaction) {
                foreach ($object_ids as $order_id) {
                    $result = $wc_twoinc_instance->on_order_cancelled($order_id);
                    if ($result === true) {
                        $success[] = $order_id;
                    } elseif ($result === false) {
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
        public static function on_order_bulk_edit_notices()
        {
            if (!isset($_REQUEST['bulk_action'])) {
                return;
            }

            $bulk_action = $_REQUEST['bulk_action'];
            if (!in_array($bulk_action, ["marked_completed", "marked_cancelled"])) {
                return;
            }

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
                        '%s has acknowledged request to fulfill %d order. An invoice will be sent to the buyer when the fulfilment is complete.',
                        '%s has acknowledged request to fulfill %d orders. Invoices will be sent to the buyers when the fulfilments are complete.',
                        $success,
                        'twoinc-payment-gateway'
                    );
                    printf('<div id="message" class="notice notice-success is-dismissible"><p>' . $success_notice . '</p></div>', self::PRODUCT_NAME, $success);
                }
                foreach ($failure_order_ids as $order_id) {
                    $failure_notice = __('%s has failed to issue invoice for order %s.', 'twoinc-payment-gateway');
                    $order_url = sprintf('<a href="%s">%s</a>', wc_get_order($order_id)->get_edit_order_url(), $order_id);
                    printf('<div id="message" class="notice notice-error is-dismissible"><p>' . $failure_notice . '</p></div>', self::PRODUCT_NAME, $order_url);
                }
            } elseif ($_REQUEST['bulk_action'] == "marked_cancelled") {
                if ($success) {
                    $success_notice = _n('%s has cancelled %d order.', '%s has cancelled %d orders.', $success, 'twoinc-payment-gateway');
                    printf('<div id="message" class="notice notice-success is-dismissible"><p>' . $success_notice . '</p></div>', self::PRODUCT_NAME, $success);
                }
                foreach ($failure_order_ids as $order_id) {
                    $failure_notice = __('%s has failed to cancel order %s.', 'twoinc-payment-gateway');
                    $order_url = sprintf('<a href="%s">%s</a>', wc_get_order($order_id)->get_edit_order_url(), $order_id);
                    printf('<div id="message" class="notice notice-error is-dismissible"><p>' . $failure_notice . '</p></div>', self::PRODUCT_NAME, $order_url);
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

            // Get the Two order ID
            $twoinc_order_id = $this->get_twoinc_order_id($order);
            if (!$twoinc_order_id) {
                $error_message = sprintf(__('Could not update status to "Fulfilled" with %s.', 'twoinc-payment-gateway'), self::PRODUCT_NAME);
                $error_reason = sprintf(__('Reason: Could not find %s order ID.', 'twoinc-payment-gateway'), self::PRODUCT_NAME);
                $order->add_order_note($error_message . " " . $error_reason);
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Could not find Two order ID:"
                    . "\r\n- Request: Fulfill order"
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url()
                );
                return false;
            }

            $state = $order->get_meta('_twoinc_order_state', true);
            $skip = ["FULFILLING", "FULFILLED", "DELIVERED", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED"];
            if (in_array($state, $skip)) {
                // $order->add_order_note(sprintf(__('Order is already fulfilled with Two.', 'twoinc-payment-gateway'), $twoinc_order_id));
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Order already fulfilled:"
                    . "\r\n- Request: Fulfill order"
                    . "\r\n- Two order ID: " . $twoinc_order_id
                    . "\r\n- Merchant post ID: " . strval($order_id)
                    . "\r\n- Site: " . get_site_url()
                );
                return;
            }

            // Change the order status
            $response = $this->make_request("/v1/order/{$twoinc_order_id}/fulfillments");

            if (is_wp_error($response)) {
                $error_message = sprintf(
                    __('Could not update order status to "Fulfilled" with %s.', 'twoinc-payment-gateway'),
                    self::PRODUCT_NAME,
                    $twoinc_order_id
                );
                $contact_message = sprintf(__('Please contact %s support with order ID: %s', 'twoinc-payment-gateway'), self::PRODUCT_NAME, $twoinc_order_id);
                $order->add_order_note($error_message . " " . $contact_message);
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Could not send request to Two server:"
                    . "\r\n- Request: Fulfill order"
                    . "\r\n- Two order ID: " . $twoinc_order_id
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url()
                );
                return false;
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                $error_message = sprintf(
                    __('Could not update order status to "Fulfilled" with %s.', 'twoinc-payment-gateway'),
                    self::PRODUCT_NAME,
                    $twoinc_order_id
                );
                $contact_message = sprintf(__('Please contact %s support with order ID: %s', 'twoinc-payment-gateway'), self::PRODUCT_NAME, $twoinc_order_id);
                $response_message = sprintf(__('Response: %s', 'twoinc-payment-gateway'), $twoinc_err);
                $order->add_order_note($error_message . " " . $contact_message . " " . $response_message);
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Got error response from Two server:"
                    . "\r\n- Request: Fulfill order"
                    . "\r\n- Response message: " . $twoinc_err
                    . "\r\n- Two order ID: " . $twoinc_order_id
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url()
                );
                return false;
            }

            // Add order note
            $order_note = sprintf(__('%s has acknowledged the request to fulfil the order. An invoice will be sent to the buyer when the fulfilment is complete.', 'twoinc-payment-gateway'), self::PRODUCT_NAME);
            $order->add_order_note($order_note);

            // Decode the response
            $body = json_decode($response['body'], true);
            $order->update_meta_data('_twoinc_order_state', 'FULFILLING');
            $order->save();
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

            // Get the Two order ID
            $twoinc_order_id = $this->get_twoinc_order_id($order);

            if (!$twoinc_order_id) {
                $error_message = sprintf(__('Could not update status to "Cancelled".', 'twoinc-payment-gateway'), self::PRODUCT_NAME);
                $error_reason = sprintf(__('Reason: Could not find %s order ID.', 'twoinc-payment-gateway'), self::PRODUCT_NAME);
                $order->add_order_note($error_message . " " . $error_reason);
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Could not find Two order ID:"
                    . "\r\n- Request: Cancel order"
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url()
                );
                return false;
            }

            $state = $order->get_meta('_twoinc_order_state', true);
            if ($state == 'CANCELLED') {
                $order_note = sprintf(__('Order is already cancelled with %s.', 'twoinc-payment-gateway'), self::PRODUCT_NAME);
                $order->add_order_note($order_note);
                return;
            }

            // Change the order status
            $response = $this->make_request("/v1/order/{$twoinc_order_id}/cancel");

            if (is_wp_error($response)) {
                $error_message = __('Could not update status to "Cancelled".', 'twoinc-payment-gateway');
                $contact_message = sprintf(__('Please contact %s support with order ID: %s', 'twoinc-payment-gateway'), self::PRODUCT_NAME, $twoinc_order_id);
                $order->add_order_note($error_message. " " . $contact_message);
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Could not send request to Two server:"
                    . "\r\n- Request: Cancel order"
                    . "\r\n- Two order ID: " . $twoinc_order_id
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url()
                );
                return false;
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                $error_message = __('Could not update status to "Cancelled".', 'twoinc-payment-gateway');
                $contact_message = sprintf(__('Please contact %s support with order ID: %s', 'twoinc-payment-gateway'), self::PRODUCT_NAME, $twoinc_order_id);
                $response_message = sprintf(__('Response: %s', 'twoinc-payment-gateway'), $twoinc_err);
                $order->add_order_note($error_message. " " . $contact_message . " " . $response_message);
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Got error response from Two server:"
                    . "\r\n- Request: Cancel order"
                    . "\r\n- Response message: " . $twoinc_err
                    . "\r\n- Two order ID: " . $twoinc_order_id
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url()
                );
                return false;
            }

            $order->update_meta_data('_twoinc_order_state', "CANCELLED");
            $order->save();
            do_action('twoinc_order_cancelled', $order, $response);
            return true;
        }

        /**
         * Notify Twoinc API when the order status is refunded
         *
         * @param $order_id
         */
        public function on_order_refunded($order_id)
        {
            // Get the order
            $order = wc_get_order($order_id);
            $state = $order->get_meta('_twoinc_order_state', true);
            if ($state == 'REFUNDED') {
                return;
            }
            $result = $this->process_refund($order_id);
            if (is_wp_error($result)) {
                $order->add_order_note($result->get_error_message());
            }
            return;
        }

        /**
         * Static function wrapper for List out-of-sync orders
         *
         * @param request
         */
        public static function list_out_of_sync_order_ids_wrapper()
        {
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
        public function list_out_of_sync_order_ids($start_time, $end_time)
        {
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
                array_merge([$select_out_of_sync_q_str], $query_args)
            );
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
                'twoinc_order_id',
                'tillit_order_id',
                'shop_order',
                'wc-pending',
                'wc-failed',
                'trash',
                '_payment_method',
                'woocommerce-gateway-tillit',
                '_twoinc_order_state'
            );
            $results = $wpdb->get_results($select_no_two_state);
            foreach ($results as $row) {
                $ids[$row->id] = [
                    'two_state' => null,
                    'two_id' => $row->twoinc_oid,
                    'wp_status' => $row->post_status,
                    'modified_on' => $row->post_modified
                ];
            }

            return ['out_of_sync_orders' => $ids, 'count' => sizeof($ids), 'plugin_version' => get_twoinc_plugin_version()];
        }

        /**
         * Static function wrapper for Sync orders
         */
        public static function sync_order_state_wrapper()
        {
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
        public function sync_order_state($order_id, $persist)
        {
            // Get the order object
            $order = wc_get_order($order_id);

            // Check payment method
            if (!WC_Twoinc_Helper::is_twoinc_order($order)) {
                return new WP_Error('invalid_request', 'The order is not paid by Two', array('status' => 400));
            }

            // Get the Two order ID from shop order ID
            $twoinc_order_id = $this->get_twoinc_order_id($order);
            if (!$twoinc_order_id) {
                return new WP_Error('invalid_data', 'Could not find Two order ID', array('status' => 422));
            }

            // Get the Two order details
            $response = $this->make_request("/v1/order/{$twoinc_order_id}", [], 'GET');

            // Stop if request error or $response['response']['code'] < 400
            if (is_wp_error($response)) {
                return new WP_Error('internal_server_error', 'Could not send request to Two server', array('status' => 500));
            }
            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                return new WP_Error('internal_server_error', 'Got error response from Two server: ' . $twoinc_err, array('status' => 500));
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
            $current_state_in_db = $order->get_meta('_twoinc_order_state', true);
            if (!isset($current_state_in_db) || $current_state_in_db != $state) {
                $messages[] = 'Updated state from [' . $current_state_in_db . '] to [' . $state . '] for order ID [' . $order_id . ']';
                if ($persist) {
                    $order->update_meta_data('_twoinc_order_state', $state);
                    $order->save();
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
                } elseif ($wc_status == 'cancelled') {
                    if ($persist) {
                        $result = $this->on_order_cancelled($order_id);
                    }
                    $messages[] = 'Cancelled order ID [' . $order_id . ']';
                } elseif ($wc_status == 'refunded') {
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
        public static function get_plugin_configs_wrapper()
        {
            $wc_twoinc_instance = WC_Twoinc::get_instance();

            if (!WC_Twoinc_Helper::auth_rest_request($wc_twoinc_instance)) {
                return new WP_Error('unauthorized', 'Unauthorized', array('status' => 401));
            }

            return $wc_twoinc_instance->get_plugin_configs();
        }

        /**
         * Get config values
         */
        public function get_plugin_configs()
        {
            return [
                'config' => array_diff_key($this->settings, array_flip(['api_key'])),
                'plugin_version' => get_twoinc_plugin_version(),
                'data' => [
                    'status' => 200
                ]
            ];

        }

        /**
         * Static function wrapper for getting order info
         */
        public static function get_order_info_wrapper()
        {
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
        public function get_order_info($order_id)
        {
            // Get the order object
            $order = wc_get_order($order_id);

            // Check payment method
            if (!WC_Twoinc_Helper::is_twoinc_order($order)) {
                return new WP_Error('invalid_request', 'The order is not paid by Two', array('status' => 400));
            }

            // Get the Two order ID from shop order ID
            $twoinc_order_id = $this->get_twoinc_order_id($order);
            if (!$twoinc_order_id) {
                return new WP_Error('invalid_data', 'Could not find Two order ID', array('status' => 422));
            }

            $twoinc_order_body = null;
            // If the order is an old one without state, update it
            $current_state_in_db = $order->get_meta('_twoinc_order_state', true);
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
                    $twoinc_meta['vendor_name'],
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
        public static function display_user_meta_edit($user)
        {
            ?>
                <h3><?php printf(__('%s pre-filled fields', 'twoinc-payment-gateway'), self::PRODUCT_NAME); ?></h3>

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
        public static function save_user_meta($user_id)
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

            // Get data
            $company_id = array_key_exists('company_id', $_POST) ? sanitize_text_field($_POST['company_id']) : '';
            $department = array_key_exists('department', $_POST) ? sanitize_text_field($_POST['department']) : '';
            $project = array_key_exists('project', $_POST) ? sanitize_text_field($_POST['project']) : '';
            $purchase_order_number = array_key_exists('purchase_order_number', $_POST) ? sanitize_text_field($_POST['purchase_order_number']) : '';
            $tracking_id = array_key_exists('tracking_id', $_POST) ? sanitize_text_field($_POST['tracking_id']) : '';
            $merchant_id = $this->get_merchant_id();
            $order_reference = wp_generate_password(64, false, false);
            // For requests from order pay page
            $billing_country = array_key_exists('billing_country', $_POST) ? sanitize_text_field($_POST['billing_country']) : '';
            $billing_company = array_key_exists('billing_company', $_POST) ? sanitize_text_field($_POST['billing_company']) : '';
            $billing_phone = array_key_exists('billing_phone', $_POST) ? sanitize_text_field($_POST['billing_phone']) : '';
            $invoice_email = array_key_exists('invoice_email', $_POST) ? sanitize_text_field($_POST['invoice_email']) : '';
            $invoice_emails = $invoice_email ? [$invoice_email] : [];

            // Store the order meta
            $order->update_meta_data('_twoinc_order_reference', $order_reference);
            $order->update_meta_data('_twoinc_merchant_id', $merchant_id);
            $order->update_meta_data('company_id', $company_id);
            $order->update_meta_data('department', $department);
            $order->update_meta_data('project', $project);
            $order->update_meta_data('purchase_order_number', $purchase_order_number);

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
                $order->update_meta_data('_payment_reference_message', $payment_reference_message);
            }
            $payment_reference_ocr = '';
            if(has_filter('two_payment_reference_ocr')) {
                $payment_reference_ocr = apply_filters('two_payment_reference_ocr', $order_id);
                $order->update_meta_data('_payment_reference_ocr', $payment_reference_ocr);
            }
            $payment_reference = '';
            $payment_reference_type = '';
            if(has_filter('two_payment_reference')) {
                $payment_reference = apply_filters('two_payment_reference', $order_id);
                $order->update_meta_data('_payment_reference', $payment_reference);
                $payment_reference_type = 'assigned_by_merchant';
                $order->update_meta_data('_payment_reference_type', $payment_reference_type);
            }
            $order->update_meta_data('_invoice_emails', $invoice_emails);

            $vendor_name = $this->get_option('vendor_name');
            $order->update_meta_data('vendor_name', $vendor_name);

            $order->save();

            // Save to user meta
            $user_id = wp_get_current_user()->ID;
            if ($user_id) {
                if (!get_the_author_meta('twoinc_company_id', $user_id)) {
                    update_user_meta($user_id, 'twoinc_company_id', $company_id);
                }
                if (!get_the_author_meta('twoinc_billing_company', $user_id)) {
                    update_user_meta($user_id, 'twoinc_billing_company', $billing_company);
                }
                if (!get_the_author_meta('twoinc_department', $user_id)) {
                    update_user_meta($user_id, 'twoinc_department', $department);
                }
                if (!get_the_author_meta('twoinc_project', $user_id)) {
                    update_user_meta($user_id, 'twoinc_project', $project);
                }
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
                $vendor_name,
                $tracking_id
            ));

            if (is_wp_error($response)) {
                $error_message = sprintf(__('Failed to request order creation with %s.', 'twoinc-payment-gateway'), self::PRODUCT_NAME);
                $order->add_order_note($error_message);
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Could not send request to Two server:"
                    . "\r\n- Request: Create order"
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url()
                );
                return;
            }

            // Stop on process payment failure
            if (isset($response) && isset($response['result']) && $response['result'] === 'failure') {
                $error_message = sprintf(__('Failed to process payment with %s', 'twoinc-payment-gateway'), self::PRODUCT_NAME);
                $order->add_order_note($error_message);
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Got error response from Two server:"
                    . "\r\n- Request: Create order"
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url()
                );
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
                WC_Twoinc_Helper::display_ajax_error(sprintf(__('Invoice purchase with %s is not available for this order.', 'twoinc-payment-gateway'), self::PRODUCT_NAME));
                return;
            }

            // Store the Twoinc Order Id for future use
            $order->update_meta_data('twoinc_order_id', $body['id']);
            $twoinc_meta = $this->get_save_twoinc_meta($order, $body['id']);
            $twoinc_updated_order_hash = WC_Twoinc_Helper::hash_order($order, $twoinc_meta);
            $order->update_meta_data('_twoinc_req_body_hash', $twoinc_updated_order_hash);

            if (isset($body['state'])) {
                $order->update_meta_data('_twoinc_order_state', $body['state']);
            }

            $order->save();
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

        public function process_refund($order_id, $amount = null, $reason = '')
        {
            $order = wc_get_order($order_id);

            // Check payment method
            if (!WC_Twoinc_Helper::is_twoinc_order($order)) {
                return;
            }

            // Get the Two order ID
            $twoinc_order_id = $this->get_twoinc_order_id($order);
            if (!$twoinc_order_id) {
                $error_message = sprintf(__('Failed to request order refund with %s.', 'twoinc-payment-gateway'), self::PRODUCT_NAME);
                $error_reason = sprintf(__('Reason: Could not find %s order ID.', 'twoinc-payment-gateway'), self::PRODUCT_NAME);
                $order->add_order_note($error_message . ' ' . $error_reason);
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Could not find Two order ID:"
                    . "\r\n- Request: Refund order"
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url()
                );
                return new WP_Error(
                    'invalid_twoinc_refund',
                    sprintf(__('Could not find %s order ID', 'twoinc-payment-gateway'), self::PRODUCT_NAME)
                );
            }

            // Get and check refund data
            $state = $order->get_meta('_twoinc_order_state', true);
            if ($state === 'REFUNDED') {
                return new WP_Error(
                    'invalid_twoinc_refund',
                    sprintf(__('Order has already been fully refunded with %s.', 'twoinc-payment-gateway'), self::PRODUCT_NAME)
                );
            }

            $order_refunds = $order->get_refunds();
            $order_refund = null;
            // Need to loop instead of getting the last element because the last element is not always the latest refund
            foreach ($order_refunds as $refund) {
                if (!$refund->get_refunded_payment()) {
                    if (!$order_refund || $refund->get_date_created() > $order_refund->get_date_created()) {
                        $order_refund = $refund;
                    }
                }
            }

            if (!$order_refund) {
                return false;
            }

            $refund_amount = $order_refund->get_amount();
            if ($amount == null) {
                $amount = $refund_amount;
            } elseif ($amount != $refund_amount) {
                return new WP_Error(
                    'invalid_twoinc_refund',
                    sprintf(__('Could not initiate refund with %s', 'twoinc-payment-gateway'), self::PRODUCT_NAME)
                );
            }

            // Send refund request
            $response = $this->make_request(
                "/v1/order/{$twoinc_order_id}/refund",
                WC_Twoinc_Helper::compose_twoinc_refund(
                    $order_refund,
                    $amount,
                    $order->get_currency()
                ),
                'POST'
            );

            // Stop if request error
            if (is_wp_error($response)) {
                $error_message = sprintf(__('Failed to request order refund with %s.', 'twoinc-payment-gateway'), self::PRODUCT_NAME);
                $order->add_order_note($error_message);
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Could not send request to Two server:"
                    . "\r\n- Request: Refund order"
                    . "\r\n- Two order ID: " . $twoinc_order_id
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url()
                );
                return false;
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                $error_message = sprintf(__('Failed to request order refund with %s.', 'twoinc-payment-gateway'), self::PRODUCT_NAME);
                $contact_message = sprintf(__('Please contact %s support with order ID: %s', 'twoinc-payment-gateway'), self::PRODUCT_NAME, $twoinc_order_id);
                $response_message = sprintf(__('Response: %s', 'twoinc-payment-gateway'), $twoinc_err);
                $order->add_order_note($error_message. " " . $contact_message . " " . $response_message);
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Got error response from Two server:"
                    . "\r\n- Request: Refund order"
                    . "\r\n- Response message: " . $twoinc_err
                    . "\r\n- Two order ID: " . $twoinc_order_id
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url()
                );
                return new WP_Error(
                    'invalid_twoinc_refund',
                    sprintf(__('Could not initiate refund with %s.', 'twoinc-payment-gateway'), self::PRODUCT_NAME)
                );
            }

            // Decode the response
            $body = json_decode($response['body'], true);

            // Check if response is ok
            if (!$body['amount']) {
                $error_message = sprintf(__('Failed to request order refund with %s.', 'twoinc-payment-gateway'), self::PRODUCT_NAME);
                $contact_message = sprintf(__('Please contact %s support with order ID: %s', 'twoinc-payment-gateway'), self::PRODUCT_NAME, $twoinc_order_id);
                $order->add_order_note($error_message. " " . $contact_message);
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Got invalid response from Two server:"
                    . "\r\n- Request: Refund order"
                    . "\r\n- Response details: missing amount"
                    . "\r\n- Two order ID: " . $twoinc_order_id
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url()
                );
                return new WP_Error(
                    'invalid_twoinc_refund',
                    sprintf(__('Could not initiate refund with %s.', 'twoinc-payment-gateway'), self::PRODUCT_NAME)
                );
            }

            $state = "";
            $remaining_amt = $order->get_total() + (float) $body['amount'];
            if ($remaining_amt < 0.0001 && $remaining_amt > -0.0001) { // full refund, 0.0001 for float inaccuracy
                $order_note = sprintf(__('Invoice has been refunded and credit note has been sent by %s.', 'twoinc-payment-gateway'), self::PRODUCT_NAME);
                $state = "REFUNDED";
            } else { // partial refund
                $order_note = sprintf(__('Invoice has been partially refunded and credit note has been sent by %s.', 'twoinc-payment-gateway'), self::PRODUCT_NAME);
                $state = "PARTIALLY_REFUNDED";
            }
            $order->add_order_note($order_note);

            $order->update_meta_data('_twoinc_order_state', $state);
            $order->save();

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
        public static function process_confirmation_header_redirect()
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
        public static function process_confirmation_js_redirect()
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
        public static function before_process_confirmation()
        {

            $wc_twoinc_instance = WC_Twoinc::get_instance();
            // Set status to avoid 404 for confirmation page
            if ($wc_twoinc_instance->is_confirmation_page()) {
                status_header(200);
            }

        }

        /**
         * Check if current page is Two confirmation page
         *
         * @return bool
         */
        private function is_confirmation_page()
        {

            if (isset($_REQUEST['order_id']) && isset($_REQUEST['twoinc_order_reference']) && isset($_REQUEST['twoinc_nonce'])) {
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
            if (!$this->is_confirmation_page()) {
                return;
            }

            // Make sure this function is called only once per run
            if ($this->twoinc_process_confirmation_called) {
                return;
            }

            // Make sure this function is called only once per run
            $this->twoinc_process_confirmation_called = true;

            // Add status header to avoid being mistaken as 404 by other plugins
            status_header(200);

            $order_id = sanitize_text_field($_REQUEST['order_id']);

            $order = wc_get_order($order_id);

            // Check payment method
            if (!WC_Twoinc_Helper::is_twoinc_order($order)) {
                return;
            }

            // Get the order reference
            $order_reference = sanitize_text_field($_REQUEST['twoinc_order_reference']);

            // Verify order reference
            if (!$order_reference || $order_reference !== $order->get_meta('_twoinc_order_reference', true)) {
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Invalid order reference:"
                    . "\r\n- Request: Confirm order"
                    . "\r\n- Order reference: " . $order_reference
                    . "\r\n- Site: " . get_site_url()
                );
                wp_die(__('The security code is not valid.', 'twoinc-payment-gateway'));
            }

            if ($this->get_option('skip_confirm_auth') !== 'yes') {
                // Get the nonce
                $nonce = sanitize_text_field($_REQUEST['twoinc_nonce']);

                // Stop if the code is not valid
                if (!wp_verify_nonce($nonce, 'twoinc_confirm_' . $order_id)) {
                    WC_Twoinc_Helper::send_twoinc_alert_email(
                        "Invalid nonce:"
                        . "\r\n- Request: Confirm order"
                        . "\r\n- Merchant order ID: " . strval($order->get_id())
                        . "\r\n- Order reference: " . $order_reference
                        . "\r\n- Site: " . get_site_url()
                    );
                    wp_die(__('The security code is not valid.', 'twoinc-payment-gateway'));
                }
            }

            // Get the Two order ID from shop order ID
            $twoinc_order_id = $this->get_twoinc_order_id($order);
            if (!$twoinc_order_id) {
                $error_message = sprintf(__('Unable to retrieve %s order information.', 'twoinc-payment-gateway'), self::PRODUCT_NAME);
                $order->add_order_note($error_message);
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Could not find Two order ID:"
                    . "\r\n- Request: Confirm order"
                    . "\r\n- Merchant order ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url()
                );
                wp_die($error_message);
            }

            // Get the Two order details
            $response = $this->make_request("/v1/order/{$twoinc_order_id}/confirm", [], 'POST');

            // Stop if request error
            if (is_wp_error($response)) {
                $error_message = sprintf(__('Unable to retrieve %s order information.', 'twoinc-payment-gateway'), self::PRODUCT_NAME);
                $order->add_order_note($error_message);
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Could not send request to Two server:"
                    . "\r\n- Request: Confirm order"
                    . "\r\n- Two order ID: " . $twoinc_order_id
                    . "\r\n- Merchant order ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url()
                );
                wp_die($error_message);
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                $error_message = sprintf(__('Unable to confirm the order with %s.', 'twoinc-payment-gateway'), self::PRODUCT_NAME);
                $order->add_order_note($error_message);
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Got error response from Two server:"
                    . "\r\n- Request: Confirm order"
                    . "\r\n- Response message: " . $twoinc_err
                    . "\r\n- Two order ID: " . $twoinc_order_id
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url()
                );

                // Redirect the user to Woocom cancellation page
                return wp_specialchars_decode($order->get_cancel_order_url());

            }
            // After get_twoinc_error_msg, we can assume $response['response']['code'] < 400

            // Add note and update Two state
            $order_note = sprintf(__('Order ID %s has been placed with %s.', 'twoinc-payment-gateway'), $twoinc_order_id, self::PRODUCT_NAME);
            $order->add_order_note($order_note);
            $order->update_meta_data('_twoinc_order_state', 'CONFIRMED');
            $order->save();

            // Mark order as processing
            $order->payment_complete();

            // Redirect the user to confirmation page
            return wp_specialchars_decode($order->get_checkout_order_received_url());

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
                $available_types['sole_trader'] = __('Sole Trader', 'twoinc-payment-gateway');
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
                    'label'       => sprintf(__('Enable %s Payments', 'twoinc-payment-gateway'), self::PRODUCT_NAME),
                    'default'     => 'yes'
                ],
                'title' => [
                    'title'       => __('Title', 'twoinc-payment-gateway'),
                    'type'        => 'text',
                    'default'     => __('Business invoice - %s days', 'twoinc-payment-gateway')
                ],
                'test_checkout_host' => [
                    'type'        => 'text',
                    'title'       => sprintf(__('%s Test Server', 'twoinc-payment-gateway'), self::PRODUCT_NAME),
                    'default'     => 'https://api.staging.two.inc'
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
                'api_key' => [
                    'title'       => sprintf(__('%s API Key', 'twoinc-payment-gateway'), self::PRODUCT_NAME),
                    'type'        => 'password',
                ],
                'vendor_name' => [
                    'title'       => __('Optional vendor name if there are multiple sites', 'twoinc-payment-gateway'),
                    'type'        => 'text'
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
                    'description' => sprintf(__('Adds a separate checkout for business customers. %s payment is only available for business customers.', 'twoinc-payment-gateway'), self::PRODUCT_NAME),
                    'desc_tip'    => true,
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'yes'
                ],
                'checkout_personal' => [
                    'title'       => __('Separate checkout for private customers', 'twoinc-payment-gateway'),
                    'description' => sprintf(__('Adds a separate checkout for private customers. %s payment is not available for private customers.', 'twoinc-payment-gateway'), self::PRODUCT_NAME),
                    'desc_tip'    => true,
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
                    'description' => __('Adds an input field where buyers can input their department to display on the invoice.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'yes'
                ],
                'add_field_project' => [
                    'title'       => __('Add input field for "Project"', 'twoinc-payment-gateway'),
                    'description' => __('Adds an input field where buyers can input their project in the company to display on the invoice.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'yes'
                ],
                'add_field_purchase_order_number' => [
                    'title'       => __('Add input field for "Purchase order number"', 'twoinc-payment-gateway'),
                    'description' => __('Adds an input field where buyers can input their purchase order number to display on the invoice.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'yes'
                ],
                'add_field_invoice_email' => [
                    'title'       => __('Add input field for "Invoice email address"', 'twoinc-payment-gateway'),
                    'description' => __('Adds an input field where buyers can input optional additional email address to receive invoice.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'no'
                ],
                'use_account_type_buttons' => [
                    'title'       => __('Use buttons instead of radios to select account type', 'twoinc-payment-gateway'),
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'no'
                ],
                'show_abt_link' => [
                    'title'       => sprintf(__('Show "What is %s" link in checkout', 'twoinc-payment-gateway'), self::PRODUCT_NAME),
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
                            <input <?php disabled($data['disabled'], true); ?> class="<?php echo esc_attr($data['class']); ?>" type="radio" name="<?php echo esc_attr($field_key); ?>" id="<?php echo esc_attr($field_key); ?>" style="<?php echo esc_attr($data['css']); ?>" value="1" <?php checked($data['checked'] === true, true); ?> <?php echo $this->get_custom_attribute_html($data); // WPCS: XSS ok.?> /> <?php echo wp_kses_post($data['label']); ?></label><br/>
                        <?php echo $this->get_description_html($data); // WPCS: XSS ok.?>
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
         * Get twoinc meta from DB and Two server
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
                    $order->add_order_note(__('Unable to retrieve the order information.', 'twoinc-payment-gateway'));
                    WC_Twoinc_Helper::send_twoinc_alert_email(
                        "Could not find Two order ID:"
                        . "\r\n- Request: Get order: get_save_twoinc_meta"
                        . "\r\n- Merchant post ID: " . strval($order->get_id())
                        . "\r\n- Site: " . get_site_url()
                    );
                    return;
                }
            }

            $order_reference = $order->get_meta('_twoinc_order_reference') ?? $order->get_meta('_tillit_order_reference');
            $merchant_id = $order->get_meta('_twoinc_merchant_id') ?? $order->get_meta('_tillit_merchant_id');
            if (!$merchant_id) {
                $merchant_id = $this->get_merchant_id();
                $order->update_meta_data('_twoinc_merchant_id', $merchant_id);
                $order->save();
            }

            // Extract vendor name
            $vendor_name = $order->get_meta('vendor_name');
            if (!$vendor_name) {
                $vendor_name = $this->get_option('vendor_name');
                $order->update_meta_data('vendor_name', $vendor_name);
                $order->save();
            }

            $company_id = $order->get_meta('company_id');
            if ($company_id) {
                $department = $order->get_meta('department');
                $project = $order->get_meta('project');
                $purchase_order_number = $order->get_meta('purchase_order_number');
                $invoice_emails = $order->get_meta('_invoice_emails', true);
            } else {
                $response = $this->make_request("/v1/order/{$twoinc_order_id}", [], 'GET');

                // Stop if request error
                if (is_wp_error($response)) {
                    $order->add_order_note(__('Unable to retrieve the order information.', 'twoinc-payment-gateway'));
                    WC_Twoinc_Helper::send_twoinc_alert_email(
                        "Could not send request to Two server:"
                        . "\r\n- Request: Get order: get_save_twoinc_meta"
                        . "\r\n- Two order ID: " . $twoinc_order_id
                        . "\r\n- Merchant post ID: " . strval($order->get_id())
                        . "\r\n- Site: " . get_site_url()
                    );
                    return;
                }

                $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
                if ($twoinc_err) {
                    $order->add_order_note(__('Unable to retrieve the order payment information', 'twoinc-payment-gateway'));
                    WC_Twoinc_Helper::send_twoinc_alert_email(
                        "Got error response from Two server:"
                        . "\r\n- Request: Get order: get_save_twoinc_meta"
                        . "\r\n- Response message: " . $twoinc_err
                        . "\r\n- Two order ID: " . $twoinc_order_id
                        . "\r\n- Merchant post ID: " . strval($order->get_id())
                        . "\r\n- Site: " . get_site_url()
                    );
                    return;
                }

                $body = json_decode($response['body'], true);
                if (!$body || !$body['buyer'] || !$body['buyer']['company'] || !$body['buyer']['company']['organization_number']) {
                    $error_message = __('Missing company ID.', 'twoinc-payment-gateway');
                    $contact_message = sprintf(__('Please contact %s support with order ID: %s', 'twoinc-payment-gateway'), self::PRODUCT_NAME, $twoinc_order_id);
                    $order->add_order_note($error_message . ' ' . $contact_message);
                    WC_Twoinc_Helper::send_twoinc_alert_email(
                        "Could not send request to Two server:"
                        . "\r\n- Request: Get order: get_save_twoinc_meta"
                        . "\r\n- Response details: Missing company ID"
                        . "\r\n- Two order ID: " . $twoinc_order_id
                        . "\r\n- Merchant post ID: " . strval($order->get_id())
                        . "\r\n- Site: " . get_site_url()
                    );
                    return;
                }
                $company_id = $body['buyer']['company']['organization_number'];
                $department = $body['buyer_department'];
                $project = $body['buyer_project'];
                $purchase_order_number = $body['buyer_purchase_order_number'];
                $invoice_emails = $body['invoice_details']['invoice_emails'];
                $order->update_meta_data('company_id', $company_id);
                $order->update_meta_data('department', $department);
                $order->update_meta_data('project', $project);
                $order->update_meta_data('purchase_order_number', $purchase_order_number);
                $order->update_meta_data('_invoice_emails', $invoice_emails);
                $order->save();
            }

            return array(
                'order_reference' => $order_reference,
                'merchant_id' => $merchant_id,
                'company_id' => $company_id,
                'department' => $department,
                'project' => $project,
                'purchase_order_number' => $purchase_order_number,
                'twoinc_order_id' => $twoinc_order_id,
                'payment_reference_message' => $order->get_meta('payment_reference_message'),
                'payment_reference_ocr' => $order->get_meta('payment_reference_ocr'),
                'payment_reference' => $order->get_meta('payment_reference'),
                'payment_reference_type' => $order->get_meta('payment_reference_type'),
                'vendor_name' => $vendor_name,
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
                    $order->update_meta_data('_twoinc_req_body_hash', $twoinc_updated_order_hash);
                    $order->save();
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
                $error_message = sprintf(__('Could not edit the order with %s.', 'twoinc-payment-gateway'), self::PRODUCT_NAME);
                $error_reason = sprintf(__('Reason: Could not find %s order ID.', 'twoinc-payment-gateway'), self::PRODUCT_NAME);
                $order->add_order_note($error_message . ' ' . $error_reason);
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Could not find Two order ID:"
                    . "\r\n- Request: Edit order"
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url()
                );
                return false;
            }

            // 1. Get information from the current order
            $twoinc_meta = $this->get_save_twoinc_meta($order);
            if (!$twoinc_meta) {
                return false;
            }

            // 2. Edit the order
            $order = wc_get_order($order->get_id());
            $response = $this->make_request(
                "/v1/order/{$twoinc_order_id}",
                WC_Twoinc_Helper::compose_twoinc_edit_order(
                    $order,
                    $twoinc_meta['department'],
                    $twoinc_meta['project'],
                    $twoinc_meta['purchase_order_number'],
                    $twoinc_meta['vendor_name']
                ),
                'PUT'
            );

            if (is_wp_error($response)) {
                $error_message = sprintf(__('Could not edit the order with %s.', 'twoinc-payment-gateway'), self::PRODUCT_NAME);
                $order->add_order_note($error_message);
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Could not send request to Two server:"
                    . "\r\n- Request: Edit order"
                    . "\r\n- Two order ID: " . $twoinc_order_id
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url()
                );
                return false;
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                $error_message = sprintf(__('Could not edit the order with %s.', 'twoinc-payment-gateway'), self::PRODUCT_NAME);
                $contact_message = sprintf(__('Please contact %s support with order ID: %s', 'twoinc-payment-gateway'), self::PRODUCT_NAME, $twoinc_order_id);
                $response_message = sprintf(__('Response: %s', 'twoinc-payment-gateway'), $twoinc_err);
                $order->add_order_note($error_message . ' ' . $contact_message . ' ' . $response_message);
                WC_Twoinc_Helper::send_twoinc_alert_email(
                    "Got error response from Two server:"
                    . "\r\n- Request: Edit order"
                    . "\r\n- Response message: " . $twoinc_err
                    . "\r\n- Two order ID: " . $twoinc_order_id
                    . "\r\n- Merchant post ID: " . strval($order->get_id())
                    . "\r\n- Site: " . get_site_url()
                );
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
            $order_note = sprintf(__('The order edit request has been accepted by %s.', 'twoinc-payment-gateway'), self::PRODUCT_NAME);
            if ($gross_amount) {
                $order_note = $order_note . " " . sprintf(__('Order value is now %s.', 'twoinc-payment-gateway'), strval($gross_amount));
            }
            $order->add_order_note($order_note);

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
            $params['client_v'] = get_twoinc_plugin_version();
            $headers = [
               'Accept-Language' => WC_Twoinc_Helper::get_locale(),
               'Content-Type' => 'application/json; charset=utf-8',
               'X-API-Key' => $this->get_option('api_key')
            ];
            if (isset($_SERVER['HTTP_X_CLOUD_TRACE_CONTEXT'])) {
                $headers['HTTP_X_CLOUD_TRACE_CONTEXT'] = $_SERVER['HTTP_X_CLOUD_TRACE_CONTEXT'];
            }
            return wp_remote_request(sprintf('%s%s?%s', $this->get_twoinc_checkout_host(), $endpoint, http_build_query($params)), [
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
        public function twoinc_account_init_notice()
        {
            global $pagenow;
            if ($pagenow !== 'options-general.php') {
                $headline = sprintf(__('Grow your B2B sales with Buy Now, Pay Later using %s!', 'twoinc-payment-gateway'), self::PRODUCT_NAME);
                $benefits = sprintf(__('%s credit approves 90%% of business buyers, pays you upfront and minimise your risk. To offer %s in your checkout, you need to signup. It’s quick, easy and gives you immediate access to the %s Merchant Portal.', 'twoinc-payment-gateway'), self::PRODUCT_NAME, self::PRODUCT_NAME, self::PRODUCT_NAME);
                $setup_account = sprintf(__('Set up my %s account', 'twoinc-payment-gateway'), self::PRODUCT_NAME);
                echo '
                <div id="twoinc-account-init-notice" class="notice notice-info is-dismissible" style="background-image: url(\'' . WC_TWOINC_PLUGIN_URL . 'assets/images/banner.png\');background-size: cover;border-left-width: 0;background-color: #e2e0ff;padding: 20px;display: flex;">
                    <div style="width:60%;padding-right:40px;">
                        <img style="width: 100px;" src="' . WC_TWOINC_PLUGIN_URL . 'assets/images/two-logo-w.svg">
                        <p style="color: #ffffff;font-size: 1.3em;text-align: justify;font-weight:700;">' . $headline . '</p>
                        <p style="color: #ffffff;font-size: 1.3em;text-align: justify;">' . $benefits . '</p>
                    </div>
                    <div>
                        <div style="position: absolute;top: 50%;transform: translateY(-50%);right: 40px;">
                            <a href="' . self::MERCHANT_SIGNUP_URL . '" target="_blank" class="button" style="margin-left: 20px;background: #edf3ff;font-size: 1.1em;font-weight: 600;color: #4848e6;padding: 7px 30px;border-color: #edf3ff;border-radius: 12px;">' . $setup_account . '</a>
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
