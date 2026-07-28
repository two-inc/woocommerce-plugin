<?php

/**
 * Brand fixture for the intent-approved notice's override state: a
 * non-empty 'intent_approved_notice' is the company-variant sprintf
 * template, used verbatim, with %1$s the brand product name and %2$s the
 * buyer's company name.
 */

return [
    'code' => 'customnoticebrand',
    'product_name' => 'Customnoticebrand',
    'gateway_id' => 'woocommerce-gateway-customnoticebrand',
    'meta_prefix' => 'customnoticebrand',
    'intent_approved_notice' => 'Brand copy: %1$s may accept this for %2$s.',
];
