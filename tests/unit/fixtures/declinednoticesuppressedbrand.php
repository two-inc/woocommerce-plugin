<?php

/**
 * Brand fixture for the intent-declined notice's off switch: a brand that
 * sets 'intent_declined_notice_enabled' to false must emit no
 * `.twoinc-err-payment-default` markup at all. Leaves the approved
 * notice's switch untouched (default true) to isolate the declined switch.
 */

return [
    'code' => 'declinednoticesuppressedbrand',
    'product_name' => 'Declinednoticesuppressedbrand',
    'gateway_id' => 'woocommerce-gateway-declinednoticesuppressedbrand',
    'meta_prefix' => 'declinednoticesuppressedbrand',
    'intent_declined_notice_enabled' => false,
];
