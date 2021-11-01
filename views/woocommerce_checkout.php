<?php
/**
 * @global WC_Checkout $checkout
 */
$checkout = WC()->checkout(); ?>

<!-- selectable phone country -->
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/17.0.8/css/intlTelInput.css" />
<script src="https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/17.0.8/js/intlTelInput.min.js"></script>

<div class="woocommerce-billing-fields woocommerce-account-type-fields">
    <div id="tillit-account-type"></div>
    <div class="woocommerce-account-type-fields__field-wrapper">
        <?php
        $fields = $checkout->get_checkout_fields('account_type');
        if (is_array($fields)) {
            foreach($fields as $key => $field){
                $value = isset($field['value']) ? $field['value'] : $checkout->get_value($key);
                woocommerce_form_field($key, $field, $value);
            }
        }
        ?>
    </div>
</div>
