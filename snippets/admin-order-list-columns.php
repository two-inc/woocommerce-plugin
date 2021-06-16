<?php

add_filter('manage_edit-shop_order_columns', 'add_custom_columns');
add_filter('manage_edit-shop_order_sortable_columns', 'add_custom_sortable_columns');
add_action('manage_shop_order_posts_custom_column', 'add_custom_columns_content');
add_action('pre_get_posts', 'add_sorting_query');


/**
 * Add sorting query for custom columns
 *
 * @return array
 */
function add_sorting_query($query) {
    if(!is_admin()) {
        return;
    }

    $orderby = $query->get('orderby');

    if('order_delivery_date' == $orderby) {
        $meta_query = array(
            'relation' => 'OR',
            array(
                'key' => 'delivery_date',
                'compare' => 'NOT EXISTS', // for empty value
            ),
            array(
                'key' => 'delivery_date',
            ),
        );

        $query->set('meta_query', $meta_query);
        $query->set('orderby', 'meta_value');
    }
}


/**
 * Add custom columns to admin edit order page
 *
 * @return array
 */
function add_custom_columns($columns) {

    $new_columns = array();
    foreach($columns as $column_name => $column_info) {
        $new_columns[$column_name] = $column_info;
        if ('order_status' === $column_name) {
            $new_columns['order_delivery_date'] = __('Delivery date', 'tillit-payment-gateway');
            $new_columns['order_customer_user'] = __('Customer', 'tillit-payment-gateway');
        }
    }

    return $new_columns;

}


/**
 * Add sort-by feature to custom columns
 *
 * @return array
 */
function add_custom_sortable_columns($columns) {

    $columns['order_delivery_date'] = 'order_delivery_date';

    return $columns;

}


/**
 * Add custom columns content in admin edit order page
 *
 * @return void
 */
function add_custom_columns_content($column) {

    global $post;
    if ('order_customer_user' === $column) {
        $order = wc_get_order($post->ID);
        if ($order && $order->get_customer_id()) {
            print('<a href="' . get_edit_user_link($order->get_customer_id()) . '">'
                  . get_userdata($order->get_customer_id())->display_name . '</a>');
        }
    } else if ('order_delivery_date' === $column) {
        $order = wc_get_order($post->ID);
        if ($order->get_meta('delivery_date')) {
            $d = DateTime::createFromFormat('Y-m-d', $order->get_meta('delivery_date'));
            if ($d) {
                print(esc_html($d->format(get_option('date_format'))));
            }
        }
    }

}
