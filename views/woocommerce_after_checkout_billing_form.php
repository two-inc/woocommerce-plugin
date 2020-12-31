<?php
/**
 * @global WC_Checkout $checkout
 */
$checkout = WC()->checkout(); ?>
<div class="woocommerce-billing-fields woocommerce-representative-fields">
    <h3><?php esc_html_e('Person placing the order', 'woocommerce-gateway-tillit'); ?></h3>
    <div class="woocommerce-billing-fields__field-wrapper">
        <div id="tillit-fn-target"></div>
        <div id="tillit-ln-target"></div>
        <div id="tillit-ph-target"></div>
        <div id="tillit-em-target"></div>
    </div>
</div>
