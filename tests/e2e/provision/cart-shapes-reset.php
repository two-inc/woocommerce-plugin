<?php

// Usage: wp eval-file tests/e2e/provision/cart-shapes-reset.php
//
// Undoes what docker/mu-plugins/two-e2e-carts.php set up and armed: its tax rate, its shipping method, the
// cart shapes, the setup lock and the postprocessing subscriber's mode.

$setup = get_option('two_e2e_setup');
if (is_array($setup)) {
    WC_Tax::_delete_tax_rate($setup['tax_rate']);
}
// Every flat rate in the "rest of the world" zone, not only the stored one: the e2e shop has no other, and a
// stray left by an earlier run would otherwise be offered at checkout (TWO-26215).
$zone = new WC_Shipping_Zone(0);
foreach ($zone->get_shipping_methods() as $instance_id => $method) {
    if ($method->id === 'flat_rate') {
        $zone->delete_shipping_method($instance_id);
    }
}
foreach (array('two_e2e_setup', 'two_e2e_setup_lock', 'two_e2e_cart_shape', 'twoinc_order_postprocessing_fixture') as $option) {
    delete_option($option);
}
WP_CLI::log('[cart-shapes] reset');
