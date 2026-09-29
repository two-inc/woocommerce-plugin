<?php

declare(strict_types=1);

/**
 * The `twoinc_order_postprocessing` contract (TWO-26092): where it fires, what it may change, and the gates
 * that hold on whatever it returns. Drives the CI fixture subscriber in fixtures/orderpostprocessing.php.
 */
final class OrderPostprocessingSpec
{
    private const FIXTURE_OPTION = 'twoinc_order_postprocessing_fixture';

    private const CONTEXT_KEYS = [
        'request_type',
        'trigger',
        'endpoint',
        'order',
        'refund',
        'shipping_tax_rate',
        'fallback_shipping_tax_rate',
        'contract_version',
    ];

    public static function runAll(): void
    {
        $tests = [
            'testNoSubscriberLeavesEveryPayloadByteIdentical',
            'testTheWorkedExampleResplitsUntaxedShipping',
            'testASubscriberMayChangeGross',
            'testABrokenPayloadIsRefusedWithANamedCode',
            'testAnUnchangedPayloadFailsWithTheGatesOwnError',
            'testTheOlderFiltersOutputIsGated',
            'testEveryRequestTypeFiresOnceAndIsGated',
            'testEveryOrderSendGoesThroughTheChokeFunction',
            'testIntentIsBuiltServerSideAsTheBrowserUsedToSendIt',
            'testRecomputeTotalsFromLines',
            'testTheChangeHashIsTakenOverThePostHookPayload',
        ];
        foreach ($tests as $test) {
            self::reset();
            self::$test();
            print("PASS OrderPostprocessingSpec::$test\n");
        }
        self::reset();
    }

    private static function reset(bool $fixture = true): void
    {
        foreach (['twoinc_order_postprocessing', 'twoinc_order_payload', 'twoinc_payment_terms_line', 'two_order_create', 'two_order_edit'] as $tag) {
            remove_all_filters($tag);
        }
        if ($fixture) {
            add_filter('twoinc_order_postprocessing', 'twoinc_order_postprocessing_fixture', 10, 2);
        }
        $GLOBALS['__twoinc_test_options'] = [
            // The shop's shipping tax setting resolves to 21% at the order's address.
            'woocommerce_shipping_tax_class' => '',
        ];
        $GLOBALS['__twoinc_test_find_rates'] = ['' => [1 => ['rate' => 21.0, 'shipping' => 'yes', 'compound' => 'no', 'label' => 'VAT']]];
        $GLOBALS['twoinc_order_postprocessing_fixture_calls'] = [];
        $GLOBALS['__twoinc_test_logs'] = [];
        $GLOBALS['__twoinc_test_notices'] = [];
        $GLOBALS['__twoinc_test_wc_orders'] = [];
        $GLOBALS['__twoinc_test_transients'] = [];
        unset($GLOBALS['__twoinc_test_intent_cart']);
        WC()->cart = null;
        WC()->customer = null;
        WC()->session = null;
        $_POST = [];
        $_REQUEST = [];
    }

    private static function arm(string $mode): void
    {
        $GLOBALS['__twoinc_test_options'][self::FIXTURE_OPTION] = $mode;
    }

    /** The worked example: one product at 100.00 net + 21%, and 29.00 of shipping the shop recorded untaxed. */
    private static function examplePayload(bool $subtotals = true): array
    {
        $payload = [
            'currency' => 'EUR',
            'gross_amount' => '150.00',
            'net_amount' => '129.00',
            'tax_amount' => '21.00',
            'line_items' => [
                ['name' => 'Widget', 'net_amount' => '100.00', 'tax_amount' => '21.00', 'gross_amount' => '121.00', 'tax_rate' => '0.210000', 'tax_class_name' => 'VAT', 'unit_price' => '100.00', 'type' => 'PHYSICAL'],
                ['name' => 'Shipping - Courier', 'net_amount' => '29.00', 'tax_amount' => '0.00', 'gross_amount' => '29.00', 'tax_rate' => '0.000000', 'tax_class_name' => 'NA', 'unit_price' => '29.00', 'type' => 'SHIPPING_FEE'],
            ],
        ];
        if ($subtotals) {
            $payload['tax_subtotals'] = [
                ['tax_amount' => '21.00', 'tax_rate' => '0.210000', 'taxable_amount' => '100.00'],
                ['tax_amount' => '0.00', 'tax_rate' => '0.000000', 'taxable_amount' => '29.00'],
            ];
        }
        return $payload;
    }

