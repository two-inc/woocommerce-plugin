<?php

if (!class_exists('WC_Twoinc_Api_Proxy')) {
    /**
     * Server-side proxy for the checkout API calls the browser used to issue
     * against the API host directly, so the merchant's custom request
     * headers can travel without reaching the page.
     */
    class WC_Twoinc_Api_Proxy
    {
        /** @return WC_Twoinc|null Null when the request was already refused. */
        private static function authorize(string $handler, string $route)
        {
            if (!check_ajax_referer('twoinc_checkout', 'csrf_token', false)) {
                self::log_refusal($handler, 'invalid or expired checkout security token');
                wp_send_json_error('Invalid security token');
                return null;
            }
            if (!WC_Twoinc_Rate_Limiter::check($route)) {
                return null;
            }
            $gateway = WC_Twoinc::get_instance();
            if (!$gateway) {
                self::log_refusal($handler, 'gateway instance unavailable');
                wp_send_json_error('Gateway unavailable');
                return null;
            }
            return $gateway;
        }

        private static function log_refusal(string $handler, string $reason): void
        {
            if (function_exists('wc_get_logger')) {
                wc_get_logger()->warning(
                    sprintf('API proxy %s refused: %s', $handler, $reason),
                    ['source' => 'twoinc-payment-gateway']
                );
            }
        }

        private static function req(string $key): string
        {
            return isset($_REQUEST[$key]) ? sanitize_text_field(wp_unslash($_REQUEST[$key])) : '';
        }

        /** Unenveloped: the browser handlers parse the API's own response shape. */
        private static function relay($response): void
        {
            if (is_wp_error($response) || !is_array($response)) {
                wp_send_json_error('Upstream request failed', 502);
                return;
            }
            $status = (int) wp_remote_retrieve_response_code($response);
            $decoded = json_decode((string) wp_remote_retrieve_body($response), true);
            // An empty or unparseable body would reach `.done` as literal null,
            // which every handler dereferences.
            wp_send_json(is_array($decoded) ? $decoded : [], $status > 0 ? $status : 502);
        }

        /** wc-ajax handler: company search for the checkout capture panel. */
        public static function ajax_company_search(): void
        {
            $gateway = self::authorize('company search', 'company_search');
            if (!$gateway) {
                return;
            }
            $params = [
                'country' => self::req('country'),
                'limit' => absint(self::req('limit')),
                'offset' => absint(self::req('offset')),
                'q' => self::req('q'),
            ];
            self::relay($gateway->make_request('/companies/v2/company', [], 'GET', $params));
        }

        /**
         * wc-ajax handler: the countries the registry search covers, so the
         * ordinary company-search control can gate itself the same way the
         * sole-trader chip gates on its own per-country registry answer.
         * No request params — the list is global, not per-country.
         */
        public static function ajax_supported_countries(): void
        {
            $gateway = self::authorize('supported search countries', 'supported_countries');
            if (!$gateway) {
                return;
            }
            self::relay($gateway->make_request('/companies/v2/supported-countries', [], 'GET'));
        }

        /** wc-ajax handler: registry address lookup for one company. */
        public static function ajax_company_by_id(): void
        {
            $gateway = self::authorize('company lookup', 'company_by_id');
            if (!$gateway) {
                return;
            }
            $lookup_id = self::req('lookup_id');
            // A path segment, so an unescaped separator would retarget the request.
            if ($lookup_id === '' || strpbrk($lookup_id, '/?#') !== false) {
                self::log_refusal('company lookup', 'lookup id missing or not a single path segment');
                wp_send_json_error('Invalid company id');
                return;
            }
            self::relay($gateway->make_request('/companies/v2/company/' . rawurlencode($lookup_id), [], 'GET'));
        }

        /** wc-ajax handler: the buyer's payment terms for the due-in-days copy. */
        public static function ajax_payment_terms(): void
        {
            $gateway = self::authorize('payment terms lookup', 'payment_terms');
            if (!$gateway) {
                return;
            }
            $params = [
                // Merchant identity is resolved here, never read from the request.
                'merchant_id' => (string) $gateway->get_merchant_id(),
                'merchant_short_name' => (string) $gateway->get_option('merchant_short_name'),
                'buyer_organization_number' => self::req('buyer_organization_number'),
                'country_prefix' => self::req('country_prefix'),
            ];
            self::relay($gateway->make_request('/v1/payment_terms', [], 'GET', $params));
        }

        /** wc-ajax handler: the order intent availability check. */
        public static function ajax_order_intent(): void
        {
            $gateway = self::authorize('order intent', 'order_intent');
            if (!$gateway) {
                return;
            }
            $posted = json_decode(isset($_POST['intent']) ? (string) wp_unslash($_POST['intent']) : '', true);
            if (!is_array($posted)) {
                self::log_refusal('order intent', 'request carried no decodable intent body');
                wp_send_json_error('Invalid order intent payload');
                return;
            }
            $company = $posted['buyer']['company'] ?? null;
            $buyer_country = is_array($company) && isset($company['country_prefix'])
                ? (string) $company['country_prefix']
                : '';
            if (!$gateway->is_buyer_country_supported($buyer_country)) {
                $gateway->log_buyer_country_rejection('order intent', $buyer_country);
                wp_send_json_error('Buyer country not supported');
                return;
            }
            // The session follows a term chip a round trip late, and the cart's surcharge fee reads it.
            $term = (int) ($_POST[WC_Twoinc_Payment_Terms::SESSION_KEY] ?? 0);
            if ($term > 0 && in_array($term, WC_Twoinc_Payment_Terms::get_available_terms($gateway), true)) {
                WC_Twoinc_Payment_Terms::set_selected_term($gateway, $term);
            }
            // 5xx, not a 200 error: the browser reads a 200 as a decline and caches it (TWO-25657).
            try {
                $order = WC_Twoinc_Helper::build_intent_order_from_cart();
                if (!$order) {
                    self::log_refusal('order intent', 'no cart to compose the intent from');
                    wp_send_json_error('Invalid order intent payload', 500);
                    return;
                }
                // Only the buyer comes from the browser: the relay spends the merchant's API key.
                $buyer = is_array($posted['buyer'] ?? null) ? $posted['buyer'] : [];
                $payload = WC_Twoinc_Helper::compose_twoinc_intent($order, $buyer);
                // Merchant identity is resolved here, never read from the request.
                $payload['merchant_id'] = (string) $gateway->get_merchant_id();
                $payload['merchant_short_name'] = (string) $gateway->get_option('merchant_short_name');
                $response = $gateway->make_order_request('order_intent', 'checkout', '/v1/order_intent', $payload, 'POST', $order);
            } catch (Exception $e) {
                self::log_refusal('order intent', $e->getMessage());
                wp_send_json_error('Order intent refused', 500);
                return;
            }
            self::record_verdict($company, $response);
            self::relay($response);
        }

        /** Only an explicit `approved` counts — an error is not a decline (TWO-25657). */
        private static function record_verdict($company, $response): void
        {
            $company_id = is_array($company) && isset($company['organization_number'])
                ? (string) $company['organization_number']
                : '';
            if ($company_id === '' || is_wp_error($response) || !is_array($response)) {
                return;
            }
            $body = json_decode((string) wp_remote_retrieve_body($response), true);
            if (is_array($body) && array_key_exists('approved', $body)) {
                WC_Twoinc::record_order_intent_verdict($company_id, (bool) $body['approved']);
            }
        }
    }
}
