// Add as payment reference a dummy KID number generated using order ID
function get_kid_number( $order_id ) {
    $prefix = "2";
    $kid_len = 13;
    $padded_order_id = strval($order_id);
    if (strlen($prefix . $padded_order_id) + 1 > $kid_len) {
        $padded_order_id = substr($padded_order_id, strlen($prefix) + 1 - $kid_len);
    }
    $padded_order_id = str_pad($padded_order_id, $kid_len - 1 - strlen($prefix), "0", STR_PAD_LEFT);
    // multiply digits by weight
    $digits = str_split($prefix . $padded_order_id);

    $weighted = 0;
    $multiplier = 1;
    // Loop digits backward
    for (end($digits); key($digits)!==null; prev($digits)){
        $current_d = current($digits);
        // keep adding the sum of digits of ($current_d * ($multiplier + 1))
        $weighted += array_sum(str_split($current_d * ($multiplier + 1)));
        $multiplier = ($multiplier + 1) % 2;
    }

    $control = 10 - ($weighted % 10);
    if ($control == 10) {
        return 0;
    }

    return $prefix . $padded_order_id . strval($control);
}
add_filter( "two_payment_reference", "get_kid_number" );
