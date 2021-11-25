<?php
/**
 * @global WC_Checkout $checkout
 */
$checkout = WC()->checkout(); ?>
<div class="woocommerce-billing-fields woocommerce-representative-fields">
    <!--<h3><?php /*esc_html_e('Person placing the order', 'twoinc-payment-gateway'); */?></h3>-->
    <div class="woocommerce-billing-fields__field-wrapper">
        <div id="twoinc-fn-target" class="twoinc-target"></div>
        <div id="twoinc-ln-target" class="twoinc-target"></div>
        <div id="twoinc-em-target" class="twoinc-target"></div>
        <div id="twoinc-ph-target" class="twoinc-target"></div>
    </div>
</div>
