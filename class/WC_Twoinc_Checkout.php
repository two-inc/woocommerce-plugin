<?php

/**
 * Twoinc Checkout page modifier
 *
 * @class WC_Twoinc_Checkout
 * @author Two
 */

if (!class_exists('WC_Twoinc_Checkout')) {
    class WC_Twoinc_Checkout
    {
        private $wc_twoinc;

        /**
         * WC_Twoinc_Checkout constructor.
         */
        public function __construct($wc_twoinc)
        {

            $this->wc_twoinc = $wc_twoinc;

            // Move the country field to the top
            add_filter('woocommerce_checkout_fields', [$this, 'move_country_field'], 20);

            // Register the custom fields
            add_filter('woocommerce_checkout_fields', [$this, 'add_tracking_fields'], 21);
            add_filter('woocommerce_checkout_fields', [$this, 'update_company_fields'], 23);

            // Render the fields on checkout page
            add_action('woocommerce_before_checkout_billing_form', [$this, 'render_twoinc_fields'], 21);
            add_action('woocommerce_pay_order_before_submit', [$this, 'render_twoinc_fields'], 21);
            add_action('woocommerce_before_checkout_billing_form', [$this, 'render_twoinc_representative_fields'], 22);

            // Inject the cart details in header
            add_action('woocommerce_before_checkout_billing_form', [$this, 'inject_cart_details'], 23);
            add_action('woocommerce_pay_order_before_submit', [$this, 'inject_cart_details'], 22);

            // Order pay page customization
            add_action('woocommerce_pay_order_before_submit', [$this, 'order_pay_page_customize'], 24);
        }

        /**
         * Move the country field at the top of the Billing Details section
         *
         * @param $fields
         */
        public function move_country_field($fields)
        {

            // Change the priority for the country field
            $fields['billing']['billing_country']['priority'] = $fields['billing']['billing_company']['priority'] - 1;

            // Return the fields list
            return $fields;

        }

        /**
         * Add fields: Company name, Company ID, Department, Project
         *
         * @param $fields
         *
         * @return mixed
         */
        public function update_company_fields($fields)
        {

            $company_name_priority = $fields['billing']['billing_company']['priority'];

            if ($this->wc_twoinc->get_enable_company_search() === 'yes') {

                $fields['billing']['billing_company_display'] = [
                    'label' => __('Company name', 'twoinc-payment-gateway'),
                    'autocomplete' => 'organization',
                    'type' => 'select',
                    /*'custom_attributes' => [
                        'data-multiple' => true,
                        'data-multi' => true
                    ],*/
                    'class' => array('billing_company_selectwoo', 'hidden'),
                    'options' => [
                        '' => '&nbsp;'
                    ],
                    'required' => false,
                    'priority' => $company_name_priority
                ];

            }

            $fields['billing']['company_id'] = [
                'label' => __('Company ID', 'twoinc-payment-gateway'),
                'class' => array('hidden'),
                'required' => false,
                'priority' => $company_name_priority + 1
            ];

            if ($this->wc_twoinc->get_option('add_field_department') === 'yes') {

                $fields['billing']['department'] = [
                    'label' => __('Department', 'twoinc-payment-gateway'),
                    'class' => array('hidden'),
                    'required' => false,
                    'priority' => $company_name_priority + 2
                ];

            }

            if ($this->wc_twoinc->get_option('add_field_project') === 'yes') {

                $fields['billing']['project'] = [
                    'label' => __('Project', 'twoinc-payment-gateway'),
                    'class' => array('hidden'),
                    'required' => false,
                    'priority' => $company_name_priority + 3
                ];

            }

            if ($this->wc_twoinc->get_option('add_field_purchase_order_number') === 'yes') {

                $fields['billing']['purchase_order_number'] = [
                    'label' => __('Purchase order number', 'twoinc-payment-gateway'),
                    'class' => array('hidden'),
                    'required' => false,
                    'priority' => $company_name_priority + 4
                ];

            }

            if ($this->wc_twoinc->get_option('add_field_invoice_email') == 'yes') {
                $fields['billing']['invoice_email'] = [
                    'label'       => __('Invoice email address', 'twoinc-payment-gateway'),
                    'class'       => array('form-row-wide'),
                    'type'        => 'email',
                    'placeholder' => sprintf(__('Only for invoices being sent by %s', 'twoinc-payment-gateway'), WC_Twoinc::PRODUCT_NAME),
                    'validate'    => array('email'),
                    'required'    => false,
                    'priority'    => $company_name_priority + 5
                ];
            }

            // Return the fields
            return $fields;

        }

        /**
         * Add the tracking id from order intent to order
         *
         * @param $fields
         *
         * @return array
         */
        public function add_tracking_fields($fields)
        {

            $fields['billing']['tracking_id'] = [
                'class' => array('hidden'),
                'required' => false,
                'type' => 'text',
                'priority' => 20
            ];

            // Return the fields list
            return $fields;

        }

        /**
         * Render the Twoinc fields to the checkout page
         *
         * @return void
         */
        public function render_twoinc_fields()
        {
            ob_start();
            require_once WC_TWOINC_PLUGIN_PATH . '/views/woocommerce_checkout.php';
            $content = ob_get_clean();
            echo $content;
        }

        /**
         * Render the Twoinc representative fields to the checkout page
         *
         * @return void
         */
        public function render_twoinc_representative_fields()
        {
            ob_start();
            require_once WC_TWOINC_PLUGIN_PATH . '/views/woocommerce_after_checkout_billing_form.php';
            $content = ob_get_clean();
            echo $content;
        }

        /**
         * Customize for Order Pay page when merchant installed "Phone Orders for WooCommerce" plugin
         */
        public function order_pay_page_customize()
        {
            ob_start();
            require_once WC_TWOINC_PLUGIN_PATH . '/views/woocommerce_order_pay.php';
            $content = ob_get_clean();
            echo $content;
        }

        /**
         * Passing config to javascript
         *
         * @param $merchant array
         *
         * @return array
         */
        private function prepare_twoinc_object($merchant): array
        {
            $currency = get_woocommerce_currency();

            // TODO: Make this dynamic based on active merchant payee accounts
            $supported_buyer_countries = ["NO", "GB", "SE", "NL", "FI", "DK"];

            $properties = [
                'text' => [
                    'tooltip_phone' => __('We require your phone number so we can verify your purchase.', 'twoinc-payment-gateway'),
                    'tooltip_company' => __('We use your company name to automatically populate your address and register the company that made the purchase.', 'twoinc-payment-gateway'),
                ],
                'twoinc_checkout_host' => $this->wc_twoinc->get_twoinc_checkout_host(),
                'enable_company_search' => $this->wc_twoinc->get_enable_company_search(),
                'enable_company_search_for_others' => $this->wc_twoinc->get_option('enable_company_search_for_others'),
                'enable_address_lookup' => $this->wc_twoinc->get_option('enable_address_lookup'),
                'enable_order_intent' => $this->wc_twoinc->get_option('enable_order_intent'),
                'display_tooltips' => $this->wc_twoinc->get_option('display_tooltips'),
                'supported_buyer_countries' => $supported_buyer_countries,
                'merchant' => $merchant,
                'days_on_invoice' => $this->wc_twoinc->get_merchant_default_days_on_invoice(),
                'shop_base_country' => strtolower(WC()->countries->get_base_country()),
                'currency' => $currency,
                'price_decimal_separator' => wc_get_price_decimal_separator(),
                'price_thousand_separator' => wc_get_price_thousand_separator(),
                'twoinc_plugin_url' => WC_TWOINC_PLUGIN_URL,
                'client_name' => 'wp',
                'client_version' => get_twoinc_plugin_version(),
            ];

            $user_id = wp_get_current_user()->ID;
            if ($user_id) {
                $properties['company_id'] = get_user_meta($user_id, 'twoinc_company_id', true);
                $properties['billing_company'] = get_user_meta($user_id, 'twoinc_billing_company', true);
                $properties['department'] = get_user_meta($user_id, 'twoinc_department', true);
                $properties['project'] = get_user_meta($user_id, 'twoinc_project', true);
            }

            return $properties;

        }

        /**
         * Inject the cart content in header
         *
         * @return void
         */
        public function inject_cart_details()
        {
            if (!is_checkout()) {
                return;
            }

            // Ensure that the API key valid
            $result = $this->wc_twoinc->verify_api_key();
            if (isset($result['code']) && $result['code'] !== 200) {
                return;
            }

            $twoinc_obj = json_encode(WC_Twoinc_Helper::utf8ize($this->prepare_twoinc_object($result['body'])), JSON_UNESCAPED_UNICODE);
            if ($twoinc_obj) {
                printf('<script>window.twoinc = %s;</script>', $twoinc_obj);
            }
        }

    }
}
