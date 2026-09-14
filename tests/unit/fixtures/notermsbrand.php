<?php

/**
 * Brand fixture for a brand that declares no terms page. Absence of
 * `payment_terms_link` is the consent's only off switch, so this brand must
 * render no checkbox and must not be refused at payment for one.
 */

return [
    'code' => 'notermsbrand',
    'product_name' => 'Notermsbrand',
    'gateway_id' => 'woocommerce-gateway-notermsbrand',
    'meta_prefix' => 'notermsbrand',
    'payment_terms_link' => null,
];
