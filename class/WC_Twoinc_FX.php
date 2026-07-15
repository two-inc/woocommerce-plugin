<?php

/**
 * FX conversion layer over GET /refdata/v1/fx-rates (TWO-25104).
 *
 * WooCommerce has no native exchange-rate table (the parity gap vs Magento,
 * whose plugin reads the store's own rates). This class is the single FX
 * source for the plugin: it fetches Two's EUR-pivot spot table from the
 * checkout API with the merchant's API key (server-side only — the key and
 * the rates never reach browser JS), caches it, and computes cross rates
 * exactly as the endpoint does (rate = eur_value(from) / eur_value(to)).
 * Converting with the same table Two uses server-side keeps plugin-side
 * figures (fixed surcharge, surcharge cap, minimum-order gates) consistent
 * with what the API will compute at order time.
 *
 * Cache model (three layers):
 *  - Request memo: one table read/parse per PHP request.
 *  - Freshness transient (6h + a grace margin): while present, the stored
 *    table is trusted and no HTTP happens. A recurring Action Scheduler job
 *    re-fetches on the 6h cadence; the grace margin absorbs Action
 *    Scheduler's best-effort timing (it runs on traffic/cron, not a
 *    guaranteed clock) so a late job normally still beats the transient's
 *    expiry and checkout traffic never pays for a fetch.
 *  - Last-known-good option (durable, non-autoloaded): survives transient
 *    expiry and fetch failures. Rates move a few times a day at most, so a
 *    stale table is a far better basis for a gate decision than no table.
 *    Values are re-validated on every read (not just on fetch): a table can
 *    reach wp_options via a route other than fetch_table (a DB import, an
 *    older/newer plugin version, manual editing) and a poisoned entry must
 *    not reach the division in get_rate().
 *
 * On-demand path: a checkout in a currency the FRESH cached table does not
 * carry triggers one synchronous re-fetch (tight timeout) — a fresh table
 * is, by construction, the endpoint's complete table, so a currency absent
 * from it is conclusively unsupported and re-fetching would only repeat
 * that same conclusion on every request (an unbounded fetch loop, not a
 * cache). A STALE table's absence is inconclusive (a fresher table might
 * carry the currency), so that case still re-fetches. A failed fetch arms
 * a short retry-throttle transient so a flapping API cannot be hammered
 * once per conversion.
 *
 * Fail semantics (per TWO-25104):
 *  - Gate conversions (minimum-order availability) use last-known-good and
 *    fail CLOSED only when no table has ever been fetched: get_rate()
 *    returns null and the caller must treat null as "cannot be proven".
 *  - Display conversions fail SOFT: callers fall back to the native value.
 *  - Charge conversions (fixed surcharge/cap) fail SOFT to *no* surcharge:
 *    a wrong-currency amount must never be sent to the pricing API.
 *
 * The response's as_of date (the staleness floor of the rates used) is
 * stored alongside the table for observability and tests; freshness is
 * governed by fetch time, matching the endpoint's guidance that plugins
 * keep their own ~6h cache over its short Cache-Control window.
 */

