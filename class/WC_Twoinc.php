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

        // BC-frozen: external integrations may read these constants, but all
        // runtime reads go through WC_Twoinc_Brand so overlays can rebrand.
        // They mirror brands/two.php; tests/unit pins them against drift.
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

            $this->id = WC_Twoinc_Brand::get('gateway_id');
            $this->has_fields = false;
            $this->order_button_text = __('Place order', 'twoinc-payment-gateway');
            $this->method_title = WC_Twoinc_Brand::get('product_name');
            $this->method_description = __('Making it easy for businesses to buy online.', 'twoinc-payment-gateway');
            $this->icon = WC_HTTPS::force_https_url(WC_Twoinc_Brand::get('logo_url'));
            $this->supports = ['products', 'refunds'];

            // Load the settings
            $this->init_form_fields();
            $this->init_settings();

            $this->title = sprintf(
                __($this->get_option('title'), 'twoinc-payment-gateway'),
                strval($this->get_merchant_default_days_on_invoice())
            );
            /**
             * Filter the checkout payment-box description so a brand
             * overlay can replace the copy wholesale (a brand overlay
             * ships its own bullet list).
             *
             * Applied once at gateway construction: like
             * twoinc_brand_file, an overlay must register this filter no
             * later than plugins_loaded at default priority.
             *
             * @param string     $description Default description HTML.
             * @param WC_Twoinc  $gateway     The gateway instance (for
             *                                get_option reads).
             */
            $this->description = apply_filters(
                'twoinc_payment_description',
                $this->get_pay_box_description() . $this->get_pay_subtitle(),
                $this
            );

            // Skip hooks if another instance has already been created
            if (null !== self::$instance) {
                return;
            }

            // Brand product constraints (e.g. a minimum order value in a
            // specific currency/market) remove the gateway from checkout
            // when unmet. Config-driven; the Two brand sets no gate.
            add_filter('woocommerce_available_payment_gateways', [$this, 'apply_brand_availability_gate']);

            // Payment terms chip selector + offset pricing fee (TWO-24751).
            // Business logic lives in WC_Twoinc_Payment_Terms; the JS layer
            // renders only what these endpoints return.
            // NOTE: the surcharge cart-fee hook and the wc_ajax_two_*
            // endpoints are registered in load_twoinc_classes()
            // (plugins_loaded), not here — the gateway constructor is not
            // guaranteed to have run before woocommerce_cart_calculate_fees
            // fires on an update_order_review recalc, nor on a standalone
            // wc-ajax request.

            if (is_admin()) {
                // Notice banner if plugin is not setup properly

                add_action('admin_notices', [$this, 'twoinc_account_init_notice']);
                add_action('network_admin_notices', [$this, 'twoinc_account_init_notice']);

                // Verify API key quietly
                add_action('admin_enqueue_scripts', [$this, 'verify_api_key_action']);

                // On plugin deactivated
                add_action('deactivate_' . plugin_basename(__FILE__), [$this, 'on_deactivate_plugin']);

                // Add js css to admin page
                add_action('admin_enqueue_scripts', [$this, 'twoinc_admin_styles_scripts']);

                // On setting updated
                add_action('woocommerce_update_options_payment_gateways_' . $this->id, [$this, 'process_admin_options']); // Built-in process_admin_options

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
                add_action('wp_after_insert_post', [$this, 'after_order_update'], 10, 4);
            } else {
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
         * Get enable company search
         *
         * @return string
         */
        public function get_enable_company_search()
        {
            return $this->get_option('enable_company_search') ?? $this->get_option('enable_company_name');
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

                    if (!is_wp_error($response)) {
                        $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
                        if (!$twoinc_err && $response && $response['body']) {
                            $body = json_decode($response['body'], true);
                            if ($body['due_in_days']) {
                                $days_on_invoice = $body['due_in_days'];
                            } else {
                                // If Twoinc DB has null value, also default to 14 days
                                $days_on_invoice = 14;
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
                $abt_url = WC_Twoinc_Brand::get('about_url');
                $product_name = WC_Twoinc_Brand::get('product_name');
                $link = '<a href="' . esc_url($abt_url) . '" target="_blank">' . sprintf(__('What is %s?', 'twoinc-payment-gateway'), $product_name) . '</a>';
                $text = sprintf(
                    '<p>%s</p><p><b>%s</b></p>',
                    sprintf(__('%s is a payment solution for B2B purchases online, allowing you to buy from your favourite merchants and suppliers on trade credit. Using %s, you can access flexible trade credit instantly to make purchasing simple.', 'twoinc-payment-gateway'), $product_name, $product_name),
                    __('Buy now, receive your goods, pay your invoice later.', 'twoinc-payment-gateway'),
                    $abt_url,
                );
                $html = sprintf('<div class="abt-twoinc-text">%s</div><div class="abt-twoinc-link">%s</div>', $text, $link);
            } else {
                $html = '';
            }

            /**
             * Filter the "about" block inside the payment-box subtitle —
             * the piece of the description brand overlays actually
             * replace (a brand overlay ships its own bullet list).
             * Register by plugins_loaded (computed at gateway
             * construction).
             *
             * @param string    $html    Default about-block HTML ('' when
             *                           the merchant disabled the link).
             * @param WC_Twoinc $gateway The gateway instance.
             */
            return apply_filters('twoinc_about_html', $html, $this);
        }

        /**
         * Get payment box description
         */
        private function get_pay_box_description()
        {

            return sprintf(
                '<div>
                    <div class="twoinc-pay-box twoinc-explainer">%s</div>
                    <div class="twoinc-sole-trader-toggle hidden" role="radiogroup"></div>
                    <div class="twoinc-term-chips hidden" role="radiogroup"></div>
                    <div class="twoinc-pay-box twoinc-loader hidden"></div>
                    <div class="twoinc-pay-box twoinc-intent-approved hidden">%s</div>
                    <div class="twoinc-pay-box twoinc-err-payment-default hidden">%s</div>
                    <div class="twoinc-pay-box twoinc-err-phone-number hidden">%s</div>
                </div>',
                sprintf(__('%s lets your business pay later for the goods you purchase online.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name')),
                sprintf(__('Your invoice purchase with %s is likely to be accepted subject to additional checks.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name')),
                sprintf(__('Invoice purchase with %s is not available for this order.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name')),
                __('Phone number is invalid.', 'twoinc-payment-gateway')
            );
        }

        /**
         * Admin option list of the brand's term days, for the payment-terms
         * settings fields.
         *
         * @return array<string, string>
         */
        private function get_payment_term_day_options(): array
        {
            $options = [];
            $brand_terms = WC_Twoinc_Brand::get('available_terms');
            foreach (is_array($brand_terms) ? $brand_terms : [] as $days) {
                $options[strval((int) $days)] = sprintf(__('%s days', 'twoinc-payment-gateway'), (int) $days);
            }
            return $options;
        }

        /**
         * Admin option list of the brand's surcharge rounding steps, in
         * canonical two-decimal form so the stored value round-trips
         * against the option list (WC_Twoinc_Payment_Terms reads it back).
         * Mirrors the Magento RoundingStep source model.
         *
         * @return array<string, string>
         */
        private function get_rounding_step_options(): array
        {
            $options = [];
            $brand_steps = WC_Twoinc_Brand::get('available_rounding_steps');
            foreach (is_array($brand_steps) ? $brand_steps : [] as $step) {
                if (!is_numeric($step) || (float) $step <= 0) {
                    continue;
                }
                $value = number_format((float) $step, 2, '.', '');
                $options[$value] = $value;
            }
            // Ascending, mirroring the Magento Loader's numeric sort (keys
            // are the formatted strings, so equal values already dedup).
            ksort($options, SORT_NUMERIC);
            return $options;
        }

        /**
         * Enforce that a saved rounding step is one the brand actually
         * offers. WooCommerce's default select validation sanitises but does
         * not enforce option-list membership, so without this a tampered or
         * stale POST could persist an arbitrary step that build_rounding()
         * would relay verbatim to the pricing API. Empty ('' = no rounding)
         * is allowed; any other value must be a current option.
         */
        public function validate_surcharge_rounding_step_field($key, $value)
        {
            $value = trim((string) $value);
            if ($value === '') {
                return '';
            }
            if (!array_key_exists($value, $this->get_rounding_step_options())) {
                throw new Exception(__('Rounding step must be one of the offered values.', 'twoinc-payment-gateway'));
            }
            return $value;
        }

        /**
         * Render the per-term surcharge grid (WC Settings API custom field
         * `two_surcharge_grid`). One row per offered term, columns
         * fixed/percentage/cap, mirroring the Magento surcharge grid. Values
         * are stored as a single option array keyed by term days.
         */
        public function generate_two_surcharge_grid_html($key, $data)
        {
            $field_key = $this->get_field_key($key);
            $data = wp_parse_args($data, ['title' => '', 'description' => '']);
            $stored = $this->get_option($key);
            $stored = is_array($stored) ? $stored : [];
            $terms = class_exists('WC_Twoinc_Payment_Terms') ? WC_Twoinc_Payment_Terms::get_available_terms($this) : [];

            ob_start();
            ?>
            <tr valign="top">
                <th scope="row" class="titledesc"><label><?php echo wp_kses_post($data['title']); ?></label></th>
                <td class="forminp">
                    <?php if ($data['description']) : ?>
                        <p class="description"><?php echo wp_kses_post($data['description']); ?></p>
                    <?php endif; ?>
                    <?php if (empty($terms)) : ?>
                        <p><?php esc_html_e('No payment terms are offered yet — configure the offered terms above first.', 'twoinc-payment-gateway'); ?></p>
                    <?php else : ?>
                    <table class="widefat" style="max-width:620px">
                        <thead><tr>
                            <th><?php esc_html_e('Term (days)', 'twoinc-payment-gateway'); ?></th>
                            <th><?php esc_html_e('Fixed', 'twoinc-payment-gateway'); ?></th>
                            <th><?php esc_html_e('Percentage (%)', 'twoinc-payment-gateway'); ?></th>
                            <th><?php esc_html_e('Cap', 'twoinc-payment-gateway'); ?></th>
                        </tr></thead>
                        <tbody>
                        <?php foreach ($terms as $days) :
                            $row = isset($stored[$days]) && is_array($stored[$days]) ? $stored[$days] : []; ?>
                            <tr>
                                <td><?php echo esc_html($days); ?></td>
                                <td><input type="text" name="<?php echo esc_attr($field_key); ?>[<?php echo esc_attr($days); ?>][fixed]" value="<?php echo esc_attr(isset($row['fixed']) ? $row['fixed'] : ''); ?>" style="width:90px" /></td>
                                <td><input type="text" name="<?php echo esc_attr($field_key); ?>[<?php echo esc_attr($days); ?>][percentage]" value="<?php echo esc_attr(isset($row['percentage']) ? $row['percentage'] : ''); ?>" style="width:90px" /></td>
                                <td><input type="text" name="<?php echo esc_attr($field_key); ?>[<?php echo esc_attr($days); ?>][limit]" value="<?php echo esc_attr(isset($row['limit']) ? $row['limit'] : ''); ?>" style="width:90px" /></td>
                            </tr>
                        <?php endforeach; ?>
                        </tbody>
                    </table>
                    <?php endif; ?>
                </td>
            </tr>
            <?php
            return ob_get_clean();
        }

        /**
         * Validate + normalise the posted surcharge grid into an array keyed
         * by term days, each row holding the non-empty of fixed/percentage/
         * limit as canonical numeric strings. Empty cells are dropped; blank
         * rows omitted. Rejects negatives and out-of-range percentages.
         */
        public function validate_two_surcharge_grid_field($key, $value)
        {
            $clean = [];
            if (!is_array($value)) {
                return $clean;
            }
            foreach ($value as $days => $cols) {
                $days = (int) $days;
                if ($days <= 0 || !is_array($cols)) {
                    continue;
                }
                $row = [];
                foreach (['fixed', 'percentage', 'limit'] as $col) {
                    $raw = isset($cols[$col]) ? trim(str_replace(',', '.', (string) $cols[$col])) : '';
                    if ($raw === '') {
                        continue;
                    }
                    if (!is_numeric($raw) || (float) $raw < 0) {
                        throw new Exception(sprintf(
                            /* translators: 1: column name, 2: term days */
                            __('Surcharge %1$s for the %2$s-day term must be a non-negative number.', 'twoinc-payment-gateway'),
                            $col,
                            $days
                        ));
                    }
                    if ($col === 'percentage' && (float) $raw > 100) {
                        throw new Exception(sprintf(
                            /* translators: %s: term days */
                            __('Surcharge percentage for the %s-day term must be between 0 and 100.', 'twoinc-payment-gateway'),
                            $days
                        ));
                    }
                    $row[$col] = $raw;
                }
                if (!empty($row)) {
                    $clean[$days] = $row;
                }
            }
            return $clean;
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
                if ($payment_id === $this->id) {
                    $title = $this->get_pay_html_title();
                }
                return $title;
            }, 10, 2);
        }

        /**
         * Verify API key action
         *
         * Using admin_enqueue_scripts passes the page name as the first argument which prevents the merchant_id from being updated.
         */
        public function verify_api_key_action()
        {
            $this->verify_api_key();
        }

        public function verify_api_key($api_key = null)
        {
            $api_key_to_use = $api_key ?: $this->get_option('api_key');

            if (!$api_key_to_use || !$this->get_twoinc_checkout_host()) {
                return;
            }

            $response = $this->make_request("/v1/merchant/verify_api_key", [], 'GET', [], $api_key_to_use);

            if (!$response || is_wp_error($response)) {
                return;
            }
            if (isset($response['body'])) {
                $body = json_decode($response['body'], true);
                $code = $response['response']['code'];
                if ($code == 200 && isset($body['id']) && !$api_key) {
                    // Only update merchant_id if we're verifying the saved API key
                    $this->update_option('merchant_id', $body['id']);
                }
                return ['body' => $body, 'code' => $code];
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
                    . sprintf(__('Download %s invoice', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'))
                    . '</button></a></p>');

                $refunded_payments = array_filter($order->get_refunds(), fn($refund) => $refund->get_refunded_payment());
                if (count($refunded_payments) > 0) {
                    print('<p><a href="' . $this->get_twoinc_checkout_host() . "/v1/invoice/{$twoinc_order_id}/pdf?lang="
                        . WC_Twoinc_Helper::get_locale()
                        . '"><button type="button" class="button">'
                        . sprintf(__('Download %s credit note', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'))
                        . '</button></a><p>');
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

            // Localize script for AJAX
            wp_localize_script('twoinc.admin', 'twoinc_admin', [
                'gateway_id' => $this->id,
                'nonce' => wp_create_nonce('twoinc_admin_nonce'),
                'ajax_url' => admin_url('admin-ajax.php')
            ]);
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
            if ('mark_completed' === $doaction) {
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
            if ($_REQUEST['bulk_action'] == "marked_completed") {
                if ($success) {
                    $success_notice = _n(
                        '%s has acknowledged request to fulfill %d order. An invoice will be sent to the buyer when the fulfilment is complete.',
                        '%s has acknowledged request to fulfill %d orders. Invoices will be sent to the buyers when the fulfilments are complete.',
                        $success,
                        'twoinc-payment-gateway'
                    );
                    printf('<div id="message" class="notice notice-success is-dismissible"><p>' . $success_notice . '</p></div>', WC_Twoinc_Brand::get('product_name'), $success);
                }
                foreach ($failure_order_ids as $order_id) {
                    $failure_notice = __('%s has failed to issue invoice for order %s.', 'twoinc-payment-gateway');
                    $order_url = sprintf('<a href="%s">%s</a>', wc_get_order($order_id)->get_edit_order_url(), $order_id);
                    printf('<div id="message" class="notice notice-error is-dismissible"><p>' . $failure_notice . '</p></div>', WC_Twoinc_Brand::get('product_name'), $order_url);
                }
            } elseif ($_REQUEST['bulk_action'] == "marked_cancelled") {
                if ($success) {
                    $success_notice = _n('%s has cancelled %d order.', '%s has cancelled %d orders.', $success, 'twoinc-payment-gateway');
                    printf('<div id="message" class="notice notice-success is-dismissible"><p>' . $success_notice . '</p></div>', WC_Twoinc_Brand::get('product_name'), $success);
                }
                foreach ($failure_order_ids as $order_id) {
                    $failure_notice = __('%s has failed to cancel order %s.', 'twoinc-payment-gateway');
                    $order_url = sprintf('<a href="%s">%s</a>', wc_get_order($order_id)->get_edit_order_url(), $order_id);
                    printf('<div id="message" class="notice notice-error is-dismissible"><p>' . $failure_notice . '</p></div>', WC_Twoinc_Brand::get('product_name'), $order_url);
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
                $error_message = sprintf(__('Could not update status to "Fulfilled" with %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $error_reason = sprintf(__('Reason: Could not find %s order ID.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $order->add_order_note($error_message . " " . $error_reason);
                return false;
            }

            $state = $order->get_meta(WC_Twoinc_Brand::meta_key('order_state'), true);
            $skip = ["FULFILLING", "FULFILLED", "DELIVERED", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED"];
            if (in_array($state, $skip)) {
                // $order->add_order_note(sprintf(__('Order is already fulfilled with Two.', 'twoinc-payment-gateway'), $twoinc_order_id));
                return;
            }

            // Change the order status
            $response = $this->make_request("/v1/order/{$twoinc_order_id}/fulfillments");

            if (is_wp_error($response)) {
                $error_message = sprintf(
                    __('Could not update order status to "Fulfilled" with %s.', 'twoinc-payment-gateway'),
                    WC_Twoinc_Brand::get('product_name'),
                    $twoinc_order_id
                );
                $contact_message = sprintf(__('Please contact %s support with order ID: %s', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'), $twoinc_order_id);
                $order->add_order_note($error_message . " " . $contact_message);
                return false;
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                $error_message = sprintf(
                    __('Could not update order status to "Fulfilled" with %s.', 'twoinc-payment-gateway'),
                    WC_Twoinc_Brand::get('product_name'),
                    $twoinc_order_id
                );
                $contact_message = sprintf(__('Please contact %s support with order ID: %s', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'), $twoinc_order_id);
                $response_message = sprintf(__('Response: %s', 'twoinc-payment-gateway'), $twoinc_err);
                $order->add_order_note($error_message . " " . $contact_message . " " . $response_message);
                return false;
            }

            // Add order note
            $order_note = sprintf(__('%s has acknowledged the request to fulfil the order. An invoice will be sent to the buyer when the fulfilment is complete.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
            $order->add_order_note($order_note);

            // Decode the response
            $body = json_decode($response['body'], true);
            $order->update_meta_data(WC_Twoinc_Brand::meta_key('order_state'), 'FULFILLING');
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
                $error_message = sprintf(__('Could not update status to "Cancelled".', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $error_reason = sprintf(__('Reason: Could not find %s order ID.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $order->add_order_note($error_message . " " . $error_reason);
                return false;
            }

            $state = $order->get_meta(WC_Twoinc_Brand::meta_key('order_state'), true);
            if ($state == 'CANCELLED') {
                $order_note = sprintf(__('Order is already cancelled with %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $order->add_order_note($order_note);
                return;
            }

            // Change the order status
            $response = $this->make_request("/v1/order/{$twoinc_order_id}/cancel");

            if (is_wp_error($response)) {
                $error_message = __('Could not update status to "Cancelled".', 'twoinc-payment-gateway');
                $contact_message = sprintf(__('Please contact %s support with order ID: %s', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'), $twoinc_order_id);
                $order->add_order_note($error_message . " " . $contact_message);
                return false;
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                $error_message = __('Could not update status to "Cancelled".', 'twoinc-payment-gateway');
                $contact_message = sprintf(__('Please contact %s support with order ID: %s', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'), $twoinc_order_id);
                $response_message = sprintf(__('Response: %s', 'twoinc-payment-gateway'), $twoinc_err);
                $order->add_order_note($error_message . " " . $contact_message . " " . $response_message);
                return false;
            }

            $order->update_meta_data(WC_Twoinc_Brand::meta_key('order_state'), "CANCELLED");
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
            $state = $order->get_meta(WC_Twoinc_Brand::meta_key('order_state'), true);
            if ($state == 'REFUNDED') {
                return;
            }
            $result = $this->process_refund($order_id);
            if ($result && is_wp_error($result)) {
                $order->add_order_note($result->get_error_message());
            }
            return;
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
            <h3><?php printf(__('%s pre-filled fields', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name')); ?></h3>

            <table class="form-table">
                <tr>
                    <th><label for="twoinc_billing_company"><?php _e('Billing Company name', 'twoinc-payment-gateway'); ?></label></th>
                    <td>
                        <input type="text" name="twoinc_billing_company" id="twoinc_billing_company" value="<?php echo esc_attr(get_the_author_meta(WC_Twoinc_Brand::prefixed_name('billing_company'), $user->ID)); ?>" class="regular-text" />
                    </td>
                </tr>
                <tr>
                    <th><label for="twoinc_company_id"><?php _e('Billing Company ID', 'twoinc-payment-gateway'); ?></label></th>
                    <td>
                        <input type="text" name="twoinc_company_id" id="twoinc_company_id" value="<?php echo esc_attr(get_the_author_meta(WC_Twoinc_Brand::prefixed_name('company_id'), $user->ID)); ?>" class="regular-text" />
                    </td>
                </tr>
                <tr>
                    <th><label for="twoinc_department"><?php _e('Department', 'twoinc-payment-gateway'); ?></label></th>
                    <td>
                        <input type="text" name="twoinc_department" id="twoinc_department" value="<?php echo esc_attr(get_the_author_meta(WC_Twoinc_Brand::prefixed_name('department'), $user->ID)); ?>" class="regular-text" />
                        <br />
                        <span class="description"><?php _e("The department displayed on the invoices"); ?></span>
                    </td>
                </tr>
                <tr>
                    <th><label for="twoinc_project"><?php _e('Project', 'twoinc-payment-gateway'); ?></label></th>
                    <td>
                        <input type="text" name="twoinc_project" id="twoinc_project" value="<?php echo esc_attr(get_the_author_meta(WC_Twoinc_Brand::prefixed_name('project'), $user->ID)); ?>" class="regular-text" />
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

            update_user_meta($user_id, WC_Twoinc_Brand::prefixed_name('company_id'), $_POST['twoinc_company_id']);
            update_user_meta($user_id, WC_Twoinc_Brand::prefixed_name('billing_company'), $_POST['twoinc_billing_company']);
            update_user_meta($user_id, WC_Twoinc_Brand::prefixed_name('department'), $_POST['twoinc_department']);
            update_user_meta($user_id, WC_Twoinc_Brand::prefixed_name('project'), $_POST['twoinc_project']);
        }

        /**
         * Process the payment
         *
         * @param int $order_id
         *
         * @return array
         */
        /**
         * Remove the gateway from checkout when the brand's availability
         * gate (availability_gate in the brand config) is unmet. Mirrors
         * Brand availability gate semantics: front-end only, minimum is
         * inclusive (an exactly-minimum basket passes).
         *
         * @param array $available_gateways
         *
         * @return array
         */
        public function apply_brand_availability_gate($available_gateways)
        {
            $gate = WC_Twoinc_Brand::get('availability_gate');
            if ($gate && !isset($gate['min_order_amount'], $gate['currency'], $gate['basis'], $gate['billing_countries'])) {
                // A truthy but malformed gate must not judge with missing
                // criteria; leave the gateway available and let the log
                // below stay quiet (config bug, not a basket decision).
                $gate = null;
            }
            $merchant_minimum = $this->get_merchant_minimum_order();
            if ((!$gate && !$merchant_minimum) || is_admin() || !isset($available_gateways[$this->id])) {
                return $available_gateways;
            }
            if (!function_exists('WC') || !WC()->cart || !WC()->customer) {
                return $available_gateways;
            }

            // Basket value on the configured basis: the platform minimum's
            // basis is explicit in brand config (funding-partner rules
            // and platform defaults may differ); the merchant minimum rides
            // the same basis when a platform minimum exists.
            $basis = $gate ? $gate['basis'] : ($merchant_minimum['basis'] ?? 'gross');
            $basket_value = $basis === 'gross'
                ? (float) WC()->cart->total
                : (float) WC()->cart->total - (float) WC()->cart->get_total_tax();

            $satisfied = true;
            if ($gate) {
                $satisfied = $basket_value >= (float) $gate['min_order_amount']
                    && get_woocommerce_currency() === $gate['currency']
                    && in_array(WC()->customer->get_billing_country(), $gate['billing_countries'], true);
            }
            if ($satisfied && $merchant_minimum) {
                $satisfied = get_woocommerce_currency() === $merchant_minimum['currency']
                    ? $basket_value >= $merchant_minimum['amount']
                    // The merchant minimum is store-currency scoped; a
                    // basket in another currency cannot be judged against
                    // it (no FX source in WooCommerce) — fail open on the
                    // merchant's own optional bar, the platform gate above
                    // still applies.
                    : $satisfied;
            }
            if (!$satisfied) {
                unset($available_gateways[$this->id]);
                // Removing a payment method is invisible to the merchant —
                // log the failing basket once per request so a gate
                // misconfiguration doesn't read as the gateway vanishing.
                static $logged = false;
                if (!$logged && function_exists('wc_get_logger')) {
                    $logged = true;
                    wc_get_logger()->info(
                        sprintf(
                            'Brand availability gate removed %s from checkout (basket_value=%s basis=%s currency=%s country=%s; platform min %s, merchant min %s)',
                            $this->id,
                            $basket_value,
                            $basis,
                            get_woocommerce_currency(),
                            WC()->customer->get_billing_country(),
                            $gate ? $gate['min_order_amount'] . ' ' . $gate['currency'] : 'none',
                            $merchant_minimum ? $merchant_minimum['amount'] . ' ' . $merchant_minimum['currency'] : 'none'
                        ),
                        ['source' => 'twoinc-payment-gateway']
                    );
                }
            }

            return $available_gateways;
        }

        /**
         * Dynamic description for the Minimum Order Value setting: shows
         * the platform minimum the merchant's value must exceed. The
         * field is interpreted in the STORE currency; when that differs
         * from the platform minimum's currency the floor is shown in its
         * native currency only — WooCommerce has no FX rate source until
         * TWO-24776, so no converted figure can honestly be displayed.
         *
         * @return string
         */
        public function get_merchant_minimum_order_description()
        {
            $gate = WC_Twoinc_Brand::get('availability_gate');
            if ($gate && isset($gate['min_order_amount'], $gate['currency'])) {
                $native_display = get_woocommerce_currency_symbol($gate['currency'])
                    . number_format((float) $gate['min_order_amount'], 2);
                $basis_label = ($gate['basis'] ?? 'net') === 'gross'
                    ? __('including', 'twoinc-payment-gateway')
                    : __('excluding', 'twoinc-payment-gateway');
                if (get_option('woocommerce_currency') === $gate['currency']) {
                    return sprintf(
                        __('Platform minimum %1$s, %2$s tax. A value here is interpreted in the store currency on the same tax basis and must exceed it.', 'twoinc-payment-gateway'),
                        $native_display,
                        $basis_label
                    );
                }
                return sprintf(
                    __('Platform minimum %1$s, %2$s tax. A value here is interpreted in the store currency on the same tax basis; it cannot be checked against the platform minimum (different currency) — both minimums are enforced independently.', 'twoinc-payment-gateway'),
                    $native_display,
                    $basis_label
                );
            }
            return __('Hide the payment method below this order value (store currency, including tax). Leave empty for no minimum.', 'twoinc-payment-gateway');
        }

        /**
         * The merchant's own optional minimum order value, as
         * ['amount', 'currency', 'basis'] or null. Interpreted in the
         * STORE currency (the saved woocommerce_currency option, not the
         * active multicurrency display currency) on the platform
         * minimum's tax basis when the brand declares one, else gross.
         *
         * @return array|null
         */
        public function get_merchant_minimum_order()
        {
            $value = (float) $this->get_option('merchant_minimum_order');
            if ($value <= 0) {
                return null;
            }
            $gate = WC_Twoinc_Brand::get('availability_gate');
            return [
                'amount' => $value,
                'currency' => get_option('woocommerce_currency'),
                'basis' => $gate['basis'] ?? 'gross',
            ];
        }

        /**
         * Validate the merchant minimum on settings save: numeric and
         * non-negative always; strictly above the platform minimum when
         * the brand declares one IN THE STORE CURRENCY. A platform
         * minimum in another currency cannot be compared (no FX source
         * in WooCommerce until TWO-24776) — the numeric floor check is
         * skipped and both minimums are enforced independently at
         * checkout.
         *
         * @param string $key
         * @param string $value
         *
         * @return string
         * @throws Exception
         */
        public function validate_merchant_minimum_order_field($key, $value)
        {
            $value = trim((string) $value);
            if ($value === '') {
                return '';
            }
            $value = str_replace(',', '.', $value);
            if (!is_numeric($value) || (float) $value < 0) {
                throw new Exception(__('Minimum Order Value must be a non-negative number.', 'twoinc-payment-gateway'));
            }
            $gate = WC_Twoinc_Brand::get('availability_gate');
            if (
                $gate
                && isset($gate['min_order_amount'], $gate['currency'])
                && get_option('woocommerce_currency') === $gate['currency']
                && (float) $value <= (float) $gate['min_order_amount']
            ) {
                throw new Exception(sprintf(
                    __('Minimum Order Value must exceed the platform minimum of %1$s, %2$s tax.', 'twoinc-payment-gateway'),
                    get_woocommerce_currency_symbol($gate['currency']) . number_format((float) $gate['min_order_amount'], 2),
                    ($gate['basis'] ?? 'net') === 'gross' ? __('including', 'twoinc-payment-gateway') : __('excluding', 'twoinc-payment-gateway')
                ));
            }
            return $value;
        }

        /**
         * Brand veto on payment processing, resolved via the
         * twoinc_payment_validation_error filter (e.g. a brand overlay's
         * required terms-acceptance checkbox). Returns the buyer-facing
         * error message, or null to proceed.
         *
         * @param int $order_id
         *
         * @return string|null
         */
        public function get_brand_payment_validation_error($order_id)
        {
            /**
             * Filter: a brand overlay vetoes payment with a buyer-facing
             * error without overriding process_payment().
             *
             * @param string|null $error    Error message, or null to proceed.
             * @param int         $order_id WooCommerce order id.
             */
            return apply_filters('twoinc_payment_validation_error', null, $order_id);
        }

        public function process_payment($order_id)
        {

            // Get the order
            $order = wc_get_order($order_id);

            // Check payment method
            if (!WC_Twoinc_Helper::is_twoinc_order($order)) {
                return;
            }

            $brand_validation_error = $this->get_brand_payment_validation_error($order_id);
            if ($brand_validation_error) {
                WC_Twoinc_Helper::display_ajax_error($brand_validation_error);
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
            // Sometimes, billing_company_display is sent to the backend instead of billing_company
            $billing_company_display = array_key_exists('billing_company_display', $_POST) ? sanitize_text_field($_POST['billing_company_display']) : '';
            $billing_company = array_key_exists('billing_company', $_POST) ? sanitize_text_field($_POST['billing_company']) : $billing_company_display;
            $billing_phone = array_key_exists('billing_phone', $_POST) ? sanitize_text_field($_POST['billing_phone']) : '';
            $invoice_email = array_key_exists('invoice_email', $_POST) ? sanitize_text_field($_POST['invoice_email']) : '';
            $invoice_emails = $invoice_email ? array_map('sanitize_text_field', explode(',', $invoice_email)) : [];

            // Store the order meta
            $order->update_meta_data(WC_Twoinc_Brand::meta_key('order_reference'), $order_reference);
            $order->update_meta_data(WC_Twoinc_Brand::meta_key('merchant_id'), $merchant_id);
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
            $payment_reference_message = ''; // strval($order_id);
            if (has_filter('two_payment_reference_message')) {
                $payment_reference_message = apply_filters('two_payment_reference_message', $order_id);
                $order->update_meta_data('_payment_reference_message', $payment_reference_message);
            }
            $payment_reference_ocr = '';
            if (has_filter('two_payment_reference_ocr')) {
                $payment_reference_ocr = apply_filters('two_payment_reference_ocr', $order_id);
                $order->update_meta_data('_payment_reference_ocr', $payment_reference_ocr);
            }
            $payment_reference = '';
            $payment_reference_type = '';
            if (has_filter('two_payment_reference')) {
                $payment_reference = apply_filters('two_payment_reference', $order_id);
                $order->update_meta_data('_payment_reference', $payment_reference);
                $payment_reference_type = 'assigned_by_merchant';
                $order->update_meta_data('_payment_reference_type', $payment_reference_type);
            }
            $order->update_meta_data('_invoice_emails', $invoice_emails);

            $vendor_name = $this->get_option('vendor_name');
            $order->update_meta_data('vendor_name', $vendor_name);

            $payment_terms = WC_Twoinc_Payment_Terms::get_order_payload_terms($this, $order);
            if ($payment_terms) {
                $order->update_meta_data(WC_Twoinc_Brand::meta_key('selected_term_days'), $payment_terms['terms']['duration_days']);
            }

            $order->save();

            // Save to user meta
            $user_id = wp_get_current_user()->ID;
            if ($user_id) {
                if (!get_the_author_meta(WC_Twoinc_Brand::prefixed_name('company_id'), $user_id)) {
                    update_user_meta($user_id, WC_Twoinc_Brand::prefixed_name('company_id'), $company_id);
                }
                if (!get_the_author_meta(WC_Twoinc_Brand::prefixed_name('billing_company'), $user_id)) {
                    update_user_meta($user_id, WC_Twoinc_Brand::prefixed_name('billing_company'), $billing_company);
                }
                if (!get_the_author_meta(WC_Twoinc_Brand::prefixed_name('department'), $user_id)) {
                    update_user_meta($user_id, WC_Twoinc_Brand::prefixed_name('department'), $department);
                }
                if (!get_the_author_meta(WC_Twoinc_Brand::prefixed_name('project'), $user_id)) {
                    update_user_meta($user_id, WC_Twoinc_Brand::prefixed_name('project'), $project);
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
                $tracking_id,
                false,
                $payment_terms
            ));

            if (is_wp_error($response)) {
                $error_message = sprintf(__('Failed to request order creation with %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $order->add_order_note($error_message);
                return;
            }

            // Stop on process payment failure
            if (isset($response) && isset($response['result']) && $response['result'] === 'failure') {
                $error_message = sprintf(__('Failed to process payment with %s', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $order->add_order_note($error_message);
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
                $error_message = sprintf(__('Invoice purchase with %s is not available for this order.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                // Surface the minimum when the decline is attributable to
                // it: primarily by the API's machine-readable decline
                // reason, with a strictly-below-minimum check as fallback
                // while older backends carry only a generic reason. Same
                // currency only: WooCommerce has no FX rate source.
                $gate = WC_Twoinc_Brand::get('availability_gate');
                if ($gate && isset($gate['min_order_amount'], $gate['currency'], $gate['basis'])) {
                    $order_value = $gate['basis'] === 'gross'
                        ? (float) $order->get_total()
                        : (float) $order->get_total() - (float) $order->get_total_tax();
                    $declined_on_minimum = ($body['decline_reason'] ?? null) === 'ORDER_BELOW_MIN_INVOICE_AMOUNT'
                        || ($order->get_currency() === $gate['currency']
                            && $order_value < (float) $gate['min_order_amount']);
                    if ($declined_on_minimum && $order->get_currency() === $gate['currency']) {
                        $error_message .= ' ' . sprintf(
                            __('Minimum order value is %1$s%2$s %3$s tax.', 'twoinc-payment-gateway'),
                            get_woocommerce_currency_symbol($gate['currency']),
                            number_format((float) $gate['min_order_amount'], 2),
                            $gate['basis'] === 'gross' ? __('including', 'twoinc-payment-gateway') : __('excluding', 'twoinc-payment-gateway')
                        );
                    }
                }
                $order->add_order_note($error_message);
                WC_Twoinc_Helper::display_ajax_error($error_message);
                return;
            }

            // Store the Twoinc Order Id for future use
            $order->update_meta_data(WC_Twoinc_Brand::prefixed_name('order_id'), $body['id']);
            $twoinc_meta = $this->get_save_twoinc_meta($order, $body['id']);
            $twoinc_updated_order_hash = WC_Twoinc_Helper::hash_order($order, $twoinc_meta);
            $order->update_meta_data(WC_Twoinc_Brand::meta_key('req_body_hash'), $twoinc_updated_order_hash);

            if (isset($body['state'])) {
                $order->update_meta_data(WC_Twoinc_Brand::meta_key('order_state'), $body['state']);
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
                $error_message = sprintf(__('Failed to request order refund with %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $error_reason = sprintf(__('Reason: Could not find %s order ID.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $order->add_order_note($error_message . ' ' . $error_reason);
                return new WP_Error(
                    'invalid_twoinc_refund',
                    sprintf(__('Could not find %s order ID', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'))
                );
            }

            // Get and check refund data
            $state = $order->get_meta(WC_Twoinc_Brand::meta_key('order_state'), true);
            if ($state === 'REFUNDED') {
                return new WP_Error(
                    'invalid_twoinc_refund',
                    sprintf(__('Order has already been fully refunded with %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'))
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
                    sprintf(__('Could not initiate refund with %s', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'))
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
                $error_message = sprintf(__('Failed to request order refund with %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $order->add_order_note($error_message);
                return false;
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                $error_message = sprintf(__('Failed to request order refund with %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $contact_message = sprintf(__('Please contact %s support with order ID: %s', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'), $twoinc_order_id);
                $response_message = sprintf(__('Response: %s', 'twoinc-payment-gateway'), $twoinc_err);
                $order->add_order_note($error_message . " " . $contact_message . " " . $response_message);
                return new WP_Error(
                    'invalid_twoinc_refund',
                    sprintf(__('Could not initiate refund with %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'))
                );
            }

            // Decode the response
            $body = json_decode($response['body'], true);

            // Check if response is ok
            if (!$body['amount']) {
                $error_message = sprintf(__('Failed to request order refund with %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $contact_message = sprintf(__('Please contact %s support with order ID: %s', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'), $twoinc_order_id);
                $order->add_order_note($error_message . " " . $contact_message);
                return new WP_Error(
                    'invalid_twoinc_refund',
                    sprintf(__('Could not initiate refund with %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'))
                );
            }

            $state = "";
            $remaining_amt = $order->get_total() + (float) $body['amount'];
            if ($remaining_amt < 0.0001 && $remaining_amt > -0.0001) { // full refund, 0.0001 for float inaccuracy
                $order_note = sprintf(__('Invoice has been refunded and credit note has been sent by %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $state = "REFUNDED";
            } else { // partial refund
                $order_note = sprintf(__('Invoice has been partially refunded and credit note has been sent by %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $state = "PARTIALLY_REFUNDED";
            }
            $order->add_order_note($order_note);

            $order->update_meta_data(WC_Twoinc_Brand::meta_key('order_state'), $state);
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

            if (isset($_REQUEST['order_id'])
                && isset($_REQUEST[WC_Twoinc_Brand::prefixed_name('order_reference')])
                && isset($_REQUEST[WC_Twoinc_Brand::prefixed_name('nonce')])) {
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
            $order_reference = sanitize_text_field($_REQUEST[WC_Twoinc_Brand::prefixed_name('order_reference')]);

            // Verify order reference
            if (!$order_reference || $order_reference !== $order->get_meta(WC_Twoinc_Brand::meta_key('order_reference'), true)) {
                wp_die(__('The security code is not valid.', 'twoinc-payment-gateway'));
            }

            if ($this->get_option('skip_confirm_auth') !== 'yes') {
                // Get the nonce
                $nonce = sanitize_text_field($_REQUEST[WC_Twoinc_Brand::prefixed_name('nonce')]);

                // Stop if the code is not valid
                if (!wp_verify_nonce($nonce, WC_Twoinc_Brand::prefixed_name('confirm_' . $order_id))) {
                    wp_die(__('The security code is not valid.', 'twoinc-payment-gateway'));
                }
            }

            // Get the Two order ID from shop order ID
            $twoinc_order_id = $this->get_twoinc_order_id($order);
            if (!$twoinc_order_id) {
                $error_message = sprintf(__('Unable to retrieve %s order information.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $order->add_order_note($error_message);
                wp_die($error_message);
            }

            // Confirm order
            $response = $this->make_request("/v1/order/{$twoinc_order_id}/confirm", [], 'POST');

            // Stop if request error or $response['response']['code'] < 400
            if (is_wp_error($response)) {
                $error_message = sprintf(__('Unable to retrieve %s order information.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $order->add_order_note($error_message);
                wp_die($error_message);
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                $error_message = sprintf(__('Unable to confirm the order with %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $order->add_order_note($error_message);

                // Redirect the user to Woocom cancellation page
                return wp_specialchars_decode($order->get_cancel_order_url());
            }
            // After get_twoinc_error_msg, we can assume $response['response']['code'] < 400

            // Add note and update Two state
            $order_note = sprintf(__('Order ID %s has been placed with %s.', 'twoinc-payment-gateway'), $twoinc_order_id, WC_Twoinc_Brand::get('product_name'));
            $order->add_order_note($order_note);
            $order->update_meta_data(WC_Twoinc_Brand::meta_key('order_state'), 'CONFIRMED');
            $order->save();

            // Mark order as processing
            $order->payment_complete();

            // Redirect the user to confirmation page
            return wp_specialchars_decode($order->get_checkout_order_received_url());
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
                    'label'       => sprintf(__('Enable %s Payments', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name')),
                    'default'     => 'yes'
                ],
                'title' => [
                    'title'       => __('Title', 'twoinc-payment-gateway'),
                    'type'        => 'text',
                    // Brand-specific default: a fresh install must show the
                    // brand's payment-method title, not the Two phrasing.
                    'default'     => __(WC_Twoinc_Brand::get('title_default'), 'twoinc-payment-gateway')
                ],
                'merchant_minimum_order' => [
                    'title'       => __('Minimum Order Value', 'twoinc-payment-gateway'),
                    'type'        => 'text',
                    'default'     => '',
                    'description' => $this->get_merchant_minimum_order_description(),
                ],
                'test_checkout_host' => [
                    'type'        => 'text',
                    'title'       => sprintf(__('%s Test Server', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name')),
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
                    'title'       => sprintf(__('%s API Key', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name')),
                    'type'        => 'api_key_with_verification',
                    'description' => '<div id="api-key-status" style="margin-top: 5px;"></div>',
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
                'show_abt_link' => [
                    'title'       => sprintf(__('Show "What is %s" link in checkout', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name')),
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'yes'
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
                'enable_company_search' => [
                    'title'       => __('Enable company name search and auto-complete', 'twoinc-payment-gateway'),
                    'description' => __('Enables searching for company name in the national registry and automatically filling in name and national ID.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'yes'
                ],
                'enable_company_search_for_others' => [
                    'title'       => __('Enable company name search for other payment options', 'twoinc-payment-gateway'),
                    'description' => __('Enables searching for company name even when other payment options are selected. Requires the option above to be checked.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'yes'
                ],
                'enable_address_lookup' => [
                    'title'       => __('Address auto-complete', 'twoinc-payment-gateway'),
                    'description' => __('Enables automatically filling in the registered address from the national registry.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'yes'
                ],
                'section_sole_trader' => [
                    'type'  => 'title',
                    'title' => __('Sole trader checkout', 'twoinc-payment-gateway'),
                ],
                'enable_sole_trader' => [
                    'title'       => __('Enable sole trader checkout', 'twoinc-payment-gateway'),
                    'description' => __('Lets buyers check out as a sole trader by registering or logging in with Two. The option only appears for billing countries where sole traders are supported, determined automatically.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'no'
                ],
                'section_payment_terms' => [
                    'type'  => 'title',
                    'title' => __('Payment terms and offset pricing', 'twoinc-payment-gateway'),
                ],
                'enable_payment_terms' => [
                    'title'       => __('Enable payment terms selection', 'twoinc-payment-gateway'),
                    'description' => __('Lets the buyer choose their invoice term at checkout from the terms offered below.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'no'
                ],
                'payment_terms_days' => [
                    'title'       => __('Offered terms', 'twoinc-payment-gateway'),
                    'description' => __('Terms shown to the buyer. Leave empty to offer all terms available to this brand.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'type'        => 'multiselect',
                    'class'       => 'wc-enhanced-select',
                    'options'     => $this->get_payment_term_day_options(),
                    'default'     => []
                ],
                'default_payment_term' => [
                    'title'       => __('Default term', 'twoinc-payment-gateway'),
                    'description' => __('Pre-selected term at checkout. Falls back to the shortest offered term.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'type'        => 'select',
                    'options'     => $this->get_payment_term_day_options(),
                    'default'     => ''
                ],
                'payment_terms_type' => [
                    'title'       => __('Payment terms type', 'twoinc-payment-gateway'),
                    'description' => __('Standard counts the term days from the invoice date. End of month counts them from the end of the invoice month.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'type'        => 'select',
                    'options'     => [
                        'standard'     => __('Standard (from invoice date)', 'twoinc-payment-gateway'),
                        'end_of_month' => __('End of month', 'twoinc-payment-gateway'),
                    ],
                    'default'     => 'standard'
                ],
                'surcharge_type' => [
                    'title'       => __('Surcharge type', 'twoinc-payment-gateway'),
                    'description' => __('How the buyer surcharge is calculated. The platform pricing service computes the fee from this configuration. None disables the surcharge.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'type'        => 'select',
                    'options'     => [
                        'none'                 => __('None', 'twoinc-payment-gateway'),
                        'percentage'           => __('Percentage', 'twoinc-payment-gateway'),
                        'fixed'                => __('Fixed', 'twoinc-payment-gateway'),
                        'fixed_and_percentage' => __('Fixed and percentage', 'twoinc-payment-gateway'),
                    ],
                    'default'     => 'none'
                ],
                'surcharge_grid' => [
                    'title'       => __('Surcharge per term', 'twoinc-payment-gateway'),
                    'description' => __('Per payment term: a fixed amount, a percentage of the order, and an optional cap on the percentage portion. Leave a cell blank for zero. Fixed amounts and caps are in the store currency and are not converted for multi-currency stores.', 'twoinc-payment-gateway'),
                    'type'        => 'two_surcharge_grid',
                ],
                'surcharge_differential' => [
                    'title'       => __('Surcharge basis', 'twoinc-payment-gateway'),
                    'description' => __('Full charges the configured surcharge for the chosen term. Differential charges only the difference versus the default term (which then shows no surcharge).', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'type'        => 'select',
                    'options'     => [
                        '0' => __('Full surcharge', 'twoinc-payment-gateway'),
                        '1' => __('Differential (vs default term)', 'twoinc-payment-gateway'),
                    ],
                    'default'     => '0'
                ],
                'surcharge_line_description' => [
                    'title'       => __('Surcharge line label', 'twoinc-payment-gateway'),
                    'description' => __('Buyer-facing label for the surcharge line. Use %s for the term length in days. Leave blank to use the brand default.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'type'        => 'text',
                    'default'     => ''
                ],
                'surcharge_rounding_basis' => [
                    'title'       => __('Surcharge rounding', 'twoinc-payment-gateway'),
                    'description' => __('Snap the buyer surcharge line to a clean increment. Select None for standard two-decimal amounts.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'type'        => 'select',
                    'options'     => [
                        'none'     => __('None', 'twoinc-payment-gateway'),
                        'up'       => __('Up', 'twoinc-payment-gateway'),
                        'down'     => __('Down', 'twoinc-payment-gateway'),
                        'standard' => __('Standard', 'twoinc-payment-gateway'),
                    ],
                    'default'     => 'none'
                ],
                'surcharge_rounding_step' => [
                    'title'       => __('Rounding step', 'twoinc-payment-gateway'),
                    'description' => __('Increment the surcharge is rounded to (e.g. 1 = whole units, 0.50 = nearest half). Applies only when a rounding direction is selected.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'type'        => 'select',
                    'options'     => $this->get_rounding_step_options(),
                    'default'     => ''
                ],
                'section_debug' => [
                    'type'  => 'title',
                    'title' => __('Debug Options', 'twoinc-payment-gateway'),
                ],
                'enable_api_logging' => [
                    'title'       => __('Enable API Logging', 'twoinc-payment-gateway'),
                    'label'       => __('Log API requests and responses', 'twoinc-payment-gateway'),
                    'type'        => 'checkbox',
                    'description' => sprintf(
                        __('If enabled, all API interactions will be logged. This can be useful for debugging. You can view the logs <a href="%s">here</a>.', 'twoinc-payment-gateway'),
                        admin_url('admin.php?page=wc-status&tab=logs&source=twoinc-payment-gateway')
                    ),
                    'default'     => 'yes',
                ],
            ];

            if (WC_Twoinc_Helper::is_twoinc_development()) {
                unset($twoinc_form_fields['checkout_env']);
            } else {
                unset($twoinc_form_fields['test_checkout_host']);
            }

            $this->form_fields = apply_filters('wc_two_form_fields', $twoinc_form_fields);
        }

        /**
         * Generate API key field with verification
         *
         * @param $key
         * @param $data
         *
         * @return false|string
         */
        public function generate_api_key_with_verification_html($key, $data)
        {
            $field_key = $this->get_field_key($key);
            $defaults  = array(
                'title'             => '',
                'disabled'          => false,
                'class'             => '',
                'css'               => '',
                'placeholder'       => '',
                'type'              => 'password',
                'desc_tip'          => false,
                'description'       => '',
                'custom_attributes' => array(),
            );

            $data = wp_parse_args($data, $defaults);

            ob_start();
        ?>
            <tr valign="top">
                <th scope="row" class="titledesc">
                    <label for="<?php echo esc_attr($field_key); ?>"><?php echo wp_kses_post($data['title']); ?> <?php echo $this->get_tooltip_html($data); // WPCS: XSS ok.
                                                                                                                    ?></label>
                </th>
                <td class="forminp">
                    <fieldset>
                        <legend class="screen-reader-text"><span><?php echo wp_kses_post($data['title']); ?></span></legend>
                        <div style="position: relative; display: inline-block;">
                            <input class="input-text regular-input <?php echo esc_attr($data['class']); ?>" type="password" name="<?php echo esc_attr($field_key); ?>" id="<?php echo esc_attr($field_key); ?>" style="<?php echo esc_attr($data['css']); ?> padding-right: 35px;" value="<?php echo esc_attr($this->get_option($key)); ?>" placeholder="<?php echo esc_attr($data['placeholder']); ?>" <?php disabled($data['disabled'], true); ?> <?php echo $this->get_custom_attribute_html($data); // WPCS: XSS ok.
                                                                                                                                                                                                                                                                                                                                                                                                                                                    ?> />
                            <span id="api-key-verification-icon" style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); display: none; pointer-events: none; z-index: 10;">
                                <span class="dashicons dashicons-yes-alt" style="color: #46b450; display: none; font-size: 18px;" id="api-key-valid"></span>
                                <span class="dashicons dashicons-dismiss" style="color: #dc3232; display: none; font-size: 18px;" id="api-key-invalid"></span>
                                <span class="dashicons dashicons-update" style="color: #0073aa; display: none; animation: rotation 1s infinite linear; font-size: 18px;" id="api-key-loading"></span>
                            </span>
                        </div>
                        <?php if ($this->get_option('api_key') && $merchant_id = $this->get_merchant_id()) : ?>
                            <div style="margin-top: 8px; color: #666; font-size: 13px;">
                                <strong><?php _e('Merchant ID:', 'twoinc-payment-gateway'); ?></strong> <?php echo esc_html($merchant_id); ?>
                            </div>
                        <?php else: ?>
                            <div style="margin-top: 8px; color: #666; font-size: 13px;">
                                <strong><?php printf(__('Don\'t have an API key? Get one by signing up <a href=\'%s\'>here</a>.', 'twoinc-payment-gateway'), esc_url(WC_Twoinc_Brand::get('sign_up_url'))); ?></strong>
                            </div>
                        <?php endif; ?>
                        <?php echo $this->get_description_html($data); // WPCS: XSS ok.
                        ?>
                    </fieldset>
                </td>
            </tr>
            <style>
                @keyframes rotation {
                    from {
                        transform: rotate(0deg);
                    }

                    to {
                        transform: rotate(359deg);
                    }
                }
            </style>
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
                            <input <?php disabled($data['disabled'], true); ?> class="<?php echo esc_attr($data['class']); ?>" type="radio" name="<?php echo esc_attr($field_key); ?>" id="<?php echo esc_attr($field_key); ?>" style="<?php echo esc_attr($data['css']); ?>" value="1" <?php checked($data['checked'] === true, true); ?> <?php echo $this->get_custom_attribute_html($data); // WPCS: XSS ok.
                                                                                                                                                                                                                                                                                                                                            ?> /> <?php echo wp_kses_post($data['label']); ?></label><br />
                        <?php echo $this->get_description_html($data); // WPCS: XSS ok.
                        ?>
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
                        <input type="hidden" name="woocommerce_<?php echo esc_attr($this->id); ?>_<?php echo $field_key; ?>" id="<?php echo esc_attr($field_key); ?>" class="logo_id" value="<?php echo $image_id; ?>" />
                        <div class="image-container woocommerce-twoinc-image-container">
                            <?php if ($image_src): ?>
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
                    return;
                }
            }

            $order_reference = $order->get_meta(WC_Twoinc_Brand::meta_key('order_reference')) ?? $order->get_meta('_tillit_order_reference');
            $merchant_id = $order->get_meta(WC_Twoinc_Brand::meta_key('merchant_id'));
            if (!$merchant_id) {
                $merchant_id = $order->get_meta('_tillit_merchant_id') ?? $this->get_merchant_id();
                $order->update_meta_data(WC_Twoinc_Brand::meta_key('merchant_id'), $merchant_id);
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
                    return;
                }

                $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
                if ($twoinc_err) {
                    $order->add_order_note(__('Unable to retrieve the order payment information', 'twoinc-payment-gateway'));
                    return;
                }

                $body = json_decode($response['body'], true);
                if (!$body || !$body['buyer'] || !$body['buyer']['company'] || !$body['buyer']['company']['organization_number']) {
                    $error_message = __('Missing company ID.', 'twoinc-payment-gateway');
                    $contact_message = sprintf(__('Please contact %s support with order ID: %s', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'), $twoinc_order_id);
                    $order->add_order_note($error_message . ' ' . $contact_message);
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

            $twoinc_order_hash = $order->get_meta(WC_Twoinc_Brand::meta_key('req_body_hash'));
            $twoinc_updated_order_hash = WC_Twoinc_Helper::hash_order($order, $twoinc_meta);
            if (!$twoinc_order_hash || $twoinc_order_hash != $twoinc_updated_order_hash) {
                if ($this->update_twoinc_order($order)) {
                    $order->update_meta_data(WC_Twoinc_Brand::meta_key('req_body_hash'), $twoinc_updated_order_hash);
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
                $error_message = sprintf(__('Could not edit the order with %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $error_reason = sprintf(__('Reason: Could not find %s order ID.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $order->add_order_note($error_message . ' ' . $error_reason);
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
                $error_message = sprintf(__('Could not edit the order with %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $order->add_order_note($error_message);
                return false;
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                $error_message = sprintf(__('Could not edit the order with %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $contact_message = sprintf(__('Please contact %s support with order ID: %s', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'), $twoinc_order_id);
                $response_message = sprintf(__('Response: %s', 'twoinc-payment-gateway'), $twoinc_err);
                $order->add_order_note($error_message . ' ' . $contact_message . ' ' . $response_message);
                return false;
            }

            // Get returned gross amount
            $gross_amount = null;
            if ($response && $response['body']) {
                $body = json_decode($response['body'], true);
                if ($body['gross_amount']) {
                    $gross_amount = $body['gross_amount'];
                }
            }

            // Add note
            $order_note = sprintf(__('The order edit request has been accepted by %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
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

            $twoinc_order_id = $order->get_meta(WC_Twoinc_Brand::prefixed_name('order_id'));

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
        public function make_request($endpoint, $payload = [], $method = 'POST', $params = array(), $api_key_override = null, $timeout = 30)
        {
            $params['client'] = 'wp';
            $params['client_v'] = get_twoinc_plugin_version();
            # If api_key_override is defined, use that key instead of the saved key
            $api_key = $api_key_override ?: $this->get_option('api_key');
            $headers = [
                'Accept-Language' => WC_Twoinc_Helper::get_locale(),
                'Content-Type' => 'application/json; charset=utf-8',
                'X-API-Key' => $api_key
            ];
            if (isset($_SERVER['HTTP_X_CLOUD_TRACE_CONTEXT'])) {
                $headers['HTTP_X_CLOUD_TRACE_CONTEXT'] = $_SERVER['HTTP_X_CLOUD_TRACE_CONTEXT'];
            }
            $response = wp_remote_request(sprintf('%s%s?%s', $this->get_twoinc_checkout_host(), $endpoint, http_build_query($params)), [
                'method' => $method,
                'headers' => $headers,
                'timeout' => $timeout,
                'body' => empty($payload) ? '' : json_encode(WC_Twoinc_Helper::utf8ize($payload)),
                'data_format' => 'body'
            ]);

            // Log the response if logging is enabled
            if ('yes' === $this->get_option('enable_api_logging')) {
                $logger = wc_get_logger();
                // Redact X-API-Key from request headers for logging
                $context = [
                    "source" => "twoinc-payment-gateway",
                    "request" => [
                        "body" => $payload,
                        "headers" => array_merge($headers, [
                            'X-API-Key' => '[REDACTED]'
                        ]),
                        "params" => $params
                    ],
                    "response" => [
                        "body" => null,
                        "headers" => null,
                        "status_code" => null
                    ]
                ];
                if (is_wp_error($response)) {
                    $logger->error("$method $endpoint: WP_Error: " . $response->get_error_message(), $context);
                } else {
                    $raw_body = wp_remote_retrieve_body($response);
                    $decoded_body = json_decode($raw_body, true);
                    // Flatten headers for logging
                    $response_context = [
                        "body" => (json_last_error() === JSON_ERROR_NONE) ? $decoded_body : $raw_body,
                        "headers" => (array) wp_remote_retrieve_headers($response)->getAll(),
                        "status_code" => (int) wp_remote_retrieve_response_code($response)
                    ];
                    $log_message = "$method $endpoint";
                    $context["response"] = $response_context;
                    if ($response_context["status_code"] >= 400) {
                        $logger->error($log_message, $context);
                    } else {
                        $logger->info($log_message, $context);
                    }
                }
            }

            return $response;
        }

        /**
         * Display admin banner notice for twoinc account setup
         *
         * @return void
         */
        public function twoinc_account_init_notice()
        {
            global $pagenow;

            // Do not show on the Two plugin's own settings page
            if (
                $pagenow === 'admin.php' &&
                isset($_GET['page'], $_GET['tab'], $_GET['section']) &&
                $_GET['page'] === 'wc-settings' &&
                $_GET['tab'] === 'checkout' &&
                $_GET['section'] === $this->id
            ) {
                return;
            }

            // Only show notice if either API key or merchant ID is missing
            if ($this->get_option('api_key') && $this->get_merchant_id()) {
                return;
            }
            $product_name = WC_Twoinc_Brand::get('product_name');
            $headline = sprintf(__('Grow your B2B sales with Buy Now, Pay Later using %s!', 'twoinc-payment-gateway'), $product_name);
            $benefits = sprintf(__('%s credit approves 90%% of business buyers, pays you upfront and minimise your risk. To offer %s in your checkout, you need to signup. It is quick, easy and gives you immediate access to the %s Merchant Portal.', 'twoinc-payment-gateway'), $product_name, $product_name, $product_name);
            $setup_account = __('Set up my account', 'twoinc-payment-gateway');
            $setup_url = admin_url('admin.php?page=wc-settings&tab=checkout&section=' . $this->id);
            echo '
            <div id="twoinc-account-init-notice" class="notice notice-info is-dismissible" style="background-image: url(\'' . WC_TWOINC_PLUGIN_URL . 'assets/images/banner.png\');background-size: cover;border-left-width: 0;background-color: #e2e0ff;padding: 20px;display: flex;">
                <div style="width:60%;padding-right:40px;">
                    <img style="width: 100px;" src="' . esc_url($this->icon) . '">
                    <p style="color: #ffffff;font-size: 1.3em;text-align: justify;font-weight:700;">' . $headline . '</p>
                    <p style="color: #ffffff;font-size: 1.3em;text-align: justify;">' . $benefits . '</p>
                </div>
                <div>
                    <div style="position: absolute;top: 50%;transform: translateY(-50%);right: 40px;">
                        <a href="' . $setup_url . '" target="_blank" class="button" style="margin-left: 20px;background: #edf3ff;font-size: 1.1em;font-weight: 600;color: #4848e6;padding: 7px 30px;border-color: #edf3ff;border-radius: 12px;">' . $setup_account . '</a>
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

        /**
         * On deactivating the plugin
         *
         * @return void
         */
        public function on_deactivate_plugin()
        {
            if ($this->get_option('clear_options_on_deactivation') === 'yes') {
                delete_option('woocommerce_' . $this->id . '_settings');
            }
        }

        /**
         * Override process_admin_options to validate API key before saving settings
         */
        public function process_admin_options()
        {
            $post_data = $this->get_post_data();
            $api_key_field = 'woocommerce_' . $this->id . '_api_key';
            $api_key_in_post = array_key_exists($api_key_field, $post_data);
            $api_key = $api_key_in_post ? $post_data[$api_key_field] : '';

            if ($api_key_in_post && $api_key) {
                $result = $this->verify_api_key($api_key);
                if (isset($result['body']) && isset($result['code']) && $result['code'] == 200) {
                    WC_Admin_Settings::add_message(sprintf(__('%s API key verified.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name')));
                } else {
                    // Invalid key: keep previous API key, save other settings
                    $post_data[$api_key_field] = $this->get_option('api_key');
                    WC_Admin_Settings::add_error(__('Failed to verify API key.', 'twoinc-payment-gateway'));
                }
            }
            // Save all settings (with possibly reverted API key)
            $_POST = $post_data;
            parent::process_admin_options();
        }

        /**
         * Get payment method icon
         *
         * @return string
         */
        public function get_icon()
        {
            $icon_html = '<img src="' . esc_url($this->icon) . '" alt="' . esc_attr($this->title) . '" class="mollie-gateway-icon" />';
            return apply_filters('woocommerce_gateway_icon', $icon_html, $this->id);
        }
    }
}
