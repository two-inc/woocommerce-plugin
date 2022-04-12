// Add selectWoo js to checkout page
add_action( 'wp_footer', function () {
   global $wp;
   if ( is_checkout() && empty( $wp->query_vars['order-pay'] ) && ! isset( $wp->query_vars['order-received'] ) ) {
      echo '<script type="text/javascript" src="/wp-content/plugins/woocommerce/assets/js/selectWoo/selectWoo.full.min.js"></script>';
   }
} );
