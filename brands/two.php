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
    // Order/user meta key prefix (e.g. _twoinc_order_reference,
    // twoinc_order_id, twoinc_company_id) and the confirmation request
    // param/nonce prefix. Live stores hold data under this prefix —
    // an overlay MUST set the prefix its installed base already uses.
    'meta_prefix' => 'twoinc',
    // Brand product constraints removing the gateway from checkout when
    // unmet: ['min_order_amount' => float, 'currency' => 'EUR',
    // 'billing_countries' => ['NL']]. null = no gate (Two default).
    'availability_gate' => null,
    // Countries offered in the checkout company-search JS.
    'supported_buyer_countries' => ['NO', 'GB', 'SE', 'NL', 'FI', 'DK'],
    // Default for the payment-method Title setting on fresh installs
    // (merchant-saved titles always win). sprintf'd with the invoice
    // day count, so a brand default may carry one %s.
    'title_default' => 'Business invoice - %s days',
];
