<?php

/**
 * Brand fixture for the checkout payment-box ordering tests.
 *
 * The only thing that matters here is that checkout_subtitle is non-empty
 * and carries an inline link, the way a real overlay brand's tagline does
 * — the tagline block is skipped entirely when the key is '' (the Two
 * default), so the ordering assertions need a brand that renders one.
 */

return [
    'code' => 'taglinebrand',
    'product_name' => 'Taglinebrand',
    'gateway_id' => 'woocommerce-gateway-taglinebrand',
    'meta_prefix' => 'taglinebrand',
    'checkout_subtitle' => 'For all companies, <a href="https://taglinebrand.example/faq" target="_blank" rel="noopener">read more</a>.',
];