    private static function refundPayload(string $shipping): array
    {
        return [
            'amount' => number_format(-(float) $shipping, 2, '.', ''),
            'currency' => 'EUR',
            'line_items' => [
                ['name' => 'Shipping - Courier', 'net_amount' => $shipping, 'tax_amount' => '0.00', 'gross_amount' => $shipping, 'tax_rate' => '0.000000', 'unit_price' => $shipping, 'type' => 'SHIPPING_FEE'],
            ],
        ];
    }

    /** The same order as a WooCommerce order, for the builders and the gateway paths. */
    private static function exampleOrder()
    {
        $order = new class extends StubOrder {
            public function get_items($type = 'line_item')
            {
                switch ($type) {
                    case 'line_item':
                        return [new StubProductLineItem(['name' => 'Widget', 'line_total' => 100.0, 'line_subtotal' => 100.0, 'line_tax' => 21.0, 'taxes' => [1 => 21.0]])];
                    case 'shipping':
                        return [5 => $this->get_item(5)];
                    default:
                        return [];
                }
            }

            public function get_taxes()
            {
                return [new StubOrderTaxItem(1, 21.0)];
            }

            private $shipping;

            public function get_item($id)
            {
                $this->shipping = $this->shipping ?? new StubShippingItem(29.0, 0.0, []);
                return $id === 5 ? $this->shipping : false;
            }

            public function get_total()
            {
                return 150.0;
            }

            public function get_total_tax()
            {
                return 21.0;
            }

            public function get_currency()
            {
                return 'EUR';
            }

            public function update_meta_data($key, $value)
            {
                $this->meta[$key] = $value;
            }

            public function save()
            {
            }

            public function set_billing_country($value)
            {
            }

            public function set_billing_company($value)
            {
            }

            public function set_billing_phone($value)
            {
            }

            public function payment_complete()
            {
            }

            public function get_checkout_order_received_url()
            {
                return 'https://shop.example/thanks';
            }

            public $refunds = [];

            public function get_refunds()
            {
                return $this->refunds;
            }
        };
        $order->payment_method = WC_Twoinc_Brand::get('gateway_id');
        $order->meta[WC_Twoinc_Brand::prefixed_name('order_id')] = 'two-1';
        $order->meta[WC_Twoinc_Brand::meta_key('order_reference')] = 'ref';
        $order->meta['company_id'] = '912345678';
        $order->meta['vendor_name'] = 'vendor';
        $GLOBALS['__twoinc_test_wc_orders'][42] = $order;
        return $order;
    }

    private static function shippingRefund()
    {
        return new class ([
            'shipping' => [new StubShippingItem(-29.0, 0.0, [], ['_refunded_item_id' => 5])],
        ], []) extends StubRefund {
            public function get_refunded_payment()
            {
                return false;
            }

            public function get_date_created()
            {
                return 1;
            }

            public function get_amount()
            {
                return 29.0;
            }
        };
    }

    private static function context(string $request_type, $order = null): array
    {
        return WC_Twoinc_Helper::order_postprocessing_context($request_type, 'test', '/v1/order', $order ?? self::exampleOrder());
    }

