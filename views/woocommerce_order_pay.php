<?php

/**
 * The Two gateway's cut-down form on WooCommerce's pay-for-order page.
 *
 * @var string $twoinc_order_pay_country ISO code the form starts on, resolved
 *      by WC_Twoinc_Checkout::order_pay_page_customize() from the order.
 */

?>
<div class="checkout woocommerce-checkout custom-checkout twoinc-order-pay">
    <div class="twoinc-inp-container">
        <div id="billing_phone_display_field">
            <label for="billing_phone_display"><?php esc_html_e('Phone', 'twoinc-payment-gateway'); ?> <abbr class="required" title="required">*</abbr></label>
            <input type="text" name="billing_phone_display" id="billing_phone_display">
        </div>
    </div>
    <div class="twoinc-inp-container hidden">
        <div id="billing_phone_field">
            <input type="text" name="billing_phone" id="billing_phone">
        </div>
    </div>
    <div class="twoinc-inp-container hidden">
        <div id="billing_country_field">
            <label for="billing_country"><?php esc_html_e('Country / Region', 'twoinc-payment-gateway'); ?> <abbr class="required" title="required">*</abbr></label>
            <select name="billing_country" id="billing_country">
                <?php
                foreach (WC()->countries->get_countries() as $country_code => $country_name) {
                    printf(
                        '<option value="%s"%s>%s</option>',
                        esc_attr($country_code),
                        $twoinc_order_pay_country === $country_code ? ' selected' : '',
                        esc_html($country_name)
                    );
                }
                ?>
            </select>
        </div>
    </div>
    <div class="twoinc-inp-container">
        <div id="billing_company_display_field">
            <label for="billing_company_display"><?php esc_html_e('Company name', 'twoinc-payment-gateway'); ?></label>
            <input type="text" name="billing_company_display"
                   class="billing_company_search" id="billing_company_display"
                   autocomplete="off">
        </div>
    </div>
    <div class="twoinc-inp-container hidden">
        <div id="billing_company_field">
            <label for="billing_company"><?php esc_html_e('Company name', 'twoinc-payment-gateway'); ?></label>
            <input type="text" name="billing_company" id="billing_company">
        </div>
    </div>
    <div class="twoinc-inp-container hidden">
        <div id="company_name_field">
            <input type="text" name="company_name" id="company_name">
        </div>
    </div>
    <div class="twoinc-inp-container hidden">
        <div id="company_id_field">
            <input type="text" name="company_id" id="company_id">
        </div>
    </div>
</div>
<script>
    jQuery(function(){
        jQuery('#order_review #payment').prepend(jQuery('.twoinc-order-pay'))
    })
</script>
