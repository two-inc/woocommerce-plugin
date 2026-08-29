<?php

if (!class_exists('WC_Twoinc_Rate_Limiter')) {
    /**
     * Fixed-window request counter for the anonymous wc-ajax endpoints.
     *
     * Every wc_ajax_two_* route is reachable by any checkout visitor holding a
     * page nonce, and each one now spends the merchant's own API key
     * server-side, so unbounded calls are billable against the merchant.
     *
     * The window start is stored alongside the count rather than left to the
     * transient's TTL: object-cache backends may evict or extend a transient
     * independently of its expiry, so the timestamp is what actually bounds
     * the window (the same reason WC_Twoinc_FX stores `fetched_at`).
     */
    class WC_Twoinc_Rate_Limiter
    {
        /**
         * [max requests, window seconds] per wc-ajax route.
         *
         * Sized against each route's real checkout cadence, not its cheapest
         * possible use, so a slow typist or a NAT'd office never sees a
         * refusal.
         *
         * term_fees is the loosest: it rides every `updated_checkout`, so
         * address typing, quantity edits, coupons and shipping changes all
         * fire it. company_search is next, debounced at 300ms per typed word.
         * sole_trader_tokens is the tightest — two upstream POSTs that return
         * write-scoped delegated-authority tokens, gated only by a country
         * check, and its legitimate use is one flow open plus a slow refresh.
         */
        private const LIMITS = [
            'term_fees' => [90, 60],
            'company_search' => [60, 60],
            'select_term' => [60, 60],
            'order_intent' => [30, 60],
            'company_by_id' => [30, 60],
            'payment_terms' => [30, 60],
            'sole_trader_availability' => [30, 60],
            'sole_trader_tokens' => [10, 60],
        ];

        /** Kept off the wire: the key embeds a client address. */
        private const KEY_HASH_ALGO = 'sha256';

        /**
         * Count this request against $route and refuse it if over the limit.
         *
         * Call it after the nonce check, so unauthenticated noise never fills
         * a bucket that a real buyer on the same address is metered by.
         *
         * @return bool False when the caller must stop; the JSON refusal has
         *              already been sent.
         */
        public static function check(string $route): bool
        {
            if (!isset(self::LIMITS[$route])) {
                return true;
            }
            list($max, $window) = self::LIMITS[$route];
            $key = self::transient_key($route);
            $now = time();

            $bucket = get_transient($key);
            if (
                !is_array($bucket)
                || !isset($bucket['start'], $bucket['count'])
                || ($now - (int) $bucket['start']) >= $window
            ) {
                $bucket = ['start' => $now, 'count' => 0];
            }
            $bucket['count'] = (int) $bucket['count'] + 1;

            // Written before the verdict so a refused request still counts:
            // otherwise an abuser parked on the limit would be metered only
            // by the requests that succeed.
            $elapsed = $now - (int) $bucket['start'];
            set_transient($key, $bucket, max(1, $window - $elapsed));

            if ($bucket['count'] > $max) {
                self::log_refusal($route, $max, $window);
                self::send_refusal($window - $elapsed);
                return false;
            }
            return true;
        }

        /**
         * 429 with Retry-After, so a legitimate client that trips the limit
         * backs off instead of retrying into it.
         */
        private static function send_refusal(int $retry_after): void
        {
            $retry_after = max(1, $retry_after);
            if (!headers_sent()) {
                header('Retry-After: ' . $retry_after);
            }
            wp_send_json_error('Too many requests', 429);
        }

        private static function log_refusal(string $route, int $max, int $window): void
        {
            if (function_exists('wc_get_logger')) {
                wc_get_logger()->warning(
                    sprintf(
                        'Rate limit hit on %s: more than %d requests in %ds from one client',
                        $route,
                        $max,
                        $window
                    ),
                    ['source' => 'twoinc-payment-gateway']
                );
            }
        }

        /**
         * Bucket key for one client on one route.
         *
         * Anchored on the client address rather than the session or nonce:
         * both of those are cookie- or page-scoped, so an abuser rotates them
         * by re-fetching the checkout page, which costs nothing. An address
         * is the cheapest identifier that is not free to change.
         */
        private static function transient_key(string $route): string
        {
            $hash = substr(hash(self::KEY_HASH_ALGO, self::client_id()), 0, 24);
            // Transient keys cap at 172 chars; route + 24-char hash stays well inside.
            return WC_Twoinc_Brand::prefixed_name('rl_' . $route . '_' . $hash);
        }

        private static function client_id(): string
        {
            if (class_exists('WC_Geolocation')) {
                $ip = (string) WC_Geolocation::get_ip_address();
                if ($ip !== '') {
                    return $ip;
                }
            }
            // Not a trust decision — a spoofed or missing address only ever
            // picks a different bucket, never a larger allowance.
            return isset($_SERVER['REMOTE_ADDR'])
                ? (string) $_SERVER['REMOTE_ADDR']
                : 'unknown';
        }
    }
}
