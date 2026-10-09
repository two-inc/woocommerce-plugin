<?php

/**
 * A request refused because what it would send does not match what the shop worked out (TWO-26275), for example a
 * shipping line whose tax does not reconcile with the rate the shop's shipping tax setting gives it. Thrown by
 * WC_Twoinc_Helper::check_shop_match(), from the plugin's default `twoinc_order_postprocessing` handler or from a
 * merchant handler that opts back in. The message is safe to show the buyer, as before the checks moved there.
 */

if (!class_exists('WC_Twoinc_Shop_Match_Exception')) {
    class WC_Twoinc_Shop_Match_Exception extends Exception
    {
    }
}
