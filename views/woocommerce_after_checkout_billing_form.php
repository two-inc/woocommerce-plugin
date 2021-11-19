<?php
/**
 * @global WC_Checkout $checkout
 */
$checkout = WC()->checkout(); ?>
<div class="woocommerce-billing-fields woocommerce-representative-fields">
    <!--<h3><?php /*esc_html_e('Person placing the order', 'twoinc-payment-gateway'); */?></h3>-->
    <div class="woocommerce-billing-fields__field-wrapper">
        <div id="tillit-fn-target" class="tillit-target"></div>
        <div id="tillit-ln-target" class="tillit-target"></div>
        <div id="tillit-em-target" class="tillit-target"></div>
        <div id="tillit-ph-target" class="tillit-target"></div>
    </div>
</div>
