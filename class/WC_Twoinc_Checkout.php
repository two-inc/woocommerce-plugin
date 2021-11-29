<?php

/**
 * Twoinc Checkout page modifier
 *
 * @class WC_Twoinc_Checkout
 * @author Two.
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
            add_filter('woocommerce_checkout_fields', [$this, 'add_account_fields'], 22);
            add_filter('woocommerce_checkout_fields', [$this, 'update_company_fields'], 23);
            add_filter('woocommerce_checkout_fields', [$this, 'update_phone_fields'], 24);
            add_action('woocommerce_before_checkout_billing_form', [$this, 'add_account_buttons'], 20);

            // Render the fields on checkout page
            add_action('woocommerce_before_checkout_billing_form', [$this, 'render_twoinc_fields'], 20);
            add_action('woocommerce_before_checkout_billing_form', [$this, 'render_twoinc_representative_fields'], 21);

            // Inject the cart details in header
            add_action('woocommerce_before_checkout_billing_form', [$this, 'inject_cart_details'], 22);
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
         * Add the account type buttons to the checkout page
         *
         * @param $fields
         *
         * @return mixed
         */
        public function add_account_buttons($fields)
        {

            printf(
                '<div class="account-type-wrapper" style="display: none;">
                    <div class="account-type-button" account-type-name="personal">
                        <img src = "/wp-content/plugins/tillit-payment-gateway/assets/images/personal.svg"/>
                        <span>' . __('Private Customer', 'twoinc-payment-gateway') . '</span>
                    </div>
                    <div class="account-type-button" account-type-name="sole_trader">
                        <img src = "/wp-content/plugins/tillit-payment-gateway/assets/images/personal.svg"/>
                        <span>' . __('Sole Trader/Other Customer', 'twoinc-payment-gateway') . 'r</span>
                    </div>
                    <div class="account-type-button" account-type-name="business">
                        <img src = "/wp-content/plugins/tillit-payment-gateway/assets/images/business.svg"/>
                        <span>' . __('Business Customer', 'twoinc-payment-gateway') . '</span>
                    </div>
                </div>');

        }

        /**
         * Add the account type fields to the checkout page
         *
         * @param $fields
         *
         * @return mixed
         */
        public function add_account_fields($fields)
        {

            // available_account_types size always > 0
            $available_account_types = $this->wc_twoinc->available_account_types();
            // Default account type, if available, with priority: business - sole_trader - personal
            end($available_account_types); // Move pointer to last
            $default_account_type = key($available_account_types); // Get current pointer

            if(sizeof($this->wc_twoinc->available_account_types()) > 1) {

                // Default to personal if admin settings is set
                if ($this->wc_twoinc->get_option('default_to_b2c') === 'yes' && array_key_exists('personal', $available_account_types)) {
                    $default_account_type = 'personal';
                }

                $fields['account_type'] = [
                    'account_type' => [
                        'label' => __('Select the account type', 'twoinc-payment-gateway'),
                        'required' => false,
                        'type' => 'radio',
                        'priority' => 30,
                        'value' => $default_account_type,
                        'options' => $available_account_types
                    ]
                ];

            } else {

                $fields['account_type'] = [
                    'account_type' => [
                        'required' => false,
                        'type' => 'radio',
                        'priority' => 30,
                        'value' => $default_account_type,
                        'options' => $available_account_types
                    ]
                ];

            }

            // Return the fields
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

            if($this->wc_twoinc->get_option('enable_company_name') === 'yes') {

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

            if($this->wc_twoinc->get_option('enable_company_name') === 'yes' && $this->wc_twoinc->get_option('enable_company_id') === 'yes') {

                $fields['billing']['company_id'] = [
                    'label' => __('Company ID', 'twoinc-payment-gateway'),
                    'class' => array('hidden'),
                    'required' => false,
                    'priority' => $company_name_priority + 1,
                    'custom_attributes' => array('readonly' => 'readonly')
                ];

            } else {

                $fields['billing']['company_id'] = [
                    'label' => __('Company ID', 'twoinc-payment-gateway'),
                    'class' => array('hidden'),
                    'required' => false,
                    'priority' => $company_name_priority + 1
                ];

            }

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

            // Return the fields
            return $fields;

        }

        /**
         * Update the default phone field placeholder
         *
         * @param $fields
         *
         * @return array
         */
        public function update_phone_fields($fields)
        {

            $fields['billing']['billing_phone_display'] = [
                'label' => __('Phone', 'twoinc-payment-gateway'),
                'class' => array('hidden'),
                'required' => false,
                'priority' => $fields['billing']['billing_email']['priority'] + 1 // insert email field in-between, must not be directly under first name to avoid css error
            ];

            // Return the fields list
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
         * Use the ca
         *
         * @return array
         */
        private function prepare_twoinc_object()
        {

            $product_type = $this->wc_twoinc->get_option('product_type');

            // Backward compatible
            if ($product_type === 'MERCHANT_INVOICE') {
                $product_type = 'DIRECT_INVOICE';
            }

            $currency = get_woocommerce_currency();

            $properties = [
                'text' => [
                    'tooltip_phone' => __('We require your phone number so we can verify your purchase', 'twoinc-payment-gateway'),
                    'tooltip_company' => __('We use your company name to automatically populate your address and register the company that made the purchase', 'twoinc-payment-gateway'),
                ],
                'twoinc_search_host_no' => $this->wc_twoinc->twoinc_search_host_no,
                'twoinc_search_host_gb' => $this->wc_twoinc->twoinc_search_host_gb,
                'twoinc_checkout_host' => $this->wc_twoinc->twoinc_checkout_host,
                'display_other_payments' => $this->wc_twoinc->get_option('display_other_payments'),
                'fallback_to_another_payment' => $this->wc_twoinc->get_option('fallback_to_another_payment'),
                'company_name_search' => $this->wc_twoinc->get_option('enable_company_name'),
                'company_id_search' => $this->wc_twoinc->get_option('enable_company_id'),
                'enable_order_intent' => $this->wc_twoinc->get_option('enable_order_intent'),
                'invoice_fee_to_buyer' => $this->wc_twoinc->get_option('invoice_fee_to_buyer'),
                'mark_twoinc_fields_required' => $this->wc_twoinc->get_option('mark_tillit_fields_required'),
                'use_account_type_buttons' => $this->wc_twoinc->get_option('use_account_type_buttons'),
                'display_tooltips' => $this->wc_twoinc->get_option('display_tooltips'),
                'product_type' => $product_type,
                'merchant_short_name' => $this->wc_twoinc->get_option('tillit_merchant_id'),
                'days_on_invoice' => $this->wc_twoinc->get_option('days_on_invoice'),
                'shop_base_country' => strtolower(WC()->countries->get_base_country()),
                'currency' => $currency,
                'price_decimal_separator' => wc_get_price_decimal_separator(),
                'price_thousand_separator' => wc_get_price_thousand_separator(),
                'client_name' => 'wp',
                'client_version' => get_plugin_version()
            ];

            return $properties;

        }

        /**
         * Inject the cart content in header
         *
         * @return void
         */
        public function inject_cart_details()
        {
            if(!is_checkout()) return;
            $twoinc_obj = json_encode(WC_Twoinc_Helper::utf8ize($this->prepare_twoinc_object()), JSON_UNESCAPED_UNICODE);
            if ($twoinc_obj) printf('<script>window.twoinc = %s;</script>', $twoinc_obj);
        }

    }
}
