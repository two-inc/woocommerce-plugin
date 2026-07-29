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

            // Brand overlays add/modify checkout fields after the base set
            // is complete (priority 25 > the base mutations above)
            add_filter('woocommerce_checkout_fields', [$this, 'apply_brand_checkout_fields'], 25);

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
         * Let a brand overlay add or modify checkout form fields
         *
         * @param $fields
         *
         * @return mixed
         */
        public function apply_brand_checkout_fields($fields)
        {
            return apply_filters('twoinc_checkout_fields', $fields);
        }

        /**
         * Move the country field at the top of the Billing Details section
         *
         * @param $fields
         */
        public function move_country_field($fields)
        {

            // Change the priority for the country field. billing_company may
            // be absent (e.g. WooCommerce's own "Company name" field toggle
            // disabled) — fall back to core's default priority (30) rather
            // than warning on an undefined array key.
            $company_priority = $fields['billing']['billing_company']['priority'] ?? 30;
            $fields['billing']['billing_country']['priority'] = $company_priority - 1;

            // Return the fields list
            return $fields;
        }

        /**
         * Add fields: Company name, Company ID, and the optional buyer fields
         * (invoice email, purchase order number, project, department).
         *
         * @param $fields
         *
         * @return mixed
         */
        public function update_company_fields($fields)
        {

            // billing_company may be absent (see move_country_field above).
            $company_name_priority = $fields['billing']['billing_company']['priority'] ?? 30;

            if ($this->wc_twoinc->get_enable_company_search() === 'yes') {
                $fields['billing']['billing_company_display'] = [
                    'label' => __('Company name', 'twoinc-payment-gateway'),
                    'autocomplete' => 'organization',
                    'type' => 'select',
                    /*'custom_attributes' => [
                        'data-multiple' => true,
                        'data-multi' => true
                    ],*/
                    // form-row-wide is what carries WooCommerce's
                    // `clear: both` (and full width) for a checkout row.
                    // Without it this row does not clear the
                    // form-row-first/form-row-last float pair that the first-
                    // and last-name rows form, so its label's line boxes get
                    // squeezed into the gutter between those two 47% floats —
                    // the label renders wrapped between the two name inputs
                    // (TWO-25160).
                    'class' => array('billing_company_selectwoo', 'form-row-wide', 'hidden'),
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

            // Optional checkout fields. ORDER IS LOAD-BEARING: WooCommerce sorts
            // the billing fields by `priority` (wc_checkout_fields_uasort_comparison),
            // so the ascending offsets below are what the buyer sees, and they must
            // match the admin pane sequence in WC_Twoinc::init_form_fields() —
            // invoice email, purchase order number, project, department. The order
            // note is WooCommerce core's own `order_comments` and stays where core
            // puts it (the "Additional information" block, after billing). TWO-25263.
            if ($this->wc_twoinc->get_option('add_field_invoice_email') == 'yes') {
                $fields['billing']['invoice_email'] = [
                    'label'       => __('Invoice email address', 'twoinc-payment-gateway'),
                    'class'       => array('form-row-wide'),
                    'type'        => 'email',
                    'placeholder' => sprintf(__('Only for invoices being sent by %s', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name')),
                    'validate'    => array('email'),
                    'required'    => false,
                    'priority'    => $company_name_priority + 2
                ];
            }

            if ($this->wc_twoinc->get_option('add_field_purchase_order_number') === 'yes') {
                $fields['billing']['purchase_order_number'] = [
                    'label' => __('Purchase order number', 'twoinc-payment-gateway'),
                    'class' => array('hidden'),
                    'required' => false,
                    'priority' => $company_name_priority + 3
                ];
            }

            if ($this->wc_twoinc->get_option('add_field_project') === 'yes') {
                $fields['billing']['project'] = [
                    'label' => __('Project', 'twoinc-payment-gateway'),
                    'class' => array('hidden'),
                    'required' => false,
                    'priority' => $company_name_priority + 4
                ];
            }

            if ($this->wc_twoinc->get_option('add_field_department') === 'yes') {
                $fields['billing']['department'] = [
                    'label' => __('Department', 'twoinc-payment-gateway'),
                    'class' => array('hidden'),
                    'required' => false,
                    'priority' => $company_name_priority + 5
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

            // Checkout render is the sanctioned refresh point for the
            // backend term list (TWO-24812) — refresh once here; the
            // cache-only seam reads below (is_selector_visible,
            // get_selected_term, …) then see the fresh list.
            $offered_terms = WC_Twoinc_Payment_Terms::get_available_terms($this->wc_twoinc, true);

            // TODO: Make this dynamic based on active merchant payee accounts
            $supported_buyer_countries = WC_Twoinc_Brand::get('supported_buyer_countries');

            $properties = [
                'text' => [
                    'tooltip_phone' => __('We require your phone number so we can verify your purchase.', 'twoinc-payment-gateway'),
                    'tooltip_company' => __('We use your company name to automatically populate your address and register the company that made the purchase.', 'twoinc-payment-gateway'),
                    // Shown in the company-search dropdown when the lookup
                    // times out or comes back degraded (TWO-25232) — never
                    // for a search that simply matched nothing.
                    'company_search_unavailable' => __('Company search is temporarily unavailable. Please try again.', 'twoinc-payment-gateway'),
                ],
                'twoinc_checkout_host' => $this->wc_twoinc->get_twoinc_checkout_host(),
                'enable_company_search' => $this->wc_twoinc->get_enable_company_search(),
                'enable_company_search_for_others' => $this->wc_twoinc->get_option('enable_company_search_for_others'),
                'enable_address_lookup' => $this->wc_twoinc->get_option('enable_address_lookup'),
                'enable_order_intent' => $this->wc_twoinc->get_option('enable_order_intent'),
                'display_tooltips' => $this->wc_twoinc->get_option('display_tooltips'),
                'supported_buyer_countries' => $supported_buyer_countries,
                'gateway_id' => WC_Twoinc_Brand::get('gateway_id'),
                'merchant' => $merchant,
                'merchant_due_in_days' => $this->wc_twoinc->get_merchant_due_in_days(),
                'shop_base_country' => strtolower(WC()->countries->get_base_country()),
                'currency' => $currency,
                'price_decimal_separator' => wc_get_price_decimal_separator(),
                'price_thousand_separator' => wc_get_price_thousand_separator(),
                'twoinc_plugin_url' => WC_TWOINC_PLUGIN_URL,
                'client_name' => 'wp',
                'client_version' => get_twoinc_plugin_version(),
                // Chip selector bootstrap (TWO-24751). JS renders only; the
                // live data (fees, selection) comes from the wc-ajax
                // endpoints in WC_Twoinc_Payment_Terms.
                'payment_terms' => [
                    'days_label' => __('%s days', 'twoinc-payment-gateway'),
                    // Chip copy, verbatim from magento-plugin's Luma renderer
                    // (view/frontend/web/js/view/payment/method-renderer/
                    // gateway_method.js + template/payment/gateway_method.html),
                    // which is also what the Amasty and Fire checkouts render —
                    // they share that one template (ABN-468).
                    //
                    // >1 term  → `heading` sits ABOVE the chips.
                    // exactly 1 → no heading; `single_label` replaces the bare
                    //             "N days" text INSIDE the single chip.
                    'heading' => __('Selected payment terms', 'twoinc-payment-gateway'),
                    'single_label' => __('Payment Terms %s days', 'twoinc-payment-gateway'),
                    // Chips render whenever a term is offered, including the
                    // single-term case — Magento shows that one term (and its
                    // surcharge) as a disabled chip rather than hiding it.
                    // Whether the buyer can CHOOSE is not sent: render()
                    // derives it from the term list it is handed, which the
                    // fees response can revise after this bootstrap is
                    // written, so a flag fixed here would go stale.
                    'enabled' => WC_Twoinc_Payment_Terms::is_enabled($this->wc_twoinc),
                    'terms' => $offered_terms,
                    'selected' => WC_Twoinc_Payment_Terms::get_selected_term($this->wc_twoinc),
                    'offset_pricing_enabled' => WC_Twoinc_Payment_Terms::get_surcharge_settings($this->wc_twoinc)['enabled'],
                    'fees_url' => class_exists('WC_AJAX') ? WC_AJAX::get_endpoint('two_term_fees') : '',
                    'select_url' => class_exists('WC_AJAX') ? WC_AJAX::get_endpoint('two_select_term') : '',
                    'nonce' => wp_create_nonce('twoinc_checkout'),
                ],
                // Sole trader bootstrap (TWO-24754). JS renders only; country
                // availability and token minting come from the wc-ajax
                // endpoints in WC_Twoinc_Sole_Trader.
                'sole_trader' => [
                    'availability_url' => class_exists('WC_AJAX') ? WC_AJAX::get_endpoint('two_sole_trader_availability') : '',
                    'tokens_url' => class_exists('WC_AJAX') ? WC_AJAX::get_endpoint('two_sole_trader_tokens') : '',
                    'nonce' => wp_create_nonce('twoinc_checkout'),
                    'text' => [
                        'registered_business' => __('Registered company', 'twoinc-payment-gateway'),
                        'sole_trader' => __('Sole trader', 'twoinc-payment-gateway'),
                        'popup_prompt' => __('Click here to login or sign up as a sole trader.', 'twoinc-payment-gateway'),
                        'error' => __('Something went wrong setting up sole trader checkout. Please try again.', 'twoinc-payment-gateway'),
                    ],
                ],
            ];

            $user_id = wp_get_current_user()->ID;
            if ($user_id) {
                $properties['company_id'] = get_user_meta($user_id, WC_Twoinc_Brand::prefixed_name('company_id'), true);
                $properties['billing_company'] = get_user_meta($user_id, WC_Twoinc_Brand::prefixed_name('billing_company'), true);
                $properties['department'] = get_user_meta($user_id, WC_Twoinc_Brand::prefixed_name('department'), true);
                $properties['project'] = get_user_meta($user_id, WC_Twoinc_Brand::prefixed_name('project'), true);
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
