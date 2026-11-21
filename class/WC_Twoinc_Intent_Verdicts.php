<?php

if (!class_exists('WC_Twoinc_Intent_Verdicts')) {
    /**
     * One buyer's order intent verdicts, so order creation can refuse a declined
     * company (TWO-25657), in a wp_options row named after their session customer id.
     *
     * Not the WooCommerce session: saving that from the order intent request, which
     * waits on Two, makes WooCommerce 11.3.1 refuse a checkout request that overlaps
     * it (TWO-27353). Not a transient or the options API either: a persistent object
     * cache keeps transients only in the cache, where an eviction would let a declined
     * company through, and the options API records every missing or deleted name in
     * one shared cache entry that would grow by a name per buyer. So the rows are read
     * and written with SQL, as "<expiry timestamp>|<JSON verdicts>", which also lets
     * the cleanup compare expiries in the database. Needs no WooCommerce, so uninstall
     * can clear the rows after WooCommerce has gone.
     */
    class WC_Twoinc_Intent_Verdicts
    {
        /** A guest session's default lifetime, which is how long the session held them before TWO-27353. */
        private const TTL = 2 * 24 * 60 * 60;

        private static function prefix(): string
        {
            return WC_Twoinc_Brand::prefixed_name('intent_verdicts_');
        }

        /** @return array<string, bool> The buyer's verdicts by company, or none once they have expired. */
        public static function read(string $customer_id): array
        {
            global $wpdb;
            $value = (string) $wpdb->get_var($wpdb->prepare(
                "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s LIMIT 1",
                self::prefix() . md5($customer_id)
            ));
            $parts = explode('|', $value, 2);
            $verdicts = count($parts) === 2 && (int) $parts[0] > time() ? json_decode($parts[1], true) : null;
            return is_array($verdicts) ? $verdicts : [];
        }

        /** Not autoloaded: one buyer's row is never needed on another's request. */
        public static function write(string $customer_id, array $verdicts): void
        {
            global $wpdb;
            $wpdb->query($wpdb->prepare(
                "INSERT INTO {$wpdb->options} (option_name, option_value, autoload) VALUES (%s, %s, 'no')"
                . ' ON DUPLICATE KEY UPDATE option_value = VALUES(option_value)',
                self::prefix() . md5($customer_id),
                (time() + self::TTL) . '|' . wp_json_encode($verdicts)
            ));
        }

        /** On WooCommerce's session cleanup, which fires it with no arguments. */
        public static function delete_expired(): void
        {
            global $wpdb;
            $wpdb->query($wpdb->prepare(
                "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s"
                . " AND CAST(SUBSTRING_INDEX(option_value, '|', 1) AS UNSIGNED) <= %d",
                $wpdb->esc_like(self::prefix()) . '%',
                time()
            ));
        }

        /** On uninstall: nothing would expire them once the plugin is gone. */
        public static function delete_all(): void
        {
            global $wpdb;
            $wpdb->query($wpdb->prepare(
                "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s",
                $wpdb->esc_like(self::prefix()) . '%'
            ));
        }
    }
}
