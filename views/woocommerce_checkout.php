<?php
/**
 * @global WC_Checkout $checkout
 */
$checkout = WC()->checkout(); ?>
<div class="woocommerce-billing-fields woocommerce-account-fields">
    <h3><?php esc_html_e('Account type', 'woocommerce-gateway-tillit'); ?></h3>
    <div class="woocommerce-account-type-fields__field-wrapper">
        <?php
        $fields = $checkout->get_checkout_fields( 'account_type' );
        foreach($fields as $key => $field){
            $value = isset($field['value']) ? $field['value'] : $checkout->get_value( $key );
            woocommerce_form_field( $key, $field, $value );
        }
        ?>
    </div>
</div>
<div class="woocommerce-billing-fields woocommerce-company-fields">
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
<div class="woocommerce-billing-fields woocommerce-representative-fields">
    <h3><?php esc_html_e('Representative', 'woocommerce-gateway-tillit'); ?></h3>
    <div class="woocommerce-representative-fields__field-wrapper">
        <?php
        $fields = $checkout->get_checkout_fields( 'representative' );
        foreach($fields as $key => $field){
            woocommerce_form_field( $key, $field, $checkout->get_value( $key ) );
        }
        ?>
    </div>
</div>
