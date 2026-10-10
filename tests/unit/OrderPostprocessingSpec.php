<?php

declare(strict_types=1);

/**
 * The `twoinc_order_postprocessing` contract (TWO-26092): where it fires, that what it returns is sent as
 * returned, and that the plugin's default handler runs the shop-match checks unless a merchant handler is
 * registered (TWO-26275). Drives the CI fixture subscriber in fixtures/orderpostprocessing.php.
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
            'testAHookEditIsSentAsReturned',
            'testASubscriberCodeFaultFailsTheRequest',
            'testTheDefaultHandlerOwnsTheShopMatchCheck',
            'testMerchantHandlerDetection',
            'testTheShopMatchCheckAppliesToTheLineItWasMadeFor',
            'testTheDeprecatedFiltersCannotRepairARefusedLine',
            'testADelegatedLineKeepsItsRateAfterPlacement',
            'testARefusalDoesNotOutliveItsRequest',
            'testAnApiRefusalReachesTheLogAndTheOrderNote',
            'testAChangedPayloadKeepsWhatTheShopDeclaredBeyondItsLines',
            'testTheOlderFiltersOutputIsSentAsBefore',
            'testEveryRequestTypeFiresOnce',
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

    /** @param bool $fixture register the fixture subscriber, unarmed: a merchant handler that changes nothing */
    private static function reset(bool $fixture = false): void
    {
        foreach (['twoinc_order_postprocessing', 'twoinc_order_payload', 'twoinc_payment_terms_line', 'two_order_create', 'two_order_edit'] as $tag) {
            remove_all_filters($tag);
        }
        // A fresh PHP request: no shop-match refusal left by an earlier build.
        $refusals = new ReflectionProperty(WC_Twoinc_Helper::class, 'shop_match_refusals');
        $refusals->setAccessible(true);
        $refusals->setValue(null, []);
        // As the plugin registers it when it loads.
        add_filter('twoinc_order_postprocessing', [WC_Twoinc_Helper::class, 'default_order_postprocessing'], PHP_INT_MAX, 2);
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

    /** Arms the fixture subscriber, registering it as the e2e mu-plugin does once the option names a mode. */
    private static function arm(string $mode): void
    {
        $GLOBALS['__twoinc_test_options'][self::FIXTURE_OPTION] = $mode;
        if (!in_array('twoinc_order_postprocessing_fixture', array_column($GLOBALS['__twoinc_test_filters']['twoinc_order_postprocessing'] ?? [], 'cb'), true)) {
            add_filter('twoinc_order_postprocessing', 'twoinc_order_postprocessing_fixture', 10, 2);
        }
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

            public $shipping;

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

    /** A gateway that records what it would send and answers every call with success, or with $status and $body. */
    private static function recordingGateway(int $status = 200, ?string $body = null)
    {
        return new class ($status, $body) extends WC_Twoinc {
            public $icon = '';
            public $sent = [];
            private $status;
            private $body;

            public function __construct(int $status = 200, ?string $body = null)
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
                $this->status = $status;
                $this->body = $body;
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
                    'response' => ['code' => $this->status],
                    'body' => $this->body ?? '{"id":"two-1","status":"APPROVED","state":"VERIFIED","approved":true,"amount":"-29.00","gross_amount":"150.00","payment_url":"https://pay.example/1","merchant_urls":{"merchant_confirmation_url":"https://shop.example/thanks"}}',
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
            // A registered subscriber is a merchant handler: each request says once that the checks are delegated.
            $expected = $fixture ? array_fill(0, count($cases), 'info') : [];
            TinyAssert::same($expected, array_column($GLOBALS['__twoinc_test_logs'], 'level'), "$label: logged");
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
            TinyAssert::same('0.210000', $shipping['tax_rate'], $description);
            if (is_array($totals)) {
                TinyAssert::same($totals, [$sent['net_amount'], $sent['tax_amount'], $sent['gross_amount']], $description);
                TinyAssert::same($subtotals, $sent['tax_subtotals'], $description);
            } else {
                TinyAssert::same($totals, $sent['amount'], $description);
            }
            // Beside the one info line saying the shop-match checks are delegated to the subscriber.
            TinyAssert::same(['info', 'debug'], array_column($GLOBALS['__twoinc_test_logs'], 'level'), "$description: log levels");
            $log = $GLOBALS['__twoinc_test_logs'][1];
            TinyAssert::true(strpos($log['message'], '/line_items/') !== false, "$description: the log does not name the changed line");
        }
    }

    private static function testASubscriberMayChangeGross(): void
    {
        self::arm('gross');
        $sent = WC_Twoinc_Helper::postprocess_order_request(self::examplePayload(), self::context('order_create'));

        TinyAssert::same('30.00', $sent['line_items'][1]['gross_amount'], 'the merchant owns the gross it declares');
        TinyAssert::same(['130.00', '21.00', '151.00'], [$sent['net_amount'], $sent['tax_amount'], $sent['gross_amount']]);
    }

    private static function testAHookEditIsSentAsReturned(): void
    {
        $refund = self::refundPayload('-29.00');
        // The API validates what arrives, so a subscriber's figures go out as it declared them.
        // [fixture mode, request type, payload, description]
        $cases = [
            ['resplit_lines_only', 'order_create', self::examplePayload(), 'lines re-split, subtotals and totals left stale'],
            ['line_off', 'order_update', self::examplePayload(), 'a line whose net + tax no longer makes its gross'],
            ['lines_string', 'order_create', self::examplePayload(), 'line_items replaced by a string'],
            ['refund_sign', 'refund', $refund, 'a refund amount with its sign flipped'],
            ['body', 'cancel', [], 'a body added to a request defined with none'],
        ];
        foreach ($cases as [$mode, $type, $payload, $description]) {
            self::reset();
            self::arm($mode);
            $order = self::exampleOrder();
            $expected = twoinc_order_postprocessing_fixture($payload, self::context($type, $order));
            $gateway = self::recordingGateway();
            $gateway->make_order_request($type, 'test', '/v1/order', $payload, 'POST', $order);

            TinyAssert::same(json_encode($expected), json_encode($gateway->sent[0]['payload'] ?? null), "$description: not sent as returned");
            TinyAssert::same([], array_filter(array_column($GLOBALS['__twoinc_test_logs'], 'level'), static function ($level) {
                return $level !== 'debug' && $level !== 'info';
            }), "$description: logged above info");
        }
    }

    private static function testASubscriberCodeFaultFailsTheRequest(): void
    {
        // [fixture mode, request type, payload, what the log names, description]
        $cases = [
            ['throws', 'order_intent', self::examplePayload(), 'RuntimeException', 'a subscriber that throws'],
            ['non_array', 'capture', [], 'returned NULL, not an array', 'a subscriber that returns no array'],
            ['non_json', 'order_create', self::examplePayload(), 'cannot be encoded as JSON', 'a subscriber that returns what JSON cannot carry'],
        ];
        foreach ($cases as [$mode, $type, $payload, $named, $description]) {
            self::reset();
            self::arm($mode);
            $gateway = self::recordingGateway();
            $caught = null;
            try {
                $gateway->make_order_request($type, 'test', '/v1/order', $payload, 'POST', self::exampleOrder());
            } catch (WC_Twoinc_Order_Postprocessing_Exception $e) {
                $caught = $e;
            }
            TinyAssert::true($caught !== null, "$description: did not fail");
            TinyAssert::same([], $gateway->sent, "$description: was sent");
            // The subscriber is a merchant handler, so the default handler may have logged its delegation first.
            $logs = array_values(array_filter($GLOBALS['__twoinc_test_logs'], static function ($log) {
                return $log['level'] !== 'info';
            }));
            $log = $logs[0] ?? ['level' => '', 'message' => ''];
            TinyAssert::same('error', $log['level'], "$description: not logged at error level");
            foreach (['twoinc_order_postprocessing', $type, $named] as $needle) {
                TinyAssert::true(strpos($log['message'], $needle) !== false, "$description: the log does not name $needle: {$log['message']}");
            }
        }
    }

    /**
     * The order the shop-match check refuses: 29.00 of shipping with no rate row and 7.00 of tax, where 21% gives
     * 6.09. Unplaced, the shipping tax control resolves the 21%; placed, the 21% recorded on the line at checkout.
     */
    private static function mismatchedOrder(bool $placed)
    {
        $GLOBALS['__twoinc_test_options'][WC_Twoinc_Brand::prefixed_name('shipping_tax_from_shop_rates')] = 'yes';
        $order = self::exampleOrder();
        $meta = [];
        if ($placed) {
            $meta[WC_Twoinc_Brand::meta_key('shipping_tax_rate')] = ['rate' => 0.21, 'name' => 'VAT'];
        } else {
            unset($order->meta[WC_Twoinc_Brand::prefixed_name('order_id')]);
        }
        $order->shipping = new StubShippingItem(29.0, 7.0, [], $meta);
        return $order;
    }

    /** Each path that builds lines, sending the mismatched order through the hook. Returns what was sent, or the refusal. */
    private static function mismatchedRequests(): array
    {
        $meta = [
            'order_reference' => 'ref', 'company_id' => '912345678', 'department' => '', 'project' => '',
            'purchase_order_number' => '', 'invoice_emails' => [], 'payment_reference_message' => '',
            'payment_reference_ocr' => '', 'payment_reference' => '', 'payment_reference_type' => '', 'vendor_name' => '',
        ];
        $send = static function (string $type, string $trigger, array $payload, $order, $refund = null) {
            $gateway = self::recordingGateway();
            $gateway->make_order_request($type, $trigger, '/v1/order', $payload, 'POST', $order, $refund);
            return $gateway->sent[0]['payload'] ?? null;
        };
        return [
            'order_intent' => static function () use ($send) {
                $order = self::mismatchedOrder(false);
                return $send('order_intent', 'checkout', WC_Twoinc_Helper::compose_twoinc_intent($order, []), $order);
            },
            'order_create' => static function () use ($send) {
                $order = self::mismatchedOrder(false);
                return $send('order_create', 'checkout', WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', []), $order);
            },
            'change_hash' => static function () use ($meta) {
                return WC_Twoinc_Helper::hash_order_pair(self::mismatchedOrder(true), $meta);
            },
            'order_update' => static function () use ($send) {
                $order = self::mismatchedOrder(true);
                return $send('order_update', 'admin_edit', WC_Twoinc_Helper::compose_twoinc_edit_order($order, '', '', '', ''), $order);
            },
            'refund' => static function () use ($send) {
                $order = self::mismatchedOrder(true);
                $refund = new StubRefund(['shipping' => [new StubShippingItem(-29.0, -7.0, [], ['_refunded_item_id' => 5])]], []);
                return $send('refund', 'order_refund', WC_Twoinc_Helper::compose_twoinc_refund($refund, 36.0, $order), $order, $refund);
            },
        ];
    }

    private static function outcome(callable $request): string
    {
        try {
            return $request() === null ? 'not sent' : 'sent';
        } catch (Exception $e) {
            return get_class($e) . ': ' . $e->getMessage();
        }
    }

    private static function testTheDefaultHandlerOwnsTheShopMatchCheck(): void
    {
        $refused = 'WC_Twoinc_Shop_Match_Exception: The tax charged on "Carrier" does not match the shop\'s tax rates.';
        $repair = static function ($body) {
            return is_array($body) ? ['repaired' => true] + $body : $body;
        };
        // Charges the shipping line what 21% gives, then opts back in on the payload it returns.
        $retax = static function ($body) {
            foreach ($body['line_items'] as &$line) {
                if ($line['type'] === 'SHIPPING_FEE') {
                    $sign = (float) $line['net_amount'] < 0 ? -1 : 1;
                    $line['tax_amount'] = number_format($sign * 6.09, 2, '.', '');
                    $line['gross_amount'] = number_format($sign * 35.09, 2, '.', '');
                }
            }
            unset($line);
            return WC_Twoinc_Helper::check_shop_match($body);
        };
        // [what is registered beside the default handler, expected outcome, a merchant handler named in the log, description]
        $cases = [
            [[], $refused, null, 'no merchant handler: the default handler refuses, as the builder did'],
            [[['two_order_create', $repair]], $refused, null, 'a legacy create filter is not a merchant handler'],
            [[['twoinc_order_payload', $repair]], $refused, null, 'the payload filter is not a merchant handler'],
            [[['twoinc_order_postprocessing', $repair]], 'sent', 'closure at ', 'a merchant handler: the check stands down'],
            [['fixture' => 'record'], 'sent', 'twoinc_order_postprocessing_fixture', 'a named merchant handler is named'],
            [['fixture' => 'checked'], $refused, null, 'a merchant handler opting back in gets the refusal back, unwrapped'],
            [[['twoinc_order_postprocessing', $retax]], 'sent', 'closure at ', 'a merchant handler that changes the line it opts in on: the check no longer applies to it'],
        ];
        foreach (self::mismatchedRequests() as $type => $request) {
            foreach ($cases as [$registered, $expected, $named, $description]) {
                self::reset();
                if (isset($registered['fixture'])) {
                    self::arm($registered['fixture']);
                } else {
                    foreach ($registered as [$tag, $callback]) {
                        add_filter($tag, $callback, 10, 1);
                    }
                }
                $label = "$type, $description";
                $outcome = self::outcome($request);
                // For the change hash, which sends nothing, 'sent' means the hash was taken.
                TinyAssert::same($expected, $outcome, $label);

                $logs = $GLOBALS['__twoinc_test_logs'];
                $errors = array_values(array_filter($logs, static function ($log) {
                    return $log['level'] === 'error';
                }));
                if ($expected === 'sent') {
                    TinyAssert::same([], $errors, "$label: logged an error");
                } else {
                    TinyAssert::true(strpos($errors[0]['message'] ?? '', 'Declared tax rate does not reconcile with the tax charged on "Carrier"') === 0, "$label: refusal not logged: " . json_encode($logs));
                }
                $delegated = array_values(array_filter($logs, static function ($log) {
                    return $log['level'] === 'info' && strpos($log['message'], 'delegated to the merchant handler') !== false;
                }));
                if ($named === null || $type === 'change_hash') {
                    TinyAssert::same([], $delegated, "$label: delegation logged");
                    continue;
                }
                TinyAssert::same(1, count($delegated), "$label: delegation not logged once: " . json_encode($logs));
                foreach (['twoinc_order_postprocessing', "the $type request", "delegated to the merchant handler $named"] as $needle) {
                    TinyAssert::true(strpos($delegated[0]['message'], $needle) !== false, "$label: the log does not say $needle: {$delegated[0]['message']}");
                }
            }
        }
    }

    public static function namedHandler($payload)
    {
        return $payload;
    }

    private static function testMerchantHandlerDetection(): void
    {
        $detect = new ReflectionMethod(WC_Twoinc_Helper::class, 'merchant_order_postprocessing_handlers');
        $detect->setAccessible(true);
        $own = [WC_Twoinc_Helper::class, 'default_order_postprocessing'];
        $closure = static function ($payload) {
            return $payload;
        };
        $closureName = sprintf('closure at %s:%d', __FILE__, (new ReflectionFunction($closure))->getStartLine());
        // [callbacks added as [callback, priority], callbacks then removed, expected merchant handlers, description]
        $cases = [
            [[], [], [], 'nothing registered at all'],
            [[[$own, PHP_INT_MAX]], [], [], 'the default handler only'],
            [[['WC_Twoinc_Helper::default_order_postprocessing', PHP_INT_MAX]], [], [], 'the default handler registered by its string name'],
            [[[$own, PHP_INT_MAX], [$closure, 10]], [], [$closureName], 'a closure'],
            [[[$own, PHP_INT_MAX], ['twoinc_order_postprocessing_fixture', 20], [[self::class, 'namedHandler'], 5]], [], [self::class . '::namedHandler', 'twoinc_order_postprocessing_fixture'], 'a function and a static method, by priority'],
            [[[$own, PHP_INT_MAX], [$closure, 10]], [[$closure, 10]], [], 'a merchant handler removed again (a deactivated plugin never registers)'],
        ];
        foreach ($cases as [$added, $removed, $expected, $description]) {
            self::reset();
            remove_all_filters('twoinc_order_postprocessing');
            foreach ($added as [$callback, $priority]) {
                add_filter('twoinc_order_postprocessing', $callback, $priority, 2);
            }
            foreach ($removed as [$callback, $priority]) {
                remove_filter('twoinc_order_postprocessing', $callback, $priority);
            }
            TinyAssert::same($expected, $detect->invoke(null), $description);
        }
    }

    private static function testTheShopMatchCheckAppliesToTheLineItWasMadeFor(): void
    {
        $order = self::mismatchedOrder(false);
        $built = WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', []);
        $shipping = count($built['line_items']) - 1;
        $edit = static function (array $changes, ?int $at = null) use ($built, $shipping) {
            $payload = $built;
            $payload['line_items'][$at ?? $shipping] = $changes + $payload['line_items'][$at ?? $shipping];
            return $payload;
        };
        $moved = $built;
        array_unshift($moved['line_items'], array_pop($moved['line_items']));
        // A handler declaring its own split: the shipping line re-split at 21% with gross unchanged.
        $resplit = $edit(['net_amount' => '29.75', 'tax_amount' => '6.25', 'gross_amount' => '36.00', 'tax_rate' => '0.210000']);
        // [payload the helper is given, scope, refused, description]
        $cases = [
            [$built, WC_Twoinc_Helper::SHOP_MATCH_ALL, true, 'the payload as built'],
            [$built, WC_Twoinc_Helper::SHOP_MATCH_PER_LINE, true, 'the payload as built, per-line scope: the untouched mismatching line is refused'],
            [$moved, WC_Twoinc_Helper::SHOP_MATCH_ALL, true, 'the line moved to another position, unchanged'],
            [$edit(['description' => 'edited', 'tax_code' => 'X']), WC_Twoinc_Helper::SHOP_MATCH_ALL, true, 'a field the check does not read changed'],
            [$edit(['tax_amount' => '6.09', 'gross_amount' => '35.09']), WC_Twoinc_Helper::SHOP_MATCH_ALL, false, 'the tax changed'],
            [$edit(['tax_rate' => '0.240000']), WC_Twoinc_Helper::SHOP_MATCH_ALL, false, 'the rate changed'],
            [$resplit, WC_Twoinc_Helper::SHOP_MATCH_PER_LINE, false, 'per-line scope: the line re-split at 21% passes'],
            [$resplit, WC_Twoinc_Helper::SHOP_MATCH_ALL, false, 'all scope: the line re-split at 21% passes'],
            [$edit(['name' => 'Shipping - Other']), WC_Twoinc_Helper::SHOP_MATCH_ALL, false, 'the line renamed'],
            [$edit(['type' => 'SERVICE']), WC_Twoinc_Helper::SHOP_MATCH_ALL, false, 'the line retyped'],
            [['line_items' => []] + $built, WC_Twoinc_Helper::SHOP_MATCH_ALL, false, 'the line removed'],
            [['line_items' => 'x'] + $built, WC_Twoinc_Helper::SHOP_MATCH_ALL, false, 'lines that are not a list'],
            [$edit(['description' => 'edited'], 0), WC_Twoinc_Helper::SHOP_MATCH_PER_LINE, true, 'per-line scope: another line edited, the mismatching line untouched'],
            [$built, 'whole', 'InvalidArgumentException', 'an unknown scope is a code fault'],
        ];
        foreach ($cases as [$payload, $scope, $refused, $description]) {
            try {
                $returned = WC_Twoinc_Helper::check_shop_match($payload, $scope);
                TinyAssert::same(false, $refused, "$description: not refused");
                TinyAssert::same(json_encode($payload), json_encode($returned), "$description: the helper changed the payload");
            } catch (WC_Twoinc_Shop_Match_Exception $e) {
                TinyAssert::same(true, $refused, "$description: refused: " . $e->getMessage());
            } catch (InvalidArgumentException $e) {
                TinyAssert::same('InvalidArgumentException', $refused, "$description: " . $e->getMessage());
            }
        }
    }

    /** Staging refused in the builder, before the deprecated filters ran, so their edits to the line change nothing. */
    private static function testTheDeprecatedFiltersCannotRepairARefusedLine(): void
    {
        $refused = 'WC_Twoinc_Shop_Match_Exception: The tax charged on "Carrier" does not match the shop\'s tax rates.';
        $repairLine = static function (array $line) {
            return ['name' => 'Shipping - Repaired', 'tax_amount' => '6.09', 'gross_amount' => '35.09'] + $line;
        };
        $lastLine = static function (array $body) use ($repairLine) {
            $last = count($body['line_items']) - 1;
            $body['line_items'][$last] = $repairLine($body['line_items'][$last]);
            return $body;
        };
        $filters = [
            'two_order_create' => $lastLine,
            'twoinc_order_payload' => $lastLine,
            'twoinc_payment_terms_line' => static function (array $lines) use ($repairLine) {
                $lines[count($lines) - 1] = $repairLine($lines[count($lines) - 1]);
                return $lines;
            },
        ];
        // [deprecated filter, a merchant handler registered, expected outcome, description]
        $cases = [];
        foreach (array_keys($filters) as $filter) {
            $cases[] = [$filter, false, $refused, "$filter repairing the line, no merchant handler: refused, as staging"];
            $cases[] = [$filter, true, 'sent', "$filter repairing the line, a merchant handler: delegated and sent"];
        }
        foreach ($cases as [$filter, $merchant, $expected, $description]) {
            self::reset();
            add_filter($filter, $filters[$filter], 10, 1);
            if ($merchant) {
                self::arm('record');
            }
            $outcome = self::outcome(self::mismatchedRequests()['order_create']);
            TinyAssert::same($expected, $outcome, $description);
        }
    }

    /** With the check delegated, the rate the line went out at on create is the one every later request takes. */
    private static function testADelegatedLineKeepsItsRateAfterPlacement(): void
    {
        $meta = WC_Twoinc_Brand::meta_key('shipping_tax_rate');
        // [a merchant handler registered, create outcome, rate recorded on the line, description]
        $cases = [
            [true, 'sent', 0.21, 'a merchant handler: the resolved rate is recorded'],
            [false, 'refused', null, 'no merchant handler: refused, and nothing recorded, as staging'],
        ];
        foreach ($cases as [$merchant, $created, $recorded, $description]) {
            self::reset();
            if ($merchant) {
                self::arm('record');
            }
            $order = self::mismatchedOrder(false);
            $gateway = self::recordingGateway();
            try {
                $gateway->make_order_request('order_create', 'checkout', '/v1/order', WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', []), 'POST', $order);
                $outcome = 'sent';
            } catch (WC_Twoinc_Shop_Match_Exception $e) {
                $outcome = 'refused';
            }
            TinyAssert::same($created, $outcome, "$description: create");
            TinyAssert::same($recorded, $order->shipping->meta[$meta]['rate'] ?? null, "$description: rate recorded");
            if (!$merchant) {
                continue;
            }
            $sentShipping = static function (array $payload) {
                $line = end($payload['line_items']);
                return [$line['tax_rate'], $line['tax_amount']];
            };
            TinyAssert::same(['0.210000', '7.00'], $sentShipping($gateway->sent[0]['payload']), "$description: create line");

            $order->meta[WC_Twoinc_Brand::prefixed_name('order_id')] = 'two-1';
            $gateway->make_order_request('order_update', 'admin_edit', '/v1/order/two-1', WC_Twoinc_Helper::compose_twoinc_edit_order($order, '', '', '', ''), 'PUT', $order);
            TinyAssert::same(['0.210000', '7.00'], $sentShipping($gateway->sent[1]['payload']), "$description: update line");

            $refund = new StubRefund(['shipping' => [new StubShippingItem(-29.0, -7.0, [], ['_refunded_item_id' => 5])]], []);
            $gateway->make_order_request('refund', 'order_refund', '/v1/order/two-1/refund', WC_Twoinc_Helper::compose_twoinc_refund($refund, 36.0, $order), 'POST', $order, $refund);
            TinyAssert::same(['0.210000', '-7.00'], $sentShipping($gateway->sent[2]['payload']), "$description: refund line");
        }
    }

    /** A refusal is consumed by the request it was built for, and a request with no body never meets one. */
    private static function testARefusalDoesNotOutliveItsRequest(): void
    {
        // [what runs first on the mismatched order, description]
        $cases = [
            [static function ($order) {
                self::outcome(static function () use ($order) {
                    $gateway = self::recordingGateway();
                    $gateway->make_order_request('order_create', 'checkout', '/v1/order', WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', []), 'POST', $order);
                    return null;
                });
            }, 'after a refused create'],
            [static function ($order) {
                WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', []);
            }, 'after a build that never reached the hook'],
        ];
        foreach ($cases as [$first, $description]) {
            self::reset();
            $order = self::mismatchedOrder(false);
            $first($order);
            $gateway = self::recordingGateway();
            TinyAssert::same('sent', self::outcome(static function () use ($gateway, $order) {
                $gateway->make_order_request('capture', 'status_change', '/v1/order/two-1/fulfillments', [], 'POST', $order);
                return $gateway->sent[0] ?? null;
            }), "$description: a capture");
        }
        self::reset();
        $order = self::mismatchedOrder(false);
        $cases[0][0]($order);
        TinyAssert::same('sent', self::outcome(static function () {
            return WC_Twoinc_Helper::postprocess_order_request(self::examplePayload(), self::context('order_update'));
        }), 'a later request with lines, after the refusal was consumed');
    }

    private static function testAnApiRefusalReachesTheLogAndTheOrderNote(): void
    {
        $intent = new WC_Order();
        // [status, response body, request type, order (null: a saved one), the API's reason as reported, log level, description]
        $cases = [
            [400, '{"error_code":"SCHEMA_ERROR","error_details":"gross_amount does not match the line items"}', 'order_update', null, 'SCHEMA_ERROR; gross_amount does not match the line items', 'error', 'code and details'],
            [400, '{"error_json":[{"loc":["line_items",0,"gross_amount"],"msg":"value is not valid"}]}', 'order_create', null, 'line_items.0.gross_amount: value is not valid', 'error', 'field errors'],
            [502, '<html>Bad gateway</html>', 'refund', null, '<html>Bad gateway</html>', 'error', 'a body that is not JSON'],
            [500, '', 'capture', null, 'no response body', 'error', 'an empty body'],
            [429, '{"error_code":"RATE_LIMITED"}', 'order_intent', $intent, 'RATE_LIMITED', 'warning', 'an intent, which has no order yet'],
        ];
        foreach ($cases as [$status, $body, $type, $order, $reason, $level, $description]) {
            self::reset();
            $order = $order ?? self::exampleOrder();
            $gateway = self::recordingGateway($status, $body);
            $response = $gateway->make_order_request($type, 'test', '/v1/order', self::examplePayload(), 'POST', $order);

            $log = $GLOBALS['__twoinc_test_logs'][0] ?? ['level' => '', 'message' => ''];
            TinyAssert::same($level, $log['level'], "$description: log level");
            TinyAssert::true(strpos($log['message'], $reason) !== false, "$description: the log does not carry the API's reason: {$log['message']}");
            TinyAssert::same($order->get_id() ? true : false, strpos($log['message'], 'for order') !== false, "$description: order named in the log: {$log['message']}");
            // Every caller's order note is built from this message, so the note carries the reason.
            TinyAssert::true(strpos((string) WC_Twoinc_Helper::get_twoinc_error_msg($response), $reason) !== false, "$description: the note text does not carry the API's reason");
            TinyAssert::same([], $order->notes, "$description: the request itself wrote a note");
        }

        // End to end, a refused edit leaves one note, carrying the reason.
        self::reset();
        $order = self::exampleOrder();
        $meta = [
            'order_reference' => 'ref', 'company_id' => '912345678', 'department' => '', 'project' => '',
            'purchase_order_number' => '', 'invoice_emails' => [], 'payment_reference_message' => '',
            'payment_reference_ocr' => '', 'payment_reference' => '', 'payment_reference_type' => '', 'vendor_name' => '',
        ];
        $update = new ReflectionMethod(WC_Twoinc::class, 'update_twoinc_order');
        $update->setAccessible(true);
        $update->invoke(self::recordingGateway(400, $cases[0][1]), $order, $meta);
        TinyAssert::same(1, count($order->notes), 'one note per refusal: ' . json_encode($order->notes));
        TinyAssert::true(strpos($order->notes[0], $cases[0][4]) !== false, "the note does not carry the API's reason: {$order->notes[0]}");
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
    private static function mismatchedFeePayload(): array
    {
        $payload = self::examplePayload();
        $payload['line_items'][] = ['name' => 'Handling', 'net_amount' => '5.00', 'tax_amount' => '1.00', 'gross_amount' => '6.00', 'tax_rate' => '0.250000', 'unit_price' => '5.00', 'type' => 'SERVICE'];
        $payload['tax_subtotals'][] = ['tax_amount' => '1.00', 'tax_rate' => '0.250000', 'taxable_amount' => '5.00'];
        $payload['gross_amount'] = '156.00';
        $payload['net_amount'] = '134.00';
        $payload['tax_amount'] = '22.00';
        return $payload;
    }

    private static function testAChangedPayloadKeepsWhatTheShopDeclaredBeyondItsLines(): void
    {
        // [fixture mode, payload, expected gross, description]
        $cases = [
            ['resplit', self::residualPayload(), '140.00', 'a re-split carrying the gift card over keeps it'],
            ['resplit', self::mismatchedFeePayload(), '156.00', 'a line the subscriber left alone is carried as it was'],
        ];
        foreach ($cases as [$mode, $payload, $expected, $description]) {
            self::reset();
            self::arm($mode);
            $sent = WC_Twoinc_Helper::postprocess_order_request($payload, self::context('order_create'));
            TinyAssert::same($expected, $sent['gross_amount'], $description);
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
            ['twoinc_order_payload', static function ($body) {
                $body['line_items'][1]['tax_amount'] = '7.00';
                $body['line_items'][1]['gross_amount'] = '36.00';
                return $body;
            }, 'order_create', 'the payload filter taxing the shipping line off the shop rate'],
        ];
        foreach ($cases as [$filter, $callback, $type, $description]) {
            self::reset();
            add_filter($filter, $callback, 10, 1);
            $order = self::exampleOrder();
            $body = $type === 'order_update'
                ? WC_Twoinc_Helper::compose_twoinc_edit_order($order, '', '', '', '')
                : WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', []);
            $gateway = self::recordingGateway();
            $gateway->make_order_request($type, 'test', '/v1/order', $body, 'POST', $order);
            TinyAssert::same(json_encode($body), json_encode($gateway->sent[0]['payload'] ?? null), $description);
        }
    }

    private static function testEveryRequestTypeFiresOnce(): void
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
        // [payload in, payload out, description, original (default: the payload out, which carries nothing beyond its lines)]
        $cases = [
            [
                ['gross_amount' => '999.00', 'net_amount' => '133.97', 'tax_amount' => '26.03', 'line_items' => $lines],
                ['gross_amount' => '160.00', 'net_amount' => '133.97', 'tax_amount' => '26.03', 'line_items' => $lines],
                'a total the subscriber edited by hand is overwritten',
            ],
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
                ['gross_amount' => '0', 'net_amount' => '0', 'tax_amount' => '0', 'tax_subtotals' => [], 'line_items' => $lines],
                ['gross_amount' => '160.00', 'net_amount' => '133.97', 'tax_amount' => '26.03', 'tax_subtotals' => [
                    ['tax_amount' => '26.03', 'tax_rate' => '0.210000', 'taxable_amount' => '123.97'],
                    ['tax_amount' => '0.00', 'tax_rate' => '0.000000', 'taxable_amount' => '10.00'],
                ], 'line_items' => $lines],
                'TWO-26117: a rate with lines but no bucket in the original carries no residual',
                ['gross_amount' => '160.00', 'net_amount' => '133.97', 'tax_amount' => '26.03', 'tax_subtotals' => [
                    ['tax_amount' => '26.03', 'tax_rate' => '0.210000', 'taxable_amount' => '123.97'],
                ], 'line_items' => $lines],
            ],
            [
                ['gross_amount' => '0', 'net_amount' => '0', 'tax_amount' => '0', 'tax_subtotals' => [], 'line_items' => [$lines[0], $lines[2]]],
                ['gross_amount' => '131.00', 'net_amount' => '110.00', 'tax_amount' => '21.00', 'tax_subtotals' => [
                    ['tax_amount' => '21.00', 'tax_rate' => '0.210000', 'taxable_amount' => '100.00'],
                    ['tax_amount' => '0.00', 'tax_rate' => '0.000000', 'taxable_amount' => '10.00'],
                ], 'line_items' => [$lines[0], $lines[2]]],
                'TWO-26117: a hook that re-splits a line onto a rate the original declared no bucket for gets that bucket from its lines',
                ['gross_amount' => '131.00', 'net_amount' => '110.00', 'tax_amount' => '21.00', 'tax_subtotals' => [
                    ['tax_amount' => '21.00', 'tax_rate' => '0.210000', 'taxable_amount' => '100.00'],
                ], 'line_items' => [$lines[0], ['net_amount' => '5.00', 'tax_amount' => '0.00', 'gross_amount' => '5.00', 'tax_rate' => '0'], ['net_amount' => '5.00', 'tax_amount' => '0.00', 'gross_amount' => '5.00', 'tax_rate' => '0']]],
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
            TinyAssert::same($out, WC_Twoinc_Helper::recompute_totals_from_lines($in, $case[3] ?? $out), $description);
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
            ['non_array', [], 'the subscriber returns no array'],
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
                        TinyAssert::same($want['refused'] ?? 'sent', $sent['refused'] ?? 'sent', $label);
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
