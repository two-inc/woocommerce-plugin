<?php

declare(strict_types=1);

/**
 * Orders the buyer verified but never returned from (TWO-26300): one resolver for the buyer's return, the
 * scheduled check, the admin order action and WooCommerce's unpaid-order time limit.
 */
final class PendingRecoverySpec
{
    public static function runAll(): void
    {
        $tests = [
            'testStateMapping',
            'testEachTriggerActsOnEachState',
            'testTheBuyerReturnRedirects',
            'testACancelledOrderIsNotCancelledAtTwoAgain',
            'testTheUnpaidOrderTimeLimit',
            'testANotFoundOrderIsCancelledOnlyOnceConfirmed',
            'testSelection',
            'testTheLockIsSharedAndReleased',
            'testTheOrderActionIsOfferedOnlyForAWaitingTwoOrder',
            'testTheOrderActionParksANotice',
            'testTheScheduledCheckIsRegisteredAndRemoved',
        ];
        foreach ($tests as $test) {
            self::reset();
            self::$test();
            print("PASS PendingRecoverySpec::$test\n");
        }
        self::reset();
        self::setInstance(null);
    }

    private static function reset(): void
    {
        $GLOBALS['__twoinc_test_wc_orders'] = [];
        $GLOBALS['__twoinc_test_transients'] = [];
        $GLOBALS['__twoinc_test_logs'] = [];
        $GLOBALS['__twoinc_test_wc_get_orders'] = [];
        $GLOBALS['__twoinc_test_wc_get_orders_args'] = [];
        $GLOBALS['wpdb'] = new StubWpdb();
        $_REQUEST = [];
    }

    private static function setInstance($gateway): void
    {
        $prop = new ReflectionProperty(WC_Twoinc::class, 'instance');
        $prop->setAccessible(true);
        $prop->setValue(null, $gateway);
    }

    /** A Two order with id two-1, registered as order $id. */
    private static function order(string $status = 'pending', int $id = 42)
    {
        $order = new class ($id) extends StubOrder {
            private $id;
            public $paid = 0;

            public function __construct(int $id)
            {
                $this->id = $id;
            }

            public function get_id()
            {
                return $this->id;
            }

            public function payment_complete()
            {
                $this->paid++;
                $this->status = 'processing';
            }

            public function update_status($status, $note = '')
            {
                $this->status = $status;
                $this->saves++;
            }

            public function is_paid()
            {
                return in_array($this->status, ['processing', 'completed'], true);
            }

            public function has_status($status)
            {
                return in_array($this->status, (array) $status, true);
            }

            /** As WooCommerce's: pending or failed, with something to pay. */
            public function needs_payment()
            {
                return $this->has_status(['pending', 'failed']) && $this->get_total() > 0;
            }

            public $created_via = 'checkout';

            public function get_created_via()
            {
                return $this->created_via;
            }

            public function delete_meta_data($key)
            {
                unset($this->meta[$key]);
            }

            public function get_checkout_order_received_url()
            {
                return 'https://shop.example/thanks';
            }

            /** @var int UTC seconds; an hour ago unless a test says otherwise */
            public $created;

            public function get_date_created()
            {
                return new DateTimeImmutable('@' . $this->created);
            }
        };
        $order->created = time() - 3600;
        $order->status = $status;
        $order->payment_method = WC_Twoinc_Brand::get('gateway_id');
        $order->meta[WC_Twoinc_Brand::prefixed_name('order_id')] = 'two-1';
        $order->meta[WC_Twoinc_Brand::meta_key('order_reference')] = 'ref';
        $GLOBALS['__twoinc_test_wc_orders'][$id] = $order;
        return $order;
    }

