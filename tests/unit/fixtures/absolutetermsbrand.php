<?php

/**
 * Brand fixture for a brand whose terms page is an absolute URL on its own
 * domain and whose consent sentence differs from the base one.
 */

return [
    'code' => 'absolutetermsbrand',
    'product_name' => 'Absolutetermsbrand',
    'provider_full_name' => 'Absolutetermsbrand Bank',
    'gateway_id' => 'woocommerce-gateway-absolutetermsbrand',
    'meta_prefix' => 'absolutetermsbrand',
    'payment_terms_link' => 'https://absolutetermsbrand.example/legal/terms',
    'payment_terms_text' => 'I agree to %1$s on behalf of %2$s.',
];
