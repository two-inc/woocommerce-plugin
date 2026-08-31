<?php

/**
 * Brand configuration loader.
 *
 * The base plugin ships brands/two.php. A brand overlay plugin points
 * the loader at its own brand file through the `twoinc_brand_file`
 * filter; overlay values are merged over the Two defaults so an overlay
 * declares only what differs.
 *
 * Timing contract: the config caches on first read, which happens when
 * WooCommerce constructs the payment gateways (after `plugins_loaded`).
 * An overlay MUST register its `twoinc_brand_file` filter no later than
 * `plugins_loaded` at default priority, or the Two defaults get cached
 * first.
 *
 * The TWO_BRAND_CODE env var forces a brand shipped inside this plugin
 * (brands/{code}.php) and exists for local development only — never
 * rely on it for production brand resolution.
 *
 * @author Two
 */

if (!class_exists('WC_Twoinc_Brand')) {
    class WC_Twoinc_Brand
    {
        /** @var array|null */
        private static $config;

        /**
         * @param string $key
         *
         * @return mixed null when the key is not declared
         */
        public static function get($key)
        {
            $config = self::config();
            return array_key_exists($key, $config) ? $config[$key] : null;
        }

        /**
         * @return array
         */
        public static function config()
        {
            if (self::$config !== null) {
                return self::$config;
            }

            $defaults = require WC_TWOINC_PLUGIN_PATH . 'brands/two.php';

            $brand_file = null;
            $env_code = getenv('TWO_BRAND_CODE');
            if ($env_code && $env_code !== 'two') {
                // basename() so the env var can only select files inside brands/
                $candidate = WC_TWOINC_PLUGIN_PATH . 'brands/' . basename($env_code) . '.php';
                if (is_file($candidate)) {
                    $brand_file = $candidate;
                }
            }
            if ($brand_file === null) {
                // No (resolvable) env override: ask installed overlays. A stale
                // env value must not silently disable an installed overlay.
                $brand_file = apply_filters('twoinc_brand_file', null);
            }

            $config = $defaults;
            // Defence in depth: a filter-supplied path must be a real .php
            // file inside the plugins (or mu-plugins) tree. Co-resident
            // plugins are trusted code, but this keeps the loader from ever
            // require-ing uploads or other writable paths.
            if ($brand_file && is_file($brand_file) && substr($brand_file, -4) === '.php') {
                $real = realpath($brand_file);
                $plugin_root = defined('WP_PLUGIN_DIR') ? realpath(WP_PLUGIN_DIR) : false;
                $mu_root = defined('WPMU_PLUGIN_DIR') ? realpath(WPMU_PLUGIN_DIR) : false;
                $inside = static function ($root) use ($real) {
                    return $root && $real && strpos($real, $root . DIRECTORY_SEPARATOR) === 0;
                };
                if ($real && (!$plugin_root && !$mu_root || $inside($plugin_root) || $inside($mu_root))) {
                    $config = array_merge($defaults, (array) require $real);
                }
            }

            self::$config = $config;
            return self::$config;
        }

        /**
         * Brand-prefixed name, e.g. meta_prefix 'twoinc' + 'order_id' -> 'twoinc_order_id'.
         *
         * @param string $name
         *
         * @return string
         */
        public static function prefixed_name($name)
        {
            return self::get('meta_prefix') . '_' . $name;
        }

        /**
         * Brand-prefixed hidden order meta key, e.g. 'order_reference'
         * -> '_twoinc_order_reference'. Live stores hold data under the
         * brand's prefix, so it is load-bearing for existing orders —
         * never hardcode the literal.
         *
         * @param string $name
         *
         * @return string
         */
        public static function meta_key($name)
        {
            return '_' . self::prefixed_name($name);
        }

        /**
         * Confirmation-callback token from the request: new `<prefix>_csrf_token`
         * param first, falling back to the pre-rename `<prefix>_nonce` param so a
         * callback URL minted before that rename deployed (already stored
         * upstream on an in-flight order) still resolves. The nonce action
         * itself (`confirm_<order_id>`) didn't change, only this param name —
         * drop the fallback once no order confirmed before that deploy is still
         * in flight (PR #519).
         *
         * @return string|null
         */
        public static function read_confirmation_csrf_token_param()
        {
            if (isset($_REQUEST[self::prefixed_name('csrf_token')])) {
                return $_REQUEST[self::prefixed_name('csrf_token')];
            }
            if (isset($_REQUEST[self::prefixed_name('nonce')])) {
                return $_REQUEST[self::prefixed_name('nonce')];
            }
            return null;
        }

        /** @internal Test-only — clearing mid-request would re-run brand resolution. */
        public static function reset()
        {
            self::$config = null;
        }
    }
}
