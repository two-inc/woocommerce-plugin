<?php

/**
 * Two brand configuration — the default brand of the base plugin.
 *
 * A brand overlay plugin supplies its own file with the same shape via
 * the `twoinc_brand_file` filter; its values are merged over these
 * defaults, so an overlay declares only what differs.
 *
 * Every key here has a runtime consumer, mirrors a BC-frozen WC_Twoinc
 * constant, or is asserted by tests/unit (`code`) — no speculative keys.
 */

return [
    'code' => 'two',
    'provider' => 'Two',
    'provider_full_name' => 'Two',
    'product_name' => 'Two',
    'sign_up_url' => 'https://portal.two.inc/auth/merchant/signup',
    // sprintf template building environment hosts: %s receives 'api'/
    // 'checkout' in production, or 'api.<mode>'/'checkout.<mode>' for any
    // other checkout_env mode. Brand domains never live in base code.
    'checkout_url_template' => 'https://%s.two.inc',
    'alert_email_address' => 'woocom-alerts@two.inc',
    'gateway_id' => 'woocommerce-gateway-tillit',
    'logo_url' => WC_TWOINC_PLUGIN_URL . 'assets/images/two-logo.svg',
    'about_url' => 'https://www.two.inc/what-is-two',
    // Meta key prefix (e.g. _twoinc_order_reference, twoinc_company_id)
    // and the confirmation request param/nonce prefix. An overlay MUST
    // set the prefix its installed base already uses — live stores hold
    // data under it.
    'meta_prefix' => 'twoinc',
    // Gates the gateway off checkout when unmet:
    // ['min_order_amount' => float, 'currency' => 'EUR',
    // 'billing_countries' => ['NL']]. min_order_amount compares the NET
    // basket (total minus tax) — matches the funding partner's risk rule.
    // null = no gate.
    'availability_gate' => null,
    // Countries offered in the checkout company-search JS.
    'supported_buyer_countries' => ['NO', 'GB', 'SE', 'NL', 'FI', 'DK'],
    // Default for the payment-method Title setting on fresh installs
    // (merchant-saved titles always win); sprintf'd with the invoice day
    // count, so a brand default may carry one %s.
    'title_default' => 'Business invoice - %s days',
    // NOTE: the offerable payment-term list is sourced per merchant from
    // `available_terms` on GET /v1/merchant (TWO-24812) — an overlay
    // defining 'available_terms' has no effect.
    // Increments the buyer surcharge line may be rounded to (merchant
    // picks one in the admin Rounding Step dropdown; None disables
    // rounding). WC_Twoinc::get_rounding_step_options is the only reader.
    'available_rounding_steps' => [0.10, 0.50, 1.00, 5.00, 10.00],
    // Buyer-facing label for the offset-pricing fee line; null uses the
    // translated "Service charge" default.
    'fee_line_label' => null,
    // FAQ link target for the tagline under the payment-method title. The
    // tagline sentence itself is a fixed, statically-extracted msgid in
    // WC_Twoinc::get_pay_subtitle (TWO-25270) — a brand owns only this
    // URL, not the wording; null/'' renders no tagline.
    'checkout_subtitle_faq_url' => null,
    // Contact address shown in the admin API-key field help for
    // obtaining production keys. WC_Twoinc::init_form_fields is the only
    // reader.
    'production_key_contact_email' => 'integration@two.inc',
    // On/off switch for the order-intent pre-check's reassurance messaging
    // (approved notice + loading state; TWO-25224 — both switch
    // together). Does not cover the pre-check's error boxes. Explicit
    // boolean only; anything else defaults true.
    'intent_approved_notice_enabled' => true,
    // Copy override for that notice — wording only, not on/off (use
    // 'intent_approved_notice_enabled' for that; it carried the on/off
    // meaning too until TWO-25218, no longer). null/''/whitespace-only
    // falls back to WC_Twoinc::get_intent_approved_notice's default. A
    // non-empty string is the sprintf template verbatim: %1$s
    // product_name, %2$s buyer company name.
    'intent_approved_notice' => null,
    // Deliberately no 'intent_declined_notice' key: that notice is never
    // brand-overridable (TWO-25326) — an overlay defining one is ignored.
];
