<?php

/**
 * Brand fixture for the checkout payment-box ordering tests.
 *
 * The only thing that matters here is that checkout_subtitle_faq_url is
 * non-empty, the way a real overlay brand's is — the tagline block is
 * skipped entirely when the key is null (the Two default), so the
 * ordering assertions need a brand that renders one.
 */

return [
    'code' => 'taglinebrand',
    'product_name' => 'Taglinebrand',
    'gateway_id' => 'woocommerce-gateway-taglinebrand',
    'meta_prefix' => 'taglinebrand',
    'checkout_subtitle_faq_url' => 'https://taglinebrand.example/faq',
];
