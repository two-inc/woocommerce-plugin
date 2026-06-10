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
    'availability_gate' => [
        'min_order_amount' => 250.0,
        'currency' => 'EUR',
        'billing_countries' => ['NL'],
    ],
];
