<?php

/**
 * Payment terms chip selector + offset pricing fee — business logic (TWO-24751).
 *
 * All term/fee decisioning lives here; assets/js/twoinc.js only renders what
 * these methods return (the Gutenberg block checkout port must not need a
 * business-logic rewrite, see TWO-24767).
 *
 * Term availability: `get_available_terms()` is the single seam. Today it
 * resolves brand config (`available_terms`) intersected with the merchant's
 * admin subset; when the backend grows a term-availability surface (planned
 * convergence — backend owns which terms are offered) only this method
 * changes. Do not read term lists anywhere else.
 *
 * Fee arithmetic is never done plugin-side: the offset settings are posted to
 * POST /v1/pricing/order/fee as a `buyer_fee_share` block and the backend
 * computes the buyer's share (mirrors Magento's SurchargeCalculator).
 */

if (!class_exists('WC_Twoinc_Payment_Terms')) {
    class WC_Twoinc_Payment_Terms
    {
        public const SESSION_KEY = 'two_selected_term';

        /**
         * Stored surcharge-rounding basis → pricing-API basis. "none" (and
         * any unmapped value) omits the rounding block. Mirrors Magento's
         * SurchargeCalculator::ROUNDING_BASIS_TO_API.
         */
        private const ROUNDING_BASIS_TO_API = [
            'up' => 'UP',
            'down' => 'DOWN',
            'standard' => 'STANDARD',
        ];

        /** @var array<int, array|null> request-scoped fee quote cache, keyed by term days */
        private static $fee_cache = [];

        /**
         * Whether the chip selector is active: merchant enabled it and the
         * resolved term set is non-empty.
         */
        public static function is_enabled($gateway): bool
        {
            return $gateway->get_option('enable_payment_terms') === 'yes'
                && count(self::get_available_terms($gateway)) > 0;
        }

        /**
         * The terms offered at checkout, ascending. THE availability seam —
         * see the file header before adding another term-list read.
         *
         * @return int[]
         */
        public static function get_available_terms($gateway): array
        {
            $brand_terms = WC_Twoinc_Brand::get('available_terms');
            if (!is_array($brand_terms) || count($brand_terms) === 0) {
                return [];
            }
            $brand_terms = array_map('intval', $brand_terms);

            $admin_subset = $gateway->get_option('payment_terms_days');
            if (is_array($admin_subset) && count($admin_subset) > 0) {
                $admin_subset = array_map('intval', $admin_subset);
                $terms = array_values(array_intersect($brand_terms, $admin_subset));
            } else {
                $terms = $brand_terms;
            }

            $terms = array_values(array_unique(array_filter($terms, static function ($days) {
                return $days > 0;
            })));
            sort($terms);
            return $terms;
        }

        /**
         * The pre-selected term: the merchant's configured default when it is
         * in the available set, else the shortest available term.
         */
        public static function get_default_term($gateway): ?int
        {
            $terms = self::get_available_terms($gateway);
            if (count($terms) === 0) {
                return null;
            }
            $configured = (int) $gateway->get_option('default_payment_term');
            return in_array($configured, $terms, true) ? $configured : $terms[0];
        }

        /**
         * The buyer's current selection from the WC session, validated against
         * the available set (an invalid or stale selection falls back to the
         * default rather than erroring).
         */
        public static function get_selected_term($gateway): ?int
        {
            $terms = self::get_available_terms($gateway);
            if (count($terms) === 0) {
                return null;
            }
            $session = function_exists('WC') ? (WC()->session ?? null) : null;
            $selected = $session ? (int) $session->get(self::SESSION_KEY) : 0;
            return in_array($selected, $terms, true) ? $selected : self::get_default_term($gateway);
        }

        /**
         * Store the buyer's selection. Returns the term actually stored
         * (invalid input resolves to the default).
         */
        public static function set_selected_term($gateway, $days): ?int
        {
            $terms = self::get_available_terms($gateway);
            $days = (int) $days;
            if (!in_array($days, $terms, true)) {
                $days = self::get_default_term($gateway);
            }
            if (function_exists('WC') && (WC()->session ?? null)) {
                WC()->session->set(self::SESSION_KEY, $days);
            }
            return $days;
        }

        /**
         * Offset pricing settings resolved from gateway options.
         *
         * @return array{enabled: bool, percentage: string, reference_days: int|null, rounding_basis: string, rounding_step: float|null}
         */
        public static function get_offset_settings($gateway): array
        {
            $reference_days = (int) $gateway->get_option('offset_pricing_reference_days');
            $percentage = trim((string) $gateway->get_option('offset_pricing_percentage'));
            if ($percentage === '' || !is_numeric($percentage) || (float) $percentage < 0 || (float) $percentage > 100) {
                $percentage = '100';
            }
            $rounding_step = (float) $gateway->get_option('surcharge_rounding_step');
            return [
                'enabled' => $gateway->get_option('enable_offset_pricing') === 'yes',
                'percentage' => $percentage,
                'reference_days' => $reference_days > 0 ? $reference_days : null,
                'rounding_basis' => (string) $gateway->get_option('surcharge_rounding_basis'),
                'rounding_step' => $rounding_step > 0 ? $rounding_step : null,
            ];
        }

        /**
         * The buyer_fee_share block for POST /v1/pricing/order/fee. The
         * backend computes the fee from this; the plugin does no arithmetic.
         * With reference terms configured the backend prices the increment
         * over the baseline term; without them, plain pass-through.
         *
         * @return array|null null when offset pricing is disabled
         */
        public static function build_buyer_fee_share($gateway): ?array
        {
            $settings = self::get_offset_settings($gateway);
            if (!$settings['enabled']) {
                return null;
            }
            $buyer_fee_share = ['percentage' => $settings['percentage']];
            if ($settings['reference_days'] !== null) {
                $buyer_fee_share['reference_terms'] = [
                    'type' => 'NET_TERMS',
                    'duration_days' => $settings['reference_days'],
                ];
            }
            $rounding = self::build_rounding($settings);
            if ($rounding !== null) {
                $buyer_fee_share['rounding'] = $rounding;
            }
            return $buyer_fee_share;
        }

        /**
         * The rounding block for buyer_fee_share, or null when rounding is
         * off. The backend does the arithmetic; the plugin only relays
         * {step, basis}. A None/unmapped basis or a non-positive step omits
         * the block (the API requires both keys and rejects step <= 0).
         * Mirrors Magento's SurchargeCalculator::buildRounding.
         *
         * @param array{rounding_basis: string, rounding_step: float|null} $settings
         * @return array{step: float, basis: string}|null
         */
        private static function build_rounding(array $settings): ?array
        {
            $basis = $settings['rounding_basis'];
            if (!isset(self::ROUNDING_BASIS_TO_API[$basis]) || $settings['rounding_step'] === null) {
                return null;
            }
            return [
                'step' => $settings['rounding_step'],
                'basis' => self::ROUNDING_BASIS_TO_API[$basis],
            ];
        }

        /**
         * Quote the buyer's fee share for one term via the pricing endpoint.
         * Fail-soft: returns null on any error (chip renders without a fee
         * label; checkout is never blocked on a quote).
         *
         * @return array{buyer_fee_share: string, total_fee_tax_rate: string|null, currency: string}|null
         */
        public static function fetch_term_fee($gateway, int $days, float $gross_amount, string $buyer_country): ?array
        {
            if (array_key_exists($days, self::$fee_cache)) {
                return self::$fee_cache[$days];
            }

            $buyer_fee_share = self::build_buyer_fee_share($gateway);
            if ($buyer_fee_share === null || $gross_amount <= 0) {
                return self::$fee_cache[$days] = null;
            }

            $response = $gateway->make_request('/v1/pricing/order/fee', [
                'currency' => get_woocommerce_currency(),
                'gross_amount' => strval(WC_Twoinc_Helper::round_amt($gross_amount)),
                'buyer_country_code' => $buyer_country,
                'order_terms' => [
                    'type' => 'NET_TERMS',
                    'duration_days' => $days,
                ],
                'buyer_fee_share' => $buyer_fee_share,
            ]);

            if (is_wp_error($response)) {
                return self::$fee_cache[$days] = null;
            }
            $body = json_decode($response['body'] ?? '', true);
            if (!is_array($body) || !isset($body['buyer_fee_share'])) {
                return self::$fee_cache[$days] = null;
            }

            return self::$fee_cache[$days] = [
                'buyer_fee_share' => strval($body['buyer_fee_share']),
                'total_fee_tax_rate' => isset($body['total_fee_tax_rate']) ? strval($body['total_fee_tax_rate']) : null,
                'currency' => strval($body['currency'] ?? get_woocommerce_currency()),
            ];
        }

        /**
         * Quote all available terms for the chip labels.
         *
         * @return array<int, array|null> keyed by term days
         */
        public static function fetch_term_fees($gateway, float $gross_amount, string $buyer_country): array
        {
            $fees = [];
            foreach (self::get_available_terms($gateway) as $days) {
                $fees[$days] = self::fetch_term_fee($gateway, $days, $gross_amount, $buyer_country);
            }
            return $fees;
        }

        /**
         * The fee-quote basis: the cart's value excluding any fee this class
         * added (the platform-rate-converted/priced fee enters the basket at
         * the pricing endpoint's output and must not feed back into its own
         * basis).
         */
        public static function get_fee_basis($cart): float
        {
            return (float) $cart->get_cart_contents_total()
                + (float) $cart->get_cart_contents_tax()
                + (float) $cart->get_shipping_total()
                + (float) $cart->get_shipping_tax();
        }

        /**
         * woocommerce_cart_calculate_fees hook: charge the buyer's fee share
         * for the selected term as a WC cart fee. The amount from the pricing
         * endpoint is net; WC applies the store's tax handling to the fee so
         * the order's internal net + tax = gross consistency holds (the same
         * posture as Magento's store-configured surcharge tax rate).
         */
        public static function apply_cart_fee($cart): void
        {
            $gateway = WC_Twoinc::get_instance();
            if (!$gateway || !self::is_enabled($gateway)) {
                return;
            }
            $settings = self::get_offset_settings($gateway);
            if (!$settings['enabled']) {
                return;
            }
            // Only charge when paying with this gateway
            $chosen = function_exists('WC') && (WC()->session ?? null) ? WC()->session->get('chosen_payment_method') : null;
            if ($chosen && $chosen !== $gateway->id) {
                return;
            }

            $selected = self::get_selected_term($gateway);
            if ($selected === null) {
                return;
            }

            $customer = function_exists('WC') ? (WC()->customer ?? null) : null;
            $buyer_country = $customer ? $customer->get_billing_country() : '';
            $fee = self::fetch_term_fee($gateway, $selected, self::get_fee_basis($cart), $buyer_country);
            if ($fee === null || (float) $fee['buyer_fee_share'] <= 0) {
                return;
            }

            $cart->add_fee(self::get_fee_label(), (float) $fee['buyer_fee_share'], true);
        }

        /**
         * Buyer-facing label for the fee line, brand-overridable.
         */
        public static function get_fee_label(): string
        {
            $label = WC_Twoinc_Brand::get('fee_line_label');
            return $label ?: __('Service charge', 'twoinc-payment-gateway');
        }

        /**
         * wc-ajax handler: per-term fee quotes for the chip labels.
         */
        public static function ajax_term_fees(): void
        {
            $gateway = WC_Twoinc::get_instance();
            if (!$gateway || !self::is_enabled($gateway)) {
                wp_send_json_error('Payment terms are not enabled');
                return;
            }
            $cart = function_exists('WC') ? (WC()->cart ?? null) : null;
            $customer = function_exists('WC') ? (WC()->customer ?? null) : null;
            $basis = $cart ? self::get_fee_basis($cart) : 0.0;
            $buyer_country = $customer ? $customer->get_billing_country() : '';

            wp_send_json_success([
                'terms' => self::get_available_terms($gateway),
                'selected' => self::get_selected_term($gateway),
                'fees' => self::fetch_term_fees($gateway, $basis, $buyer_country),
            ]);
        }

        /**
         * wc-ajax handler: persist the buyer's term selection in the session.
         */
        public static function ajax_select_term(): void
        {
            $gateway = WC_Twoinc::get_instance();
            if (!$gateway || !self::is_enabled($gateway)) {
                wp_send_json_error('Payment terms are not enabled');
                return;
            }
            $days = isset($_POST['days']) ? (int) $_POST['days'] : 0;
            $stored = self::set_selected_term($gateway, $days);
            wp_send_json_success(['selected' => $stored]);
        }

        /**
         * The terms block injected into the order create payload: the
         * buyer's selected term plus the offered set (the backend records
         * available_terms for parity with Magento's payload).
         *
         * @return array{terms: array, available_terms: int[]}|null
         */
        public static function get_order_payload_terms($gateway, $order): ?array
        {
            if (!self::is_enabled($gateway)) {
                return null;
            }
            // The selection posts with the checkout form (hidden field kept in
            // sync by JS) so order-pay-page submissions work without a session.
            $posted = isset($_POST[self::SESSION_KEY]) ? (int) $_POST[self::SESSION_KEY] : 0;
            $terms = self::get_available_terms($gateway);
            $selected = in_array($posted, $terms, true) ? $posted : self::get_selected_term($gateway);
            if ($selected === null) {
                return null;
            }
            return [
                'terms' => ['type' => 'NET_TERMS', 'duration_days' => $selected],
                'available_terms' => $terms,
            ];
        }

        /**
         * Reset the request-scoped fee cache (tests).
         */
        public static function reset_fee_cache(): void
        {
            self::$fee_cache = [];
        }
    }
}
