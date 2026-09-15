<?php

/**
 * Brand fixture whose product name carries markup, so the about tooltip's
 * escaping of it is exercised rather than assumed.
 */

return [
    'code' => 'markupproductnamebrand',
    'product_name' => '<b>Acme</b> & Pay',
    'gateway_id' => 'woocommerce-gateway-markupproductnamebrand',
    'meta_prefix' => 'markupproductnamebrand',
    'about_url' => 'https://www.two.inc/what-is-two',
];
