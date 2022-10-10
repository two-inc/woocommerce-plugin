### Custom parameters for order create requests

**Option 1: Hardcode a new parameter to the request body of Two order create**

Append the following lines to your active theme's `functions.php`

```
// Add vendor id to order req body to Two
function add_two_order_fields( $two_req ) {
    // Currently support only "vendor_id"
    $two_req["vendor_id"] = "YOUR VENDOR ID";
    return $two_req;
}
add_filter( "two_order_create", "add_two_order_fields" );
```


**Option 2: Add a new parameter configurable from Two settings**

Append the following lines to your active theme's `functions.php`

```
// Add vendor id to order req body to Two
function add_two_order_fields( $two_req ) {
    $twoinc_obj = WC_Twoinc::get_instance();
    // Currently support only "vendor_id"
    $two_req["vendor_id"] = $twoinc_obj->get_option( "vendor_id" );
    return $two_req;
}
add_filter( "two_order_create", "add_two_order_fields" );

// Add the new field to Two settings
function add_two_setting_fields( $two_fields ) {
    // Section header
    $two_fields["section_custom_settings"] = [
        "title"       => "Custom settings",
        "type"        => "title"
    ];
    // Additional configurable parameter
    $two_fields["vendor_id"] = [
        "title"       => "Vendor ID",
        "type"        => "text"
    ];
    return $two_fields;
}
add_filter( "wc_two_form_fields", "add_two_setting_fields" );
```


**Option 3: Add a new parameter to Checkout**

Append the following lines to your active theme's `functions.php`

```
// Add due in days to order req body to Two
function add_two_order_fields( $two_req ) {
    $due_in_days = (string) get_post_meta( $two_req['merchant_order_id'], '_billing_due_in_days', true );
    if ( $due_in_days && ctype_digit( $due_in_days ) ) {
        $twoinc_obj = WC_Twoinc::get_instance();
        $two_req["invoice_details"]['due_in_days'] = (int) $due_in_days;
    }
    return $two_req;
}
add_filter( "two_order_create", "add_two_order_fields" );

// Add the new field due in days in checkout
function add_two_due_days( $fields ) {
    $fields['billing']['billing_due_in_days'] = [
        'label' => 'Number of due days',
        'type' => 'text',
        'required' => true,
        'priority' => 30
    ];
    return $fields;
}
add_filter( "woocommerce_checkout_fields", "add_two_due_days" );
```



### Custom Two payment references based on order id

**Generate a payment reference message with the order id as parameter**

Append the following lines to your active theme's `functions.php`

```
function get_custom_reference_number( $order_id ) {
    $order = wc_get_order($order_id);
    return 'your custom ref';
}
add_filter( "two_payment_reference", "get_custom_reference_number" );
add_filter( "two_payment_reference_ocr", function () { return 'your custom ref ocr'; } );
add_filter( "two_payment_reference_message", function () { return 'your custom ref message'; } );
```