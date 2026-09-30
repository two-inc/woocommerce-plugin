<?php

/**
 * Orders the builders are pinned against (TWO-26092). Plain stubs only, so the same file loads under an older
 * bootstrap to capture builder-goldens.json from the release before the postprocessing hook:
 *
 *   git worktree add /tmp/before 301db2d
 *   php tests/unit/fixtures/capture-builder-goldens.php /tmp/before > tests/unit/fixtures/builder-goldens.json
 */

if (!class_exists('TwoincBuilderFixtureOrder')) {
    class TwoincBuilderFixtureOrder extends StubOrder
    {
        private $fixture;

        public function __construct(array $fixture)
        {
            $this->fixture = $fixture;
        }

        public function get_items($type = 'line_item')
        {
            return $this->fixture[$type] ?? [];
        }

        public function get_item($id)
        {
            return $this->fixture['shipping'][$id] ?? false;
        }

        public function get_taxes()
        {
            return $this->fixture['tax'] ?? [];
        }

        public function get_total()
        {
            return $this->fixture['total'];
        }

        public function get_total_tax()
        {
            return $this->fixture['total_tax'];
        }

        public function get_total_discount()
        {
            return $this->fixture['discount'] ?? 0.0;
        }

        public function get_currency()
        {
            return $this->fixture['currency'];
        }

        public function get_taxable_location()
        {
            return ['country' => 'NO', 'state' => '', 'postcode' => '0150', 'city' => 'Oslo'];
        }

        public function get_items_tax_classes()
        {
            return [];
        }
    }

    class TwoincBuilderFixtureFee extends StubProductLineItem
    {
        public function get_total()
        {
            return $this['line_total'];
        }

        public function get_total_tax()
        {
            return $this['line_tax'];
        }
    }

    /** @return array<string, callable(): array{order: StubOrder, refund: array|null}> */
    function twoinc_builder_fixture_orders(): array
    {
        $line = static function (string $name, float $subtotal, float $net, float $tax, array $taxes, int $quantity = 1) {
            return new StubProductLineItem(['name' => $name, 'line_subtotal' => $subtotal, 'line_total' => $net, 'line_tax' => $tax, 'taxes' => $taxes, 'quantity' => $quantity]);
        };
        return [
            'untaxed_shipping' => static function () use ($line) {
                return [
                    'order' => new TwoincBuilderFixtureOrder([
                        'currency' => 'EUR', 'total' => 150.0, 'total_tax' => 21.0,
                        'line_item' => [$line('Widget', 100.0, 100.0, 21.0, [1 => 21.0])],
                        'shipping' => [5 => new StubShippingItem(29.0, 0.0, [])],
                        'tax' => [new StubOrderTaxItem(1, 21.0)],
                    ]),
                    'refund' => [new StubRefund(['shipping' => [new StubShippingItem(-29.0, 0.0, [], ['_refunded_item_id' => 5])]], []), 29.0],
                ];
            },
            'coupon_fee_taxed_shipping' => static function () use ($line) {
                return [
                    'order' => new TwoincBuilderFixtureOrder([
                        'currency' => 'GBP', 'total' => 138.0, 'total_tax' => 23.0, 'discount' => 20.0,
                        'line_item' => [$line('Widget', 120.0, 100.0, 20.0, [1 => 20.0], 2)],
                        'shipping' => [5 => new StubShippingItem(10.0, 2.0, [1 => 2.0])],
                        'fee' => [new TwoincBuilderFixtureFee(['name' => 'Handling', 'line_total' => 5.0, 'line_tax' => 1.0, 'taxes' => [1 => 1.0]])],
                        'tax' => [new StubOrderTaxItem(1, 20.0)],
                    ]),
                    'refund' => [new StubRefund(['shipping' => [new StubShippingItem(-10.0, -2.0, [1 => -2.0], ['_refunded_item_id' => 5])]], []), 12.0],
                ];
            },
            'two_packages_mixed_rates' => static function () use ($line) {
                return [
                    'order' => new TwoincBuilderFixtureOrder([
                        'currency' => 'NOK', 'total' => 456.25, 'total_tax' => 77.25,
                        'line_item' => [$line('Standard', 200.0, 200.0, 50.0, [1 => 50.0]), $line('Food', 100.0, 100.0, 15.0, [2 => 15.0])],
                        'shipping' => [5 => new StubShippingItem(49.0, 12.25, [1 => 12.25]), 6 => new StubShippingItem(30.0, 0.0, [])],
                        'tax' => [new StubOrderTaxItem(1, 25.0), new StubOrderTaxItem(2, 15.0)],
                    ]),
                    'refund' => null,
                ];
            },
            'vat_exempt_buyer' => static function () use ($line) {
                return [
                    'order' => new TwoincBuilderFixtureOrder([
                        'currency' => 'GBP', 'total' => 115.0, 'total_tax' => 0.0,
                        'line_item' => [$line('Widget', 100.0, 100.0, 0.0, [])],
                        'shipping' => [5 => new StubShippingItem(15.0, 0.0, [])],
                    ]),
                    'refund' => null,
                ];
            },
        ];
    }

    /**
     * Every builder's body for one fixture, composed with tax subtotals on. The delivery date is today-relative, so
     * it is pinned.
     */
    function twoinc_builder_fixture_payloads(array $fixture): array
    {
        $order = $fixture['order'];
        $instance = new ReflectionProperty(WC_Twoinc::class, 'instance');
        $instance->setAccessible(true);
        $previous = $instance->getValue();
        $instance->setValue(null, new class () extends WC_Twoinc {
            public function __construct()
            {
            }

            public function get_option($key, $empty_value = null)
            {
                return $key === 'enable_tax_subtotals' ? 'yes' : ($empty_value ?? '');
            }
        });
        try {
            $payloads = [
                'order_create' => WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', []),
                'order_update' => WC_Twoinc_Helper::compose_twoinc_edit_order($order, '', '', '', ''),
            ];
            if ($fixture['refund']) {
                $payloads['refund'] = WC_Twoinc_Helper::compose_twoinc_refund($fixture['refund'][0], $fixture['refund'][1], $order);
            }
            if (method_exists('WC_Twoinc_Helper', 'compose_twoinc_intent')) {
                $payloads['intent'] = WC_Twoinc_Helper::compose_twoinc_intent($order, []);
            }
        } finally {
            $instance->setValue(null, $previous);
        }
        foreach ($payloads as &$payload) {
            if (isset($payload['shipping_details']['expected_delivery_date'])) {
                $payload['shipping_details']['expected_delivery_date'] = 'pinned';
            }
        }
        unset($payload);
        return $payloads;
    }
}
