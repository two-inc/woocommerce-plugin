<div class="checkout woocommerce-checkout custom-checkout">
    <div class="twoinc-inp-container">
        <div id="billing_phone_display_field">
            <label for="billing_phone_display"><?php esc_html_e('Phone', 'twoinc-payment-gateway'); ?> <abbr class="required" title="required">*</abbr></label>
            <br>
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
            <br>
            <select name="billing_country" id="billing_country">
                <?php
                    $countries = WC()->countries->get_countries();
                    $base_country = WC()->countries->get_base_country();
                    foreach ($countries as $country_code => $country_name) {
                        if ($base_country === $country_code) {
                            printf('<option value="%s" selected>%s</option>', $country_code, $country_name);
                        } else {
                            printf('<option value="%s">%s</option>', $country_code, $country_name);
                        }
                    }
                ?>
            </select>
        </div>
    </div>
    <div class="twoinc-inp-container">
        <div id="billing_company_display_field">
            <label for="billing_company_display"><?php esc_html_e('Company name', 'twoinc-payment-gateway'); ?> <abbr class="required" title="required">*</abbr></label>
            <br>
            <select name="billing_company_display" class="billing_company_selectwoo" id="billing_company_display">
                <option>&nbsp;</option>
            </select>
        </div>
    </div>
    <div class="twoinc-inp-container hidden">
        <div id="billing_company_field">
            <input type="text" name="billing_company" id="billing_company">
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

        function initInpFields() {
            let inpWidth = jQuery('#billing_phone_display').outerWidth()
            let inpHeight = jQuery('#billing_phone_display').outerHeight()
            jQuery('[aria-labelledby="select2-billing_country-container"]').outerWidth(inpWidth)
            jQuery('[aria-labelledby="select2-billing_country-container"]').outerHeight(inpHeight)
            jQuery('#billing_country_field .select2-container').outerWidth(inpWidth)
            jQuery('#billing_country_field .select2-container').outerHeight(inpHeight)
            jQuery('[aria-labelledby="select2-billing_company_display-container"]').outerWidth(inpWidth)
            jQuery('[aria-labelledby="select2-billing_company_display-container"]').outerHeight(inpHeight)
            jQuery('#billing_company_display_field .select2-container').outerWidth(inpWidth)
            jQuery('#billing_company_display_field .select2-container').outerHeight(inpHeight)
        }

        jQuery('#order_review #payment').prepend(jQuery('.custom-checkout'))
        jQuery('#order_review #payment').prepend(jQuery('.account-type-wrapper'))
        jQuery("#billing_country").selectWoo()
        setTimeout(function(){
            initInpFields()
            jQuery('.account-type-button[account-type-name="business"]').click()
        }, 1000)
        jQuery('.account-type-button[account-type-name="personal"], .account-type-button[account-type-name="sole_trader"]').on('click', function(){
            jQuery('.twoinc-inp-container').hide()
        })
        jQuery('.account-type-button[account-type-name="business"]').on('click', function(){
            jQuery('.twoinc-inp-container:not(.hidden)').show()
            initInpFields()
            jQuery('#payment_method_woocommerce-gateway-tillit:visible').click()
        })
        jQuery('#billing_country').on('select2:select', function(e){
            initInpFields()
        })
    })
</script>
<style>
    .custom-checkout {
        display: flex;
        flex-wrap: wrap;
        margin-top: 20px;
        margin-bottom: 20px;
    }
    .custom-checkout .twoinc-inp-container {
        margin: auto;
    }
    .account-type-wrapper, #account_type_field {
        display: none!important;
    }
</style>