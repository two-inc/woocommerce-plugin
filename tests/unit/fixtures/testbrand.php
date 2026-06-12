<?php

/**
 * Brand fixture for WC_Twoinc_Brand merge tests — overrides a subset of
 * keys the way a real overlay brand file would.
 */

return [
    'code' => 'testbrand',
    'product_name' => 'Testbrand',
    'gateway_id' => 'woocommerce-gateway-testbrand',
    'meta_prefix' => 'testbrand',
    // Deliberately messy: an overlay narrows the step set; declared
    // unsorted and with invalid entries (<=0, non-numeric) that
    // get_rounding_step_options must skip rather than fatal on. Expected
    // cleaned output: 0.50, 1.00.
    'available_rounding_steps' => [1.00, 0.50, 0, -2, 'x'],
    // The minimum order value is API-resolved (get_platform_minimum_order);
    // the brand gate only restricts billing countries.
    'availability_gate' => [
        'billing_countries' => ['NL'],
    ],
];
