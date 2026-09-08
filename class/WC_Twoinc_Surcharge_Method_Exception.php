<?php

/**
 * "The stored surcharge method is not one this plugin can price."
 *
 * A type rather than a message comparison, so rewording or translating the
 * refusal cannot turn the quiet degrade path into an error-logging one.
 */

if (!class_exists('WC_Twoinc_Surcharge_Method_Exception')) {
    class WC_Twoinc_Surcharge_Method_Exception extends Exception
    {
    }
}
