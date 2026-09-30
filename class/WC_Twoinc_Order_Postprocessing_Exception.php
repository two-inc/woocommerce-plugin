<?php

/**
 * A request not sent because a `twoinc_order_postprocessing` subscriber
 * failed (TWO-26092): it threw, or returned something that is not an array
 * or cannot be encoded as JSON. The message names the request and the fault
 * for the merchant; buyer-facing paths show their own generic refusal instead.
 */

if (!class_exists('WC_Twoinc_Order_Postprocessing_Exception')) {
    class WC_Twoinc_Order_Postprocessing_Exception extends Exception
    {
    }
}
