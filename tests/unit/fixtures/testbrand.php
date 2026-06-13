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
    // The minimum order value is API-resolved (get_platform_minimum_order);
    // the brand gate only restricts billing countries.
    'availability_gate' => [
        'billing_countries' => ['NL'],
    ],
];
