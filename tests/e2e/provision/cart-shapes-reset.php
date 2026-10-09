<?php

// Usage: wp eval-file tests/e2e/provision/cart-shapes-reset.php
//
// Undoes what docker/mu-plugins/two-e2e-carts.php set up and armed: its tax rate, its shipping method, the
// cart shapes, the setup lock, the postprocessing subscriber's mode and the shipping tax control.

$setup = get_option('two_e2e_setup');
if (is_array($setup)) {
    WC_Tax::_delete_tax_rate($setup['tax_rate']);
}
// The stored flat rate, and any flat rate in the "rest of the world" zone that was never configured: a stray an
// earlier run created would otherwise be offered at checkout for free (TWO-26215). A rate someone set up by hand
// has saved settings and is kept.
$zone = new WC_Shipping_Zone(0);
foreach ($zone->get_shipping_methods() as $instance_id => $method) {
    $stored = is_array($setup) && (int) $setup['shipping_method'] === (int) $instance_id;
    $unconfigured = get_option("woocommerce_flat_rate_{$instance_id}_settings") === false;
    if ($method->id === 'flat_rate' && ($stored || $unconfigured)) {
        $zone->delete_shipping_method($instance_id);
    }
}
// Disarmed first and unlocked last, so no request in between can start the setup again.
foreach (array('two_e2e_cart_shape', 'twoinc_order_postprocessing_fixture', 'twoinc_shipping_tax_from_shop_rates', 'two_e2e_setup', 'two_e2e_setup_lock') as $option) {
    delete_option($option);
}
WP_CLI::log('[cart-shapes] reset');
