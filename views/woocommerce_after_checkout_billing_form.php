<div class="woocommerce-billing-fields woocommerce-representative-fields">
    <!--<h3><?php /*esc_html_e('Person placing the order', 'twoinc-payment-gateway'); */?></h3>-->
    <div class="woocommerce-billing-fields__field-wrapper">
        <div id="twoinc-fn-target" class="twoinc-target"></div>
        <div id="twoinc-ln-target" class="twoinc-target"></div>
        <?php
        /*
         * Phone/email used to have targets here too (twoinc-em-target,
         * twoinc-ph-target), moved up by positionFields() in twoinc.js.
         * Removed for #33 — that pull-up produced a visible ~1s field
         * reorder Doug did not want; phone/email now stay in their native
         * WC position after town/city.
         */
        ?>
    </div>
    <?php
    /*
     * The "Enter manually" mode chip and the link back to search used to be
     * two hidden <div>s here, cloned into the dropdown by the checkout JS
     * (TWO-25288).
     *
     * They are built in JS from the localised text map now. Load-bearing
     * rather than tidying: this view is rendered on the checkout page only.
     * The pay-for-order page renders its own copy of the company inputs and
     * runs the same search binding, so cloning from here left that page with
     * no way into manual entry and no way back out.
     *
     * The "Enter manually" chip is a real <button>, one of three mode chips
     * appended as a group, itself a sibling of the results list rather than
     * a row inside it (#30.x.1-3, TWO-40 §0): a pseudo-option <li> inside the
     * results list was tried first (TWO-25288) for arrow-key reachability,
     * but that list is exactly what select2/selectWoo apply their own
     * scroll-and-clip to, so the row was only visible after scrolling past
     * however many results came back, and selectWoo's own option-activation
     * binds on `mouseup` with no mouse button check, so a right click
     * activated it the same as a left click.
     */
    ?>
</div>
