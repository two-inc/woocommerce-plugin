<?php

class WC_Tillit_Checkout
{

    private $api_key = null;

    private $merchant_id = null;

    private $WC_Tillit;

    /**
     * WC_Tillit_Checkout constructor.
     */

    public function __construct()
    {

        $this->WC_Tillit = new WC_Tillit();

        $this->api_key = $this->WC_Tillit->get_option('api_key');
        $this->merchant_id = $this->WC_Tillit->get_option('tillit_merchant_id');

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

        // Define the company details
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
            'priority' => 3
        ];

        $fields['billing']['project'] = [
            'label' => __('Project', 'woocommerce-gateway-tillit'),
            'required' => false,
            'priority' => 4
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
     * @param WC_Product_Simple|WC_Order_Item_Product $product_simple
     *
     * @return int|mixed
     */

    private static function get_tax_rate($product_simple)
    {
        $tax_rates = WC_Tax::get_rates($product_simple->get_tax_class());
        return $tax_rates && $tax_rates[1] ? $tax_rates[1]['rate'] : 0;
    }

    /**
     * Format the cart items
     *
     * @return array
     */

    public static function get_line_items($line_items)
    {

        $items = [];

        /** @var WC_Order_Item_Product $line_item */
        foreach($line_items as $line_item) {

            if(gettype($line_item) !== 'array' && get_class($line_item) === 'WC_Order_Item_Product') {
                /** @var WC_Order_Item_Product */
                $product_simple = $line_item->get_product();
            } else {
                /** @var WC_Product_Simple */
                $product_simple = $line_item['data'];
            }

            $tax_rate = WC_Tillit_Checkout::get_tax_rate($product_simple);

            $product = [
                'name' => $product_simple->get_name(),
                'description' => substr($product_simple->get_description(), 0, 255),
                'gross_amount' => strval(WC_Tillit_Checkout::round_amt($line_item['line_total'] + $line_item['line_tax'])),
                'net_amount' =>  strval(WC_Tillit_Checkout::round_amt($line_item['line_total'])),
                'discount_amount' => strval(WC_Tillit_Checkout::round_amt($line_item['line_subtotal'] - $line_item['line_total'])),
                'tax_amount' => strval(WC_Tillit_Checkout::round_amt($line_item['line_tax'])),
                'tax_class_name' => 'VAT ' . $tax_rate . '%',
                'tax_rate' => strval($tax_rate),
                'unit_price' => strval(WC_Tillit_Checkout::round_amt($product_simple->get_price())),
                'quantity' => $line_item['quantity'],
                'quantity_unit' => 'item',
                'image_url' => get_the_post_thumbnail_url($product_simple->get_id()),
                'product_page_url' => $product_simple->get_permalink(),
                'type' => 'PHYSICAL',
                'details' => [
                    'barcodes' => [
                        [
                            'type' => 'SKU',
                            'id' => $product_simple->get_sku()
                        ]
                    ]
                ]
            ];

            $categories = wp_get_post_terms($product_simple->get_id(), 'product_cat');

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

        // Only proceed if taxes are configured
        if (!$cart->get_taxes() || count($cart->get_taxes()) == 0) {
            return [
                'error'   => 'TAX_NOT_CONFIGURED',
                'messages' => [
                    __('Tillit Merchant Error: Taxes are not configured', 'woocommerce-gateway-tillit')
                ]
            ];
        }

        $properties = [
            'tillit_search_host' => $this->WC_Tillit->tillit_search_host,
            'tillit_checkout_host' => $this->WC_Tillit->tillit_checkout_host,
            'company_name_search' => $this->WC_Tillit->get_option('enable_company_name'),
            'company_id_search' => $this->WC_Tillit->get_option('enable_company_id'),
            'merchant_id' => $this->merchant_id,
            'currency' => get_woocommerce_currency(),
            'line_items' => $this->get_line_items($cart->get_cart_contents()),
            'gross_amount' => strval($cart->get_total('price'))
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

    /**
     * Round the amount in woocommerce way
     *
     * @return float
     */

    public static function round_amt($amt)
    {
        return round($amt, wc_get_price_decimals());
    }

}

new WC_Tillit_Checkout();
