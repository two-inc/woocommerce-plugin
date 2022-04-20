<div class="woocommerce-billing-fields woocommerce-representative-fields">
    <!--<h3><?php /*esc_html_e('Person placing the order', 'twoinc-payment-gateway'); */?></h3>-->
    <div class="woocommerce-billing-fields__field-wrapper">
        <div id="twoinc-fn-target" class="twoinc-target"></div>
        <div id="twoinc-ln-target" class="twoinc-target"></div>
        <div id="twoinc-em-target" class="twoinc-target"></div>
        <div id="twoinc-ph-target" class="twoinc-target"></div>
    </div>

    <div class="company_not_in_btn" style="display: none;">
        <?php esc_html_e('My company is not on the list', 'twoinc-payment-gateway'); ?>
    </div>

    <div id="search_company_btn" style="display: none;">
        <?php esc_html_e('Search for company', 'twoinc-payment-gateway'); ?>
    </div>
</div>
