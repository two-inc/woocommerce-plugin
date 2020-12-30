<?php

class WC_Tillit_Checkout
{

    /**
     * WC_Tillit_Checkout constructor.
     */

    public function __construct()
    {

        // Remove the default company name
        add_filter('woocommerce_checkout_fields', [$this, 'remove_company_name']);

        // Register the custom fields
        add_filter('woocommerce_checkout_fields', [$this, 'add_account_fields'], 1);
        add_filter('woocommerce_checkout_fields', [$this, 'add_company_fields'], 2);
        add_filter('woocommerce_checkout_fields', [$this, 'add_representative_fields'], 3);

        // Render the fields on checkout page
        add_action('woocommerce_checkout_billing', [$this, 'render_tillit_fields'], 1);
        add_action('woocommerce_after_checkout_billing_form', [$this, 'render_tillit_representative_fields'], 1);

    }

    public function add_account_fields($fields)
    {

        // Define the company details
        $fields['account_type'] = [
            'account_type' => [
                'label' => __('Select the account type', 'woocommerce-gateway-tillit'),
                'required' => true,
                'type' => 'radio',
                'priority' => 15,
                'value' => 'personal',
                'options' => [
                    'personal' => __('Personal', 'woocommerce-gateway-tillit'),
                    'business' => __('Business', 'woocommerce-gateway-tillit')
                ]
            ]
        ];

        // Return the fields
        return $fields;

    }

    /**
     * Add the company name and company ID fields
     *
     * @param $fields
     *
     * @return mixed
     */

    public function add_company_fields($fields)
    {

        $fields['billing']['company_name'] = [
            'label' => __('Company name', 'woocommerce-gateway-tillit'),
            'required' => false,
            'priority' => 1
        ];

        $fields['billing']['company_id'] = [
            'label' => __('Company ID', 'woocommerce-gateway-tillit'),
            'required' => false,
            'priority' => 2
        ];

        // Return the fields
        return $fields;

    }

    /**
     * Add the representative fields to checkout page
     *
     * @param $fields
     *
     * @return mixed
     */

    public function add_representative_fields($fields)
    {

        // Define the representative details
        $fields['representative'] = [
            'representative_first_name' => [
                'label' => __('First name', 'woocommerce-gateway-tillit'),
                'class' => [
                    'form-row-first'
                ],
                'priority' => 15,
            ],
            'representative_last_name' => [
                'label' => __('Last name', 'woocommerce-gateway-tillit'),
                'class' => [
                    'form-row-last'
                ],
                'priority' => 20
            ],
            'representative_phone_number' => [
                'label' => __('Phone number', 'woocommerce-gateway-tillit'),
                'priority' => 25
            ],
            'representative_email' => [
                'label' => __('Email', 'woocommerce-gateway-tillit'),
                'priority' => 30
            ]
        ];

        // Return the fields
        return $fields;

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
        unset($fields['billing']['billing_company']);
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

}


new WC_Tillit_Checkout();
