<?php

if (!defined('ABSPATH')) {
    exit;
}

if (!class_exists('WC_Twoinc_Storefront_Gate')) {
    /**
     * The questions every opt-in product-page surface has to ask, asked once.
     *
     * The promotional message (TWO-25799) and the buy button (TWO-25800) are
     * separate features with separate switches, but they must agree about
     * whether this shop may advertise the method at all. Two copies of that
     * decision would drift, and the failure mode is one surface advertising a
     * method the other has already withdrawn.
     *
     * Everything here is answered from stored options and cached verdicts. No
     * method on this class may construct the gateway or reach the network: a
     * product page is the busiest render path in the shop, and constructing
     * WC_Twoinc runs init_form_fields(), whose payment-term options reach
     * get_merchant_available_terms() and so refresh_merchant_record_caches().
     */
    class WC_Twoinc_Storefront_Gate
    {
        /**
         * The frontend single product page, and nothing else.
         *
         * The add-to-cart hooks are emitted by templates a quick-view
         * endpoint, a REST render or an admin preview can also reach.
         */
        public static function is_product_page_request()
        {
            if (is_admin()) {
                return false;
            }

            if (defined('REST_REQUEST') && REST_REQUEST) {
                return false;
            }

            if (function_exists('wp_doing_ajax') && wp_doing_ajax()) {
                return false;
            }

            return function_exists('is_singular') && is_singular('product');
        }

        /**
         * The gateway's settings row, which WooCommerce keeps as one option,
         * so this is a single cached read.
         */
        public static function read_settings()
        {
            $gateway_id = WC_Twoinc_Brand::get('gateway_id');
            if (!is_string($gateway_id) || '' === $gateway_id) {
                return [];
            }

            $settings = get_option('woocommerce_' . $gateway_id . '_settings', []);

            return is_array($settings) ? $settings : [];
        }

        /**
         * WooCommerce resolves a missing field through its declared default,
         * and `enabled` defaults to 'yes'. Defaulting it to 'no' here would
         * disagree with the gateway on a partially imported settings array.
         */
        public static function gateway_enabled($settings)
        {
            $enabled = isset($settings['enabled']) ? $settings['enabled'] : 'yes';

            return 'yes' === $enabled;
        }

        /**
         * One opt-in switch, read strictly.
         *
         * A value outside the known set still reads as off, but it is said
         * once per request per key: a merchant whose surface disappeared after
         * an import otherwise has nothing at all to go on. Nothing is priced
         * on these switches, so they degrade rather than throwing.
         *
         * @param array  $settings
         * @param string $key
         *
         * @return bool
         */
        public static function feature_enabled($settings, $key)
        {
            $stored = isset($settings[$key]) ? $settings[$key] : 'no';

            if (!in_array($stored, ['yes', 'no'], true)) {
                self::log_unrecognised_switch_once($key, $stored);

                return false;
            }

            return 'yes' === $stored;
        }

        /**
         * The cached verdict only. No key stored at all is itself definitive;
         * a verdict nobody has cached yet is not, and is not worth a fetch
         * from a product page. Only a DEFINITIVE rejection withholds, so a
         * transient outage leaves these surfaces up exactly as it leaves the
         * method on offer at checkout.
         */
        public static function key_is_definitely_rejected($settings)
        {
            $api_key = isset($settings['api_key']) ? $settings['api_key'] : '';
            if (!is_string($api_key) || '' === $api_key) {
                return true;
            }

            $cached = get_transient(WC_Twoinc::verification_cache_key($api_key));

            return is_array($cached)
                && isset($cached['status'])
                && WC_Twoinc::is_definitive_key_failure($cached['status']);
        }

        /**
         * An allowlist that is present but empty is the one cached fact that
         * settles availability without a cart: it satisfies no country, so the
         * gateway is withdrawn at every checkout.
         *
         * Read straight off the cached option, NOT through
         * get_supported_buyer_countries(): that one refreshes the merchant
         * record. An absent or unreadable cache means no allowlist, which is
         * not a restriction.
         */
        public static function no_buyer_country_is_supported()
        {
            $cached = get_option(WC_Twoinc_Brand::prefixed_name('supported_buyer_countries'));
            if (false === $cached || '' === $cached || !is_string($cached)) {
                return false;
            }

            $decoded = json_decode($cached, true);

            return is_array($decoded) && [] === $decoded;
        }

        /**
         * Every shared condition in one call: the method is active, this
         * feature is switched on, the key has not been definitively rejected,
         * and the shop can reach at least one buyer country.
         *
         * @param array  $settings
         * @param string $switch_key
         *
         * @return bool
         */
        public static function allows($settings, $switch_key)
        {
            if (!self::gateway_enabled($settings)) {
                return false;
            }

            if (!self::feature_enabled($settings, $switch_key)) {
                return false;
            }

            if (self::key_is_definitely_rejected($settings)) {
                return false;
            }

            return !self::no_buyer_country_is_supported();
        }

        /**
         * The brand's customer-facing name. Used as a mark's alternative text
         * and shown as text where a brand ships no mark, so no storefront ever
         * carries an unattributed financing offer.
         */
        public static function brand_label()
        {
            return self::brand_label_from(WC_Twoinc_Brand::get('product_name'));
        }

        /** Split out so the unusable shapes are testable without a brand. */
        public static function brand_label_from($name)
        {
            return is_scalar($name) ? self::trim_unicode_whitespace((string) $name) : '';
        }

        /**
         * The brand's own mark, or '' where it ships none or declares a
         * non-string. esc_url returns '' for a disallowed scheme, which is
         * treated the same as absent.
         */
        public static function brand_logo_url()
        {
            $url = WC_Twoinc_Brand::get('logo_url');

            return is_string($url) ? esc_url($url) : '';
        }

        /**
         * trim() for the whole Unicode whitespace set, so a nonbreaking-space
         * override counts as empty rather than as wording.
         */
        public static function trim_unicode_whitespace($value)
        {
            $pattern = '/^[\s\x{00A0}\x{1680}\x{2000}-\x{200A}\x{202F}\x{205F}\x{3000}\x{FEFF}]+'
                . '|[\s\x{00A0}\x{1680}\x{2000}-\x{200A}\x{202F}\x{205F}\x{3000}\x{FEFF}]+$/u';

            return (string) preg_replace($pattern, '', $value);
        }

        /** Why the surface is not on the page, for the one person who will ask. */
        public static function log_withheld($e, $source)
        {
            if (function_exists('wc_get_logger')) {
                wc_get_logger()->debug(
                    'Two ' . $source . ' withheld: ' . $e->getMessage(),
                    ['source' => 'twoinc-' . $source]
                );
            }
        }

        private static function log_unrecognised_switch_once($key, $value)
        {
            static $logged = [];

            if (isset($logged[$key])) {
                return;
            }

            $logged[$key] = true;

            $reported = is_scalar($value) ? (string) $value : gettype($value);
            self::log_withheld(
                new Exception('unrecognised ' . $key . ' value "' . $reported . '"'),
                'storefront-gate'
            );
        }
    }
}
