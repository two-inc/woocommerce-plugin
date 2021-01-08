<?php

class WC_Tillit_Checkout
{

    /**
     * WC_Tillit_Checkout constructor.
     */

    public function __construct()
    {

        // Remove the default company name
        add_filter('woocommerce_checkout_fields', [$this, 'remove_company_name'], 1);

        // Move the country field to the top
        add_filter('woocommerce_checkout_fields', [$this, 'move_country_field'], 1);

        // Register the custom fields
        add_filter('woocommerce_checkout_fields', [$this, 'add_account_fields'], 1);
        add_filter('woocommerce_checkout_fields', [$this, 'add_company_fields'], 2);

        // Render the fields on checkout page
        add_action('woocommerce_checkout_billing', [$this, 'render_tillit_fields'], 1);
        add_action('woocommerce_after_checkout_billing_form', [$this, 'render_tillit_representative_fields'], 1);

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

        // Remove the field
        unset($fields['billing']['billing_company']);

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

        $fields['billing']['company_id'] = [
            'label' => __('Company ID', 'woocommerce-gateway-tillit'),
            'required' => false,
            'priority' => 3
        ];

        // Return the fields
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
