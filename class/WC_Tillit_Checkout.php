<?php

/**
 * Tillit Checkout page modifier
 *
 * @class WC_Tillit_Checkout
 * @author Tillit
 */

class WC_Tillit_Checkout
{

    private $WC_Tillit;

    /**
     * WC_Tillit_Checkout constructor.
     */
    public function __construct($tillit_payment_gateway)
    {

        $this->WC_Tillit = $tillit_payment_gateway;

        // Remove the default company name
        add_filter('woocommerce_checkout_fields', [$this, 'remove_company_name'], 1);

        // Move the country field to the top
        add_filter('woocommerce_checkout_fields', [$this, 'move_country_field'], 1);

        // Register the custom fields
        add_filter('woocommerce_checkout_fields', [$this, 'add_account_fields'], 1);
        add_filter('woocommerce_checkout_fields', [$this, 'add_company_fields'], 2);
        add_filter('woocommerce_checkout_fields', [$this, 'update_phone_field'], 3);
        add_filter('woocommerce_checkout_fields', [$this, 'add_tracking_field'], 4);

        // Render the fields on checkout page
        add_action('woocommerce_checkout_billing', [$this, 'render_tillit_fields'], 1);
        add_action('woocommerce_before_checkout_billing_form', [$this, 'render_tillit_representative_fields'], 1);

        // Inject the cart details in header
        add_action('wp_head', [$this, 'inject_cart_details']);

    }

    /**
     * Remove the default company name from the checkout page
     *
     * @param $fields
     *
     * @return array
     */
    public function remove_company_name($fields)
    {

        if($this->WC_Tillit->get_option('enable_company_name') === 'yes') {

            // Remove the field
            unset($fields['billing']['billing_company']);

        }

        // Return the fields list
        return $fields;

    }

    /**
     * Move the country field at the top of the Billing Details section
     *
     * @param $fields
     */
    public function move_country_field($fields)
    {

        // Change the priority for the country field
        $fields['billing']['billing_country']['priority'] = 1;

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


        if($this->WC_Tillit->get_option('enable_b2b_b2c_radio') === 'yes') {

            $fields['account_type'] = [
                'account_type' => [
                    'label' => __('Select the account type', 'woocommerce-gateway-tillit'),
                    'required' => true,
                    'type' => 'radio',
                    'priority' => 15,
                    'value' => 'business',
                    'options' => [
                        'personal' => __('Personal', 'woocommerce-gateway-tillit'),
                        'business' => __('Business', 'woocommerce-gateway-tillit')
                    ]
                ]
            ];

        } else {

            $fields['account_type'] = [
                'account_type' => [
                    'required' => true,
                    'type' => 'radio',
                    'class' => array('hidden'),
                    'priority' => 15,
                    'value' => 'business',
                    'options' => [
                        'business' => __('Business', 'woocommerce-gateway-tillit')
                    ]
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
    public function add_company_fields($fields)
    {

        $with_company_search = $this->WC_Tillit->get_option('enable_company_name') === 'yes';

        if($with_company_search) {
            $fields['billing']['billing_company'] = [
                'label' => __('Company name', 'woocommerce-gateway-tillit'),
                'autocomplete' => 'organization',
                'type' => 'select',
                /*'custom_attributes' => [
                    'data-multiple' => true,
                    'data-multi' => true
                ],*/
                'options' => [
                    '' => __('Enter the company name', 'woocommerce-gateway-tillit')
                ],
                'required' => false,
                'priority' => 2
            ];
        }

        $fields['billing']['company_id'] = [
            'label' => __('Company ID', 'woocommerce-gateway-tillit'),
            'required' => false,
            'priority' => $with_company_search ? 3 : 35
        ];

        $fields['billing']['department'] = [
            'label' => __('Department', 'woocommerce-gateway-tillit'),
            'required' => false,
            'priority' => 4
        ];

        $fields['billing']['project'] = [
            'label' => __('Project', 'woocommerce-gateway-tillit'),
            'required' => false,
            'priority' => 5
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
    public function update_phone_field($fields)
    {

        $fields['billing']['billing_phone']['placeholder'] = '+47 99999999';

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
    public function add_tracking_field($fields)
    {

        $fields['billing']['tracking_id'] = [
            'required' => false,
            'type' => 'hidden',
            'class' => array('hidden'),
            'priority' => 16
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

        $properties = [
            'messages' => [
                'subtitle_order_intent_ok' =>$this->WC_Tillit->get_option('subtitle'),
                'subtitle_order_intent_reject' => __('EHF Invoice is not available for this order', 'woocommerce-gateway-tillit'),
                'amount_min' => sprintf(__('Minimum Payment using Tillit is %s NOK', 'woocommerce-gateway-tillit'), '200'),
                'amount_max' => sprintf(__('Maximum Payment using Tillit is %s NOK', 'woocommerce-gateway-tillit'), '250,000'),
                'invalid_phone' => __('Please use phone format +47 99999999', 'woocommerce-gateway-tillit'),
            ],
            'tillit_search_host' => $this->WC_Tillit->tillit_search_host,
            'tillit_checkout_host' => $this->WC_Tillit->tillit_checkout_host,
            'company_name_search' => $this->WC_Tillit->get_option('enable_company_name'),
            'company_id_search' => $this->WC_Tillit->get_option('enable_company_id'),
            'enable_order_intent' => $this->WC_Tillit->get_option('enable_order_intent'),
            'merchant_id' => $this->WC_Tillit->get_option('tillit_merchant_id'),
            'currency' => get_woocommerce_currency(),
            'price_decimal_separator' => wc_get_price_decimal_separator(),
            'price_thousand_separator' => wc_get_price_thousand_separator()
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
        $tillit_obj = json_encode(WC_Tillit_Helper::utf8ize($this->prepare_tillit_object()));
        if ($tillit_obj) printf('<script>window.tillit = %s;</script>', $tillit_obj);
    }

}
