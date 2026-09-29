<?php

/**
 * A request refused because a `twoinc_order_postprocessing` subscriber made
 * its payload fail a consistency gate (TWO-26092). The message names the
 * refusal code for the merchant; buyer-facing paths show their own generic
 * refusal instead.
 */

if (!class_exists('WC_Twoinc_Order_Postprocessing_Exception')) {
    class WC_Twoinc_Order_Postprocessing_Exception extends Exception
    {
        /** @var string */
        private $refusal_code;

        public function __construct(string $refusal_code, string $message)
        {
            parent::__construct($message);
            $this->refusal_code = $refusal_code;
        }

        public function get_refusal_code(): string
        {
            return $this->refusal_code;
        }
    }
}
