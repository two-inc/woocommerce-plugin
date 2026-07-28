<?php

/**
 * Brand fixture for a whitespace-only 'intent_approved_notice' — an
 * unfinished copy override. It is inert exactly like '': the platform
 * default copy renders, rather than a notice reading as blank space.
 */

return [
    'code' => 'blanknoticecopybrand',
    'product_name' => 'Blanknoticecopybrand',
    'gateway_id' => 'woocommerce-gateway-blanknoticecopybrand',
    'meta_prefix' => 'blanknoticecopybrand',
    'intent_approved_notice' => "  \t ",
];
