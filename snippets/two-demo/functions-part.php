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

    $fields['billing']['billing_due_in_days'] = [
        'label' => 'Number of due days',
        'type' => 'text',
        'required' => true,
        'priority' => 30
    ];

    return $fields;
}
add_filter("woocommerce_checkout_fields", "add_two_due_days");
