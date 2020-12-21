<?php
/**
 * @global WC_Checkout $checkout
 */
$checkout = WC()->checkout();
?>
<div class="woocommerce-billing-fields">
    <h3><?php esc_html_e('Company details', 'woocommerce-gateway-tillit'); ?></h3>
    <div class="woocommerce-company-fields__field-wrapper">
        <?php
        $fields = $checkout->get_checkout_fields( 'company' );
        foreach($fields as $key => $field){
            woocommerce_form_field( $key, $field, $checkout->get_value( $key ) );
        }
        ?>
    </div>
</div>
