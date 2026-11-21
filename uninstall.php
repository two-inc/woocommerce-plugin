<?php

/**
 * WordPress uninstall entry point (TWO-25498). WP includes this file
 * directly when the plugin is deleted via wp-admin, and ONLY then — not on
 * deactivation. This is the sole reliable place for uninstall-time cleanup:
 * register_uninstall_hook() from the main plugin file cannot be used
 * instead, because uninstalling requires the plugin to already be
 * deactivated, so this plugin's own plugins_loaded listener
 * (load_twoinc_classes(), which requires class/WC_Twoinc.php) never runs
 * for this request and the callback would have no class to call.
 */

if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

// The brand config reads these, and only the main plugin file defines them, which uninstall does not load.
if (!defined('WC_TWOINC_PLUGIN_URL')) {
    define('WC_TWOINC_PLUGIN_URL', plugin_dir_url(__FILE__));
}
if (!defined('WC_TWOINC_PLUGIN_PATH')) {
    define('WC_TWOINC_PLUGIN_PATH', plugin_dir_path(__FILE__));
}

require_once __DIR__ . '/class/WC_Twoinc_Brand.php';
require_once __DIR__ . '/class/WC_Twoinc_FX.php';
require_once __DIR__ . '/class/WC_Twoinc_Intent_Verdicts.php';

// Buyers' order intent verdicts are not settings, and nothing would expire them once the
// plugin is gone. Plain rows, so cleared even when WooCommerce has gone first.
WC_Twoinc_Intent_Verdicts::delete_all();

// WC_Twoinc extends WooCommerce core's WC_Payment_Gateway. WooCommerce may
// have been deactivated ahead of (or instead of) this plugin, in which case
// there is no buyer-facing gateway settings row left to clear.
if (!class_exists('WC_Payment_Gateway')) {
    return;
}

require_once __DIR__ . '/class/WC_Twoinc.php';

WC_Twoinc::maybe_clear_settings_on_uninstall();
