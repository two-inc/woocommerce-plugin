<div class="woocommerce-billing-fields woocommerce-representative-fields">
    <!--<h3><?php /*esc_html_e('Person placing the order', 'twoinc-payment-gateway'); */?></h3>-->
    <div class="woocommerce-billing-fields__field-wrapper">
        <div id="twoinc-fn-target" class="twoinc-target"></div>
        <div id="twoinc-ln-target" class="twoinc-target"></div>
        <?php
        /*
         * No phone/email targets here deliberately: positionFields() in
         * twoinc.js used to pull them up alongside these, but that produced
         * a visible ~1s field reorder Doug did not want (#33). Phone/email
         * stay in their native WC position after town/city.
         */
        ?>
    </div>
    <?php
    /*
     * The "Enter manually" mode chip and the link back to search are built
     * in JS from the localised text map, not as markup here (TWO-25288) —
     * load-bearing, not tidying: the pay-for-order page renders its own
     * copy of the company inputs and runs the same search binding, so
     * cloning static markup from this view would leave that page with no
     * way into manual entry and no way back out.
     *
     * The chip is a real <button>, sibling of the results list rather than
     * a row inside it (TWO-40 §0): a pseudo-option <li> inside the results
     * list was tried first for arrow-key reachability, but that list is
     * exactly what select2/selectWoo apply scroll-and-clip to (the row was
     * only visible after scrolling past however many results came back),
     * and selectWoo's option-activation binds on `mouseup` with no mouse
     * button check, so a right click activated it same as a left click.
     */
    ?>
</div>
