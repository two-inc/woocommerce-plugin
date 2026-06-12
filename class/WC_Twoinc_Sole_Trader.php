<?php

/**
 * Sole trader checkout support — business logic (TWO-24754).
 *
 * All decisioning lives here; assets/js/twoinc.js only renders what these
 * methods return (the Gutenberg block checkout port must not need a
 * business-logic rewrite, see TWO-24767).
 *
 * Two gates decide whether the Sole Trader option shows for a billing
 * country, and both must pass:
 *  - country-level legal truth from the registry endpoint
 *    GET /registry/v1/supported-company-types/<ISO> (TWO-24753), and
 *  - the merchant's `enable_sole_trader` admin toggle.
 *
 * The flow mirrors the Magento reference (gateway_method.js): the buyer
 * switches to sole-trader mode, the plugin server-side mints two delegated
 * authority tokens with the merchant API key, the buyer registers or logs in
 * through Two's hosted signup popup, and the checkout autofills the company
 * fields from GET /autofill/v1/buyer/current. No sole-trader-specific fields
 * are collected at checkout and the order payload is unchanged — an enrolled
 * sole trader's organization number (TWO:ST…) carries the semantics and the
 * backend derives the company type from it (TWO-24749 spike).
 */

if (!class_exists('WC_Twoinc_Sole_Trader')) {
    class WC_Twoinc_Sole_Trader
    {
        public const REGISTERED_BUSINESS = 'REGISTERED_BUSINESS';
        public const SOLE_TRADER = 'SOLE_TRADER';

        /** WC session key prefix; full key is prefix + ISO country code. */
        public const SESSION_KEY_PREFIX = 'two_company_types_';

        /** Matches the registry endpoint's Cache-Control max-age. */
        public const CACHE_TTL_SECONDS = 3600;

        /** @var array<string, string[]> request-scoped cache, keyed by country */
        private static $types_cache = [];

        /**
         * Whether the merchant has opted into offering sole trader checkout.
         */
        public static function is_enabled($gateway): bool
        {
            return $gateway->get_option('enable_sole_trader') === 'yes';
        }

        /**
         * The buyer company types Two supports for a billing country, from
         * GET /registry/v1/supported-company-types/<ISO>. Cached per session
         * for the endpoint's own max-age. Fail-soft: any error (network,
         * non-200, malformed body) resolves to registered-business only —
         * checkout never blocks, the sole trader option just doesn't show.
         *
         * @return string[]
         */
        public static function get_supported_company_types($gateway, string $country): array
        {
            $country = strtoupper(trim($country));
            if (!preg_match('/^[A-Z]{2}$/', $country)) {
                return [self::REGISTERED_BUSINESS];
            }

            if (array_key_exists($country, self::$types_cache)) {
                return self::$types_cache[$country];
            }

            $session = function_exists('WC') ? (WC()->session ?? null) : null;
            if ($session) {
                $cached = $session->get(self::SESSION_KEY_PREFIX . $country);
                if (
                    is_array($cached)
                    && isset($cached['types'], $cached['fetched_at'])
                    && is_array($cached['types'])
                    && time() - (int) $cached['fetched_at'] < self::CACHE_TTL_SECONDS
                ) {
                    return self::$types_cache[$country] = $cached['types'];
                }
            }

            $types = self::fetch_supported_company_types($gateway, $country);

            if ($session) {
                $session->set(self::SESSION_KEY_PREFIX . $country, [
                    'types' => $types,
                    'fetched_at' => time(),
                ]);
            }
            return self::$types_cache[$country] = $types;
        }

        /**
         * Uncached registry call. @see get_supported_company_types()
         *
         * @return string[]
         */
        private static function fetch_supported_company_types($gateway, string $country): array
        {
            $response = $gateway->make_request("/registry/v1/supported-company-types/{$country}", [], 'GET');
            if (is_wp_error($response) || wp_remote_retrieve_response_code($response) !== 200) {
                return [self::REGISTERED_BUSINESS];
            }
            $body = json_decode(wp_remote_retrieve_body($response), true);
            if (!is_array($body) || !isset($body['supported_company_types']) || !is_array($body['supported_company_types'])) {
                return [self::REGISTERED_BUSINESS];
            }
            $types = array_values(array_filter($body['supported_company_types'], 'is_string'));
            return count($types) > 0 ? $types : [self::REGISTERED_BUSINESS];
        }

        /**
         * Whether the Sole Trader option should be offered for a billing
         * country: merchant toggle on AND the country legally supports it.
         */
        public static function is_available($gateway, string $country): bool
        {
            return self::is_enabled($gateway)
                && in_array(self::SOLE_TRADER, self::get_supported_company_types($gateway, $country), true);
        }

        /**
         * Mint the two delegated-authority tokens the sole-trader flow needs,
         * server-side with the merchant API key (the key never reaches the
         * browser). The Two API returns each token in the
         * `two-delegated-authority-token` response HEADER, not the body.
         *
         * @return array{delegation_token: string, autofill_token: string}|null
         */
        public static function mint_tokens($gateway): ?array
        {
            $delegation_token = self::mint_token($gateway, '/registry/v1/delegation', [
                'create_proposal' => true,
                'read_current_business' => true,
            ]);
            $autofill_token = self::mint_token($gateway, '/autofill/v1/delegation', [
                'read_current_buyer' => true,
                'write_current_buyer' => true,
            ]);
            if ($delegation_token === null || $autofill_token === null) {
                return null;
            }
            return [
                'delegation_token' => $delegation_token,
                'autofill_token' => $autofill_token,
            ];
        }

        private static function mint_token($gateway, string $endpoint, array $payload): ?string
        {
            $response = $gateway->make_request($endpoint, $payload);
            if (is_wp_error($response) || wp_remote_retrieve_response_code($response) >= 300) {
                return null;
            }
            $token = wp_remote_retrieve_header($response, 'two-delegated-authority-token');
            return is_string($token) && $token !== '' ? $token : null;
        }

        /**
         * Base URL of Two's hosted sole-trader signup page (the checkout-page
         * app, not the API). Brand overlays adjust via the
         * `twoinc_sole_trader_signup_url` filter (e.g. appending brand params).
         */
        public static function get_signup_page_url($gateway): string
        {
            if ($gateway->get_option('checkout_env') === 'SANDBOX') {
                $url = 'https://checkout.sandbox.two.inc/soletrader/signup';
            } else {
                $url = 'https://checkout.two.inc/soletrader/signup';
            }
            return apply_filters('twoinc_sole_trader_signup_url', $url);
        }

        /**
         * wc-ajax handler: whether the sole trader option applies for a
         * billing country. JS re-queries this when the billing country
         * changes; the answer combines both gates server-side.
         */
        public static function ajax_availability(): void
        {
            $gateway = WC_Twoinc::get_instance();
            if (!$gateway) {
                wp_send_json_error('Gateway unavailable');
                return;
            }
            $country = isset($_REQUEST['country']) ? sanitize_text_field(wp_unslash($_REQUEST['country'])) : '';
            wp_send_json_success([
                'available' => self::is_available($gateway, $country),
            ]);
        }

        /**
         * wc-ajax handler: mint the delegation + autofill tokens for the
         * sole-trader flow and hand the browser everything it needs to open
         * the hosted signup popup and autofill the buyer.
         */
        public static function ajax_tokens(): void
        {
            $gateway = WC_Twoinc::get_instance();
            if (!$gateway || !self::is_enabled($gateway)) {
                wp_send_json_error('Sole trader checkout is not enabled');
                return;
            }
            $tokens = self::mint_tokens($gateway);
            if ($tokens === null) {
                wp_send_json_error('Could not initialise the sole trader flow');
                return;
            }
            wp_send_json_success([
                'delegation_token' => $tokens['delegation_token'],
                'autofill_token' => $tokens['autofill_token'],
                'signup_url' => self::get_signup_page_url($gateway),
            ]);
        }

        /**
         * Test seam: clear the request-scoped types cache.
         */
        public static function reset_cache(): void
        {
            self::$types_cache = [];
        }
    }
}