if (!class_exists('WC_Twoinc_FX')) {
    class WC_Twoinc_FX
    {
        /** Background refresh cadence (seconds). */
        public const REFRESH_INTERVAL = 6 * 3600;

        /**
         * Extra slack added to the freshness transient beyond
         * REFRESH_INTERVAL. Action Scheduler is best-effort (it runs on
         * traffic/WP-cron, not a guaranteed clock), so the transient must
         * outlive the nominal interval or checkout traffic pays for a
         * fetch every cycle at the boundary, right when the previous
         * fetch is due anyway.
         */
        public const FRESHNESS_GRACE = 3600;

        /** Retry throttle after a failed fetch (seconds). */
        public const FAILURE_RETRY_WINDOW = 300;

        /**
         * Timeout for the on-demand fetch on the checkout path. The gate
         * and fee-quote paths must not stall checkout on a slow refdata
         * call; the background job re-fetches on its own schedule.
         */
        public const FETCH_TIMEOUT = 5;

        /** @var array|null request-scoped memo of the stored table */
        private static $table_memo = null;

        /** @var bool one live fetch attempt per request at most */
        private static $fetched_this_request = false;

        /**
         * The brand-prefixed option key holding the last-known-good table:
         * ['base' => 'EUR', 'rates' => [CCY => float], 'as_of' => 'Y-m-d'|null,
         *  'fetched_at' => int].
         */
        public static function option_key(): string
        {
            return WC_Twoinc_Brand::prefixed_name('fx_rates');
        }

        /** The brand-prefixed transient key marking the table fresh. */
        public static function fresh_transient_key(): string
        {
            return WC_Twoinc_Brand::prefixed_name('fx_rates_fresh');
        }

        /** The brand-prefixed transient key throttling failed-fetch retries. */
        public static function retry_transient_key(): string
        {
            return WC_Twoinc_Brand::prefixed_name('fx_rates_retry_after');
        }

        /**
         * The brand-prefixed recurring-refresh hook. Prefixed so a Two and
         * a partner-brand plugin on the same site each refresh their own
         * cache under their own merchant API key.
         */
        public static function refresh_hook(): string
        {
            return WC_Twoinc_Brand::prefixed_name('fx_refresh');
        }

        /**
         * Register the recurring background refresh with WooCommerce's
         * Action Scheduler (bundled with WC core). Hooked on init; a no-op
         * when the job already exists or Action Scheduler is unavailable
         * (e.g. unit tests) — the on-demand path still keeps the cache
         * serviceable without it.
         */
        public static function maybe_schedule_refresh(): void
        {
            if (!function_exists('as_schedule_recurring_action')) {
                return;
            }
            $scheduled = false;
            if (function_exists('as_has_scheduled_action')) {
                $scheduled = as_has_scheduled_action(self::refresh_hook());
            } elseif (function_exists('as_next_scheduled_action')) {
                $scheduled = as_next_scheduled_action(self::refresh_hook()) !== false;
            }
            if (!$scheduled) {
                // $unique = true: two concurrent requests in the cold
                // state (first install, or right after a
                // deactivate/reactivate cleared the job) both observe
                // "not scheduled" — the has-scheduled-action check above
                // is not atomic with the schedule call. Without $unique
                // both would schedule, and a duplicate recurring series
                // self-perpetuates forever.
                as_schedule_recurring_action(
                    time() + self::REFRESH_INTERVAL,
                    self::REFRESH_INTERVAL,
                    self::refresh_hook(),
                    [],
                    'twoinc-payment-gateway',
                    true
                );
            }
        }

        /**
         * The scheduled-refresh callback. Static and self-bootstrapping:
         * Action Scheduler runs it outside any gateway context.
         */
        public static function run_scheduled_refresh(): void
        {
            $gateway = WC_Twoinc::get_instance();
            if ($gateway) {
                self::refresh($gateway);
            }
        }

        /**
         * Fetch the full spot table and store it as last-known-good.
         * Success re-arms the 6h freshness window; failure keeps the
         * previous table untouched and arms the retry throttle instead.
         *
         * @return bool whether a valid table was fetched and stored
         */
        public static function refresh($gateway): bool
        {
            self::$fetched_this_request = true;
            $table = self::fetch_table($gateway);
            if ($table === null) {
                set_transient(self::retry_transient_key(), time(), self::FAILURE_RETRY_WINDOW);
                return false;
            }
            update_option(self::option_key(), wp_json_encode($table), false);
            set_transient(self::fresh_transient_key(), $table['fetched_at'], self::REFRESH_INTERVAL + self::FRESHNESS_GRACE);
            delete_transient(self::retry_transient_key());
            self::$table_memo = $table;
            return true;
        }

        /**
         * One GET /refdata/v1/fx-rates call, parsed and validated, or null.
         * The endpoint is merchant-API-key authed; make_request signs with
         * the configured key. Only positive numeric rates are kept — a
         * malformed entry is dropped rather than poisoning conversions.
         *
         * @return array{base: string, rates: array<string, float>, as_of: string|null, fetched_at: int}|null
         */
        private static function fetch_table($gateway): ?array
        {
            $response = $gateway->make_request('/refdata/v1/fx-rates', [], 'GET', [], null, self::FETCH_TIMEOUT);
            if (is_wp_error($response)) {
                return null;
            }
            $code = (int) wp_remote_retrieve_response_code($response);
            if ($code < 200 || $code >= 300) {
                return null;
            }
            $body = json_decode(wp_remote_retrieve_body($response), true);
            if (!is_array($body) || !isset($body['base'], $body['rates']) || !is_array($body['rates']) || !is_string($body['base'])) {
                return null;
            }
            $rates = self::sanitize_rates($body['rates']);
            if ($rates === null) {
                return null;
            }
            return [
                'base' => strtoupper($body['base']),
                'rates' => $rates,
                'as_of' => isset($body['as_of']) && is_string($body['as_of']) ? $body['as_of'] : null,
                'fetched_at' => time(),
            ];
        }

        /**
         * Filter a raw rates map down to positive-numeric entries keyed by
         * uppercase currency code, or null when nothing usable remains.
         * Shared by the fetch path and the stored-table read path: a
         * table can reach wp_options by a route other than fetch_table
         * (a DB import, a different plugin version's shape, manual
         * editing), so a poisoned entry (zero, negative, non-numeric)
         * must be caught on every read, not only at fetch time — a stray
         * zero or string reaching the division in get_rate() is a fatal,
         * not a bad conversion.
         *
         * @return array<string, float>|null
         */
        private static function sanitize_rates(array $raw): ?array
        {
            $rates = [];
            foreach ($raw as $currency => $rate) {
                if (is_string($currency) && $currency !== '' && is_numeric($rate) && (float) $rate > 0) {
                    $rates[strtoupper($currency)] = (float) $rate;
                }
            }
            return count($rates) > 0 ? $rates : null;
        }

        /**
         * The working table: request memo → stored table, refreshed first
         * when the freshness window has lapsed (and the retry throttle is
         * not armed). A failed refresh falls back to last-known-good; null
         * only when no table has ever been stored.
         *
         * @return array{base: string, rates: array<string, float>, as_of: string|null, fetched_at: int}|null
         */
        private static function get_table($gateway): ?array
        {
            if (self::$table_memo !== null) {
                return self::$table_memo;
            }
            $stored = self::read_stored_table();
            // The transient is the primary freshness signal, but an
            // object cache (Redis/memcached) can evict it under memory
            // pressure well before its TTL — typically the first thing to
            // go, often right when the site is busiest. Falling back to
            // the durable fetched_at (stored in the same DB row as the
            // table) means an eviction degrades to "one extra freshness
            // check", not "every request re-fetches".
            $fresh = get_transient(self::fresh_transient_key()) !== false
                || ($stored !== null && isset($stored['fetched_at'])
                    && (time() - (int) $stored['fetched_at']) < (self::REFRESH_INTERVAL + self::FRESHNESS_GRACE));
            if ($stored !== null && $fresh) {
                return self::$table_memo = $stored;
            }
            if ($gateway && !self::$fetched_this_request && get_transient(self::retry_transient_key()) === false) {
                self::refresh($gateway);
                if (self::$table_memo !== null) {
                    return self::$table_memo;
                }
            }
            if ($stored !== null) {
                self::$table_memo = $stored;
            }
            return $stored;
        }

        /**
         * @return array|null the stored last-known-good table, or null
         */
        private static function read_stored_table(): ?array
        {
            $raw = get_option(self::option_key());
            if (!is_string($raw) || $raw === '') {
                return null;
            }
            $table = json_decode($raw, true);
            if (!is_array($table) || !isset($table['base'], $table['rates']) || !is_array($table['rates']) || !is_string($table['base'])) {
                return null;
            }
            $rates = self::sanitize_rates($table['rates']);
            if ($rates === null) {
                return null;
            }
            $table['rates'] = $rates;
            $table['base'] = strtoupper($table['base']);
            return $table;
        }

        /**
         * The value of one unit of $currency in the table's base (EUR).
         * The base itself may be absent from the rates map (it is 1 by
         * definition).
         */
        private static function base_value(array $table, string $currency): ?float
        {
            if ($currency === $table['base']) {
                return 1.0;
            }
            return isset($table['rates'][$currency]) ? (float) $table['rates'][$currency] : null;
        }

        /**
         * Units of $to per one unit of $from, or null when no rate can be
         * produced. Same-currency short-circuits to 1.0 without touching
         * the cache or the network. A currency missing from the cached
         * table triggers one on-demand full-table re-fetch (the "checkout
         * in an uncached currency" path) before concluding it is
         * unsupported.
         *
         * Null means "cannot convert": gate callers must fail closed on
         * it, display and charge callers fail soft (see the class header).
         */
        public static function get_rate($gateway, string $from, string $to): ?float
        {
            $from = strtoupper(trim($from));
            $to = strtoupper(trim($to));
            if ($from === '' || $to === '') {
                return null;
            }
            if ($from === $to) {
                return 1.0;
            }
            $table = self::get_table($gateway);
            if ($table === null) {
                return null;
            }
            $from_value = self::base_value($table, $from);
            $to_value = self::base_value($table, $to);
            if (($from_value === null || $to_value === null)
                && $gateway
                && !self::$fetched_this_request
                && !self::is_fresh($table)
                && get_transient(self::retry_transient_key()) === false
            ) {
                // Uncached currency, but the table we have is STALE: it
                // may not be the endpoint's current full table, so one
                // live re-fetch is worth it before concluding the
                // currency is unsupported. A currency missing from a
                // FRESH table is conclusive — the endpoint always returns
                // its complete table, so re-fetching would only repeat
                // the same "still absent" result on every request (an
                // unbounded synchronous-fetch loop, not a cache).
                self::refresh($gateway);
                $table = self::get_table($gateway);
                if ($table === null) {
                    return null;
                }
                $from_value = self::base_value($table, $from);
                $to_value = self::base_value($table, $to);
            }
            if ($from_value === null || $to_value === null) {
                return null;
            }
            return $from_value / $to_value;
        }

        /**
         * Whether $table is within the freshness window by either signal
         * (transient or durable fetched_at — see get_table()).
         */
        private static function is_fresh(array $table): bool
        {
            return get_transient(self::fresh_transient_key()) !== false
                || (isset($table['fetched_at']) && (time() - (int) $table['fetched_at']) < (self::REFRESH_INTERVAL + self::FRESHNESS_GRACE));
        }

        /**
         * $amount converted from $from to $to, unrounded, or null when no
         * rate is available (callers apply their own fail semantics and
         * rounding — a gate comparison must not round, a charged amount
         * rounds via WC_Twoinc_Helper::round_amt).
         */
        public static function convert($gateway, float $amount, string $from, string $to): ?float
        {
            $rate = self::get_rate($gateway, $from, $to);
            return $rate === null ? null : $amount * $rate;
        }

        /**
         * The as_of date of the working table (the oldest rate it relies
         * on, per the endpoint), or null when no table is stored. Exposed
         * for logging/diagnostics; freshness is governed by fetch time.
         */
        public static function get_as_of($gateway): ?string
        {
            $table = self::get_table($gateway);
            return $table !== null ? ($table['as_of'] ?? null) : null;
        }

        /**
         * Drop the durable cache (uninstall/cleanup path).
         */
        public static function purge(): void
        {
            delete_option(self::option_key());
            delete_transient(self::fresh_transient_key());
            delete_transient(self::retry_transient_key());
            self::reset_request_cache();
        }

        /**
         * Reset request-scoped state (tests).
         */
        public static function reset_request_cache(): void
        {
            self::$table_memo = null;
            self::$fetched_this_request = false;
        }
    }
}
