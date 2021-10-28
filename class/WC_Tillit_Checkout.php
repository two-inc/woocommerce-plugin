<?php

/**
 * Tillit Checkout page modifier
 *
 * @class WC_Tillit_Checkout
 * @author Tillit
 */

if (!class_exists('WC_Tillit_Checkout')) {
    class WC_Tillit_Checkout
    {

        private $wc_tillit;

        /**
         * WC_Tillit_Checkout constructor.
         */
        public function __construct($wc_tillit)
        {

            $this->wc_tillit = $wc_tillit;

            // Move the country field to the top
            add_filter('woocommerce_checkout_fields', [$this, 'move_country_field'], 20);

            // Register the custom fields
            add_filter('woocommerce_checkout_fields', [$this, 'add_tracking_fields'], 21);
            add_filter('woocommerce_checkout_fields', [$this, 'add_account_fields'], 22);
            add_filter('woocommerce_checkout_fields', [$this, 'update_company_fields'], 23);
            add_filter('woocommerce_checkout_fields', [$this, 'update_phone_fields'], 24);

            // Render the fields on checkout page
            add_action('woocommerce_checkout_billing', [$this, 'render_tillit_fields'], 1);
            add_action('woocommerce_before_checkout_billing_form', [$this, 'render_tillit_representative_fields'], 1);

            // Inject the cart details in header
            add_action('woocommerce_before_checkout_billing_form', [$this, 'inject_cart_details']);

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
         * Add the account type fields to the checkout page
         *
         * @param $fields
         *
         * @return mixed
         */
        public function add_account_fields($fields)
        {

            // available_account_types size always > 0
            $available_account_types = $this->wc_tillit->available_account_types();
            // Default account type, if available, with priority: business - sole_trader - personal
            end($available_account_types); // Move pointer to last
            $default_account_type = key($available_account_types); // Get current pointer

            if(sizeof($this->wc_tillit->available_account_types()) > 1) {

                // Default to personal if admin settings is set
                if ($this->wc_tillit->get_option('default_to_b2c') === 'yes' && array_key_exists('personal', $available_account_types)) {
                    $default_account_type = 'personal';
                }

                $fields['account_type'] = [
                    'account_type' => [
                        'label' => __('Select the account type', 'tillit-payment-gateway'),
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
                        'class' => array('hidden'),
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

            $with_company_search = $this->wc_tillit->get_option('enable_company_name') === 'yes';
            $company_name_priority = $fields['billing']['billing_company']['priority'];

            if($with_company_search) {

                $fields['billing']['billing_company_display'] = [
                    'label' => __('Company name', 'tillit-payment-gateway'),
                    'autocomplete' => 'organization',
                    'type' => 'select',
                    /*'custom_attributes' => [
                        'data-multiple' => true,
                        'data-multi' => true
                    ],*/
                    'class' => array('billing_company_selectwoo'),
                    'options' => [
                        '' => '&nbsp;'
                    ],
                    'required' => false,
                    'priority' => $company_name_priority
                ];

                $fields['billing']['company_id'] = [
                    'label' => __('Company ID', 'tillit-payment-gateway'),
                    'required' => false,
                    'priority' => $company_name_priority + 1,
                    'custom_attributes' => array('readonly' => 'readonly')
                ];

            } else {

                $fields['billing']['company_id'] = [
                    'label' => __('Company ID', 'tillit-payment-gateway'),
                    'required' => false,
                    'priority' => $company_name_priority + 1
                ];

            }

            $fields['billing']['department'] = [
                'label' => __('Department', 'tillit-payment-gateway'),
                'required' => false,
                'priority' => $company_name_priority + 2
            ];

            $fields['billing']['project'] = [
                'label' => __('Project', 'tillit-payment-gateway'),
                'required' => false,
                'priority' => $company_name_priority + 3
            ];

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
                'label' => __('Phone', 'tillit-payment-gateway'),
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
                'required' => false,
                'type' => 'text',
                'class' => array('hidden'),
                'priority' => 20
            ];

            // Return the fields list
            return $fields;

        }

        /**
         * Render the Tillit fields to the checkout page
         *
         * @return void
         */
        public function render_tillit_fields()
        {
            ob_start();
            require_once WC_TILLIT_PLUGIN_PATH . '/views/woocommerce_checkout.php';
            $content = ob_get_clean();
            echo $content;
        }

        /**
         * Render the Tillit representative fields to the checkout page
         *
         * @return void
         */
        public function render_tillit_representative_fields()
        {
            ob_start();
            require_once WC_TILLIT_PLUGIN_PATH . '/views/woocommerce_after_checkout_billing_form.php';
            $content = ob_get_clean();
            echo $content;
        }

        /**
         * Use the ca
         *
         * @return array
         */
        private function prepare_tillit_object()
        {

            $product_type = $this->wc_tillit->get_option('product_type');

            // Backward compatible
            if ($product_type === 'MERCHANT_INVOICE') {
                $product_type = 'DIRECT_INVOICE';
            }

            $currency = get_woocommerce_currency();
            $amount_min = '200 NOK';
            $amount_max = '500,000 NOK';
            if ($currency === 'GBP') {
                $amount_min = '10 GBP';
                $amount_max = '10,000 GBP';
            }

            $properties = [
                'messages' => [
                    'subtitle_order_intent_ok' =>$this->wc_tillit->get_option('subtitle'),
                    'subtitle_order_intent_reject' => __('Invoice is not available for this purchase', 'tillit-payment-gateway'),
                    'amount_min' => sprintf(__('Minimum Payment using Tillit is %s', 'tillit-payment-gateway'), $amount_min),
                    'amount_max' => sprintf(__('Maximum Payment using Tillit is %s', 'tillit-payment-gateway'), $amount_max),
                    'invalid_phone' => __('Phone number is invalid', 'tillit-payment-gateway'),
                ],
                'tillit_plugin_url' => WC_TILLIT_PLUGIN_URL,
                'tillit_search_host_no' => $this->wc_tillit->tillit_search_host_no,
                'tillit_search_host_gb' => $this->wc_tillit->tillit_search_host_gb,
                'tillit_checkout_host' => $this->wc_tillit->tillit_checkout_host,
                'display_other_payments' => $this->wc_tillit->get_option('display_other_payments'),
                'fallback_to_another_payment' => $this->wc_tillit->get_option('fallback_to_another_payment'),
                'company_name_search' => $this->wc_tillit->get_option('enable_company_name'),
                'company_id_search' => $this->wc_tillit->get_option('enable_company_id'),
                'enable_order_intent' => $this->wc_tillit->get_option('enable_order_intent'),
                'mark_tillit_fields_required' => $this->wc_tillit->get_option('mark_tillit_fields_required'),
                'product_type' => $product_type,
                'merchant_short_name' => $this->wc_tillit->get_option('tillit_merchant_id'),
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
            $tillit_obj = json_encode(WC_Tillit_Helper::utf8ize($this->prepare_tillit_object()), JSON_UNESCAPED_UNICODE);
            if ($tillit_obj) printf('<script>window.tillit = %s;</script>', $tillit_obj);
        }

    }
}
