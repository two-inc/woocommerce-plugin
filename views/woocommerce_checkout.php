<?php
/**
 * @global WC_Checkout $checkout
 */
$checkout = WC()->checkout(); ?>
<div class="woocommerce-billing-fields woocommerce-account-type-fields">


<!-- selectable phone country -->
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/17.0.8/css/intlTelInput.css" />
<script src="https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/17.0.8/js/intlTelInput.min.js"></script>
<script>
    var billingPhoneInput
    jQuery(function(){
        if (window.tillit) {
            let billingPhoneInputField = document.querySelector("#billing_phone_display")
            billingPhoneInput = window.intlTelInput(billingPhoneInputField, {
                utilsScript: "https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/17.0.8/js/utils.js",
                preferredCountries: [window.tillit.shop_base_country]
            })
            if (jQuery('#billing_phone')) {
                billingPhoneInput.setNumber(jQuery('#billing_phone').val())
            }
        }
    })
</script>


<?php
if (sizeof($this->wc_tillit->available_account_types()) > 1)
{
    echo '<h3>';
    esc_html_e('Account type', 'tillit-payment-gateway');
    echo '</h3>';
}
?>
    <div class="woocommerce-account-type-fields__field-wrapper">
        <?php
        $fields = $checkout->get_checkout_fields('account_type');
        if (is_array($fields)) {
            foreach($fields as $key => $field){
                $value = isset($field['value']) ? $field['value'] : $checkout->get_value($key);
                woocommerce_form_field($key, $field, $value);
            }
        }
        ?>
    </div>
</div>
