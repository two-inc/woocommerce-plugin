<?php

if (!class_exists('WC_Twoinc_Rate_Limiter')) {
    /**
     * Fixed-window request counter for the anonymous wc-ajax endpoints, each
     * of which spends the merchant's own API key server-side.
     *
     * The window start is stored alongside the count rather than left to the
     * transient's TTL: object-cache backends may evict or extend a transient
     * independently of its expiry, so the timestamp is what actually bounds
     * the window (the same reason WC_Twoinc_FX stores `fetched_at`).
     */
    class WC_Twoinc_Rate_Limiter
    {
        /** [max requests, window seconds] per route, sized so several concurrent checkouts behind one office NAT fit. */
        private const LIMITS = [
            'term_fees' => [300, 60],
            'company_search' => [60, 60],
            'sole_trader_tokens' => [60, 60],
            'order_intent' => [30, 60],
            'company_by_id' => [30, 60],
            'payment_terms' => [30, 60],
            'sole_trader_availability' => [30, 60],
            // Fetched once per page load, not per keystroke — a low ceiling.
            'supported_countries' => [20, 60],
        ];

        /** Kept off the wire: the key embeds a client address. */
        private const KEY_HASH_ALGO = 'sha256';

        /** Window the refusal ledger reports over, long enough to span several route windows. */
        private const LEDGER_WINDOW = 300;

        /** Distinct callers the ledger tracks; past this the shape of the traffic is already decided. */
        private const LEDGER_MAX_CLIENTS = 50;

        /** Trips needed before the log commits to a one-caller or many-callers reading. */
        private const LEDGER_MIN_SAMPLE = 5;

        /** Percentage of trips one address must hold before the log reads it as one caller. */
        private const LEDGER_DOMINANT_SHARE = 80;

        /** Query arg the one-time Diagnostics notice's links carry back; its value picks where the merchant lands. */
        private const NOTICE_ARG = 'twoinc_rate_limit_notice';

        /** How often the log repeats that metering is switched off. */
        private const DISABLED_NOTICE_INTERVAL = 3600;

        /**
         * Call after the security-token check, so unauthenticated noise never fills a
         * bucket a real buyer on the same address is metered by.
         *
         * @return bool False when the caller must stop; the JSON refusal is already sent.
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

            // Written before the verdict so a refused request still counts;
            // otherwise an abuser parked on the limit is metered only by what succeeds.
            $elapsed = $now - (int) $bucket['start'];
            set_transient($key, $bucket, max(1, $window - $elapsed));

            if ($bucket['count'] > $max) {
                // First refusal of the window only: a caller parked on the limit
                // would otherwise cost a log line and two option writes each time.
                if ($bucket['count'] === $max + 1) {
                    self::log_refusal($route, $max, $window, self::record_refusal($client, $now));
                }
                self::send_refusal($window - $elapsed);
                return false;
            }
            return true;
        }

        /** Diagnostics escape hatch for a merchant whose topology collapses every buyer into one bucket. */
        private static function is_enabled(): bool
        {
            if (self::setting('disable_rate_limiting', 'no') !== 'yes') {
                return true;
            }
            self::log_disabled();
            return false;
        }

        /** Hourly reminder, so the endpoints never run unmetered with nothing recording that they do. */
        private static function log_disabled(): void
        {
            $key = WC_Twoinc_Brand::prefixed_name('rl_off_logged');
            if (get_transient($key) || !function_exists('wc_get_logger')) {
                return;
            }
            set_transient($key, 1, self::DISABLED_NOTICE_INTERVAL);
            wc_get_logger()->warning(
                'Rate limiting is switched off in the plugin Diagnostics settings: the checkout AJAX'
                    . ' endpoints are serving every caller unmetered.',
                ['source' => 'twoinc-payment-gateway']
            );
        }

        /** Retry-After, so a legitimate client that trips the limit backs off instead of retrying into it. */
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
         * Tells one abusive address apart from a shop whose buyers all arrive on one proxy address.
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

            $summary = sprintf(
                // "Trips", not "refusals": only the first refusal of a client's
                // window reaches the ledger, so this counts limits tripped.
                '%s in the last %ds from %s; the busiest is %d%% of them (%s).',
                $total === 1 ? '1 rate-limit trip' : $total . ' rate-limit trips',
                self::LEDGER_WINDOW,
                $distinct === 1 ? '1 client address' : $distinct . $capped . ' distinct client addresses',
                $share,
                isset($counts[$hash])
                    ? 'this caller: ' . (int) $counts[$hash]
                    : 'this caller is not among them'
            );

            // The counts froze when the ledger filled, so a shape read off them
            // would be a reading of whoever happened to arrive first.
            if (!isset($counts[$hash])) {
                return $summary . ' It arrived after the ledger filled at ' . self::LEDGER_MAX_CLIENTS
                    . ' addresses, so the split above does not account for it.';
            }

            // Below the minimum sample a 100% share is just the first buyer to
            // trip the limit, so the counts are reported with no reading of them.
            if ($total < self::LEDGER_MIN_SAMPLE) {
                return $summary;
            }

            // Gated on the share, not on a lone address: one legitimate buyer
            // tripping once alongside a caller at 97% must not read as spread.
            if ($share < self::LEDGER_DOMINANT_SHARE) {
                return $summary . ' Spread across several addresses, so this looks like real traffic'
                    . ' rather than one caller.';
            }

            return $summary . ' One address accounts for ' . ($distinct === 1 ? 'all' : 'most')
                . ' of it: either a single abusive caller, or every buyer arriving on one reverse proxy'
                . ' or CDN address - if the latter, list every proxy in the chain under Trusted proxy'
                . ' addresses in the plugin Diagnostics settings.';
        }

        /** Bucket key for one client on one route, keyed on the client address rather than the rotatable session or security token. */
        private static function transient_key(string $route, string $client): string
        {
            // Transient keys cap at 172 chars; route + 24-char hash stays well inside.
            return WC_Twoinc_Brand::prefixed_name('rl_' . $route . '_' . self::client_hash($client));
        }

        private static function client_hash(string $client): string
        {
            return substr(hash(self::KEY_HASH_ALGO, self::bucket_identity($client)), 0, 24);
        }

        /**
         * IPv6 callers are metered by their /64, not their address: a routed
         * /64 is the smallest allocation a VPS or mobile subscriber gets, so
         * keying on the full address hands one of them 2^64 free buckets.
         */
        private static function bucket_identity(string $client): string
        {
            $packed = @inet_pton($client);
            if ($packed === false || strlen($packed) !== 16) {
                return $client;
            }
            return inet_ntop(substr($packed, 0, 8) . str_repeat("\0", 8)) . '/64';
        }

        /**
         * The socket peer, unless it is one the merchant listed as a trusted proxy.
         *
         * WC_Geolocation::get_ip_address() was rejected: it prefers X-Real-IP /
         * X-Forwarded-For with no trusted-proxy allowlist, so a rotating header
         * would mint a fresh bucket per request.
         */
        private static function client_id(): string
        {
            // Normalised like the hops are: a dual-stack listener reports an
            // IPv4 peer as ::ffff:10.0.0.2, which no IPv4 list entry matches.
            $peer = isset($_SERVER['REMOTE_ADDR'])
                ? self::normalise_address(trim((string) $_SERVER['REMOTE_ADDR']))
                : '';
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

            // nginx and HAProxy commonly set only X-Real-IP. It carries a single
            // hop, not the chain, so it is read only once X-Forwarded-For has
            // named nobody.
            $real = isset($_SERVER['HTTP_X_REAL_IP'])
                ? self::normalise_address(trim((string) $_SERVER['HTTP_X_REAL_IP']))
                : '';
            if ($real !== '' && !self::matches_any($real, $trusted)) {
                return $real;
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

        /** True when the entry is a usable address or CIDR block; the admin save check and the runtime match share this. */
        public static function is_valid_proxy_entry(string $entry): bool
        {
            return self::parse_range($entry) !== null;
        }

        /**
         * @return array|null [packed network, prefix bits], or null when the entry is unusable.
         */
        private static function parse_range(string $range): ?array
        {
            $suffix = null;
            if (strpos($range, '/') !== false) {
                list($range, $suffix) = explode('/', $range, 2);
                if (preg_match('/^\d+$/', trim($suffix)) !== 1) {
                    return null;
                }
            }
            $net = @inet_pton(trim($range));
            if ($net === false) {
                return null;
            }
            $width = strlen($net) * 8;
            $bits = $suffix === null ? $width : (int) trim($suffix);
            // A /0 matches its whole family, so it is a typo or a way to disable
            // the check, which the disable_rate_limiting toggle already does.
            // Leading zeros read as decimal, so /008 is the legitimate /8.
            if ($bits < 1 || $bits > $width) {
                return null;
            }
            return [$net, $bits];
        }

        /** @param string $packed inet_pton output for the address under test. */
        private static function in_range(string $packed, string $range): bool
        {
            $parsed = self::parse_range($range);
            if ($parsed === null) {
                return false;
            }
            list($net, $bits) = $parsed;
            if (strlen($net) !== strlen($packed)) {
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

        /** Self-limiting like drop_renamed_option_rows(), so no versioned migration runner is needed. */
        public static function maybe_raise_upgrade_notice(): void
        {
            if (get_option(self::notice_option(), '') !== '') {
                return;
            }
            update_option(self::notice_option(), 'pending', true);
        }

        /** Retire the notice permanently. */
        public static function dismiss_upgrade_notice(): void
        {
            update_option(self::notice_option(), 'dismissed', true);
        }

        public static function render_upgrade_notice(): void
        {
            if (get_option(self::notice_option(), '') !== 'pending' || !current_user_can('manage_woocommerce')) {
                return;
            }
            printf(
                '<div class="notice notice-info"><p>%s</p><p><a href="%s">%s</a> &nbsp; <a href="%s">%s</a></p></div>',
                esc_html(sprintf(
                    /* translators: %s is the brand product name (e.g. "Two") */
                    __(
                        'The %s checkout now meters its AJAX endpoints per client address. Checkout still completes,'
                            . ' but if your store sits behind a CDN or load balancer every buyer arrives as the same'
                            . ' address, and company search, address autofill and the approval check can be refused.'
                            . ' List your proxy under Diagnostics to meter buyers individually.',
                        'twoinc-payment-gateway'
                    ),
                    WC_Twoinc_Brand::get('product_name')
                )),
                esc_url(self::notice_link('settings')),
                esc_html(__('Open Diagnostics settings', 'twoinc-payment-gateway')),
                esc_url(self::notice_link('hide')),
                esc_html(__('Dismiss', 'twoinc-payment-gateway'))
            );
        }

        /** Act on a click of either notice link, then bounce so a reload cannot replay it. */
        public static function handle_upgrade_notice_click(): void
        {
            if (!isset($_GET[self::NOTICE_ARG]) || !current_user_can('manage_woocommerce')) {
                return;
            }
            $action = sanitize_key(wp_unslash($_GET[self::NOTICE_ARG]));
            check_admin_referer(self::NOTICE_ARG . '_' . $action);
            self::dismiss_upgrade_notice();
            wp_safe_redirect($action === 'settings'
                ? self::settings_url()
                : remove_query_arg([self::NOTICE_ARG, '_wpnonce']));
            exit;
        }

        /** 'settings' lands on the gateway settings; 'hide' returns to whichever admin page is showing the notice. */
        private static function notice_link(string $action): string
        {
            $args = [self::NOTICE_ARG => $action, '_wpnonce' => wp_create_nonce(self::NOTICE_ARG . '_' . $action)];
            return $action === 'settings' ? add_query_arg($args, self::settings_url()) : add_query_arg($args);
        }

        private static function settings_url(): string
        {
            return admin_url('admin.php?page=wc-settings&tab=checkout&section=' . WC_Twoinc_Brand::get('gateway_id'));
        }

        private static function notice_option(): string
        {
            return WC_Twoinc_Brand::prefixed_name('rate_limit_notice');
        }
    }
}
