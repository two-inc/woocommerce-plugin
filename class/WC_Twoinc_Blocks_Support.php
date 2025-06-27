<?php

use Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType;

final class WC_Twoinc_Blocks_Support extends AbstractPaymentMethodType {

    private $gateway;
    protected $name = 'woocommerce-gateway-tillit';

    public function initialize() {
        $this->gateway = new WC_Twoinc();
    }

    public function is_active() {
        return !empty($this->gateway) && $this->gateway->is_available();
    }

    public function get_payment_method_script_handles() {
        $dependencies = [];

        $script_path       = WC_TWOINC_PLUGIN_URL . 'build/index.js';
        $script_asset_path = WC_TWOINC_PLUGIN_PATH . 'build/index.asset.php';
        $script_asset      = file_exists( $script_asset_path )
            ? require( $script_asset_path )
            : array(
                'dependencies' => ['wp-element', 'wp-html-entities', 'wp-i18n', 'wp-data', 'wc-blocks-registry', 'wc-settings', 'wc-blocks-data-store'],
                'version'      => get_twoinc_plugin_version(),
            );
        $script_handle = 'wc-twoinc-blocks-integration';

        $final_dependencies = array_merge($script_asset['dependencies'], $dependencies);

        wp_register_script(
            $script_handle,
            $script_path,
            $final_dependencies,
            $script_asset['version'],
            true
        );

        return [ $script_handle ];
    }

    public function get_payment_method_data() {
        // Ensure that the API key valid
        $result = $this->gateway->verify_api_key();
        $merchant_data = [];
        if (isset($result['code']) && $result['code'] === 200) {
            $merchant_data = $result['body'];
        }

        return [
            'title'       => $this->gateway->get_title(),
            'description' => $this->gateway->get_description(),
            'supports'    => array_filter( $this->gateway->supports, [ $this->gateway, 'supports' ] ),
            'icon'        => $this->gateway->get_icon(),
            'addFieldDepartment' => $this->gateway->get_option('add_field_department') === 'yes',
            'addFieldProject' => $this->gateway->get_option('add_field_project') === 'yes',
            'addFieldPurchaseOrderNumber' => $this->gateway->get_option('add_field_purchase_order_number') === 'yes',
            'addInvoiceEmail' => $this->gateway->get_option('add_field_invoice_email') === 'yes',
            'enableCompanySearch' => $this->gateway->get_enable_company_search() === 'yes',
            'merchantId' => $this->gateway->get_merchant_id(),
            'twoincCheckoutHost' => $this->gateway->get_twoinc_checkout_host(),
            'merchant' => $merchant_data,
            'clientName' => 'wp',
            'clientVersion' => get_twoinc_plugin_version(),
            'shopBaseCountry' => strtoupper(WC()->countries->get_base_country()),
        ];
    }
}
