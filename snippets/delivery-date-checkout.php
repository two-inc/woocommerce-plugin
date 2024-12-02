<?php

add_action('wp_enqueue_scripts', 'enqueue_date_picker');
add_action('woocommerce_after_order_notes', 'add_delivery_date_field', 10, 1);
add_action('woocommerce_checkout_process', 'checkout_validate_delivery_date');
add_action('woocommerce_checkout_update_order_meta', 'add_delivery_date_to_order_meta');
add_action('wp_insert_post', 'prepend_to_order_note', 10, 3);

/**
 * Enqueue datepicker js
 *
 * @return void
 */
function enqueue_date_picker()
{
    // Only on front-end and checkout page
    if (is_admin() || !is_checkout()) {
        return;
    }
    wp_enqueue_script('jquery-ui-datepicker');
}


/**
 * Add Delivery date field to Checkout page
 *
 * @return void
 */
function add_delivery_date_field($checkout)
{

    date_default_timezone_set('Europe/Oslo');
    $dateoptions = array('' => __('Select Pickup Date', 'twoinc-payment-gateway'));

    echo '<div id="delivery-date">';
    echo '<h3>'.__('Delivery Date', 'twoinc-payment-gateway').'</h3>';

    echo '
    <script>
        jQuery(function($){
            $("#delivery-date-picker").datepicker({dateFormat: "yy-mm-dd"});
        });
    </script>
    <style>
        #ui-datepicker-div {
            background: #fff;
        }
    </style>';

    woocommerce_form_field(
        'delivery_date',
        array(
             'type'          => 'text',
             'class'         => array('form-row-wide'),
             'id'            => 'delivery-date-picker',
             'required'      => true,
             'label'         => __('Delivery Date', 'twoinc-payment-gateway'),
             'placeholder'   => __('Select Date', 'twoinc-payment-gateway'),
             'options'       => $dateoptions
         ),
        $checkout->get_value('cylinder_collect_date')
    );

    echo '</div>';
}


/**
 * Validate if delivery date was sent after clicking Placing order
 *
 * @return void
 */
function checkout_validate_delivery_date()
{

    if (!$_POST['delivery_date']) {
        // the required field delivery_date was not sent
        wc_add_notice(
            sprintf(
                __('%s is a required field.', 'twoinc-payment-gateway'),
                sprintf('<strong>%s</strong> ', __('Delivery Date', 'twoinc-payment-gateway'))
            ),
            'error'
        );
    } elseif (!validate_date($_POST['delivery_date'])) {
        // delivery_date is of incorrect format
        wc_add_notice(
            sprintf(
                __('%s cannot be parsed.', 'twoinc-payment-gateway'),
                sprintf('<strong>%s</strong> ', __('Delivery Date', 'twoinc-payment-gateway'))
            ),
            'error'
        );
    }
}


/**
 * Add the delivery date to order meta
 *
 * @return void
 */
function add_delivery_date_to_order_meta($order_id)
{
    if (!empty($_POST['delivery_date'])) {
        $order->update_meta_data('delivery_date', sanitize_text_field($_POST['delivery_date']));
        $order->save();
    }
}


/**
 * Validate if a string is of a specific date format
 *
 * @return bool
 */
function validate_date($date_str, $format = 'Y-m-d')
{
    $d = DateTime::createFromFormat($format, $date_str);
    return $d && $d->format($format) === $date_str;
}


/**
 * Prepend Delivery date to order note on order creation
 *
 * @return void
 */
function prepend_to_order_note($post_id, $post, $update)
{

    // Skip if $post_id doesn't exist OR post is not order OR this is update
    if (! $post_id || get_post_type($post_id) != 'shop_order' || $update == 1) {
        return;
    }

    if (!$_POST['delivery_date'] || !validate_date($_POST['delivery_date'])) {
        return;
    }

    $d = DateTime::createFromFormat('Y-m-d', $_POST['delivery_date']);
    if (!$d) {
        return;
    }

    $order = wc_get_order($post_id);
    $existing_note = $order->get_customer_note();
    $order->set_customer_note('Delivery date: ' . $d->format(get_option('date_format')));
    if ($existing_note) {

        $order->set_customer_note($order->get_customer_note() . '
'
        . $existing_note);
    }

    $order->save();

}
