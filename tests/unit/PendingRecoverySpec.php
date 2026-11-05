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

            public function get_checkout_order_received_url()
            {
                return 'https://shop.example/thanks';
            }
        };
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
            [$unpaid, 'UNVERIFIED', 'APPROVED', 200, 'unverified', 'pending', [], null, '', 'unpaid limit, unverified: left for WooCommerce to cancel'],
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
        // [order status, Two state, read HTTP, expected URL or wp_die text, reads Two, description]
        $cases = [
            ['pending', 'VERIFIED', 200, 'https://shop.example/thanks', true, 'verified: placed'],
            ['pending', 'CONFIRMED', 200, 'https://shop.example/thanks', true, 'already confirmed: placed'],
            ['pending', 'UNVERIFIED', 200, 'https://shop.example/cancel', true, 'unverified: cancel page, as before'],
            ['pending', 'CANCELLED', 200, 'https://shop.example/cancel', true, 'cancelled at Two: cancel page'],
            ['pending', 'VERIFIED', 0, 'wp_die: Unable to retrieve', true, 'no response: error page, as before'],
            ['processing', 'CONFIRMED', 200, 'https://shop.example/thanks', false, 'a late return after the scheduled check: placed, nothing sent'],
            ['cancelled', 'CANCELLED', 200, 'https://shop.example/cancel', false, 'a late return to a cancelled order: cancel page'],
        ];
        foreach ($cases as [$status, $state, $read, $expected, $reads, $description]) {
            self::reset();
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
        // [WooCommerce would cancel, Two order, Two state, read HTTP, expected filter result, local status after, description]
        $cases = [
            [true, true, 'UNVERIFIED', 200, true, 'pending', 'unverified: WooCommerce cancels it'],
            [true, true, 'VERIFIED', 200, false, 'processing', 'verified: confirmed instead'],
            [true, true, 'CONFIRMED', 200, false, 'processing', 'confirmed at Two: processed instead'],
            [true, true, 'CANCELLED', 200, false, 'cancelled', 'cancelled at Two: cancelled here, without echoing'],
            [true, true, 'VERIFIED', 0, false, 'pending', 'no response: kept for the next run'],
            [false, true, 'VERIFIED', 200, false, 'pending', 'WooCommerce would not cancel: untouched'],
            [true, false, 'VERIFIED', 200, true, 'pending', 'another gateway\'s order: untouched'],
        ];
        foreach ($cases as [$cancel, $two, $state, $read, $expected, $local, $description]) {
            self::reset();
            $order = self::order();
            if (!$two) {
                $order->payment_method = 'cod';
            }
            $gateway = self::gateway(['id' => 'two-1', 'state' => $state], $read);
            self::setInstance($gateway);
            TinyAssert::same($expected, WC_Twoinc_Pending_Recovery::filter_cancel_unpaid($cancel, $order), "$description: filter result");
            TinyAssert::same($local, $order->status, "$description: local status");
            TinyAssert::same($cancel && $two, $gateway->calls() !== [], "$description: reads Two only when it matters");
        }
        self::setInstance(null);
    }

    private static function testSelection(): void
    {
        $now = 1_800_000_000;
        $query = WC_Twoinc_Pending_Recovery::candidate_query('gw', $now);
        TinyAssert::same(['pending'], $query['status'], 'pending only');
        TinyAssert::same('gw', $query['payment_method'], 'this gateway only');
        TinyAssert::same(($now - 7 * 86400) . '...' . ($now - 1800), $query['date_created'], 'between 7 days and 30 minutes old');
        TinyAssert::same('ids', $query['return'], 'ids, so no order is loaded before its lock');

        // [last checked by order id, expected selection, description]
        $cases = [
            [[1 => 0, 2 => 0], [1, 2], 'never checked: both, by id'],
            [[1 => $now - 899, 2 => $now - 900], [2], 'checked in the last 15 minutes: skipped'],
            [[1 => $now - 1000, 2 => $now - 5000, 3 => 0], [3, 2, 1], 'oldest check first, never checked before all'],
            [array_fill_keys(range(1, 60), 0), range(1, 50), 'at most 50 a run'],
        ];
        foreach ($cases as [$last_checked, $expected, $description]) {
            TinyAssert::same($expected, WC_Twoinc_Pending_Recovery::select_due($last_checked, $now), $description);
        }

        // The run checks what it selected, skipping a candidate with no Two order id.
        self::order('pending', 42);
        $no_two_id = self::order('pending', 43);
        unset($no_two_id->meta[WC_Twoinc_Brand::prefixed_name('order_id')]);
        $GLOBALS['__twoinc_test_wc_get_orders'] = [42, 43];
        $gateway = self::gateway(['id' => 'two-1', 'state' => 'VERIFIED']);
        self::setInstance($gateway);
        WC_Twoinc_Pending_Recovery::run_scheduled_check();
        self::setInstance(null);
        TinyAssert::same(['GET /v1/order/two-1', 'POST /v1/order/two-1/confirm'], $gateway->calls(), 'one order checked and confirmed');
        TinyAssert::same('processing', $GLOBALS['__twoinc_test_wc_orders'][42]->status, 'the verified order is processed');
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
