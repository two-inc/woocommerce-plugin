<?php

/**
 * Two brand configuration — the default brand of the base plugin.
 *
 * A brand overlay plugin (e.g. the ABN AMRO edition) supplies its own
 * file with the same shape via the `twoinc_brand_file` filter; its
 * values are merged over these defaults, so an overlay declares only
 * what differs.
 *
 * Every key here either has a runtime consumer or mirrors one of the
 * BC-frozen WC_Twoinc constants (pinned by tests/unit). Do not declare
 * speculative config — new keys land with the code that reads them.
 */

return [
    'code' => 'two',
    'provider' => 'Two',
    'provider_full_name' => 'Two',
    'product_name' => 'Two',
    'merchant_signup_url' => 'https://portal.two.inc/auth/merchant/signup',
    'alert_email_address' => 'woocom-alerts@two.inc',
    'gateway_id' => 'woocommerce-gateway-tillit',
    'logo_url' => WC_TWOINC_PLUGIN_URL . 'assets/images/two-logo.svg',
    'about_url' => 'https://www.two.inc/what-is-two',
];
