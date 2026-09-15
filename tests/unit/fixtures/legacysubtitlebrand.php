<?php

/**
 * Brand fixture declaring ONLY the retired free-form 'checkout_subtitle'
 * key, the way a brand overlay written against the pre-TWO-25270 base
 * would. Nothing may read it: a sentence supplied as brand config cannot
 * be extracted for translation, which is the whole defect. The tagline
 * must therefore be skipped entirely — this fixture exists so any
 * reintroduced legacy path fails a test instead of shipping.
 */

return [
    'code' => 'legacysubtitlebrand',
    'product_name' => 'Legacysubtitlebrand',
    'gateway_id' => 'woocommerce-gateway-legacysubtitlebrand',
    'meta_prefix' => 'legacysubtitlebrand',
    'checkout_subtitle' => 'Voor alle bedrijven, <a href="https://legacy.example/faq">lees meer</a>.',
];
