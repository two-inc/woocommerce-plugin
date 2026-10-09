<?php

/**
 * Cart shapes and an order postprocessing subscriber for the e2e suite (TWO-26092). Inert until the
 * `two_e2e_cart_shape` option lists shapes, comma-separated:
 *
 *   taxes       prices taxed at a 20% GB standard rate, shipping included
 *   untaxed     the 29.00 courier rate every package ships at is set not taxable
 *   coupon      a 10% coupon applied to the cart
 *   fee         a taxed 5.00 handling fee
 *   packages    each cart line shipped as its own package
 *   inclusive   prices entered and shown including tax
 *   exempt      the buyer is VAT exempt
 *   rowless     each shipping line keeps its tax but loses its rate row, as a module taxing shipping outside
 *               WooCommerce's rates would record it
 *   skewed      with rowless, each shipping line is charged 7.00 of tax, which no rate of the shop gives
 *   surcharge   10.00 added to the cart total outside any carrier or line, and kept in the order total when
 *               WooCommerce recalculates it (an admin save does), as a module carrying such a cost would
 *
 * The subscriber is the unit suite's CI fixture, inert until `twoinc_order_postprocessing_fixture` names a mode.
 * tests/e2e/provision/cart-shapes-reset.php undoes all of it.
 */

$two_e2e_fixture = WP_PLUGIN_DIR . '/tillit-payment-gateway/tests/unit/fixtures/orderpostprocessing.php';
if (is_readable($two_e2e_fixture)) {
    require_once $two_e2e_fixture;
}

function two_e2e_cart_shape($shape)
{
    return in_array($shape, array_map('trim', explode(',', (string) get_option('two_e2e_cart_shape', ''))), true);
}

add_filter('pre_option_woocommerce_calc_taxes', function ($value) {
    return two_e2e_cart_shape('taxes') ? 'yes' : $value;
});

foreach (['woocommerce_prices_include_tax', 'woocommerce_tax_display_shop', 'woocommerce_tax_display_cart'] as $option) {
    add_filter("pre_option_$option", function ($value) use ($option) {
        if (!two_e2e_cart_shape('inclusive')) {
            return $value;
        }
        return $option === 'woocommerce_prices_include_tax' ? 'yes' : 'incl';
    });
}

// Created once when armed: a shipping method must exist for the cart to need shipping at all. Block checkout
// sends Store API requests concurrently, so the setup is claimed first with a lock option that never changes
// value: add_option on a row that already holds the same value affects no row and returns false, so only one
// request creates anything. Without the claim, two requests each added a flat rate and only one got the courier
// settings below, leaving a free "Flat rate" that checkout could pick (TWO-26215).
add_action('woocommerce_init', function () {
    if (
        get_option('two_e2e_cart_shape', '') === ''
        || get_option('two_e2e_setup')
        || !add_option('two_e2e_setup_lock', 'claimed', '', false)
    ) {
        return;
    }
    $tax_rate_id = WC_Tax::_insert_tax_rate([
        'tax_rate_country' => 'GB',
        'tax_rate' => '20.0000',
        'tax_rate_name' => 'VAT',
        'tax_rate_priority' => 1,
        'tax_rate_compound' => 0,
        'tax_rate_shipping' => 1,
        'tax_rate_order' => 0,
        'tax_rate_class' => '',
    ]);
    $method_id = (new WC_Shipping_Zone(0))->add_shipping_method('flat_rate');
    update_option('two_e2e_setup', ['tax_rate' => $tax_rate_id, 'shipping_method' => $method_id]);
});

// The flat rate the setup above created: 29.00 a package, its tax status by shape, as a merchant would set it.
$two_e2e_setup = get_option('two_e2e_setup');
if (is_array($two_e2e_setup)) {
    add_filter("pre_option_woocommerce_flat_rate_{$two_e2e_setup['shipping_method']}_settings", function () {
        return ['title' => 'E2E courier', 'cost' => '29', 'tax_status' => two_e2e_cart_shape('untaxed') ? 'none' : 'taxable'];
    });
}

add_filter('woocommerce_cart_shipping_packages', function ($packages) {
    if (!two_e2e_cart_shape('packages') || count($packages) !== 1) {
        return $packages;
    }
    $split = [];
    foreach ($packages[0]['contents'] as $key => $item) {
        $split[] = array_merge($packages[0], [
            'contents' => [$key => $item],
            'contents_cost' => $item['line_total'],
        ]);
    }
    return $split;
});

// A rate id no tax row of the order carries, so the plugin finds no rate provided for the line.
add_action('woocommerce_checkout_create_order_shipping_item', function ($item) {
    if (!two_e2e_cart_shape('rowless')) {
        return;
    }
    $tax = two_e2e_cart_shape('skewed') ? 7.0 : array_sum($item->get_taxes()['total'] ?? []);
    $item->set_taxes(['total' => [999999 => $tax]]);
});

add_filter('woocommerce_calculated_total', function ($total) {
    return two_e2e_cart_shape('surcharge') ? $total + 10.0 : $total;
});
// Every recalculation of an order total, by the Store API checkout or an admin save, adds the cost back.
add_action('woocommerce_order_after_calculate_totals', function ($and_taxes, $order) {
    if (two_e2e_cart_shape('surcharge')) {
        $order->set_total((float) $order->get_total('edit') + 10.0);
    }
}, 10, 2);

add_action('woocommerce_cart_calculate_fees', function ($cart) {
    if (two_e2e_cart_shape('fee')) {
        $cart->add_fee('E2E handling', 5.0, true);
    }
});

add_action('wp_loaded', function () {
    if (!function_exists('WC') || !WC()->cart || WC()->cart->is_empty()) {
        return;
    }
    if (two_e2e_cart_shape('exempt') && WC()->customer && !WC()->customer->get_is_vat_exempt()) {
        WC()->customer->set_is_vat_exempt(true);
    }
    if (two_e2e_cart_shape('coupon') && !WC()->cart->has_discount('two-e2e-10')) {
        if (!wc_get_coupon_id_by_code('two-e2e-10')) {
            $coupon = new WC_Coupon();
            $coupon->set_code('two-e2e-10');
            $coupon->set_discount_type('percent');
            $coupon->set_amount(10);
            $coupon->save();
        }
        WC()->cart->apply_coupon('two-e2e-10');
    }
});
