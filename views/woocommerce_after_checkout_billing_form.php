<div class="woocommerce-billing-fields woocommerce-representative-fields">
    <!--<h3><?php /*esc_html_e('Person placing the order', 'abn-payment-gateway'); */?></h3>-->
    <div class="woocommerce-billing-fields__field-wrapper">
        <div id="abn-fn-target" class="abn-target"></div>
        <div id="abn-ln-target" class="abn-target"></div>
        <div id="abn-em-target" class="abn-target"></div>
        <div id="abn-ph-target" class="abn-target"></div>
    </div>

    <div class="company_not_in_btn" style="display: none;">
        <?php esc_html_e('My company is not on the list', 'abn-payment-gateway'); ?>
    </div>

    <div id="search_company_btn" style="display: none;">
        <?php esc_html_e('Search for company', 'abn-payment-gateway'); ?>
    </div>
</div>
