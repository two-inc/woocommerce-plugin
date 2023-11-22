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
            add_filter('woocommerce_checkout_fields', [$this, 'add_account_fields'], 22);
            add_filter('woocommerce_checkout_fields', [$this, 'update_company_fields'], 23);
            add_filter('woocommerce_checkout_fields', [$this, 'update_contact_fields'], 24);
            add_action('woocommerce_before_checkout_billing_form', [$this, 'add_account_buttons'], 20);
            add_action('woocommerce_pay_order_before_submit', [$this, 'add_account_buttons'], 20);

            // Render the fields on checkout page
            add_action('woocommerce_before_checkout_billing_form', [$this, 'render_twoinc_fields'], 21);
            add_action('woocommerce_pay_order_before_submit', [$this, 'render_twoinc_fields'], 21);
            add_action('woocommerce_before_checkout_billing_form', [$this, 'render_twoinc_representative_fields'], 22);

            // Inject the cart details in header
            add_action('woocommerce_before_checkout_billing_form', [$this, 'inject_cart_details'], 23);
            add_action('woocommerce_pay_order_before_submit', [$this, 'inject_cart_details'], 22);

            // Load addtional js/css
            add_action('woocommerce_before_checkout_billing_form', [$this, 'load_intl_tel_input'], 24);
            add_action('woocommerce_pay_order_before_submit', [$this, 'load_intl_tel_input'], 23);

            //
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
         * Add the account type buttons to the checkout page
         *
         * @param $fields
         *
         * @return mixed
         */
        public function add_account_buttons($fields)
        {

            $home_url = get_home_url();
            printf(
                '<div class="account-type-wrapper" style="display: none;">
                    <div class="account-type-button" account-type-name="personal">
                        <img src = "' . WC_TWOINC_PLUGIN_URL . 'assets/images/personal.svg"/>
                        <span>' . __('Private Customer', 'twoinc-payment-gateway') . '</span>
                    </div>
                    <div class="account-type-button" account-type-name="sole_trader">
                        <img src = "' . WC_TWOINC_PLUGIN_URL . 'assets/images/personal.svg"/>
                        <span>' . __('Sole Trader/Other Customer', 'twoinc-payment-gateway') . '</span>
                    </div>
                    <div class="account-type-button" account-type-name="business">
                        <img src = "' . WC_TWOINC_PLUGIN_URL . 'assets/images/business.svg"/>
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
                        'label' => __('Select account type', 'twoinc-payment-gateway'),
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

            // Return the fields
            return $fields;

        }

        /**
         * Update the default phone field placeholder and add invoice email
         *
         * @param $fields
         *
         * @return array
         */
        public function update_contact_fields($fields)
        {

            $fields['billing']['invoice_email'] = [
                'label'    => __('Invoice email address', 'twoinc-payment-gateway'),
                'class'    => array('form-row-wide'),
                'type'     => 'email',
                'validate' => array('email'),
                'required' => false,
                'priority' => $fields['billing']['billing_email']['priority'] + 1
            ];

            $fields['billing']['billing_phone_display'] = [
                'label' => __('Phone', 'twoinc-payment-gateway'),
                'class' => array('hidden'),
                'required' => false,
                'priority' => $fields['billing']['billing_email']['priority'] + 2 // insert email field in-between, must not be directly under first name to avoid css error
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
         * Load custom 3rd-party js and css files
         */
        public function intl_tel_input_asset($path) {
            return WC_TWOINC_PLUGIN_URL . 'assets/intl-tel-input/17.0.8/' . $path;
        }

        public function load_intl_tel_input() {
            // selectable phone country prefix
            printf('<link rel="stylesheet" href="' . $this->intl_tel_input_asset('css/intlTelInput.css') . '" />');
            printf('<script src="' . $this->intl_tel_input_asset('js/intlTelInput.min.js') . '"></script>');
        }

        /**
         * Customize for Order Pay page when merchant installed "Phone Orders for WooCommerce" plugin
         */
        public function order_pay_page_customize() {
            ob_start();
            require_once WC_TWOINC_PLUGIN_PATH . '/views/woocommerce_order_pay.php';
            $content = ob_get_clean();
            echo $content;
        }

        /**
         * Passing config to javascript
         *
         * @return array
         */
        private function prepare_twoinc_object()
        {

            $currency = get_woocommerce_currency();

            $properties = [
                'text' => [
                    'tooltip_phone' => __('We require your phone number so we can verify your purchase', 'twoinc-payment-gateway'),
                    'tooltip_company' => __('We use your company name to automatically populate your address and register the company that made the purchase', 'twoinc-payment-gateway'),
                ],
                'twoinc_search_host_no' => $this->wc_twoinc->twoinc_search_host_no,
                'twoinc_search_host_gb' => $this->wc_twoinc->twoinc_search_host_gb,
                'twoinc_search_host_se' => $this->wc_twoinc->twoinc_search_host_se,
                'twoinc_checkout_host' => $this->wc_twoinc->twoinc_checkout_host,
                'company_name_search' => $this->wc_twoinc->get_option('enable_company_name'),
                'address_search' => $this->wc_twoinc->get_option('address_search'),
                'enable_order_intent' => $this->wc_twoinc->get_option('enable_order_intent'),
                'invoice_fee_to_buyer' => $this->wc_twoinc->get_option('invoice_fee_to_buyer'),
                'use_account_type_buttons' => $this->wc_twoinc->get_option('use_account_type_buttons'),
                'display_tooltips' => $this->wc_twoinc->get_option('display_tooltips'),
                'merchant_short_name' => $this->wc_twoinc->get_option('tillit_merchant_id'),
                'days_on_invoice' => $this->wc_twoinc->get_merchant_default_days_on_invoice(),
                'shop_base_country' => strtolower(WC()->countries->get_base_country()),
                'currency' => $currency,
                'price_decimal_separator' => wc_get_price_decimal_separator(),
                'price_thousand_separator' => wc_get_price_thousand_separator(),
                'twoinc_plugin_url' => WC_TWOINC_PLUGIN_URL,
                'client_name' => 'wp',
                'client_version' => get_plugin_version(),
                'intl_tel_input_utils_js' => $this->intl_tel_input_asset('js/utils.js'),
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
            if(!is_checkout()) return;
            $twoinc_obj = json_encode(WC_Twoinc_Helper::utf8ize($this->prepare_twoinc_object()), JSON_UNESCAPED_UNICODE);
            if ($twoinc_obj) printf('<script>window.twoinc = %s;</script>', $twoinc_obj);
        }

    }
}
