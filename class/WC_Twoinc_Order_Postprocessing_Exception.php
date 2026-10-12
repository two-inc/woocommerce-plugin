<?php

/**
 * A request not sent because a `twoinc_order_postprocessing` subscriber
 * failed (TWO-26092): it threw, or returned something that is not an array
 * or cannot be encoded as JSON. The message names the request, the code
 * TWO_ORDER_POSTPROCESSING_HOOK_FAILED and the fault (never the subscriber's
 * own message) for the merchant; buyer-facing paths show their own generic
 * refusal instead.
 */

if (!class_exists('WC_Twoinc_Order_Postprocessing_Exception')) {
    class WC_Twoinc_Order_Postprocessing_Exception extends Exception
    {
        /** The stable code the log line and the message carry (TWO-26309). */
        public const CODE = 'TWO_ORDER_POSTPROCESSING_HOOK_FAILED';
    }
}
