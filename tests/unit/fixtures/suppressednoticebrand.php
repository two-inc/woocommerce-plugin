<?php

/**
 * Brand fixture for the intent-approved notice's suppressed state: a brand
 * that sets 'intent_approved_notice' to '' must emit no notice markup at
 * all, not an empty div. Kept separate from testbrand.php, which other
 * specs assert the exact merge result of.
 */

return [
    'code' => 'suppressednoticebrand',
    'product_name' => 'Suppressednoticebrand',
    'gateway_id' => 'woocommerce-gateway-suppressednoticebrand',
    'meta_prefix' => 'suppressednoticebrand',
    'intent_approved_notice' => '',
];
