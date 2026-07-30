<div class="woocommerce-billing-fields woocommerce-representative-fields">
    <!--<h3><?php /*esc_html_e('Person placing the order', 'twoinc-payment-gateway'); */?></h3>-->
    <div class="woocommerce-billing-fields__field-wrapper">
        <div id="twoinc-fn-target" class="twoinc-target"></div>
        <div id="twoinc-ln-target" class="twoinc-target"></div>
        <div id="twoinc-em-target" class="twoinc-target"></div>
        <div id="twoinc-ph-target" class="twoinc-target"></div>
    </div>
    <?php
    /*
     * The "my company is not on the list" affordance and the link back to
     * search used to be two hidden <div>s here, cloned into the dropdown by
     * the checkout JS (TWO-25288).
     *
     * They are built in JS from the localised text map now. Two reasons, both
     * load-bearing rather than tidying:
     *
     *  - the affordance has to be a real pseudo-option <li> inside the results
     *    list to be arrow-key reachable and announced, which a cloned <div>
     *    cannot become; and
     *  - this view is rendered on the checkout page only. The pay-for-order
     *    page renders its own copy of the company inputs and runs the same
     *    search binding, so cloning from here left that page with no way into
     *    manual entry and no way back out.
     */
    ?>
</div>
