<?php

// [DIAG TEMP TWO-27171] The shop's last orders as stored: totals, shipping, tax and fee lines, and order notes.
// Amounts, rates and names only; the workflow redacts the output before printing it.

printf(
    "wc=%s calc_taxes=%s shipping_tax_class=%s prices_include_tax=%s round_at_subtotal=%s\n",
    WC()->version,
    get_option('woocommerce_calc_taxes'),
    var_export(get_option('woocommerce_shipping_tax_class'), true),
    get_option('woocommerce_prices_include_tax'),
    get_option('woocommerce_tax_round_at_subtotal')
);

$statuses = array_merge(array_keys(wc_get_order_statuses()), ['wc-checkout-draft', 'checkout-draft']);
$orders = wc_get_orders(['limit' => 12, 'orderby' => 'id', 'order' => 'DESC', 'status' => $statuses, 'type' => 'shop_order']);
foreach ($orders as $order) {
    printf(
        "\n== order %d status=%s via=%s method=%s total=%s total_tax=%s shipping_total=%s shipping_tax=%s cart_tax=%s two_order=%s\n",
        $order->get_id(),
        $order->get_status(),
        $order->get_created_via(),
        $order->get_payment_method(),
        $order->get_total(),
        $order->get_total_tax(),
        $order->get_shipping_total(),
        $order->get_shipping_tax(),
        $order->get_cart_tax(),
        $order->get_meta('twoinc_order_id') ? 'yes' : 'no'
    );
    foreach ($order->get_items('line_item') as $item) {
        printf("  product %s total=%s tax=%s taxes=%s\n", $item->get_name(), $item->get_total(), $item->get_total_tax(), wp_json_encode($item->get_taxes()));
    }
    foreach ($order->get_items('shipping') as $item) {
        printf(
            "  shipping %s method=%s instance=%s total=%s tax=%s taxes=%s tax_status=%s meta=%s\n",
            $item->get_name(),
            $item->get_method_id(),
            $item->get_instance_id(),
            $item->get_total(),
            $item->get_total_tax(),
            wp_json_encode($item->get_taxes()),
            method_exists($item, 'get_tax_status') ? $item->get_tax_status() : 'n/a',
            wp_json_encode(array_map(function ($m) { return [$m->key => $m->value]; }, $item->get_meta_data()))
        );
    }
    foreach ($order->get_items('fee') as $item) {
        printf("  fee %s total=%s tax=%s taxes=%s\n", $item->get_name(), $item->get_total(), $item->get_total_tax(), wp_json_encode($item->get_taxes()));
    }
    foreach ($order->get_items('tax') as $item) {
        printf(
            "  tax rate_id=%s label=%s percent=%s tax_total=%s shipping_tax_total=%s\n",
            $item->get_rate_id(),
            $item->get_label(),
            method_exists($item, 'get_rate_percent') ? $item->get_rate_percent() : 'n/a',
            $item->get_tax_total(),
            $item->get_shipping_tax_total()
        );
    }
    foreach (array_reverse(wc_get_order_notes(['order_id' => $order->get_id()])) as $note) {
        printf("  note: %s\n", preg_replace('/\s+/', ' ', wp_strip_all_tags($note->content)));
    }
}
