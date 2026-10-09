<?php

/**
 * Plugin Name: Two order postprocessing fixture
 * Description: A working `twoinc_order_postprocessing` subscriber for CI (TWO-26092). Registered only while the
 *              `twoinc_order_postprocessing_fixture` option names a mode, because a registered subscriber is a
 *              merchant handler and stands the plugin's default checks down (TWO-26275); records every call it sees.
 *
 * Also usable as an mu-plugin. The `resplit` mode is the README's example: it treats untaxed shipping as
 * VAT-inclusive at the shop's configured shipping rate, then rebuilds the totals from the edited lines.
 */

if (!function_exists('twoinc_order_postprocessing_fixture')) {
    function twoinc_order_postprocessing_fixture_resplit(array $payload, array $context): array
    {
        $rate = $context['shipping_tax_rate'];
        if (!$rate || empty($payload['line_items'])) {
            return $payload;
        }
        foreach ($payload['line_items'] as &$line) {
            if ($line['type'] !== 'SHIPPING_FEE' || (float) $line['tax_amount'] != 0.0) {
                continue;
            }
            $gross = (float) $line['gross_amount'];
            $net = round($gross / (1 + $rate), 2);
            $line['net_amount'] = number_format($net, 2, '.', '');
            $line['tax_amount'] = number_format($gross - $net, 2, '.', '');
            $line['unit_price'] = $line['net_amount'];
            $line['tax_rate'] = number_format($rate, 6, '.', '');
            $line['tax_class_name'] = 'VAT ' . number_format($rate * 100, 2) . '%';
        }
        unset($line);
        return $payload;
    }

    /**
     * Adds a line for what the order's gross carries beyond its lines, a cost the shop adds to the cart total
     * outside any carrier, split at 21%, and sets the totals to the lines (TWO-26275).
     */
    function twoinc_order_postprocessing_fixture_extra_line(array $payload): array
    {
        if (!isset($payload['gross_amount']) || empty($payload['line_items'])) {
            return $payload;
        }
        $extra = (float) $payload['gross_amount'] - array_sum(array_map('floatval', array_column($payload['line_items'], 'gross_amount')));
        if (round($extra, 2) <= 0) {
            return WC_Twoinc_Helper::check_shop_match($payload, WC_Twoinc_Helper::SHOP_MATCH_PER_LINE);
        }
        $net = round($extra / 1.21, 2);
        $payload['line_items'][] = [
            'name' => 'Handling',
            'description' => '',
            'gross_amount' => number_format($extra, 2, '.', ''),
            'net_amount' => number_format($net, 2, '.', ''),
            'discount_amount' => '0',
            'tax_amount' => number_format($extra - $net, 2, '.', ''),
            'tax_class_name' => 'VAT 21.00%',
            'tax_rate' => '0.210000',
            'unit_price' => number_format($net, 2, '.', ''),
            'quantity' => 1,
            'quantity_unit' => 'fee',
            'image_url' => '',
            'product_page_url' => '',
            'type' => 'SERVICE',
        ];
        // An original with no totals carries no residual, so every total becomes the sum of the lines.
        $payload = WC_Twoinc_Helper::recompute_totals_from_lines($payload, ['line_items' => $payload['line_items']]);
        // The shop's own lines are still checked against the shop, as the README example does.
        return WC_Twoinc_Helper::check_shop_match($payload, WC_Twoinc_Helper::SHOP_MATCH_PER_LINE);
    }

    function twoinc_order_postprocessing_fixture($payload, $context)
    {
        $mode = get_option('twoinc_order_postprocessing_fixture');
        if (!$mode) {
            return $payload;
        }
        $GLOBALS['twoinc_order_postprocessing_fixture_calls'][] = [
            'request_type' => $context['request_type'],
            'trigger' => $context['trigger'],
            'endpoint' => $context['endpoint'],
            'context_keys' => array_keys($context),
        ];

        switch ($mode) {
            case 'resplit':
                return WC_Twoinc_Helper::recompute_totals_from_lines(twoinc_order_postprocessing_fixture_resplit($payload, $context), $payload);
            case 'resplit_lines_only':
                return twoinc_order_postprocessing_fixture_resplit($payload, $context);
            case 'checked':
                // Opts back in to the shop-match checks on the payload it returns (TWO-26275).
                return WC_Twoinc_Helper::check_shop_match($payload);
            case 'extra_line':
                return twoinc_order_postprocessing_fixture_extra_line($payload);
            case 'gross':
                $original = $payload;
                foreach ($payload['line_items'] as &$line) {
                    if ($line['type'] === 'SHIPPING_FEE') {
                        $line['net_amount'] = '30.00';
                        $line['gross_amount'] = '30.00';
                        $line['unit_price'] = '30.00';
                    }
                }
                unset($line);
                return WC_Twoinc_Helper::recompute_totals_from_lines($payload, $original);
            case 'line_off':
                $payload['line_items'][0]['gross_amount'] = number_format((float) $payload['line_items'][0]['gross_amount'] + 0.05, 2, '.', '');
                return $payload;
            case 'lines_string':
                $payload['line_items'] = 'x';
                return $payload;
            case 'refund_sign':
                $payload['amount'] = number_format(-(float) $payload['amount'], 2, '.', '');
                return $payload;
            case 'throws_on_hash':
                if ($context['trigger'] === 'change_hash') {
                    throw new RuntimeException('fixture subscriber failed while hashing');
                }
                return $payload;
            case 'body':
                return $payload === [] ? ['note' => 'added'] : $payload;
            case 'throws':
                throw new RuntimeException('fixture subscriber failed');
            case 'non_array':
                return null;
            case 'non_json':
                $payload['gross_amount'] = NAN;
                return $payload;
            default:
                return $payload;
        }
    }

    if (get_option('twoinc_order_postprocessing_fixture')) {
        add_filter('twoinc_order_postprocessing', 'twoinc_order_postprocessing_fixture', 10, 2);
    }
}
