<?php
/**
 * @global WC_Checkout $checkout
 */
$checkout = WC()->checkout(); ?>

<div class="woocommerce-billing-fields woocommerce-account-type-fields" id="woocommerce-account-type-container">
    <div id="tillit-account-type"></div>
    <div class="woocommerce-account-type-fields__field-wrapper">
        <?php
        $fields = $checkout->get_checkout_fields('account_type');
        if (is_array($fields)) {
            foreach ($fields as $key => $field){
                $value = isset($field['value']) ? $field['value'] : $checkout->get_value($key);
                woocommerce_form_field($key, $field, $value);
            }
        }
        ?>
    </div>
</div>
