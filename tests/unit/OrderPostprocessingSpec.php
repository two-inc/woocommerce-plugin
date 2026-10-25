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
            'testABodylessRequestIsSentEmptyWhateverTheSubscriberDoes',
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
            'testEveryWriteSendsItsIdempotencyKey',
            'testARetryReusesItsKeyAndAnotherOperationDoesNot',
            'testAnEditSequenceNeverRepeatsAKey',
            'testAnEditWithAnUnknownOutcomeNeverHidesTheNextOne',
            'testEveryOrderWriteLogsItsKeyWhateverTheOutcome',
            'testOnlyWritesCarryAKeyAndEveryWriteDoes',
            'testEveryWriteCallSitePassesItsOwnKey',
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
            'testTendersAreReadOncePerRequest',
            'testABuildsCheckNeverReachesAnotherOrder',
            'testEveryPayloadMeetsTheOrderAmountRules',
            'testARefundsPrepaidPartIsWhatTheTendersHaveLeft',
            'testTheExtraLineExampleSeesACostBeyondTheLinesBesideAGiftCard',
            'testAnOrderPlacedWithoutPrepaidIsSentAsBefore',
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

            public $refund_id = 99;

            public function get_id()
            {
                return $this->refund_id;
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

            /** @var array options read before the defaults below */
            public $options = [];

            public function get_option($key, $empty_value = null)
            {
                if (array_key_exists($key, $this->options)) {
                    return $this->options[$key];
                }
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

            public function make_request($endpoint, $payload = [], $method = 'POST', $params = [], $api_key_override = null, $timeout = 30, $idempotency_key = null)
            {
                if ($method === 'GET') {
                    $this->reads[] = $endpoint;
                    return null === $this->two_order
                        ? ['response' => ['code' => 404], 'body' => '{}']
                        : ['response' => ['code' => 200], 'body' => json_encode($this->two_order)];
                }
                $status = array_shift($this->statuses) ?? $this->status;
                $reply = $status === 0 ? new WP_Error('http_request_failed', 'Operation timed out') : [
                    'response' => ['code' => $status],
                    'body' => $this->body ?? '{"id":"two-1","status":"APPROVED","state":"VERIFIED","approved":true,"amount":"-29.00","gross_amount":"150.00","payment_url":"https://pay.example/1","merchant_urls":{"merchant_confirmation_url":"https://shop.example/thanks"}}',
                    'headers' => [],
                ];
                $sent = ['endpoint' => $endpoint, 'method' => $method, 'payload' => $payload, 'idempotency_key' => $idempotency_key];
                if ($this->wire) {
                    $GLOBALS['__twoinc_test_http_calls'] = [];
                    $GLOBALS['__twoinc_test_http_response'] = $reply;
                    parent::make_request($endpoint, $payload, $method, $params, $api_key_override, $timeout, $idempotency_key);
                    unset($GLOBALS['__twoinc_test_http_response']);
                    $sent['headers'] = $GLOBALS['__twoinc_test_http_calls'][0]['args']['headers'];
                }
                $this->sent[] = $sent;
                return $reply;
            }

            /** @var bool whether a write also goes through the real make_request(), recording the headers sent */
            public $wire = false;

            /** @var int[] statuses the next writes answer with, in turn, before $status; 0 is no response */
            public $statuses = [];
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

    private static function testABodylessRequestIsSentEmptyWhateverTheSubscriberDoes(): void
    {
        // [fixture mode, what the log names, what it must never carry, description]
        $modes = [
            ['body', ['TWO_ORDER_POSTPROCESSING_BODY_NOT_ACCEPTED', '"/note"', 'twoinc_order_postprocessing_fixture'], 'added', 'a returned body'],
            ['throws', ['TWO_ORDER_POSTPROCESSING_HOOK_FAILED', 'RuntimeException at tests/unit/fixtures/orderpostprocessing.php:'], 'fixture subscriber failed', 'a subscriber that throws'],
            ['non_array', ['TWO_ORDER_POSTPROCESSING_HOOK_FAILED', 'returned NULL, not an array'], 'fixture subscriber failed', 'a subscriber that returns no array'],
        ];
        foreach (['order_confirm', 'cancel'] as $type) {
            foreach ($modes as [$mode, $named, $secret, $what]) {
                $description = "$type, $what";
                self::reset();
                self::arm($mode);
                $gateway = self::recordingGateway();
                $gateway->make_order_request($type, 'test', '/v1/order', [], 'POST', self::exampleOrder());

                TinyAssert::same([[]], array_column($gateway->sent, 'payload'), "$description: not sent once with no body");
                TinyAssert::same([[], $type], [self::fixtureCalls()[0]['payload'] ?? null, self::fixtureCalls()[0]['request_type'] ?? null], "$description: the hook did not see an empty payload");
                $logs = array_values(array_filter($GLOBALS['__twoinc_test_logs'], static function ($log) {
                    return $log['level'] !== 'info';
                }));
                TinyAssert::same(['error'], array_column($logs, 'level'), "$description: not logged once at error level");
                foreach (array_merge($named, ['twoinc_order_postprocessing', $type, '(test)', 'sent with no body']) as $needle) {
                    TinyAssert::true(strpos($logs[0]['message'], $needle) !== false, "$description: the log does not name $needle: {$logs[0]['message']}");
                }
                TinyAssert::same(false, strpos($logs[0]['message'], $secret), "$description: the log carries a value or message: {$logs[0]['message']}");
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

    /**
     * Drives each order request through the code path that sends it.
     *
     * @return array [driver(gateway, order), request type, trigger, endpoint, description]
     */
    private static function orderRequestPaths(): array
    {
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
        return [
            [static function ($gateway) {
                WC()->session = new StubSession();
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
        $paths = self::orderRequestPaths();
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
            // A request with no body is sent whatever its subscriber does (TWO-26340).
            $bodyless = in_array($type, ['order_confirm', 'cancel'], true);
            TinyAssert::same($bodyless, in_array($endpoint, array_column($sent, 'endpoint'), true), "$description: sent or held back wrongly when its subscriber threw");
        }
    }

    /** The Idempotency-Key a hash-suffixed key ends in, computed here independently of the plugin's helper. */
    private static function keyHash($value): string
    {
        return substr(hash('sha256', is_string($value) ? $value : json_encode($value)), 0, 16);
    }

    /** Write drivers beyond the order requests: the surcharge quote, the merchant fee rates and the token mints. */
    private static function otherWriteDrivers(): array
    {
        return [
            'fee quote' => static function ($gateway) {
                $gateway->options = ['surcharge_type' => 'percentage', 'surcharge_grid' => [30 => ['percentage' => 2.0]]];
                WC_Twoinc_Payment_Terms::reset_fee_cache();
                WC_Twoinc_Payment_Terms::fetch_term_fee($gateway, 30, 150.0, 'NO');
            },
            'merchant rates' => static function ($gateway) {
                WC_Twoinc_Payment_Terms::fetch_merchant_rates($gateway, [30, 60], 'NO');
            },
            'token mint' => static function ($gateway) {
                WC()->session = new StubSession();
                WC_Twoinc_Sole_Trader::mint_tokens($gateway);
            },
        ];
    }

    /** Runs $drivers in turn against one gateway and order, returning the writes sent to $endpoint (null: every write). */
    private static function writesTo(?string $endpoint, callable ...$drivers): array
    {
        $gateway = self::recordingGateway();
        $gateway->wire = true;
        $order = self::exampleOrder();
        $order->refunds = [self::shippingRefund()];
        foreach ($drivers as $drive) {
            $drive($gateway, $order);
        }
        return array_values(array_filter($gateway->sent, static function ($sent) use ($endpoint) {
            return $endpoint === null || $sent['endpoint'] === $endpoint;
        }));
    }

    private static function testEveryWriteSendsItsIdempotencyKey(): void
    {
        $paths = [];
        foreach (self::orderRequestPaths() as [$drive, , , $endpoint, $description]) {
            $paths[$description] = [$drive, $endpoint];
        }
        $other = self::otherWriteDrivers();
        $reference = WC_Twoinc_Brand::meta_key('order_reference');
        // [driver, endpoint, expected key given (sent payload, order), description]
        $cases = [
            [...$paths['intent'], fn ($p) => 'intent_' . self::keyHash(['session-a', $p]), 'order intent: the shopper\'s session and a hash of what it sends'],
            // The fixture's 'ref' is replaced by the reference the attempt mints.
            [...$paths['create'], fn ($p, $o) => $o->meta[$reference] === 'ref' ? 'no fresh reference' : 'create_42_' . self::keyHash($o->meta[$reference]), 'order create: the checkout attempt\'s order reference, hashed'],
            [...$paths['update'], fn ($p) => 'edit_two-1_' . self::keyHash(['create_42_' . self::keyHash('ref'), $p]), 'order edit: the Two order, chained on the create key before any edit is accepted'],
            [...$paths['confirm'], fn () => 'confirm_two-1', 'confirm'],
            [...$paths['capture'], fn () => 'fulfil_two-1', 'whole-order fulfil'],
            [...$paths['refund'], fn () => 'refund_two-1_99', 'refund: the Two order and the refund record'],
            [...$paths['cancel'], fn () => 'cancel_two-1', 'cancel'],
            [$other['fee quote'], '/v1/pricing/order/fee', fn ($p) => 'fee_quote_' . self::keyHash($p), 'surcharge fee quote'],
            [$other['merchant rates'], '/pricing/v1/merchant/rates', fn ($p) => 'merchant_rates_' . self::keyHash($p), 'merchant fee rates'],
            [$other['token mint'], '/registry/v1/delegation', fn ($p) => 'registry_delegation_' . self::keyHash(['session-a', $p]), 'sole-trader registry token: the shopper\'s session and the payload'],
            [$other['token mint'], '/autofill/v1/delegation', fn ($p) => 'autofill_delegation_' . self::keyHash(['session-a', $p]), 'sole-trader autofill token: the shopper\'s session and the payload'],
        ];
        foreach ($cases as [$drive, $endpoint, $expected, $description]) {
            self::reset();
            $GLOBALS['__twoinc_test_session_customer'] = 'session-a';
            $sent = self::writesTo($endpoint, $drive);
            TinyAssert::same(1, count($sent), "$description: sent once");
            $key = $expected($sent[0]['payload'], $GLOBALS['__twoinc_test_wc_orders'][42]);
            TinyAssert::same($key, $sent[0]['idempotency_key'], "$description: key");
            TinyAssert::same($key, $sent[0]['headers']['Idempotency-Key'] ?? null, "$description: header");
            TinyAssert::true(strlen($key) <= 100 && preg_match('/^[a-z0-9_-]+$/D', $key) === 1, "$description: not a lowercase ASCII key of at most 100 characters: $key");
        }
        // With no session id nothing tells buyers apart, so no mint is sent under a key they would share.
        foreach (['/registry/v1/delegation', '/autofill/v1/delegation'] as $endpoint) {
            self::reset();
            $GLOBALS['__twoinc_test_session_customer'] = '';
            TinyAssert::same([], self::writesTo($endpoint, $other['token mint']), "$endpoint: minted with no shopper session");
        }
        // An intent with no session is still asked, with no key rather than one buyers would share.
        self::reset();
        $GLOBALS['__twoinc_test_session_customer'] = '';
        $sent = self::writesTo('/v1/order_intent', $paths['intent'][0]);
        TinyAssert::same(1, count($sent), 'an intent with no shopper session is still sent');
        TinyAssert::same([null, false], [$sent[0]['idempotency_key'], array_key_exists('Idempotency-Key', $sent[0]['headers'])], 'an intent with no shopper session carries no key');
        unset($GLOBALS['__twoinc_test_session_customer']);
    }

    private static function testARetryReusesItsKeyAndAnotherOperationDoesNot(): void
    {
        $paths = [];
        foreach (self::orderRequestPaths() as [$drive, , , , $description]) {
            $paths[$description] = $drive;
        }
        $other = self::otherWriteDrivers();
        $create = static function (string $company) {
            return static function ($gateway) use ($company) {
                WC()->session = new StubSession();
                WC()->cart = new StubCart(150.0, 21.0, false);
                $_POST = ['company_id' => $company, 'company_name' => 'Buyer AS'];
                $gateway->process_payment(42);
            };
        };
        $resend = static function (string $type, string $endpoint, string $method, array $payload = []) {
            return static function ($gateway, $order) use ($type, $endpoint, $method, $payload) {
                $gateway->make_order_request($type, 'test', $endpoint, $payload, $method, $order);
            };
        };
        $refund = static function (int $id) {
            return static function ($gateway, $order) use ($id) {
                $refund = self::shippingRefund();
                $refund->refund_id = $id;
                $gateway->make_order_request('refund', 'order_refund', '/v1/order/two-1/refund', ['amount' => '29.00'], 'POST', $order, $refund);
            };
        };
        $session = static function (string $id) use ($other) {
            return static function ($gateway) use ($id, $other) {
                $GLOBALS['__twoinc_test_session_customer'] = $id;
                $other['token mint']($gateway);
            };
        };
        $intent = static function (string $country, string $shopper = 'session-a') {
            return static function ($gateway) use ($country, $shopper) {
                $GLOBALS['__twoinc_test_session_customer'] = $shopper;
                WC()->session = new StubSession();
                WC()->cart = new StubIntentCart();
                self::driveIntent($gateway, ['intent' => json_encode(['buyer' => ['company' => ['country_prefix' => $country, 'organization_number' => $country . '1']]])]);
            };
        };
        // The first send gets no answer, so nothing is accepted or recorded.
        $unanswered = static function (callable $drive) {
            return static function ($gateway, $order) use ($drive) {
                $gateway->statuses = [0];
                $drive($gateway, $order);
            };
        };
        // The same event again, as when the first send got no answer and so recorded no new state.
        $retry = static function (callable $drive) {
            return static function ($gateway, $order) use ($drive) {
                unset($order->meta[WC_Twoinc_Brand::meta_key('order_state')], $order->meta[WC_Twoinc_Brand::meta_key('req_body_hash')]);
                $drive($gateway, $order);
            };
        };
        // [first, second, endpoint (null: every write), whether they share a key, description]
        $cases = [
            [$paths['capture'], $retry($paths['capture']), '/v1/order/two-1/fulfillments', true, 'a completion event retried resends the same fulfil'],
            [$paths['cancel'], $retry($paths['cancel']), '/v1/order/two-1/cancel', true, 'a cancellation retried resends the same cancel'],
            // One gateway answers one redirect, so the reload is the confirm sent again.
            [$paths['confirm'], $resend('order_confirm', '/v1/order/two-1/confirm', 'POST'), '/v1/order/two-1/confirm', true, 'a reloaded confirmation redirect resends the same confirm'],
            [$paths['refund'], $retry($paths['refund']), '/v1/order/two-1/refund', true, 'a retried refund of the same refund record'],
            [$unanswered($paths['update']), $retry($paths['update']), '/v1/order/two-1', true, 'an edit retried after no answer, nothing accepted since'],
            [$paths['update'], $retry($paths['update']), '/v1/order/two-1', false, 'the same edit again after Two accepted it chains on that edit'],
            [$create('912345678'), $resend('order_create', '/v1/order', 'POST'), '/v1/order', true, 'a network retry of the same checkout attempt'],
            [$intent('NO'), $intent('NO'), '/v1/order_intent', true, 'the same intent asked again'],
            [$other['fee quote'], $other['fee quote'], '/v1/pricing/order/fee', true, 'the same fee quote asked again'],
            [$session('session-a'), $session('session-a'), '/autofill/v1/delegation', true, 'a mint retried in the same session'],
            [$create('912345678'), $create('987654321'), '/v1/order', false, 'a new checkout attempt with another buyer company'],
            [$create('912345678'), $create('912345678'), '/v1/order', false, 'a new checkout attempt with the same cart and company'],
            [$refund(99), $refund(100), '/v1/order/two-1/refund', false, 'a second refund record on the same order'],
            [$paths['update'], $resend('order_update', '/v1/order/two-1', 'PUT', ['purchase_order_number' => 'PO-2']), '/v1/order/two-1', false, 'an edit that changes the order'],
            [$intent('NO'), $intent('SE'), '/v1/order_intent', false, 'an intent for another buyer'],
            [$intent('NO'), $intent('NO', 'session-b'), '/v1/order_intent', false, 'the same intent from another shopper'],
            [$session('session-a'), $session('session-b'), '/autofill/v1/delegation', false, 'another shopper\'s mint'],
            [$paths['capture'], $paths['cancel'], null, false, 'two operations on one Two order'],
        ];
        foreach ($cases as [$first, $second, $endpoint, $same, $description]) {
            self::reset();
            $GLOBALS['__twoinc_test_session_customer'] = 'session-a';
            $sent = self::writesTo($endpoint, $first, $second);
            TinyAssert::same(2, count($sent), "$description: both sent");
            TinyAssert::same($same, $sent[0]['headers']['Idempotency-Key'] === $sent[1]['headers']['Idempotency-Key'], "$description: {$sent[0]['headers']['Idempotency-Key']} against {$sent[1]['headers']['Idempotency-Key']}");
        }
        unset($GLOBALS['__twoinc_test_session_customer']);
    }

    private static function testAnEditSequenceNeverRepeatsAKey(): void
    {
        $update = new ReflectionMethod(WC_Twoinc::class, 'update_twoinc_order');
        $update->setAccessible(true);
        $edit = static function (string $po) use ($update) {
            return static function ($gateway, $order) use ($update, $po) {
                $update->invoke($gateway, $order, [
                    'order_reference' => 'ref', 'company_id' => '912345678', 'department' => '', 'project' => '',
                    'purchase_order_number' => $po, 'invoice_emails' => [], 'payment_reference_message' => '',
                    'payment_reference_ocr' => '', 'payment_reference' => '', 'payment_reference_type' => '', 'vendor_name' => '',
                ]);
            };
        };
        self::reset();
        $sent = self::writesTo('/v1/order/two-1', $edit('A'), $edit('B'), $edit('A'), $edit('B'));
        $keys = array_column(array_column($sent, 'headers'), 'Idempotency-Key');
        TinyAssert::same(4, count(array_unique($keys)), 'A, B, A, B must send four keys: ' . json_encode($keys));
        TinyAssert::same(json_encode($sent[0]['payload']), json_encode($sent[2]['payload']), 'the first and third edits send the same payload');
        TinyAssert::same($keys[3], $GLOBALS['__twoinc_test_wc_orders'][42]->meta[WC_Twoinc_Brand::meta_key(WC_Twoinc::LAST_EDIT_KEY_META)] ?? null, 'the last accepted edit\'s key is stored on the order');
        TinyAssert::same('edit_two-1_' . self::keyHash([$keys[0], $sent[1]['payload']]), $keys[1], 'an edit chains on the key of the edit accepted before it');
    }

    /**
     * TWO-26662: Two may have applied an edit that got no answer or a 5xx, so the stored hash is cleared and the
     * next edit is sent even when it goes back to what was stored. A refused edit keeps the stored hash.
     */
    private static function testAnEditWithAnUnknownOutcomeNeverHidesTheNextOne(): void
    {
        $update = new ReflectionMethod(WC_Twoinc::class, 'process_update_twoinc_order');
        $update->setAccessible(true);
        $meta = static function (string $po): array {
            return [
                'order_reference' => 'ref', 'company_id' => '912345678', 'department' => '', 'project' => '',
                'purchase_order_number' => $po, 'invoice_emails' => [], 'payment_reference_message' => '',
                'payment_reference_ocr' => '', 'payment_reference' => '', 'payment_reference_type' => '', 'vendor_name' => '',
            ];
        };
        $hash_key = WC_Twoinc_Brand::meta_key('req_body_hash');
        // The order stands at A, as last accepted, and is edited to B. [answer to the edit to B (0: none), next edit, edits sent, hash stored after B ('' for none), description]
        $cases = [
            [0, 'A', 2, '', 'a timed-out edit followed by an edit back to A is sent'],
            [503, 'A', 2, '', 'an edit answered with a 5xx followed by an edit back to A is sent'],
            [0, 'B', 2, '', 'a timed-out edit made again is sent again'],
            [200, 'B', 1, 'B', 'an accepted edit followed by an identical edit is still skipped'],
            [400, 'A', 1, 'A', 'a refused edit followed by an edit back to A is skipped, as before'],
            [400, 'B', 2, 'A', 'a refused edit made again is sent again, as before'],
        ];
        foreach ($cases as [$status, $next, $sends, $stored, $description]) {
            self::reset();
            $gateway = self::recordingGateway();
            $order = self::exampleOrder();
            $order->meta[WC_Twoinc_Brand::meta_key('order_state')] = 'VERIFIED';
            $order->meta[$hash_key] = WC_Twoinc_Helper::hash_order_pair($order, $meta('A'))[0];
            $gateway->statuses = [$status];
            $update->invoke($gateway, $order, $meta('B'));
            $after = $order->meta[$hash_key] ?? null;
            $update->invoke($gateway, $order, $meta($next));
            $sent = array_values(array_filter($gateway->sent, static function ($s) {
                return $s['endpoint'] === '/v1/order/two-1';
            }));
            TinyAssert::same($stored === '' ? '' : WC_Twoinc_Helper::hash_order_pair($order, $meta($stored))[0], $after, "$description: hash stored after the edit to B");
            TinyAssert::same($sends, count($sent), "$description: edits sent");
            if ($sends === 2) {
                // Nothing was accepted in between, so only the same edit again repeats its key.
                TinyAssert::same($next === 'B', $sent[0]['idempotency_key'] === $sent[1]['idempotency_key'], "$description: {$sent[0]['idempotency_key']} against {$sent[1]['idempotency_key']}");
            }
        }
    }

    private static function testEveryOrderWriteLogsItsKeyWhateverTheOutcome(): void
    {
        $paths = [];
        foreach (self::orderRequestPaths() as [$drive, $type, , $endpoint, $description]) {
            $paths[$description] = [$drive, $type, $endpoint];
        }
        // [status (0: no response), log level, what the line reports, description]
        $outcomes = [
            [200, 'info', 'HTTP 200', 'accepted'],
            [400, 'error', 'HTTP 400', 'refused'],
            [0, 'error', 'no response (Operation timed out)', 'timed out'],
        ];
        foreach (['create', 'update', 'confirm', 'capture', 'cancel', 'refund'] as $path) {
            [$drive, $type, $endpoint] = $paths[$path];
            foreach ($outcomes as [$status, $level, $reported, $outcome]) {
                self::reset();
                $gateway = self::recordingGateway();
                $gateway->statuses = [$status];
                $order = self::exampleOrder();
                $order->refunds = [self::shippingRefund()];
                $drive($gateway, $order);
                $key = $gateway->sent[0]['idempotency_key'] ?? '';
                $lines = array_values(array_filter($GLOBALS['__twoinc_test_logs'], static function ($log) use ($key) {
                    return $key !== '' && strpos($log['message'], "Idempotency-Key $key") !== false;
                }));
                TinyAssert::same(1, count($lines), "$path $outcome: one log line names the key, debug logging off: " . json_encode($GLOBALS['__twoinc_test_logs']));
                TinyAssert::same($level, $lines[0]['level'], "$path $outcome: level");
                TinyAssert::true(strpos($lines[0]['message'], $type) === 0 && strpos($lines[0]['message'], $status === 400 ? 'HTTP 400' : $reported) !== false, "$path $outcome: names the request and its outcome: {$lines[0]['message']}");
            }
        }
    }

    private static function testOnlyWritesCarryAKeyAndEveryWriteDoes(): void
    {
        // The plugin's own make_request(), not the recording override.
        $send = new ReflectionMethod(WC_Twoinc::class, 'make_request');
        $payload = ['a' => 1];
        // [method, the caller's key, header sent, description]
        $cases = [
            ['GET', null, null, 'a read carries none'],
            ['GET', 'confirm_two-1', null, 'nor does a read a caller passed one'],
            ['POST', 'confirm_two-1', 'confirm_two-1', 'the caller\'s key is sent as given'],
            ['POST', null, null, 'a write its caller built no key for is sent with none, never a fallback'],
            ['PUT', '', null, 'nor with an empty one'],
            ['DELETE', 'cancel_two-1', 'cancel_two-1', 'a DELETE carries its caller\'s key too'],
        ];
        foreach ($cases as [$method, $key, $expected, $description]) {
            self::reset();
            $before = count($GLOBALS['__twoinc_test_http_calls'] ?? []);
            $send->invoke(self::recordingGateway(), '/v1/example', $payload, $method, [], null, 30, $key);
            $calls = array_slice($GLOBALS['__twoinc_test_http_calls'] ?? [], $before);
            TinyAssert::same(1, count($calls), "$description: one request");
            TinyAssert::same($expected, $calls[0]['args']['headers']['Idempotency-Key'] ?? null, $description);
        }

        $long = 'refund_' . str_repeat('a', 120);
        // [operation, ids, hashed, key, description]
        $keys = [
            ['confirm', ['two-1'], null, 'confirm_two-1', 'the operation and its ids'],
            ['Edit', ['Two-1 X'], null, 'edit_two-1-x', 'lowercased, anything outside a-z, 0-9, _ and - folded to a hyphen'],
            ['edit', ['two-1'], $payload, 'edit_two-1_' . self::keyHash($payload), 'a hashed payload goes last'],
            ['refund', [str_repeat('a', 120)], null, substr($long, 0, 83) . '_' . self::keyHash($long), 'over 100 characters, the cut is made unique by a hash of the whole key'],
        ];
        foreach ($keys as [$operation, $ids, $hashed, $expected, $description]) {
            TinyAssert::same($expected, WC_Twoinc_Helper::idempotency_key($operation, $ids, $hashed), $description);
        }
        TinyAssert::true(
            WC_Twoinc_Helper::idempotency_key('refund', [str_repeat('a', 120) . 'b']) !== WC_Twoinc_Helper::idempotency_key('refund', [str_repeat('a', 120) . 'c']),
            'two long keys differing only past the cut stay apart'
        );
    }

    /** make_request() builds no fallback, so a write call site that passes no key would go unkeyed. */
    private static function testEveryWriteCallSitePassesItsOwnKey(): void
    {
        $offenders = [];
        foreach (glob(WC_TWOINC_PLUGIN_PATH . 'class/*.php') as $file) {
            $source = (string) file_get_contents($file);
            preg_match_all('/->make_request\(/', $source, $calls, PREG_OFFSET_CAPTURE);
            foreach ($calls[0] as [, $offset]) {
                // The call's own arguments, up to its matching parenthesis.
                $depth = 0;
                for ($end = $offset + strlen('->make_request'); $end < strlen($source); $end++) {
                    $depth += ['(' => 1, ')' => -1][$source[$end]] ?? 0;
                    if ($depth === 0) {
                        break;
                    }
                }
                $call = substr($source, $offset, $end - $offset + 1);
                if (strpos($call, "'GET'") === false && stripos($call, 'idempotency_key') === false && strpos($call, '$key') === false) {
                    $offenders[] = basename($file) . ':' . (substr_count($source, "\n", 0, $offset) + 1);
                }
            }
        }
        TinyAssert::same([], $offenders, 'writes sent without a key of their own');
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

            public function make_request($endpoint, $payload = [], $method = 'POST', $params = [], $api_key_override = null, $timeout = 30, $idempotency_key = null)
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
            [['prepaid_amount' => '10.00'] + $before, 1, [['/prepaid_amount', null, '10.00']], 'so does a prepaid field'],
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
            $context = self::context('order_update', $order);
            TinyAssert::same($expected, $context['order_tenders'], $description);
            // A gift card's code redeems it: never in what subscribers see or in the log.
            TinyAssert::same(false, strpos(json_encode([$context['order_tenders'], $GLOBALS['__twoinc_test_logs']]), StubTenderItem::CODE), "$description: the card code leaked");
        }

        // recompute_totals_from_lines() declares the tenders as prepaid: net and tax stay the full lines, whatever the
        // original carries.
        $lines = [['net_amount' => '100.00', 'tax_amount' => '21.00', 'gross_amount' => '121.00', 'tax_rate' => '0.21']];
        $built = ['gross_amount' => '111.00', 'net_amount' => '100.00', 'tax_amount' => '21.00', 'invoice_amount' => '121.00', 'payable_amount' => '111.00', 'prepaid_amount' => '10.00', 'line_items' => $lines];
        $prepaid = ['111.00', '100.00', '21.00', '121.00', '111.00', '10.00'];
        // [original, tenders, expected gross, net, tax, invoice, payable, prepaid, description]
        $recompute = [
            [$built, [$card], $prepaid, 'an original the plugin built with the tender: unchanged'],
            [['line_items' => $lines], [$card], $prepaid, 'an original with no totals: the tender is still declared'],
            [$built, [], $prepaid, 'no tenders passed: the payload\'s own prepaid amount is kept'],
            [['line_items' => $lines], [], ['121.00', '100.00', '21.00', null, null, null], 'no tenders: the lines, and no prepaid fields'],
        ];
        $fields = ['gross_amount', 'net_amount', 'tax_amount', 'invoice_amount', 'payable_amount', 'prepaid_amount'];
        foreach ($recompute as [$original, $tenders, $expected, $description]) {
            $payload = ['gross_amount' => '0', 'net_amount' => '0', 'tax_amount' => '0', 'line_items' => $lines] + array_intersect_key($original, ['prepaid_amount' => 1]);
            $out = WC_Twoinc_Helper::recompute_totals_from_lines($payload, $original, $tenders);
            TinyAssert::same($expected, array_map(static function ($field) use ($out) {
                return $out[$field] ?? null;
            }, $fields), $description);
        }
        // A request with no body (capture, cancel, confirm) stays without one on a gift card order.
        TinyAssert::same([], WC_Twoinc_Helper::recompute_totals_from_lines([], [], [$card]), 'an empty body stays empty');
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
            // 21 lines each up half a unit and the order's total down half a unit: (21 + 1) / 2 = 11 units at most.
            [0, 1.0, 0.0, 10.0, 0.0, 'sent', '0 decimals, the worst case: half a unit per line and half for the order', 21],
            [0, 1.0, 0.0, 9.0, 0.0, 'refused', '0 decimals, one unit past the worst case', 21],
        ];
        foreach ($cases as $case) {
            [$decimals, $net, $tax, $total, $total_tax, $expected, $description] = $case;
            $count = $case[7] ?? 20;
            self::reset();
            $GLOBALS['__twoinc_test_price_decimals'] = $decimals;
            try {
                $order = self::exampleOrder();
                $order->products = [];
                for ($i = 0; $i < $count; $i++) {
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

    private static function testTendersAreReadOncePerRequest(): void
    {
        // [request type, description]
        $cases = [
            ['order_create', 'a create: the build and the hook share one read'],
            ['order_update', 'an update too'],
            ['capture', 'a request with no build reads once for the hook'],
        ];
        foreach ($cases as [$type, $description]) {
            self::reset();
            $reads = 0;
            add_filter('twoinc_order_tenders', static function ($tenders) use (&$reads) {
                $reads++;
                return $tenders;
            }, 10, 2);
            $order = self::exampleOrder();
            $payload = [
                'order_create' => static function () use ($order) {
                    return WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', []);
                },
                'order_update' => static function () use ($order) {
                    return WC_Twoinc_Helper::compose_twoinc_edit_order($order, '', '', '', '');
                },
                'capture' => static function () {
                    return [];
                },
            ][$type]();
            self::recordingGateway()->make_order_request($type, 'test', '/v1/order', $payload, 'POST', $order);
            TinyAssert::same(1, $reads, $description);
        }
    }

    /**
     * The build's whole-order check and tenders belong to the order just built. A hook that fails leaves the check
     * pending, and PHP reuses a freed object's id, so a later request on another order must not pick them up.
     */
    private static function testABuildsCheckNeverReachesAnotherOrder(): void
    {
        $pending = new ReflectionProperty(WC_Twoinc_Helper::class, 'whole_order_check');
        $pending->setAccessible(true);
        // [what happens after the build, expected pending check left, expected tender reads, description]
        $cases = [
            ['throws', false, 1, 'a subscriber that throws clears the pending check'],
            ['other_order', true, 2, 'another order at the same object id reads its own tenders'],
        ];
        foreach ($cases as [$after, $left, $reads, $description]) {
            self::reset();
            $count = 0;
            add_filter('twoinc_order_tenders', static function ($tenders) use (&$count) {
                $count++;
                return $tenders;
            }, 10, 2);
            $order = self::exampleOrder();
            $payload = WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', []);
            if ($after === 'throws') {
                self::arm('throws');
                try {
                    self::recordingGateway()->make_order_request('order_create', 'checkout', '/v1/order', $payload, 'POST', $order);
                } catch (WC_Twoinc_Order_Postprocessing_Exception $e) {
                }
            } else {
                // The same object standing in for a different order, as a reused id would.
                $order->id = 77;
                self::context('capture', $order);
            }
            TinyAssert::same($left, $pending->getValue() !== null, "$description: pending check");
            TinyAssert::same($reads, $count, "$description: tender reads");
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

    /**
     * Every body that carries amounts, run through the rules Two's API applies to them (TWO-26309): the lines' net
     * within 0.02 of net_amount, their tax within 0.99 of tax_amount, invoice_amount equal to net plus tax and to
     * payable plus prepaid, gross_amount if sent equal to payable_amount, and a refund's payable and prepaid parts
     * summing to its lines. The order's lines come to 150.00 gross, 21.00 tax.
     */
    private static function testEveryPayloadMeetsTheOrderAmountRules(): void
    {
        $create = static function ($order) {
            return WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', []);
        };
        $update = static function ($order) {
            return WC_Twoinc_Helper::compose_twoinc_edit_order($order, '', '', '', '');
        };
        $refund = static function (float $amount) {
            return static function ($order) use ($amount) {
                return WC_Twoinc_Helper::compose_twoinc_refund(self::shippingRefund(), $amount, $order);
            };
        };
        $capture = static function () {
            return [];
        };
        // [build, gift card, expected payable or refund amount, expected prepaid (null: no prepaid fields), description]
        $cases = [
            [$create, 0.0, '150.00', null, 'a create with no tender is sent as before, with no prepaid fields'],
            [$update, 0.0, '150.00', null, 'so is an update'],
            [$create, 10.0, '140.00', '10.00', 'a create with a gift card declares it as prepaid'],
            [$update, 10.0, '140.00', '10.00', 'so does an update'],
            [$create, 150.0, '0.00', '150.00', 'a gift card covering the whole order leaves nothing payable'],
            [$refund(29.0), 0.0, '29.00', null, 'a refund with no tender is its lines'],
            [$refund(19.0), 10.0, '19.00', '10.00', 'a refund with a gift card: the lines beyond the refunded amount are prepaid'],
            [$refund(29.0), 10.0, '29.00', '0.00', 'a refund paid in full through Two has no prepaid part'],
            [$capture, 10.0, null, null, 'a capture with a gift card fulfils the whole order and carries no amounts'],
        ];
        foreach ($cases as [$build, $card, $payable, $prepaid, $description]) {
            self::reset();
            $order = self::exampleOrder();
            $order->total = 150.0 - $card;
            if ($card > 0) {
                $order->extra_items['gift_card'] = [new StubTenderItem($card)];
                // Placed with the card declared as prepaid.
                $order->meta[WC_Twoinc_Brand::meta_key('prepaid_amount')] = number_format($card, 2, '.', '');
            }
            $payload = $build($order);
            if ($payable === null) {
                TinyAssert::same([], $payload, $description);
                continue;
            }
            $broken = self::amountRuleFailures($payload, $card);
            TinyAssert::same([], $broken, "$description: breaks " . implode('; ', $broken));
            $refund_body = array_key_exists('amount', $payload);
            TinyAssert::same($payable, $payload[$refund_body ? 'amount' : 'gross_amount'], "$description: payable");
            TinyAssert::same($prepaid, $payload['prepaid_amount'] ?? null, "$description: prepaid");
            if (!$refund_body) {
                TinyAssert::same($prepaid === null ? [] : ['invoice_amount', 'payable_amount', 'prepaid_amount'], array_values(array_intersect(array_keys($payload), ['invoice_amount', 'payable_amount', 'prepaid_amount'])), "$description: fields");
            }
        }
    }


    /**
     * A refund's prepaid part is capped at the tenders earlier refunds through Two left, and a rounding gap between
     * its lines and its amount goes to the amount. The order: 150.00 of lines, a 10.00 gift card; each refund here
     * credits the 29.00 shipping line.
     */
    private static function testARefundsPrepaidPartIsWhatTheTendersHaveLeft(): void
    {
        $refund = static function (float $amount, int $id = 99, bool $sent = false) {
            return new class ($amount, $id, $sent) extends StubRefund {
                private $amount;
                private $id;
                private $sent;

                public function __construct(float $amount, int $id, bool $sent)
                {
                    parent::__construct(['shipping' => [new StubShippingItem(-29.0, 0.0, [], ['_refunded_item_id' => 5])]], []);
                    $this->amount = $amount;
                    $this->id = $id;
                    $this->sent = $sent;
                }

                public function get_id()
                {
                    return $this->id;
                }

                public function get_amount()
                {
                    return $this->amount;
                }

                public function get_refunded_payment()
                {
                    return $this->sent;
                }
            };
        };
        // [amounts refunded through Two before, amount refunded now, expected amount, expected prepaid, description]
        $cases = [
            [[], 19.0, '19.00', '10.00', 'the lines beyond the amount are prepaid'],
            [[], 28.99, '28.99', '0.01', 'the amount is what WooCommerce refunded: a rounding gap is prepaid, within the card'],
            [[23.0], 25.0, '25.00', '4.00', 'an earlier refund took 6.00 of the card: 4.00 is left'],
            [[24.0, 24.0], 29.0, '29.00', '0.00', 'two earlier refunds took the whole card'],
        ];
        foreach ($cases as [$earlier, $amount, $expected_amount, $expected_prepaid, $description]) {
            self::reset();
            $order = self::exampleOrder();
            $order->total = 140.0;
            $order->extra_items['gift_card'] = [new StubTenderItem(10.0)];
            $order->meta[WC_Twoinc_Brand::meta_key('prepaid_amount')] = '10.00';
            $current = $refund($amount);
            $order->refunds = [$current];
            foreach ($earlier as $i => $earlier_amount) {
                $order->refunds[] = $refund($earlier_amount, 10 + $i, true);
            }
            $body = WC_Twoinc_Helper::compose_twoinc_refund($current, $amount, $order);
            TinyAssert::same([$expected_amount, $expected_prepaid], [$body['amount'], $body['prepaid_amount']], $description);
        }

        // The helper on a refund that carries a prepaid part: it keeps the part, and the amount is the lines less it.
        $lines = [['net_amount' => '-30.00', 'tax_amount' => '0.00', 'gross_amount' => '-30.00', 'tax_rate' => '0']];
        $original = ['amount' => '19.00', 'prepaid_amount' => '10.00', 'line_items' => [['net_amount' => '-29.00', 'tax_amount' => '0.00', 'gross_amount' => '-29.00', 'tax_rate' => '0']]];
        $out = WC_Twoinc_Helper::recompute_totals_from_lines(['line_items' => $lines] + $original, $original, [['type' => 'gift_card', 'label' => 'Gift card', 'amount' => '10.00', 'source' => 'gift_card']]);
        TinyAssert::same(['20.00', '10.00'], [$out['amount'], $out['prepaid_amount']], 'the helper on a refund with a prepaid part');
    }


    /**
     * The README's extra-line example reads what the order carries beyond its lines from invoice_amount when the
     * body has one: with a gift card, gross_amount is only what is left to pay. 150.00 of lines, a 10.00 card and a
     * 10.00 cost outside any line: the order total is 150.00.
     */
    private static function testTheExtraLineExampleSeesACostBeyondTheLinesBesideAGiftCard(): void
    {
        // [gift card, description]
        foreach ([[0.0, 'no gift card'], [10.0, 'a gift card']] as [$card, $description]) {
            self::reset();
            self::arm('extra_line');
            $order = self::exampleOrder();
            $order->total = 160.0 - $card;
            if ($card > 0) {
                $order->extra_items['gift_card'] = [new StubTenderItem($card)];
                // Placed with the card declared as prepaid.
                $order->meta[WC_Twoinc_Brand::meta_key('prepaid_amount')] = number_format($card, 2, '.', '');
            }
            $gateway = self::recordingGateway();
            $gateway->make_order_request('order_create', 'checkout', '/v1/order', WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', []), 'POST', $order);
            $sent = $gateway->sent[0]['payload'];
            $handling = array_values(array_filter($sent['line_items'], static function ($line) {
                return $line['name'] === 'Handling';
            }));
            TinyAssert::same('10.00', $handling[0]['gross_amount'] ?? null, "$description: the cost is sent as its own line");
            $broken = self::amountRuleFailures($sent, $card);
            TinyAssert::same([], $broken, "$description: breaks " . implode('; ', $broken));
        }
    }


    /**
     * An order placed with Two before tenders were declared (TWO-26309) holds no prepaid amount at Two, so its update
     * and refund are sent as they were then, with no prepaid fields. The create records the prepaid amount it sent;
     * an order placed with Two that has no such record is one of these. 150.00 of lines, a 10.00 gift card.
     */
    private static function testAnOrderPlacedWithoutPrepaidIsSentAsBefore(): void
    {
        $meta = WC_Twoinc_Brand::meta_key('prepaid_amount');
        $giftCardOrder = static function () {
            $order = self::exampleOrder();
            $order->total = 140.0;
            $order->extra_items['gift_card'] = [new StubTenderItem(10.0)];
            return $order;
        };

        // The create records what it declared, on an order not yet placed with Two.
        foreach ([[10.0, '10.00'], [0.0, '0.00']] as [$card, $expected]) {
            self::reset();
            $order = self::exampleOrder();
            unset($order->meta[WC_Twoinc_Brand::prefixed_name('order_id')]);
            $order->total = 150.0 - $card;
            if ($card > 0) {
                $order->extra_items['gift_card'] = [new StubTenderItem($card)];
            }
            WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', []);
            TinyAssert::same($expected, $order->meta[$meta] ?? null, "the create records a prepaid amount of $expected");
        }

        // [prepaid recorded at placement, expected update totals, expected refund amount and prepaid, description]
        $cases = [
            [null, ['140.00', '119.00', null], ['19.00', null], 'placed before: sent as it was then'],
            ['10.00', ['140.00', '129.00', '10.00'], ['19.00', '10.00'], 'placed with the card declared: sent with it'],
        ];
        foreach ($cases as [$recorded, $update, $refund, $description]) {
            self::reset();
            $order = $giftCardOrder();
            if ($recorded !== null) {
                $order->meta[$meta] = $recorded;
            }
            $edit = WC_Twoinc_Helper::compose_twoinc_edit_order($order, '', '', '', '');
            TinyAssert::same($update, [$edit['gross_amount'], $edit['net_amount'], $edit['prepaid_amount'] ?? null], "$description: update");
            // The change hash recomposes the create body: it must not see a change the order never had.
            $create = WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', []);
            TinyAssert::same($update, [$create['gross_amount'], $create['net_amount'], $create['prepaid_amount'] ?? null], "$description: the change hash's create body");
            $body = WC_Twoinc_Helper::compose_twoinc_refund(self::shippingRefund(), 19.0, $order);
            TinyAssert::same($refund, [$body['amount'], $body['prepaid_amount'] ?? null], "$description: refund");
        }
    }

    /**
     * A port of the amount rules Two's API applies to an order body (create, update, partial fulfilment) or a refund.
     *
     * @param float $tendered the order's prepaid amount, the most a refund's prepaid part can be
     *
     * @return string[] the rules the body breaks
     */
    private static function amountRuleFailures(array $payload, float $tendered): array
    {
        $cents = static function ($amount): int {
            return (int) round((float) $amount * 100);
        };
        $sum = static function (string $field) use ($payload, $cents): int {
            return array_sum(array_map(static function ($line) use ($field, $cents) {
                return $cents($line[$field] ?? 0);
            }, $payload['line_items'] ?? []));
        };
        $prepaid = $cents($payload['prepaid_amount'] ?? 0);
        if (array_key_exists('amount', $payload)) {
            return array_keys(array_filter([
                'payable plus prepaid is the refunded lines' => abs($cents($payload['amount'])) + abs($prepaid) !== abs($sum('gross_amount')),
                'prepaid within the order\'s' => abs($prepaid) > $cents($tendered),
            ]));
        }
        // Two's API reads a body with no payable_amount as gross_amount, and one with no invoice_amount as payable plus prepaid.
        $payable = $cents($payload['payable_amount'] ?? $payload['gross_amount']);
        $invoice = $cents($payload['invoice_amount'] ?? 0) ?: $payable + $prepaid;
        $net = $cents($payload['net_amount']);
        $tax = $cents($payload['tax_amount']);
        return array_keys(array_filter([
            'net within 0.02 of the lines' => abs($sum('net_amount') - $net) > 2,
            'tax within 0.99 of the lines' => abs($sum('tax_amount') - $tax) > 99,
            'invoice is net plus tax' => $invoice !== $net + $tax,
            'invoice is payable plus prepaid' => $invoice !== $payable + $prepaid,
            'gross, when sent, is payable' => isset($payload['gross_amount']) && $cents($payload['gross_amount']) !== $payable,
            'tax subtotals sum to the tax' => isset($payload['tax_subtotals']) && array_sum(array_map(static function ($subtotal) use ($cents) {
                return $cents($subtotal['tax_amount']);
            }, $payload['tax_subtotals'])) !== $tax,
        ]));
    }
}

/** An order item a gift card plugin records a redemption as, named by the card's redeemable code as the plugins do. */
final class StubTenderItem
{
    public const CODE = 'GC-SECRET-4242';

    private $amount;

    public function __construct(float $amount)
    {
        $this->amount = $amount;
    }

    public function get_code()
    {
        return self::CODE;
    }

    public function get_card_number()
    {
        return self::CODE;
    }

    public function get_name()
    {
        return self::CODE;
    }

    public function get_amount()
    {
        return $this->amount;
    }
}
