// Add due in days to order req body to Two
function add_two_order_fields($two_req) {
    $due_in_days = (string) get_post_meta($two_req['merchant_order_id'], '_billing_due_in_days', true);
    if ($due_in_days && ctype_digit($due_in_days)) {
        $twoinc_obj = WC_Twoinc::get_instance();
        $two_req["invoice_details"]['due_in_days'] = (int) $due_in_days;
    }
    return $two_req;
}
add_filter("two_order_create", "add_two_order_fields");


// Add the new field due in days in checkout
function add_two_due_days($fields) {

    $lang = WC_Twoinc_Helper::get_locale();
    $label_text = "Days you'll have to pay your invoice";
    if ($lang === 'sv_SE') {
        $label_text = 'Dagar du kommer ha att betala din faktura';
    } else if ($lang === 'nb_NO') {
        $label_text = 'Dager du må betale fakturaen';
    }

    $fields['billing']['billing_due_in_days'] = [
        'label'    => $label_text,
        'type'     => 'select',
        'options'  => array(
             '14'  => '14 days',
             '30'  => '30 days',
             '60'  => '60 days',
             '90'  => '90 days'
        ),
        'required' => true,
        'priority' => 30
    ];

    return $fields;
}
add_filter("woocommerce_checkout_fields", "add_two_due_days");


// Add the javascript to replace due in days in UI
function add_demo_replace_due_in_days_script() {
?>

<script type='text/javascript'>
function replaceDueInDays() {
    if (jQuery('#twoinc-due-in-days').length == 0) {
        jQuery('label[for="payment_method_woocommerce-gateway-tillit"]').html(
            jQuery('label[for="payment_method_woocommerce-gateway-tillit"]').html()
                .replace(twoinc.days_on_invoice, '<span id="twoinc-due-in-days"></span>')
        )
    }
    jQuery('#twoinc-due-in-days').text(jQuery('#billing_due_in_days').val())
}

document.addEventListener("DOMContentLoaded", function() {
    setTimeout(replaceDueInDays, 1000)
    setInterval(replaceDueInDays, 3000)
    jQuery('#billing_due_in_days').on('change', function(){
        replaceDueInDays()
    })
})
</script>

<?php
}
add_action('woocommerce_before_checkout_billing_form', 'add_demo_replace_due_in_days_script');
