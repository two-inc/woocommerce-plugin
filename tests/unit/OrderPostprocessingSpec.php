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
        'fallback_shipping_tax_code',
        'contract_version',
        'order_lines',
        'order_refunds',
        'order_tenders',
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
            'testTheDiffLogIsRedactedAndCapped',
            'testTheContextCarriesTheOrderAtTwo',
            'testRefundLinesAreMatchedToTheirOrderLines',
            'testTheFallbackShippingTaxCode',
            'testEachShopRateFallbackIsLogged',
            'testARefusedEditRunsTheHookUnsent',
            'testTheWholeOrderCheck',
            'testTheOrderTenders',
            'testRoundingNeverRefusesAGenuineOrder',
            'testTheIntentSeesTheCartsGiftCards',
            'testADroppedTenderLogsNoLabel',
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
        foreach (['twoinc_order_postprocessing', 'twoinc_order_tenders', 'pwgc_to_order_currency', 'twoinc_order_payload', 'twoinc_payment_terms_line', 'two_order_create', 'two_order_edit'] as $tag) {
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
                        return $this->products ?? [new StubProductLineItem(['name' => 'Widget', 'line_total' => 100.0, 'line_subtotal' => 100.0, 'line_tax' => 21.0, 'taxes' => [1 => 21.0]])];
                    case 'shipping':
                        return $this->products === null ? [5 => $this->get_item(5)] : [];
                    default:
                        return $this->extra_items[$type] ?? [];
                }
            }

            public $extra_items = [];

            /** @var array|null product lines standing in for the Widget, with no shipping */
            public $products = null;

            /** 0 for the unsaved order the intent builds from the cart */
            public $id = 42;

            public function get_id()
            {
                return $this->id;
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

            public $total = 150.0;
            public $total_tax = 21.0;

            public function get_total()
            {
                return $this->total;
            }

            public function get_total_tax()
            {
                return $this->total_tax;
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

            public $tax_code_map = [];

            public function get_option($key, $empty_value = null)
            {
                if ($key === 'tax_code_map') {
                    return $this->tax_code_map;
                }
                return $key === 'api_key' ? 'key' : ($empty_value ?? '');
            }

            public function get_supported_buyer_countries()
            {
                return null;
            }

            /** @var array the GETs, apart from what is sent; each answered with $two_order, or a 404 when null */
            public $reads = [];
            public $two_order = ['id' => 'two-1', 'line_items' => [], 'refunds' => []];

            public function make_request($endpoint, $payload = [], $method = 'POST', $params = [], $api_key_override = null, $timeout = 30)
            {
                if ($method === 'GET') {
                    $this->reads[] = $endpoint;
                    return null === $this->two_order
                        ? ['response' => ['code' => 404], 'body' => '{}']
                        : ['response' => ['code' => 200], 'body' => json_encode($this->two_order)];
                }
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
            ['throws', 'order_intent', self::examplePayload(), 'RuntimeException at tests/unit/fixtures/orderpostprocessing.php:', 'a subscriber that throws: its class and throw site'],
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
            foreach (['TWO_ORDER_POSTPROCESSING_HOOK_FAILED', 'twoinc_order_postprocessing', $type, '(test)', $named] as $needle) {
                TinyAssert::true(strpos($log['message'], $needle) !== false, "$description: the log does not name $needle: {$log['message']}");
            }
            // The subscriber's own message can carry buyer data: never logged or shown (TWO-26309).
            foreach ([$log['message'], $caught->getMessage()] as $text) {
                TinyAssert::same(false, strpos($text, 'fixture subscriber failed'), "$description: the subscriber's message leaked: $text");
            }
            TinyAssert::true(strpos($caught->getMessage(), 'TWO_ORDER_POSTPROCESSING_HOOK_FAILED') !== false, "$description: the note does not carry the code");
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
        // The totals its lines add up to, so only the shipping line's own check refuses it.
        $order->total = 157.0;
        $order->total_tax = 28.0;
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
            // Per line: its new figures no longer add up to the order's totals, which the whole-order check owns.
            return WC_Twoinc_Helper::check_shop_match($body, WC_Twoinc_Helper::SHOP_MATCH_PER_LINE);
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
            [$edit(['tax_amount' => '6.09', 'gross_amount' => '35.09']), WC_Twoinc_Helper::SHOP_MATCH_PER_LINE, false, 'per-line scope: the tax changed'],
            [$edit(['tax_amount' => '6.09', 'gross_amount' => '35.09']), WC_Twoinc_Helper::SHOP_MATCH_ALL, true, 'all scope: the tax changed, so the lines no longer add up to the order'],
            [$edit(['tax_rate' => '0.240000']), WC_Twoinc_Helper::SHOP_MATCH_ALL, false, 'the rate changed'],
            [$resplit, WC_Twoinc_Helper::SHOP_MATCH_PER_LINE, false, 'per-line scope: the line re-split at 21% passes'],
            [$resplit, WC_Twoinc_Helper::SHOP_MATCH_ALL, true, 'all scope: the re-split net and tax no longer match the order\'s'],
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

    private static function testTheDiffLogIsRedactedAndCapped(): void
    {
        $before = self::examplePayload() + ['buyer' => ['email' => 'a@b.example'], 'order_note' => 'note'];
        $long = str_repeat('x', 200);
        $many = $before;
        for ($i = 0; $i < 45; $i++) {
            $many['line_items'][0]['extra' . $i] = (string) $i;
        }
        // [payload after the hook, expected changes, expected entries as [path, before, after], description]
        $cases = [
            [['buyer' => ['email' => 'c@d.example']] + $before, 1, [['/buyer/email', 'redacted', 'redacted']], 'a buyer field is redacted'],
            [['order_note' => null] + $before, 1, [['/order_note', 'redacted', null]], 'a removed value is null, not redacted'],
            [['gross_amount' => '151.00'] + $before, 1, [['/gross_amount', '150.00', '151.00']], 'an amount keeps its values'],
            [array_replace_recursive($before, ['line_items' => [1 => ['name' => $long]]]), 1, [['/line_items/1/name', 'Shipping - Courier', str_repeat('x', 120) . '...']], 'a line keeps its values, cut to 120'],
            [$many, 45, null, 'at most 40 entries, and the change count'],
        ];
        foreach ($cases as [$after, $changes, $entries, $description]) {
            self::reset();
            add_filter('twoinc_order_postprocessing', static function () use ($after) {
                return $after;
            }, 10, 2);
            WC_Twoinc_Helper::postprocess_order_request($before, self::context('order_create'));
            $logs = array_values(array_filter($GLOBALS['__twoinc_test_logs'], static function ($log) {
                return $log['level'] === 'debug';
            }));
            TinyAssert::same(1, count($logs), "$description: one debug line");
            TinyAssert::true(strpos($logs[0]['message'], 'changed the order_create request (test). Diff: ') !== false, "$description: " . $logs[0]['message']);
            $diff = json_decode(substr($logs[0]['message'], strpos($logs[0]['message'], 'Diff: ') + 6), true);
            TinyAssert::same($changes, $diff['changes'] ?? null, "$description: change count");
            TinyAssert::true(strpos($diff['subscribers'][0] ?? '', 'closure at ') === 0, "$description: subscribers named");
            TinyAssert::same(min($changes, 40), count($diff['diff']), "$description: entries");
            if ($entries !== null) {
                TinyAssert::same($entries, array_map(static function ($e) {
                    return [$e['path'], $e['before'], $e['after']];
                }, $diff['diff']), $description);
            }
            TinyAssert::same(false, strpos($logs[0]['message'], 'c@d.example'), "$description: buyer data logged");
        }
    }

    private static function testTheContextCarriesTheOrderAtTwo(): void
    {
        $two = ['id' => 'two-1', 'line_items' => [['id' => 'L1', 'name' => 'Widget', 'gross_amount' => '121.00']], 'refunds' => []];
        $capture = static function () {
            add_filter('twoinc_order_postprocessing', static function ($payload, $context) {
                $GLOBALS['__seen_context'] = [$context['order_lines'], $context['order_refunds']];
                return $payload;
            }, 10, 2);
        };
        // [request type, merchant handler registered, GET answer (null: 404), expected reads, expected [order_lines, order_refunds], description]
        $cases = [
            ['order_update', true, $two, 1, [$two['line_items'], []], 'an update with a merchant handler reads the order first'],
            ['refund', true, $two, 1, [$two['line_items'], []], 'so does a refund'],
            ['order_update', true, null, 1, [null, null], 'a failed read gives null'],
            ['capture', true, $two, 0, [null, null], 'a capture reads nothing'],
            ['order_update', false, $two, 0, null, 'no merchant handler: no read'],
        ];
        foreach ($cases as [$type, $handler, $answer, $reads, $expected, $description]) {
            self::reset();
            $GLOBALS['__seen_context'] = null;
            if ($handler) {
                $capture();
            }
            $gateway = self::recordingGateway();
            $gateway->two_order = $answer;
            $gateway->make_order_request($type, 'test', '/v1/order/two-1', [], 'POST', self::exampleOrder());
            TinyAssert::same($reads, count($gateway->reads), "$description: reads");
            TinyAssert::same($expected, $GLOBALS['__seen_context'], $description);
        }
        unset($GLOBALS['__seen_context']);
    }

    private static function testRefundLinesAreMatchedToTheirOrderLines(): void
    {
        $line = static function (string $id, string $name, string $gross, string $proto = '') {
            return ['id' => $id, 'name' => $name, 'description' => '', 'type' => 'PHYSICAL', 'tax_rate' => '0.25', 'gross_amount' => $gross, 'prototype_id' => $proto];
        };
        $order = [$line('A', 'Widget', '100.00'), $line('B', 'Widget', '100.00'), $line('C', 'Gadget', '50.00')];
        // [refunds as lists of lines, expected prototype_ids per refund, description]
        $cases = [
            [[[$line('r1', 'Gadget', '-50.00')]], [['C']], 'a unique match'],
            [[[$line('r1', 'Widget', '-30.00'), $line('r2', 'Widget', '-60.00')]], [['B', 'A']], 'two matches in one refund go to distinct lines, the largest first'],
            [[[$line('r1', 'Widget', '-80.00', 'A')], [$line('r2', 'Widget', '-50.00')]], [['A'], ['B']], 'a named line counts against what is left'],
            [[[$line('r1', 'Other', '-5.00')]], [['']], 'no match keeps the empty prototype_id'],
        ];
        foreach ($cases as [$refunds, $expected, $description]) {
            $result = WC_Twoinc_Helper::refunds_with_parent_lines(['line_items' => $order, 'refunds' => array_map(static function ($lines) {
                return ['line_items' => $lines];
            }, $refunds)]);
            TinyAssert::same($expected, array_map(static function ($refund) {
                return array_column($refund['line_items'], 'prototype_id');
            }, $result), $description);
        }
    }

    private static function testTheFallbackShippingTaxCode(): void
    {
        $option = WC_Twoinc_Brand::prefixed_name('shipping_tax_from_shop_rates');
        // [control, shop shipping rates found, mapping, expected code, description]
        $cases = [
            ['no', [7 => ['rate' => 0.0, 'shipping' => 'yes']], ['rate:7' => 'ZERO'], null, 'the control off: null'],
            ['yes', [7 => ['rate' => 0.0, 'shipping' => 'yes']], ['rate:7' => 'ZERO'], 'ZERO', 'a 0% shipping rate: its row'],
            ['yes', [1 => ['rate' => 21.0, 'shipping' => 'yes']], ['standard|none' => 'NONE'], null, 'a non-zero rate: no code'],
            ['yes', [], ['standard|none' => 'NONE'], 'NONE', 'no rate: the no-rule row'],
            ['yes', [], [], null, 'nothing mapped: null'],
            ['yes', [], 'garbage', null, 'an unreadable mapping: null'],
        ];
        foreach ($cases as [$control, $rates, $map, $expected, $description]) {
            self::reset();
            $GLOBALS['__twoinc_test_options'][$option] = $control;
            $GLOBALS['__twoinc_test_find_rates'] = ['' => $rates];
            self::useTaxCodeMap($map);
            try {
                TinyAssert::same($expected, self::context('order_create')['fallback_shipping_tax_code'], $description);
            } finally {
                self::useTaxCodeMap(null);
            }
        }
    }

    /** Stands in a gateway whose stored tax code mapping is $map; null removes it. */
    private static function useTaxCodeMap($map): void
    {
        $prop = new ReflectionProperty(WC_Twoinc::class, 'instance');
        $prop->setAccessible(true);
        if ($map === null) {
            $prop->setValue(null, null);
            return;
        }
        $gateway = self::recordingGateway();
        $gateway->tax_code_map = $map;
        $prop->setValue(null, $gateway);
    }

    private static function testEachShopRateFallbackIsLogged(): void
    {
        // [shipping tax control, warnings expected per build, description]
        $cases = [
            ['yes', 1, 'the control supplies the rate: one warning per build'],
            ['no', 0, 'the control off: none'],
        ];
        foreach ($cases as [$control, $expected, $description]) {
            self::reset();
            $GLOBALS['__twoinc_test_options'][WC_Twoinc_Brand::prefixed_name('shipping_tax_from_shop_rates')] = $control;
            $order = self::exampleOrder();
            unset($order->meta[WC_Twoinc_Brand::prefixed_name('order_id')]);
            $order->shipping = new StubShippingItem(29.0, 6.09, []);
            WC_Twoinc_Helper::compose_twoinc_intent($order, []);
            $warnings = array_values(array_filter($GLOBALS['__twoinc_test_logs'], static function ($log) {
                return $log['level'] === 'warning' && strpos($log['message'], 'has no tax rate row; assuming the shop\'s shipping tax class "standard"') !== false;
            }));
            TinyAssert::same($expected, count($warnings), $description . ': ' . json_encode($GLOBALS['__twoinc_test_logs']));
            if ($expected) {
                TinyAssert::true(strpos($warnings[0]['message'], 'rate=21%') !== false, "$description: names the rate");
            }
        }
    }

    private static function testARefusedEditRunsTheHookUnsent(): void
    {
        $meta = [
            'order_reference' => 'ref', 'company_id' => '912345678', 'department' => '', 'project' => '',
            'purchase_order_number' => '', 'invoice_emails' => [], 'payment_reference_message' => '',
            'payment_reference_ocr' => '', 'payment_reference' => '', 'payment_reference_type' => '', 'vendor_name' => '',
        ];
        // [order state, trigger, expected hook calls as [type, trigger], description]
        $cases = [
            ['CANCELLED', 'admin_edit', [['order_update', 'admin_edit']], 'a refused admin edit is built and the hook runs'],
            ['CANCELLED', 'tracking_number', [], 'a refused tracking sync builds nothing'],
            ['VERIFIED', 'admin_edit', [['order_update', 'admin_edit']], 'an edit Two accepts runs it once, as before'],
        ];
        foreach ($cases as [$state, $trigger, $expected, $description]) {
            self::reset();
            self::arm('record');
            $gateway = self::recordingGateway();
            $order = self::exampleOrder();
            $order->meta[WC_Twoinc_Brand::meta_key('order_state')] = $state;
            $update = new ReflectionMethod(WC_Twoinc::class, 'process_update_twoinc_order');
            $update->setAccessible(true);
            $update->invoke($gateway, $order, $meta, false, $trigger);
            TinyAssert::same($expected, array_map(static function ($c) {
                return [$c['request_type'], $c['trigger']];
            }, self::fixtureCalls()), $description);
            $sent = array_column($gateway->sent, 'endpoint');
            TinyAssert::same($state === 'VERIFIED' ? ['/v1/order/two-1'] : [], $sent, "$description: sent");
            TinyAssert::same($expected === [] ? [] : ['/v1/order/two-1'], $gateway->reads, "$description: the order is read for order_lines");
        }
    }

    private static function testTheOrderTenders(): void
    {
        $card = ['type' => 'gift_card', 'label' => 'Gift card', 'amount' => '10.00', 'source' => 'gift_card'];
        // [order items by type, tenders the filter adds, expected order_tenders, description]
        $cases = [
            [[], [], [], 'no tender'],
            [['gift_card' => [10.0]], [], [$card], 'a gift card item'],
            [['pw_gift_card' => [5.0]], [], [array_replace($card, ['source' => 'pw_gift_card', 'amount' => '10.00'])], 'the other item type, converted to the order currency'],
            [[], [['type' => 'loyalty', 'label' => 7, 'amount' => 3.456]], [['type' => 'other', 'label' => '7', 'amount' => '3.46', 'source' => 'twoinc_order_tenders']], 'a declared tender, normalised'],
            [[], ['x', ['amount' => '0']], [], 'entries that are not tenders are dropped'],
        ];
        foreach ($cases as [$items, $declared, $expected, $description]) {
            self::reset();
            // A currency filter that doubles, so the conversion shows.
            add_filter('pwgc_to_order_currency', static function ($amount) {
                return $amount * 2;
            }, 10, 2);
            add_filter('twoinc_order_tenders', static function ($tenders) use ($declared) {
                return array_merge($tenders, $declared);
            }, 10, 2);
            $order = self::exampleOrder();
            foreach ($items as $type => $amounts) {
                $order->extra_items[$type] = array_map(static function ($amount) {
                    return new StubTenderItem($amount);
                }, $amounts);
            }
            TinyAssert::same($expected, self::context('order_update', $order)['order_tenders'], $description);
        }

        // recompute_totals_from_lines() takes the tenders off gross and net, whatever the original carries.
        $lines = [['net_amount' => '100.00', 'tax_amount' => '21.00', 'gross_amount' => '121.00', 'tax_rate' => '0.21']];
        $outstanding = ['gross_amount' => '111.00', 'net_amount' => '90.00', 'tax_amount' => '21.00', 'line_items' => $lines];
        // [original, tenders, expected totals, description]
        $recompute = [
            [$outstanding, [$card], ['111.00', '90.00', '21.00'], 'an original that carries the tender: unchanged'],
            [['line_items' => $lines], [$card], ['111.00', '90.00', '21.00'], 'an original with no totals: the tender is still taken off'],
            [['line_items' => $lines], [], ['121.00', '100.00', '21.00'], 'no tenders: the lines'],
        ];
        foreach ($recompute as [$original, $tenders, $expected, $description]) {
            $out = WC_Twoinc_Helper::recompute_totals_from_lines(['gross_amount' => '0', 'net_amount' => '0', 'tax_amount' => '0', 'line_items' => $lines], $original, $tenders);
            TinyAssert::same($expected, [$out['gross_amount'], $out['net_amount'], $out['tax_amount']], $description);
        }
    }

    /**
     * Each line is rounded to the shop's price decimals on its own, so a many-line order's lines can sum a little away
     * from its total: with taxes rounded at subtotal, or prices with no decimals. That is never a refusal; a real gap
     * still is. 20 lines, each as WooCommerce stores it, and the order totals WooCommerce rounds from them.
     */
    private static function testRoundingNeverRefusesAGenuineOrder(): void
    {
        // [price decimals, line net, line tax, order total, order tax, expected outcome, description]
        $cases = [
            [2, 0.83, 0.17, 20.00, 3.40, 'sent', '2 decimals, tax rounded per line'],
            [2, 0.83, 0.166, 19.92, 3.32, 'sent', '2 decimals, tax rounded at subtotal: the lines carry 0.08 more'],
            [2, 0.83, 0.166, 18.92, 3.32, 'refused', '2 decimals, a 1.00 gap is still refused'],
            [0, 100.4, 20.0, 2408.0, 400.0, 'sent', '0 decimals, tax rounded per line'],
            [0, 100.4, 20.08, 2410.0, 402.0, 'sent', '0 decimals, tax rounded at subtotal'],
            [0, 100.4, 20.08, 2390.0, 402.0, 'refused', '0 decimals, a 20 gap is still refused'],
        ];
        foreach ($cases as [$decimals, $net, $tax, $total, $total_tax, $expected, $description]) {
            self::reset();
            $GLOBALS['__twoinc_test_price_decimals'] = $decimals;
            try {
                $order = self::exampleOrder();
                $order->products = [];
                for ($i = 0; $i < 20; $i++) {
                    $order->products[] = new StubProductLineItem(['name' => "Item $i", 'line_total' => $net, 'line_subtotal' => $net, 'line_tax' => $tax, 'taxes' => [1 => $tax]]);
                }
                $order->total = $total;
                $order->total_tax = $total_tax;
                try {
                    self::recordingGateway()->make_order_request('order_create', 'checkout', '/v1/order', WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', []), 'POST', $order);
                    $outcome = 'sent';
                } catch (WC_Twoinc_Shop_Match_Exception $e) {
                    $outcome = 'refused';
                }
                TinyAssert::same($expected, $outcome, $description);
            } finally {
                unset($GLOBALS['__twoinc_test_price_decimals']);
            }
        }
    }

    /**
     * At the intent the cart total already has the gift cards off, but the unsaved order built from the cart has no
     * gift card items yet: they are read from the session the gift card plugins keep them in, as each plugin does
     * when it adds the items to the order.
     */
    private static function testTheIntentSeesTheCartsGiftCards(): void
    {
        // [session key, session value, unsaved order, expected order_tenders amounts, warning logged, description]
        $cases = [
            [null, null, true, [], true, 'no gift card in the session: the gap is a warning'],
            ['_wc_gc_giftcards', [['giftcard' => 'card', 'amount' => 6.0], ['giftcard' => 'card', 'amount' => 4.0]], true, ['6.00', '4.00'], false, 'gift cards applied in the cart'],
            ['pw-gift-card-data', ['gift_cards' => ['SECRET-1' => 10.0]], true, ['10.00'], false, 'the other plugin\'s cart gift cards'],
            ['pw-gift-card-data', ['gift_cards' => ['SECRET-1' => 0]], true, [], true, 'a card worth nothing in the cart is no tender'],
            ['_wc_gc_giftcards', [['giftcard' => 'card', 'amount' => 10.0]], false, [], false, 'a placed order reads its items, not the session'],
        ];
        foreach ($cases as [$key, $value, $unsaved, $amounts, $warned, $description]) {
            self::reset();
            WC()->session = new StubSession();
            if ($key !== null) {
                WC()->session->set($key, $value);
            }
            $order = self::exampleOrder();
            $order->total = 140.0;
            if ($unsaved) {
                $order->id = 0;
                unset($order->meta[WC_Twoinc_Brand::prefixed_name('order_id')]);
            }
            TinyAssert::same($amounts, array_column(WC_Twoinc_Helper::order_tenders($order), 'amount'), "$description: tenders");
            if (!$unsaved) {
                continue;
            }
            self::recordingGateway()->make_order_request('order_intent', 'checkout', '/v1/order_intent', WC_Twoinc_Helper::compose_twoinc_intent($order, []), 'POST', $order);
            $warnings = array_filter($GLOBALS['__twoinc_test_logs'], static function ($log) {
                return $log['level'] === 'warning' && strpos($log['message'], 'twoinc_order_tenders') !== false;
            });
            TinyAssert::same($warned, $warnings !== [], "$description: warning");
            TinyAssert::same(false, strpos(json_encode($GLOBALS['__twoinc_test_logs']), 'SECRET-1'), "$description: the card number was logged");
        }
    }

    /** A label may hold a card number: a dropped entry logs only its type, source and amount, and a zero is quiet. */
    private static function testADroppedTenderLogsNoLabel(): void
    {
        // [entry the filter adds, expected warnings, description]
        $cases = [
            [['type' => 'gift_card', 'label' => 'CARD-123', 'amount' => '-5', 'source' => 'test'], ['type gift_card, source test, amount -5'], 'a negative amount is logged without its label'],
            [['type' => 'gift_card', 'label' => 'CARD-123', 'amount' => 'x', 'source' => 'test'], ['type gift_card, source test, amount x'], 'a non-numeric amount too'],
            [['type' => 'gift_card', 'label' => 'CARD-123', 'amount' => '0.00', 'source' => 'test'], [], 'a zero amount is skipped quietly'],
            ['CARD-123', ['type none, source none, amount none'], 'an entry that is not an array'],
        ];
        foreach ($cases as [$entry, $expected, $description]) {
            self::reset();
            add_filter('twoinc_order_tenders', static function ($tenders) use ($entry) {
                $tenders[] = $entry;
                return $tenders;
            }, 10, 2);
            TinyAssert::same([], WC_Twoinc_Helper::order_tenders(self::exampleOrder()), "$description: dropped");
            $warnings = array_values(array_map(static function ($log) {
                return substr($log['message'], strpos($log['message'], 'dropped: ') + 9);
            }, array_filter($GLOBALS['__twoinc_test_logs'], static function ($log) {
                return $log['level'] === 'warning';
            })));
            TinyAssert::same($expected, $warnings, $description);
            TinyAssert::same(false, strpos(json_encode($GLOBALS['__twoinc_test_logs']), 'CARD-123'), "$description: the label was logged");
        }
    }

    private static function testTheWholeOrderCheck(): void
    {
        // The order's lines come to 150.00 gross, 21.00 tax. A tender is a payment: the order total drops by it, its tax
        // does not. [request type, order gross, gift card item, tenders the filter adds, merchant handler, expected
        // outcome, warning logged, description]
        $cases = [
            ['order_create', 150.0, null, [], false, 'sent', false, 'lines that add up are sent'],
            ['order_create', 140.0, null, [], false, 'refused', false, 'a create whose lines do not add up is refused'],
            ['order_update', 140.0, null, [], false, 'refused', false, 'so is an update'],
            ['order_intent', 140.0, null, [], false, 'sent', true, 'the intent only logs it'],
            ['order_create', 140.0, null, [], true, 'sent', false, 'a merchant handler owns it'],
            ['order_create', 150.01, null, [], false, 'sent', false, 'within 0.02'],
            ['order_create', 140.0, ['gift_card', 10.0], [], false, 'sent', false, 'a gift card item explains the gap'],
            ['order_update', 130.0, ['pw_gift_card', 20.0], [], false, 'sent', false, 'so does the other gift card item type'],
            ['order_create', 140.0, null, [['type' => 'store_credit', 'label' => 'Credit', 'amount' => '10.00', 'source' => 'test']], false, 'sent', false, 'a tender the filter declares explains the gap'],
            ['order_create', 135.0, ['gift_card', 10.0], [], false, 'refused', false, 'a gap the tenders leave is refused'],
            ['order_create', 140.0, null, [['type' => 'store_credit', 'amount' => '-10.00']], false, 'refused', false, 'an entry with no positive amount is not a tender'],
        ];
        foreach ($cases as [$type, $gross, $item, $declared, $handler, $expected, $warned, $description]) {
            self::reset();
            if ($handler) {
                self::arm('record');
            }
            add_filter('twoinc_order_tenders', static function ($tenders) use ($declared) {
                return array_merge($tenders, $declared);
            }, 10, 2);
            $order = self::exampleOrder();
            $order->total = $gross;
            if ($item) {
                $order->extra_items[$item[0]] = [new StubTenderItem($item[1])];
            }
            $build = [
                'order_create' => static function () use ($order) {
                    return WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', []);
                },
                'order_update' => static function () use ($order) {
                    return WC_Twoinc_Helper::compose_twoinc_edit_order($order, '', '', '', '');
                },
                'order_intent' => static function () use ($order) {
                    return WC_Twoinc_Helper::compose_twoinc_intent($order, []);
                },
            ][$type];
            $gateway = self::recordingGateway();
            try {
                $gateway->make_order_request($type, 'checkout', '/v1/order', $build(), 'POST', $order);
                $outcome = $gateway->sent ? 'sent' : 'not sent';
            } catch (WC_Twoinc_Shop_Match_Exception $e) {
                $outcome = 'refused';
                TinyAssert::same('The order lines do not add up to the order total.', $e->getMessage(), $description);
            }
            TinyAssert::same($expected, $outcome, $description);
            $warnings = array_filter($GLOBALS['__twoinc_test_logs'], static function ($log) {
                return $log['level'] === 'warning' && strpos($log['message'], 'do not add up to the order totals plus tenders of 0.00: gross order 140.00 vs order lines 150.00') !== false;
            });
            TinyAssert::same($warned, $warnings !== [], "$description: warning");
        }
    }
}

/** An order item a gift card plugin records a redemption as. */
final class StubTenderItem
{
    private $amount;

    public function __construct(float $amount)
    {
        $this->amount = $amount;
    }

    public function get_amount()
    {
        return $this->amount;
    }
}
