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
            'testAPayloadNoSubscriberChangedIsGatedAsItsBuilderWas',
            'testAChangedPayloadKeepsWhatTheShopDeclaredBeyondItsLines',
            'testTheOlderFiltersOutputIsSentAsBefore',
            'testEveryRequestTypeFiresOnceAndIsGated',
            'testEveryOrderSendGoesThroughTheChokeFunction',
            'testIntentIsBuiltServerSideAsTheBrowserUsedToSendIt',
            'testAnIntentThatCannotBeSentIsAnErrorNotADecline',
            'testIntentAppliesThePostedTermBeforeTotals',
            'testIntentRunsTheSameLineFilterAsCreate',
            'testTheTwoOrderIdIsKeptWhenTheChangeHashFails',
            'testNoSubscriberBuildersMatchTheShippingTaxRelease',
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

    /** Runs the intent wc-ajax handler against $gateway, with $post as the browser's request. */
    private static function driveIntent($gateway, array $post): void
    {
        $_POST = $post;
        $prop = new ReflectionProperty(WC_Twoinc::class, 'instance');
        $prop->setAccessible(true);
        $prop->setValue(null, $gateway);
        try {
            WC_Twoinc_Api_Proxy::ajax_order_intent();
        } finally {
            $prop->setValue(null, null);
        }
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
            ['drop_lines', 'order_create', self::examplePayload(), 'TWO_ORDER_POSTPROCESSING_LINE_INCONSISTENT', 'every line dropped and gross set to 999'],
            ['lines_string', 'order_create', self::examplePayload(), 'TWO_ORDER_POSTPROCESSING_LINE_INCONSISTENT', 'line_items replaced by a string'],
            ['unset_gross', 'order_create', self::examplePayload(), 'TWO_ORDER_POSTPROCESSING_TOTALS_INCONSISTENT', 'gross_amount removed and net made nonsense'],
            ['refund_sign', 'refund', $refund, 'TWO_ORDER_POSTPROCESSING_TOTALS_INCONSISTENT', 'a refund amount with its sign flipped'],
            ['drop_subtotals', 'order_create', self::examplePayload(), 'TWO_ORDER_POSTPROCESSING_SUBTOTALS_INCONSISTENT', 'tax_subtotals removed'],
            ['refund_lines_flipped', 'refund', $refund, 'TWO_ORDER_POSTPROCESSING_TOTALS_INCONSISTENT', 'every refund line turned positive'],
            ['drop_tax_rate', 'order_create', self::examplePayload(), 'TWO_ORDER_POSTPROCESSING_LINE_INCONSISTENT', 'a changed line with its tax_rate removed'],
            ['line_scalar', 'order_create', self::examplePayload(), 'TWO_ORDER_POSTPROCESSING_LINE_INCONSISTENT', 'a line replaced by a scalar, totals moved to match'],
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

    /** The worked example, with 10.00 of gift card taken off the order total but not off any line. */
    private static function residualPayload(): array
    {
        $payload = self::examplePayload();
        $payload['gross_amount'] = '140.00';
        $payload['net_amount'] = '119.00';
        return $payload;
    }

    /** The worked example plus a third-party fee whose tax does not reconcile with the rate it declares. */
    private static function unverifiableFeePayload(): array
    {
        $payload = self::examplePayload();
        $payload['line_items'][] = ['name' => 'Handling', 'net_amount' => '5.00', 'tax_amount' => '1.00', 'gross_amount' => '6.00', 'tax_rate' => '0.250000', 'unit_price' => '5.00', 'type' => 'SERVICE'];
        $payload['tax_subtotals'][] = ['tax_amount' => '1.00', 'tax_rate' => '0.250000', 'taxable_amount' => '5.00'];
        $payload['gross_amount'] = '156.00';
        $payload['net_amount'] = '134.00';
        $payload['tax_amount'] = '22.00';
        return $payload;
    }

    private static function testAPayloadNoSubscriberChangedIsGatedAsItsBuilderWas(): void
    {
        $mistaxed_shipping = self::examplePayload();
        $mistaxed_shipping['line_items'][1]['tax_amount'] = '7.00';
        $mistaxed_shipping['line_items'][1]['gross_amount'] = '36.00';
        $mistaxed_product = self::examplePayload();
        $mistaxed_product['line_items'][0]['tax_amount'] = '25.00';
        $unbalanced_line = self::examplePayload();
        $unbalanced_line['line_items'][0]['gross_amount'] = '130.00';
        // [payload, refusal the builder raised before the hook existed (null: sent), description]
        $cases = [
            [$mistaxed_shipping, 'does not match the shop\'s tax rates', 'shipping taxed off the shop rate is refused, as its builder refused it'],
            [$mistaxed_product, null, 'a product line off its rate is sent, as it was'],
            [$unbalanced_line, null, 'a line whose net + tax is not its gross is sent, as it was'],
            [self::residualPayload(), null, 'a gift card outside the lines is sent, as it was'],
            [self::unverifiableFeePayload(), null, 'a third-party fee off its rate is sent, as it was'],
        ];
        foreach ([false, true] as $subscriber) {
            foreach ($cases as [$payload, $refusal, $description]) {
                self::reset($subscriber);
                try {
                    $sent = WC_Twoinc_Helper::postprocess_order_request($payload, self::context('order_create'));
                    $outcome = json_encode($sent) === json_encode($payload) ? null : 'changed';
                } catch (Exception $e) {
                    $outcome = get_class($e) === Exception::class ? $e->getMessage() : get_class($e);
                }
                $label = "$description, subscriber " . var_export($subscriber, true);
                if ($refusal === null) {
                    TinyAssert::same(null, $outcome, $label);
                } else {
                    TinyAssert::true(is_string($outcome) && strpos($outcome, $refusal) !== false, "$label: " . var_export($outcome, true));
                }
            }
        }
    }

    private static function testAChangedPayloadKeepsWhatTheShopDeclaredBeyondItsLines(): void
    {
        // [fixture mode, payload, expected gross or refusal code, description]
        $cases = [
            ['resplit', self::residualPayload(), '140.00', 'a re-split carrying the gift card over is sent'],
            ['drop_residual', self::residualPayload(), 'TWO_ORDER_POSTPROCESSING_TOTALS_INCONSISTENT', 'totals rebuilt without the gift card are refused'],
            ['resplit', self::unverifiableFeePayload(), '156.00', 'a line the subscriber left alone is not re-checked'],
        ];
        foreach ($cases as [$mode, $payload, $expected, $description]) {
            self::reset();
            self::arm($mode);
            try {
                $outcome = WC_Twoinc_Helper::postprocess_order_request($payload, self::context('order_create'))['gross_amount'];
            } catch (WC_Twoinc_Order_Postprocessing_Exception $e) {
                $outcome = $e->get_refusal_code();
            }
            TinyAssert::same($expected, $outcome, $description);
        }
    }

    private static function testTheOlderFiltersOutputIsSentAsBefore(): void
    {
        $break_gross = static function ($body) {
            $body['gross_amount'] = '1.00';
            return $body;
        };
        // Built inside the composers, so what they return is what the plugin sent before the hook existed.
        // [filter, callback, request type, description]
        $cases = [
            ['twoinc_payment_terms_line', static function ($lines) {
                $lines[] = ['name' => 'Fee', 'net_amount' => '5.00', 'tax_amount' => '0.00', 'gross_amount' => '5.00', 'type' => 'SERVICE'];
                return $lines;
            }, 'order_create', 'a line appended without its totals'],
            ['two_order_create', $break_gross, 'order_create', 'the legacy create filter breaking gross'],
            ['two_order_edit', $break_gross, 'order_update', 'the legacy edit filter breaking gross'],
            ['twoinc_order_payload', static function ($body) {
                $body['line_items'][0]['tax_amount'] = '1.00';
                return $body;
            }, 'order_create', 'the payload filter breaking a line'],
        ];
        foreach ($cases as [$filter, $callback, $type, $description]) {
            self::reset();
            add_filter($filter, $callback, 10, 1);
            $order = self::exampleOrder();
            $body = $type === 'order_update'
                ? WC_Twoinc_Helper::compose_twoinc_edit_order($order, '', '', '', '')
                : WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', []);
            try {
                $sent = json_encode(WC_Twoinc_Helper::postprocess_order_request($body, self::context($type, $order)));
            } catch (Exception $e) {
                $sent = $e->getMessage();
            }
            TinyAssert::same(json_encode($body), $sent, $description);
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
                self::driveIntent($gateway, ['intent' => json_encode(['buyer' => ['company' => ['country_prefix' => 'NO']]])]);
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
            self::driveIntent($gateway, ['intent' => json_encode([
                'gross_amount' => '1.00',
                'line_items' => [],
                'buyer' => ['company' => ['country_prefix' => 'NO', 'organization_number' => '912345678']],
            ])]);

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
            [
                ['gross_amount' => '0', 'net_amount' => '0', 'tax_amount' => '0', 'tax_subtotals' => [], 'line_items' => $lines],
                ['gross_amount' => '150.00', 'net_amount' => '123.97', 'tax_amount' => '26.03', 'tax_subtotals' => [
                    ['tax_amount' => '26.03', 'tax_rate' => '0.210000', 'taxable_amount' => '123.97'],
                    ['tax_amount' => '0.00', 'tax_rate' => '0.000000', 'taxable_amount' => '10.00'],
                ], 'line_items' => $lines],
                'a gift card the original declared outside its lines is carried over',
                ['gross_amount' => '150.00', 'net_amount' => '129.00', 'tax_amount' => '21.00', 'tax_subtotals' => [
                    ['tax_amount' => '21.00', 'tax_rate' => '0.210000', 'taxable_amount' => '100.00'],
                    ['tax_amount' => '0.00', 'tax_rate' => '0.000000', 'taxable_amount' => '39.00'],
                ], 'line_items' => [$lines[0], ['net_amount' => '39.00', 'tax_amount' => '0.00', 'gross_amount' => '39.00', 'tax_rate' => '0']]],
            ],
            [
                ['amount' => '1.00', 'line_items' => [['net_amount' => '-8.26', 'tax_amount' => '-1.74', 'gross_amount' => '-10.00']]],
                ['amount' => '9.00', 'line_items' => [['net_amount' => '-8.26', 'tax_amount' => '-1.74', 'gross_amount' => '-10.00']]],
                'a refund amount keeps what the original refunded beyond its lines',
                ['amount' => '9.00', 'line_items' => [['net_amount' => '-10.00', 'tax_amount' => '0.00', 'gross_amount' => '-10.00']]],
            ],
        ];
        foreach ($cases as $case) {
            [$in, $out, $description] = $case;
            TinyAssert::same($out, WC_Twoinc_Helper::recompute_totals_from_lines($in, $case[3] ?? []), $description);
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
    private static function testAnIntentThatCannotBeSentIsAnErrorNotADecline(): void
    {
        // [fixture mode, cart contents override, description]
        $cases = [
            ['', ['throws' => true], 'the cart cannot be copied onto an order'],
            ['', ['line_item' => [new StubProductLineItem(['name' => 'Widget', 'line_total' => 100.0, 'line_subtotal' => 90.0, 'line_tax' => 25.0, 'taxes' => [1 => 25.0]])]], 'a builder guard throws while composing'],
            ['throws', [], 'the subscriber throws'],
            ['line_off', [], 'the subscriber breaks a line'],
        ];
        foreach ($cases as [$mode, $override, $description]) {
            self::reset();
            self::arm($mode);
            $cart = new StubIntentCart();
            $cart->contents = array_merge($cart->contents, $override);
            WC()->cart = $cart;
            $gateway = self::recordingGateway();
            try {
                self::driveIntent($gateway, ['intent' => json_encode(['buyer' => ['company' => ['country_prefix' => 'NO', 'organization_number' => '912345678']]])]);
                $response = $GLOBALS['__twoinc_test_ajax_json'] ?? [];
            } catch (Throwable $e) {
                $response = ['fatal' => get_class($e) . ': ' . $e->getMessage()];
            }
            // A 200 reaches the browser's success path, which reads it as a decline and caches it (TWO-25657).
            TinyAssert::same([false, 500], [$response['success'] ?? null, $response['status'] ?? null], "$description: " . json_encode($response));
            TinyAssert::same(false, in_array('/v1/order_intent', array_column($gateway->sent, 'endpoint'), true), "$description: was sent");
        }
    }

    private static function testIntentAppliesThePostedTermBeforeTotals(): void
    {
        $gateway = new class () extends WC_Twoinc {
            public $icon = '';
            public $sent = [];

            public function __construct()
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
            }

            public function get_merchant_available_terms(): array
            {
                return [30, 60];
            }

            public function get_merchant_default_term(): ?int
            {
                return 30;
            }

            public function get_option($key, $empty_value = null)
            {
                return $key === 'payment_terms_days' ? ['30', '60'] : ($empty_value ?? '');
            }

            public function get_supported_buyer_countries()
            {
                return null;
            }

            public function make_request($endpoint, $payload = [], $method = 'POST', $params = [], $api_key_override = null, $timeout = 30)
            {
                $this->sent[] = ['endpoint' => $endpoint, 'payload' => $payload];
                return ['response' => ['code' => 200], 'body' => '{"approved":true}'];
            }
        };
        $intent = json_encode(['buyer' => ['company' => ['country_prefix' => 'NO']]]);
        // [posted term, term the totals are calculated with, description]
        $cases = [
            ['60', 60, 'a chip the session has not caught up with yet'],
            ['45', 30, 'a term the merchant does not offer leaves the session alone'],
            [null, 30, 'no posted term leaves the session alone'],
        ];
        foreach ($cases as [$posted, $expected, $description]) {
            self::reset();
            WC()->session = new StubSession();
            WC()->session->set(WC_Twoinc_Payment_Terms::SESSION_KEY, 30);
            $cart = new StubIntentCart();
            WC()->cart = $cart;
            self::driveIntent($gateway, array_filter(['intent' => $intent, WC_Twoinc_Payment_Terms::SESSION_KEY => $posted]));
            TinyAssert::same($expected, $cart->term_at_totals, $description);
        }
    }

    private static function testIntentRunsTheSameLineFilterAsCreate(): void
    {
        add_filter('twoinc_payment_terms_line', static function ($lines) {
            $lines[0]['description'] = 'from twoinc_payment_terms_line';
            return $lines;
        });
        $order = self::exampleOrder();
        $create = WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', []);
        $intent = WC_Twoinc_Helper::compose_twoinc_intent($order, []);

        TinyAssert::same(json_encode($create['line_items']), json_encode($intent['line_items']), 'intent lines differ from create lines');
    }

    private static function testTheTwoOrderIdIsKeptWhenTheChangeHashFails(): void
    {
        self::arm('throws_on_hash');
        WC()->session = new StubSession();
        WC()->cart = new StubCart(150.0, 21.0, false);
        $_POST = ['company_id' => '912345678', 'company_name' => 'Buyer AS', WC_Twoinc::TERMS_CONSENT_FIELD => '1'];
        $order = self::exampleOrder();
        unset($order->meta[WC_Twoinc_Brand::prefixed_name('order_id')]);
        $gateway = self::recordingGateway();
        try {
            $result = $gateway->process_payment(42);
        } catch (Throwable $e) {
            $result = get_class($e) . ': ' . $e->getMessage();
        }

        TinyAssert::same('success', $result['result'] ?? $result, 'the Two order exists, so the checkout goes on: ' . json_encode($result));
        TinyAssert::same('two-1', $order->meta[WC_Twoinc_Brand::prefixed_name('order_id')] ?? null, 'the Two order id was not saved');
        TinyAssert::same('', $order->meta[WC_Twoinc_Brand::meta_key('req_body_hash')] ?? null, 'an empty hash makes the next save sync');
        TinyAssert::true(in_array('error', array_column($GLOBALS['__twoinc_test_logs'], 'level'), true), 'the failure was not logged');
    }

    private static function testNoSubscriberBuildersMatchTheShippingTaxRelease(): void
    {
        $goldens = json_decode((string) file_get_contents(__DIR__ . '/fixtures/builder-goldens.json'), true);
        $fixtures = twoinc_builder_fixture_orders();
        TinyAssert::same(array_keys($goldens), array_keys($fixtures), 'every fixture has a golden');
        foreach ([false, true] as $subscriber) {
            self::reset($subscriber);
            foreach ($fixtures as $name => $build) {
                // Rebuilt per pass: a builder may stamp meta on the order it reads.
                $fixture = $build();
                foreach (twoinc_builder_fixture_payloads($fixture) as $type => $payload) {
                    $label = "$name $type, subscriber " . var_export($subscriber, true);
                    // Intent had no server-side builder before; it answers as the order did.
                    $want = $goldens[$name][$type === 'intent' ? 'order_create' : $type];
                    try {
                        $sent = isset($payload['refused']) ? $payload : WC_Twoinc_Helper::postprocess_order_request($payload, self::context($type === 'intent' ? 'order_intent' : $type, $fixture['order']));
                    } catch (Exception $e) {
                        $sent = ['refused' => $e->getMessage()];
                    }
                    if (isset($want['refused']) || isset($sent['refused'])) {
                        // The release named the shipping method; the gate names its line.
                        TinyAssert::true(isset($want['refused'], $sent['refused']) && strpos($sent['refused'], 'does not match the shop\'s tax rates') !== false, "$label: " . json_encode([$want['refused'] ?? 'sent', $sent['refused'] ?? 'sent']));
                        continue;
                    }
                    $want = $type === 'intent' ? $want['line_items'] : $want;
                    $have = $type === 'intent' ? $sent['line_items'] : $sent;
                    TinyAssert::same(json_encode($want), json_encode($have), $label);
                }
            }
        }
    }
}
