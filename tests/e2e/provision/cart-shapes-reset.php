<?php

// Usage: wp eval-file tests/e2e/provision/cart-shapes-reset.php
//
// Undoes what docker/mu-plugins/two-e2e-carts.php set up and armed: its tax rate, its shipping method, the
// cart shapes and the postprocessing subscriber's mode.

$setup = get_option('two_e2e_setup');
if (is_array($setup)) {
    WC_Tax::_delete_tax_rate($setup['tax_rate']);
    (new WC_Shipping_Zone(0))->delete_shipping_method($setup['shipping_method']);
}
foreach (array('two_e2e_setup', 'two_e2e_cart_shape', 'twoinc_order_postprocessing_fixture') as $option) {
    delete_option($option);
}
WP_CLI::log('[cart-shapes] reset');