    /** A gateway that records what it would send and answers every call with success. */
    private static function recordingGateway()
    {
        return new class () extends WC_Twoinc {
            public $icon = '';
            public $sent = [];

            public function __construct()
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
            }

            public function get_merchant_id()
            {
                return 'mid';
            }

            public function get_option($key, $empty_value = null)
            {
                return $key === 'api_key' ? 'key' : ($empty_value ?? '');
            }

            public function get_supported_buyer_countries()
            {
                return null;
            }

            public function make_request($endpoint, $payload = [], $method = 'POST', $params = [], $api_key_override = null, $timeout = 30)
            {
                $this->sent[] = ['endpoint' => $endpoint, 'method' => $method, 'payload' => $payload];
                return [
                    'response' => ['code' => 200],
                    'body' => '{"id":"two-1","status":"APPROVED","state":"VERIFIED","approved":true,"amount":"-29.00","gross_amount":"150.00","payment_url":"https://pay.example/1","merchant_urls":{"merchant_confirmation_url":"https://shop.example/thanks"}}',
                ];
            }
        };
    }

    private static function fixtureCalls(): array
    {
        return array_values(array_filter($GLOBALS['twoinc_order_postprocessing_fixture_calls'], static function ($call) {
            return $call['trigger'] !== 'change_hash';
        }));
    }

    private static function testNoSubscriberLeavesEveryPayloadByteIdentical(): void
    {
        $order = self::exampleOrder();
        $refund = self::shippingRefund();
        // [request type, payload as the builder produced it, description]
        $cases = [
            ['order_intent', WC_Twoinc_Helper::compose_twoinc_intent($order, ['company' => ['country_prefix' => 'NO']]), 'intent'],
            ['order_create', WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', []), 'create'],
            ['order_update', WC_Twoinc_Helper::compose_twoinc_edit_order($order, '', '', '', ''), 'update'],
            ['refund', WC_Twoinc_Helper::compose_twoinc_refund($refund, 29.0, $order), 'refund'],
            ['order_confirm', [], 'confirm'],
            ['capture', [], 'capture'],
            ['cancel', [], 'cancel'],
        ];
        foreach ([false, true] as $fixture) {
            self::reset($fixture);
            $label = $fixture ? 'unarmed fixture subscriber' : 'no subscriber';
            foreach ($cases as [$type, $payload, $description]) {
                $sent = WC_Twoinc_Helper::postprocess_order_request($payload, self::context($type, $order));
                TinyAssert::same(json_encode($payload), json_encode($sent), "$description, $label: payload changed");
            }
            TinyAssert::same([], $order->notes, "$label: an order note was written");
            TinyAssert::same([], $GLOBALS['__twoinc_test_logs'], "$label: something was logged");
        }
    }

    private static function testTheWorkedExampleResplitsUntaxedShipping(): void
    {
        // [request type, payload, expected shipping line net/tax/gross, expected order net/tax/gross or refund amount, expected subtotals, description]
        $cases = [
            ['order_create', self::examplePayload(), ['23.97', '5.03', '29.00'], ['123.97', '26.03', '150.00'], [['tax_amount' => '26.03', 'tax_rate' => '0.210000', 'taxable_amount' => '123.97']], 'order: 29.00 re-split to 23.97 + 5.03'],
            ['refund', self::refundPayload('-29.00'), ['-23.97', '-5.03', '-29.00'], '29.00', null, 'full shipping refund mirrors the order'],
            ['refund', self::refundPayload('-10.00'), ['-8.26', '-1.74', '-10.00'], '10.00', null, 'partial shipping refund, 0.01 off the rate and within tolerance'],
        ];
        foreach ($cases as [$type, $payload, $line, $totals, $subtotals, $description]) {
            self::reset();
            self::arm('resplit');
            $order = self::exampleOrder();
            $sent = WC_Twoinc_Helper::postprocess_order_request($payload, self::context($type, $order));

            $shipping = end($sent['line_items']);
            TinyAssert::same($line, [$shipping['net_amount'], $shipping['tax_amount'], $shipping['gross_amount']], $description);
            TinyAssert::same('0.21', $shipping['tax_rate'], $description);
            if (is_array($totals)) {
                TinyAssert::same($totals, [$sent['net_amount'], $sent['tax_amount'], $sent['gross_amount']], $description);
                TinyAssert::same($subtotals, $sent['tax_subtotals'], $description);
            } else {
                TinyAssert::same($totals, $sent['amount'], $description);
            }
            TinyAssert::same(1, count($order->notes), "$description: no order note records the change");
            TinyAssert::true(strpos($order->notes[0], '/line_items/') !== false, "$description: the note does not name the changed line");
            TinyAssert::same('info', $GLOBALS['__twoinc_test_logs'][0]['level'] ?? null, "$description: the change was not logged");
        }
    }

    private static function testASubscriberMayChangeGross(): void
    {
        self::arm('gross');
        $sent = WC_Twoinc_Helper::postprocess_order_request(self::examplePayload(), self::context('order_create'));

        TinyAssert::same('30.00', $sent['line_items'][1]['gross_amount'], 'the merchant owns the gross it declares');
        TinyAssert::same(['130.00', '21.00', '151.00'], [$sent['net_amount'], $sent['tax_amount'], $sent['gross_amount']]);
    }

    private static function testABrokenPayloadIsRefusedWithANamedCode(): void
    {
        $refund = self::refundPayload('-29.00');
        // [fixture mode, request type, payload, expected refusal code, description]
        $cases = [
            ['resplit_lines_only', 'order_create', self::examplePayload(false), 'TWO_ORDER_POSTPROCESSING_TOTALS_INCONSISTENT', 'lines re-split, order totals left stale'],
            ['resplit_lines_only', 'order_create', self::examplePayload(), 'TWO_ORDER_POSTPROCESSING_SUBTOTALS_INCONSISTENT', 'lines re-split, subtotals and totals left stale'],
            ['resplit_stale_subtotals', 'order_create', self::examplePayload(), 'TWO_ORDER_POSTPROCESSING_SUBTOTALS_INCONSISTENT', 'totals rebuilt, subtotals left stale'],
            ['line_off', 'order_create', self::examplePayload(), 'TWO_ORDER_POSTPROCESSING_LINE_INCONSISTENT', 'a line whose net + tax no longer makes its gross'],
            ['wrong_rate', 'order_update', self::examplePayload(), 'TWO_ORDER_POSTPROCESSING_LINE_INCONSISTENT', 'a line declaring a rate its tax does not match'],
            ['refund_amount', 'refund', $refund, 'TWO_ORDER_POSTPROCESSING_TOTALS_INCONSISTENT', 'a refund amount the lines do not sum to'],
            ['body', 'cancel', [], 'TWO_ORDER_POSTPROCESSING_BODY_NOT_ACCEPTED', 'a body added to a request defined with none'],
            ['throws', 'order_intent', self::examplePayload(), 'TWO_ORDER_POSTPROCESSING_HOOK_FAILED', 'a subscriber that throws'],
            ['non_array', 'capture', [], 'TWO_ORDER_POSTPROCESSING_HOOK_FAILED', 'a subscriber that returns no array'],
        ];
        foreach ($cases as [$mode, $type, $payload, $code, $description]) {
            self::reset();
            self::arm($mode);
            $caught = null;
            try {
                WC_Twoinc_Helper::postprocess_order_request($payload, self::context($type));
            } catch (WC_Twoinc_Order_Postprocessing_Exception $e) {
                $caught = $e;
            }
            TinyAssert::true($caught !== null, "$description: was not refused");
            TinyAssert::same($code, $caught->get_refusal_code(), $description);
            TinyAssert::true(strpos($caught->getMessage(), $code) !== false, "$description: the message does not name the code");
            $log = $GLOBALS['__twoinc_test_logs'][0] ?? ['level' => '', 'message' => ''];
            TinyAssert::same('error', $log['level'], "$description: not logged at error level");
            TinyAssert::true(strpos($log['message'], $code) !== false && strpos($log['message'], $type) !== false, "$description: the log names neither code nor request type");
        }
    }

    private static function testAnUnchangedPayloadFailsWithTheGatesOwnError(): void
    {
        $payload = self::examplePayload();
        $payload['line_items'][0]['tax_amount'] = '25.00';
        $payload['line_items'][0]['gross_amount'] = '125.00';
        try {
            WC_Twoinc_Helper::postprocess_order_request($payload, self::context('order_create'));
            $caught = null;
        } catch (Exception $e) {
            $caught = $e;
        }
        TinyAssert::same(Exception::class, $caught ? get_class($caught) : null, 'no subscriber changed it, so no postprocessing code');
        TinyAssert::true(strpos($caught->getMessage(), 'does not match the shop\'s tax rates') !== false, $caught->getMessage());
    }

    private static function testTheOlderFiltersOutputIsGated(): void
    {
        // [filter, callback, accepted args, expected refusal text, description]
        $cases = [
            ['twoinc_payment_terms_line', static function ($lines) {
                $lines[] = ['name' => 'Fee', 'net_amount' => '5.00', 'tax_amount' => '0.00', 'gross_amount' => '5.00', 'type' => 'SERVICE'];
                return $lines;
            }, 1, 'do not match the order lines', 'a line appended without its totals'],
            ['two_order_create', static function ($body) {
                $body['gross_amount'] = '1.00';
                return $body;
            }, 1, 'do not match the order lines', 'the legacy create filter breaking gross'],
            ['twoinc_order_payload', static function ($body) {
                $body['line_items'][0]['tax_amount'] = '1.00';
                return $body;
            }, 1, 'do not add up', 'the payload filter breaking a line'],
        ];
        foreach ($cases as [$filter, $callback, $args, $expected, $description]) {
            self::reset();
            add_filter($filter, $callback, 10, $args);
            $order = self::exampleOrder();
            $body = WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', []);
            try {
                WC_Twoinc_Helper::postprocess_order_request($body, self::context('order_create', $order));
                $message = 'sent';
            } catch (Exception $e) {
                $message = $e->getMessage();
            }
            TinyAssert::true(strpos($message, $expected) !== false, "$description: got $message");
        }
    }

    private static function testEveryRequestTypeFiresOnceAndIsGated(): void
    {
        $run = static function (callable $drive) {
            $gateway = self::recordingGateway();
            $order = self::exampleOrder();
            $order->refunds = [self::shippingRefund()];
            $drive($gateway, $order);
            return $gateway->sent;
        };
        $call = static function (string $method, ...$args) {
            return static function ($gateway, $order) use ($method, $args) {
                $reflection = new ReflectionMethod(WC_Twoinc::class, $method);
                $reflection->setAccessible(true);
                try {
                    $reflection->invoke($gateway, ...array_map(static function ($arg) use ($order) {
                        return $arg === 'ORDER' ? $order : $arg;
                    }, $args));
                } catch (RuntimeException $e) {
                    // wp_die() in the confirmation path.
                }
            };
        };
        $meta = [
            'order_reference' => 'ref', 'company_id' => '912345678', 'department' => '', 'project' => '',
            'purchase_order_number' => '', 'invoice_emails' => [], 'payment_reference_message' => '',
            'payment_reference_ocr' => '', 'payment_reference' => '', 'payment_reference_type' => '', 'vendor_name' => '',
        ];
        // [driver, expected request type, trigger, endpoint, description]
        $paths = [
            [static function ($gateway) {
                WC()->cart = new StubIntentCart();
                $_POST = ['intent' => json_encode(['buyer' => ['company' => ['country_prefix' => 'NO']]])];
                $prop = new ReflectionProperty(WC_Twoinc::class, 'instance');
                $prop->setAccessible(true);
                $prop->setValue(null, $gateway);
                try {
                    WC_Twoinc_Api_Proxy::ajax_order_intent();
                } finally {
                    $prop->setValue(null, null);
                }
            }, 'order_intent', 'checkout', '/v1/order_intent', 'intent'],
            [static function ($gateway) {
                WC()->session = new StubSession();
                WC()->cart = new StubCart(150.0, 21.0, false);
                $_POST = ['company_id' => '912345678', 'company_name' => 'Buyer AS'];
                $gateway->process_payment(42);
            }, 'order_create', 'checkout', '/v1/order', 'create'],
            [$call('process_update_twoinc_order', 'ORDER', $meta, false, 'admin_edit'), 'order_update', 'admin_edit', '/v1/order/two-1', 'update'],
            [static function ($gateway) use ($call) {
                $_REQUEST = ['order_id' => '42', WC_Twoinc_Brand::prefixed_name('order_reference') => 'ref', WC_Twoinc_Brand::prefixed_name('csrf_token') => wp_create_nonce(WC_Twoinc_Brand::prefixed_name('confirm_42'))];
                $call('process_confirmation')($gateway, null);
            }, 'order_confirm', 'confirmation_redirect', '/v1/order/two-1/confirm', 'confirm'],
            [static function ($gateway) {
                $gateway->on_order_completed(42);
            }, 'capture', 'status_change', '/v1/order/two-1/fulfillments', 'capture'],
            [static function ($gateway) {
                $gateway->process_refund(42);
            }, 'refund', 'order_refund', '/v1/order/two-1/refund', 'refund'],
            [static function ($gateway) {
                $gateway->on_order_cancelled(42);
            }, 'cancel', 'status_change', '/v1/order/two-1/cancel', 'cancel'],
        ];
        foreach ($paths as [$drive, $type, $trigger, $endpoint, $description]) {
            self::reset();
            self::arm('record');
            $sent = $run($drive);
            $calls = self::fixtureCalls();
            TinyAssert::same([[$type, $trigger, $endpoint]], array_map(static function ($c) {
                return [$c['request_type'], $c['trigger'], $c['endpoint']];
            }, $calls), "$description: did not fire exactly once with its own context");
            TinyAssert::same(self::CONTEXT_KEYS, $calls[0]['context_keys'], "$description: context keys");
            TinyAssert::true(in_array($endpoint, array_column($sent, 'endpoint'), true), "$description: was not sent");

            self::reset();
            self::arm('throws');
            $sent = $run($drive);
            TinyAssert::same(false, in_array($endpoint, array_column($sent, 'endpoint'), true), "$description: sent although its subscriber threw");
        }
    }

    private static function testEveryOrderSendGoesThroughTheChokeFunction(): void
    {
        $offenders = [];
        foreach (glob(WC_TWOINC_PLUGIN_PATH . 'class/*.php') as $file) {
            foreach (file($file) as $number => $line) {
                if (preg_match('/make_request\(\s*[\'"]\/v1\/order/', $line) && strpos($line, "'GET'") === false) {
                    $offenders[] = basename($file) . ':' . ($number + 1);
                }
            }
        }
        TinyAssert::same([], $offenders, 'order requests sent around make_order_request()');
    }

    private static function testIntentIsBuiltServerSideAsTheBrowserUsedToSendIt(): void
    {
        $shipping = [
            'line_item' => [new StubProductLineItem(['name' => 'Widget', 'line_total' => 100.0, 'line_subtotal' => 100.0, 'line_tax' => 25.0, 'taxes' => [1 => 25.0]])],
            'shipping' => [new StubShippingItem(10.0, 2.5, [1 => 2.5])],
            'tax' => [new StubOrderTaxItem(1, 25.0)],
            'total' => 137.5,
            'cart_tax' => 25.0,
            'shipping_tax' => 2.5,
        ];
        // [cart contents (null = the plain default cart), description]
        $cases = [
            [null, 'a plain cart'],
            [$shipping, 'a cart with taxed shipping'],
        ];
        foreach ($cases as [$contents, $description]) {
            self::reset();
            $cart = new StubIntentCart($contents);
            WC()->cart = $cart;
            $gateway = self::recordingGateway();
            // What the browser offered is ignored; only the buyer is taken from it.
            $_POST = ['intent' => json_encode([
                'gross_amount' => '1.00',
                'line_items' => [],
                'buyer' => ['company' => ['country_prefix' => 'NO', 'organization_number' => '912345678']],
            ])];
            $prop = new ReflectionProperty(WC_Twoinc::class, 'instance');
            $prop->setAccessible(true);
            $prop->setValue(null, $gateway);
            try {
                WC_Twoinc_Api_Proxy::ajax_order_intent();
            } finally {
                $prop->setValue(null, null);
            }

            $sent = $gateway->sent[0]['payload'];
            $total = $cart->contents['total'];
            $tax = $cart->contents['cart_tax'] + $cart->contents['shipping_tax'];
            // The browser's own arithmetic on the checkout's displayed total and tax.
            $browser = [
                'gross_amount' => number_format($total, 2, '.', ''),
                'net_amount' => number_format($total - $tax, 2, '.', ''),
                'tax_amount' => number_format($tax, 2, '.', ''),
                'invoice_type' => 'FUNDED_INVOICE',
                'currency' => get_woocommerce_currency(),
            ];
            $actual = array_map(static function ($key) use ($sent) {
                return $sent[$key] ?? null;
            }, array_keys($browser));
            TinyAssert::same(array_values($browser), $actual, $description);
            TinyAssert::same(['company' => ['country_prefix' => 'NO', 'organization_number' => '912345678']], $sent['buyer'], $description);
            TinyAssert::same(1, $cart->calculated, "$description: totals were not recomputed before composing");
            $gross = array_sum(array_map('floatval', array_column($sent['line_items'], 'gross_amount')));
            TinyAssert::same($browser['gross_amount'], number_format($gross, 2, '.', ''), "$description: real lines sum to the total");
            TinyAssert::same('mid', $sent['merchant_id'], $description);
        }
    }

    private static function testRecomputeTotalsFromLines(): void
    {
        $lines = [
            ['net_amount' => '100.00', 'tax_amount' => '21.00', 'gross_amount' => '121.00', 'tax_rate' => '0.21'],
            ['net_amount' => '23.97', 'tax_amount' => '5.03', 'gross_amount' => '29.00', 'tax_rate' => '0.210000'],
            ['net_amount' => '10.00', 'tax_amount' => '0.00', 'gross_amount' => '10.00', 'tax_rate' => '0'],
        ];
        // [payload in, payload out, description]
        $cases = [
            [
                ['gross_amount' => '0', 'net_amount' => '0', 'tax_amount' => '0', 'tax_subtotals' => [], 'line_items' => $lines],
                ['gross_amount' => '160.00', 'net_amount' => '133.97', 'tax_amount' => '26.03', 'tax_subtotals' => [
                    ['tax_amount' => '26.03', 'tax_rate' => '0.210000', 'taxable_amount' => '123.97'],
                    ['tax_amount' => '0.00', 'tax_rate' => '0.000000', 'taxable_amount' => '10.00'],
                ], 'line_items' => $lines],
                'order totals and subtotals rebuilt, rates bucketed numerically',
            ],
            [
                ['gross_amount' => '0', 'net_amount' => '0', 'tax_amount' => '0', 'line_items' => $lines],
                ['gross_amount' => '160.00', 'net_amount' => '133.97', 'tax_amount' => '26.03', 'line_items' => $lines],
                'no subtotals are added where the payload carried none',
            ],
            [
                ['amount' => '1.00', 'line_items' => [['net_amount' => '-8.26', 'tax_amount' => '-1.74', 'gross_amount' => '-10.00']]],
                ['amount' => '10.00', 'line_items' => [['net_amount' => '-8.26', 'tax_amount' => '-1.74', 'gross_amount' => '-10.00']]],
                'a refund amount keeps its sign',
            ],
            [['amount' => '5.00'], ['amount' => '5.00'], 'an amount-only refund is left alone'],
            [[], [], 'an empty body stays empty'],
        ];
        foreach ($cases as [$in, $out, $description]) {
            TinyAssert::same($out, WC_Twoinc_Helper::recompute_totals_from_lines($in), $description);
        }
    }

    private static function testTheChangeHashIsTakenOverThePostHookPayload(): void
    {
        $meta = [
            'order_reference' => 'ref', 'company_id' => '912345678', 'department' => '', 'project' => '',
            'purchase_order_number' => '', 'invoice_emails' => [], 'payment_reference_message' => '',
            'payment_reference_ocr' => '', 'payment_reference' => '', 'payment_reference_type' => '', 'vendor_name' => '',
        ];
        $order = self::exampleOrder();
        $plain = WC_Twoinc_Helper::hash_order($order, $meta);
        self::arm('resplit');
        $first = WC_Twoinc_Helper::hash_order($order, $meta);

        TinyAssert::same($first, WC_Twoinc_Helper::hash_order($order, $meta), 'a deterministic subscriber gives a stable hash');
        TinyAssert::true($first !== $plain, 'the hash must cover what the subscriber changed');
        TinyAssert::same([], $order->notes, 'hashing sends nothing, so it records nothing');
    }
}
