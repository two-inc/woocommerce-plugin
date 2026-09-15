<?php

/**
 * Brand fixture for an INVALID intent-approved notice switch: the key is
 * declared as an empty string, which under the pre-TWO-25218 contract was
 * how "off" was expressed. It is not a bool, so it must be reported as an
 * error and fall back to the documented default true — never silently
 * treated as a third behaviour.
 */

return [
    'code' => 'invalidnoticeswitchbrand',
    'product_name' => 'Invalidnoticeswitchbrand',
    'gateway_id' => 'woocommerce-gateway-invalidnoticeswitchbrand',
    'meta_prefix' => 'invalidnoticeswitchbrand',
    'intent_approved_notice_enabled' => '',
];
