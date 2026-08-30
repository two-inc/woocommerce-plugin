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
         * [max requests, window seconds] per wc-ajax route, sized so several
         * concurrent checkouts behind one office NAT stay under the limit.
         */
        private const LIMITS = [
            'term_fees' => [300, 60],
            'company_search' => [60, 60],
            'sole_trader_tokens' => [60, 60],
            'order_intent' => [30, 60],
            'company_by_id' => [30, 60],
            'payment_terms' => [30, 60],
            'sole_trader_availability' => [30, 60],
        ];

        /** Kept off the wire: the key embeds a client address. */
        private const KEY_HASH_ALGO = 'sha256';

        /** Window the refusal ledger reports over, long enough to span several route windows. */
        private const LEDGER_WINDOW = 300;

        /** Distinct callers the ledger tracks; past this the shape of the traffic is already decided. */
        private const LEDGER_MAX_CLIENTS = 50;

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
            if (!isset(self::LIMITS[$route]) || !self::is_enabled()) {
                return true;
            }
            list($max, $window) = self::LIMITS[$route];
            $client = self::client_id();
            $key = self::transient_key($route, $client);
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
            //
            // Row count is bounded by distinct peer addresses seen in one
            // window (one row per address per route), reaped by WP's daily
            // delete_expired_transients.
            $elapsed = $now - (int) $bucket['start'];
            set_transient($key, $bucket, max(1, $window - $elapsed));

            if ($bucket['count'] > $max) {
                self::log_refusal($route, $max, $window, self::record_refusal($client, $now));
                self::send_refusal($window - $elapsed);
                return false;
            }
            return true;
        }

        /** Diagnostics escape hatch for a merchant whose topology collapses every buyer into one bucket. */
        private static function is_enabled(): bool
        {
            return self::setting('rate_limiting_enabled', 'yes') !== 'no';
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

        private static function log_refusal(string $route, int $max, int $window, string $spread): void
        {
            if (function_exists('wc_get_logger')) {
                wc_get_logger()->warning(
                    sprintf(
                        'Rate limit hit on %s: more than %d requests in %ds from one client. %s',
                        $route,
                        $max,
                        $window,
                        $spread
                    ),
                    ['source' => 'twoinc-payment-gateway']
                );
            }
        }

        /**
         * Count this refusal against the caller and describe how recent
         * refusals are spread, so the log tells one abusive address apart from
         * a shop whose buyers all arrive on one proxy address.
         *
         * @return string Human-readable spread, for the log line.
         */
        private static function record_refusal(string $client, int $now): string
        {
            $key = WC_Twoinc_Brand::prefixed_name('rl_refusals');
            $ledger = get_transient($key);
            if (
                !is_array($ledger)
                || !isset($ledger['start'], $ledger['clients'])
                || !is_array($ledger['clients'])
                || ($now - (int) $ledger['start']) >= self::LEDGER_WINDOW
            ) {
                $ledger = ['start' => $now, 'clients' => []];
            }

            $hash = self::client_hash($client);
            if (isset($ledger['clients'][$hash]) || count($ledger['clients']) < self::LEDGER_MAX_CLIENTS) {
                $ledger['clients'][$hash] = (int) ($ledger['clients'][$hash] ?? 0) + 1;
            }
            $elapsed = $now - (int) $ledger['start'];
            set_transient($key, $ledger, max(1, self::LEDGER_WINDOW - $elapsed));

            $counts = $ledger['clients'];
            $total = array_sum($counts);
            $distinct = count($counts);
            $top = $total > 0 ? max($counts) : 0;
            $share = $total > 0 ? (int) round(100 * $top / $total) : 0;
            $capped = $distinct >= self::LEDGER_MAX_CLIENTS ? '+' : '';

            return sprintf(
                '%d refusals in the last %ds from %s; the busiest is %d%% of them (this caller: %d). %s',
                $total,
                self::LEDGER_WINDOW,
                $distinct === 1 ? '1 client address' : $distinct . $capped . ' distinct client addresses',
                $share,
                (int) ($counts[$hash] ?? 0),
                $distinct === 1
                    ? 'One address accounts for all of it: either a single abusive caller, or every buyer'
                        . ' arriving on one reverse proxy or CDN address - if the latter, list that proxy under'
                        . ' Trusted proxy addresses in the plugin Diagnostics settings.'
                    : 'Spread across several addresses, so this looks like real traffic rather than one caller.'
            );
        }

        /** Bucket key for one client on one route, keyed on the client address rather than the rotatable session or nonce. */
        private static function transient_key(string $route, string $client): string
        {
            // Transient keys cap at 172 chars; route + 24-char hash stays well inside.
            return WC_Twoinc_Brand::prefixed_name('rl_' . $route . '_' . self::client_hash($client));
        }

        private static function client_hash(string $client): string
        {
            return substr(hash(self::KEY_HASH_ALGO, $client), 0, 24);
        }

        /**
         * The address the limit is metered against.
         *
         * The socket peer by default: WC_Geolocation::get_ip_address() prefers
         * X-Real-IP / X-Forwarded-For with no trusted-proxy allowlist, so a
         * rotating header would mint a fresh bucket per request and the
         * allowance would be unbounded. A forwarded address is believed only
         * when the peer we are actually talking to is one the merchant listed
         * as a trusted proxy.
         */
        private static function client_id(): string
        {
            $peer = isset($_SERVER['REMOTE_ADDR']) ? trim((string) $_SERVER['REMOTE_ADDR']) : '';
            if ($peer === '') {
                return 'unknown';
            }

            $trusted = self::trusted_proxies();
            if (!$trusted || !self::matches_any($peer, $trusted)) {
                return $peer;
            }

            $forwarded = isset($_SERVER['HTTP_X_FORWARDED_FOR'])
                ? (string) $_SERVER['HTTP_X_FORWARDED_FOR']
                : '';
            foreach (array_reverse(explode(',', $forwarded)) as $hop) {
                $hop = self::normalise_address(trim($hop));
                // Rightmost hop that is not itself a trusted proxy: everything
                // further left was written by a proxy we do not trust, so the
                // client could have chosen it.
                if ($hop !== '' && !self::matches_any($hop, $trusted)) {
                    return $hop;
                }
            }
            return $peer;
        }

        /** @return string[] Trusted proxy addresses or CIDR blocks, as configured. */
        private static function trusted_proxies(): array
        {
            $raw = self::setting('trusted_proxies', '');
            $out = [];
            foreach (preg_split('/[\s,]+/', $raw) ?: [] as $entry) {
                $entry = trim($entry);
                if ($entry !== '') {
                    $out[] = $entry;
                }
            }
            return $out;
        }

        /** @param string[] $ranges */
        private static function matches_any(string $address, array $ranges): bool
        {
            $packed = @inet_pton($address);
            if ($packed === false) {
                return false;
            }
            foreach ($ranges as $range) {
                if (self::in_range($packed, $range)) {
                    return true;
                }
            }
            return false;
        }

        /** @param string $packed inet_pton output for the address under test. */
        private static function in_range(string $packed, string $range): bool
        {
            $bits = null;
            if (strpos($range, '/') !== false) {
                list($range, $bits) = explode('/', $range, 2);
                $bits = (int) $bits;
            }
            $net = @inet_pton(trim($range));
            if ($net === false || strlen($net) !== strlen($packed)) {
                return false;
            }
            $width = strlen($net) * 8;
            if ($bits === null) {
                $bits = $width;
            }
            if ($bits < 0 || $bits > $width) {
                return false;
            }

            $whole = intdiv($bits, 8);
            if ($whole > 0 && strncmp($packed, $net, $whole) !== 0) {
                return false;
            }
            $remainder = $bits % 8;
            if ($remainder === 0) {
                return true;
            }
            $mask = ~((1 << (8 - $remainder)) - 1) & 0xFF;
            return (ord($packed[$whole]) & $mask) === (ord($net[$whole]) & $mask);
        }

        /** IPv4-mapped IPv6 forms reach us from dual-stack proxies; compare them as the IPv4 address. */
        private static function normalise_address(string $address): string
        {
            // A forwarded hop may carry a port, and IPv6 hops are bracketed.
            if (preg_match('/^\[(.+)\](?::\d+)?$/', $address, $m)) {
                $address = $m[1];
            } elseif (substr_count($address, ':') === 1 && strpos($address, '.') !== false) {
                $address = substr($address, 0, strpos($address, ':'));
            }
            if (stripos($address, '::ffff:') === 0 && strpos($address, '.') !== false) {
                $address = substr($address, 7);
            }
            return $address;
        }

        private static function setting(string $key, string $default): string
        {
            $settings = get_option('woocommerce_' . WC_Twoinc_Brand::get('gateway_id') . '_settings', []);
            if (!is_array($settings) || !isset($settings[$key]) || !is_scalar($settings[$key])) {
                return $default;
            }
            return trim((string) $settings[$key]);
        }
    }
}
