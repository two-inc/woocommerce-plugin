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

        /**
         * WC_Twoinc_Checkout constructor.
         */
        public function __construct($wc_twoinc)
        {

            $this->wc_twoinc = $wc_twoinc;

            // Move the country field to the top
            add_filter('woocommerce_checkout_fields', [$this, 'move_country_field'], 20);

            // Register the custom fields
            add_filter('woocommerce_checkout_fields', [$this, 'add_tracking_fields'], 21);
            add_filter('woocommerce_checkout_fields', [$this, 'update_company_fields'], 23);

            // WooCommerce's own address-i18n.js re-derives #billing_country's
            // client-side priority from THIS locale default array on every
            // checkout load (fired via country_to_state_changing at init, not
            // only on country change) and then re-sorts the DOM — entirely
            // independent of the woocommerce_checkout_fields chain above.
            // Without this mirror, move_country_field()'s server-side fix is
            // silently undone a few hundred ms after page load: JS resorts
            // .form-row elements using the hardcoded core default
            // (country priority 40) against company's 30, putting company
            // back above country (#33 — live-staging-only regression, never
            // reproduced against a local fixture because it depends on
            // WooCommerce's own bundled JS, not this plugin's).
            add_filter('woocommerce_get_country_locale_default', [$this, 'sync_locale_country_priority']);

            // Brand overlays add/modify checkout fields after the base set
            // is complete (priority 25 > the base mutations above)
            add_filter('woocommerce_checkout_fields', [$this, 'apply_brand_checkout_fields'], 25);

            // Render the fields on checkout page
            add_action('woocommerce_before_checkout_billing_form', [$this, 'render_twoinc_fields'], 21);
            add_action('woocommerce_pay_order_before_submit', [$this, 'render_twoinc_fields'], 21);
            add_action('woocommerce_before_checkout_billing_form', [$this, 'render_twoinc_representative_fields'], 22);

            // Inject the cart details in header
            add_action('woocommerce_before_checkout_billing_form', [$this, 'inject_cart_details'], 23);
            add_action('woocommerce_pay_order_before_submit', [$this, 'inject_cart_details'], 22);

            // Order pay page customization
            add_action('woocommerce_pay_order_before_submit', [$this, 'order_pay_page_customize'], 24);
        }

        /**
         * Let a brand overlay add or modify checkout form fields
         *
         * @param $fields
         *
         * @return mixed
         */
        public function apply_brand_checkout_fields($fields)
        {
            return apply_filters('twoinc_checkout_fields', $fields);
        }

        /**
         * Move the country field at the top of the Billing Details section
         *
         * @param $fields
         */
        public function move_country_field($fields)
        {

            // Change the priority for the country field. billing_company may
            // be absent (e.g. WooCommerce's own "Company name" field toggle
            // disabled) — fall back to core's default priority (30) rather
            // than warning on an undefined array key. Clamped below 190: see
            // the matching clamp in update_company_fields() — country must
            // never be pushed at/above the optional-fields baseline (200).
            $company_priority = self::clamp_company_priority($fields['billing']['billing_company']['priority'] ?? 30);
            $fields['billing']['billing_country']['priority'] = $company_priority - 1;

            // Return the fields list
            return $fields;
        }

        /**
         * Shared clamp: never let a company-name priority (whatever its
         * source — billing_company's own field, or WooCommerce's country
         * locale defaults) push country/optionals out of their intended
         * band. See move_country_field(), update_company_fields() and
         * sync_locale_country_priority() — all three must agree on this
         * number or the three field-order mechanisms drift apart (#33).
         *
         * @param $priority
         *
         * @return int
         */
        private static function clamp_company_priority($priority)
        {
            return min($priority, 190);
        }

        /**
         * Keep WooCommerce's country-locale defaults in sync with the
         * country/company priority clamp above.
         *
         * WooCommerce's address-i18n.js reads wc_address_i18n_params.locale
         * (built from this exact filtered array — see
         * WC_Countries::get_country_locale(), the 'default' entry) and,
         * on EVERY checkout load — not only when the buyer changes country —
         * resets #billing_country_field's client-side `data-priority` to
         * whatever this array says, then physically re-sorts every
         * `.form-row` in the billing wrapper by that priority
         * (`rows.detach().appendTo(wrapper)` in address-i18n.js). Company/
         * company_display are NOT in that JS's locale_fields list, so their
         * priority is left alone at whatever the server rendered — only
         * country gets overwritten. Left unfixed, this silently reverts
         * move_country_field()'s server-side fix a few hundred ms after
         * load, on every locale, because address-i18n.js always falls back
         * to `locale.default` for any country without its own 'country'
         * override (none of WooCommerce's built-in locales define one).
         *
         * @param $fields
         *
         * @return mixed
         */
        public function sync_locale_country_priority($fields)
        {
            // Keys here are unprefixed ('company', 'country') — this is
            // WC_Countries::get_default_address_fields()'s own shape, not
            // the 'billing_'-prefixed $checkout->get_checkout_fields() shape
            // that move_country_field()/update_company_fields() operate on.
            //
            // Guard on 'country' actually being present (review finding):
            // every WC core version we've checked includes it, but blind-
            // writing $fields['country']['priority'] would auto-vivify a
            // bare ['priority' => X] entry with no type/label/class if some
            // future version ever omitted it — and that malformed entry
            // would then be treated as the field's real locale definition
            // downstream. Absence is a no-op, not a fallback construction:
            // there is nothing sane to build here without WC's own field
            // shape.
            if (!isset($fields['country'])) {
                return $fields;
            }

            // Reads WC core's own hardcoded 'company' default here (this
            // array is never customized by a brand overlay — brands only
            // hook woocommerce_checkout_fields, not
            // woocommerce_get_country_locale_default), so it can drift from
            // billing_company's real, possibly brand-adjusted priority in
            // move_country_field()/update_company_fields(). No brand
            // currently touches billing_company's priority (#33 review —
            // Han), so this is a documented latent gap, not an active bug:
            // if one ever does, this filter would need to read the live
            // checkout-fields priority instead of the static default here.
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
            // Clamped below the optional-fields baseline (200, below) so
            // company/company_id can never invert above invoice_email/PO/
            // project/department if a future brand overlay ever pushes
            // billing_company's own priority unusually high (#33 review —
            // Vader: this used to be a non-issue because the optionals rode
            // company's own priority; now they're fixed, so company's own
            // priority needs its own ceiling).
            $company_name_priority = self::clamp_company_priority($fields['billing']['billing_company']['priority'] ?? 30);

            // Always registered — TWO-25326 §7.1 correction 2026-08-04. This
            // is the ONE company-search control; `get_enable_company_search()`
            // only ever decides WHERE it renders (address area vs payment
            // tile, via `company_search_location` — see
            // derive_company_search_location() and
            // twoincDomHelper.syncCompanySearchTileLocation() in twoinc.js),
            // never whether it exists. A gate here that skipped registration
            // when the checkbox was unchecked left the payment-tile branch
            // with nothing to relocate — the tile rendered empty and the
            // buyer saw only the plain, unenhanced fallback fields
            // (`#billing_company_field` + `#company_id_field`) in the address
            // area, with no working search anywhere on the page. Removing the
            // gate is what gives the relocation JS a control to move.
            $fields['billing']['billing_company_display'] = [
                'label' => __('Company name', 'twoinc-payment-gateway'),
                'autocomplete' => 'organization',
                'type' => 'select',
                /*'custom_attributes' => [
                    'data-multiple' => true,
                    'data-multi' => true
                ],*/
                // form-row-wide is what carries WooCommerce's
                // `clear: both` (and full width) for a checkout row.
                // Without it this row does not clear the
                // form-row-first/form-row-last float pair that the first-
                // and last-name rows form, so its label's line boxes get
                // squeezed into the gutter between those two 47% floats —
                // the label renders wrapped between the two name inputs
                // (TWO-25160).
                'class' => array('billing_company_selectwoo', 'form-row-wide', 'hidden'),
                'options' => [
                    '' => '&nbsp;'
                ],
                'required' => false,
                'priority' => $company_name_priority
            ];

            $fields['billing']['company_id'] = [
                'label' => __('Company ID', 'twoinc-payment-gateway'),
                'class' => array('hidden'),
                'required' => false,
                'priority' => $company_name_priority + 1
            ];

            // Optional checkout fields. ORDER IS LOAD-BEARING: WooCommerce sorts
            // the billing fields by `priority` (wc_checkout_fields_uasort_comparison),
            // so the ascending offsets below are what the buyer sees, and they must
            // match the admin pane sequence in WC_Twoinc::init_form_fields() —
            // invoice email, purchase order number, project, department. The order
            // note is WooCommerce core's own `order_comments` and stays where core
            // puts it (the "Additional information" block, after billing). TWO-25263.
            //
            // These sit BELOW every native address/contact field (city/postcode
            // 70-90, phone 100, email 110 — see WC_Countries default priorities)
            // rather than riding on company's priority, so they land at the very
            // bottom of the form regardless of whether company search/company
            // name is on, off, or absent (#33 — Doug: optionals belong below
            // town/city, not interleaved near the top).
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

            // Return the fields
            return $fields;
        }

        /**
         * Add the tracking id from order intent to order
         *
         * @param $fields
         *
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

            // Return the fields list
            return $fields;
        }

        /**
         * Render the Twoinc fields to the checkout page
         *
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
         * Render the Twoinc representative fields to the checkout page
         *
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
         * Where the ONE company-search control (§1-§4) renders in the
         * checkout DOM (TWO-25326 §7.1, correction 2026-08-04). Pulled out
         * as a pure function — no gateway, no WP/WC globals — precisely so
         * this branch can be unit-tested in isolation without dragging in
         * everything else `prepare_twoinc_object()` touches.
         *
         * Superseded the short-lived standalone `company_search_location`
         * admin setting from PR #436: Doug's correction was that merchants
         * already have the `enable_company_search` checkbox, and a second
         * location-only setting was one control too many. So the SAME
         * checkbox now drives both "is the control shown in the address
         * form" (`enable_company_search === 'yes'`, the value this takes)
         * and, via this function, where it lives when it isn't:
         *   - 'yes' (checked, the default): 'address_area' — renders in the
         *     billing address form exactly as before this setting existed.
         *   - anything else (unchecked): 'payment_tile' — the SAME control
         *     (fields, JS, dropdown) is relocated into the payment tile
         *     instead of being turned off — see
         *     twoincSelectWooHelper.syncCompanySearchTileLocation() (the
         *     TwoCompanySearch class instance) in twoinc.js.
         *
         * @param string|null $enable_company_search WC_Twoinc::get_enable_company_search()'s return value — nullable, same as the option chain it reads.
         * @return string 'address_area' or 'payment_tile'
         */
        private static function derive_company_search_location(?string $enable_company_search): string
        {
            return $enable_company_search === 'yes' ? 'address_area' : 'payment_tile';
        }

        /**
         * Passing config to javascript
         *
         * @param $merchant array
         *
         * @return array
         */
        private function prepare_twoinc_object($merchant): array
        {
            $currency = get_woocommerce_currency();

            // Checkout render is the sanctioned refresh point for the
            // backend term list (TWO-24812) — refresh once here; the
            // cache-only seam reads below (is_enabled, get_selected_term,
            // …) then see the fresh list.
            $offered_terms = WC_Twoinc_Payment_Terms::get_available_terms($this->wc_twoinc, true);

            // TODO: Make this dynamic based on active merchant payee accounts
            $supported_buyer_countries = WC_Twoinc_Brand::get('supported_buyer_countries');

            // Read once, fed to both `enable_company_search` below and
            // `derive_company_search_location()` — same option chain, same
            // request, no reason to hit `get_option()` twice (review nit,
            // Leia).
            $enable_company_search = $this->wc_twoinc->get_enable_company_search();

            $properties = [
                'text' => [
                    'tooltip_phone' => __('We require your phone number so we can verify your purchase.', 'twoinc-payment-gateway'),
                    'tooltip_company' => __('We use your company name to automatically populate your address and register the company that made the purchase.', 'twoinc-payment-gateway'),
                    // Shown in the company-search dropdown when the lookup
                    // times out or comes back degraded (TWO-25232) — never
                    // for a search that simply matched nothing.
                    'company_search_unavailable' => __('Company search is temporarily unavailable. Please try again.', 'twoinc-payment-gateway'),
                    // Hint inside the empty company-search field (TWO-25288).
                    'company_search_placeholder' => __('Enter company name to search', 'twoinc-payment-gateway'),
                    // Hint while the typed term is too short to search
                    // (TWO-25288). The %d is deliberately LEFT UNRESOLVED
                    // here: the JS interpolates it from its own
                    // minimum-length constant, which is also what the widget
                    // enforces, so the number the buyer is told cannot drift
                    // from the number required.
                    /* translators: %d: minimum number of characters the buyer must type before the company search runs. Left unresolved here and interpolated in JS from the threshold the widget enforces, so the two cannot disagree. */
                    'company_search_too_short' => __('Please enter %d or more characters', 'twoinc-payment-gateway'),
                    // The manual-entry row inside the company-search results
                    // list, and the link back out of manual entry
                    // (TWO-25288). Both used to be markup in the billing-form
                    // view, which is rendered on the checkout page only — the
                    // pay-for-order page renders its own copy of the company
                    // inputs and so silently had neither. They are built in JS
                    // now, from here, so both surfaces get the same
                    // translated strings from one source.
                    'company_not_in_list' => __('My company is not on the list', 'twoinc-payment-gateway'),
                    'search_company' => __('Search for company', 'twoinc-payment-gateway'),
                ],
                'twoinc_checkout_host' => $this->wc_twoinc->get_twoinc_checkout_host(),
                // Always 'yes' at load — TWO-25326 §7.1 correction
                // 2026-08-04 (Doug's ruling: the search control is never
                // "off", only relocated). `window.twoinc.enable_company_search`
                // is a RUNTIME flag in twoinc.js — toggled to "no" only by
                // enterManualCompanyEntry()/twoincSoleTrader.setMode() to
                // mean "the search widget is not the active input method
                // right now" — not the admin's raw checkbox value. Feeding
                // the raw checkbox value in here used to make the two
                // meanings collide: a merchant who unchecked the box (asking
                // for payment-tile placement) also read as "search is
                // suppressed" everywhere this flag gates the actual
                // selectWoo widget (Twoinc.enableCompanySearch() and
                // friends), so nothing in the tile ever became live. Where
                // the control renders is `company_search_location`'s job,
                // below — driven by the checkbox — never this flag's.
                'enable_company_search' => 'yes',
                'enable_company_search_for_others' => $this->wc_twoinc->get_option('enable_company_search_for_others'),
                // TWO-25326 §7.1, correction 2026-08-04: where the one
                // company-search control renders — driven by the
                // `enable_company_search` checkbox itself (not a setting of
                // its own; see get_enable_company_search()'s doc comment).
                // Any JS check for the admin's own "checked" preference
                // (e.g. gating `enable_company_search_for_others`, which its
                // own description ties to the checkbox) must read THIS value
                // against 'address_area', not the runtime
                // `enable_company_search` flag above.
                'company_search_location' => self::derive_company_search_location($enable_company_search),
                'enable_address_lookup' => $this->wc_twoinc->get_option('enable_address_lookup'),
                'enable_order_intent' => $this->wc_twoinc->get_option('enable_order_intent'),
                'display_tooltips' => $this->wc_twoinc->get_option('display_tooltips'),
                'supported_buyer_countries' => $supported_buyer_countries,
                'gateway_id' => WC_Twoinc_Brand::get('gateway_id'),
                'merchant' => $merchant,
                'merchant_due_in_days' => $this->wc_twoinc->get_merchant_due_in_days(),
                'shop_base_country' => strtolower(WC()->countries->get_base_country()),
                'currency' => $currency,
                'price_decimal_separator' => wc_get_price_decimal_separator(),
                'price_thousand_separator' => wc_get_price_thousand_separator(),
                'twoinc_plugin_url' => WC_TWOINC_PLUGIN_URL,
                'client_name' => 'wp',
                'client_version' => get_twoinc_plugin_version(),
                // Chip selector bootstrap (TWO-24751). JS renders only; the
                // live data (fees, selection) comes from the wc-ajax
                // endpoints in WC_Twoinc_Payment_Terms.
                'payment_terms' => [
                    'days_label' => __('%s days', 'twoinc-payment-gateway'),
                    // Chip copy, verbatim from magento-plugin's Luma renderer
                    // (view/frontend/web/js/view/payment/method-renderer/
                    // gateway_method.js + template/payment/gateway_method.html),
                    // which is also what the Amasty and Fire checkouts render —
                    // they share that one template.
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
         * Inject the cart content in header
         *
         * @return void
         */
        public function inject_cart_details()
        {
            if (!is_checkout()) {
                return;
            }

            // Ensure that the API key valid
            $result = $this->wc_twoinc->verify_api_key();
            if (isset($result['code']) && $result['code'] !== 200) {
                return;
            }

            $twoinc_obj = json_encode(WC_Twoinc_Helper::utf8ize($this->prepare_twoinc_object($result['body'])), JSON_UNESCAPED_UNICODE);
            if ($twoinc_obj) {
                printf('<script>window.twoinc = %s;</script>', $twoinc_obj);
            }
        }
    }
}
