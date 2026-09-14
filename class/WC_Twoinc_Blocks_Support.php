<?php

use Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType;

if (!class_exists('WC_Twoinc_Blocks_Support') && class_exists(AbstractPaymentMethodType::class)) {
    class WC_Twoinc_Blocks_Support extends AbstractPaymentMethodType
    {
        /** @var string */
        protected $name;

        public function initialize()
        {
            $this->name = WC_Twoinc_Brand::get('gateway_id');
            $this->settings = get_option('woocommerce_' . $this->name . '_settings', []);
        }

        /**
         * Asked of the live gateway rather than read from the settings row, so
         * the Blocks tile obeys the same availability gates as the classic one
         * (API-key verdict, brand minimum order) — ABN-554.
         */
        public function is_active()
        {
            return $this->get_gateway() !== null;
        }

        public function get_payment_method_script_handles()
        {
            $asset = 'assets/js/blocks-checkout.js';
            $handle = 'twoinc-blocks-checkout';
            wp_register_script(
                $handle,
                WC_TWOINC_PLUGIN_URL . $asset,
                [
                    'wc-blocks-registry',
                    'wc-settings',
                    'wp-element',
                    'wp-html-entities',
                    'wp-data',
                    'wc-blocks-checkout',
                    // The classic controller this file is a skin over, so its
                    // globals exist before the mount runs (ABN-554).
                    'twoinc-payment-gateway-js',
                ],
                twoinc_get_asset_version($asset),
                true
            );
            // The settings key is the brand's gateway id, which the script
            // cannot know before reading it.
            wp_add_inline_script(
                $handle,
                sprintf('window.twoincBlocksName = %s;', wp_json_encode($this->name)),
                'before'
            );

            // Gated: WooCommerce asks for a payment method's handles on the
            // classic checkout too, and these rules are Blocks-shaped.
            if (WC_Twoinc_Checkout::is_blocks_checkout_request()) {
                $style = 'assets/css/blocks-checkout.css';
                wp_enqueue_style(
                    'twoinc-blocks-checkout',
                    WC_TWOINC_PLUGIN_URL . $style,
                    ['twoinc-payment-gateway-css'],
                    twoinc_get_asset_version($style)
                );
            }

            return [$handle];
        }

        public function get_payment_method_data()
        {
            $gateway = $this->get_gateway();

            return [
                'title' => $gateway ? $gateway->get_pay_title() : '',
                // The gateway's own payment-box description, whole: the
                // subtitle, the term-chip containers, the sole-trader note
                // slot, the company-search tile slot, the order-intent boxes
                // and the term input the submit falls back on. The controller
                // this file skins fills every one of them (ABN-554). The about
                // block is left out because the tile's label renders it, the
                // same split the classic template makes.
                'description' => $gateway ? $gateway->description : '',
                'about' => $gateway ? $gateway->get_about_block_html() : '',
                'iconUrl' => $gateway ? $gateway->icon : '',
                'supports' => $this->get_supported_features(),
            ];
        }

        private function get_gateway(): ?WC_Twoinc
        {
            if (!function_exists('WC') || !WC()->payment_gateways()) {
                return null;
            }
            $gateway = WC()->payment_gateways()->get_available_payment_gateways()[$this->name] ?? null;

            return $gateway instanceof WC_Twoinc ? $gateway : null;
        }
    }
}
