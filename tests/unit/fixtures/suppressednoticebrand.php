<?php

/**
 * Brand fixture for the intent-approved notice's off switch: a brand that
 * sets 'intent_approved_notice_enabled' to false must emit no notice
 * markup at all, not an empty div. It declares no copy override — the
 * switch alone turns the notice off (TWO-25218). Kept separate from
 * testbrand.php, which other specs assert the exact merge result of.
 */

return [
    'code' => 'suppressednoticebrand',
    'product_name' => 'Suppressednoticebrand',
    'gateway_id' => 'woocommerce-gateway-suppressednoticebrand',
    'meta_prefix' => 'suppressednoticebrand',
    'intent_approved_notice_enabled' => false,
];
