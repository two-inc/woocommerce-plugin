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
         * Get a single brand config value
         *
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
         * Get the full brand config, loading it on first use
         *
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
            if ($brand_file && is_file($brand_file)) {
                $config = array_merge($defaults, (array) require $brand_file);
            }

            self::$config = $config;
            return self::$config;
        }

        /**
         * Drop the cached config so the next read reloads it.
         *
         * @internal Test-only. Clearing the cache mid-request would re-run
         *           brand resolution with potentially different results.
         *
         * @return void
         */
        public static function reset()
        {
            self::$config = null;
        }
    }
}
