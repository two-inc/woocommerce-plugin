<?php

/**
 * Payment terms chip selector + offset pricing fee — business logic (TWO-24751).
 *
 * All term/fee decisioning lives here; assets/js/twoinc.js only renders what
 * these methods return (the Gutenberg block checkout port must not need a
 * business-logic rewrite, see TWO-24767).
 *
 * Term availability: `get_available_terms()` is the single seam — the
 * merchant's ticked presets intersected with the backend's offered set
 * (TWO-24812) plus an optional custom term. An empty result means "offer
 * nothing": no term is sent and the backend applies the account default. The
 * merchant cannot save into that empty state once terms are configured (see
 * WC_Twoinc::validate_two_payment_terms_field). Do not read term lists
 * anywhere else.
 *
 * Fee arithmetic is never done plugin-side: the offset settings are posted to
 * POST /v1/pricing/order/fee as a `buyer_fee_share` block and the backend
 * computes the buyer's share.
 */

if (!class_exists('WC_Twoinc_Payment_Terms')) {
    class WC_Twoinc_Payment_Terms
    {
        public const SESSION_KEY = 'two_selected_term';

        /**
         * Decimal places every monetary value in the pricing request is
         * rounded to. Deliberately NOT wc_get_price_decimals(): the API
         * refuses a value finer than two places rather than rounding it, so
         * a store configured for 3 or 4 price decimals would have its
         * surcharge request rejected outright (TWO-25289).
         */
        public const MONEY_DECIMALS = 2;

        /**
         * Stored surcharge-rounding basis → pricing-API basis. "none" (and
         * any unmapped value) omits the rounding block.
         */
        private const ROUNDING_BASIS_TO_API = [
            'up' => 'UP',
            'down' => 'DOWN',
            'standard' => 'STANDARD',
        ];

        /** @var array<int, array|null> request-scoped fee quote cache, keyed by term days */
        private static $fee_cache = [];

        /**
         * @var bool one fail-CLOSED surcharge-FX report per request. The
         * gate filter and the per-term quote path can both hit the same
         * condition several times while rendering one checkout; the
         * merchant needs to be told once, not once per term.
         */
        private static $fx_failure_logged = false;

        /**
         * Whether the term feature is active: at least one term is offered. When
         * true a term is sent on the order and any configured surcharge applies.
         * There is no merchant on/off toggle — the offered-term set is the single
         * switch, and an empty set falls through to the account default.
         */
        public static function is_enabled($gateway): bool
        {
            return count(self::get_available_terms($gateway)) > 0;
        }

        /**
         * The terms offered at checkout, ascending. THE availability seam —
         * see the file header before adding another term-list read.
         *
         * The merchant's ticked presets intersected with the backend's
         * `available_terms` (so a term the backend withdrew drops out even
         * while a stale admin subset still lists it), plus an optional
         * custom term unioned in. An empty result is meaningful: no term is
         * offered, so none is sent and the backend applies the account default.
         *
         * Cache-only by default — this seam is reached from the gateway
         * constructor, cart totals and wc-ajax, none of which may block on
         * HTTP. Pass `$refresh = true` only from the sanctioned refresh
         * points (checkout render bootstrap; the admin field render has its
         * own path via get_payment_term_day_options).
         *
         * @return int[]
         */
        public static function get_available_terms($gateway, bool $refresh = false): array
        {
            $backend_terms = array_map('intval', $gateway->get_merchant_available_terms($refresh));

            $terms = [];
            $admin_subset = $gateway->get_option('payment_terms_days');
            if (is_array($admin_subset) && count($admin_subset) > 0 && count($backend_terms) > 0) {
                $admin_subset = array_map('intval', $admin_subset);
                $terms = array_values(array_intersect($backend_terms, $admin_subset));
            }

            // Custom term offered alongside the presets, unioned rather than intersected.
            $custom = (int) $gateway->get_option('payment_terms_custom_days');
            if ($custom > 0) {
                $terms[] = $custom;
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
         * Surcharge settings resolved from gateway options, mirroring the
         * Magento surcharge model: a type gate, a per-term grid of
         * {fixed, percentage, limit}, a differential toggle and rounding.
         *
         * @return array{type: string, enabled: bool, differential: bool, grid: array<int,array>, rounding_basis: string, rounding_step: float|null, tax_treatment: string, tax_class: string}
         */
        public static function get_surcharge_settings($gateway): array
        {
            $type = (string) $gateway->get_option('surcharge_type');
            if (!in_array($type, ['percentage', 'fixed', 'fixed_and_percentage'], true)) {
                $type = 'none';
            }
            $grid = $gateway->get_option('surcharge_grid');
            $grid = is_array($grid) ? $grid : [];
            $rounding_step = (float) $gateway->get_option('surcharge_rounding_step');
            $tax = self::resolve_surcharge_tax_treatment($gateway);
            return [
                'type' => $type,
                'enabled' => $type !== 'none',
                'differential' => $gateway->get_option('surcharge_differential') === '1',
                'grid' => $grid,
                'rounding_basis' => (string) $gateway->get_option('surcharge_rounding_basis'),
                'rounding_step' => $rounding_step > 0 ? $rounding_step : null,
                'tax_treatment' => $tax['treatment'],
                'tax_class' => $tax['tax_class'],
            ];
        }

        /**
         * The EFFECTIVE surcharge tax treatment: the stored mode, degraded
         * to 'standard' when it cannot be honoured. In custom_class mode the
         * stored slug is re-validated against the LIVE tax-class list on
         * every read: WC_Cart_Fees::add_fee() silently reverts an unknown
         * tax class to Standard rather than erroring, so degrading
         * explicitly here keeps the runtime honest and lets the settings
         * page surface the stale selection.
         *
         * '' also degrades to 'standard': save-validation blocks enabling
         * surcharges without a treatment, so an enabled-but-unset
         * combination can only mean a shop that enabled surcharges before
         * the treatment field existed, and 'standard' is the pre-feature fee
         * behaviour those shops were already getting.
         *
         * @return array{treatment: string, tax_class: string}
         */
        public static function resolve_surcharge_tax_treatment($gateway): array
        {
            $treatment = (string) $gateway->get_option('surcharge_tax_treatment');
            if (!in_array($treatment, ['standard', 'custom_class', 'always_zero'], true)) {
                $treatment = 'standard';
            }
            if ($treatment !== 'custom_class') {
                return ['treatment' => $treatment, 'tax_class' => ''];
            }
            $slug = trim((string) $gateway->get_option('surcharge_tax_class'));
            if ($slug === '' || !in_array($slug, self::live_tax_class_slugs(), true)) {
                return ['treatment' => 'standard', 'tax_class' => ''];
            }
            return ['treatment' => 'custom_class', 'tax_class' => $slug];
        }

        /**
         * The store's current additional tax-class slugs (Standard is the
         * implicit '' class and is never in this list). Guarded so the
         * resolver stays callable outside a full WooCommerce bootstrap.
         *
         * @return string[]
         */
        private static function live_tax_class_slugs(): array
        {
            if (!class_exists('WC_Tax') || !method_exists('WC_Tax', 'get_tax_class_slugs')) {
                return [];
            }
            return array_values(array_map('strval', (array) WC_Tax::get_tax_class_slugs()));
        }

        /**
         * The buyer_fee_share block for POST /v1/pricing/order/fee for one
         * term. The backend computes the fee from this; the plugin does no
         * arithmetic. Builds: percentage (0.0 when fixed-only, so the API
         * default of 100% is never silently applied), surcharge_basis, the
         * fixed surcharge (fixed/both types), a cap on the whole fee line
         * item (the grossed-up percentage passthrough plus the fixed
         * surcharge as sent — NOT a cap on the percentage portion alone),
         * rounding (only with a percentage component) and, in differential
         * mode, the default term as reference_terms.
         *
         * @return array|null null when no surcharge is configured (type none),
         *                    or when no FX rate is available to express the
         *                    configured monetary components in the checkout
         *                    currency (TWO-25269)
         */
        public static function build_buyer_fee_share($gateway, int $days): ?array
        {
            $settings = self::get_surcharge_settings($gateway);
            if (!$settings['enabled']) {
                return null;
            }
            $has_percentage = in_array($settings['type'], ['percentage', 'fixed_and_percentage'], true);
            $has_fixed = in_array($settings['type'], ['fixed', 'fixed_and_percentage'], true);
            $row = isset($settings['grid'][$days]) && is_array($settings['grid'][$days]) ? $settings['grid'][$days] : [];

            $buyer_fee_share = [
                'percentage' => $has_percentage && isset($row['percentage']) ? (float) $row['percentage'] : 0.0,
                'surcharge_basis' => 'buyer_pays',
            ];

            // Fixed amounts and caps are configured in the STORE currency
            // while the pricing request is made in the ACTIVE checkout
            // currency, so when a multi-currency setup has them diverge the
            // monetary components are converted via the Two FX layer
            // (TWO-25104). An unconvertible pair is caught EARLIER by the
            // availability gate, which withholds the payment method for the
            // whole checkout (TWO-25269 — surcharge_currency_unquotable(),
            // called from WC_Twoinc::apply_brand_availability_gate);
            // returning null here is the defence-in-depth backstop for the
            // paths the gate does not run on. Percentage-based surcharge is
            // currency-agnostic and unaffected.
            $components = self::surcharge_monetary_components($settings, $days);
            $fixed = $components['fixed'];
            $cap = $components['cap'];
            // Same zero exemption as the gate: a zero component is zero in
            // every currency, so it must not drag the request into a
            // fail-closed FX lookup (TWO-25289).
            if (self::needs_fx($fixed) || self::needs_fx($cap)) {
                $store_currency = strval(get_option('woocommerce_currency'));
                $active_currency = get_woocommerce_currency();
                if ($store_currency !== $active_currency) {
                    $rate = WC_Twoinc_FX::get_rate($gateway, $store_currency, $active_currency);
                    if ($rate === null) {
                        self::log_surcharge_fx_failure(sprintf(
                            'no FX rate to convert configured %s amounts'
                            . ' to checkout currency %s (term %d days)',
                            $store_currency,
                            $active_currency,
                            $days
                        ));
                        return null;
                    }
                    $converted_fixed = $fixed !== null ? round($fixed * $rate, self::MONEY_DECIMALS) : null;
                    $converted_cap = $cap !== null ? round($cap * $rate, self::MONEY_DECIMALS) : null;
                    // A configured CAP that rounds to 0.00 is relayed AS
                    // 0.00, not dropped or withheld: per the pricing API's
                    // contract a cap of zero clamps the fee to zero, distinct
                    // from an ABSENT cap (uncapped — see
                    // surcharge_monetary_components). Since the cap bounds
                    // the WHOLE fee line item, it also zeroes any fixed
                    // surcharge configured alongside it (TWO-25269: a
                    // fail-closed guard here was tried and reverted, as it
                    // withheld the fee block for the same eventual zero fee).
                    // (float) $cap !== 0.0: a cap already zero can't reach
                    // this conversion branch (zero is FX-exempt).
                    if ($cap !== null && (float) $cap !== 0.0 && $converted_cap <= 0 && function_exists('wc_get_logger')) {
                        wc_get_logger()->info(
                            sprintf(
                                'Surcharge cap of %s %s rounds to 0.00 in'
                                . ' checkout currency %s; the whole fee is'
                                . ' capped at 0.00 (term %d days)',
                                $cap,
                                $store_currency,
                                $active_currency,
                                $days
                            ),
                            ['source' => 'twoinc-payment-gateway']
                        );
                    }
                    // A FIXED amount that rounds to 0.00 is NOT a failure:
                    // a legitimately tiny configured fee can be genuinely
                    // negligible in a stronger currency, and 0.00 is the
                    // arithmetically correct answer. Proceed, but log it —
                    // a surcharge line quietly reading 0.00 otherwise looks
                    // like a bug.
                    if ($fixed !== null && $converted_fixed <= 0 && function_exists('wc_get_logger')) {
                        wc_get_logger()->info(
                            sprintf(
                                'Fixed surcharge of %s %s rounds to 0.00 in'
                                . ' checkout currency %s; charging 0.00'
                                . ' (term %d days)',
                                $fixed,
                                $store_currency,
                                $active_currency,
                                $days
                            ),
                            ['source' => 'twoinc-payment-gateway']
                        );
                    }
                    $fixed = $converted_fixed;
                    $cap = $converted_cap;
                }
            }
            // Rounded here as well as after conversion, because the
            // same-currency path never touches the FX branch and a merchant
            // can type more precision than the API accepts (TWO-25289).
            if ($fixed !== null) {
                $buyer_fee_share['surcharge'] = round($fixed, self::MONEY_DECIMALS);
            }
            if ($cap !== null) {
                $buyer_fee_share['cap'] = round($cap, self::MONEY_DECIMALS);
            }
            if ($has_percentage) {
                $rounding = self::build_rounding($settings);
                if ($rounding !== null) {
                    $buyer_fee_share['rounding'] = $rounding;
                }
            }
            if ($settings['differential']) {
                $default = self::get_default_term($gateway);
                if ($default !== null) {
                    $buyer_fee_share['reference_terms'] = self::build_terms_block($gateway, $default);
                }
            }
            return $buyer_fee_share;
        }

        /**
         * Whether a monetary component actually requires an FX rate. Absent
         * needs nothing; ZERO needs nothing either, because zero is zero in
         * every currency. Everything else does.
         *
         * @param float|null $amount
         */
        private static function needs_fx($amount): bool
        {
            return $amount !== null && (float) $amount !== 0.0;
        }

        /**
         * The cap configured on one grid row, or null when there is none.
         *
         * Emptiness is the only thing that means "no cap"; a cap of 0 is a
         * real instruction and is relayed as one (TWO-25289). A NEGATIVE cap
         * is neither: it's nonsense the admin grid rejects (so it can only
         * arrive via a hand edit or import, where it would be refused
         * upstream) — treated as absent rather than relayed as `cap => -10.0`.
         *
         * @param array<string,mixed> $row
         * @return float|null
         */
        private static function configured_cap_amount(array $row)
        {
            if (!isset($row['limit']) || !is_scalar($row['limit'])) {
                // is_scalar: a hand-edited or imported option can store an
                // array here, and casting one to string is a PHP warning.
                return null;
            }
            // Comma decimals are NORMALISED here, not treated as junk: the
            // save path and the merchant-minimum validator both apply this
            // same replacement, so "1,50" is the plugin's own accepted
            // spelling of 1.50. Reading it as junk would make it ABSENT,
            // meaning NO CAP — relaying the percentage uncapped, an
            // OVERCHARGE. Normalising can only ever cap lower (a thousands
            // separator, "1,500", reads as 1.5), the safe direction.
            $raw = trim(str_replace(',', '.', (string) $row['limit']));
            if ($raw === '' || !is_numeric($raw) || (float) $raw < 0) {
                return null;
            }

            return (float) $raw;
        }

        /**
         * The two STORE-currency monetary components of one term's grid
         * row: the fixed surcharge (fixed/both types) and the cap on the
         * whole fee line item (percentage/both types). Either may be null.
         *
         * A null cap means "no cap configured" (percentage charged
         * uncapped); a cap of exactly 0 is relayed AS 0, not normalised to
         * absent (TWO-25289) — per the API's contract a cap of zero clamps
         * the fee to zero, and treating it as absent would send the
         * percentage out UNCAPPED, an overcharge. Only emptiness means "no
         * cap".
         *
         * The `fixed` component keeps a `> 0` filter deliberately: an
         * absent fixed surcharge and one of 0.00 are the same instruction.
         *
         * @param array{type: string, grid: array<int,array>} $settings
         * @return array{fixed: float|null, cap: float|null}
         */
        private static function surcharge_monetary_components(array $settings, int $days): array
        {
            $has_percentage = in_array($settings['type'], ['percentage', 'fixed_and_percentage'], true);
            $has_fixed = in_array($settings['type'], ['fixed', 'fixed_and_percentage'], true);
            $row = isset($settings['grid'][$days]) && is_array($settings['grid'][$days]) ? $settings['grid'][$days] : [];
            return [
                'fixed' => $has_fixed && isset($row['fixed']) && (float) $row['fixed'] > 0 ? (float) $row['fixed'] : null,
                'cap' => $has_percentage ? self::configured_cap_amount($row) : null,
            ];
        }

        /**
         * Whether the configured surcharge cannot be quoted at all in the
         * active checkout currency, i.e. the fail-CLOSED condition for the
         * availability gate (TWO-25269). True means: withhold the payment
         * method rather than let the buyer be charged no surcharge with
         * nobody told.
         *
         * The condition is deliberately TERM-INDEPENDENT. No term is
         * selected when gateway availability is decided, and it does not
         * need to be: WC_Twoinc_FX::get_rate() resolves (or fails to
         * resolve) the store→checkout pair identically for every term, so
         * "no rate at all" is a property of the currency pair. Gating on
         * "some offered term is unquotable" instead would over-reject a
         * shop with one misconfigured term.
         *
         * Ordering matters for cost: the cheap local checks (surcharge
         * enabled, currencies diverge, at least one term actually carries
         * a monetary component) come before the FX lookup, so a
         * single-currency or percentage-only shop never touches the FX
         * layer from the gate.
         */
        public static function surcharge_currency_unquotable($gateway): bool
        {
            $settings = self::get_surcharge_settings($gateway);
            if (!$settings['enabled']) {
                return false;
            }
            $store_currency = strval(get_option('woocommerce_currency'));
            $active_currency = get_woocommerce_currency();
            if ($store_currency === $active_currency) {
                return false;
            }
            $monetary_term = null;
            foreach (self::get_available_terms($gateway) as $days) {
                $components = self::surcharge_monetary_components($settings, $days);
                // ZERO needs no rate: it is zero in every currency. Matters
                // because this gate WITHHOLDS the payment method, and a term
                // whose only monetary component is a zero cap would
                // otherwise take Two offline for the whole checkout over a
                // conversion with no work to do (TWO-25289).
                if (self::needs_fx($components['fixed']) || self::needs_fx($components['cap'])) {
                    $monetary_term = $days;
                    break;
                }
            }
            if ($monetary_term === null) {
                // Percentage-only (or empty) grid: currency-agnostic,
                // nothing to convert, nothing to fail on.
                return false;
            }
            if (WC_Twoinc_FX::get_rate($gateway, $store_currency, $active_currency) !== null) {
                return false;
            }
            self::log_surcharge_fx_failure(sprintf(
                'no FX rate for the configured %s surcharge amounts in checkout currency %s (e.g. term %d days)',
                $store_currency,
                $active_currency,
                $monetary_term
            ));
            return true;
        }

        /**
         * Report a fail-CLOSED surcharge FX condition at error level, once
         * per request. Error, not warning: the outcome is either a
         * withheld payment method or a withheld surcharge, and both are
         * invisible to the merchant unless the log says so (the same
         * rationale as the availability gate's own log).
         */
        private static function log_surcharge_fx_failure(string $reason): void
        {
            if (self::$fx_failure_logged || !function_exists('wc_get_logger')) {
                return;
            }
            self::$fx_failure_logged = true;
            wc_get_logger()->error(
                'Surcharge cannot be quoted in the checkout currency: ' . $reason,
                ['source' => 'twoinc-payment-gateway']
            );
        }

        /**
         * A NET_TERMS block for a duration, adding
         * duration_days_calculated_from = END_OF_MONTH when the merchant has
         * selected the end-of-month payment terms type (Magento parity).
         *
         * @return array{type: string, duration_days: int, duration_days_calculated_from?: string}
         */
        public static function build_terms_block($gateway, int $days): array
        {
            $block = ['type' => 'NET_TERMS', 'duration_days' => $days];
            if ($gateway->get_option('payment_terms_type') === 'end_of_month') {
                $block['duration_days_calculated_from'] = 'END_OF_MONTH';
            }
            return $block;
        }

        /**
         * The rounding block for buyer_fee_share, or null when rounding is
         * off. The backend does the arithmetic; the plugin only relays
         * {step, basis}. A None/unmapped basis or a non-positive step omits
         * the block (the API requires both keys and rejects step <= 0).
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
         * A failed or malformed HTTP quote is fail-soft: returns null and
         * the chip renders without a fee label. That covers transport
         * errors only — it is NOT a licence to drop a surcharge the
         * merchant configured. An unquotable currency pair is a
         * fail-CLOSED condition handled upstream by the availability gate
         * (TWO-25269), which withholds the payment method outright.
         *
         * @return array{buyer_fee_share: string, total_fee_tax_rate: string|null, currency: string}|null
         */
        public static function fetch_term_fee($gateway, int $days, float $gross_amount, string $buyer_country): ?array
        {
            if (array_key_exists($days, self::$fee_cache)) {
                return self::$fee_cache[$days];
            }

            $buyer_fee_share = self::build_buyer_fee_share($gateway, $days);
            if ($buyer_fee_share === null || $gross_amount <= 0) {
                return self::$fee_cache[$days] = null;
            }

            // This quote sits on the checkout render path and is fail-soft on
            // transport errors, so cap it well under make_request's 30s
            // default to avoid stalling checkout on a slow pricing call.
            $response = $gateway->make_request('/v1/pricing/order/fee', [
                'currency' => get_woocommerce_currency(),
                // MONEY_DECIMALS, not round_amt(): round_amt() uses
                // wc_get_price_decimals(), so a store configured for 3 or 4
                // price decimals sent an over-precise value and the API
                // refused the whole request (TWO-25289).
                'gross_amount' => number_format(round($gross_amount, self::MONEY_DECIMALS), self::MONEY_DECIMALS, '.', ''),
                'buyer_country_code' => $buyer_country,
                // Required by the pricing request. Hardcoded false — there
                // is no admin recourse-pricing config yet.
                'approved_on_recourse' => false,
                'order_terms' => self::build_terms_block($gateway, $days),
                'buyer_fee_share' => $buyer_fee_share,
            ], 'POST', array(), null, 10);

            if (is_wp_error($response) || (int) wp_remote_retrieve_response_code($response) < 200 || (int) wp_remote_retrieve_response_code($response) >= 300) {
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
         * Fetch the merchant's own pricing rate (percentage + fixed) per term
         * for the admin inline-fee display beside the term checkboxes. This is
         * the cost Two charges the MERCHANT, independent of any cart — distinct
         * from the buyer surcharge quoted at checkout (fetch_term_fee).
         *
         * @param int[]  $terms          requested net-term day counts
         * @param string $buyer_country  ISO-2 code for the rate preview
         * @return array{success: bool, currency?: string, fees?: array<string, array{percentage: float, fixed: float}>}
         */
        public static function fetch_merchant_rates($gateway, array $terms, string $buyer_country): array
        {
            $net_terms = [];
            foreach ($terms as $t) {
                $days = (int) $t;
                if ($days > 0) {
                    $net_terms[] = $days;
                }
            }
            $net_terms = array_values(array_unique($net_terms));
            if (count($net_terms) === 0) {
                return ['success' => false];
            }

            $response = $gateway->make_request('/pricing/v1/merchant/rates', [
                'buyer_country_code' => $buyer_country,
                // No admin recourse-pricing config yet — hardcoded false.
                'recourse_pricing' => false,
                // payout_schedule omitted: the server infers it from the
                // merchant's payee accounts (matches Magento).
                'net_terms' => $net_terms,
            ], 'POST', array(), null, 10);

            if (
                is_wp_error($response)
                || (int) wp_remote_retrieve_response_code($response) < 200
                || (int) wp_remote_retrieve_response_code($response) >= 300
            ) {
                return ['success' => false];
            }

            $body = json_decode($response['body'] ?? '', true);
            if (!is_array($body) || !isset($body['rates']) || !is_array($body['rates'])) {
                return ['success' => false];
            }

            $fees = [];
            foreach ($body['rates'] as $rate) {
                if (!isset($rate['net_terms'])) {
                    continue;
                }
                $days = (int) $rate['net_terms'];
                $fees[strval($days)] = [
                    'percentage' => (float) ($rate['percentage_fee'] ?? 0),
                    'fixed' => (float) ($rate['fixed_fee'] ?? 0),
                ];
            }

            return [
                'success' => true,
                'currency' => strval($body['currency'] ?? ''),
                'fees' => $fees,
            ];
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
         * the order's internal net + tax = gross consistency holds.
         */
        public static function apply_cart_fee($cart): void
        {
            $gateway = WC_Twoinc::get_instance();
            if (!$gateway) {
                return;
            }
            // Cheap gates first: surcharge configured, and this gateway is
            // the chosen payment method. The hook is registered globally
            // (see load_twoinc_classes), so it also fires on the cart page
            // and before any method is selected; require an explicit match
            // rather than "apply unless another is chosen" so the surcharge
            // never leaks onto a non-Two context — and so the term-set
            // resolution below never runs for visitors who aren't paying
            // with Two.
            $settings = self::get_surcharge_settings($gateway);
            if (!$settings['enabled']) {
                return;
            }
            $chosen = function_exists('WC') && (WC()->session ?? null) ? WC()->session->get('chosen_payment_method') : null;
            if ($chosen !== $gateway->id) {
                return;
            }
            if (!self::is_enabled($gateway)) {
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
            // The fee enters the basket at the pricing endpoint's output
            // (any FX conversion happened on the request inputs, TWO-25104)
            // — never re-converted store-side. A response echoing a
            // different currency than the cart's would land as a raw
            // number in the wrong money; skip it rather than mischarge.
            // Normalised the same way the FX layer normalises currency
            // codes (case/whitespace) so this guard can't be defeated by
            // a harmlessly-differently-cased echo.
            $fee_currency = strtoupper(trim((string) $fee['currency']));
            if ($fee_currency !== '' && $fee_currency !== strtoupper(get_woocommerce_currency())) {
                return;
            }

            $label = self::get_fee_label();
            $amount = (float) $fee['buyer_fee_share'];
            switch ($settings['tax_treatment']) {
                case 'always_zero':
                    // Unconditionally non-taxable via add_fee's $taxable
                    // flag — deliberately NOT bound to WC's "Zero rate" tax
                    // class. "Zero rate" is only an empty class by naming
                    // convention (core creates it with no rate rows and no
                    // special semantics); a merchant could later add rate
                    // rows to it and silently break the guarantee, whereas
                    // taxable=false is destination-independent by
                    // construction.
                    $cart->add_fee($label, $amount, false);
                    break;
                case 'custom_class':
                    // The slug is pre-validated against the live class list
                    // (resolve_surcharge_tax_treatment) — an unknown class
                    // never reaches here, because WC_Cart_Fees::add_fee()
                    // would silently tax it as Standard. WC's own tax engine
                    // (WC_Tax::get_matched_tax_rates) handles the rest:
                    // additive multi-rate jurisdictions and zero when no
                    // rate matches the destination.
                    $cart->add_fee($label, $amount, true, $settings['tax_class']);
                    break;
                default:
                    // 'standard' — pre-feature behaviour, byte-for-byte.
                    $cart->add_fee($label, $amount, true);
            }
        }

        /**
         * Buyer-facing label for the fee line. A merchant-set
         * surcharge_line_description wins (with %s replaced by the selected
         * term days, Magento parity); otherwise the brand label, else a
         * translated default.
         */
        public static function get_fee_label(): string
        {
            $gateway = WC_Twoinc::get_instance();
            $template = $gateway ? trim((string) $gateway->get_option('surcharge_line_description')) : '';
            if ($template !== '') {
                $days = $gateway ? self::get_selected_term($gateway) : null;
                return $days !== null ? str_replace('%s', (string) $days, $template) : $template;
            }
            $label = WC_Twoinc_Brand::get('fee_line_label');
            return $label ? __($label, 'twoinc-payment-gateway') : __('Service charge', 'twoinc-payment-gateway');
        }

        /**
         * wc-ajax handler: per-term fee quotes for the chip labels.
         */
        public static function ajax_term_fees(): void
        {
            if (!check_ajax_referer('twoinc_checkout', 'nonce', false)) {
                wp_send_json_error('Invalid nonce');
                return;
            }
            // After the nonce, so unauthenticated noise never fills a bucket
            // that a real buyer on the same address is metered by.
            if (!WC_Twoinc_Rate_Limiter::check('term_fees')) {
                return;
            }
            $gateway = WC_Twoinc::get_instance();
            if (!$gateway || !self::is_enabled($gateway)) {
                wp_send_json_error('Payment terms are not enabled');
                return;
            }
            $cart = function_exists('WC') ? (WC()->cart ?? null) : null;
            $customer = function_exists('WC') ? (WC()->customer ?? null) : null;
            $basis = $cart ? self::get_fee_basis($cart) : 0.0;
            $buyer_country = $customer ? $customer->get_billing_country() : '';

            $fees = self::fetch_term_fees($gateway, $basis, $buyer_country);
            foreach ($fees as $days => $fee) {
                if (is_array($fee) && isset($fee['buyer_fee_share'])) {
                    $fees[$days]['buyer_fee_share_display'] = self::format_fee_amount(
                        (float) $fee['buyer_fee_share'],
                        (string) ($fee['currency'] ?? get_woocommerce_currency())
                    );
                }
            }

            wp_send_json_success([
                'terms' => self::get_available_terms($gateway),
                'selected' => self::get_selected_term($gateway),
                'fees' => $fees,
            ]);
        }

        /**
         * Buyer-facing chip amount: the store's own price format, so the chip
         * shows the currency SYMBOL in the store's configured position with
         * the store's separators — "€12,50", not "12.50 EUR" — rather than
         * echoing the currency code the pricing API returned.
         *
         * wc_price() is the single source of that format in WooCommerce, but
         * it returns markup; the chip is rendered with jQuery `text`, so the
         * tags are stripped and the entities (&euro;, &nbsp;) decoded to the
         * plain string. Deliberately NOT reimplemented from
         * get_woocommerce_currency_symbol() + separators — that would be a
         * second, drifting copy of the store's price format.
         */
        public static function format_fee_amount(float $amount, string $currency): string
        {
            if (!function_exists('wc_price')) {
                return strval(WC_Twoinc_Helper::round_amt($amount));
            }
            return trim(html_entity_decode(
                wp_strip_all_tags(wc_price($amount, ['currency' => strtoupper($currency)])),
                ENT_QUOTES,
                'UTF-8'
            ));
        }

        /**
         * wc-ajax handler: persist the buyer's term selection in the session.
         */
        public static function ajax_select_term(): void
        {
            if (!check_ajax_referer('twoinc_checkout', 'nonce', false)) {
                wp_send_json_error('Invalid nonce');
                return;
            }
            // After the nonce, so unauthenticated noise never fills a bucket
            // that a real buyer on the same address is metered by.
            if (!WC_Twoinc_Rate_Limiter::check('select_term')) {
                return;
            }
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
                'terms' => self::build_terms_block($gateway, $selected),
                'available_terms' => $terms,
            ];
        }

        /**
         * Reset the request-scoped fee cache (tests).
         */
        public static function reset_fee_cache(): void
        {
            self::$fee_cache = [];
            self::$fx_failure_logged = false;
        }
    }
}
