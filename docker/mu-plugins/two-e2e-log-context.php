<?php

/**
 * Writes the plugin's log context into WooCommerce's log file on versions whose file handler drops it
 * (TWO-27184). WooCommerce 7.6's file handler writes the message alone; later versions append
 * " CONTEXT: " and the context as JSON. The context of a call to Two holds the response's status,
 * headers and body, which the e2e workflow reads when a leg fails, so append it here in the later
 * versions' format and the workflow reads one format on every leg. An entry that already carries it
 * is left alone.
 */

add_filter('woocommerce_format_log_entry', function ($entry, $args) {
    $context = is_array($args) && isset($args['context']) && is_array($args['context']) ? $args['context'] : [];
    if (($context['source'] ?? '') !== 'twoinc-payment-gateway' || strpos($entry, ' CONTEXT: ') !== false) {
        return $entry;
    }
    unset($context['source']);
    if (empty($context)) {
        return $entry;
    }
    return $entry . ' CONTEXT: ' . wp_json_encode($context, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}, 10, 2);
