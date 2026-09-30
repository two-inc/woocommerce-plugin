<?php

/**
 * Plugin Name: Two order postprocessing fixture
 * Description: A working `twoinc_order_postprocessing` subscriber for CI (TWO-26092). Inert until the
 *              `twoinc_order_postprocessing_fixture` option names a mode; records every call it sees.
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
            $line['tax_rate'] = (string) $rate;
            $line['tax_class_name'] = 'VAT ' . number_format($rate * 100, 2) . '%';
        }
        unset($line);
        return $payload;
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
            case 'drop_residual':
                return WC_Twoinc_Helper::recompute_totals_from_lines($payload);
            case 'resplit_lines_only':
                return twoinc_order_postprocessing_fixture_resplit($payload, $context);
            case 'resplit_stale_subtotals':
                $subtotals = $payload['tax_subtotals'];
                $payload = WC_Twoinc_Helper::recompute_totals_from_lines(twoinc_order_postprocessing_fixture_resplit($payload, $context), $payload);
                $payload['tax_subtotals'] = $subtotals;
                return $payload;
            case 'gross':
                foreach ($payload['line_items'] as &$line) {
                    if ($line['type'] === 'SHIPPING_FEE') {
                        $line['net_amount'] = '30.00';
                        $line['gross_amount'] = '30.00';
                        $line['unit_price'] = '30.00';
                    }
                }
                unset($line);
                return WC_Twoinc_Helper::recompute_totals_from_lines($payload);
            case 'line_off':
                $payload['line_items'][0]['gross_amount'] = number_format((float) $payload['line_items'][0]['gross_amount'] + 0.05, 2, '.', '');
                return $payload;
            case 'wrong_rate':
                $payload['line_items'][0]['tax_rate'] = '0.500000';
                return $payload;
            case 'refund_amount':
                $payload['amount'] = '1.00';
                return $payload;
            case 'drop_lines':
                $payload['line_items'] = [];
                $payload['gross_amount'] = '999.00';
                return $payload;
            case 'lines_string':
                $payload['line_items'] = 'x';
                return $payload;
            case 'unset_gross':
                unset($payload['gross_amount']);
                $payload['net_amount'] = '1.00';
                return $payload;
            case 'refund_sign':
                $payload['amount'] = number_format(-(float) $payload['amount'], 2, '.', '');
                return $payload;
            case 'refund_lines_flipped':
                foreach ($payload['line_items'] as &$line) {
                    foreach (['net_amount', 'tax_amount', 'gross_amount', 'unit_price'] as $field) {
                        $line[$field] = number_format(abs((float) $line[$field]), 2, '.', '');
                    }
                }
                unset($line);
                return $payload;
            case 'drop_tax_rate':
                $original = $payload;
                unset($payload['line_items'][0]['tax_rate']);
                $payload['line_items'][0]['tax_amount'] = '99.00';
                $payload['line_items'][0]['gross_amount'] = '199.00';
                return WC_Twoinc_Helper::recompute_totals_from_lines($payload, $original);
            case 'line_scalar':
                $original = $payload;
                $payload['line_items'][1] = 'x';
                return WC_Twoinc_Helper::recompute_totals_from_lines($payload, $original);
            case 'drop_subtotals':
                unset($payload['tax_subtotals']);
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
            default:
                return $payload;
        }
    }

    add_filter('twoinc_order_postprocessing', 'twoinc_order_postprocessing_fixture', 10, 2);
}
