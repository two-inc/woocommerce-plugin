<?php

/**
 * ABN Checkout page modifier
 *
 * @class WC_ABN_Checkout
 * @author ABN
 */

if (!class_exists('WC_ABN_Checkout')) {
    class WC_ABN_Checkout
    {
        private $wc_abn;

        /**
         * WC_ABN_Checkout constructor.
         */
        public function __construct($wc_abn)
        {

            $this->wc_abn = $wc_abn;

            // Move the country field to the top
            add_filter('woocommerce_checkout_fields', [$this, 'move_country_field'], 20);

            // Register the custom fields
            add_filter('woocommerce_checkout_fields', [$this, 'add_tracking_fields'], 21);
            add_filter('woocommerce_checkout_fields', [$this, 'add_account_fields'], 22);
            add_filter('woocommerce_checkout_fields', [$this, 'update_company_fields'], 23);
            add_filter('woocommerce_checkout_fields', [$this, 'update_contact_fields'], 24);

            // Add terms and conditions checkbox
            add_action('woocommerce_review_order_before_submit', [$this, 'add_abn_terms_accepted_checkbox']);

            add_action('woocommerce_before_checkout_billing_form', [$this, 'add_account_buttons'], 20);
            add_action('woocommerce_pay_order_before_submit', [$this, 'add_account_buttons'], 20);

            // Render the fields on checkout page
            add_action('woocommerce_before_checkout_billing_form', [$this, 'render_abn_fields'], 21);
            add_action('woocommerce_pay_order_before_submit', [$this, 'render_abn_fields'], 21);
            add_action('woocommerce_before_checkout_billing_form', [$this, 'render_abn_representative_fields'], 22);

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
                        <img src = "' . WC_ABN_PLUGIN_URL . 'assets/images/personal.svg"/>
                        <span>' . __('Private Customer', 'abn-payment-gateway') . '</span>
                    </div>
                    <div class="account-type-button" account-type-name="sole_trader">
                        <img src = "' . WC_ABN_PLUGIN_URL . 'assets/images/personal.svg"/>
                        <span>' . __('Sole Trader/Other Customer', 'abn-payment-gateway') . '</span>
                    </div>
                    <div class="account-type-button" account-type-name="business">
                        <img src = "' . WC_ABN_PLUGIN_URL . 'assets/images/business.svg"/>
                        <span>' . __('Business Customer', 'abn-payment-gateway') . '</span>
                    </div>
                </div>'
            );

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
            $available_account_types = $this->wc_abn->available_account_types();
            // Default account type, if available, with priority: business - sole_trader - personal
            end($available_account_types); // Move pointer to last
            $default_account_type = key($available_account_types); // Get current pointer

            if (sizeof($this->wc_abn->available_account_types()) > 1) {

                // Default to personal if admin settings is set
                if ($this->wc_abn->get_option('default_to_b2c') === 'yes' && array_key_exists('personal', $available_account_types)) {
                    $default_account_type = 'personal';
                }

                $fields['account_type'] = [
                    'account_type' => [
                        'label' => __('Select account type', 'abn-payment-gateway'),
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

            if ($this->wc_abn->get_option('enable_company_name') === 'yes') {

                $fields['billing']['billing_company_display'] = [
                    'label' => __('Company name', 'abn-payment-gateway'),
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
                'label' => __('Company ID', 'abn-payment-gateway'),
                'class' => array('hidden'),
                'required' => false,
                'priority' => $company_name_priority + 1
            ];

            if ($this->wc_abn->get_option('add_field_department') === 'yes') {

                $fields['billing']['department'] = [
                    'label' => __('Department', 'abn-payment-gateway'),
                    'class' => array('hidden'),
                    'required' => false,
                    'priority' => $company_name_priority + 2
                ];

            }

            if ($this->wc_abn->get_option('add_field_project') === 'yes') {

                $fields['billing']['project'] = [
                    'label' => __('Project', 'abn-payment-gateway'),
                    'class' => array('hidden'),
                    'required' => false,
                    'priority' => $company_name_priority + 3
                ];

            }

            if ($this->wc_abn->get_option('add_field_purchase_order_number') === 'yes') {

                $fields['billing']['purchase_order_number'] = [
                    'label' => __('Purchase order number', 'abn-payment-gateway'),
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
            if ($this->wc_abn->get_option('add_field_invoice_email') == 'yes') {
                $fields['billing']['invoice_email'] = [
                    'label'       => __('Invoice email address', 'abn-payment-gateway'),
                    'class'       => array('form-row-wide'),
                    'type'        => 'email',
                    'placeholder' => sprintf(__('Only for invoices being sent by %s', 'abn-payment-gateway'), WC_ABN::PRODUCT_NAME),
                    'validate'    => array('email'),
                    'required'    => false,
                    'priority'    => $fields['billing']['billing_email']['priority'] + 1
                ];
            }

            // Return the fields list
            return $fields;

        }

        public function add_abn_terms_accepted_checkbox()
        {
            echo '<div id="abn_terms_field" class="hidden">';
            woocommerce_form_field('abn_terms_accepted_checkbox', array(
                'type'      => 'checkbox',
                'class'     => array('input-checkbox'),
                'label'     => $this->get_terms_and_conditions_text(),
                'required'  => true
            ), WC()->checkout->get_value('abn_terms_accepted_checkbox'));
            echo '</div>';
        }

        /**
         * Get terms and conditions text
         *
         * @return string
         */
        public function get_terms_and_conditions_text()
        {
            $paymentTermsLink = $this->wc_abn::PAYMENT_TERMS_LINK;
            $paymentTermsEmail = $this->wc_abn::PAYMENT_TERMS_EMAIL;
            $paymentTerms = sprintf(__("terms and conditions of %s", 'abn-payment-gateway'), $this->wc_abn::PRODUCT_NAME);

            return sprintf(
                '<span class="abn-terms-text">%s %s %s %s</span>',
                __(
                    'I have filled in all the details truthfully and accept to pay the invoice in 30 days.',
                    'abn-payment-gateway'
                ),
                sprintf(
                    __(
                        'I agree to the %s.',
                        'abn-payment-gateway'
                    ),
                    sprintf('<a href="%s" target="_blank" style="color: #0073aa; text-decoration: none;">%s</a>', $paymentTermsLink, $paymentTerms)
                ),
                sprintf(
                    __(
                        'You hereby give permission to %s to decide on the basis of automated processing of (personal) data whether you can use %s.',
                        'abn-payment-gateway'
                    ),
                    $this->wc_abn::PROVIDER_FULL_NAME,
                    $this->wc_abn::PRODUCT_NAME
                ),
                sprintf(
                    __(
                        'You can withdraw this permission by sending an e-mail to %s.',
                        'abn-payment-gateway'
                    ),
                    sprintf('<a href="mailto:%s" style="color: #0073aa; text-decoration: none;">%s</a>', $paymentTermsEmail, $paymentTermsEmail)
                )
            );
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
         * Render the ABN fields to the checkout page
         *
         * @return void
         */
        public function render_abn_fields()
        {
            ob_start();
            require_once WC_ABN_PLUGIN_PATH . '/views/woocommerce_checkout.php';
            $content = ob_get_clean();
            echo $content;
        }

        /**
         * Render the ABN representative fields to the checkout page
         *
         * @return void
         */
        public function render_abn_representative_fields()
        {
            ob_start();
            require_once WC_ABN_PLUGIN_PATH . '/views/woocommerce_after_checkout_billing_form.php';
            $content = ob_get_clean();
            echo $content;
        }

        /**
         * Customize for Order Pay page when merchant installed "Phone Orders for WooCommerce" plugin
         */
        public function order_pay_page_customize()
        {
            ob_start();
            require_once WC_ABN_PLUGIN_PATH . '/views/woocommerce_order_pay.php';
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
        private function prepare_abn_object($merchant): array
        {
            $currency = get_woocommerce_currency();

            $properties = [
                'text' => [
                    'tooltip_phone' => __('We require your phone number so we can verify your purchase.', 'abn-payment-gateway'),
                    'tooltip_company' => __('We use your company name to automatically populate your address and register the company that made the purchase.', 'abn-payment-gateway'),
                ],
                'abn_checkout_host' => $this->wc_abn->get_abn_checkout_host(),
                'company_name_search' => $this->wc_abn->get_option('enable_company_name'),
                'address_search' => $this->wc_abn->get_option('address_search'),
                'enable_order_intent' => $this->wc_abn->get_option('enable_order_intent'),
                'invoice_fee_to_buyer' => $this->wc_abn->get_option('invoice_fee_to_buyer'),
                'use_account_type_buttons' => $this->wc_abn->get_option('use_account_type_buttons'),
                'display_tooltips' => $this->wc_abn->get_option('display_tooltips'),
                'merchant' => $merchant,
                'days_on_invoice' => $this->wc_abn->get_merchant_default_days_on_invoice(),
                'shop_base_country' => strtolower(WC()->countries->get_base_country()),
                'currency' => $currency,
                'price_decimal_separator' => wc_get_price_decimal_separator(),
                'price_thousand_separator' => wc_get_price_thousand_separator(),
                'abn_plugin_url' => WC_ABN_PLUGIN_URL,
                'client_name' => 'wp',
                'client_version' => get_abn_plugin_version(),
            ];

            $user_id = wp_get_current_user()->ID;
            if ($user_id) {
                $properties['company_id'] = get_user_meta($user_id, 'abn_company_id', true);
                $properties['billing_company'] = get_user_meta($user_id, 'abn_billing_company', true);
                $properties['department'] = get_user_meta($user_id, 'abn_department', true);
                $properties['project'] = get_user_meta($user_id, 'abn_project', true);
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
            $result = $this->wc_abn->verifyAPIKey();
            if (isset($result['code']) && $result['code'] !== 200) {
                return;
            }

            $abn_obj = json_encode(WC_ABN_Helper::utf8ize($this->prepare_abn_object($result['body'])), JSON_UNESCAPED_UNICODE);
            if ($abn_obj) {
                printf('<script>window.abn = %s;</script>', $abn_obj);
            }
        }

    }
}
