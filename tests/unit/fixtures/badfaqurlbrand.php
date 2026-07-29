<?php

/**
 * Brand fixture whose FAQ URL is not a string at all. get_pay_subtitle
 * must drop the tagline rather than hand this to esc_url, which fatals on
 * an array under PHP 8 — a brand config typo must not take the checkout
 * page down.
 */

return [
    'code' => 'badfaqurlbrand',
    'product_name' => 'Badfaqurlbrand',
    'gateway_id' => 'woocommerce-gateway-badfaqurlbrand',
    'meta_prefix' => 'badfaqurlbrand',
    'checkout_subtitle_faq_url' => ['https://badfaqurlbrand.example/faq'],
];
