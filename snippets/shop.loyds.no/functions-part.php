// Add as payment reference a dummy KID number generated using order ID
function get_kid_number( $order_id ) {
    // multiply digits by weight
    $digits = str_split($order_id);

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

    return str_pad($order_id, 12, '0', STR_PAD_LEFT) . strval($control);
}
add_filter( "two_payment_reference", "get_kid_number" );
