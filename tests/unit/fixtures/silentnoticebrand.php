<?php

/**
 * Brand fixture for a third-party overlay that has no opinion about the
 * intent-approved notice: it declares NEITHER
 * 'intent_approved_notice_enabled' NOR 'intent_approved_notice'. Absent
 * means the documented default, so the notice stays ON with the platform
 * default copy — the must-not-regress case that absent-means-true exists
 * for (TWO-25218).
 */

return [
    'code' => 'silentnoticebrand',
    'product_name' => 'Silentnoticebrand',
    'gateway_id' => 'woocommerce-gateway-silentnoticebrand',
    'meta_prefix' => 'silentnoticebrand',
];
