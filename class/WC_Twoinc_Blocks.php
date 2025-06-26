<?php
use Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType;

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly.
}

final class WC_Twoinc_Blocks extends AbstractPaymentMethodType {
    /**
     * Block name/id, should match gateway id
     *
     * @var string
     */
    protected $name = 'woocommerce-gateway-tillit';

    /**
     * Initialize payment method settings.
     */
    public function initialize() {
        $this->settings = get_option('woocommerce_' . $this->name . '_settings', []);
    }

    /**
     * Is this payment method active?
     *
     * @return bool
     */
    public function is_active() {
        $gateway = wc_get_payment_gateway_by_id($this->name);
        return $gateway && $gateway->is_available();
    }

    /**
     * Return the script handles used for the block checkout.
     *
     * @return array
     */
    public function get_payment_method_script_handles() {
        if (!wp_script_is('twoinc-payment-gateway-js', 'registered')) {
            wp_register_script(
                'twoinc-payment-gateway-js',
                WC_TWOINC_PLUGIN_URL . '/assets/js/twoinc.js',
                ['jquery'],
                get_twoinc_plugin_version(),
                true
            );
        }
        return ['twoinc-payment-gateway-js'];
    }

    /**
     * Data sent to the block frontend.
     *
     * @return array
     */
    public function get_payment_method_data() {
        return [];
    }
}
