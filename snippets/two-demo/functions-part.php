<?php
// Add due in days to order req body to Two
function add_two_order_fields($req_body) {
    $due_in_days = (string) get_post_meta($req_body['merchant_order_id'], '_billing_due_in_days', true);
    if ($due_in_days && ctype_digit($due_in_days)) {
        $req_body["invoice_details"]['due_in_days'] = (int) $due_in_days;
    }
    return $req_body;
}
add_filter("two_order_create", "add_two_order_fields");


// Add the new field due in days in checkout
function add_due_in_days_field($fields) {

    $label_text = "Days you'll have to pay your invoice";
    $lang = WC_Twoinc_Helper::get_locale();
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
add_filter("woocommerce_checkout_fields", "add_due_in_days_field");


// Add the javascript to replace due in days in UI
function add_demo_replace_due_in_days_script() {
?>

<script type='text/javascript'>
function replaceDueInDays() {
    if (jQuery('#twoinc-due-in-days').length == 0) {
        jQuery('label[for="payment_method_woocommerce-gateway-tillit"]').html(
            jQuery('label[for="payment_method_woocommerce-gateway-tillit"]').html()
                .replace(twoinc.due_in_days, '<span id="twoinc-due-in-days"></span>')
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


function record_due_in_days_to_meta($order, $body) {
    update_post_meta($order->get_id(), '_twoinc_due_in_days', $body['invoice_details']['due_in_days']);
}

add_action('twoinc_order_created', 'record_due_in_days_to_meta', 10, 2);


function update_due_in_days_in_confirm_page() {
    if (is_order_received_page()) {
        global $wp, $post;
        $order_id = absint($wp->query_vars['order-received']);
        $twoinc_due_in_days = get_post_meta($order_id, '_twoinc_due_in_days', true);
        $twoinc_obj = WC_Twoinc::get_instance();
?>

<script type='text/javascript'>
function getNodesThatContain(text) {
    var textNodes = jQuery(document).find(":not(iframe, script, style)").contents().filter(function() {
        return this.nodeType == 3 && this.textContent.indexOf(text) > -1
    })
    return textNodes.parent()
}

function replaceDueInDays() {
    let dueInDays = <?php echo $twoinc_due_in_days; ?>;
    let defaultDueInDays = <?php echo $twoinc_obj->get_merchant_default_due_in_days(); ?>;
    let twoincMethodText = "<?php echo $twoinc_obj->title; ?>";
    getNodesThatContain(twoincMethodText).each(function (){
        jQuery(this).html(jQuery(this).html().replace(twoincMethodText, twoincMethodText.replace(defaultDueInDays, dueInDays)))
    })
}

document.getElementsByClassName('woocommerce-order')[0].style.visibility = 'hidden';
document.addEventListener("DOMContentLoaded", function() {
    replaceDueInDays()
    document.getElementsByClassName('woocommerce-order')[0].style.visibility = '';
})
</script>

<?php
    }
}
add_action('wp_footer', 'update_due_in_days_in_confirm_page');
