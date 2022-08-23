// Snippet: Fill hidden fields for auto complete in checkout

add_action( 'wp_head', function () { ?>
<script>

function fillHiddenFields(form) {
    let fields = ['billing_email', 'billing_phone', 'billing_state', 'billing_city',
                  'billing_postcode', 'billing_address_1', 'billing_address_2', 'company_id',
                  'billing_company', 'billing_country', 'tracking_id', 'billing_last_name',
                  'billing_first_name']
    for (fld of fields) {
        if (jQuery('#' + fld) && jQuery('form[name="checkout"] [name="' + fld + '"]')) {
            jQuery('form[name="checkout"] [name="' + fld + '"]').val(jQuery('#' + fld).val() || jQuery('#' + fld).attr('value'))
        }
    }
    return true
}
jQuery(function(){
    jQuery('form.checkout').on('checkout_place_order', fillHiddenFields)
})

</script>
<?php } );
