<?php

/**
 * Brand fixture for the migration hazard TWO-25218 documents: a stale
 * overlay still carrying the pre-TWO-25218 empty 'intent_approved_notice'
 * and no switch. Empty copy is now INERT, so this renders the platform
 * default copy with the notice ON — wrong for that brand, but not a
 * broken store. There is deliberately no legacy-compat path resurrecting
 * empty-means-off.
 */

return [
    'code' => 'inertemptynoticebrand',
    'product_name' => 'Inertemptynoticebrand',
    'gateway_id' => 'woocommerce-gateway-inertemptynoticebrand',
    'meta_prefix' => 'inertemptynoticebrand',
    'intent_approved_notice' => '',
];
