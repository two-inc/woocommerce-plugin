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

            $style = 'assets/css/blocks-checkout.css';
            wp_enqueue_style(
                'twoinc-blocks-checkout',
                WC_TWOINC_PLUGIN_URL . $style,
                ['twoinc-payment-gateway-css'],
                twoinc_get_asset_version($style)
            );

            return [$handle];
        }

        public function get_payment_method_data()
        {
            $gateway = $this->get_gateway();

            return [
                'title' => $gateway ? $gateway->get_pay_title() : '',
                // The gateway's own payment-box description, whole — every
                // slot the controller this file skins fills. Without the about
                // block, which the tile's label renders instead, the same
                // split the classic template makes (ABN-554).
                'description' => $gateway ? $gateway->description : '',
                'about' => $gateway ? $gateway->get_about_block_html() : '',
                // Its own field, not part of the description: the classic
                // checkout emits the same block from its own hook (ABN-554).
                'terms' => $gateway ? $gateway->get_terms_consent_html() : '',
                'iconUrl' => $gateway ? $gateway->icon : '',
                // TWO-25800: the product-page button preselects this gateway
                // by writing the session key classic checkout already reads.
                // Blocks has no server-side equivalent, so the tile selects
                // itself once on mount when that key still names it.
                'preselect' => class_exists('WC_Twoinc_Product_Button')
                    && WC_Twoinc_Product_Button::should_preselect_blocks(),
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
