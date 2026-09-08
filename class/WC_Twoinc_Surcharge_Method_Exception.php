<?php

/**
 * Marker for "the stored surcharge method is not one this plugin can price".
 *
 * A type rather than a message comparison: the quiet path must not turn into
 * an error-logging path because someone reworded or translated the string.
 * get_surcharge_settings() reports the offending value once, so callers that
 * degrade on this condition stay silent while anything else escaping the same
 * read is logged.
 */

if (!class_exists('WC_Twoinc_Surcharge_Method_Exception')) {
    class WC_Twoinc_Surcharge_Method_Exception extends Exception
    {
    }
}
