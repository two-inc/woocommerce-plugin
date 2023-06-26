// Function to get days_on_invoice from settings
function get_two_forced_days_on_invoice($twoinc_obj) {
    if (!$twoinc_obj) {
        $twoinc_obj = WC_Twoinc::get_instance();
    }
    $forced_days_on_invoice = $twoinc_obj->get_option('forced_days_on_invoice');
    if ($forced_days_on_invoice && $forced_days_on_invoice !== 'none' && is_numeric($forced_days_on_invoice)) {
        return (int) $forced_days_on_invoice;
    }
    return null;
}

// Add due_in_days to order req body to Two
function add_two_due_in_days_to_create_request($two_req) {
    $forced_days_on_invoice = get_two_forced_days_on_invoice(null);
    if ($forced_days_on_invoice) {
        $two_req["invoice_details"]["due_in_days"] = $forced_days_on_invoice;
    }

    return $two_req;
}
add_filter("two_order_create", "add_two_due_in_days_to_create_request");


// Add the field forced_days_on_invoice to Two settings
function add_two_due_in_days_to_setting($two_fields) {
    $position = array_search('section_checkout_options', array_keys($two_fields));
    if (!$position) {
        $position = count($two_fields);
    }

    $new_part = array('forced_days_on_invoice' => [
        'type'        => 'select',
        'title'       => __('Due in days for demo only', 'twoinc-payment-gateway'),
        'default'     => 'none',
        'options'     => array(
             'none'  => 'Use portal setting',
             '14'    => '14',
             '30'    => '30',
             '60'    => '60',
             '90'    => '90'
        )
    ]);

    return array_merge(
        array_slice($two_fields, 0, $position + 1),
        $new_part,
        array_slice($two_fields, $position + 1)
    );
}
add_filter("wc_two_form_fields", "add_two_due_in_days_to_setting");


// Overwrite twoinc_days_on_invoice
function forced_overwrite_twoinc_days_on_invoice($days_on_invoice, $twoinc_obj) {
    $forced_days_on_invoice = get_two_forced_days_on_invoice($twoinc_obj);
    if ($forced_days_on_invoice) {
        $days_on_invoice = $forced_days_on_invoice;
    }
    return $days_on_invoice;
}
add_filter("twoinc_days_on_invoice", "forced_overwrite_twoinc_days_on_invoice", 10, 2);