    /**
     * Answers the order read with $two_order (HTTP $read_status, 0 for no response) and every write with
     * $write_status, recording both.
     */
    private static function gateway(?array $two_order, int $read_status = 200, int $write_status = 200)
    {
        return new class ($two_order, $read_status, $write_status) extends WC_Twoinc {
            public $icon = '';
            public $sent = [];
            private $two_order;
            private $read_status;
            private $write_status;

            public function __construct(?array $two_order, int $read_status, int $write_status)
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
                $this->two_order = $two_order;
                $this->read_status = $read_status;
                $this->write_status = $write_status;
            }

            public function get_merchant_id()
            {
                return 'mid';
            }

            public function get_option($key, $empty_value = null)
            {
                return $key === 'api_key' ? 'key' : ($empty_value ?? '');
            }

            public function make_request($endpoint, $payload = [], $method = 'POST', $params = [], $api_key_override = null, $timeout = 30, $idempotency_key = null)
            {
                $this->sent[] = ['method' => $method, 'endpoint' => $endpoint, 'idempotency_key' => $idempotency_key];
                $status = $method === 'GET' ? $this->read_status : $this->write_status;
                if ($status === 0) {
                    return new WP_Error('http_request_failed', 'Operation timed out');
                }
                return ['response' => ['code' => $status], 'body' => json_encode($method === 'GET' ? $this->two_order : ['id' => 'two-1']), 'headers' => []];
            }

            /** @return string[] "METHOD endpoint" for every request sent */
            public function calls(): array
            {
                return array_map(static function ($sent) {
                    return $sent['method'] . ' ' . $sent['endpoint'];
                }, $this->sent);
            }
        };
    }

    private static function testStateMapping(): void
    {
        // [state, status, expected action, description]
        $cases = [
            ['UNVERIFIED', 'APPROVED', 'wait', 'the buyer has not verified'],
            ['VERIFIED', 'APPROVED', 'confirm', 'verified, so confirm'],
            ['CONFIRMED', 'APPROVED', 'process', 'already confirmed'],
            ['FULFILLING', 'APPROVED', 'process', 'being fulfilled'],
            ['FULFILLED', 'APPROVED', 'process', 'fulfilled'],
            ['DELIVERED', 'APPROVED', 'process', 'delivered'],
            ['FULFILMENT_NEEDS_MANUAL_RESOLUTION', 'APPROVED', 'process', 'manual resolution'],
            ['CANCELLED', 'APPROVED', 'cancel', 'cancelled, including Two\'s own auto-cancel'],
            ['UNVERIFIED', 'REJECTED', 'decline', 'a rejected status'],
            ['VERIFIED', 'DECLINED', 'decline', 'a declined status wins over the state'],
            ['REFUNDED', 'APPROVED', 'unknown', 'refunded is left alone'],
            ['SOMETHING_NEW', '', 'unknown', 'a state not listed'],
            ['verified', 'approved', 'confirm', 'case-insensitive'],
        ];
        foreach ($cases as [$state, $status, $expected, $description]) {
            TinyAssert::same($expected, WC_Twoinc_Pending_Recovery::action_for($state, $status), $description);
        }
    }

    private static function testEachTriggerActsOnEachState(): void
    {
        $scheduled = WC_Twoinc_Pending_Recovery::TRIGGER_SCHEDULED;
        $admin = WC_Twoinc_Pending_Recovery::TRIGGER_ADMIN;
        $unpaid = WC_Twoinc_Pending_Recovery::TRIGGER_UNPAID_CANCEL;
        $return = WC_Twoinc_Pending_Recovery::TRIGGER_BUYER_RETURN;
        // [trigger, Two state, status, read HTTP, outcome, local status after, writes sent, note fragment or null for no note, order_state meta, description]
        $cases = [
            [$scheduled, 'UNVERIFIED', 'APPROVED', 200, 'unverified', 'pending', [], null, '', 'scheduled, unverified: nothing'],
            [$admin, 'UNVERIFIED', 'APPROVED', 200, 'unverified', 'pending', [], 'has not finished verification', '', 'admin, unverified: noted'],
            [$unpaid, 'UNVERIFIED', 'APPROVED', 200, 'unverified', 'cancelled', [], 'unpaid order time limit', '', 'unpaid limit, unverified: cancelled under the lock, and at Two'],
            [$return, 'UNVERIFIED', 'APPROVED', 200, 'unverified', 'pending', [], 'Unable to confirm', '', 'return, unverified: refused as before'],
            [$scheduled, 'VERIFIED', 'APPROVED', 200, 'confirmed', 'processing', ['POST /v1/order/two-1/confirm'], 'Found by the scheduled check', 'CONFIRMED', 'scheduled, verified: confirmed'],
            [$admin, 'VERIFIED', 'APPROVED', 200, 'confirmed', 'processing', ['POST /v1/order/two-1/confirm'], 'Checked by an administrator', 'CONFIRMED', 'admin, verified: confirmed'],
            [$unpaid, 'VERIFIED', 'APPROVED', 200, 'confirmed', 'processing', ['POST /v1/order/two-1/confirm'], 'unpaid order time limit', 'CONFIRMED', 'unpaid limit, verified: confirmed'],
            [$return, 'VERIFIED', 'APPROVED', 200, 'confirmed', 'processing', ['POST /v1/order/two-1/confirm'], 'has been placed with', 'CONFIRMED', 'return, verified: the note as before'],
            [$scheduled, 'CONFIRMED', 'APPROVED', 200, 'processed', 'processing', [], 'had already confirmed it', 'CONFIRMED', 'scheduled, already confirmed: no second confirm'],
            [$scheduled, 'FULFILLED', 'APPROVED', 200, 'processed', 'processing', [], 'had already confirmed it', 'FULFILLED', 'scheduled, fulfilled: Two\'s state kept'],
            [$scheduled, 'CANCELLED', 'APPROVED', 200, 'cancelled', 'cancelled', [], 'reports this order as cancelled', 'CANCELLED', 'scheduled, cancelled: cancelled here'],
            [$admin, 'UNVERIFIED', 'REJECTED', 200, 'declined', 'cancelled', [], 'declined this order', 'CANCELLED', 'admin, rejected: cancelled here'],
            [$return, 'CANCELLED', 'APPROVED', 200, 'cancelled', 'pending', [], 'reports this order as cancelled', 'CANCELLED', 'return, cancelled: left for the cancel URL'],
            [$scheduled, 'REFUNDED', 'APPROVED', 200, 'unknown', 'pending', [], 'reports state REFUNDED', '', 'scheduled, refunded: noted, not changed'],
            [$scheduled, 'VERIFIED', 'APPROVED', 500, 'read_failed', 'pending', [], null, '', 'scheduled, read failed: retried next run'],
            [$scheduled, 'VERIFIED', 'APPROVED', 0, 'read_failed', 'pending', [], null, '', 'scheduled, no response: retried next run'],
            [$return, 'VERIFIED', 'APPROVED', 0, 'read_failed', 'pending', [], 'Unable to retrieve', '', 'return, no response: noted as before'],
        ];
        foreach ($cases as [$trigger, $state, $status, $read, $outcome, $local, $writes, $note, $order_state, $description]) {
            self::reset();
            $order = self::order();
            $gateway = self::gateway(['id' => 'two-1', 'state' => $state, 'status' => $status], $read);
            $result = WC_Twoinc_Pending_Recovery::resolve($gateway, 42, $trigger);
            TinyAssert::same($outcome, $result['outcome'], "$description: outcome");
            TinyAssert::same($local, $order->status, "$description: local status");
            TinyAssert::same(['GET /v1/order/two-1'], array_slice($gateway->calls(), 0, 1), "$description: reads the order first");
            TinyAssert::same($writes, array_slice($gateway->calls(), 1), "$description: writes sent");
            TinyAssert::same($note === null ? [] : [true], array_map(static function ($n) use ($note) {
                return strpos($n, (string) $note) !== false;
            }, $order->notes), "$description: notes " . json_encode($order->notes));
            TinyAssert::same($order_state, $order->get_meta(WC_Twoinc_Brand::meta_key('order_state')), "$description: order_state meta");
            TinyAssert::true($order->get_meta(WC_Twoinc_Brand::meta_key('pending_checked_at')) > 0, "$description: the check is recorded");
            TinyAssert::same($outcome === 'confirmed' || $outcome === 'processed' ? 1 : 0, $order->paid, "$description: paid once");
        }

        // A confirm Two refuses leaves the order waiting, noted.
        self::reset();
        $order = self::order();
        $gateway = self::gateway(['id' => 'two-1', 'state' => 'VERIFIED'], 200, 400);
        TinyAssert::same('refused', WC_Twoinc_Pending_Recovery::resolve($gateway, 42, $scheduled, 0)['outcome'], 'refused confirm');
        TinyAssert::same(['pending', 0], [$order->status, $order->paid], 'a refused confirm changes nothing');
        TinyAssert::same(1, count($order->notes), 'a refused confirm is noted');

        // The confirm carries the same key whichever trigger sends it, so a late return cannot confirm twice.
        TinyAssert::same('confirm_two-1', $gateway->sent[1]['idempotency_key'], 'confirm key');

        // A failed order waits for the buyer's return and the admin action only: WooCommerce's classic checkout
        // resumes one without setting it back to pending, so a buyer can pay it with Two. The scheduled check and
        // the unpaid-order limit leave a failed status, which a merchant may have set by hand, alone.
        // [trigger, outcome, local status after, paid, reads Two]
        $failed_cases = [
            [$return, 'confirmed', 'processing', 1, true],
            [$scheduled, 'not_waiting', 'failed', 0, false],
            [$admin, 'confirmed', 'processing', 1, true],
            [$unpaid, 'not_waiting', 'failed', 0, false],
        ];
        foreach ($failed_cases as [$trigger, $outcome, $local, $paid, $reads]) {
            self::reset();
            $order = self::order('failed');
            $gateway = self::gateway(['id' => 'two-1', 'state' => 'VERIFIED']);
            TinyAssert::same($outcome, WC_Twoinc_Pending_Recovery::resolve($gateway, 42, $trigger, 0)['outcome'], "$trigger, failed order: outcome");
            TinyAssert::same([$local, $paid], [$order->status, $order->paid], "$trigger, failed order: status and paid");
            TinyAssert::same($reads, $gateway->calls() !== [], "$trigger, failed order: reads Two");
        }

        // The scheduled check applies WooCommerce's unpaid-order time limit itself, counted from creation: on HPOS
        // its own save keeps the order too recent for WooCommerce's query to ever pick it up.
        // [manage stock, hold minutes, created via, age in minutes, local status after, note fragment, description]
        $own = ['WC_Twoinc_Pending_Recovery', 'filter_cancel_unpaid'];
        // [manage stock, hold minutes (null: never stored), created via, merchant filter says, age in minutes, local status after, note fragment, description]
        $hold_cases = [
            ['yes', '60', 'checkout', null, 59, 'pending', null, 'under the hold-stock limit: left waiting'],
            ['yes', '60', 'checkout', null, 61, 'cancelled', 'unpaid order time limit', 'over the limit: cancelled as WooCommerce would, and at Two'],
            ['yes', null, 'checkout', null, 61, 'cancelled', 'unpaid order time limit', 'hold time never stored: WooCommerce\'s 60 minutes'],
            ['yes', '0', 'checkout', null, 61, 'pending', null, 'hold stock off: left waiting'],
            ['no', '60', 'checkout', null, 61, 'pending', null, 'stock not managed: left waiting'],
            ['yes', '60', 'store-api', null, 61, 'pending', null, 'not made by the classic checkout: left, as WooCommerce would'],
            ['yes', '60', 'checkout', false, 61, 'pending', null, 'a merchant filter turned the automatic cancel off: left waiting'],
            ['yes', '60', 'store-api', true, 61, 'cancelled', 'unpaid order time limit', 'a merchant filter turned it on for other orders: cancelled'],
        ];
        foreach ($hold_cases as [$manage, $minutes, $via, $merchant, $age, $local, $note, $description]) {
            self::reset();
            remove_all_filters('woocommerce_cancel_unpaid_order');
            add_filter('woocommerce_cancel_unpaid_order', $own, WC_Twoinc_Pending_Recovery::UNPAID_FILTER_PRIORITY, 2);
            if ($merchant !== null) {
                add_filter('woocommerce_cancel_unpaid_order', static function () use ($merchant) {
                    return $merchant;
                }, 20);
            }
            $GLOBALS['__twoinc_test_options']['woocommerce_manage_stock'] = $manage;
            if ($minutes !== null) {
                $GLOBALS['__twoinc_test_options']['woocommerce_hold_stock_minutes'] = $minutes;
            }
            $order = self::order();
            $order->created_via = $via;
            $order->created = time() - $age * 60;
            $gateway = self::gateway(['id' => 'two-1', 'state' => 'UNVERIFIED']);
            self::setInstance($gateway);
            WC_Twoinc_Pending_Recovery::resolve($gateway, 42, $scheduled, 0);
            self::setInstance(null);
            unset($GLOBALS['__twoinc_test_options']['woocommerce_manage_stock'], $GLOBALS['__twoinc_test_options']['woocommerce_hold_stock_minutes']);
            TinyAssert::same([$own], array_column(array_filter($GLOBALS['__twoinc_test_filters']['woocommerce_cancel_unpaid_order'], static function ($entry) {
                return $entry['priority'] === WC_Twoinc_Pending_Recovery::UNPAID_FILTER_PRIORITY;
            }), 'cb'), "$description: the plugin's own filter is still registered, once");
            remove_all_filters('woocommerce_cancel_unpaid_order');
            TinyAssert::same($local, $order->status, "$description: local status");
            TinyAssert::same('', $order->get_meta(WC_Twoinc_Brand::meta_key('order_state')), "$description: a normal cancel, sent to Two");
            TinyAssert::same($note === null ? [] : [true], array_map(static function ($n) use ($note) {
                return strpos($n, (string) $note) !== false;
            }, $order->notes), "$description: notes " . json_encode($order->notes));
        }

        // A check that keeps failing is logged as an error once a day, not on every run.
        self::reset();
        $order = self::order();
        $gateway = self::gateway(['id' => 'two-1', 'state' => 'VERIFIED'], 500);
        WC_Twoinc_Pending_Recovery::resolve($gateway, 42, $scheduled, 0);
        WC_Twoinc_Pending_Recovery::resolve($gateway, 42, $scheduled, 0);
        $levels = array_column(array_filter($GLOBALS['__twoinc_test_logs'], static function ($log) {
            return strpos($log['message'], 'could not read the order') !== false;
        }), 'level');
        TinyAssert::same(['error', 'debug'], $levels, 'the second failure the same day is not an error');
        $order->meta[WC_Twoinc_Brand::meta_key('pending_error_logged_at')] = time() - 86400;
        WC_Twoinc_Pending_Recovery::resolve($gateway, 42, $scheduled, 0);
        TinyAssert::same('error', end($GLOBALS['__twoinc_test_logs'])['level'], 'a day later it is an error again');

        // An unknown state is noted once, not on every run.
        self::reset();
        $order = self::order();
        $gateway = self::gateway(['id' => 'two-1', 'state' => 'REFUNDED']);
        WC_Twoinc_Pending_Recovery::resolve($gateway, 42, $scheduled, 0);
        WC_Twoinc_Pending_Recovery::resolve($gateway, 42, $scheduled, 0);
        TinyAssert::same(1, count($order->notes), 'an unknown state is noted once');
    }

    private static function testTheBuyerReturnRedirects(): void
    {
        $method = new ReflectionMethod(WC_Twoinc::class, 'process_confirmation');
        $method->setAccessible(true);
        $lock = 'twoinc_order_' . substr(md5('wordpress|wp_'), 0, 12) . '_42';
        $cart = 'https://shop.example/cart';
        $thanks = 'https://shop.example/thanks';
        // [order status, Two state, read HTTP, lock held, expected URL or wp_die text, reads Two, notice (null: none), description]
        $cases = [
            ['pending', 'VERIFIED', 200, false, $thanks, true, null, 'verified: placed'],
            ['failed', 'VERIFIED', 200, false, $thanks, true, null, 'verified, on a resumed failed order: placed'],
            ['pending', 'CONFIRMED', 200, false, $thanks, true, null, 'already confirmed: placed'],
            ['pending', 'UNVERIFIED', 200, false, 'https://shop.example/cancel', true, null, 'unverified: cancel page, as before'],
            ['pending', 'CANCELLED', 200, false, 'https://shop.example/cancel', true, null, 'cancelled at Two: cancel page'],
            ['pending', 'VERIFIED', 0, false, 'wp_die: Unable to retrieve', true, null, 'no response: error page, as before'],
            ['processing', 'CONFIRMED', 200, false, $thanks, false, null, 'a late return after the scheduled check: placed, nothing sent'],
            ['completed', 'FULFILLED', 200, false, $thanks, false, null, 'a late return to a completed order: placed'],
            ['cancelled', 'CANCELLED', 200, false, $cart, false, 'Your order was cancelled.', 'a late return to a cancelled order: the cart, told it was cancelled'],
            ['pending', 'VERIFIED', 200, true, $thanks, false, 'We are still confirming your order with Two.', 'another check holds the lock: order-received, which empties the cart, told it is still being confirmed'],
            ['processing', 'CONFIRMED', 200, true, $thanks, false, null, 'the other check has just paid it: order-received'],
            ['cancelled', 'CANCELLED', 200, true, $cart, false, 'Your order was cancelled.', 'the other check has just cancelled it: the cart, told so'],
        ];
        foreach ($cases as [$status, $state, $read, $held, $expected, $reads, $notice, $description]) {
            self::reset();
            $GLOBALS['__twoinc_test_notices'] = [];
            if ($held) {
                $GLOBALS['wpdb']->held = [$lock];
            }
            $order = self::order($status);
            $gateway = self::gateway(['id' => 'two-1', 'state' => $state], $read);
            $_REQUEST = [
                'order_id' => '42',
                WC_Twoinc_Brand::prefixed_name('order_reference') => 'ref',
                WC_Twoinc_Brand::prefixed_name('csrf_token') => wp_create_nonce(WC_Twoinc_Brand::prefixed_name('confirm_42')),
            ];
            try {
                $url = $method->invoke($gateway);
            } catch (RuntimeException $e) {
                $url = 'wp_die: ' . $e->getMessage();
            }
            TinyAssert::true(strpos((string) $url, $expected) === 0, "$description: got $url");
            TinyAssert::same($reads, $gateway->calls() !== [], "$description: reads Two");
            TinyAssert::true($order->paid <= 1, "$description: paid at most once");
            TinyAssert::same($notice === null ? [] : [$notice], array_column($GLOBALS['__twoinc_test_notices'], 'message'), "$description: notices");
        }
    }

    private static function testACancelledOrderIsNotCancelledAtTwoAgain(): void
    {
        $order = self::order();
        $gateway = self::gateway(['id' => 'two-1', 'state' => 'CANCELLED']);
        WC_Twoinc_Pending_Recovery::resolve($gateway, 42, WC_Twoinc_Pending_Recovery::TRIGGER_SCHEDULED, 0);
        // What WooCommerce runs once the status has changed to cancelled.
        $gateway->on_order_cancelled(42);
        TinyAssert::same(['GET /v1/order/two-1'], $gateway->calls(), 'no cancel is sent to Two');
        TinyAssert::true(strpos(end($order->notes), 'already cancelled') !== false, 'noted as already cancelled');
    }

    private static function testTheUnpaidOrderTimeLimit(): void
    {
        $days = 86400;
        // The filter result is what WooCommerce does with its own copy of the order: true cancels it. Whenever the
        // order is resolved, the resolver has already cancelled it under the lock if it should go, and the filter
        // answers false. order_state CANCELLED means the cancel handler sends nothing to Two.
        // [WooCommerce would cancel, Two gateway, Two order id, Two state, read HTTP, age, filter result, local status, order_state, reads Two, description]
        $cases = [
            [true, true, 'two-1', 'UNVERIFIED', 200, $days, false, 'cancelled', '', true, 'unverified: cancelled here, and at Two'],
            [true, true, 'two-1', 'VERIFIED', 200, $days, false, 'processing', 'CONFIRMED', true, 'verified: confirmed instead'],
            [true, true, 'two-1', 'CONFIRMED', 200, $days, false, 'processing', 'CONFIRMED', true, 'confirmed at Two: processed instead'],
            [true, true, 'two-1', 'CANCELLED', 200, $days, false, 'cancelled', 'CANCELLED', true, 'cancelled at Two: cancelled here, without echoing'],
            [true, true, 'two-1', 'VERIFIED', 404, $days, false, 'pending', '', true, 'a 404 that is not Two\'s not-found answer: held'],
            [true, true, 'two-1', 'VERIFIED', 0, $days, false, 'pending', '', true, 'no response, inside 7 days: held for the next run'],
            [true, true, 'two-1', 'VERIFIED', 500, $days, false, 'pending', '', true, 'Two refused the read, inside 7 days: held'],
            [true, true, 'two-1', 'VERIFIED', 500, 8 * $days, false, 'cancelled', '', true, 'Two refused the read, past 7 days: cancelled as WooCommerce would'],
            [true, true, '', 'VERIFIED', 200, $days, true, 'pending', '', false, 'no Two order id (failed at checkout): WooCommerce cancels it'],
            [false, true, 'two-1', 'VERIFIED', 200, $days, false, 'pending', '', false, 'WooCommerce would not cancel: untouched'],
            [true, false, 'two-1', 'VERIFIED', 200, $days, true, 'pending', '', false, 'another gateway\'s order: untouched'],
        ];
        foreach ($cases as [$cancel, $two, $two_id, $state, $read, $age, $expected, $local, $order_state, $reads, $description]) {
            self::reset();
            $order = self::order();
            $order->created = time() - $age;
            $order->meta[WC_Twoinc_Brand::prefixed_name('order_id')] = $two_id;
            if (!$two) {
                $order->payment_method = 'cod';
            }
            $gateway = self::gateway(['id' => 'two-1', 'state' => $state], $read);
            self::setInstance($gateway);
            TinyAssert::same($expected, WC_Twoinc_Pending_Recovery::filter_cancel_unpaid($cancel, $order), "$description: filter result");
            TinyAssert::same($local, $order->status, "$description: local status");
            TinyAssert::same($order_state, $order->get_meta(WC_Twoinc_Brand::meta_key('order_state')), "$description: order_state");
            TinyAssert::same($reads, $gateway->calls() !== [], "$description: reads Two");
        }

        // Registered last, the plugin's filter receives a merchant's verdict: a shop that turned the automatic
        // cancel off keeps its Two orders, and Two is not even read.
        self::reset();
        remove_all_filters('woocommerce_cancel_unpaid_order');
        add_filter('woocommerce_cancel_unpaid_order', ['WC_Twoinc_Pending_Recovery', 'filter_cancel_unpaid'], WC_Twoinc_Pending_Recovery::UNPAID_FILTER_PRIORITY, 2);
        add_filter('woocommerce_cancel_unpaid_order', static function () {
            return false;
        }, 10);
        $order = self::order();
        $gateway = self::gateway(['id' => 'two-1', 'state' => 'UNVERIFIED']);
        self::setInstance($gateway);
        TinyAssert::same(false, apply_filters('woocommerce_cancel_unpaid_order', true, $order), 'merchant filter off: not cancelled');
        TinyAssert::same(['pending', []], [$order->status, $gateway->calls()], 'merchant filter off: untouched, nothing read');
        remove_all_filters('woocommerce_cancel_unpaid_order');
        self::setInstance(null);
    }

    /**
     * At the unpaid-order time limit, an order Two says it does not hold is cancelled without a cancel sent to Two,
     * but only once a second check at least 15 minutes after the first also gets Two's own not-found answer.
     */
    private static function testANotFoundOrderIsCancelledOnlyOnceConfirmed(): void
    {
        $not_found = ['error_code' => 'ORDER_NOT_FOUND', 'error_message' => 'Order Not Found'];
        $key = WC_Twoinc_Brand::meta_key('pending_not_found_at');
        // [trigger, read HTTP, answer, first not-found seconds ago (null: none), outcome, local status, order_state, not-found time kept, description]
        $cases = [
            [WC_Twoinc_Pending_Recovery::TRIGGER_UNPAID_CANCEL, 404, $not_found, null, 'read_failed', 'pending', '', true, 'first not-found: recorded, held'],
            [WC_Twoinc_Pending_Recovery::TRIGGER_UNPAID_CANCEL, 404, $not_found, 600, 'read_failed', 'pending', '', true, 'second, 10 minutes later: held'],
            [WC_Twoinc_Pending_Recovery::TRIGGER_UNPAID_CANCEL, 404, $not_found, 900, 'not_found', 'cancelled', 'CANCELLED', true, 'second, 15 minutes later: cancelled, nothing sent'],
            [WC_Twoinc_Pending_Recovery::TRIGGER_UNPAID_CANCEL, 404, ['detail' => 'Not Found'], 900, 'read_failed', 'pending', '', false, 'a 404 without Two\'s code: held, and the earlier one forgotten'],
            [WC_Twoinc_Pending_Recovery::TRIGGER_UNPAID_CANCEL, 500, $not_found, 900, 'read_failed', 'pending', '', false, 'another failure in between: the earlier not-found is forgotten'],
            [WC_Twoinc_Pending_Recovery::TRIGGER_SCHEDULED, 404, $not_found, 900, 'read_failed', 'pending', '', true, 'scheduled, inside the hold-stock limit: held'],
            [WC_Twoinc_Pending_Recovery::TRIGGER_UNPAID_CANCEL, 200, ['id' => 'two-1', 'state' => 'UNVERIFIED'], 900, 'unverified', 'cancelled', '', false, 'Two answers after all: the not-found is forgotten, and an unverified order cancelled as usual'],
        ];
        foreach ($cases as [$trigger, $read, $answer, $ago, $outcome, $local, $order_state, $kept, $description]) {
            self::reset();
            $order = self::order();
            if ($ago !== null) {
                $order->meta[$key] = time() - $ago;
            }
            $gateway = self::gateway($answer, $read);
            TinyAssert::same($outcome, WC_Twoinc_Pending_Recovery::resolve($gateway, 42, $trigger, 0)['outcome'], "$description: outcome");
            TinyAssert::same($local, $order->status, "$description: local status");
            TinyAssert::same($order_state, $order->get_meta(WC_Twoinc_Brand::meta_key('order_state')), "$description: order_state");
            TinyAssert::same($kept, (int) $order->get_meta($key) > 0, "$description: not-found time kept");
        }

        // Past the hold-stock limit the scheduled check applies the same rule.
        self::reset();
        $GLOBALS['__twoinc_test_options']['woocommerce_manage_stock'] = 'yes';
        $GLOBALS['__twoinc_test_options']['woocommerce_hold_stock_minutes'] = '60';
        $order = self::order();
        $order->created = time() - 2 * 3600;
        $order->meta[$key] = time() - 900;
        $outcome = WC_Twoinc_Pending_Recovery::resolve(self::gateway($not_found, 404), 42, WC_Twoinc_Pending_Recovery::TRIGGER_SCHEDULED, 0)['outcome'];
        unset($GLOBALS['__twoinc_test_options']['woocommerce_manage_stock'], $GLOBALS['__twoinc_test_options']['woocommerce_hold_stock_minutes']);
        TinyAssert::same(['not_found', 'cancelled', 'CANCELLED'], [$outcome, $order->status, $order->get_meta(WC_Twoinc_Brand::meta_key('order_state'))], 'scheduled, past the hold-stock limit: cancelled, nothing sent');
    }

    private static function testSelection(): void
    {
        $now = 1_800_000_000;
        $checked = WC_Twoinc_Brand::meta_key('pending_checked_at');
        $has_two_id = ['key' => 'twoinc_order_id', 'compare' => 'EXISTS'];
        [$never, $stale] = WC_Twoinc_Pending_Recovery::candidate_queries('gw', $now);
        // [query, expected subset, description]
        $cases = [
            [$never, ['status' => ['pending'], 'payment_method' => 'gw', 'return' => 'ids', 'limit' => 50], 'waiting Two orders, ids only, 50 at most'],
            [$never, ['date_created' => ($now - 7 * 86400) . '...' . ($now - 1800)], 'between 7 days and 30 minutes old'],
            [$never, ['meta_query' => [$has_two_id, ['key' => $checked, 'compare' => 'NOT EXISTS']], 'orderby' => 'date', 'order' => 'DESC'], 'never checked, newest first'],
            [$stale, ['status' => ['pending'], 'payment_method' => 'gw', 'return' => 'ids', 'limit' => 50], 'the same orders'],
            [$stale, ['meta_query' => [$has_two_id, 'checked' => ['key' => $checked, 'value' => $now - 900, 'compare' => '<=', 'type' => 'NUMERIC']], 'orderby' => ['checked' => 'ASC']], 'checked 15 minutes ago or more, oldest check first'],
        ];
        foreach ($cases as [$query, $expected, $description]) {
            $actual = array_intersect_key($query, $expected);
            ksort($actual);
            ksort($expected);
            TinyAssert::same($expected, $actual, $description);
        }

        // [never checked, stale, expected, description]
        $merges = [
            [[5, 4], [1, 2], [5, 4, 1, 2], 'never checked before stale'],
            [[3], [3, 1], [3, 1], 'an order in both is checked once'],
            [range(1, 40), range(41, 80), range(1, 50), 'at most 50 a run'],
        ];
        foreach ($merges as [$never_ids, $stale_ids, $expected, $description]) {
            TinyAssert::same($expected, WC_Twoinc_Pending_Recovery::due_ids($never_ids, $stale_ids), $description);
        }

        // The run checks what the two queries returned, loading no order before its lock.
        self::order('pending', 42);
        self::order('pending', 43);
        $GLOBALS['__twoinc_test_wc_get_orders'] = [[42], [43]];
        $gateway = self::gateway(['id' => 'two-1', 'state' => 'VERIFIED']);
        self::setInstance($gateway);
        WC_Twoinc_Pending_Recovery::run_scheduled_check();
        self::setInstance(null);
        TinyAssert::same(2, count($GLOBALS['__twoinc_test_wc_get_orders_args']), 'two id queries');
        TinyAssert::same(['processing', 'processing'], [$GLOBALS['__twoinc_test_wc_orders'][42]->status, $GLOBALS['__twoinc_test_wc_orders'][43]->status], 'both checked and confirmed');

        // The time budget: no new check starts once 60 seconds have passed; the rest waits for the next run.
        self::reset();
        foreach ([42, 43, 44] as $id) {
            self::order('pending', $id);
        }
        $GLOBALS['__twoinc_test_wc_get_orders'] = [[42, 43, 44], []];
        $gateway = self::gateway(['id' => 'two-1', 'state' => 'UNVERIFIED']);
        $ticks = [$now, $now, $now + 59, $now + 60];
        $summary = WC_Twoinc_Pending_Recovery::run_check($gateway, static function () use (&$ticks) {
            return array_shift($ticks);
        });
        TinyAssert::same(['unverified' => 2, 'deferred' => 1], $summary, 'two checked inside the budget, one deferred');
    }

    private static function testTheLockIsSharedAndReleased(): void
    {
        global $wpdb;
        $name = 'twoinc_order_' . substr(md5('wordpress|wp_'), 0, 12) . '_42';
        // [trigger, wait passed, expected wait in the query, description]
        $cases = [
            [WC_Twoinc_Pending_Recovery::TRIGGER_SCHEDULED, 0, 0, 'the scheduled check never waits'],
            [WC_Twoinc_Pending_Recovery::TRIGGER_ADMIN, null, 10, 'the admin action waits briefly'],
            [WC_Twoinc_Pending_Recovery::TRIGGER_BUYER_RETURN, null, 10, 'the return waits briefly'],
        ];
        foreach ($cases as [$trigger, $wait, $expected_wait, $description]) {
            self::reset();
            self::order();
            $gateway = self::gateway(['id' => 'two-1', 'state' => 'UNVERIFIED']);
            $wait === null
                ? WC_Twoinc_Pending_Recovery::resolve($gateway, 42, $trigger)
                : WC_Twoinc_Pending_Recovery::resolve($gateway, 42, $trigger, $wait);
            TinyAssert::same(["SELECT GET_LOCK('$name', $expected_wait)", "SELECT RELEASE_LOCK('$name')"], $GLOBALS['wpdb']->queries, $description);
        }

        // A held lock: someone else is resolving the order, so nothing is read or sent.
        self::reset();
        $order = self::order();
        $GLOBALS['wpdb']->held = [$name];
        $gateway = self::gateway(['id' => 'two-1', 'state' => 'VERIFIED']);
        TinyAssert::same('busy', WC_Twoinc_Pending_Recovery::resolve($gateway, 42, WC_Twoinc_Pending_Recovery::TRIGGER_SCHEDULED, 0)['outcome'], 'busy');
        TinyAssert::same([], $gateway->calls(), 'nothing read while another check holds the lock');

        // Once the lock is held, the order is re-read: one already processed is left alone.
        self::reset();
        self::order('processing');
        $gateway = self::gateway(['id' => 'two-1', 'state' => 'VERIFIED']);
        TinyAssert::same('not_waiting', WC_Twoinc_Pending_Recovery::resolve($gateway, 42, WC_Twoinc_Pending_Recovery::TRIGGER_SCHEDULED, 0)['outcome'], 'not waiting');
        TinyAssert::same([], $gateway->calls(), 'nothing read for an order no longer waiting');
        TinyAssert::same(2, count($GLOBALS['wpdb']->queries), 'the lock is released on an early return too');
    }

    private static function testTheOrderActionIsOfferedOnlyForAWaitingTwoOrder(): void
    {
        self::setInstance(self::gateway(null));
        $key = WC_Twoinc_Pending_Recovery::order_action_key();
        TinyAssert::same('twoinc_check_status', $key, 'action key');
        // [status, payment method, Two order id, offered, description]
        $cases = [
            ['pending', WC_Twoinc_Brand::get('gateway_id'), 'two-1', true, 'a waiting Two order'],
            ['failed', WC_Twoinc_Brand::get('gateway_id'), 'two-1', true, 'a failed Two order: the merchant asks, so it is offered'],
            ['processing', WC_Twoinc_Brand::get('gateway_id'), 'two-1', false, 'already paid'],
            ['pending', 'cod', 'two-1', false, 'another gateway'],
            ['pending', WC_Twoinc_Brand::get('gateway_id'), '', false, 'no Two order id'],
        ];
        foreach ($cases as [$status, $method, $two_id, $offered, $description]) {
            $order = self::order($status);
            $order->payment_method = $method;
            $order->meta[WC_Twoinc_Brand::prefixed_name('order_id')] = $two_id;
            $actions = WC_Twoinc_Pending_Recovery::add_order_action(['other' => 'Other'], $order);
            TinyAssert::same($offered, isset($actions[$key]), $description);
            TinyAssert::same('Other', $actions['other'], "$description: other actions kept");
        }
        TinyAssert::same('Check status with Two', WC_Twoinc_Pending_Recovery::add_order_action([], self::order())[$key], 'label');
        self::setInstance(null);
    }

    private static function testTheOrderActionParksANotice(): void
    {
        $GLOBALS['__twoinc_test_user_id'] = 1;
        // [Two state, read HTTP, notice level, notice fragment, description]
        $cases = [
            ['VERIFIED', 200, 'info', 'Confirmed with Two', 'confirmed'],
            ['UNVERIFIED', 200, 'info', 'has not finished verification', 'unverified'],
            ['VERIFIED', 0, 'error', 'Could not read the order from Two: Operation timed out', 'read failed'],
        ];
        foreach ($cases as [$state, $read, $level, $fragment, $description]) {
            self::reset();
            $order = self::order();
            self::setInstance(self::gateway(['id' => 'two-1', 'state' => $state], $read));
            WC_Twoinc_Pending_Recovery::handle_order_action($order);
            $notice = $GLOBALS['__twoinc_test_transients']['twoinc_invoice_notice_1_42'] ?? null;
            TinyAssert::same($level, $notice['level'] ?? null, "$description: level");
            TinyAssert::true(strpos($notice['message'], $fragment) !== false, "$description: message {$notice['message']}");
            TinyAssert::true(strpos(end($order->notes), $fragment) !== false, "$description: noted");
        }
        unset($GLOBALS['__twoinc_test_user_id']);
        self::setInstance(null);
    }

    private static function testTheScheduledCheckIsRegisteredAndRemoved(): void
    {
        $GLOBALS['__twoinc_test_as_schedule_calls'] = [];
        unset($GLOBALS['__twoinc_test_as_scheduled']['twoinc_check_pending_orders']);
        WC_Twoinc_Pending_Recovery::maybe_schedule();
        WC_Twoinc_Pending_Recovery::maybe_schedule();
        $calls = $GLOBALS['__twoinc_test_as_schedule_calls'];
        TinyAssert::same(1, count($calls), 'scheduled once');
        TinyAssert::same(['twoinc_check_pending_orders', 900, true], [$calls[0]['hook'], $calls[0]['interval'], $calls[0]['unique']], 'every 15 minutes, unique');

        $gateway = self::gateway(null);
        $gateway->on_deactivate_plugin();
        TinyAssert::true(empty($GLOBALS['__twoinc_test_as_scheduled']['twoinc_check_pending_orders']), 'deactivation removes it');
    }
}
