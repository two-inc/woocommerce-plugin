<?php

class WC_Tillit_Checkout
{

    private $api_key = null;

    private $merchant_id = null;

    /**
     * WC_Tillit_Checkout constructor.
     */

    public function __construct()
    {

        $WC_Tillit = new WC_Tillit();

        $this->api_key = $WC_Tillit->get_option('api_key');
        $this->merchant_id = $WC_Tillit->get_option('tillit_merchant_id');

        if(!$this->api_key && !$this->merchant_id) return;

        // Remove the default company name
        add_filter('woocommerce_checkout_fields', [$this, 'remove_company_name'], 1);

        // Move the country field to the top
        add_filter('woocommerce_checkout_fields', [$this, 'move_country_field'], 1);

        // Register the custom fields
        add_filter('woocommerce_checkout_fields', [$this, 'add_account_fields'], 1);
        add_filter('woocommerce_checkout_fields', [$this, 'add_company_fields'], 2);

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

    /**
     * Return the tax rate
     *
     * @param WC_Product_Simple|WC_Order_Item_Product $productSimple
     *
     * @return int|mixed
     */

    private static function get_tax_rate($productSimple)
    {
        $tax_rates = WC_Tax::get_rates($productSimple->get_tax_class());
        return $tax_rates && $tax_rates[1] ? $tax_rates[1]['rate'] : 0;
    }

    /**
     * Format the cart products
     *
     * @return array
     */

    public static function get_line_items($products)
    {

        $items = [];

        /** @var WC_Order_Item_Product $cartItem */
        foreach($products as $cartItem) {

            if(gettype($cartItem) !== 'array' && get_class($cartItem) === 'WC_Order_Item_Product') {
                /** @var WC_Order_Item_Product $productSimple */
                $productSimple = $cartItem->get_product();
            } else {
                /** @var WC_Product_Simple $productSimple */
                $productSimple = $cartItem['data'];
            }

            // Get the tax rate
            $tax_rate = WC_Tillit_Checkout::get_tax_rate($productSimple);

            $product = [
                'name' => $productSimple->get_name(),
                'description' => substr($productSimple->get_description(), 0, 255),
                'price' => intval($cartItem['line_subtotal'] * 100),
                'quantity' => $cartItem['quantity'],
                'unit_price' => intval($productSimple->get_price() * 100),
                'tax_class_name' => 'VAT ' . $tax_rate . '%',
                'tax_class_rate' => $tax_rate,
                'quantity_unit' => 'pcs',
                'image_url' => get_the_post_thumbnail_url($productSimple->get_id()),
                'product_page_url' => $productSimple->get_permalink(),
                'type' => 'PHYSICAL',
                'details' => [
                    'barcodes' => [
                        [
                            'type' => 'UPC',
                            'id' => 'MAKE IT OPTIONAL'
                        ],
                        [
                            'type' => 'SKU',
                            'id' => 'MAKE IT OPTIONAL'
                        ]
                    ],
                    'brand' => 'MAKE IT OPTIONAL',
                    'part_number' => 'MAKE IT OPTIONAL',
                ]
            ];

            $categories = wp_get_post_terms($productSimple->get_id(), 'product_cat');

            $product['details']['categories'] = [];

            foreach($categories as $category) {
                $product['details']['categories'][] = $category->name;
            }

            $items[] = $product;

        }

        return $items;

    }

    /**
     * Use the ca
     *
     * @return array
     */

    private function prepare_tillit_object()
    {

        /** @var WC_Cart $cart */
        $cart = WC()->cart;

        $properties = [
            'merchant_id' => $this->merchant_id,
            'api_key' => sprintf('Basic %s', $this->api_key),
            'currency' => get_woocommerce_currency(),
            'line_items' => $this->get_line_items($cart->get_cart_contents()),
            'amount' => intval($cart->get_total('price') * 100)
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
        printf('<script>window.tillit = %s;</script>', json_encode($this->prepare_tillit_object()));
    }

}

new WC_Tillit_Checkout();
