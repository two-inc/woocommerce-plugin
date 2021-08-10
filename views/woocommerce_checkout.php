<?php
/**
 * @global WC_Checkout $checkout
 */
$checkout = WC()->checkout(); ?>
<div class="woocommerce-billing-fields woocommerce-account-type-fields">
<?php
if (sizeof($this->WC_Tillit->available_account_types()) > 1)
{
    echo '<h3>';
    esc_html_e('Account type', 'tillit-payment-gateway');
    echo '</h3>';
}
?>
    <div class="woocommerce-account-type-fields__field-wrapper">
        <?php
        $fields = $checkout->get_checkout_fields('account_type');
        foreach($fields as $key => $field){
            $value = isset($field['value']) ? $field['value'] : $checkout->get_value($key);
            woocommerce_form_field($key, $field, $value);
        }
        ?>
    </div>
</div>
