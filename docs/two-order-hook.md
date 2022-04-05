### Custom parameters for order create requests

**Option 1: Hardcode a new parameter to the request body of Two order create**
Append the following lines to your active theme's `functions.php`

```
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
function add_two_order_fields( $two_req ) {
    $twoinc_obj = WC_Twoinc::get_instance();
    // Currently support only "vendor_id"
    $two_req["vendor_id"] = $twoinc_obj->get_option( "vendor_id" );
    return $two_req;
}
add_filter( "two_order_create", "add_two_order_fields" );


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
