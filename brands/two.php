<?php

/**
 * Two brand configuration — the default brand of the base plugin.
 *
 * A brand overlay plugin supplies its own
 * file with the same shape via the `twoinc_brand_file` filter; its
 * values are merged over these defaults, so an overlay declares only
 * what differs.
 *
 * Every key here has a runtime consumer, mirrors one of the BC-frozen
 * WC_Twoinc constants, or is asserted by tests/unit (`code`). Do not
 * declare speculative config — new keys land with the code that reads
 * them.
 */

return [
    'code' => 'two',
    'provider' => 'Two',
    'provider_full_name' => 'Two',
    'product_name' => 'Two',
    'sign_up_url' => 'https://portal.two.inc/auth/merchant/signup',
    // sprintf template building environment hosts, mirroring the Magento
    // brand descriptor's checkout_url_template: %s receives 'api' /
    // 'checkout' in production, or 'api.<mode>' / 'checkout.<mode>' for
    // any other checkout_env mode ('sandbox', 'staging', ...). Overlays
    // set their own domain here — brand domains never live in base code.
    'checkout_url_template' => 'https://%s.two.inc',
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
    // 'billing_countries' => ['NL']]. min_order_amount compares the NET
    // basket (total minus tax) — the funding partner's server-side risk
    // rule compares net. null = no gate (Two default).
    'availability_gate' => null,
    // Countries offered in the checkout company-search JS.
    'supported_buyer_countries' => ['NO', 'GB', 'SE', 'NL', 'FI', 'DK'],
    // Default for the payment-method Title setting on fresh installs
    // (merchant-saved titles always win). sprintf'd with the invoice
    // day count, so a brand default may carry one %s.
    'title_default' => 'Business invoice - %s days',
    // NOTE: the offerable payment-term list no longer lives in the brand
    // file — it is sourced per merchant from `available_terms` on
    // GET /v1/merchant (TWO-24812). A brand overlay defining
    // 'available_terms' has no effect.
    // Increments the buyer surcharge line may be rounded to, offered in
    // the admin Rounding Step dropdown (the merchant picks one; the None
    // basis disables rounding). WC_Twoinc::get_rounding_step_options is
    // the only reader. Mirrors the Magento brand descriptor's
    // surcharge_rounding_steps; an overlay narrows the set.
    'available_rounding_steps' => [0.10, 0.50, 1.00, 5.00, 10.00],
    // Buyer-facing label for the offset-pricing fee line; null uses the
    // translated "Service charge" default.
    'fee_line_label' => null,
    // Short tagline rendered under the payment-method title at checkout,
    // above the about block. '' renders nothing (the Two default).
    // WC_Twoinc::get_pay_subtitle is the only reader. Mirrors the
    // Magento brand descriptor's checkout_subtitle.
    'checkout_subtitle' => '',
    // Contact address shown in the admin API-key field help for
    // obtaining production keys. WC_Twoinc::init_form_fields is the only
    // reader. A brand overlay substitutes its own support address.
    'production_key_contact_email' => 'integration@two.inc',
];
