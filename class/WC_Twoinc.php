<?php

/**
 * Twoinc Gateway
 *
 * Provides integration between WooCommerce and Twoinc
 *
 * @class WC_Twoinc
 * @extends WC_Payment_Gateway
 * @package WooCommerce/Classes/Payment
 * @author Two
 */

if (!class_exists('WC_Twoinc')) {
    class WC_Twoinc extends WC_Payment_Gateway
    {
        private static $instance;

        // Per-request memo for GET /v1/merchant/{id} (TWO-25024): one wire
        // fetch per request shared by every consumer, failures included.
        private static $merchant_record = null;
        private static $merchant_record_fetched = false;

        // BC-frozen: external integrations may read these constants, but all
        // runtime reads go through WC_Twoinc_Brand so overlays can rebrand.
        // They mirror brands/two.php; tests/unit pins them against drift.
        public const PROVIDER = 'Two';
        public const PROVIDER_FULL_NAME = 'Two';
        public const PRODUCT_NAME = 'Two';
        public const MERCHANT_SIGNUP_URL = 'https://portal.two.inc/auth/merchant/signup';
        public const ALERT_EMAIL_ADDRESS = 'woocom-alerts@two.inc';

        // Order states in which the Two API refuses order edits. Shared by
        // the fulfilment skip-check and the edit gate in
        // process_update_twoinc_order — their identity guarantees the
        // tracking-failure note in on_order_completed can never be
        // triggered by the state gate itself.
        private const TERMINAL_ORDER_STATES = ["FULFILLING", "FULFILLED", "DELIVERED", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED"];

        private bool $twoinc_process_confirmation_called = false;

        /**
         * WC_Twoinc constructor.
         */
        public function __construct()
        {

            $this->id = WC_Twoinc_Brand::get('gateway_id');
            $this->has_fields = false;
            $this->order_button_text = __('Place order', 'twoinc-payment-gateway');
            $this->method_title = WC_Twoinc_Brand::get('product_name');
            $this->method_description = __('Making it easy for businesses to buy online.', 'twoinc-payment-gateway');
            $this->icon = WC_HTTPS::force_https_url(WC_Twoinc_Brand::get('logo_url'));
            $this->supports = ['products', 'refunds'];

            // Load the settings
            $this->init_form_fields();
            $this->init_settings();

            $this->title = sprintf(
                __($this->get_option('title'), 'twoinc-payment-gateway'),
                strval($this->get_merchant_default_days_on_invoice())
            );
            /**
             * Filter the checkout payment-box description so a brand
             * overlay can replace the copy wholesale (a brand overlay
             * ships its own bullet list).
             *
             * Applied once at gateway construction: like
             * twoinc_brand_file, an overlay must register this filter no
             * later than plugins_loaded at default priority.
             *
             * @param string     $description Default description HTML.
             * @param WC_Twoinc  $gateway     The gateway instance (for
             *                                get_option reads).
             */
            $this->description = apply_filters(
                'twoinc_payment_description',
                $this->get_pay_box_description() . $this->get_pay_subtitle(),
                $this
            );

            // Skip hooks if another instance has already been created
            if (null !== self::$instance) {
                return;
            }

            // Brand product constraints (e.g. a minimum order value in a
            // specific currency/market) remove the gateway from checkout
            // when unmet. Config-driven; the Two brand sets no gate.
            add_filter('woocommerce_available_payment_gateways', [$this, 'apply_brand_availability_gate']);

            // Payment terms chip selector + offset pricing fee (TWO-24751).
            // Business logic lives in WC_Twoinc_Payment_Terms; the JS layer
            // renders only what these endpoints return.
            // NOTE: the surcharge cart-fee hook and the wc_ajax_two_*
            // endpoints are registered in load_twoinc_classes()
            // (plugins_loaded), not here — the gateway constructor is not
            // guaranteed to have run before woocommerce_cart_calculate_fees
            // fires on an update_order_review recalc, nor on a standalone
            // wc-ajax request.

            if (is_admin()) {
                // Notice banner if plugin is not setup properly

                add_action('admin_notices', [$this, 'twoinc_account_init_notice']);
                add_action('network_admin_notices', [$this, 'twoinc_account_init_notice']);

                // Verify API key quietly
                add_action('admin_enqueue_scripts', [$this, 'verify_api_key_action']);

                // Deactivation cleanup is registered in the main plugin file
                // (register_deactivation_hook) — a registration here would key
                // the hook off THIS file's basename and never fire (TWO-25028).

                // Add js css to admin page
                add_action('admin_enqueue_scripts', [$this, 'twoinc_admin_styles_scripts']);

                // On setting updated
                add_action('woocommerce_update_options_payment_gateways_' . $this->id, [$this, 'process_admin_options']); // Built-in process_admin_options
            }

            // Return if plugin setup is not complete
            if (!$this->get_option('api_key') || !$this->get_merchant_id()) {
                return;
            }

            if (is_admin()) {
                // Add HTML in order edit page
                add_action('woocommerce_admin_order_data_after_order_details', [$this, 'add_invoice_credit_note_urls']);

                // NOTE: render_invoice_download_notice is registered on
                // admin_notices in load_twoinc_classes() (plugins_loaded),
                // NOT here: on the order edit screen WooCommerce constructs
                // the gateway lazily during the order-data metabox render,
                // which is AFTER admin_notices has already fired — a
                // constructor registration is silently too late and the
                // parked notice never renders (TWO-25041 follow-up).

                // Advanced Custom Fields plugin hides custom fields, we must display them
                add_filter('acf/settings/remove_wp_meta_box', '__return_false');

                // For order update
                /* To be removed
                // For order update by Save button
                add_action('woocommerce_before_save_order_items', [$this, 'before_order_item_save'], 10, 2);
                add_action('woocommerce_saved_order_items', [$this, 'after_order_item_save'], 10, 2);
                */
                // For order update by add/remove item (product/fee/shipping) and recalculate (tax)
                add_action('woocommerce_admin_order_item_headers', [$this, 'after_order_item_update'], 10, 1);
                // For order update using Update post
                add_action('wp_after_insert_post', [$this, 'after_order_update'], 10, 4);
            } else {
                // Change the text in Twoinc payment method in shop checkout page to reflect correct validation status
                add_action('woocommerce_checkout_update_order_review', [$this, 'change_twoinc_payment_title']);
            }


            // On order status changed to completed
            add_action('woocommerce_order_status_completed', [$this, 'on_order_completed']);

            // On order status changed to cancelled
            add_action('woocommerce_order_status_cancelled', [$this, 'on_order_cancelled']);

            add_action('woocommerce_cancelled_order', [$this, 'on_order_cancelled']);

            // On order status changed to refunded
            add_action('woocommerce_order_status_refunded', [$this, 'on_order_refunded']);

            // This class use singleton
            self::$instance = $this;
            new WC_Twoinc_Checkout($this);
        }

        /**
         * Singleton call
         */
        public static function get_instance()
        {
            if (null === self::$instance) {
                self::$instance = new WC_Twoinc();
            }
            return self::$instance;
        }

        /**
         * Get twoinc checkout host based on current settings
         */
        public function get_twoinc_checkout_host()
        {
            // Deprecated dev-environment sniffing (localhost, the
            // TWOINC_DEV_HOSTNAMES env var, *.two.inc dev subdomains):
            // installs predating the explicit environment mode carry the
            // default mode and rely on the sniffed test host. Consulted only
            // while the mode resolves to production — an explicit
            // non-production mode ('staging', 'sandbox') always wins, while
            // an explicit Production selection is indistinguishable from the
            // never-configured default, so the sniffer still applies there.
            // Set checkout_env instead of extending the sniffer.
            if (
                WC_Twoinc_Helper::get_environment_mode($this) === 'production'
                && WC_Twoinc_Helper::is_twoinc_development()
            ) {
                return $this->get_option('test_checkout_host');
            }
            return WC_Twoinc_Helper::get_environment_host('api', $this);
        }

        /**
         * Options for the checkout_env select. Merchants choose between
         * Production and Sandbox; any other stored mode (e.g. 'staging' on
         * Two's own staging shops, set via wp-cli rather than the UI) is
         * preserved as a selectable option so saving the settings form
         * doesn't silently reset it. Mirrors the Magento Mode source model.
         *
         * @return array
         */
        public function get_checkout_env_options()
        {
            $options = [
                'PROD'    => __('Production', 'twoinc-payment-gateway'),
                'SANDBOX' => __('Sandbox', 'twoinc-payment-gateway'),
            ];
            // Raw settings row, NOT $this->get_option(): this runs inside
            // init_form_fields(), and WC_Settings_API::get_option() on a
            // missing key re-enters get_form_fields() -> init_form_fields()
            // — infinite recursion on any install whose settings blob lacks
            // checkout_env (fresh installs, and dev shops where the field
            // was previously unset from the form).
            $saved = get_option($this->get_option_key(), null);
            $stored = is_array($saved) ? (string) ($saved['checkout_env'] ?? '') : '';
            $normalized = strtolower($stored);
            if (
                in_array($normalized, WC_Twoinc_Helper::ENVIRONMENT_MODES, true)
                && !in_array($normalized, ['production', 'sandbox'], true)
            ) {
                $options[$stored] = ucfirst($normalized);
            }
            return $options;
        }

        /**
         * Get merchant ID
         *
         * @return string
         */
        public function get_merchant_id()
        {
            return $this->get_option('merchant_id') ?? $this->get_option('tillit_merchant_id');
        }

        /**
         * Get enable company search
         *
         * @return string
         */
        public function get_enable_company_search()
        {
            return $this->get_option('enable_company_search') ?? $this->get_option('enable_company_name');
        }

        /**
         * The decoded GET /v1/merchant/{id} record, fetched at most once
         * per PHP request — the memo covers failures too, so a hanging API
         * costs a single capped stall per request instead of one per
         * consumer (TWO-25024). Returns the decoded body, or null when the
         * fetch failed or the plugin is not configured. Consumers own their
         * TTL/degrade semantics; this owns the wire.
         */
        private function fetch_merchant_record(): ?array
        {
            if (self::$merchant_record_fetched) {
                return self::$merchant_record;
            }
            self::$merchant_record_fetched = true;
            self::$merchant_record = null;

            $merchant_id = $this->get_merchant_id();
            if (!$merchant_id || !$this->get_option('api_key')) {
                return null;
            }

            // Reached from render paths (checkout bootstrap, admin field
            // render, constructor via init_form_fields), so cap well under
            // make_request's 30s default.
            $response = $this->make_request("/v1/merchant/{$merchant_id}", [], 'GET', array(), null, 10);
            if (
                !is_wp_error($response)
                && !WC_Twoinc_Helper::get_twoinc_error_msg($response)
                && $response
                && !empty($response['body'])
            ) {
                $body = json_decode($response['body'] ?? '', true);
                if (is_array($body)) {
                    self::$merchant_record = $body;
                }
            }
            return self::$merchant_record;
        }

        /**
         * Reset the per-request merchant-record memo. Production reaches
         * this only via invalidate_merchant_record_caches() (merchant
         * identity change, deactivation cleanup); it is public so the unit
         * harness can simulate request boundaries.
         */
        public static function reset_merchant_record_memo(): void
        {
            self::$merchant_record = null;
            self::$merchant_record_fetched = false;
        }

        /**
         * Get merchant's default due in day from the option cache, or from
         * the Two merchant record (1h TTL, defaults to 14 days).
         *
         * Cached in dedicated brand-prefixed wp_options, NOT the gateway
         * settings blob — see get_merchant_available_terms() for why a
         * frontend TTL-expiry write into the blob can silently revert a
         * concurrent admin settings save.
         */
        public function get_merchant_default_days_on_invoice()
        {
            $days_option = WC_Twoinc_Brand::prefixed_name('days_on_invoice');
            $checked_option = WC_Twoinc_Brand::prefixed_name('days_on_invoice_checked_on');

            // Default to 14 days when nothing is cached
            $days_on_invoice = (int) get_option($days_option);
            if ($days_on_invoice <= 0) {
                $days_on_invoice = 14;
            }

            if ($this->get_merchant_id() && $this->get_option('api_key')) {
                $checked_on = get_option($checked_option);
                if (!$checked_on || ((int) $checked_on + 3600) <= time()) {
                    // Bump the clock before fetching: concurrent requests at
                    // expiry serve stale instead of stampeding the API.
                    update_option($checked_option, time(), false);
                    $record = $this->fetch_merchant_record();
                    if (is_array($record)) {
                        // A null due_in_days on the record also means 14 days
                        $days_on_invoice = !empty($record['due_in_days']) ? (int) $record['due_in_days'] : 14;
                        update_option($days_option, $days_on_invoice, false);
                    }
                }
            }

            return $days_on_invoice;
        }

        /**
         * The platform's minimum order value for this merchant, resolved
         * from the Two API (min_order_amount/min_order_currency/
         * min_order_basis on GET /v1/merchant/{id} - the funding-partner
         * default with merchant override, the same value checkout-api
         * enforces at order create/intent), as
         * ['amount', 'currency', 'basis'] or null when none is configured.
         *
         * Cached for 15 minutes in dedicated brand-prefixed wp_options
         * (never the settings blob); the no-minimum outcome is cached too
         * (the common case must not cost an API call per checkout render).
         * A fetch failure resolves to no minimum: the server still
         * enforces, and hiding the payment method on an API blip would be
         * the worse failure.
         *
         * @return array|null
         */
        public function get_platform_minimum_order()
        {
            $minimum_option = WC_Twoinc_Brand::prefixed_name('platform_minimum_order');
            $checked_option = WC_Twoinc_Brand::prefixed_name('platform_minimum_order_checked_on');

            if (!$this->get_merchant_id() || !$this->get_option('api_key')) {
                return null;
            }

            $checked_on = get_option($checked_option);
            if (!$checked_on || ((int) $checked_on + 900) <= time()) {
                update_option($checked_option, time(), false);

                $minimum = null;
                $record = $this->fetch_merchant_record();
                if (is_array($record)) {
                    $amount = $record['min_order_amount'] ?? null;
                    $currency = $record['min_order_currency'] ?? null;
                    $basis = $record['min_order_basis'] ?? null;
                    // The API omits all three fields when no minimum is
                    // configured; a partial or malformed tuple is treated
                    // the same way rather than gating on a guess.
                    if (
                        is_numeric($amount) && (float) $amount > 0
                        && is_string($currency) && $currency !== ''
                        && in_array($basis, ['net', 'gross'], true)
                    ) {
                        $minimum = [
                            'amount' => (float) $amount,
                            'currency' => strtoupper($currency),
                            'basis' => $basis,
                        ];
                    }
                }

                update_option($minimum_option, $minimum ? wp_json_encode($minimum) : '', false);
                return $minimum;
            }

            $cached = get_option($minimum_option);
            if (!$cached) {
                return null;
            }
            $minimum = json_decode((string) $cached, true);
            return is_array($minimum) ? $minimum : null;
        }

        /**
         * The merchant's fixed-fee surcharge cap from GET /v1/merchant
         * (surcharge_limit_amount/_currency — the funding partner's upper
         * bound on what a merchant may pass on per order, TWO-24950), as
         * ['amount', 'currency'] or null when none is configured. Mirrors
         * Magento's SettingsProvider::getSurchargeLimit (TWO-24954).
         *
         * Cached for 15 minutes in dedicated brand-prefixed wp_options with
         * the term-cache posture: read-only by default (the value gates an
         * admin save, never a checkout render), refresh only where
         * $refresh = true is passed — the surcharge grid render and its
         * save-time validation. Serve-stale on fetch failure: a stale cap
         * still enforces; dropping it on an API blip would let an
         * over-limit fixed fee through.
         *
         * @param bool $refresh allow a TTL-gated fetch on this call
         * @return array|null
         */
        public function get_merchant_surcharge_limit(bool $refresh = false)
        {
            $limit_option = WC_Twoinc_Brand::prefixed_name('merchant_surcharge_limit');
            $checked_option = WC_Twoinc_Brand::prefixed_name('merchant_surcharge_limit_checked_on');

            if ($refresh && $this->get_merchant_id() && $this->get_option('api_key')) {
                $checked_on = get_option($checked_option);
                if (!$checked_on || ((int) $checked_on + 900) <= time()) {
                    // Bump the clock before fetching (stampede guard), and
                    // on failure too: one stall per TTL, not per view.
                    update_option($checked_option, time(), false);
                    $record = $this->fetch_merchant_record();
                    if (is_array($record)) {
                        $amount = $record['surcharge_limit_amount'] ?? null;
                        $currency = $record['surcharge_limit_currency'] ?? null;
                        $limit = null;
                        if (
                            is_numeric($amount) && (float) $amount > 0
                            && is_string($currency) && $currency !== ''
                        ) {
                            $limit = [
                                // Round to 2dp at read: the label shows the
                                // cap to two decimals, so a raw 25.555 would
                                // display "Max 25.56" while rejecting 25.56.
                                // The displayed maximum must be enterable.
                                'amount' => round((float) $amount, 2),
                                'currency' => strtoupper($currency),
                            ];
                        }
                        // A successful record without the fields means the
                        // backend says "no limit" — cache that outcome too.
                        update_option($limit_option, $limit ? wp_json_encode($limit) : '', false);
                    }
                }
            }

            $cached = get_option($limit_option);
            if (!$cached) {
                return null;
            }
            $limit = json_decode((string) $cached, true);
            if (!is_array($limit) || !isset($limit['amount'], $limit['currency'])) {
                return null;
            }
            // JSON round-trip turns whole floats into ints — re-cast so the
            // shape is stable for callers regardless of cache state. The
            // round() also covers cache entries written before rounding
            // moved to the fetch path.
            return [
                'amount' => round((float) $limit['amount'], 2),
                'currency' => (string) $limit['currency'],
            ];
        }

        /**
         * Human-readable "EUR 25" / "EUR 25.5" label for a surcharge cap
         * (['amount', 'currency']) — the single formatting shared by the
         * grid help text and the save-validation error, so the claimed and
         * the enforced maximum can never drift apart.
         */
        private function format_surcharge_limit_label(array $limit): string
        {
            return $limit['currency'] . ' '
                . rtrim(rtrim(number_format((float) $limit['amount'], 2, '.', ''), '0'), '.');
        }

        /**
         * The merchant's offerable payment terms (net days, ascending) from
         * `available_terms` on GET /v1/merchant/{id} — the backend resolves
         * them from the merchant's pricing packages, so this is the
         * authoritative set the admin narrows from (TWO-24812; the brand
         * file no longer carries a term list). Empty means either the set
         * cannot currently be resolved (no API key yet, no successful fetch
         * yet) or the backend explicitly returned an empty list (nothing
         * offerable) — in both cases no terms are offered and the backend
         * applies the account default, the same degrade posture as
         * Magento's SettingsProvider.
         *
         * By default this only READS the cached option — it never blocks on
         * HTTP, because the terms seam is reached from contexts that must
         * not stall (the gateway constructor via init_form_fields, cart
         * totals, wc-ajax). A refresh (15-minute TTL, 10s request cap) runs
         * only where `$refresh = true` is passed: the checkout render
         * bootstrap and the admin payment-terms field render. The stored
         * list is only overwritten by a successful response carrying an
         * `available_terms` array; a fetch failure (or an older backend
         * omitting the field) serves the last-known list for another TTL
         * rather than blanking the checkout's term set on an API blip.
         *
         * The cache lives in two dedicated brand-prefixed wp_options, NOT
         * the gateway settings blob: WC_Settings_API::update_option rewrites
         * the entire settings array from this request's in-memory snapshot,
         * so a checkout-render refresh writing into the blob could silently
         * revert a concurrent admin settings save wholesale.
         *
         * @param bool $refresh allow a TTL-gated fetch on this call
         * @return int[]
         */
        public function get_merchant_available_terms(bool $refresh = false): array
        {
            $terms_option = WC_Twoinc_Brand::prefixed_name('merchant_available_terms');
            $checked_option = WC_Twoinc_Brand::prefixed_name('merchant_available_terms_checked_on');

            if ($refresh && $this->get_merchant_id() && $this->get_option('api_key')) {
                $checked_on = get_option($checked_option);
                if (!$checked_on || ((int) $checked_on + 900) <= time()) {
                    // Bump the clock before fetching (stampede guard), and
                    // on failure too: one stall per TTL, not per view.
                    update_option($checked_option, time(), false);
                    $record = $this->fetch_merchant_record();
                    $terms = is_array($record) ? ($record['available_terms'] ?? null) : null;
                    if (is_array($terms)) {
                        // is_numeric guard: a malformed element (nested
                        // array, bool) must not intval to a phantom
                        // "1 day" term.
                        $days = array_values(array_unique(array_filter(
                            array_map(
                                static function ($t) {
                                    return is_numeric($t) ? (int) $t : 0;
                                },
                                $terms
                            ),
                            static function ($t) {
                                return $t > 0;
                            }
                        )));
                        sort($days);
                        update_option($terms_option, wp_json_encode($days), false);
                    }
                }
            }

            $cached = get_option($terms_option);
            if (!$cached) {
                return [];
            }
            $terms = json_decode((string) $cached, true);
            return is_array($terms) ? array_map('intval', $terms) : [];
        }

        /**
         * Drop every cached derivative of the merchant record (and the
         * per-request memo). Called when the merchant identity changes
         * (new API key, new merchant id) — serve-stale caching must never
         * serve the OLD merchant's values under a new identity, and the
         * stale entries would otherwise never self-heal (the refetch
         * against a mismatched id fails, which the serve-stale posture
         * keeps). Also the cleanup path for deactivation.
         *
         * When adding a merchant-record consumer, register its option name
         * pair (value + checked_on) here.
         */
        private function invalidate_merchant_record_caches(): void
        {
            self::reset_merchant_record_memo();
            $names = [
                'merchant_available_terms',
                'merchant_available_terms_checked_on',
                'days_on_invoice',
                'days_on_invoice_checked_on',
                'platform_minimum_order',
                'platform_minimum_order_checked_on',
                'merchant_surcharge_limit',
                'merchant_surcharge_limit_checked_on',
            ];
            foreach ($names as $name) {
                delete_option(WC_Twoinc_Brand::prefixed_name($name));
            }
        }

        /**
         * Get about twoinc html
         */
        private function get_abt_twoinc_html()
        {
            $abt_url = WC_Twoinc_Brand::get('about_url');
            // A brand with no about page ('' — e.g. ABN, whose subtitle
            // already carries its own "lees meer" link) renders nothing
            // here, regardless of the merchant's show_abt_link setting.
            if ($this->get_option('show_abt_link') === 'yes' && $abt_url !== '') {
                $product_name = WC_Twoinc_Brand::get('product_name');
                $link = '<a href="' . esc_url($abt_url) . '" target="_blank">' . sprintf(__('What is %s?', 'twoinc-payment-gateway'), $product_name) . '</a>';
                $text = sprintf(
                    '<p>%s</p><p><b>%s</b></p>',
                    sprintf(__('%s is a payment solution for B2B purchases online, allowing you to buy from your favourite merchants and suppliers on trade credit. Using %s, you can access flexible trade credit instantly to make purchasing simple.', 'twoinc-payment-gateway'), $product_name, $product_name),
                    __('Buy now, receive your goods, pay your invoice later.', 'twoinc-payment-gateway'),
                    $abt_url,
                );
                $html = sprintf('<div class="abt-twoinc-text">%s</div><div class="abt-twoinc-link">%s</div>', $text, $link);
            } else {
                $html = '';
            }

            /**
             * Filter the "about" block inside the payment-box subtitle —
             * the piece of the description brand overlays actually
             * replace (a brand overlay ships its own bullet list).
             * Register by plugins_loaded (computed at gateway
             * construction).
             *
             * @param string    $html    Default about-block HTML ('' when
             *                           the merchant disabled the link).
             * @param WC_Twoinc $gateway The gateway instance.
             */
            return apply_filters('twoinc_about_html', $html, $this);
        }

        /**
         * Buyer-facing notice shown once order intent is approved, pending
         * final checks. A brand overlay may set 'intent_approved_notice'
         * to '' to suppress it entirely.
         */
        private function get_intent_approved_notice(): string
        {
            $template = WC_Twoinc_Brand::get('intent_approved_notice');
            if ($template === '') {
                return '';
            }
            return sprintf(__($template, 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
        }

        /**
         * Get payment box description
         */
        private function get_pay_box_description()
        {
            // The selected term rides the checkout form post so
            // process_payment can validate it without the session. The chips
            // JS maintains its own hidden input INSIDE the chips container
            // (later in the DOM, so it wins the POST when chips render);
            // this server-side one covers the single-term case, where the
            // chip chooser never renders and JS posts nothing (TWO-24812 —
            // a withdrawn single term must abort, not silently re-price).
            $term_input = '';
            if (class_exists('WC_Twoinc_Payment_Terms') && WC_Twoinc_Payment_Terms::is_enabled($this)) {
                $selected = WC_Twoinc_Payment_Terms::get_selected_term($this);
                if ($selected !== null) {
                    $term_input = sprintf(
                        '<input type="hidden" name="%s" value="%d" />',
                        esc_attr(WC_Twoinc_Payment_Terms::SESSION_KEY),
                        $selected
                    );
                }
            }

            return sprintf(
                '<div>
                    <div class="twoinc-pay-box twoinc-explainer">%s</div>
                    <div class="twoinc-sole-trader-toggle hidden" role="radiogroup"></div>
                    %s
                    <div class="twoinc-term-chips hidden" role="radiogroup"></div>
                    <div class="twoinc-pay-box twoinc-loader hidden"></div>
                    <div class="twoinc-pay-box twoinc-intent-approved hidden">%s</div>
                    <div class="twoinc-pay-box twoinc-err-payment-default hidden">%s</div>
                    <div class="twoinc-pay-box twoinc-err-phone-number hidden">%s</div>
                </div>',
                sprintf(__('%s lets your business pay later for the goods you purchase online.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name')),
                $term_input,
                $this->get_intent_approved_notice(),
                sprintf(__('Invoice purchase with %s is not available for this order.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name')),
                __('Phone number is invalid.', 'twoinc-payment-gateway')
            );
        }

        /**
         * Admin option list of the merchant's offerable term days (from
         * GET /v1/merchant `available_terms`), for the payment-terms
         * settings fields. Mirrors Magento's AvailablePaymentTerms source
         * model: the backend owns which terms exist; the admin narrows.
         *
         * @param bool $refresh allow a TTL-gated fetch (admin field render only)
         * @return array<string, string>
         */
        private function get_payment_term_day_options(bool $refresh = false): array
        {
            $options = [];
            foreach ($this->get_merchant_available_terms($refresh) as $days) {
                $options[strval((int) $days)] = sprintf(__('%s days', 'twoinc-payment-gateway'), (int) $days);
            }
            return $options;
        }

        /**
         * Option list for the "Default Payment Term" select: exactly the terms
         * the merchant currently offers (ticked checkboxes ∪ custom day), not
         * every brand preset. Mirrors Magento's AvailablePaymentTerms source
         * model, so the dropdown reflects the saved selection on render (admin
         * JS keeps it in sync live before save).
         *
         * @return array<string, string>
         */
        private function get_offered_payment_term_options(): array
        {
            $options = [];
            if (class_exists('WC_Twoinc_Payment_Terms')) {
                foreach (WC_Twoinc_Payment_Terms::get_available_terms($this) as $days) {
                    $options[strval((int) $days)] = sprintf(__('%s days', 'twoinc-payment-gateway'), (int) $days);
                }
            }
            return $options;
        }

        /**
         * Admin option list of the brand's surcharge rounding steps, in
         * canonical two-decimal form so the stored value round-trips
         * against the option list (WC_Twoinc_Payment_Terms reads it back).
         * Mirrors the Magento RoundingStep source model.
         *
         * @return array<string, string>
         */
        private function get_rounding_step_options(): array
        {
            $options = [];
            $brand_steps = WC_Twoinc_Brand::get('available_rounding_steps');
            foreach (is_array($brand_steps) ? $brand_steps : [] as $step) {
                if (!is_numeric($step) || (float) $step <= 0) {
                    continue;
                }
                $value = number_format((float) $step, 2, '.', '');
                $options[$value] = $value;
            }
            // Ascending, mirroring the Magento Loader's numeric sort (keys
            // are the formatted strings, so equal values already dedup).
            ksort($options, SORT_NUMERIC);
            return $options;
        }

        /**
         * Enforce that a saved rounding step is one the brand actually
         * offers. WooCommerce's default select validation sanitises but does
         * not enforce option-list membership, so without this a tampered or
         * stale POST could persist an arbitrary step that build_rounding()
         * would relay verbatim to the pricing API. Empty ('' = no rounding)
         * is allowed; any other value must be a current option.
         */
        public function validate_surcharge_rounding_step_field($key, $value)
        {
            $value = trim((string) $value);
            if ($value === '') {
                return '';
            }
            if (!array_key_exists($value, $this->get_rounding_step_options())) {
                throw new Exception(__('Rounding step must be one of the offered values.', 'twoinc-payment-gateway'));
            }
            return $value;
        }

        /**
         * Admin option list for the surcharge tax class: the store's LIVE
         * additional tax classes (WC_Tax::get_tax_classes), keyed by slug —
         * the value WC_Cart_Fees::add_fee() resolves rates by. Built fresh
         * on every settings render, never hardcoded, so it always mirrors
         * WooCommerce → Settings → Tax. Mirrors core's
         * wc_get_product_tax_class_options() slug mapping (minus the
         * implicit Standard entry, which is the 'standard' treatment mode).
         *
         * @return array<string, string> slug => display name
         */
        public function get_surcharge_tax_class_options(): array
        {
            $options = ['' => __('— select a tax class —', 'twoinc-payment-gateway')];
            if (!class_exists('WC_Tax')) {
                return $options;
            }
            foreach ((array) WC_Tax::get_tax_classes() as $name) {
                $name = (string) $name;
                if ($name === '') {
                    continue;
                }
                $slug = sanitize_title($name);
                if ($slug === '') {
                    // A pathological class name (e.g. all punctuation) can
                    // sanitize to '' — skip it rather than overwrite the
                    // placeholder option keyed by ''.
                    continue;
                }
                $options[$slug] = $name;
            }
            return $options;
        }

        /**
         * Visible warning for the surcharge tax class field when the stored
         * selection no longer matches a live tax class (the merchant deleted
         * it). Without this the failure is silent twice over: core's
         * add_fee() would quietly tax the fee as Standard, and the effective-
         * treatment resolver (WC_Twoinc_Payment_Terms::
         * resolve_surcharge_tax_treatment) therefore deliberately degrades
         * to standard mode — this notice is what makes that degradation
         * visible to the merchant.
         */
        public function get_surcharge_tax_class_stale_notice(): string
        {
            if ($this->get_option('surcharge_tax_treatment') !== 'custom_class') {
                return '';
            }
            $stored = trim((string) $this->get_option('surcharge_tax_class'));
            if ($stored === '' || array_key_exists($stored, $this->get_surcharge_tax_class_options())) {
                return '';
            }
            return sprintf(
                __('⚠ The previously selected tax class ("%s") no longer exists. The surcharge is currently taxed under the Standard treatment — select an existing tax class or change the tax treatment above.', 'twoinc-payment-gateway'),
                // The notice is rendered as raw HTML in the settings field
                // description, so escape the stored value (it may have been
                // written outside the dropdown, e.g. direct DB/API edits).
                esc_html($stored)
            );
        }

        /**
         * A sibling field's value as it will stand AFTER this save: the
         * posted value when the field is in the submission, else the stored
         * option. Lets one field's validator enforce a cross-field invariant
         * against the state actually being saved, not the stale stored one
         * (e.g. enabling surcharges and picking a tax treatment in the same
         * save must pass).
         */
        private function get_sibling_field_save_value(string $key): string
        {
            $post_data = $this->get_post_data();
            $field_key = $this->get_field_key($key);
            if (is_array($post_data) && array_key_exists($field_key, $post_data)) {
                // Non-scalar values (e.g. a tampered field[]= submission)
                // are meaningless for these scalar selects — treat as unset
                // rather than tripping PHP's array-to-string warning.
                return is_scalar($post_data[$field_key]) ? trim((string) $post_data[$field_key]) : '';
            }
            $stored = $this->get_option($key);
            return is_scalar($stored) ? trim((string) $stored) : '';
        }

        /**
         * Block ENABLING surcharges while no valid surcharge tax treatment
         * is selected (server-side — the treatment field has no default, so
         * a never-configured shop posts the '' placeholder). Enforced on
         * this field, not just the treatment field, because WooCommerce's
         * per-field validation only skips the failing field: without this
         * check a save could enable surcharges while the treatment error
         * merely left the treatment unset. Disabling ('none') never needs a
         * treatment.
         */
        public function validate_surcharge_type_field($key, $value)
        {
            $value = is_scalar($value) ? trim((string) $value) : '';
            // Same enabled-set the runtime uses (get_surcharge_settings
            // coerces anything else to 'none'), so the gate matches what
            // will actually surcharge.
            if (
                in_array($value, ['percentage', 'fixed', 'fixed_and_percentage'], true)
                && !in_array(
                    $this->get_sibling_field_save_value('surcharge_tax_treatment'),
                    ['standard', 'custom_class', 'always_zero'],
                    true
                )
            ) {
                throw new Exception(__('Select a surcharge tax treatment before enabling surcharges.', 'twoinc-payment-gateway'));
            }
            return $value;
        }

        /**
         * Enforce that a saved surcharge tax treatment is one of the three
         * supported modes (WooCommerce's default select validation sanitises
         * but does not enforce option-list membership). The '' placeholder
         * is only storable while surcharges are (staying) disabled — with
         * surcharges enabled a real treatment must be selected; there is no
         * silent fall-back to Standard at save time.
         */
        public function validate_surcharge_tax_treatment_field($key, $value)
        {
            $value = is_scalar($value) ? trim((string) $value) : '';
            if ($value === '') {
                $type = $this->get_sibling_field_save_value('surcharge_type');
                if (in_array($type, ['percentage', 'fixed', 'fixed_and_percentage'], true)) {
                    throw new Exception(__('Select a surcharge tax treatment — surcharges cannot be used without one.', 'twoinc-payment-gateway'));
                }
                return '';
            }
            if (!in_array($value, ['standard', 'custom_class', 'always_zero'], true)) {
                throw new Exception(__('Surcharge tax treatment must be one of the offered modes.', 'twoinc-payment-gateway'));
            }
            return $value;
        }

        /**
         * Enforce that a saved surcharge tax class is one of the store's
         * live tax classes ('' = none selected is allowed; the effective
         * treatment then degrades to standard). Guards against a tampered
         * or stale POST persisting a slug that WC_Cart_Fees::add_fee()
         * would silently tax as Standard.
         */
        public function validate_surcharge_tax_class_field($key, $value)
        {
            $value = trim((string) $value);
            if ($value === '') {
                return '';
            }
            if (!array_key_exists($value, $this->get_surcharge_tax_class_options())) {
                throw new Exception(__('Surcharge tax class must be one of the store\'s existing tax classes.', 'twoinc-payment-gateway'));
            }
            return $value;
        }

        /**
         * Render the per-term surcharge grid (WC Settings API custom field
         * `two_surcharge_grid`). One row per offered term, columns
         * fixed/percentage/cap, mirroring the Magento surcharge grid. Values
         * are stored as a single option array keyed by term days.
         */
        public function generate_two_surcharge_grid_html($key, $data)
        {
            $field_key = $this->get_field_key($key);
            $data = wp_parse_args($data, ['title' => '', 'description' => '']);
            $stored = $this->get_option($key);
            $stored = is_array($stored) ? $stored : [];
            $terms = class_exists('WC_Twoinc_Payment_Terms') ? WC_Twoinc_Payment_Terms::get_available_terms($this) : [];
            // The grid render is a sanctioned refresh point for the
            // funding-partner cap (admin context, TWO-24954). The Max label
            // carries the SAME currency guard as the save-validation: when
            // the cap's currency differs from the store currency the cap is
            // not enforced here (Woo does no FX conversion, unlike Magento,
            // which converts and so can always show a local maximum), and
            // the grid must not claim a limit it won't enforce — the
            // backend enforces instead. Omitted entirely when no cap
            // exists or on a currency mismatch.
            $fixed_limit = $this->get_merchant_surcharge_limit(true);
            $fixed_limit_label = $fixed_limit && $fixed_limit['currency'] === strtoupper((string) get_woocommerce_currency())
                ? $this->format_surcharge_limit_label($fixed_limit)
                : '';

            ob_start();
            // Rendered rows mirror the SAVED offered set; admin.js keeps the
            // grid live against unsaved term ticks (rows keyed by data-days,
            // inputs named like the server-rendered ones) and toggles column
            // visibility from the surcharge method — mirroring Magento's
            // surcharge-grid.js. Keep the classes/data attributes in sync
            // with initSurchargeGrid there.
            ?>
            <tr valign="top" class="twoinc-surcharge-grid-field">
                <th scope="row" class="titledesc"><label><?php echo wp_kses_post($data['title']); ?></label></th>
                <td class="forminp">
                    <?php if ($data['description']) : ?>
                        <p class="description"><?php echo wp_kses_post($data['description']); ?></p>
                    <?php endif; ?>
                    <p class="twoinc-surcharge-grid-empty"<?php echo empty($terms) ? '' : ' style="display:none"'; ?>><?php esc_html_e('No payment terms are offered yet — configure the offered terms above first.', 'twoinc-payment-gateway'); ?></p>
                    <table class="widefat twoinc-surcharge-grid" data-field-key="<?php echo esc_attr($field_key); ?>" style="max-width:620px<?php echo empty($terms) ? ';display:none' : ''; ?>">
                        <thead><tr>
                            <th><?php esc_html_e('Term (days)', 'twoinc-payment-gateway'); ?></th>
                            <th class="twoinc-col-fixed"><?php esc_html_e('Fixed', 'twoinc-payment-gateway'); ?></th>
                            <th class="twoinc-col-percentage"><?php esc_html_e('Percentage (%)', 'twoinc-payment-gateway'); ?></th>
                            <th class="twoinc-col-limit"><?php esc_html_e('Cap', 'twoinc-payment-gateway'); ?></th>
                        </tr></thead>
                        <tbody>
                        <?php foreach ($terms as $days) :
                            $row = isset($stored[$days]) && is_array($stored[$days]) ? $stored[$days] : []; ?>
                            <tr data-days="<?php echo esc_attr($days); ?>">
                                <td><?php echo esc_html($days); ?></td>
                                <td class="twoinc-col-fixed"><input type="text" name="<?php echo esc_attr($field_key); ?>[<?php echo esc_attr($days); ?>][fixed]" value="<?php echo esc_attr(isset($row['fixed']) ? $row['fixed'] : ''); ?>" style="width:90px" /></td>
                                <td class="twoinc-col-percentage"><input type="text" name="<?php echo esc_attr($field_key); ?>[<?php echo esc_attr($days); ?>][percentage]" value="<?php echo esc_attr(isset($row['percentage']) ? $row['percentage'] : ''); ?>" style="width:90px" /></td>
                                <td class="twoinc-col-limit"><input type="text" name="<?php echo esc_attr($field_key); ?>[<?php echo esc_attr($days); ?>][limit]" value="<?php echo esc_attr(isset($row['limit']) ? $row['limit'] : ''); ?>" style="width:90px" /></td>
                            </tr>
                        <?php endforeach; ?>
                        </tbody>
                    </table>
                    <?php if ($fixed_limit_label !== '') : ?>
                        <p class="description"><?php echo esc_html(sprintf(
                            /* translators: %s: maximum fixed amount with currency, e.g. "EUR 25" */
                            __('Enter the amount you want to charge your customer. Max %s.', 'twoinc-payment-gateway'),
                            $fixed_limit_label
                        )); ?></p>
                    <?php endif; ?>
                </td>
            </tr>
            <?php
            return ob_get_clean();
        }

        /**
         * Validate + normalise the posted surcharge grid into an array keyed
         * by term days, each row holding the non-empty of fixed/percentage/
         * limit as canonical numeric strings. Empty cells are dropped; blank
         * rows omitted. Rejects negatives and out-of-range percentages.
         */
        public function validate_two_surcharge_grid_field($key, $value)
        {
            // Funding-partner cap on the per-term fixed fee (TWO-24954).
            // Only enforceable when the cap's currency matches the store
            // currency — Woo does no FX conversion (unlike Magento), so on
            // a mismatch the cap is skipped here and the backend enforces.
            $max_fixed = null;
            $limit = $this->get_merchant_surcharge_limit(true);
            if ($limit && $limit['currency'] === strtoupper((string) get_woocommerce_currency())) {
                $max_fixed = (float) $limit['amount'];
            }

            $clean = [];
            // A non-array POST means NO grid rows were rendered (empty term
            // list at render time) — fall through to the preservation loop
            // rather than wiping the stored grid.
            $posted = is_array($value) ? $value : [];
            foreach ($posted as $days => $cols) {
                $days = (int) $days;
                if ($days <= 0 || !is_array($cols)) {
                    continue;
                }
                $row = [];
                foreach (['fixed', 'percentage', 'limit'] as $col) {
                    $raw = isset($cols[$col]) ? trim(str_replace(',', '.', (string) $cols[$col])) : '';
                    if ($raw === '') {
                        continue;
                    }
                    if (!is_numeric($raw) || (float) $raw < 0) {
                        throw new Exception(sprintf(
                            /* translators: 1: column name, 2: term days */
                            __('Surcharge %1$s for the %2$s-day term must be a non-negative number.', 'twoinc-payment-gateway'),
                            $col,
                            $days
                        ));
                    }
                    if ($col === 'percentage' && (float) $raw > 100) {
                        throw new Exception(sprintf(
                            /* translators: %s: term days */
                            __('Surcharge percentage for the %s-day term must be between 0 and 100.', 'twoinc-payment-gateway'),
                            $days
                        ));
                    }
                    if ($col === 'fixed' && $max_fixed !== null && (float) $raw > $max_fixed) {
                        throw new Exception(sprintf(
                            /* translators: 1: term days, 2: maximum amount with currency */
                            __('Surcharge fixed amount for the %1$s-day term exceeds the maximum of %2$s.', 'twoinc-payment-gateway'),
                            $days,
                            $this->format_surcharge_limit_label($limit)
                        ));
                    }
                    $row[$col] = $raw;
                }
                if (!empty($row)) {
                    $clean[$days] = $row;
                }
            }

            // Preserve stored rows for terms whose row was NOT on the form.
            // A rendered row always posts its three inputs (even blank), so
            // absence from the POSTed array — not the live term set, which
            // can shift between render and save (backend-sourced, and the
            // sibling payment_terms_days field validates first) — is the
            // honest "never rendered" signal. A rendered-and-blanked row
            // posts its key, lands nothing in $clean, and is deliberately
            // dropped; an unrendered stored row survives untouched for the
            // term the backend (or the admin's ticks) later restores.
            //
            // Preserved rows deliberately bypass the funding-partner cap
            // check above: the admin can neither see nor fix a row that
            // was never rendered, so failing the whole save on it would be
            // a dead end. Save-time enforcement is UX parity with Magento;
            // the funding partner's backend is the authoritative
            // enforcement point for anything that slips through.
            $stored = $this->get_option($key);
            foreach (is_array($stored) ? $stored : [] as $days => $row) {
                $days = (int) $days;
                // A key only counts as "rendered" when it posted the row's
                // input array — a malformed scalar entry must not delete
                // the stored row as if it had been deliberately blanked.
                $was_rendered = array_key_exists($days, $posted) && is_array($posted[$days]);
                if ($days > 0 && is_array($row) && !$was_rendered && !isset($clean[$days])) {
                    $clean[$days] = $row;
                }
            }
            return $clean;
        }

        /**
         * Render the "Payment Terms" checkboxes (WC Settings API custom field
         * `two_payment_terms`). One checkbox per term the merchant's account
         * makes available (GET /v1/merchant `available_terms`); the merchant
         * ticks which to offer the buyer. Stored as a single option array of
         * int day counts (the offered subset). Mirrors Magento's
         * PaymentTermsCheckboxes admin field.
         */
        public function generate_two_payment_terms_html($key, $data)
        {
            $field_key = $this->get_field_key($key);
            $data = wp_parse_args($data, ['title' => '', 'description' => '', 'desc_tip' => false]);
            $stored = $this->get_option($key);
            $stored = is_array($stored) ? array_map('intval', $stored) : [];
            // The admin field render is one of the two sanctioned refresh
            // points (the other is the checkout render bootstrap).
            $options = $this->get_payment_term_day_options(true);
            if (count($stored) === 0 && count($options) > 0) {
                // Prepopulate the shortest available term so the form never loads
                // with no selection (a selection is mandatory on save).
                $days = array_map('intval', array_keys($options));
                sort($days);
                $stored = [$days[0]];
            }

            // Inline merchant-rate fee beside each checkbox (mirrors Magento's
            // showInlineFees). Brand overlays opt out by setting the brand
            // 'inline_term_fees' config to false; default on.
            $inline_fees = WC_Twoinc_Brand::get('inline_term_fees');
            $show_fees = ($inline_fees === null) ? true : (bool) $inline_fees;

            ob_start();
            ?>
            <tr valign="top">
                <th scope="row" class="titledesc">
                    <label><?php echo wp_kses_post($data['title']); ?></label>
                    <?php echo $this->get_tooltip_html($data); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
                </th>
                <td class="forminp">
                    <?php if (empty($options)) : ?>
                        <p><?php esc_html_e('No payment terms are available from your merchant account yet. Check that a valid API key is saved; if it is, the term list will load on the next refresh.', 'twoinc-payment-gateway'); ?></p>
                    <?php else : ?>
                    <fieldset class="twoinc-term-checkboxes"<?php echo $show_fees ? ' data-fees="1"' : ''; ?>>
                        <?php foreach ($options as $value => $label) :
                            $days = (int) $value; ?>
                            <label style="display:block;margin-bottom:4px">
                                <input type="checkbox"
                                       class="twoinc-term-checkbox"
                                       name="<?php echo esc_attr($field_key); ?>[]"
                                       value="<?php echo esc_attr($days); ?>"
                                       <?php checked(in_array($days, $stored, true)); ?> />
                                <?php echo esc_html($label); ?>
                                <?php if ($show_fees) : ?>
                                    <span class="twoinc-term-fee" data-term="<?php echo esc_attr($days); ?>" style="color:#666"></span>
                                <?php endif; ?>
                            </label>
                        <?php endforeach; ?>
                    </fieldset>
                    <?php endif; ?>
                </td>
            </tr>
            <?php
            return ob_get_clean();
        }

        /**
         * Validate the posted "Payment Terms" checkboxes into a sorted array of
         * unique int day counts, restricted to the merchant's available terms.
         *
         * A selection is mandatory on save. "No selection" is well-defined
         * internally (an empty offer falls through to the account default), but
         * it gives the merchant no feedback on the resulting behaviour, so we
         * insist on a selection every time they save. The custom-days sibling
         * field (posted in the same form) also satisfies it, so a single
         * off-preset term may be offered alone. Mirrors Magento's
         * PaymentTermsCheckboxes::beforeSave guard.
         */
        public function validate_two_payment_terms_field($key, $value)
        {
            $stored = $this->get_option($key);
            $stored = is_array($stored) ? array_values(array_unique(array_map('intval', $stored))) : [];

            // Cache-only read: the list the checkboxes were rendered from.
            $allowed = array_map('intval', array_keys($this->get_payment_term_day_options()));

            // Unresolved (or explicitly empty) backend set: the checkboxes
            // were never rendered, so an empty POST is not a merchant
            // choice — keep the stored selection untouched rather than
            // erasing it or throwing the mandatory-selection error (a fresh
            // install's first API-key save lands here).
            if (count($allowed) === 0) {
                return $stored;
            }

            // Non-destructive against a list that narrowed between render
            // and save: a previously saved day stays saveable even if the
            // current backend list no longer carries it. The read-time
            // intersect in WC_Twoinc_Payment_Terms enforces the live list;
            // save-time filtering must not permanently erase the tick.
            $allowed = array_values(array_unique(array_merge($allowed, $stored)));

            $clean = [];
            if (is_array($value)) {
                foreach ($value as $day) {
                    $day = (int) $day;
                    if ($day > 0 && in_array($day, $allowed, true)) {
                        $clean[] = $day;
                    }
                }
            }
            $clean = array_values(array_unique($clean));
            sort($clean);

            $custom_key = $this->get_field_key('payment_terms_custom_days');
            $posted_custom = isset($_POST[$custom_key]) ? (int) $_POST[$custom_key] : 0; // phpcs:ignore WordPress.Security.NonceVerification.Missing
            if (count($clean) === 0 && $posted_custom <= 0) {
                throw new Exception(__('Select at least one payment term or enter a custom term.', 'twoinc-payment-gateway'));
            }
            return $clean;
        }

        /**
         * Validate the optional custom payment term: a non-negative whole number
         * of days, or blank. Mirrors Magento's payment_terms_duration_days
         * (validate-digits validate-zero-or-greater).
         */
        public function validate_payment_terms_custom_days_field($key, $value)
        {
            $value = trim((string) $value);
            if ($value === '') {
                return '';
            }
            if (!ctype_digit($value)) {
                throw new Exception(__('Custom Payment Term (days) must be a whole number of days.', 'twoinc-payment-gateway'));
            }
            return (string) (int) $value;
        }

        /**
         * Coerce the saved default to a term actually being offered. The
         * offered set is computed from the POSTed sibling fields (they save in
         * the same request, so the stored options are stale here), mirroring
         * the offered set the admin JS rebuilds the dropdown from. If the
         * posted default is no longer offered (e.g. its checkbox was just
         * unticked), repoint to the shortest offered term so the stored
         * default is always coherent. Mirrors Magento's payment-terms-config.js
         * default-term repointing.
         */
        public function validate_default_payment_term_field($key, $value)
        {
            $options = $this->get_payment_term_day_options();

            // Unresolved backend list: the checkbox field never rendered,
            // so nothing (or only the custom term) posted — that is not a
            // merchant decision about the default. Keep the stored value
            // BEFORE the custom-term append below, or a saved custom term
            // would silently repoint the default on an API-blip save. Same
            // degrade path as validate_two_payment_terms_field; read-time
            // get_default_term repairs any residual incoherence.
            if (count($options) === 0) {
                $current = $this->get_option($key);
                return is_scalar($current) ? (string) $current : '';
            }

            $offered = [];
            // Same union as validate_two_payment_terms_field: a previously
            // saved day survives a backend list that narrowed between render
            // and save, so the default must not be repointed off it either.
            $stored = $this->get_option('payment_terms_days');
            $stored = is_array($stored) ? array_map('intval', $stored) : [];
            $allowed = array_map('intval', array_keys($options));
            $allowed = array_values(array_unique(array_merge($allowed, $stored)));

            $terms_key = $this->get_field_key('payment_terms_days');
            $posted_terms = isset($_POST[$terms_key]) ? (array) $_POST[$terms_key] : []; // phpcs:ignore WordPress.Security.NonceVerification.Missing
            foreach ($posted_terms as $day) {
                $day = (int) $day;
                if ($day > 0 && in_array($day, $allowed, true)) {
                    $offered[] = $day;
                }
            }

            $custom_key = $this->get_field_key('payment_terms_custom_days');
            $posted_custom = isset($_POST[$custom_key]) ? (int) $_POST[$custom_key] : 0; // phpcs:ignore WordPress.Security.NonceVerification.Missing
            if ($posted_custom > 0) {
                $offered[] = $posted_custom;
            }

            $offered = array_values(array_unique($offered));
            sort($offered);

            $value = (int) $value;
            if (in_array($value, $offered, true)) {
                return (string) $value;
            }
            if (count($offered) > 0) {
                return (string) $offered[0];
            }
            // Rendered but nothing survived (all ticks removed and rejected
            // upstream) — no coherent default to point at.
            return '';
        }

        /**
         * Get payment subtitle
         */
        public function get_pay_subtitle()
        {
            $subtitle = WC_Twoinc_Brand::get('checkout_subtitle');
            // wp_kses_post, not esc_html: a brand's subtitle may carry an
            // inline link (e.g. ABN's "lees meer") — esc_html stripped it.
            $subtitle_html = $subtitle
                ? sprintf(
                    '<div class="twoinc-payment-subtitle">%s</div>',
                    wp_kses_post(__($subtitle, 'twoinc-payment-gateway'))
                )
                : '';

            return sprintf(
                '%s<div class="abt-twoinc">%s</div>',
                $subtitle_html,
                $this->get_abt_twoinc_html(),
            );
        }

        /**
         * Get payment HTML title
         */
        public function get_pay_html_title()
        {
            return sprintf(
                '<span class="payment-term-number">%s</span><span class="payment-term-nonumber">%s</span>',
                sprintf(
                    __($this->get_option('title'), 'twoinc-payment-gateway'),
                    '<span class="due-in-days">' . strval($this->get_merchant_default_days_on_invoice()) . '</span>'
                ),
                __('Pay on invoice with agreed terms', 'twoinc-payment-gateway')
            );
        }

        /**
         * Add filter to gateway payment title
         */
        public function change_twoinc_payment_title()
        {
            add_filter('woocommerce_gateway_title', function ($title, $payment_id) {
                if ($payment_id === $this->id) {
                    $title = $this->get_pay_html_title();
                }
                return $title;
            }, 10, 2);
        }

        /**
         * Verify API key action
         *
         * Using admin_enqueue_scripts passes the page name as the first argument which prevents the merchant_id from being updated.
         */
        public function verify_api_key_action()
        {
            $this->verify_api_key();
        }

        public function verify_api_key($api_key = null)
        {
            $api_key_to_use = $api_key ?: $this->get_option('api_key');

            if (!$api_key_to_use || !$this->get_twoinc_checkout_host()) {
                return;
            }

            $response = $this->make_request("/v1/merchant/verify_api_key", [], 'GET', [], $api_key_to_use);

            if (!$response || is_wp_error($response)) {
                return;
            }
            if (isset($response['body'])) {
                $body = json_decode($response['body'], true);
                $code = $response['response']['code'];
                if ($code == 200 && isset($body['id']) && !$api_key) {
                    // Only persist when verifying the saved API key. verify_api_key
                    // returns {id, short_name}; cache both for the settings display.
                    if ((string) $this->get_option('merchant_id') !== (string) $body['id']) {
                        // Different merchant resolved: the cached term list
                        // belongs to the old identity and must not be served
                        // (serve-stale would otherwise pin it — TWO-24812).
                        $this->invalidate_merchant_record_caches();
                    }
                    $this->update_option('merchant_id', $body['id']);
                    $this->update_option('merchant_short_name', isset($body['short_name']) ? (string) $body['short_name'] : '');
                }
                return ['body' => $body, 'code' => $code];
            }
        }



        /**
         * Add invoice and credit note URLs
         */
        public function add_invoice_credit_note_urls($order)
        {
            if (!WC_Twoinc_Helper::is_twoinc_order($order)) {
                return;
            }

            if ($order->get_status() !== 'completed' && $order->get_status() !== 'refunded') {
                return;
            }

            $twoinc_order_id = $this->get_twoinc_order_id($order);

            if ($twoinc_order_id) {
                // Route the downloads through the plugin's admin-ajax handler
                // (ajax_download_invoice) instead of linking straight at the
                // API: a direct link surfaces the raw 400 ORDER_NOT_FULFILLED
                // JSON when the order is still being fulfilled, while the
                // handler can check the order state and show a proper notice
                // (TWO-25041).
                $download_url = function ($variant) use ($order) {
                    return wp_nonce_url(
                        add_query_arg(
                            [
                                'action' => 'twoinc_download_invoice',
                                'order_id' => $order->get_id(),
                                'variant' => $variant,
                            ],
                            admin_url('admin-ajax.php')
                        ),
                        // Scope the nonce to the exact order + variant this
                        // link authorizes — not the shared twoinc_admin_nonce
                        // action the unrelated XHR handlers use.
                        "twoinc_download_invoice_{$order->get_id()}_{$variant}"
                    );
                };

                print('<div style="margin-top:20px;float:left;">');

                print('<p><a href="' . esc_url($download_url('original'))
                    . '"><button type="button" class="button">'
                    . sprintf(__('Download %s invoice', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'))
                    . '</button></a></p>');

                $refunded_payments = array_filter($order->get_refunds(), fn($refund) => $refund->get_refunded_payment());
                if (count($refunded_payments) > 0) {
                    print('<p><a href="' . esc_url($download_url('credit_note'))
                        . '"><button type="button" class="button">'
                        . sprintf(__('Download %s credit note', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'))
                        . '</button></a><p>');
                }

                print('</div>');
            }
        }

        /**
         * Timeout (seconds) for the admin invoice-download API calls. The
         * download is a blocking browser navigation that can chain up to
         * three serial requests (invoice fetch, order-state fetch, invoice
         * retry), so it uses a tighter timeout than make_request's default
         * 30s — scoped to this call site only.
         */
        private const INVOICE_DOWNLOAD_TIMEOUT = 10;

        /**
         * Resolve an admin invoice/credit-note download attempt into a
         * discriminated result — either the PDF bytes to stream or an admin
         * notice — implementing the ORDER_NOT_FULFILLED state check
         * (TWO-25041):
         *
         *   - invoice fetch OK → stream the PDF
         *   - 400 ORDER_NOT_FULFILLED → GET /v1/order/{id} and branch on state:
         *       FULFILLING → info notice "not ready yet, try again later"
         *       FULFILLED  → retry the invoice fetch once; error notice if it
         *                    fails again
         *       any other  → info notice naming the state
         *   - any other error → error notice (same terminal path as before
         *     the state check existed)
         *
         * Pure branching over make_request (no echo/exit/headers) so the
         * unit runner can cover every branch; ajax_download_invoice maps the
         * result to stream-or-redirect.
         *
         * @param $order WC_Order
         * @param string $variant 'original' | 'credit_note'
         *
         * @return array ['action' => 'stream', 'body' => string, 'filename' => string]
         *             | ['action' => 'notice', 'level' => 'info'|'error', 'message' => string]
         */
        public function resolve_invoice_download($order, $variant)
        {
            $product_name = WC_Twoinc_Brand::get('product_name');

            $twoinc_order_id = $this->get_twoinc_order_id($order);
            if (!$twoinc_order_id) {
                return [
                    'action' => 'notice',
                    'level' => 'error',
                    'message' => sprintf(__('No %s order reference is set for this order.', 'twoinc-payment-gateway'), $product_name),
                ];
            }

            $endpoint = "/v1/invoice/{$twoinc_order_id}/pdf";
            $params = ['lang' => WC_Twoinc_Helper::get_locale()];
            if ($variant === 'original') {
                $params['v'] = 'original';
            }

            $response = $this->make_request($endpoint, [], 'GET', $params, null, self::INVOICE_DOWNLOAD_TIMEOUT);

            if ($this->is_pdf_response($response)) {
                return $this->invoice_stream_result($response, $variant, $twoinc_order_id, $product_name);
            }

            if (is_wp_error($response)) {
                return $this->invoice_unreachable_notice($product_name);
            }

            $code = (int) wp_remote_retrieve_response_code($response);
            $body = json_decode(wp_remote_retrieve_body($response), true);
            $error_code = (is_array($body) && isset($body['error_code']) && is_string($body['error_code'])) ? $body['error_code'] : '';

            if ($code !== 400 || $error_code !== 'ORDER_NOT_FULFILLED') {
                // Any error other than ORDER_NOT_FULFILLED keeps today's
                // terminal-error behaviour.
                return $this->invoice_error_notice($response, $product_name);
            }

            // Invoice not ready: ask the API what state the order is in.
            $order_response = $this->make_request("/v1/order/{$twoinc_order_id}", [], 'GET', [], null, self::INVOICE_DOWNLOAD_TIMEOUT);
            $state = '';
            if (!is_wp_error($order_response) && (int) wp_remote_retrieve_response_code($order_response) === 200) {
                $order_body = json_decode(wp_remote_retrieve_body($order_response), true);
                if (is_array($order_body) && isset($order_body['state']) && is_string($order_body['state'])) {
                    $state = $order_body['state'];
                }
            }
            if ($state === '') {
                return $this->invoice_unreachable_notice($product_name);
            }

            if ($state === 'FULFILLING') {
                return [
                    'action' => 'notice',
                    'level' => 'info',
                    'message' => __('The invoice for this order is still being prepared. Please try again later.', 'twoinc-payment-gateway'),
                ];
            }

            if ($state === 'FULFILLED') {
                // The order claims fulfilled, so the 400 was likely a race —
                // retry once. No retry on other states (pointless).
                $retry = $this->make_request($endpoint, [], 'GET', $params, null, self::INVOICE_DOWNLOAD_TIMEOUT);
                if ($this->is_pdf_response($retry)) {
                    return $this->invoice_stream_result($retry, $variant, $twoinc_order_id, $product_name);
                }
                if (is_wp_error($retry)) {
                    return $this->invoice_unreachable_notice($product_name);
                }
                return $this->invoice_error_notice($retry, $product_name);
            }

            return [
                'action' => 'notice',
                'level' => 'info',
                'message' => sprintf(__('No %1$s invoice is available because the order is in state: %2$s.', 'twoinc-payment-gateway'), $product_name, $state),
            ];
        }

        /**
         * A response is streamable only if it is a 200 that actually carries
         * a PDF (content-type or %PDF- magic bytes) — never stream a JSON
         * error body as a .pdf.
         */
        private function is_pdf_response($response)
        {
            if (is_wp_error($response) || (int) wp_remote_retrieve_response_code($response) !== 200) {
                return false;
            }
            $content_type = wp_remote_retrieve_header($response, 'content-type');
            if (is_string($content_type) && stripos($content_type, 'application/pdf') !== false) {
                return true;
            }
            return strpos((string) wp_remote_retrieve_body($response), '%PDF-') === 0;
        }

        private function invoice_stream_result($response, $variant, $twoinc_order_id, $product_name)
        {
            $slug = strtolower(trim(preg_replace('/[^A-Za-z0-9]+/', '-', $product_name), '-'));
            $kind = $variant === 'credit_note' ? 'credit-note' : 'invoice';
            // The order id is order meta (normally a UUID, but never
            // validated) and lands in a quoted Content-Disposition filename
            // — strip anything that could break out of the quoting.
            $safe_id = preg_replace('/[^A-Za-z0-9_-]/', '', (string) $twoinc_order_id);
            return [
                'action' => 'stream',
                'body' => wp_remote_retrieve_body($response),
                'filename' => "{$slug}-{$kind}-{$safe_id}.pdf",
            ];
        }

        private function invoice_unreachable_notice($product_name)
        {
            return [
                'action' => 'notice',
                'level' => 'error',
                'message' => sprintf(__('Could not reach %s to retrieve the invoice. Please try again.', 'twoinc-payment-gateway'), $product_name),
            ];
        }

        private function invoice_error_notice($response, $product_name)
        {
            $message = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if (!$message) {
                $message = sprintf(__('Could not retrieve the %s invoice.', 'twoinc-payment-gateway'), $product_name);
            }
            // get_twoinc_error_msg returns the generic "Response code from
            // X: NNN" for any >= 400 response before it ever reaches its
            // error_code branch, so surface the API's error_code alongside
            // it where the body carries one.
            $body = json_decode((string) wp_remote_retrieve_body($response), true);
            if (is_array($body) && isset($body['error_code']) && is_string($body['error_code']) && $body['error_code'] !== '' && strpos($message, $body['error_code']) === false) {
                $message .= ' (' . $body['error_code'] . ')';
            }
            return [
                'action' => 'notice',
                'level' => 'error',
                'message' => $message,
            ];
        }

        /**
         * Admin-ajax handler for wp_ajax_twoinc_download_invoice — the
         * invoice / credit-note buttons on the admin order edit screen.
         *
         * This is a browser navigation (link click), not an XHR POST like
         * twoinc_ajax_verify_api_key / twoinc_ajax_term_fees, so — unlike
         * those handlers' wp_verify_nonce($_POST['nonce']) pattern — the
         * nonce travels as the _wpnonce query arg and is verified with
         * check_admin_referer(). Registered in load_twoinc_classes().
         */
        public static function ajax_download_invoice()
        {
            $order_id = isset($_GET['order_id']) ? absint($_GET['order_id']) : 0;
            $variant = isset($_GET['variant']) ? sanitize_key(wp_unslash($_GET['variant'])) : '';

            // The nonce action is scoped to the exact order + variant the
            // link was minted for (add_invoice_credit_note_urls), so the
            // request params must be read before the nonce can be checked.
            check_admin_referer("twoinc_download_invoice_{$order_id}_{$variant}");

            if (!in_array($variant, ['original', 'credit_note'], true)) {
                wp_die(__('Invalid invoice variant.', 'twoinc-payment-gateway'), '', ['response' => 400]);
            }

            $order = $order_id ? wc_get_order($order_id) : false;
            if (!$order || !WC_Twoinc_Helper::is_twoinc_order($order)) {
                wp_die(__('Order not found.', 'twoinc-payment-gateway'), '', ['response' => 404]);
            }

            // Gate on the per-order meta capability (WC's idiom for
            // per-order actions), NOT manage_options or the blanket
            // edit_shop_orders type capability: shop managers must not be
            // locked out, but plugins that scope order visibility per user
            // (multi-vendor etc.) hook the meta-cap, so the check must name
            // the specific order being downloaded.
            if (!current_user_can('edit_shop_order', $order_id)) {
                wp_die(__('You are not allowed to download this invoice.', 'twoinc-payment-gateway'), '', ['response' => 403]);
            }

            $result = self::get_instance()->resolve_invoice_download($order, $variant);

            if ($result['action'] === 'stream') {
                // Discard anything already buffered (admin-ajax and
                // third-party plugins are known to leave stray output or
                // whitespace) — any preceding bytes corrupt the PDF.
                while (ob_get_level()) {
                    ob_end_clean();
                }
                nocache_headers();
                header('Content-Type: application/pdf');
                header('Content-Disposition: attachment; filename="' . $result['filename'] . '"');
                header('Content-Length: ' . strlen($result['body']));
                // Raw PDF bytes — must not be escaped or re-encoded.
                echo $result['body']; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
                exit;
            }

            // Notice outcome: park the message in a short-TTL one-shot
            // transient and bounce back to the order edit screen, where
            // render_invoice_download_notice (admin_notices) pops it.
            // Keyed by user AND order: two order tabs downloading close
            // together must not overwrite each other's notice (and a notice
            // for order A must never render on order B's screen).
            set_transient('twoinc_invoice_notice_' . get_current_user_id() . '_' . $order_id, [
                'level' => $result['level'],
                'message' => $result['message'],
            ], 60);

            // get_edit_order_url() is HPOS-aware, unlike get_edit_post_link
            // (which also HTML-encodes ampersands — wrong for a Location
            // header); pair it with esc_url_raw, not esc_url, to keep the
            // redirect URL raw.
            wp_safe_redirect(esc_url_raw(wp_specialchars_decode($order->get_edit_order_url())));
            exit;
        }

        /**
         * Render (and clear) the one-shot invoice-download notice parked by
         * ajax_download_invoice for the current user.
         *
         * Static and registered on admin_notices in load_twoinc_classes()
         * (plugins_loaded), not in the gateway constructor: on the order
         * edit screen the gateway is only constructed during the order-data
         * metabox render, after admin_notices has fired, so a
         * constructor-registered callback never runs on the very request
         * that should display the notice.
         */
        public static function render_invoice_download_notice()
        {
            // admin_notices fires on every wp-admin page, but the transient
            // is scoped to one order — only render it on that order's edit
            // screen. Resolve the order id the way WooCommerce routes the
            // two order-edit screens: HPOS is admin.php?page=wc-orders&id=N,
            // legacy is post.php?post=N.
            if (isset($_GET['page'], $_GET['id']) && sanitize_key(wp_unslash($_GET['page'])) === 'wc-orders') {
                $order_id = absint($_GET['id']);
            } elseif (isset($_GET['post'])) {
                $order_id = absint($_GET['post']);
            } else {
                return;
            }
            if (!$order_id) {
                return;
            }

            $key = 'twoinc_invoice_notice_' . get_current_user_id() . '_' . $order_id;
            $notice = get_transient($key);
            if (!is_array($notice) || !isset($notice['message'])) {
                return;
            }
            delete_transient($key);
            $class = (isset($notice['level']) && $notice['level'] === 'info') ? 'notice-info' : 'notice-error';
            printf(
                '<div class="notice %s is-dismissible"><p>%s</p></div>',
                esc_attr($class),
                esc_html($notice['message'])
            );
        }

        /**
         * Enqueue the admin styles and scripts
         *
         * @return void
         */
        public function twoinc_admin_styles_scripts()
        {
            if (!did_action('wp_enqueue_media')) {
                wp_enqueue_media();
            }

            wp_enqueue_script('twoinc.admin', WC_TWOINC_PLUGIN_URL . '/assets/js/admin.js', ['jquery']);
            wp_enqueue_style('twoinc.admin', WC_TWOINC_PLUGIN_URL . '/assets/css/admin.css');

            // Localize script for AJAX
            wp_localize_script('twoinc.admin', 'twoinc_admin', [
                'gateway_id' => $this->id,
                'nonce' => wp_create_nonce('twoinc_admin_nonce'),
                'ajax_url' => admin_url('admin-ajax.php'),
                // %s days label for the live Default Payment Term rebuild.
                'days_label' => __('%s days', 'twoinc-payment-gateway'),
                // Decimal separator for rendering fetched inline fee amounts.
                'decimal_separator' => wc_get_price_decimal_separator(),
                // Merchant-offered terms (cache-only read): the live surcharge
                // grid mirrors ticked terms ∩ this list, matching the PHP
                // render's get_available_terms() intersection.
                'merchant_available_terms' => $this->get_merchant_available_terms(),
                // Stored grid values: rows the live grid re-creates must carry
                // the saved cell values — an empty re-created row would post
                // blank cells and wipe the stored row on save (the validator
                // treats rendered-and-blank as a deliberate clear).
                'surcharge_grid' => (array) $this->get_option('surcharge_grid', []),
            ]);
        }

        /**
         * Notify Twoinc API after order item update
         *
         * @param $order
         */
        public function after_order_item_update($order)
        {
            if (!WC_Twoinc_Helper::is_twoinc_order($order)) {
                return;
            }

            if (!isset($_POST) || !isset($_POST['action'])) {
                return;
            }
            $action = sanitize_text_field($_POST['action']);

            $twoinc_meta = $this->get_save_twoinc_meta($order);
            if (!$twoinc_meta) {
                return;
            }

            if ($action == 'woocommerce_add_order_item') {
                $order->calculate_totals(true);
                $this->process_update_twoinc_order($order, $twoinc_meta, true);
            } elseif ($action == 'woocommerce_remove_order_item') {
                $this->process_update_twoinc_order($order, $twoinc_meta, true);
            } elseif ($action == 'woocommerce_save_order_items') {
                $this->process_update_twoinc_order($order, $twoinc_meta, true);
            } elseif ($action == 'woocommerce_add_order_fee') {
                $this->process_update_twoinc_order($order, $twoinc_meta, true);
            } elseif ($action == 'woocommerce_add_order_shipping') {
                $this->process_update_twoinc_order($order, $twoinc_meta, true);
                // } else if ($action == 'woocommerce_add_order_tax') {
                // } else if ($action == 'woocommerce_remove_order_tax') {
            } elseif ($action == 'woocommerce_calc_line_taxes') {
                $this->process_update_twoinc_order($order, $twoinc_meta, true);
            }
        }

        /**
         * After the order update by post.php
         *
         * @param $order_id
         * @param $items
         */
        public function after_order_update($post_id, $post, $update, $post_before)
        {

            if (!isset($_POST) || !isset($_POST['action']) || 'editpost' !== sanitize_text_field($_POST['action'])) {
                return;
            }

            $order = wc_get_order($post_id);
            if ('shop_order' !== $post->post_type || !WC_Twoinc_Helper::is_twoinc_order($order)) {
                return;
            }

            $twoinc_meta = $this->get_save_twoinc_meta($order);
            if (!$twoinc_meta) {
                return;
            }

            $this->process_update_twoinc_order($order, $twoinc_meta);
        }

        /**
         * Another hook to call the function on_order_completed
         *
         * @param $order_id
         * @param $to_status
         */
        public static function on_order_edit_status($order_id, $to_status)
        {
            $wc_twoinc_instance = WC_Twoinc::get_instance();

            $to_status = strtolower($to_status);
            if ($to_status == 'completed') {
                $wc_twoinc_instance->on_order_completed($order_id);
            } elseif ($to_status == 'cancelled') {
                $wc_twoinc_instance->on_order_cancelled($order_id);
            } elseif ($to_status == 'refunded') {
                $wc_twoinc_instance->on_order_refunded($order_id);
            }
        }

        /**
         * Hook to call upon bulk order update to completed or cancelled status
         *
         * @param $redirect
         * @param $doaction
         * @param $object_ids
         */
        public static function on_order_bulk_edit_action($redirect, $doaction, $object_ids)
        {
            $wc_twoinc_instance = WC_Twoinc::get_instance();
            $success = [];
            $failure = [];
            if ('mark_completed' === $doaction) {
                foreach ($object_ids as $order_id) {
                    $result = $wc_twoinc_instance->on_order_completed($order_id);
                    if ($result === true) {
                        $success[] = $order_id;
                    } elseif ($result === false) {
                        $failure[] = $order_id;
                    }
                }
                $redirect = add_query_arg(
                    array(
                        'bulk_action' => 'marked_completed',
                        'two_success' => implode(",", $success),
                        'two_failure' => implode(",", $failure),
                    ),
                    $redirect
                );
            } elseif ('mark_cancelled' === $doaction) {
                foreach ($object_ids as $order_id) {
                    $result = $wc_twoinc_instance->on_order_cancelled($order_id);
                    if ($result === true) {
                        $success[] = $order_id;
                    } elseif ($result === false) {
                        $failure[] = $order_id;
                    }
                }
                $redirect = add_query_arg(
                    array(
                        'bulk_action' => 'marked_cancelled',
                        'two_success' => implode(",", $success),
                        'two_failure' => implode(",", $failure),
                    ),
                    $redirect
                );
            }
            return $redirect;
        }

        /**
         * Notice for when orders are bulk edited
         *
         */
        public static function on_order_bulk_edit_notices()
        {
            if (!isset($_REQUEST['bulk_action'])) {
                return;
            }

            $bulk_action = $_REQUEST['bulk_action'];
            if (!in_array($bulk_action, ["marked_completed", "marked_cancelled"])) {
                return;
            }

            $failure_order_ids = [];
            if (isset($_REQUEST['two_failure']) && $_REQUEST['two_failure']) {
                $failure_order_ids = explode(",", $_REQUEST['two_failure']);
            }
            $success_order_ids = [];
            if (isset($_REQUEST['two_success']) && $_REQUEST['two_success']) {
                $success_order_ids = explode(",", $_REQUEST['two_success']);
            }
            $success = count($success_order_ids);
            if ($_REQUEST['bulk_action'] == "marked_completed") {
                if ($success) {
                    $success_notice = _n(
                        '%s has acknowledged request to fulfill %d order. An invoice will be sent to the buyer when the fulfilment is complete.',
                        '%s has acknowledged request to fulfill %d orders. Invoices will be sent to the buyers when the fulfilments are complete.',
                        $success,
                        'twoinc-payment-gateway'
                    );
                    printf('<div id="message" class="notice notice-success is-dismissible"><p>' . $success_notice . '</p></div>', WC_Twoinc_Brand::get('product_name'), $success);
                }
                foreach ($failure_order_ids as $order_id) {
                    $failure_notice = __('%s has failed to issue invoice for order %s.', 'twoinc-payment-gateway');
                    $order_url = sprintf('<a href="%s">%s</a>', wc_get_order($order_id)->get_edit_order_url(), $order_id);
                    printf('<div id="message" class="notice notice-error is-dismissible"><p>' . $failure_notice . '</p></div>', WC_Twoinc_Brand::get('product_name'), $order_url);
                }
            } elseif ($_REQUEST['bulk_action'] == "marked_cancelled") {
                if ($success) {
                    $success_notice = _n('%s has cancelled %d order.', '%s has cancelled %d orders.', $success, 'twoinc-payment-gateway');
                    printf('<div id="message" class="notice notice-success is-dismissible"><p>' . $success_notice . '</p></div>', WC_Twoinc_Brand::get('product_name'), $success);
                }
                foreach ($failure_order_ids as $order_id) {
                    $failure_notice = __('%s has failed to cancel order %s.', 'twoinc-payment-gateway');
                    $order_url = sprintf('<a href="%s">%s</a>', wc_get_order($order_id)->get_edit_order_url(), $order_id);
                    printf('<div id="message" class="notice notice-error is-dismissible"><p>' . $failure_notice . '</p></div>', WC_Twoinc_Brand::get('product_name'), $order_url);
                }
            }
        }

        /**
         * Notify Twoinc API when the order status is completed
         *
         * @param $order_id
         */
        public function on_order_completed($order_id)
        {

            // Get the order
            $order = wc_get_order($order_id);

            // Check payment method
            if (!WC_Twoinc_Helper::is_twoinc_order($order)) {
                return;
            }

            // Get the Two order ID
            $twoinc_order_id = $this->get_twoinc_order_id($order);
            if (!$twoinc_order_id) {
                $error_message = sprintf(__('Could not update status to "Fulfilled" with %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $error_reason = sprintf(__('Reason: Could not find %s order ID.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $order->add_order_note($error_message . " " . $error_reason);
                return false;
            }

            $state = $order->get_meta(WC_Twoinc_Brand::meta_key('order_state'), true);
            if (in_array($state, self::TERMINAL_ORDER_STATES)) {
                // $order->add_order_note(sprintf(__('Order is already fulfilled with Two.', 'twoinc-payment-gateway'), $twoinc_order_id));
                return;
            }

            // Push tracking (shipping_details) BEFORE fulfilling: the Two
            // API only accepts order edits pre-fulfilment, so this is the
            // last chance for the buyer's invoice to carry the tracking
            // number. Gated on tracking actually being present so ordinary
            // fulfilments don't grow an extra edit round-trip, and
            // best-effort by design: an edit failure must never block
            // fulfilment (process_update_twoinc_order only leaves an order
            // note on failure). Tracking added AFTER completion cannot be
            // forwarded — the edit endpoint rejects fulfilled orders
            // (TWO-24762).
            $shipping_details = WC_Twoinc_Helper::get_shipping_details($order);
            if (isset($shipping_details['tracking_number']) && $shipping_details['tracking_number'] !== '') {
                $twoinc_meta = $this->get_save_twoinc_meta($order);
                $tracking_synced = $twoinc_meta && $this->process_update_twoinc_order($order, $twoinc_meta);
                if (!$tracking_synced) {
                    // The generic edit-failure note already added downstream
                    // says "contact support"; this one says what was
                    // actually lost so the merchant isn't left guessing.
                    $order->add_order_note(sprintf(
                        __('The tracking number could not be attached to the %s order. The invoice will be sent without it.', 'twoinc-payment-gateway'),
                        WC_Twoinc_Brand::get('product_name')
                    ));
                }
            }

            // Change the order status
            $response = $this->make_request("/v1/order/{$twoinc_order_id}/fulfillments");

            if (is_wp_error($response)) {
                $error_message = sprintf(
                    __('Could not update order status to "Fulfilled" with %s.', 'twoinc-payment-gateway'),
                    WC_Twoinc_Brand::get('product_name'),
                    $twoinc_order_id
                );
                $contact_message = sprintf(__('Please contact %s support with order ID: %s', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'), $twoinc_order_id);
                $order->add_order_note($error_message . " " . $contact_message);
                return false;
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                $error_message = sprintf(
                    __('Could not update order status to "Fulfilled" with %s.', 'twoinc-payment-gateway'),
                    WC_Twoinc_Brand::get('product_name'),
                    $twoinc_order_id
                );
                $contact_message = sprintf(__('Please contact %s support with order ID: %s', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'), $twoinc_order_id);
                $response_message = sprintf(__('Response: %s', 'twoinc-payment-gateway'), $twoinc_err);
                $order->add_order_note($error_message . " " . $contact_message . " " . $response_message);
                return false;
            }

            // Add order note
            $order_note = sprintf(__('%s has acknowledged the request to fulfil the order. An invoice will be sent to the buyer when the fulfilment is complete.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
            $order->add_order_note($order_note);

            // Decode the response
            $body = json_decode($response['body'], true);
            $order->update_meta_data(WC_Twoinc_Brand::meta_key('order_state'), 'FULFILLING');
            $order->save();
            do_action('twoinc_order_completed', $order, $body);

            // Deliberate gap (TWO-24757): no merchant self-invoice upload on
            // fulfilment. The PrestaShop plugin uploads its native invoice
            // PDF to Two here when the merchant's
            // invoice_distributed_by_merchant flag is set; WooCommerce has
            // no native invoice renderer, so supporting this would mean
            // bundling a PDF generator (e.g. dompdf) into client sites — a
            // maintenance and security overhead we won't take on without
            // demand. If that demand materialises, implement it here: queue
            // an Action Scheduler background job after the fulfillments
            // call above (TWO-24757 has the full design).
            return true;
        }

        /**
         * Notify Twoinc API when the order status is cancelled
         *
         * @param $order_id
         */
        public function on_order_cancelled($order_id)
        {
            // Get the order
            $order = wc_get_order($order_id);

            // Check payment method
            if (!WC_Twoinc_Helper::is_twoinc_order($order)) {
                return;
            }

            // Get the Two order ID
            $twoinc_order_id = $this->get_twoinc_order_id($order);

            if (!$twoinc_order_id) {
                $error_message = sprintf(__('Could not update status to "Cancelled".', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $error_reason = sprintf(__('Reason: Could not find %s order ID.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $order->add_order_note($error_message . " " . $error_reason);
                return false;
            }

            $state = $order->get_meta(WC_Twoinc_Brand::meta_key('order_state'), true);
            if ($state == 'CANCELLED') {
                $order_note = sprintf(__('Order is already cancelled with %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $order->add_order_note($order_note);
                return;
            }

            // Change the order status
            $response = $this->make_request("/v1/order/{$twoinc_order_id}/cancel");

            if (is_wp_error($response)) {
                $error_message = __('Could not update status to "Cancelled".', 'twoinc-payment-gateway');
                $contact_message = sprintf(__('Please contact %s support with order ID: %s', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'), $twoinc_order_id);
                $order->add_order_note($error_message . " " . $contact_message);
                return false;
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                $error_message = __('Could not update status to "Cancelled".', 'twoinc-payment-gateway');
                $contact_message = sprintf(__('Please contact %s support with order ID: %s', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'), $twoinc_order_id);
                $response_message = sprintf(__('Response: %s', 'twoinc-payment-gateway'), $twoinc_err);
                $order->add_order_note($error_message . " " . $contact_message . " " . $response_message);
                return false;
            }

            $order->update_meta_data(WC_Twoinc_Brand::meta_key('order_state'), "CANCELLED");
            $order->save();
            do_action('twoinc_order_cancelled', $order, $response);
            return true;
        }

        /**
         * Notify Twoinc API when the order status is refunded
         *
         * @param $order_id
         */
        public function on_order_refunded($order_id)
        {
            // Get the order
            $order = wc_get_order($order_id);
            $state = $order->get_meta(WC_Twoinc_Brand::meta_key('order_state'), true);
            if ($state == 'REFUNDED') {
                return;
            }
            $result = $this->process_refund($order_id);
            if ($result && is_wp_error($result)) {
                $order->add_order_note($result->get_error_message());
            }
            return;
        }

        /**
         * Display user meta fields on user edit admin page
         *
         * @param $user
         *
         * @return void
         */
        public static function display_user_meta_edit($user)
        {
            ?>
            <h3><?php printf(__('%s pre-filled fields', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name')); ?></h3>

            <table class="form-table">
                <tr>
                    <th><label for="twoinc_billing_company"><?php _e('Billing Company name', 'twoinc-payment-gateway'); ?></label></th>
                    <td>
                        <input type="text" name="twoinc_billing_company" id="twoinc_billing_company" value="<?php echo esc_attr(get_the_author_meta(WC_Twoinc_Brand::prefixed_name('billing_company'), $user->ID)); ?>" class="regular-text" />
                    </td>
                </tr>
                <tr>
                    <th><label for="twoinc_company_id"><?php _e('Billing Company ID', 'twoinc-payment-gateway'); ?></label></th>
                    <td>
                        <input type="text" name="twoinc_company_id" id="twoinc_company_id" value="<?php echo esc_attr(get_the_author_meta(WC_Twoinc_Brand::prefixed_name('company_id'), $user->ID)); ?>" class="regular-text" />
                    </td>
                </tr>
                <tr>
                    <th><label for="twoinc_department"><?php _e('Department', 'twoinc-payment-gateway'); ?></label></th>
                    <td>
                        <input type="text" name="twoinc_department" id="twoinc_department" value="<?php echo esc_attr(get_the_author_meta(WC_Twoinc_Brand::prefixed_name('department'), $user->ID)); ?>" class="regular-text" />
                        <br />
                        <span class="description"><?php _e("The department displayed on the invoices"); ?></span>
                    </td>
                </tr>
                <tr>
                    <th><label for="twoinc_project"><?php _e('Project', 'twoinc-payment-gateway'); ?></label></th>
                    <td>
                        <input type="text" name="twoinc_project" id="twoinc_project" value="<?php echo esc_attr(get_the_author_meta(WC_Twoinc_Brand::prefixed_name('project'), $user->ID)); ?>" class="regular-text" />
                        <br />
                        <span class="description"><?php _e("The project displayed on the invoices"); ?></span>
                    </td>
                </tr>
            </table>
            <?php
        }

        /**
         * Save user meta to DB on user edit
         *
         * @param $user_id
         *
         * @return void
         */
        public static function save_user_meta($user_id)
        {

            if (empty($_POST['_wpnonce']) || ! wp_verify_nonce($_POST['_wpnonce'], 'update-user_' . $user_id)) {
                return;
            }

            if (!current_user_can('edit_user', $user_id)) {
                return false;
            }

            update_user_meta($user_id, WC_Twoinc_Brand::prefixed_name('company_id'), $_POST['twoinc_company_id']);
            update_user_meta($user_id, WC_Twoinc_Brand::prefixed_name('billing_company'), $_POST['twoinc_billing_company']);
            update_user_meta($user_id, WC_Twoinc_Brand::prefixed_name('department'), $_POST['twoinc_department']);
            update_user_meta($user_id, WC_Twoinc_Brand::prefixed_name('project'), $_POST['twoinc_project']);
        }

        /**
         * Process the payment
         *
         * @param int $order_id
         *
         * @return array
         */
        /**
         * Remove the gateway from checkout when the platform minimum
         * (API-resolved, see get_platform_minimum_order()), the brand's
         * billing-country restriction (availability_gate in the brand
         * config), or the merchant's own minimum is unmet. Mirrors the
         * brand availability gate semantics: front-end only, minimum is
         * inclusive (an exactly-minimum basket passes).
         *
         * @param array $available_gateways
         *
         * @return array
         */
        public function apply_brand_availability_gate($available_gateways)
        {
            if (is_admin() || !isset($available_gateways[$this->id])) {
                return $available_gateways;
            }
            $gate = WC_Twoinc_Brand::get('availability_gate');
            if ($gate && !isset($gate['billing_countries'])) {
                // A truthy but malformed gate must not judge with missing
                // criteria; leave the gateway available and let the log
                // below stay quiet (config bug, not a basket decision).
                $gate = null;
            }
            $platform_minimum = $this->get_platform_minimum_order();
            $merchant_minimum = $this->get_merchant_minimum_order();
            if (!$gate && !$platform_minimum && !$merchant_minimum) {
                return $available_gateways;
            }
            if (!function_exists('WC') || !WC()->cart || !WC()->customer) {
                return $available_gateways;
            }

            // Basket value on each minimum's own basis - the platform
            // minimum's basis is explicit (a funding partner's rule may
            // be net; the platform's defaults are gross) and the merchant
            // selects theirs independently.
            $basket_value = static function (string $basis): float {
                return $basis === 'gross'
                    ? (float) WC()->cart->total
                    : (float) WC()->cart->total - (float) WC()->cart->get_total_tax();
            };

            // The minimums judge the basket being purchased. On the
            // pay-for-order page the session cart is not that basket (it
            // is usually empty, and anything in it is unrelated to the
            // order being paid), so only the billing-country gate applies
            // there and in any other cartless context — the API still
            // enforces the platform minimum at order creation.
            $basket_is_judgeable = !WC()->cart->is_empty()
                && !(function_exists('is_wc_endpoint_url') && is_wc_endpoint_url('order-pay'));

            // A basket in another currency is judged by converting its
            // value into the minimum's currency via the Two FX layer
            // (TWO-25104): last-known-good rates, so a transient rates-API
            // failure never flaps the gateway. Null (no rate ever fetched,
            // or an unsupported currency) fails CLOSED — a basket that
            // cannot be proven to satisfy a minimum is not offered the
            // gateway; the API still enforces the platform minimum at
            // order creation. Same-currency baskets never touch the FX
            // layer.
            $meets_minimum = function (array $minimum) use ($basket_value): bool {
                $value = $basket_value($minimum['basis']);
                $basket_currency = get_woocommerce_currency();
                if ($basket_currency !== $minimum['currency']) {
                    $value = WC_Twoinc_FX::convert($this, $value, $basket_currency, $minimum['currency']);
                    if ($value === null) {
                        return false;
                    }
                }
                return $value >= $minimum['amount'];
            };

            $satisfied = true;
            if ($platform_minimum && $basket_is_judgeable) {
                $satisfied = $meets_minimum($platform_minimum);
            }
            if ($satisfied && $gate) {
                $satisfied = in_array(WC()->customer->get_billing_country(), $gate['billing_countries'], true);
            }
            if ($satisfied && $merchant_minimum && $basket_is_judgeable) {
                $satisfied = $meets_minimum($merchant_minimum);
            }
            if (!$satisfied) {
                unset($available_gateways[$this->id]);
                // Removing a payment method is invisible to the merchant —
                // log the failing basket once per request so a gate
                // misconfiguration doesn't read as the gateway vanishing.
                static $logged = false;
                if (!$logged && function_exists('wc_get_logger')) {
                    $logged = true;
                    wc_get_logger()->info(
                        sprintf(
                            'Availability gate removed %s from checkout (gross=%s net=%s currency=%s country=%s; platform min %s, merchant min %s)',
                            $this->id,
                            $basket_value('gross'),
                            $basket_value('net'),
                            get_woocommerce_currency(),
                            WC()->customer->get_billing_country(),
                            $platform_minimum
                                ? $platform_minimum['amount'] . ' ' . $platform_minimum['currency'] . ' ' . $platform_minimum['basis']
                                : 'none',
                            $merchant_minimum
                                ? $merchant_minimum['amount'] . ' ' . $merchant_minimum['currency'] . ' ' . $merchant_minimum['basis']
                                : 'none'
                        ),
                        ['source' => 'twoinc-payment-gateway']
                    );
                }
            }

            return $available_gateways;
        }

        /**
         * Dynamic description for the Minimum Order Value setting: shows
         * the platform minimum the merchant's value must exceed. The
         * field is interpreted in the STORE currency; when that differs
         * from the platform minimum's currency an approximate store-
         * currency figure converted via the Two FX layer is appended
         * (display conversion — fail soft: without a rate the floor is
         * shown in its native currency only).
         *
         * @return string
         */
        public function get_merchant_minimum_order_description()
        {
            $platform_minimum = $this->get_platform_minimum_order();
            if ($platform_minimum) {
                $native_display = get_woocommerce_currency_symbol($platform_minimum['currency'])
                    . number_format($platform_minimum['amount'], 2);
                $basis_label = $platform_minimum['basis'] === 'gross'
                    ? __('including', 'twoinc-payment-gateway')
                    : __('excluding', 'twoinc-payment-gateway');
                if (get_option('woocommerce_currency') === $platform_minimum['currency']) {
                    return sprintf(
                        __('Platform minimum %1$s, %2$s tax. A value here is interpreted in the store currency on the tax basis selected below and must exceed it.', 'twoinc-payment-gateway'),
                        $native_display,
                        $basis_label
                    );
                }
                $converted = WC_Twoinc_FX::convert(
                    $this,
                    (float) $platform_minimum['amount'],
                    (string) $platform_minimum['currency'],
                    strval(get_option('woocommerce_currency'))
                );
                if ($converted !== null) {
                    return sprintf(
                        /* translators: 1: platform minimum in its native currency, e.g. "EUR 250.00", 2: the same minimum converted into the store currency at the current FX rate, e.g. "NOK 2,941.18", 3: tax basis label, "including" or "excluding" */
                        __('Platform minimum %1$s (approximately %2$s at the current exchange rate), %3$s tax. A value here is interpreted in the store currency on the tax basis selected below — both minimums are enforced independently.', 'twoinc-payment-gateway'),
                        $native_display,
                        get_woocommerce_currency_symbol(get_option('woocommerce_currency')) . number_format($converted, 2),
                        $basis_label
                    );
                }
                return sprintf(
                    __('Platform minimum %1$s, %2$s tax. A value here is interpreted in the store currency on the tax basis selected below; it cannot be checked against the platform minimum (different currency) — both minimums are enforced independently.', 'twoinc-payment-gateway'),
                    $native_display,
                    $basis_label
                );
            }
            return __('Hide the payment method below this order value (store currency, on the tax basis selected below). Leave empty for no minimum.', 'twoinc-payment-gateway');
        }

        /**
         * The merchant's own optional minimum order value, as
         * ['amount', 'currency', 'basis'] or null. Interpreted in the
         * STORE currency (the saved woocommerce_currency option, not the
         * active multicurrency display currency) on the tax basis the
         * merchant selects, falling back to the platform minimum's basis
         * when unset, else gross.
         *
         * @return array|null
         */
        public function get_merchant_minimum_order()
        {
            $value = (float) $this->get_option('merchant_minimum_order');
            if ($value <= 0) {
                return null;
            }
            $basis = (string) $this->get_option('merchant_minimum_order_basis');
            if (!in_array($basis, ['net', 'gross'], true)) {
                $platform_minimum = $this->get_platform_minimum_order();
                $basis = $platform_minimum['basis'] ?? 'gross';
            }
            return [
                'amount' => $value,
                'currency' => get_option('woocommerce_currency'),
                'basis' => $basis,
            ];
        }

        /**
         * Validate the merchant minimum on settings save: numeric and
         * non-negative always; strictly above the platform minimum when
         * the brand declares one IN THE STORE CURRENCY. A platform
         * minimum in another currency is deliberately not floor-checked
         * even though an FX rate may be available (TWO-25104): a save
         * that is valid one day would fail the next as rates drift, so
         * both minimums are enforced independently at checkout instead
         * (the availability gate converts there).
         *
         * @param string $key
         * @param string $value
         *
         * @return string
         * @throws Exception
         */
        public function validate_merchant_minimum_order_field($key, $value)
        {
            $value = trim((string) $value);
            if ($value === '') {
                return '';
            }
            $value = str_replace(',', '.', $value);
            if (!is_numeric($value) || (float) $value < 0) {
                throw new Exception(__('Minimum Order Value must be a non-negative number.', 'twoinc-payment-gateway'));
            }
            $platform_minimum = $this->get_platform_minimum_order();
            if (
                $platform_minimum
                && get_option('woocommerce_currency') === $platform_minimum['currency']
                && (float) $value <= $platform_minimum['amount']
            ) {
                throw new Exception(sprintf(
                    __('Minimum Order Value must exceed the platform minimum of %1$s, %2$s tax.', 'twoinc-payment-gateway'),
                    get_woocommerce_currency_symbol($platform_minimum['currency']) . number_format($platform_minimum['amount'], 2),
                    $platform_minimum['basis'] === 'gross' ? __('including', 'twoinc-payment-gateway') : __('excluding', 'twoinc-payment-gateway')
                ));
            }
            return $value;
        }

        /**
         * Brand veto on payment processing, resolved via the
         * twoinc_payment_validation_error filter (e.g. a brand overlay's
         * required terms-acceptance checkbox). Returns the buyer-facing
         * error message, or null to proceed.
         *
         * @param int $order_id
         *
         * @return string|null
         */
        public function get_brand_payment_validation_error($order_id)
        {
            /**
             * Filter: a brand overlay vetoes payment with a buyer-facing
             * error without overriding process_payment().
             *
             * @param string|null $error    Error message, or null to proceed.
             * @param int         $order_id WooCommerce order id.
             */
            return apply_filters('twoinc_payment_validation_error', null, $order_id);
        }

        public function process_payment($order_id)
        {

            // Get the order
            $order = wc_get_order($order_id);

            // Check payment method
            if (!WC_Twoinc_Helper::is_twoinc_order($order)) {
                return;
            }

            $brand_validation_error = $this->get_brand_payment_validation_error($order_id);
            if ($brand_validation_error) {
                WC_Twoinc_Helper::display_ajax_error($brand_validation_error);
                return;
            }

            // The backend-sourced term list can change between checkout
            // render and submit (TWO-24812). A buyer whose selected term was
            // withdrawn must re-confirm against the current set — silently
            // falling back to the default term could charge a different
            // (potentially higher) surcharge than the total they approved.
            // The count($offered) > 0 exemption is deliberate fail-open: an
            // EMPTY set at submit (mid-session cache invalidation, backend
            // explicit []) sends no term block and drops the surcharge —
            // the order proceeds on pre-feature behaviour rather than
            // hard-blocking every checkout on a cold cache. Do not "tighten"
            // this to abort on an empty set.
            if (class_exists('WC_Twoinc_Payment_Terms')) {
                $posted_term = isset($_POST[WC_Twoinc_Payment_Terms::SESSION_KEY]) ? (int) $_POST[WC_Twoinc_Payment_Terms::SESSION_KEY] : 0;
                $offered = WC_Twoinc_Payment_Terms::get_available_terms($this);
                if ($posted_term > 0 && count($offered) > 0 && !in_array($posted_term, $offered, true)) {
                    WC_Twoinc_Helper::display_ajax_error(
                        __('The selected payment term is no longer available. Please review the payment options and place the order again.', 'twoinc-payment-gateway')
                    );
                    return;
                }
            }

            // Get data
            $company_id = array_key_exists('company_id', $_POST) ? sanitize_text_field($_POST['company_id']) : '';
            $department = array_key_exists('department', $_POST) ? sanitize_text_field($_POST['department']) : '';
            $project = array_key_exists('project', $_POST) ? sanitize_text_field($_POST['project']) : '';
            $purchase_order_number = array_key_exists('purchase_order_number', $_POST) ? sanitize_text_field($_POST['purchase_order_number']) : '';
            $tracking_id = array_key_exists('tracking_id', $_POST) ? sanitize_text_field($_POST['tracking_id']) : '';
            $merchant_id = $this->get_merchant_id();
            $order_reference = wp_generate_password(64, false, false);
            // For requests from order pay page
            $billing_country = array_key_exists('billing_country', $_POST) ? sanitize_text_field($_POST['billing_country']) : '';
            // Sometimes, billing_company_display is sent to the backend instead of billing_company
            $billing_company_display = array_key_exists('billing_company_display', $_POST) ? sanitize_text_field($_POST['billing_company_display']) : '';
            $billing_company = array_key_exists('billing_company', $_POST) ? sanitize_text_field($_POST['billing_company']) : $billing_company_display;
            $billing_phone = array_key_exists('billing_phone', $_POST) ? sanitize_text_field($_POST['billing_phone']) : '';
            $invoice_email = array_key_exists('invoice_email', $_POST) ? sanitize_text_field($_POST['invoice_email']) : '';
            $invoice_emails = $invoice_email ? array_map('sanitize_text_field', explode(',', $invoice_email)) : [];

            // A company (organization number) is mandatory: the order API's
            // CreateOrderRequestSchema requires buyer.company.organization_number
            // and rejects an empty value with a 400 SCHEMA_ERROR. Fail fast with
            // a clear checkout error instead of letting that raw 400 surface as a
            // silent failure when no company has been selected (e.g. the company
            // search result was never picked, or the selection was cleared by a
            // later country change). Sole-trader checkout also populates
            // company_id (via the resolved registry identity), so this guard is
            // safe for both flows.
            if ($company_id === '') {
                WC_Twoinc_Helper::display_ajax_error(
                    sprintf(
                        __('Please select your company before paying with %s.', 'twoinc-payment-gateway'),
                        WC_Twoinc_Brand::get('product_name')
                    )
                );
                return;
            }

            // Store the order meta
            $order->update_meta_data(WC_Twoinc_Brand::meta_key('order_reference'), $order_reference);
            $order->update_meta_data(WC_Twoinc_Brand::meta_key('merchant_id'), $merchant_id);
            $order->update_meta_data('company_id', $company_id);
            $order->update_meta_data('department', $department);
            $order->update_meta_data('project', $project);
            $order->update_meta_data('purchase_order_number', $purchase_order_number);

            // For requests from order pay page: Store in order object, not DB
            if ($billing_country) {
                $order->set_billing_country($billing_country);
            }
            if ($billing_company) {
                $order->set_billing_company($billing_company);
            }
            if ($billing_phone) {
                $order->set_billing_phone($billing_phone);
            }

            // Get payment details
            $payment_reference_message = ''; // strval($order_id);
            if (has_filter('two_payment_reference_message')) {
                $payment_reference_message = apply_filters('two_payment_reference_message', $order_id);
                $order->update_meta_data('_payment_reference_message', $payment_reference_message);
            }
            $payment_reference_ocr = '';
            if (has_filter('two_payment_reference_ocr')) {
                $payment_reference_ocr = apply_filters('two_payment_reference_ocr', $order_id);
                $order->update_meta_data('_payment_reference_ocr', $payment_reference_ocr);
            }
            $payment_reference = '';
            $payment_reference_type = '';
            if (has_filter('two_payment_reference')) {
                $payment_reference = apply_filters('two_payment_reference', $order_id);
                $order->update_meta_data('_payment_reference', $payment_reference);
                $payment_reference_type = 'assigned_by_merchant';
                $order->update_meta_data('_payment_reference_type', $payment_reference_type);
            }
            $order->update_meta_data('_invoice_emails', $invoice_emails);

            $vendor_name = $this->get_option('vendor_name');
            $order->update_meta_data('vendor_name', $vendor_name);

            $payment_terms = WC_Twoinc_Payment_Terms::get_order_payload_terms($this, $order);
            if ($payment_terms) {
                $order->update_meta_data(WC_Twoinc_Brand::meta_key('selected_term_days'), $payment_terms['terms']['duration_days']);
            }

            $order->save();

            // Save to user meta
            $user_id = wp_get_current_user()->ID;
            if ($user_id) {
                if (!get_the_author_meta(WC_Twoinc_Brand::prefixed_name('company_id'), $user_id)) {
                    update_user_meta($user_id, WC_Twoinc_Brand::prefixed_name('company_id'), $company_id);
                }
                if (!get_the_author_meta(WC_Twoinc_Brand::prefixed_name('billing_company'), $user_id)) {
                    update_user_meta($user_id, WC_Twoinc_Brand::prefixed_name('billing_company'), $billing_company);
                }
                if (!get_the_author_meta(WC_Twoinc_Brand::prefixed_name('department'), $user_id)) {
                    update_user_meta($user_id, WC_Twoinc_Brand::prefixed_name('department'), $department);
                }
                if (!get_the_author_meta(WC_Twoinc_Brand::prefixed_name('project'), $user_id)) {
                    update_user_meta($user_id, WC_Twoinc_Brand::prefixed_name('project'), $project);
                }
            }

            // Create order
            $response = $this->make_request('/v1/order', WC_Twoinc_Helper::compose_twoinc_order(
                $order,
                $order_reference,
                $company_id,
                $department,
                $project,
                $purchase_order_number,
                $invoice_emails,
                $payment_reference_message,
                $payment_reference_ocr,
                $payment_reference,
                $payment_reference_type,
                $vendor_name,
                $tracking_id,
                false,
                $payment_terms
            ));

            if (is_wp_error($response)) {
                $error_message = sprintf(__('Failed to request order creation with %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $order->add_order_note($error_message);
                return;
            }

            // Stop on process payment failure
            if (isset($response) && isset($response['result']) && $response['result'] === 'failure') {
                $error_message = sprintf(__('Failed to process payment with %s', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $order->add_order_note($error_message);
                return $response;
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_validation_msg($response);
            if ($twoinc_err) {
                WC_Twoinc_Helper::display_ajax_error($twoinc_err);
                return;
            }

            // Decode the response
            $body = json_decode($response['body'], true);

            if ($body['status'] == 'REJECTED') {
                $error_message = sprintf(__('Invoice purchase with %s is not available for this order.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                // Surface the minimum when the decline is attributable to
                // it: primarily by the API's machine-readable decline
                // reason, with a strictly-below-minimum check as fallback
                // while older backends carry only a generic reason. Same
                // currency only: WooCommerce has no FX rate source.
                $platform_minimum = $this->get_platform_minimum_order();
                if ($platform_minimum) {
                    $order_value = $platform_minimum['basis'] === 'gross'
                        ? (float) $order->get_total()
                        : (float) $order->get_total() - (float) $order->get_total_tax();
                    $declined_on_minimum = ($body['decline_reason'] ?? null) === 'ORDER_BELOW_MIN_INVOICE_AMOUNT'
                        || ($order->get_currency() === $platform_minimum['currency']
                            && $order_value < $platform_minimum['amount']);
                    if ($declined_on_minimum && $order->get_currency() === $platform_minimum['currency']) {
                        $error_message .= ' ' . sprintf(
                            __('Minimum order value is %1$s%2$s %3$s tax.', 'twoinc-payment-gateway'),
                            get_woocommerce_currency_symbol($platform_minimum['currency']),
                            number_format($platform_minimum['amount'], 2),
                            $platform_minimum['basis'] === 'gross' ? __('including', 'twoinc-payment-gateway') : __('excluding', 'twoinc-payment-gateway')
                        );
                    }
                }
                $order->add_order_note($error_message);
                WC_Twoinc_Helper::display_ajax_error($error_message);
                return;
            }

            // Store the Twoinc Order Id for future use
            $order->update_meta_data(WC_Twoinc_Brand::prefixed_name('order_id'), $body['id']);
            $twoinc_meta = $this->get_save_twoinc_meta($order, $body['id']);
            $twoinc_updated_order_hash = WC_Twoinc_Helper::hash_order($order, $twoinc_meta);
            $order->update_meta_data(WC_Twoinc_Brand::meta_key('req_body_hash'), $twoinc_updated_order_hash);

            if (isset($body['state'])) {
                $order->update_meta_data(WC_Twoinc_Brand::meta_key('order_state'), $body['state']);
            }

            $order->save();
            do_action('twoinc_order_created', $order, $body);

            // Return the result
            if ($body['state'] == 'VERIFIED' && isset($body['merchant_urls']) && isset($body['merchant_urls']['merchant_confirmation_url'])) {
                return [
                    'result'    => 'success',
                    'redirect'  => $body['merchant_urls']['merchant_confirmation_url']
                ];
            } else {
                return [
                    'result'    => 'success',
                    'redirect'  => $body['payment_url']
                ];
            }
        }

        /**
         * Process the order refund
         *
         * @return void
         */

        public function process_refund($order_id, $amount = null, $reason = '')
        {
            $order = wc_get_order($order_id);

            // Check payment method
            if (!WC_Twoinc_Helper::is_twoinc_order($order)) {
                return;
            }

            // Get the Two order ID
            $twoinc_order_id = $this->get_twoinc_order_id($order);
            if (!$twoinc_order_id) {
                $error_message = sprintf(__('Failed to request order refund with %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $error_reason = sprintf(__('Reason: Could not find %s order ID.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $order->add_order_note($error_message . ' ' . $error_reason);
                return new WP_Error(
                    'invalid_twoinc_refund',
                    sprintf(__('Could not find %s order ID', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'))
                );
            }

            // Get and check refund data
            $state = $order->get_meta(WC_Twoinc_Brand::meta_key('order_state'), true);
            if ($state === 'REFUNDED') {
                return new WP_Error(
                    'invalid_twoinc_refund',
                    sprintf(__('Order has already been fully refunded with %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'))
                );
            }

            $order_refunds = $order->get_refunds();
            $order_refund = null;
            // Need to loop instead of getting the last element because the last element is not always the latest refund
            foreach ($order_refunds as $refund) {
                if (!$refund->get_refunded_payment()) {
                    if (!$order_refund || $refund->get_date_created() > $order_refund->get_date_created()) {
                        $order_refund = $refund;
                    }
                }
            }

            if (!$order_refund) {
                return false;
            }

            $refund_amount = $order_refund->get_amount();
            if ($amount == null) {
                $amount = $refund_amount;
            } elseif ($amount != $refund_amount) {
                return new WP_Error(
                    'invalid_twoinc_refund',
                    sprintf(__('Could not initiate refund with %s', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'))
                );
            }

            // Send refund request
            $response = $this->make_request(
                "/v1/order/{$twoinc_order_id}/refund",
                WC_Twoinc_Helper::compose_twoinc_refund(
                    $order_refund,
                    $amount,
                    $order->get_currency()
                ),
                'POST'
            );

            // Stop if request error
            if (is_wp_error($response)) {
                $error_message = sprintf(__('Failed to request order refund with %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $order->add_order_note($error_message);
                return false;
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                $error_message = sprintf(__('Failed to request order refund with %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $contact_message = sprintf(__('Please contact %s support with order ID: %s', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'), $twoinc_order_id);
                $response_message = sprintf(__('Response: %s', 'twoinc-payment-gateway'), $twoinc_err);
                $order->add_order_note($error_message . " " . $contact_message . " " . $response_message);
                return new WP_Error(
                    'invalid_twoinc_refund',
                    sprintf(__('Could not initiate refund with %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'))
                );
            }

            // Decode the response
            $body = json_decode($response['body'], true);

            // Check if response is ok
            if (!$body['amount']) {
                $error_message = sprintf(__('Failed to request order refund with %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $contact_message = sprintf(__('Please contact %s support with order ID: %s', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'), $twoinc_order_id);
                $order->add_order_note($error_message . " " . $contact_message);
                return new WP_Error(
                    'invalid_twoinc_refund',
                    sprintf(__('Could not initiate refund with %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'))
                );
            }

            $state = "";
            $remaining_amt = $order->get_total() + (float) $body['amount'];
            if ($remaining_amt < 0.0001 && $remaining_amt > -0.0001) { // full refund, 0.0001 for float inaccuracy
                $order_note = sprintf(__('Invoice has been refunded and credit note has been sent by %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $state = "REFUNDED";
            } else { // partial refund
                $order_note = sprintf(__('Invoice has been partially refunded and credit note has been sent by %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $state = "PARTIALLY_REFUNDED";
            }
            $order->add_order_note($order_note);

            $order->update_meta_data(WC_Twoinc_Brand::meta_key('order_state'), $state);
            $order->save();

            do_action('twoinc_order_refunded', $order, $body);

            return [
                'result'    => 'success',
                'refresh'  => true
            ];
        }

        /**
         * Process the order confirmation, with redirection to confirmation/cancel page using response header
         *
         * @return void
         */
        public static function process_confirmation_header_redirect()
        {

            $wc_twoinc_instance = WC_Twoinc::get_instance();
            $redirect_url = $wc_twoinc_instance->process_confirmation();

            // Execute redirection by header
            if (isset($redirect_url)) {
                wp_redirect($redirect_url);
                exit;
            }
        }

        /**
         * Process the order confirmation, with redirection to confirmation/cancel page using JS
         *
         * @return void
         */
        public static function process_confirmation_js_redirect()
        {

            $wc_twoinc_instance = WC_Twoinc::get_instance();
            $redirect_url = $wc_twoinc_instance->process_confirmation();

            // Execute redirection JS
            if (isset($redirect_url)) {
                printf('<script>window.location.href = "%s";</script>', $redirect_url);
            }
        }

        /**
         * Set header to avoid 404 on confirmation page
         *
         * @return void
         */
        public static function before_process_confirmation()
        {

            $wc_twoinc_instance = WC_Twoinc::get_instance();
            // Set status to avoid 404 for confirmation page
            if ($wc_twoinc_instance->is_confirmation_page()) {
                status_header(200);
            }
        }

        /**
         * Check if current page is Two confirmation page
         *
         * @return bool
         */
        private function is_confirmation_page()
        {

            if (
                isset($_REQUEST['order_id'])
                && isset($_REQUEST[WC_Twoinc_Brand::prefixed_name('order_reference')])
                && isset($_REQUEST[WC_Twoinc_Brand::prefixed_name('nonce')])
            ) {
                return true;
                // Temporarily commented out until we find a solution for redirect plugins
                // $confirm_path = '/twoinc-payment-gateway/confirm';
                // $req_path = strtok($_SERVER["REQUEST_URI"], '?');
                // return strlen($req_path) >= strlen($confirm_path) && substr($req_path, -strlen($confirm_path)) === $confirm_path;
            }
            return false;
        }

        /**
         * Process the order confirmation
         *
         * @return void|string
         */
        private function process_confirmation()
        {

            // Stop if this is not confirmation page
            if (!$this->is_confirmation_page()) {
                return;
            }

            // Make sure this function is called only once per run
            if ($this->twoinc_process_confirmation_called) {
                return;
            }

            // Make sure this function is called only once per run
            $this->twoinc_process_confirmation_called = true;

            // Add status header to avoid being mistaken as 404 by other plugins
            status_header(200);

            $order_id = sanitize_text_field($_REQUEST['order_id']);

            $order = wc_get_order($order_id);

            // Check payment method
            if (!WC_Twoinc_Helper::is_twoinc_order($order)) {
                return;
            }

            // Get the order reference
            $order_reference = sanitize_text_field($_REQUEST[WC_Twoinc_Brand::prefixed_name('order_reference')]);

            // Verify order reference
            if (!$order_reference || $order_reference !== $order->get_meta(WC_Twoinc_Brand::meta_key('order_reference'), true)) {
                wp_die(__('The security code is not valid.', 'twoinc-payment-gateway'));
            }

            if ($this->get_option('skip_confirm_auth') !== 'yes') {
                // Get the nonce
                $nonce = sanitize_text_field($_REQUEST[WC_Twoinc_Brand::prefixed_name('nonce')]);

                // Stop if the code is not valid
                if (!wp_verify_nonce($nonce, WC_Twoinc_Brand::prefixed_name('confirm_' . $order_id))) {
                    wp_die(__('The security code is not valid.', 'twoinc-payment-gateway'));
                }
            }

            // Get the Two order ID from shop order ID
            $twoinc_order_id = $this->get_twoinc_order_id($order);
            if (!$twoinc_order_id) {
                $error_message = sprintf(__('Unable to retrieve %s order information.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $order->add_order_note($error_message);
                wp_die($error_message);
            }

            // Confirm order
            $response = $this->make_request("/v1/order/{$twoinc_order_id}/confirm", [], 'POST');

            // Stop if request error or $response['response']['code'] < 400
            if (is_wp_error($response)) {
                $error_message = sprintf(__('Unable to retrieve %s order information.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $order->add_order_note($error_message);
                wp_die($error_message);
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                $error_message = sprintf(__('Unable to confirm the order with %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $order->add_order_note($error_message);

                // Redirect the user to Woocom cancellation page
                return wp_specialchars_decode($order->get_cancel_order_url());
            }
            // After get_twoinc_error_msg, we can assume $response['response']['code'] < 400

            // Add note and update Two state
            $order_note = sprintf(__('Order ID %s has been placed with %s.', 'twoinc-payment-gateway'), $twoinc_order_id, WC_Twoinc_Brand::get('product_name'));
            $order->add_order_note($order_note);
            $order->update_meta_data(WC_Twoinc_Brand::meta_key('order_state'), 'CONFIRMED');
            $order->save();

            // Mark order as processing
            $order->payment_complete();

            // Redirect the user to confirmation page
            return wp_specialchars_decode($order->get_checkout_order_received_url());
        }

        /**
         * Register Admin form fields
         *
         * @return void
         */
        public function init_form_fields()
        {
            $twoinc_form_fields = [
                'enabled' => [
                    'title'       => __('Turn on/off', 'twoinc-payment-gateway'),
                    'type'        => 'checkbox',
                    'label'       => sprintf(__('Enable %s Payments', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name')),
                    'default'     => 'yes'
                ],
                'title' => [
                    'title'       => __('Title', 'twoinc-payment-gateway'),
                    'type'        => 'text',
                    // Brand-specific default: a fresh install must show the
                    // brand's payment-method title, not the Two phrasing.
                    'default'     => __(WC_Twoinc_Brand::get('title_default'), 'twoinc-payment-gateway')
                ],
                'merchant_minimum_order' => [
                    // The value is interpreted in the store currency, so
                    // the label says which one applies.
                    'title'       => sprintf(
                        __('Minimum Order Value, %s', 'twoinc-payment-gateway'),
                        get_option('woocommerce_currency')
                    ),
                    'type'        => 'text',
                    'default'     => '',
                    'description' => $this->get_merchant_minimum_order_description(),
                ],
                'merchant_minimum_order_basis' => [
                    'title'       => __('Minimum Order Value Tax Basis', 'twoinc-payment-gateway'),
                    'type'        => 'select',
                    'default'     => 'gross',
                    'options'     => [
                        'gross' => __('Including tax (gross)', 'twoinc-payment-gateway'),
                        'net'   => __('Excluding tax (net)', 'twoinc-payment-gateway'),
                    ],
                    'description' => __('Whether the basket is compared against the minimum including or excluding tax.', 'twoinc-payment-gateway'),
                ],
                'test_checkout_host' => [
                    'type'        => 'text',
                    'title'       => sprintf(__('%s Test Server', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name')),
                    'default'     => sprintf(WC_Twoinc_Brand::get('checkout_url_template'), 'api.staging')
                ],
                'checkout_env' => [
                    'type'        => 'select',
                    'title'       => __('Choose your settings', 'twoinc-payment-gateway'),
                    'default'     => 'PROD',
                    'options'     => $this->get_checkout_env_options(),
                ],
                'clear_options_on_deactivation' => [
                    'title'       => __('Clear settings on deactivation of plug-in', 'twoinc-payment-gateway'),
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'no'
                ],
                'section_api_credentials' => [
                    'type'        => 'title',
                    'title'       => __('API credentials', 'twoinc-payment-gateway')
                ],
                'api_key' => [
                    'title'       => sprintf(__('%s API Key', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name')),
                    'type'        => 'api_key_with_verification',
                    'description' => sprintf(
                        /* translators: %s is the contact email address for obtaining production API keys */
                        __('API key for the sandbox environment is available on your merchant portal (however please reach out to %s for access to production keys).', 'twoinc-payment-gateway'),
                        esc_html(WC_Twoinc_Brand::get('production_key_contact_email'))
                    ) . '<div id="api-key-status" style="margin-top: 5px;"></div>',
                ],
                'vendor_name' => [
                    'title'       => __('Optional vendor name if there are multiple sites', 'twoinc-payment-gateway'),
                    'type'        => 'text'
                ],
                'section_checkout_options' => [
                    'type'        => 'title',
                    'title'       => __('Checkout options', 'twoinc-payment-gateway')
                ],
                'enable_order_intent' => [
                    'title'       => __('Pre-approve buyer during checkout', 'twoinc-payment-gateway'),
                    'description' => __('Approve buyer when phone and company name is filled out.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'yes'
                ],
                'add_field_department' => [
                    'title'       => __('Add input field for "Department"', 'twoinc-payment-gateway'),
                    'description' => __('Adds an input field where buyers can input their department to display on the invoice.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'yes'
                ],
                'add_field_project' => [
                    'title'       => __('Add input field for "Project"', 'twoinc-payment-gateway'),
                    'description' => __('Adds an input field where buyers can input their project in the company to display on the invoice.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'yes'
                ],
                'add_field_purchase_order_number' => [
                    'title'       => __('Add input field for "Purchase order number"', 'twoinc-payment-gateway'),
                    'description' => __('Adds an input field where buyers can input their purchase order number to display on the invoice.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'yes'
                ],
                'add_field_invoice_email' => [
                    'title'       => __('Add input field for "Invoice email address"', 'twoinc-payment-gateway'),
                    'description' => __('Adds an input field where buyers can input optional additional email address to receive invoice.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'no'
                ],
                'show_abt_link' => [
                    'title'       => sprintf(__('Show "What is %s" link in checkout', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name')),
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'yes'
                ],
                'display_tooltips' => [
                    'title'       => __('Display input tooltips', 'twoinc-payment-gateway'),
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'no'
                ],
                'skip_confirm_auth' => [
                    'title'       => __('Skip user validation at order confirmation', 'twoinc-payment-gateway'),
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'no'
                ],
                'section_auto_complete_settings' => [
                    'type'        => 'title',
                    'title'       => __('Auto-complete settings', 'twoinc-payment-gateway')
                ],
                'enable_company_search' => [
                    'title'       => __('Enable company name search and auto-complete', 'twoinc-payment-gateway'),
                    'description' => __('Enables searching for company name in the national registry and automatically filling in name and national ID.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'yes'
                ],
                'enable_company_search_for_others' => [
                    'title'       => __('Enable company name search for other payment options', 'twoinc-payment-gateway'),
                    'description' => __('Enables searching for company name even when other payment options are selected. Requires the option above to be checked.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'yes'
                ],
                'enable_address_lookup' => [
                    'title'       => __('Address auto-complete', 'twoinc-payment-gateway'),
                    'description' => __('Enables automatically filling in the registered address from the national registry.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'yes'
                ],
                'section_sole_trader' => [
                    'type'  => 'title',
                    'title' => __('Sole trader checkout', 'twoinc-payment-gateway'),
                ],
                'enable_sole_trader' => [
                    'title'       => __('Enable sole trader checkout', 'twoinc-payment-gateway'),
                    'description' => __('Lets buyers check out as a sole trader by registering or logging in with Two. The option only appears for billing countries where sole traders are supported, determined automatically.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'label'       => ' ',
                    'type'        => 'checkbox',
                    'default'     => 'no'
                ],
                'section_payment_terms' => [
                    'type'  => 'title',
                    'title' => __('Payment terms and offset pricing', 'twoinc-payment-gateway'),
                ],
                'payment_terms_days' => [
                    'title'       => __('Payment Terms', 'twoinc-payment-gateway'),
                    'description' => __('Select the payment term(s) you want to offer.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'type'        => 'two_payment_terms',
                ],
                'payment_terms_custom_days' => [
                    'title'             => __('Custom Payment Term (days)', 'twoinc-payment-gateway'),
                    'description'       => __('Optional. Enter a custom number of days to offer alongside the selected terms above.', 'twoinc-payment-gateway'),
                    'desc_tip'          => true,
                    'type'              => 'number',
                    'custom_attributes' => ['min' => '0', 'step' => '1'],
                    'default'           => ''
                ],
                'payment_terms_type' => [
                    'title'       => __('Payment Terms Type', 'twoinc-payment-gateway'),
                    'description' => __('Standard counts the term days from the invoice date. End of month counts them from the end of the invoice month.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'type'        => 'select',
                    'options'     => [
                        'standard'     => __('Standard (from invoice date)', 'twoinc-payment-gateway'),
                        'end_of_month' => __('End of month', 'twoinc-payment-gateway'),
                    ],
                    'default'     => 'standard'
                ],
                'default_payment_term' => [
                    'title'       => __('Default Payment Term', 'twoinc-payment-gateway'),
                    'description' => __('Select the payment term that will be automatically selected for your customer.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'type'        => 'select',
                    'options'     => $this->get_offered_payment_term_options(),
                    'default'     => ''
                ],
                'surcharge_type' => [
                    'title'       => __('Surcharge Method', 'twoinc-payment-gateway'),
                    'description' => __('Select a method to surcharge your customer.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'type'        => 'select',
                    'options'     => [
                        'none'                 => __('No surcharge applied', 'twoinc-payment-gateway'),
                        'percentage'           => __('Percentage', 'twoinc-payment-gateway'),
                        'fixed'                => __('Fixed fee', 'twoinc-payment-gateway'),
                        'fixed_and_percentage' => __('Fixed fee and percentage', 'twoinc-payment-gateway'),
                    ],
                    'default'     => 'none'
                ],
                'surcharge_differential' => [
                    'title'       => __('Surcharge Calculation Basis', 'twoinc-payment-gateway'),
                    'description' => __('Total fee charges the configured surcharge for the chosen term. Fee difference charges only the difference versus the default term (which then shows no surcharge).', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'type'        => 'select',
                    'options'     => [
                        '0' => __('Total fee for selected term', 'twoinc-payment-gateway'),
                        '1' => __('Fee difference vs default payment term', 'twoinc-payment-gateway'),
                    ],
                    'default'     => '0'
                ],
                'surcharge_line_description' => [
                    'title'       => __('Surcharge Line Description', 'twoinc-payment-gateway'),
                    'description' => __('Buyer-facing label for the surcharge line. Use %s for the term length in days. Leave blank to use the brand default.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'type'        => 'text',
                    'default'     => ''
                ],
                'surcharge_tax_treatment' => [
                    'title'       => __('Surcharge Tax Treatment', 'twoinc-payment-gateway'),
                    'description' => __('How the surcharge line is taxed. Standard applies your store\'s default tax rules to the fee. Specific tax class taxes the fee under a WooCommerce tax class you select below. Never taxed adds the fee as non-taxable, regardless of the customer\'s destination.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'type'        => 'select',
                    'options'     => [
                        ''             => __('-- Select surcharge tax treatment --', 'twoinc-payment-gateway'),
                        'standard'     => __('Standard (store default tax rules)', 'twoinc-payment-gateway'),
                        'custom_class' => __('Specific tax class', 'twoinc-payment-gateway'),
                        'always_zero'  => __('Never taxed', 'twoinc-payment-gateway'),
                    ],
                    // Deliberately NO pre-selected default (unified rule
                    // across the WC/PS/Magento plugins): how a fee is taxed
                    // must be an explicit merchant decision, so the field
                    // starts on the placeholder until the merchant picks a
                    // mode. This default only feeds get_option() for shops
                    // that have NEVER saved this field — a persisted
                    // settings-row value (including 'standard' accepted
                    // under the old default) is returned as-is and is never
                    // migrated or reset by this change. Save-time
                    // enforcement lives in validate_surcharge_type_field /
                    // validate_surcharge_tax_treatment_field.
                    'default'     => ''
                ],
                'surcharge_tax_class' => [
                    'title'       => __('Surcharge Tax Class', 'twoinc-payment-gateway'),
                    'desc_tip'    => __('The WooCommerce tax class applied to the surcharge when the tax treatment is "Specific tax class". Manage tax classes under WooCommerce → Settings → Tax.', 'twoinc-payment-gateway'),
                    // Visible (non-tooltip) description: carries the stale-
                    // selection warning when the stored class has been
                    // deleted, empty otherwise.
                    'description' => $this->get_surcharge_tax_class_stale_notice(),
                    'type'        => 'select',
                    'options'     => $this->get_surcharge_tax_class_options(),
                    'default'     => ''
                ],
                'surcharge_grid' => [
                    'title'       => __('Payment Surcharge Configuration', 'twoinc-payment-gateway'),
                    'description' => __('Per payment term: a fixed amount, a percentage of the order, and an optional cap on the percentage portion. Leave a cell blank for zero. Fixed amounts and caps are in the store currency and are not converted for multi-currency stores.', 'twoinc-payment-gateway'),
                    'type'        => 'two_surcharge_grid',
                ],
                'surcharge_rounding_basis' => [
                    'title'       => __('Surcharge Rounding', 'twoinc-payment-gateway'),
                    'description' => __('Snap the buyer surcharge line to a clean increment. Select None for standard two-decimal amounts.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'type'        => 'select',
                    'options'     => [
                        'none'     => __('None', 'twoinc-payment-gateway'),
                        'up'       => __('Up', 'twoinc-payment-gateway'),
                        'down'     => __('Down', 'twoinc-payment-gateway'),
                        'standard' => __('Standard', 'twoinc-payment-gateway'),
                    ],
                    'default'     => 'none'
                ],
                'surcharge_rounding_step' => [
                    'title'       => __('Rounding Step', 'twoinc-payment-gateway'),
                    'description' => __('Increment the surcharge is rounded to (e.g. 1 = whole units, 0.50 = nearest half). Applies only when a rounding direction is selected.', 'twoinc-payment-gateway'),
                    'desc_tip'    => true,
                    'type'        => 'select',
                    'options'     => $this->get_rounding_step_options(),
                    'default'     => ''
                ],
                'section_debug' => [
                    'type'  => 'title',
                    'title' => __('Debug Options', 'twoinc-payment-gateway'),
                ],
                'enable_api_logging' => [
                    'title'       => __('Enable API Logging', 'twoinc-payment-gateway'),
                    'label'       => __('Log API requests and responses', 'twoinc-payment-gateway'),
                    'type'        => 'checkbox',
                    'description' => sprintf(
                        __('If enabled, all API interactions will be logged. This can be useful for debugging. You can view the logs <a href="%s">here</a>.', 'twoinc-payment-gateway'),
                        admin_url('admin.php?page=wc-status&tab=logs&source=twoinc-payment-gateway')
                    ),
                    'default'     => 'yes',
                ],
            ];

            // checkout_env is always shown — it is the environment selector.
            // The free-text test host only appears on sniffed dev
            // environments, where it remains the legacy override.
            if (!WC_Twoinc_Helper::is_twoinc_development()) {
                unset($twoinc_form_fields['test_checkout_host']);
            }

            $this->form_fields = apply_filters('wc_two_form_fields', $twoinc_form_fields);
        }

        /**
         * Generate API key field with verification
         *
         * @param $key
         * @param $data
         *
         * @return false|string
         */
        public function generate_api_key_with_verification_html($key, $data)
        {
            $field_key = $this->get_field_key($key);
            $defaults  = array(
                'title'             => '',
                'disabled'          => false,
                'class'             => '',
                'css'               => '',
                'placeholder'       => '',
                'type'              => 'password',
                'desc_tip'          => false,
                'description'       => '',
                'custom_attributes' => array(),
            );

            $data = wp_parse_args($data, $defaults);

            ob_start();
            ?>
            <tr valign="top">
                <th scope="row" class="titledesc">
                    <label for="<?php echo esc_attr($field_key); ?>"><?php echo wp_kses_post($data['title']); ?> <?php echo $this->get_tooltip_html($data); // WPCS: XSS ok.
                    ?></label>
                </th>
                <td class="forminp">
                    <fieldset>
                        <legend class="screen-reader-text"><span><?php echo wp_kses_post($data['title']); ?></span></legend>
                        <div style="position: relative; display: inline-block;">
                            <input class="input-text regular-input <?php echo esc_attr($data['class']); ?>" type="password" name="<?php echo esc_attr($field_key); ?>" id="<?php echo esc_attr($field_key); ?>" style="<?php echo esc_attr($data['css']); ?> padding-right: 35px;" value="<?php echo esc_attr($this->get_option($key)); ?>" placeholder="<?php echo esc_attr($data['placeholder']); ?>" <?php disabled($data['disabled'], true); ?> <?php echo $this->get_custom_attribute_html($data); // WPCS: XSS ok.
                            ?> />
                            <span id="api-key-verification-icon" style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); display: none; pointer-events: none; z-index: 10;">
                                <span class="dashicons dashicons-yes-alt" style="color: #46b450; display: none; font-size: 18px;" id="api-key-valid"></span>
                                <span class="dashicons dashicons-dismiss" style="color: #dc3232; display: none; font-size: 18px;" id="api-key-invalid"></span>
                                <span class="dashicons dashicons-update" style="color: #0073aa; display: none; animation: rotation 1s infinite linear; font-size: 18px;" id="api-key-loading"></span>
                            </span>
                        </div>
                        <?php
                            $merchant_id = $this->get_option('api_key') ? $this->get_merchant_id() : '';
                            $merchant_short_name = $merchant_id ? (string) $this->get_option('merchant_short_name') : '';
                        ?>
                        <?php // Merchant identity — populated server-side on load and refreshed live by admin.js when the key is (re)validated. ?>
                        <div id="twoinc-merchant-info" style="margin-top: 8px; color: #666; font-size: 13px;<?php echo $merchant_id ? '' : ' display: none;'; ?>">
                            <strong><?php _e('Merchant ID:', 'twoinc-payment-gateway'); ?></strong>
                            <span id="twoinc-merchant-id"><?php echo esc_html($merchant_id); ?></span><span id="twoinc-merchant-short-name"><?php echo $merchant_short_name !== '' ? ' &middot; ' . esc_html($merchant_short_name) : ''; ?></span>
                        </div>
                        <div id="twoinc-signup-prompt" style="margin-top: 8px; color: #666; font-size: 13px;<?php echo $merchant_id ? ' display: none;' : ''; ?>">
                            <strong><?php printf(__('Don\'t have an API key? Get one by signing up <a href=\'%s\'>here</a>.', 'twoinc-payment-gateway'), esc_url(WC_Twoinc_Brand::get('sign_up_url'))); ?></strong>
                        </div>
                        <?php echo $this->get_description_html($data); // WPCS: XSS ok.
                        ?>
                    </fieldset>
                </td>
            </tr>
            <style>
                @keyframes rotation {
                    from {
                        transform: rotate(0deg);
                    }

                    to {
                        transform: rotate(359deg);
                    }
                }
            </style>
            <?php

            return ob_get_clean();
        }

        /**
         * Generate a radio input
         *
         * @param $key
         * @param $data
         *
         * @return false|string
         */
        public function generate_radio_html($key, $data)
        {
            $field_key = $this->get_field_key($key);
            $defaults  = array(
                'title'             => '',
                'label'             => '',
                'disabled'          => false,
                'class'             => '',
                'css'               => '',
                'type'              => 'text',
                'desc_tip'          => false,
                'description'       => '',
                'custom_attributes' => array(),
                'checked'           => false
            );

            $data = wp_parse_args($data, $defaults);

            if (! $data['label']) {
                $data['label'] = $data['title'];
            }

            ob_start();
            ?>
            <tr valign="top">
                <td class="forminp" colspan="2">
                    <fieldset>
                        <legend class="screen-reader-text"><span><?php echo wp_kses_post($data['title']); ?></span></legend>
                        <label for="<?php echo esc_attr($field_key); ?>">
                            <input <?php disabled($data['disabled'], true); ?> class="<?php echo esc_attr($data['class']); ?>" type="radio" name="<?php echo esc_attr($field_key); ?>" id="<?php echo esc_attr($field_key); ?>" style="<?php echo esc_attr($data['css']); ?>" value="1" <?php checked($data['checked'] === true, true); ?> <?php echo $this->get_custom_attribute_html($data); // WPCS: XSS ok.
                            ?> /> <?php echo wp_kses_post($data['label']); ?></label><br />
                        <?php echo $this->get_description_html($data); // WPCS: XSS ok.
                        ?>
                    </fieldset>
                </td>
            </tr>
            <?php

            return ob_get_clean();
        }

        public function generate_logo_html($field_key, $data)
        {
            $image_id = $this->get_option($field_key);
            $image = $image_id ? wp_get_attachment_image_src($image_id, 'full') : null;
            $image_src = $image ? $image[0] : null;
            ob_start();
            ?>
            <tr valign="top">
                <th scope="row" class="titledesc">
                    <label for="<?php echo esc_attr($field_key); ?>"><?php echo wp_kses_post($data['title']); ?></label>
                </th>
                <td class="forminp">
                    <fieldset>
                        <input type="hidden" name="woocommerce_<?php echo esc_attr($this->id); ?>_<?php echo $field_key; ?>" id="<?php echo esc_attr($field_key); ?>" class="logo_id" value="<?php echo $image_id; ?>" />
                        <div class="image-container woocommerce-twoinc-image-container">
                            <?php if ($image_src) : ?>
                                <img src="<?php echo $image_src; ?>" alt="" />
                            <?php endif; ?>
                        </div>
                        <button class="button-secondary woocommerce-twoinc-logo" type="button"><?php _e('Select image', 'twoinc-payment-gateway'); ?></button>
                    </fieldset>
                </td>
            </tr>
            <?php
            return ob_get_clean();
        }

        /**
         * Get twoinc meta from DB and Two server
         *
         * @param $order
         */
        private function get_save_twoinc_meta($order, $optional_order_id = null)
        {

            $twoinc_order_id = $this->get_twoinc_order_id($order);
            if (!$twoinc_order_id) {
                if ($optional_order_id) {
                    $twoinc_order_id = $optional_order_id;
                } else {
                    $order->add_order_note(__('Unable to retrieve the order information.', 'twoinc-payment-gateway'));
                    return;
                }
            }

            $order_reference = $order->get_meta(WC_Twoinc_Brand::meta_key('order_reference')) ?? $order->get_meta('_tillit_order_reference');
            $merchant_id = $order->get_meta(WC_Twoinc_Brand::meta_key('merchant_id'));
            if (!$merchant_id) {
                $merchant_id = $order->get_meta('_tillit_merchant_id') ?? $this->get_merchant_id();
                $order->update_meta_data(WC_Twoinc_Brand::meta_key('merchant_id'), $merchant_id);
                $order->save();
            }

            // Extract vendor name
            $vendor_name = $order->get_meta('vendor_name');
            if (!$vendor_name) {
                $vendor_name = $this->get_option('vendor_name');
                $order->update_meta_data('vendor_name', $vendor_name);
                $order->save();
            }

            $company_id = $order->get_meta('company_id');
            if ($company_id) {
                $department = $order->get_meta('department');
                $project = $order->get_meta('project');
                $purchase_order_number = $order->get_meta('purchase_order_number');
                $invoice_emails = $order->get_meta('_invoice_emails', true);
            } else {
                $response = $this->make_request("/v1/order/{$twoinc_order_id}", [], 'GET');

                // Stop if request error
                if (is_wp_error($response)) {
                    $order->add_order_note(__('Unable to retrieve the order information.', 'twoinc-payment-gateway'));
                    return;
                }

                $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
                if ($twoinc_err) {
                    $order->add_order_note(__('Unable to retrieve the order payment information', 'twoinc-payment-gateway'));
                    return;
                }

                $body = json_decode($response['body'], true);
                if (!$body || !$body['buyer'] || !$body['buyer']['company'] || !$body['buyer']['company']['organization_number']) {
                    $error_message = __('Missing company ID.', 'twoinc-payment-gateway');
                    $contact_message = sprintf(__('Please contact %s support with order ID: %s', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'), $twoinc_order_id);
                    $order->add_order_note($error_message . ' ' . $contact_message);
                    return;
                }
                $company_id = $body['buyer']['company']['organization_number'];
                $department = $body['buyer_department'];
                $project = $body['buyer_project'];
                $purchase_order_number = $body['buyer_purchase_order_number'];
                $invoice_emails = $body['invoice_details']['invoice_emails'];
                $order->update_meta_data('company_id', $company_id);
                $order->update_meta_data('department', $department);
                $order->update_meta_data('project', $project);
                $order->update_meta_data('purchase_order_number', $purchase_order_number);
                $order->update_meta_data('_invoice_emails', $invoice_emails);
                $order->save();
            }

            return array(
                'order_reference' => $order_reference,
                'merchant_id' => $merchant_id,
                'company_id' => $company_id,
                'department' => $department,
                'project' => $project,
                'purchase_order_number' => $purchase_order_number,
                'twoinc_order_id' => $twoinc_order_id,
                'payment_reference_message' => $order->get_meta('payment_reference_message'),
                'payment_reference_ocr' => $order->get_meta('payment_reference_ocr'),
                'payment_reference' => $order->get_meta('payment_reference'),
                'payment_reference_type' => $order->get_meta('payment_reference_type'),
                'vendor_name' => $vendor_name,
                'invoice_emails' => $invoice_emails
            );
        }

        /**
         * Run the update execution
         *
         * The Two API only accepts order edits before fulfilment, so once
         * the order has reached a fulfilled/terminal state this is a no-op:
         * without the gate, any post-completion change that lands in the
         * composed body (most commonly a tracking number added after the
         * order was marked completed) would poison the change hash and
         * make EVERY subsequent admin save fire an edit request the API is
         * guaranteed to reject, each leaving a "contact support" order
         * note (TWO-24762 review).
         *
         * @param $order
         * @param $twoinc_meta
         * @param $forced_reload
         *
         * @return boolean true when the remote order is in sync (updated,
         *                 or no update needed), false when an update was
         *                 attempted and failed or the state forbids edits.
         */
        private function process_update_twoinc_order($order, $twoinc_meta, $forced_reload = false)
        {
            $state = $order->get_meta(WC_Twoinc_Brand::meta_key('order_state'), true);
            if (in_array($state, self::TERMINAL_ORDER_STATES)) {
                return false;
            }

            // Compose-time validation (e.g. the negative-discount guard,
            // TWO-25097) throws to fail checkout loud. This path is fired
            // from non-checkout hooks (admin order save, status
            // transitions, fulfilment sync) — contain the failure to the
            // Two sync: note + log it and abort the update, but do not
            // crash the surrounding save/transition.
            try {
                $twoinc_order_hash = $order->get_meta(WC_Twoinc_Brand::meta_key('req_body_hash'));
                $twoinc_updated_order_hash = WC_Twoinc_Helper::hash_order($order, $twoinc_meta);
                $updated = true;
                if (!$twoinc_order_hash || $twoinc_order_hash != $twoinc_updated_order_hash) {
                    $updated = $this->update_twoinc_order($order, $twoinc_meta);
                    if ($updated) {
                        $order->update_meta_data(WC_Twoinc_Brand::meta_key('req_body_hash'), $twoinc_updated_order_hash);
                        $order->save();
                    }
                    if ($forced_reload) {
                        WC_Twoinc_Helper::append_admin_force_reload();
                    }
                }
            } catch (Exception $e) {
                $order->add_order_note(sprintf(
                    __('Could not update the order with %s. Reason: %s', 'twoinc-payment-gateway'),
                    WC_Twoinc_Brand::get('product_name'),
                    $e->getMessage()
                ));
                if (function_exists('wc_get_logger')) {
                    wc_get_logger()->error(
                        'Order update sync failed for order ' . $order->get_id() . ': ' . $e->getMessage(),
                        ['source' => 'twoinc-payment-gateway']
                    );
                }
                return false;
            }
            return $updated;
        }

        /**
         * Run the update
         *
         * @param $order
         * @param $twoinc_meta Optional pre-fetched meta from
         *                     get_save_twoinc_meta, to spare a duplicate
         *                     fetch (which can itself cost a remote GET)
         *                     on hot paths like fulfilment.
         *
         * @return boolean
         */
        private function update_twoinc_order($order, $twoinc_meta = null)
        {

            $twoinc_order_id = $this->get_twoinc_order_id($order);
            if (!$twoinc_order_id) {
                $error_message = sprintf(__('Could not edit the order with %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $error_reason = sprintf(__('Reason: Could not find %s order ID.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $order->add_order_note($error_message . ' ' . $error_reason);
                return false;
            }

            // 1. Get information from the current order
            if (!$twoinc_meta) {
                $twoinc_meta = $this->get_save_twoinc_meta($order);
            }
            if (!$twoinc_meta) {
                return false;
            }

            // 2. Edit the order
            $order = wc_get_order($order->get_id());
            $response = $this->make_request(
                "/v1/order/{$twoinc_order_id}",
                WC_Twoinc_Helper::compose_twoinc_edit_order(
                    $order,
                    $twoinc_meta['department'],
                    $twoinc_meta['project'],
                    $twoinc_meta['purchase_order_number'],
                    $twoinc_meta['vendor_name']
                ),
                'PUT'
            );

            if (is_wp_error($response)) {
                $error_message = sprintf(__('Could not edit the order with %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $order->add_order_note($error_message);
                return false;
            }

            $twoinc_err = WC_Twoinc_Helper::get_twoinc_error_msg($response);
            if ($twoinc_err) {
                $error_message = sprintf(__('Could not edit the order with %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
                $contact_message = sprintf(__('Please contact %s support with order ID: %s', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'), $twoinc_order_id);
                $response_message = sprintf(__('Response: %s', 'twoinc-payment-gateway'), $twoinc_err);
                $order->add_order_note($error_message . ' ' . $contact_message . ' ' . $response_message);
                return false;
            }

            // Get returned gross amount
            $gross_amount = null;
            if ($response && $response['body']) {
                $body = json_decode($response['body'], true);
                if ($body['gross_amount']) {
                    $gross_amount = $body['gross_amount'];
                }
            }

            // Add note
            $order_note = sprintf(__('The order edit request has been accepted by %s.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name'));
            if ($gross_amount) {
                $order_note = $order_note . " " . sprintf(__('Order value is now %s.', 'twoinc-payment-gateway'), strval($gross_amount));
            }
            $order->add_order_note($order_note);

            return true;
        }

        /**
         * Get twoinc order id with backward compatibility
         *
         * @param $order
         */
        private function get_twoinc_order_id($order)
        {

            $twoinc_order_id = $order->get_meta(WC_Twoinc_Brand::prefixed_name('order_id'));

            if (!$twoinc_order_id) {
                $twoinc_order_id = $order->get_meta('tillit_order_id');
            }

            return $twoinc_order_id;
        }

        /**
         * Make a request to Twoinc API
         *
         * @param $endpoint
         * @param $payload
         * @param string $method
         *
         * @return WP_Error|array
         */
        public function make_request($endpoint, $payload = [], $method = 'POST', $params = array(), $api_key_override = null, $timeout = 30)
        {
            $params['client'] = 'wp';
            $params['client_v'] = get_twoinc_plugin_version();
            # If api_key_override is defined, use that key instead of the saved key
            $api_key = $api_key_override ?: $this->get_option('api_key');
            $headers = [
                'Accept-Language' => WC_Twoinc_Helper::get_locale(),
                'Content-Type' => 'application/json; charset=utf-8',
                'X-API-Key' => $api_key
            ];
            if (isset($_SERVER['HTTP_X_CLOUD_TRACE_CONTEXT'])) {
                $headers['HTTP_X_CLOUD_TRACE_CONTEXT'] = $_SERVER['HTTP_X_CLOUD_TRACE_CONTEXT'];
            }
            $response = wp_remote_request(sprintf('%s%s?%s', $this->get_twoinc_checkout_host(), $endpoint, http_build_query($params)), [
                'method' => $method,
                'headers' => $headers,
                'timeout' => $timeout,
                'body' => empty($payload) ? '' : json_encode(WC_Twoinc_Helper::utf8ize($payload)),
                'data_format' => 'body'
            ]);

            // Log the response if logging is enabled
            if ('yes' === $this->get_option('enable_api_logging')) {
                $logger = wc_get_logger();
                // Redact X-API-Key from request headers for logging
                $context = [
                    "source" => "twoinc-payment-gateway",
                    "request" => [
                        "body" => $payload,
                        "headers" => array_merge($headers, [
                            'X-API-Key' => '[REDACTED]'
                        ]),
                        "params" => $params
                    ],
                    "response" => [
                        "body" => null,
                        "headers" => null,
                        "status_code" => null
                    ]
                ];
                if (is_wp_error($response)) {
                    $logger->error("$method $endpoint: WP_Error: " . $response->get_error_message(), $context);
                } else {
                    $raw_body = wp_remote_retrieve_body($response);
                    $decoded_body = json_decode($raw_body, true);
                    // Flatten headers for logging
                    $response_context = [
                        "body" => (json_last_error() === JSON_ERROR_NONE) ? $decoded_body : $raw_body,
                        "headers" => (array) wp_remote_retrieve_headers($response)->getAll(),
                        "status_code" => (int) wp_remote_retrieve_response_code($response)
                    ];
                    $log_message = "$method $endpoint";
                    $context["response"] = $response_context;
                    if ($response_context["status_code"] >= 400) {
                        $logger->error($log_message, $context);
                    } else {
                        $logger->info($log_message, $context);
                    }
                }
            }

            return $response;
        }

        /**
         * Display admin banner notice for twoinc account setup
         *
         * @return void
         */
        public function twoinc_account_init_notice()
        {
            global $pagenow;

            // Do not show on the Two plugin's own settings page
            if (
                $pagenow === 'admin.php' &&
                isset($_GET['page'], $_GET['tab'], $_GET['section']) &&
                $_GET['page'] === 'wc-settings' &&
                $_GET['tab'] === 'checkout' &&
                $_GET['section'] === $this->id
            ) {
                return;
            }

            // Only show notice if either API key or merchant ID is missing
            if ($this->get_option('api_key') && $this->get_merchant_id()) {
                return;
            }
            $product_name = WC_Twoinc_Brand::get('product_name');
            $headline = sprintf(__('Grow your B2B sales with Buy Now, Pay Later using %s!', 'twoinc-payment-gateway'), $product_name);
            $benefits = sprintf(__('%s credit approves 90%% of business buyers, pays you upfront and minimise your risk. To offer %s in your checkout, you need to signup. It is quick, easy and gives you immediate access to the %s Merchant Portal.', 'twoinc-payment-gateway'), $product_name, $product_name, $product_name);
            $setup_account = __('Set up my account', 'twoinc-payment-gateway');
            $setup_url = admin_url('admin.php?page=wc-settings&tab=checkout&section=' . $this->id);
            echo '
            <div id="twoinc-account-init-notice" class="notice notice-info is-dismissible" style="background-image: url(\'' . WC_TWOINC_PLUGIN_URL . 'assets/images/banner.png\');background-size: cover;border-left-width: 0;background-color: #e2e0ff;padding: 20px;display: flex;">
                <div style="width:60%;padding-right:40px;">
                    <img style="width: 100px;" src="' . esc_url($this->icon) . '">
                    <p style="color: #ffffff;font-size: 1.3em;text-align: justify;font-weight:700;">' . $headline . '</p>
                    <p style="color: #ffffff;font-size: 1.3em;text-align: justify;">' . $benefits . '</p>
                </div>
                <div>
                    <div style="position: absolute;top: 50%;transform: translateY(-50%);right: 40px;">
                        <a href="' . $setup_url . '" target="_blank" class="button" style="margin-left: 20px;background: #edf3ff;font-size: 1.1em;font-weight: 600;color: #4848e6;padding: 7px 30px;border-color: #edf3ff;border-radius: 12px;">' . $setup_account . '</a>
                    </div>
                </div>
            </div>

            <script type="text/javascript">
                jQuery(document).ready(function($){
                    jQuery("#dismiss-twoinc-notice").click(function(){
                        jQuery("#twoinc-account-init-notice").slideUp();
                    });
                });
            </script>
            ';
        }

        /**
         * On deactivating the plugin
         *
         * @return void
         */
        public function on_deactivate_plugin()
        {
            // The recurring FX refresh must not keep firing (listener-less)
            // while the plugin is deactivated; it is re-registered on init
            // when the plugin comes back (WC_Twoinc_FX::maybe_schedule_refresh).
            if (class_exists('WC_Twoinc_FX') && function_exists('as_unschedule_all_actions')) {
                as_unschedule_all_actions(WC_Twoinc_FX::refresh_hook());
            }
            if ($this->get_option('clear_options_on_deactivation') === 'yes') {
                delete_option('woocommerce_' . $this->id . '_settings');
                // The merchant-record caches (terms, days-on-invoice,
                // platform minimum) live outside the settings blob in
                // dedicated wp_options — clear them too, or "clear options
                // on deactivation" leaves orphaned rows behind.
                $this->invalidate_merchant_record_caches();
                if (class_exists('WC_Twoinc_FX')) {
                    WC_Twoinc_FX::purge();
                }
            }
        }

        /**
         * Append plugin/platform version info below the settings form,
         * mirroring the version panels in the Magento and PrestaShop
         * plugins - the support team's first question is always
         * "what version are you on".
         */
        public function admin_options()
        {
            parent::admin_options();
            $components = [sprintf(
                /* translators: 1: base plugin provenance, e.g. "2.23.9 (eb7bf92cec07, deployed 2026-07-08 11:35 UTC)" */
                __('Plugin: %s', 'twoinc-payment-gateway'),
                self::describe_component_provenance(WC_TWOINC_PLUGIN_PATH . 'tillit-payment-gateway.php', get_twoinc_plugin_version())
            )];
            $overlay = self::get_brand_overlay_main_file();
            if ($overlay !== null) {
                $overlay_data = function_exists('get_plugin_data') ? get_plugin_data($overlay, false, false) : [];
                $components[] = sprintf(
                    /* translators: 1: overlay plugin slug, 2: overlay provenance */
                    __('Brand overlay: %1$s %2$s', 'twoinc-payment-gateway'),
                    basename(dirname($overlay)),
                    self::describe_component_provenance($overlay, isset($overlay_data['Version']) ? $overlay_data['Version'] : '?')
                );
            }
            echo '<p><small class="description">' . esc_html(sprintf(
                /* translators: 1: plugin (and overlay) provenance fragments, 2: WooCommerce version, 3: WordPress version */
                __('%1$s | WooCommerce: %2$s | WordPress: %3$s', 'twoinc-payment-gateway'),
                implode(' | ', $components),
                defined('WC_VERSION') ? WC_VERSION : '?',
                get_bloginfo('version')
            )) . '</small></p>';
        }

        /**
         * Human version line for one deployed component: plugin version,
         * plus — when the plugin dir was materialised from a git-sync
         * worktree — the deployed commit and timestamp. A worktree copy
         * carries a plain .git FILE whose gitdir path ends in the commit
         * SHA (git-sync names worktree dirs by commit), and the deployer
         * stamps a fresh mtime on the copied tree. Released (wp.org)
         * installs have neither and show the bare version.
         *
         * @param string $main_file plugin main file path
         * @param string $version   version header value
         *
         * @return string e.g. "2.23.9 (eb7bf92cec07, deployed 2026-07-08 11:35 UTC)"
         */
        private static function describe_component_provenance($main_file, $version)
        {
            $detail = [];
            $git_pointer = dirname($main_file) . '/.git';
            if (is_file($git_pointer) && is_readable($git_pointer)) {
                $pointer = (string) file_get_contents($git_pointer);
                if (preg_match('#gitdir:\s*.*/([0-9a-f]{40})\s*$#', trim($pointer), $m)) {
                    $detail[] = substr($m[1], 0, 12);
                }
            }
            $mtime = is_readable($main_file) ? filemtime($main_file) : false;
            if ($detail && $mtime) {
                $detail[] = sprintf(
                    /* translators: %s: UTC timestamp the code was deployed */
                    __('deployed %s UTC', 'twoinc-payment-gateway'),
                    gmdate('Y-m-d H:i', $mtime)
                );
            }
            return $detail ? sprintf('%s (%s)', $version, implode(', ', $detail)) : $version;
        }

        /**
         * Main plugin file of the installed brand overlay, or null on a
         * vanilla (Two-brand) install. Derived from the brand file the
         * overlay registered: <overlay>/brands/<code>.php.
         *
         * @return string|null
         */
        private static function get_brand_overlay_main_file()
        {
            $brand_file = apply_filters('twoinc_brand_file', null);
            if (!is_string($brand_file) || $brand_file === '') {
                return null;
            }
            $overlay_dir = dirname(dirname($brand_file));
            $main = $overlay_dir . '/' . basename($overlay_dir) . '.php';
            return is_file($main) ? $main : null;
        }

        /**
         * Override process_admin_options to validate API key before saving settings
         */
        public function process_admin_options()
        {
            $post_data = $this->get_post_data();
            $api_key_field = 'woocommerce_' . $this->id . '_api_key';
            $api_key_in_post = array_key_exists($api_key_field, $post_data);
            $api_key = $api_key_in_post ? $post_data[$api_key_field] : '';

            if ($api_key_in_post && $api_key) {
                $result = $this->verify_api_key($api_key);
                if (isset($result['body']) && isset($result['code']) && $result['code'] == 200) {
                    if ((string) $api_key !== (string) $this->get_option('api_key')) {
                        // Key changed → possibly a different merchant. Drop
                        // the cached term list now; verify_api_key only
                        // re-resolves merchant_id on the NEXT admin pageload,
                        // and serve-stale caching must not bridge identities
                        // in the meantime (TWO-24812).
                        $this->invalidate_merchant_record_caches();
                    }
                    WC_Admin_Settings::add_message(sprintf(__('%s API key verified.', 'twoinc-payment-gateway'), WC_Twoinc_Brand::get('product_name')));
                } else {
                    // Invalid key: keep previous API key, save other settings
                    $post_data[$api_key_field] = $this->get_option('api_key');
                    WC_Admin_Settings::add_error(__('Failed to verify API key.', 'twoinc-payment-gateway'));
                }
            }
            // Save all settings (with possibly reverted API key)
            $_POST = $post_data;
            parent::process_admin_options();
        }

        /**
         * Get payment method icon
         *
         * @return string
         */
        public function get_icon()
        {
            $icon_html = '<img src="' . esc_url($this->icon) . '" alt="' . esc_attr($this->title) . '" class="mollie-gateway-icon" />';
            return apply_filters('woocommerce_gateway_icon', $icon_html, $this->id);
        }
    }
}
