<?php

if (!class_exists('WC_Twoinc_Api_Proxy')) {
    /**
     * Server-side proxy for the checkout API calls the browser used to issue
     * against the API host directly.
     *
     * Routing them through WC_Twoinc::make_request() is what lets a merchant's
     * firewall token travel as X-WAF-TOKEN without the token reaching the page.
     *
     * GET /autofill/v1/buyer/current is deliberately NOT proxied here: its
     * delegation scope is read_current_buyer, and the subject is whoever holds
     * the API-domain cookie the hosted signup popup sets. A server-side hop
     * carries no such cookie, so proxying it would resolve no buyer at all.
     */
    class WC_Twoinc_Api_Proxy
    {
        /**
         * Nonce check plus gateway resolution, shared by every handler.
         *
         * @return WC_Twoinc|null Null when the request was already refused.
         */
        private static function authorize(string $handler)
        {
            if (!check_ajax_referer('twoinc_checkout', 'nonce', false)) {
                self::log_refusal($handler, 'invalid or expired checkout nonce');
                wp_send_json_error('Invalid nonce');
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

        /**
         * Hand the upstream JSON body and status to the browser unchanged.
         *
         * Not wp_send_json_success()'s {success, data} envelope: these are
         * pass-through proxies and the browser handlers parse the API's own
         * response shape.
         */
        private static function relay($response): void
        {
            if (is_wp_error($response) || !is_array($response)) {
                wp_send_json_error('Upstream request failed', 502);
                return;
            }
            $status = (int) wp_remote_retrieve_response_code($response);
            $decoded = json_decode((string) wp_remote_retrieve_body($response), true);
            wp_send_json($decoded, $status > 0 ? $status : 502);
        }

        /**
         * wc-ajax handler: company search for the checkout capture panel.
         */
        public static function ajax_company_search(): void
        {
            $gateway = self::authorize('company search');
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
         * wc-ajax handler: registry address lookup for one company.
         */
        public static function ajax_company_by_id(): void
        {
            $gateway = self::authorize('company lookup');
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

        /**
         * wc-ajax handler: the buyer's payment terms for the due-in-days copy.
         */
        public static function ajax_payment_terms(): void
        {
            $gateway = self::authorize('payment terms lookup');
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

        /**
         * wc-ajax handler: the order intent availability check.
         */
        public static function ajax_order_intent(): void
        {
            $gateway = self::authorize('order intent');
            if (!$gateway) {
                return;
            }
            // Assembled from the checkout form, as it was when the browser posted
            // it upstream itself — proxying relocates the call, not the trust.
            $payload = json_decode(isset($_POST['intent']) ? (string) wp_unslash($_POST['intent']) : '', true);
            if (!is_array($payload)) {
                self::log_refusal('order intent', 'request carried no decodable intent body');
                wp_send_json_error('Invalid order intent payload');
                return;
            }
            self::relay($gateway->make_request('/v1/order_intent', $payload, 'POST'));
        }
    }
}
