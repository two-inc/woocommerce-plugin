<?php

/**
 * Twoinc Checkout page modifier
 *
 * @class WC_Twoinc_Checkout
 * @author Two
 */

if (!class_exists('WC_Twoinc_Checkout')) {
    class WC_Twoinc_Checkout
    {
        private $wc_twoinc;

        public function __construct($wc_twoinc)
        {

            $this->wc_twoinc = $wc_twoinc;

            add_filter('woocommerce_checkout_fields', [$this, 'move_country_field'], 20);
            add_filter('woocommerce_checkout_fields', [$this, 'add_tracking_fields'], 21);
            add_filter('woocommerce_checkout_fields', [$this, 'update_company_fields'], 23);

            // WooCommerce's address-i18n.js re-derives #billing_country's
            // client-side priority from THIS locale default array on every
            // checkout load and re-sorts the DOM, independent of the
            // woocommerce_checkout_fields chain above — without this mirror
            // move_country_field()'s fix is silently undone client-side (#33).
            add_filter('woocommerce_get_country_locale_default', [$this, 'sync_locale_country_priority']);

            // Brand overlays add/modify checkout fields after the base set
            // is complete (priority 25 > the base mutations above)
            add_filter('woocommerce_checkout_fields', [$this, 'apply_brand_checkout_fields'], 25);

            add_action('woocommerce_before_checkout_billing_form', [$this, 'render_twoinc_fields'], 21);
            add_action('woocommerce_pay_order_before_submit', [$this, 'render_twoinc_fields'], 21);
            add_action('woocommerce_before_checkout_billing_form', [$this, 'render_twoinc_representative_fields'], 22);

            add_action('woocommerce_before_checkout_billing_form', [$this, 'inject_cart_details'], 23);
            add_action('woocommerce_pay_order_before_submit', [$this, 'inject_cart_details'], 22);

            add_action('woocommerce_pay_order_before_submit', [$this, 'order_pay_page_customize'], 24);
        }

        /**
         * @return mixed
         */
        public function apply_brand_checkout_fields($fields)
        {
            return apply_filters('twoinc_checkout_fields', $fields);
        }

        public function move_country_field($fields)
        {

            // billing_company may be absent (e.g. the "Company name" field
            // toggle disabled) — fall back to core's default priority (30).
            // Clamped below 190 so country never lands at/above the
            // optional-fields baseline (200) — see update_company_fields().
            $company_priority = self::clamp_company_priority($fields['billing']['billing_company']['priority'] ?? 30);
            $fields['billing']['billing_country']['priority'] = $company_priority - 1;

            return $fields;
        }

        /**
         * Shared clamp so a company-name priority never pushes country/
         * optionals out of their intended band. move_country_field(),
         * update_company_fields() and sync_locale_country_priority() must
         * all agree on this number or the three drift apart (#33).
         *
         * @return int
         */
        private static function clamp_company_priority($priority)
        {
            return min($priority, 190);
        }

        /**
         * Keeps WooCommerce's country-locale defaults in sync with the
         * country/company priority clamp above.
         *
         * address-i18n.js reads this exact filtered array on EVERY checkout
         * load, not only on country change, and re-sorts `.form-row`
         * elements in the billing wrapper by it — company/company_display
         * aren't in that JS's locale_fields list, so only country gets
         * overwritten. Left unfixed this silently reverts
         * move_country_field()'s fix a few hundred ms after load.
         *
         * @return mixed
         */
        public function sync_locale_country_priority($fields)
        {
            // Keys here are unprefixed ('company', 'country') — this is
            // WC_Countries::get_default_address_fields()'s own shape, not
            // the 'billing_'-prefixed shape move_country_field()/
            // update_company_fields() operate on.
            if (!isset($fields['country'])) {
                return $fields;
            }

            // WC core's hardcoded 'company' default — never customized by a
            // brand overlay (brands only hook woocommerce_checkout_fields),
            // so it can drift from billing_company's real priority above.
            // No brand currently touches it (#33), so this is a documented
            // latent gap, not an active bug.
            $company_priority = self::clamp_company_priority($fields['company']['priority'] ?? 30);
            $fields['country']['priority'] = $company_priority - 1;

            return $fields;
        }

        /**
         * Add fields: Company name, Company ID, and the optional buyer fields
         * (invoice email, purchase order number, project, department).
         *
         * @param $fields
         *
         * @return mixed
         */
        public function update_company_fields($fields)
        {

            // billing_company may be absent (see move_country_field above).
            // Clamped below the optional-fields baseline (200, below) so the
            // company rows can never invert above invoice_email/PO/
            // project/department if a future brand overlay ever pushes
            // billing_company's own priority unusually high (#33).
            $company_name_priority = self::clamp_company_priority($fields['billing']['billing_company']['priority'] ?? 30);

            // WC core deletes its own company field entirely on stores where
            // `woocommerce_checkout_company_field` is 'hidden' (the default
            // for block-checkout stores), so this plugin's own company
            // capture — the manual-entry/no-registry surface, and the buyer's
            // own company address line — cannot work without it.
            // Registering it here puts it beyond that store-level toggle.
            //
            // Filled in only when absent, never overwritten — a store or
            // brand overlay that already defines it owns that definition.
            // Registered before the two fields below so it stays first in
            // insertion order, which decides render order among fields that
            // share a priority (PHP's sort is stable).
            if (!isset($fields['billing']['billing_company'])) {
                $fields['billing']['billing_company'] = [
                    // Optional here because required-ness is decided
                    // client-side, per capture mode and payment method
                    // (toggleBusinessFields' `requiredTargets`).
                    'label' => __('Company name', 'twoinc-payment-gateway'),
                    'autocomplete' => 'organization',
                    'class' => array('form-row-wide'),
                    'required' => false,
                    'priority' => $company_name_priority
                ];
            }

            // Always registered (TWO-25326 §7.1) — this is the ONE
            // company-search control; get_enable_company_search() only ever
            // decides WHERE it renders (address area vs payment tile), never
            // whether it exists. Gating registration on the checkbox left the
            // payment-tile branch with nothing to relocate.
            $fields['billing']['billing_company_display'] = [
                'label' => __('Company name', 'twoinc-payment-gateway'),
                // The browser's own autofill list would paint over the panel
                // this field opens.
                'autocomplete' => 'off',
                'type' => 'text',
                // form-row-wide carries the `clear: both` this row needs to
                // clear the first-/last-name float pair (TWO-25160).
                'class' => array('billing_company_search', 'form-row-wide', 'hidden'),
                'required' => false,
                'priority' => $company_name_priority
            ];

            // A registered billing field, so it survives a fragment refresh.
            $fields['billing']['company_name'] = [
                'label' => __('Company name', 'twoinc-payment-gateway'),
                'class' => array('hidden'),
                'required' => false,
                'priority' => $company_name_priority + 1
            ];

            $fields['billing']['company_id'] = [
                'label' => __('Company ID', 'twoinc-payment-gateway'),
                'class' => array('hidden'),
                'required' => false,
                'priority' => $company_name_priority + 2
            ];

            // ORDER IS LOAD-BEARING: WooCommerce sorts billing fields by
            // `priority`, so the ascending offsets below must match the
            // admin pane sequence in WC_Twoinc::init_form_fields() (TWO-25263).
            //
            // These sit below every native address/contact field priority
            // rather than riding on company's, so they land at the bottom
            // of the form regardless of company search/name state (#33).
            $optional_field_priority = 200;

            if ($this->wc_twoinc->get_option('add_field_invoice_email') === 'yes') {
                $fields['billing']['invoice_email'] = [
                    'label'       => __('Invoice email address', 'twoinc-payment-gateway'),
                    'class'       => array('form-row-wide'),
                    'type'        => 'email',
                    'validate'    => array('email'),
                    'required'    => false,
                    'priority'    => $optional_field_priority + 1
                ];
            }

            if ($this->wc_twoinc->get_option('add_field_purchase_order_number') === 'yes') {
                $fields['billing']['purchase_order_number'] = [
                    'label' => __('PO Number', 'twoinc-payment-gateway'),
                    'class' => array('hidden'),
                    'required' => false,
                    'priority' => $optional_field_priority + 2
                ];
            }

            if ($this->wc_twoinc->get_option('add_field_project') === 'yes') {
                $fields['billing']['project'] = [
                    'label' => __('Project', 'twoinc-payment-gateway'),
                    'class' => array('hidden'),
                    'required' => false,
                    'priority' => $optional_field_priority + 3
                ];
            }

            if ($this->wc_twoinc->get_option('add_field_department') === 'yes') {
                $fields['billing']['department'] = [
                    'label' => __('Department', 'twoinc-payment-gateway'),
                    'class' => array('hidden'),
                    'required' => false,
                    'priority' => $optional_field_priority + 4
                ];
            }

            return $fields;
        }

        /**
         * @return array
         */
        public function add_tracking_fields($fields)
        {

            $fields['billing']['tracking_id'] = [
                'class' => array('hidden'),
                'required' => false,
                'type' => 'text',
                'priority' => 20
            ];

            return $fields;
        }

        /**
         * @return void
         */
        public function render_twoinc_fields()
        {
            ob_start();
            require_once WC_TWOINC_PLUGIN_PATH . '/views/woocommerce_checkout.php';
            $content = ob_get_clean();
            echo $content;
        }

        /**
         * @return void
         */
        public function render_twoinc_representative_fields()
        {
            ob_start();
            require_once WC_TWOINC_PLUGIN_PATH . '/views/woocommerce_after_checkout_billing_form.php';
            $content = ob_get_clean();
            echo $content;
        }

        /**
         * Customize for Order Pay page when merchant installed "Phone Orders for WooCommerce" plugin
         */
        public function order_pay_page_customize()
        {
            ob_start();
            require_once WC_TWOINC_PLUGIN_PATH . '/views/woocommerce_order_pay.php';
            $content = ob_get_clean();
            echo $content;
        }

        /**
         * Where the ONE company-search control renders in the checkout DOM
         * (TWO-25326 §7.1). Pulled out as a pure function so it can be
         * unit-tested in isolation from prepare_twoinc_object().
         *
         * The SAME `enable_company_search` checkbox drives both whether the
         * control shows in the address form and, via this function, where
         * it lives otherwise — there is no separate location-only setting.
         * Unchecked relocates the same control into the payment tile rather
         * than turning it off.
         */
        private static function derive_company_search_location(?string $enable_company_search): string
        {
            return $enable_company_search === 'yes' ? 'address_area' : 'payment_tile';
        }

        private function prepare_twoinc_object($merchant): array
        {
            $currency = get_woocommerce_currency();

            // Checkout render is the sanctioned refresh point for the
            // backend term list (TWO-24812) — refresh once here; the
            // cache-only seam reads below (is_enabled, get_selected_term,
            // …) then see the fresh list.
            $offered_terms = WC_Twoinc_Payment_Terms::get_available_terms($this->wc_twoinc, true);

            // Read once, fed to both `enable_company_search` below and
            // `derive_company_search_location()` — same option chain, same
            // request, no reason to hit `get_option()` twice.
            $enable_company_search = $this->wc_twoinc->get_enable_company_search();

            $properties = [
                'text' => [
                    'tooltip_phone' => __('We require your phone number so we can verify your purchase.', 'twoinc-payment-gateway'),
                    'tooltip_company' => __('We use your company name to automatically populate your address and register the company that made the purchase.', 'twoinc-payment-gateway'),
                    // Shown in the company-search dropdown when the lookup
                    // times out or comes back degraded (TWO-25232) — never
                    // for a search that simply matched nothing.
                    'company_search_unavailable' => __('Company search is temporarily unavailable. Please try again.', 'twoinc-payment-gateway'),
                    // Watermark inside the dropdown's own query field, stating
                    // the search threshold (TWO-25288). The %d is
                    // deliberately LEFT UNRESOLVED here: the JS
                    // interpolates it from its own minimum-length constant,
                    // which is also what the widget enforces, so the number
                    // the buyer is told cannot drift from the number required.
                    /* translators: %d: minimum number of characters the buyer must type before the company search runs. Left unresolved here and interpolated in JS from the threshold the widget enforces, so the two cannot disagree. */
                    'company_search_too_short' => __('Enter %d or more characters', 'twoinc-payment-gateway'),
                    // The "Enter manually" mode chip inside the company-search
                    // dropdown, and the link back out of manual entry
                    // (TWO-25288). Built in JS from here rather than as
                    // billing-form-view markup, so the pay-for-order page
                    // (which renders its own copy of the company inputs) gets
                    // the same translated strings too.
                    'enter_manually' => __('Enter manually', 'twoinc-payment-gateway'),
                    'search_company' => __('Search for company', 'twoinc-payment-gateway'),
                ],
                'twoinc_checkout_host' => $this->wc_twoinc->get_twoinc_checkout_host(),
                // Always 'yes' at load (TWO-25326 §7.1): the search control
                // is never "off", only relocated. `window.twoinc.enable_company_search`
                // is a RUNTIME flag in twoinc.js, toggled to "no" only when
                // the search widget stops being the active input method —
                // not the admin's raw checkbox value. Where the control
                // renders is `company_search_location`'s job, below.
                'enable_company_search' => 'yes',
                // Where the one company-search control renders. Any JS check
                // for the admin's checked preference must read THIS value
                // against 'address_area', not the runtime flag above.
                'company_search_location' => self::derive_company_search_location($enable_company_search),
                'enable_address_lookup' => $this->wc_twoinc->get_option('enable_address_lookup'),
                'enable_order_intent' => $this->wc_twoinc->get_option('enable_order_intent'),
                'display_tooltips' => $this->wc_twoinc->get_option('display_tooltips'),
                'gateway_id' => WC_Twoinc_Brand::get('gateway_id'),
                'merchant' => $merchant,
                'merchant_due_in_days' => $this->wc_twoinc->get_merchant_due_in_days(),
                'shop_base_country' => strtolower(WC()->countries->get_base_country()),
                'currency' => $currency,
                'price_decimal_separator' => wc_get_price_decimal_separator(),
                'price_thousand_separator' => wc_get_price_thousand_separator(),
                'twoinc_plugin_url' => WC_TWOINC_PLUGIN_URL,
                // Addressed instead of the API host so make_request() can add
                // the merchant's firewall token server-side.
                'api_proxy' => [
                    'company_search_url' => class_exists('WC_AJAX') ? WC_AJAX::get_endpoint('two_company_search') : '',
                    'company_by_id_url' => class_exists('WC_AJAX') ? WC_AJAX::get_endpoint('two_company_by_id') : '',
                    'order_intent_url' => class_exists('WC_AJAX') ? WC_AJAX::get_endpoint('two_order_intent') : '',
                    'payment_terms_url' => class_exists('WC_AJAX') ? WC_AJAX::get_endpoint('two_payment_terms') : '',
                    'nonce' => wp_create_nonce('twoinc_checkout'),
                ],
                // Chip selector bootstrap (TWO-24751). JS renders only; the
                // live data (fees, selection) comes from the wc-ajax
                // endpoints in WC_Twoinc_Payment_Terms.
                'payment_terms' => [
                    'days_label' => __('%s days', 'twoinc-payment-gateway'),
                    // Chip copy, matching magento-plugin's Luma renderer,
                    // which the Amasty and Fire checkouts also share.
                    //
                    // >1 term  → `heading` sits ABOVE the chips.
                    // exactly 1 → no heading; `single_label` replaces the bare
                    //             "N days" text INSIDE the single chip.
                    'heading' => __('Selected payment terms', 'twoinc-payment-gateway'),
                    'single_label' => __('Payment Terms %s days', 'twoinc-payment-gateway'),
                    // Chips render whenever a term is offered, including the
                    // single-term case — Magento shows that one term (and its
                    // surcharge) as a disabled chip rather than hiding it.
                    // Whether the buyer can CHOOSE is not sent: render()
                    // derives it from the term list it is handed, which the
                    // fees response can revise after this bootstrap is
                    // written, so a flag fixed here would go stale.
                    'enabled' => WC_Twoinc_Payment_Terms::is_enabled($this->wc_twoinc),
                    'terms' => $offered_terms,
                    'selected' => WC_Twoinc_Payment_Terms::get_selected_term($this->wc_twoinc),
                    'offset_pricing_enabled' => WC_Twoinc_Payment_Terms::get_surcharge_settings($this->wc_twoinc)['enabled'],
                    'fees_url' => class_exists('WC_AJAX') ? WC_AJAX::get_endpoint('two_term_fees') : '',
                    'select_url' => class_exists('WC_AJAX') ? WC_AJAX::get_endpoint('two_select_term') : '',
                    'nonce' => wp_create_nonce('twoinc_checkout'),
                ],
                // Sole trader bootstrap (TWO-24754). JS renders only; country
                // availability and token minting come from the wc-ajax
                // endpoints in WC_Twoinc_Sole_Trader.
                'sole_trader' => [
                    'availability_url' => class_exists('WC_AJAX') ? WC_AJAX::get_endpoint('two_sole_trader_availability') : '',
                    'tokens_url' => class_exists('WC_AJAX') ? WC_AJAX::get_endpoint('two_sole_trader_tokens') : '',
                    'nonce' => wp_create_nonce('twoinc_checkout'),
                    'text' => [
                        'registered_business' => __('Registered company', 'twoinc-payment-gateway'),
                        'sole_trader' => __('Sole trader', 'twoinc-payment-gateway'),
                        'popup_prompt' => __('Click here to login or sign up as a sole trader.', 'twoinc-payment-gateway'),
                        // One link covers both "pick a different existing
                        // registration" and "register a new one" (TWO-40 §7):
                        // that choice is made inside the hosted signup's own
                        // UI once the popup is open, so the copy here must
                        // not commit to either.
                        'select_different' => __('Select a different sole trader', 'twoinc-payment-gateway'),
                        'error' => __('Something went wrong setting up sole trader checkout. Please try again.', 'twoinc-payment-gateway'),
                    ],
                ],
            ];

            $user_id = wp_get_current_user()->ID;
            if ($user_id) {
                $properties['company_id'] = get_user_meta($user_id, WC_Twoinc_Brand::prefixed_name('company_id'), true);
                $properties['billing_company'] = get_user_meta($user_id, WC_Twoinc_Brand::prefixed_name('billing_company'), true);
                $properties['department'] = get_user_meta($user_id, WC_Twoinc_Brand::prefixed_name('department'), true);
                $properties['project'] = get_user_meta($user_id, WC_Twoinc_Brand::prefixed_name('project'), true);
            }

            return $properties;
        }

        /**
         * @return void
         */
        public function inject_cart_details()
        {
            if (!is_checkout()) {
                return;
            }

            // window.twoinc must not be printed when the stored API key
            // cannot currently be verified — the payment-tile bootstrap and
            // the address-block company-search widget are both gated behind
            // its presence, so withholding it here stops company search from
            // rendering on a broken integration (TWO-25326 follow-up). Uses
            // the same cached check as is_available(), so this also avoids
            // a live HTTP call on every checkout render.
            $status = $this->wc_twoinc->get_api_key_verification_status();
            if ($status['status'] !== 'ok') {
                return;
            }

            $twoinc_obj = json_encode(WC_Twoinc_Helper::utf8ize($this->prepare_twoinc_object($status['body'])), JSON_UNESCAPED_UNICODE);
            if ($twoinc_obj) {
                printf('<script>window.twoinc = %s;</script>', $twoinc_obj);
            }
        }
    }
}
