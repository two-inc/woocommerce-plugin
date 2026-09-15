<?php

/**
 * Brand fixture whose about page is a script URL — the shape esc_url blanks
 * into an empty href, which would leave an icon that reloads checkout.
 */

return [
    'code' => 'scriptabouturlbrand',
    'product_name' => 'Scriptabouturlbrand',
    'gateway_id' => 'woocommerce-gateway-scriptabouturlbrand',
    'meta_prefix' => 'scriptabouturlbrand',
    'about_url' => 'javascript:alert(1)',
];
