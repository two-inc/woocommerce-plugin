<?php

/**
 * Brand fixture proving 'intent_declined_notice' is NOT a supported
 * override (2026-08-04 ruling, TWO-25326): the "order intent NOT approved"
 * notice must render the exact same platform default copy for every
 * brand. WC_Twoinc no longer reads this key at all, so an overlay
 * declaring it (whether by habit, copy-paste from the approved-notice
 * fixture, or a stale doc) must be silently ignored, not honoured.
 */

return [
    'code' => 'decidedoverridebrand',
    'product_name' => 'Decidedoverridebrand',
    'gateway_id' => 'woocommerce-gateway-decidedoverridebrand',
    'meta_prefix' => 'decidedoverridebrand',
    'intent_declined_notice' => 'This override must never render: %1$s / %2$s.',
];
