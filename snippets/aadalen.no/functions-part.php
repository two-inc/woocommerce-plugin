// Add selectWoo js to checkout page
add_action( 'wp_footer', function () {
   global $wp;
   if ( is_checkout() && empty( $wp->query_vars['order-pay'] ) && ! isset( $wp->query_vars['order-received'] ) ) {
      echo '<script type="text/javascript" src="/wp-content/plugins/woocommerce/assets/js/selectWoo/selectWoo.full.min.js"></script>';
   }
} );


// Add default placeholder for company name
function add_company_display_default( $fields ) {
    if (array_key_exists('billing_company_display', $fields['billing'])) {
        $fields['billing']['billing_company_display']['options'] = ['' => __('Company name', 'twoinc-payment-gateway')];
    }
    return $fields;
}
add_filter( "woocommerce_checkout_fields", "add_company_display_default", 30 );