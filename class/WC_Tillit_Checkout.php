<?php

class WC_Tillit_Checkout
{

    public function __construct()
    {
        add_filter('woocommerce_checkout_fields', [$this, 'remove_company_name']);
        add_filter('woocommerce_checkout_fields', [$this, 'add_company_fields'], 1);
        add_filter('woocommerce_checkout_fields', [$this, 'add_representative_fields'], 2);
        add_action('woocommerce_checkout_billing', [$this, 'inject_company_details'], 1);
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

        // Define the company details
        $fields['company'] = [
            'company_name' => [
                'label' => __('Company name', 'woocommerce-gateway-tillit'),
                'required' => true,
                'priority' => 15
            ],
            'company_id' => [
                'label' => __('Company ID', 'woocommerce-gateway-tillit'),
                'required' => true,
                'priority' => 20
            ]
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
                'required' => true,
                'priority' => 15
            ],
            'representative_last_name' => [
                'label' => __('Last name', 'woocommerce-gateway-tillit'),
                'required' => true,
                'priority' => 20
            ],
            'representative_phone_number' => [
                'label' => __('Phone number', 'woocommerce-gateway-tillit'),
                'required' => true,
                'priority' => 25
            ],
            'representative_email' => [
                'label' => __('Email', 'woocommerce-gateway-tillit'),
                'required' => true,
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
        // echo '<pre>'; print_r($fields); exit;
        unset($fields['billing']['billing_company']);
        return $fields;
    }

    public function inject_company_details()
    {
        ob_start();
        require_once WC_TILLIT_PLUGIN_PATH . '/views/woocommerce_checkout_company.php';
        $content = ob_get_clean();
        echo $content;
    }

}


new WC_Tillit_Checkout();
