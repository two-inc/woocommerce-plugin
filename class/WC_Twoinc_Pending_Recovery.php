<?php

/**
 * Recovers Two orders the buyer verified but never returned from (TWO-26300).
 *
 * The buyer's return to the shop used to be the only route by which a placed order became a paid one. One
 * resolver now serves four triggers: the buyer's return, a scheduled check every 15 minutes, the admin "Check
 * status with Two" order action, and WooCommerce's unpaid-order time limit. It reads the order from Two and
 * acts on its state, under a per-order lock all four share, re-reading the local order once it holds the lock
 * so whichever arrives second finds the work done.
 */

if (!class_exists('WC_Twoinc_Pending_Recovery')) {
    class WC_Twoinc_Pending_Recovery
    {
        public const TRIGGER_BUYER_RETURN = 'confirmation_redirect';
        public const TRIGGER_SCHEDULED = 'scheduled_check';
        public const TRIGGER_ADMIN = 'admin_check';
        public const TRIGGER_UNPAID_CANCEL = 'unpaid_order_cancel';

        public const INTERVAL = 900;
        public const MIN_AGE = 1800;
        public const MAX_AGE = 7 * 86400;
        public const RECHECK_AFTER = 900;
        public const BATCH_SIZE = 50;
        /** Seconds after which a scheduled run starts no new check, well inside Action Scheduler's own timeout. */
        public const RUN_BUDGET = 60;
        /** A check that keeps failing for an order is logged as an error at most this often. */
        public const ERROR_LOG_INTERVAL = 86400;
        /** Seconds the buyer's return and the admin action wait for a held lock; the scheduled check never waits. */
        public const INTERACTIVE_LOCK_WAIT = 10;
        /**
         * The statuses the buyer's return finds an order waiting in. WooCommerce's classic checkout resumes a
         * failed order without setting it back to pending, so a buyer can pay a failed order with Two. Everything
         * else acts on pending orders only, leaving a failed status a merchant set by hand alone.
         */
        public const RETURN_WAITING_STATUSES = ['pending', 'failed'];

        public const ACTION_WAIT = 'wait';
        public const ACTION_CONFIRM = 'confirm';
        public const ACTION_PROCESS = 'process';
        public const ACTION_CANCEL = 'cancel';
        public const ACTION_DECLINE = 'decline';
        public const ACTION_UNKNOWN = 'unknown';

        public const OUTCOME_UNVERIFIED = 'unverified';
        public const OUTCOME_CONFIRMED = 'confirmed';
        public const OUTCOME_PROCESSED = 'processed';
        public const OUTCOME_CANCELLED = 'cancelled';
        public const OUTCOME_DECLINED = 'declined';
        public const OUTCOME_UNKNOWN = 'unknown';
        public const OUTCOME_REFUSED = 'refused';
        public const OUTCOME_READ_FAILED = 'read_failed';
        public const OUTCOME_BUSY = 'busy';
        public const OUTCOME_NOT_WAITING = 'not_waiting';
        public const OUTCOME_NOT_FOUND = 'not_found';

        private const PROCESS_STATES = ['CONFIRMED', 'FULFILLING', 'FULFILLED', 'DELIVERED', 'FULFILMENT_NEEDS_MANUAL_RESOLUTION'];

        /** Brand-prefixed like the FX refresh: `twoinc_check_pending_orders` for Two. */
        public static function hook(): string
        {
            return WC_Twoinc_Brand::prefixed_name('check_pending_orders');
        }

        public static function order_action_key(): string
        {
            return WC_Twoinc_Brand::prefixed_name('check_status');
        }

        /** Registers the recurring check with Action Scheduler, as WC_Twoinc_FX::maybe_schedule_refresh() does. */
        public static function maybe_schedule(): void
        {
            if (!function_exists('as_schedule_recurring_action') || !function_exists('as_has_scheduled_action')) {
                return;
            }
            if (as_has_scheduled_action(self::hook())) {
                return;
            }
            // $unique: two cold requests must not start two recurring series.
            as_schedule_recurring_action(time() + self::INTERVAL, self::INTERVAL, self::hook(), [], 'twoinc-payment-gateway', true);
        }

        /**
         * What the plugin does about the order Two reports. A REJECTED or DECLINED status is treated as a
         * cancellation, since Two never approves such an order.
         */
        public static function action_for(string $state, string $status = ''): string
        {
            if (in_array(strtoupper($status), ['REJECTED', 'DECLINED'], true)) {
                return self::ACTION_DECLINE;
            }
            $state = strtoupper($state);
            if ($state === 'UNVERIFIED') {
                return self::ACTION_WAIT;
            }
            if ($state === 'VERIFIED') {
                return self::ACTION_CONFIRM;
            }
            if (in_array($state, self::PROCESS_STATES, true)) {
                return self::ACTION_PROCESS;
            }
            if ($state === 'CANCELLED') {
                return self::ACTION_CANCEL;
            }
            return self::ACTION_UNKNOWN;
        }

        /**
         * wc_get_orders() arguments for the scheduled check, at UTC time $now: waiting Two orders with a Two order
         * id, created between MIN_AGE and MAX_AGE ago. The first query takes those never checked, newest first; the
         * second those last checked at least RECHECK_AFTER ago, oldest check first. Both return ids only.
         *
         * @return array{0: array, 1: array}
         */
        public static function candidate_queries(string $gateway_id, int $now): array
        {
            $base = [
                'status' => self::waiting_statuses(self::TRIGGER_SCHEDULED),
                'payment_method' => $gateway_id,
                'date_created' => ($now - self::MAX_AGE) . '...' . ($now - self::MIN_AGE),
                'limit' => self::BATCH_SIZE,
                'return' => 'ids',
            ];
            $has_two_id = ['key' => WC_Twoinc_Brand::prefixed_name('order_id'), 'compare' => 'EXISTS'];
            return [
                $base + [
                    'meta_query' => [$has_two_id, ['key' => self::last_checked_key(), 'compare' => 'NOT EXISTS']],
                    'orderby' => 'date',
                    'order' => 'DESC',
                ],
                $base + [
                    'meta_query' => [
                        $has_two_id,
                        'checked' => ['key' => self::last_checked_key(), 'value' => $now - self::RECHECK_AFTER, 'compare' => '<=', 'type' => 'NUMERIC'],
                    ],
                    'orderby' => ['checked' => 'ASC'],
                ],
            ];
        }

        /**
         * The orders a run checks: the never-checked ones first, at most BATCH_SIZE.
         *
         * @param int[] $never_checked
         * @param int[] $stale
         * @return int[]
         */
        public static function due_ids(array $never_checked, array $stale): array
        {
            return array_slice(array_values(array_unique(array_map('intval', array_merge($never_checked, $stale)))), 0, self::BATCH_SIZE);
        }

        /** The Action Scheduler callback. Static and self-bootstrapping, as it runs outside any gateway context. */
        public static function run_scheduled_check(): void
        {
            $gateway = WC_Twoinc::get_instance();
            if (!$gateway->get_option('api_key') || !$gateway->get_merchant_id()) {
                return;
            }
            self::run_check($gateway, 'time');
        }

        /**
         * One scheduled run. Starts no new check once RUN_BUDGET seconds have passed by $clock; what is left
         * waits for the next run.
         *
         * @return array<string,int> outcome => count, plus `deferred`
         */
        public static function run_check(WC_Twoinc $gateway, callable $clock): array
        {
            $start = (int) $clock();
            [$never_query, $stale_query] = self::candidate_queries($gateway->id, $start);
            /** @var int[] $never_checked the query asks for ids */
            $never_checked = wc_get_orders($never_query);
            /** @var int[] $stale the query asks for ids */
            $stale = wc_get_orders($stale_query);
            $ids = self::due_ids($never_checked, $stale);
            $summary = [];
            foreach ($ids as $i => $order_id) {
                if ((int) $clock() - $start >= self::RUN_BUDGET) {
                    $summary['deferred'] = count($ids) - $i;
                    break;
                }
                $outcome = self::resolve($gateway, $order_id, self::TRIGGER_SCHEDULED, 0)['outcome'];
                $summary[$outcome] = ($summary[$outcome] ?? 0) + 1;
            }
            self::log('debug', sprintf('Scheduled pending-order check: %d due, results %s', count($ids), wp_json_encode((object) $summary)));
            return $summary;
        }

        /**
         * Reads the order from Two and acts on its state. A cancel reaches Two only from WooCommerce's
         * unpaid-order time limit, for an order Two still reports UNVERIFIED or one past the 7-day window that
         * Two cannot be read for, as it did before.
         *
         * @return array{outcome: string, state: string, message: string}
         */
        public static function resolve(WC_Twoinc $gateway, int $order_id, string $trigger, int $lock_wait = self::INTERACTIVE_LOCK_WAIT): array
        {
            if (!self::lock($order_id, $lock_wait)) {
                self::log('info', sprintf('Pending check skipped for order %d (%s): another check holds its lock.', $order_id, $trigger));
                return self::result(self::OUTCOME_BUSY);
            }
            try {
                return self::resolve_locked($gateway, $order_id, $trigger);
            } finally {
                self::unlock($order_id);
            }
        }

        private static function resolve_locked(WC_Twoinc $gateway, int $order_id, string $trigger): array
        {
            $order = self::fresh_order($order_id);
            if (!$order || !WC_Twoinc_Helper::is_twoinc_order($order) || !in_array($order->get_status(), self::waiting_statuses($trigger), true)) {
                return self::result(self::OUTCOME_NOT_WAITING);
            }
            $two_order_id = (string) $gateway->get_twoinc_order_id($order);
            if ($two_order_id === '') {
                return self::result(self::OUTCOME_NOT_WAITING);
            }
            // WooCommerce's unpaid-order time limit applies: from its own hook, or from the scheduled check once the
            // order is past it, since on HPOS the check's own save keeps the order too recent for WooCommerce's query.
            $at_time_limit = $trigger === self::TRIGGER_UNPAID_CANCEL
                || ($trigger === self::TRIGGER_SCHEDULED && self::is_past_hold_stock_limit($order));

            $response = $gateway->make_request("/v1/order/{$two_order_id}", [], 'GET', [], null, 15);
            $order->update_meta_data(self::last_checked_key(), time());
            $http = is_wp_error($response) ? 0 : (int) wp_remote_retrieve_response_code($response);
            $raw = is_wp_error($response) ? '' : (string) wp_remote_retrieve_body($response);
            $body = $http >= 200 && $http < 300 ? json_decode($raw, true) : null;
            if (!is_array($body) || !isset($body['state'])) {
                $reason = is_wp_error($response) ? $response->get_error_message() : 'HTTP ' . $http;
                return self::read_failed($order, $trigger, $at_time_limit, $two_order_id, $http, $raw, $reason);
            }
            $not_found_key = self::not_found_key();
            if ($order->get_meta($not_found_key, true)) {
                $order->delete_meta_data($not_found_key);
            }

            $state = strtoupper((string) $body['state']);
            $action = self::action_for($state, (string) ($body['status'] ?? ''));
            self::log('info', sprintf('Pending check for order %d, %s order %s (%s): state %s, action %s', $order_id, self::product(), $two_order_id, $trigger, $state, $action));

            switch ($action) {
                case self::ACTION_WAIT:
                    $outcome = self::OUTCOME_UNVERIFIED;
                    if ($at_time_limit) {
                        // Cancelled as WooCommerce would, under the lock and to the order as stored now. The
                        // cancel goes to Two too, as it always has for an order the buyer never verified.
                        $order->add_order_note(self::note($outcome, $state, self::TRIGGER_UNPAID_CANCEL));
                        $order->update_status('cancelled');
                    } elseif ($trigger === self::TRIGGER_ADMIN) {
                        $order->add_order_note(self::note($outcome, $state, $trigger));
                    } elseif ($trigger === self::TRIGGER_BUYER_RETURN) {
                        // As before: a return Two has not verified fails, and the buyer is sent to the cancel page.
                        $order->add_order_note(sprintf(__('Unable to confirm the order with %s.', 'twoinc-payment-gateway'), self::product()));
                    }
                    $order->save();
                    return self::result($outcome, $state);

                case self::ACTION_CONFIRM:
                    // Sent with no body whatever the postprocessing hook does, so it never refuses (TWO-26340).
                    $confirm = $gateway->make_order_request('order_confirm', $trigger, "/v1/order/{$two_order_id}/confirm", [], 'POST', $order);
                    $error = is_wp_error($confirm) ? $confirm->get_error_message() : WC_Twoinc_Helper::get_twoinc_error_msg($confirm);
                    if ($error) {
                        $order->add_order_note(sprintf(__('Unable to confirm the order with %s.', 'twoinc-payment-gateway'), self::product()));
                        $order->save();
                        self::log('error', sprintf('Pending check for order %d (%s): confirm refused: %s', $order_id, $trigger, $error));
                        return self::result(self::OUTCOME_REFUSED, $state, (string) $error);
                    }
                    return self::complete($order, self::OUTCOME_CONFIRMED, 'CONFIRMED', $trigger, $two_order_id);

                case self::ACTION_PROCESS:
                    return self::complete($order, self::OUTCOME_PROCESSED, $state, $trigger, $two_order_id);

                case self::ACTION_CANCEL:
                case self::ACTION_DECLINE:
                    $outcome = $action === self::ACTION_CANCEL ? self::OUTCOME_CANCELLED : self::OUTCOME_DECLINED;
                    // Stored first, so on_order_cancelled() reads the order as already cancelled at Two and sends nothing.
                    $order->update_meta_data(WC_Twoinc_Brand::meta_key('order_state'), 'CANCELLED');
                    $order->add_order_note(self::note($outcome, $state, $trigger));
                    if ($trigger === self::TRIGGER_BUYER_RETURN) {
                        // The buyer is sent to the cancel URL, where WooCommerce cancels it and tells them so.
                        $order->save();
                    } else {
                        $order->update_status('cancelled');
                    }
                    return self::result($outcome, $state);
            }

            self::log('warning', sprintf('Pending check for order %d (%s): %s reports state %s; not changed.', $order_id, $trigger, self::product(), $state));
            // Noted once per state, not on every run.
            $noted_key = WC_Twoinc_Brand::meta_key('pending_unknown_state');
            if ($order->get_meta($noted_key, true) !== $state || $trigger === self::TRIGGER_ADMIN) {
                $order->update_meta_data($noted_key, $state);
                $order->add_order_note(self::note(self::OUTCOME_UNKNOWN, $state, $trigger));
            }
            $order->save();
            return self::result(self::OUTCOME_UNKNOWN, $state);
        }

        /** Marks the order paid exactly as the buyer's return always has. */
        private static function complete($order, string $outcome, string $state, string $trigger, string $two_order_id): array
        {
            $note = $trigger === self::TRIGGER_BUYER_RETURN
                ? sprintf(__('Order ID %s has been placed with %s.', 'twoinc-payment-gateway'), $two_order_id, self::product())
                : self::note($outcome, $state, $trigger);
            $order->add_order_note($note);
            $order->update_meta_data(WC_Twoinc_Brand::meta_key('order_state'), $state);
            $order->save();
            $order->payment_complete();
            return self::result($outcome, $state);
        }

        /**
         * The order could not be read from Two. Nothing changes, except at WooCommerce's unpaid-order time limit:
         * an order Two has reported as not found on two checks at least RECHECK_AFTER apart is cancelled here
         * without a cancel sent to Two, and one past the scheduled check's 7-day window is cancelled as WooCommerce
         * always did. A check that keeps failing is logged as an error once a day, not on every run.
         */
        private static function read_failed($order, string $trigger, bool $at_time_limit, string $two_order_id, int $http, string $raw, string $reason): array
        {
            $not_found = self::is_not_found($http, $raw);
            $first_not_found = (int) $order->get_meta(self::not_found_key(), true);
            if ($not_found && !$first_not_found) {
                $order->update_meta_data(self::not_found_key(), time());
            } elseif (!$not_found && $first_not_found) {
                $order->delete_meta_data(self::not_found_key());
            }

            $interactive = in_array($trigger, [self::TRIGGER_BUYER_RETURN, self::TRIGGER_ADMIN], true);
            $logged_key = WC_Twoinc_Brand::meta_key('pending_error_logged_at');
            $message = sprintf('Pending check for order %d, %s order %s (%s): could not read the order: %s', $order->get_id(), self::product(), $two_order_id, $trigger, $reason);
            if ($interactive || time() - (int) $order->get_meta($logged_key, true) >= self::ERROR_LOG_INTERVAL) {
                self::log('error', $message);
                if (!$interactive) {
                    $order->update_meta_data($logged_key, time());
                }
            } else {
                self::log('debug', $message);
            }

            if ($trigger === self::TRIGGER_BUYER_RETURN) {
                $order->add_order_note(sprintf(__('Unable to retrieve %s order information.', 'twoinc-payment-gateway'), self::product()));
            } elseif ($at_time_limit && $not_found && $first_not_found && time() - $first_not_found >= self::RECHECK_AFTER) {
                $order->update_meta_data(WC_Twoinc_Brand::meta_key('order_state'), 'CANCELLED');
                $order->add_order_note(self::note(self::OUTCOME_NOT_FOUND, '', self::TRIGGER_UNPAID_CANCEL));
                $order->update_status('cancelled');
                return self::result(self::OUTCOME_NOT_FOUND, '', $reason);
            } elseif ($at_time_limit && !$not_found && self::is_past_window($order)) {
                $order->update_status('cancelled');
            }
            $order->save();
            return self::result(self::OUTCOME_READ_FAILED, '', $reason);
        }

        /** Two's own answer for an order it does not hold: HTTP 404 with its ORDER_NOT_FOUND error code. */
        public static function is_not_found(int $http, string $raw): bool
        {
            $body = json_decode($raw, true);
            return $http === 404 && is_array($body) && ($body['error_code'] ?? null) === 'ORDER_NOT_FOUND';
        }

        private static function not_found_key(): string
        {
            return WC_Twoinc_Brand::meta_key('pending_not_found_at');
        }

        /** The statuses an order waits for payment in, for this trigger. */
        public static function waiting_statuses(string $trigger): array
        {
            return $trigger === self::TRIGGER_BUYER_RETURN ? self::RETURN_WAITING_STATUSES : ['pending'];
        }

        private static function is_past_window($order): bool
        {
            $created = $order->get_date_created();
            return $created && time() - $created->getTimestamp() > self::MAX_AGE;
        }

        /**
         * Whether WooCommerce's unpaid-order time limit would cancel this order by now, counted from its creation:
         * hold stock on, the order older than the hold time, and made by the checkout, as WooCommerce's own default.
         */
        private static function is_past_hold_stock_limit($order): bool
        {
            $minutes = (int) get_option('woocommerce_hold_stock_minutes');
            if ($minutes < 1 || get_option('woocommerce_manage_stock') !== 'yes' || $order->get_created_via() !== 'checkout') {
                return false;
            }
            $created = $order->get_date_created();
            return $created && time() - $created->getTimestamp() >= $minutes * 60;
        }

        /** The merchant-only order note: what Two reported and what changed, then which check found it. */
        public static function note(string $outcome, string $state, string $trigger): string
        {
            return trim(self::outcome_message($outcome, $state) . ' ' . self::trigger_message($trigger));
        }

        public static function outcome_message(string $outcome, string $state = '', string $detail = ''): string
        {
            $product = self::product();
            switch ($outcome) {
                case self::OUTCOME_UNVERIFIED:
                    /* translators: %s is the brand product name (e.g. "Two") */
                    return sprintf(__('Checked with %s: the buyer has not finished verification.', 'twoinc-payment-gateway'), $product);
                case self::OUTCOME_CONFIRMED:
                    /* translators: %1$s is the brand product name (e.g. "Two") */
                    return sprintf(__('The buyer verified this order with %1$s but did not return to the shop. Confirmed with %1$s.', 'twoinc-payment-gateway'), $product);
                case self::OUTCOME_PROCESSED:
                    /* translators: %1$s is the brand product name (e.g. "Two") */
                    return sprintf(__('The buyer verified this order with %1$s but did not return to the shop. %1$s had already confirmed it.', 'twoinc-payment-gateway'), $product);
                case self::OUTCOME_CANCELLED:
                    /* translators: %s is the brand product name (e.g. "Two") */
                    return sprintf(__('%s reports this order as cancelled. Cancelled here to match.', 'twoinc-payment-gateway'), $product);
                case self::OUTCOME_DECLINED:
                    /* translators: %s is the brand product name (e.g. "Two") */
                    return sprintf(__('%s declined this order. Cancelled here to match.', 'twoinc-payment-gateway'), $product);
                case self::OUTCOME_NOT_FOUND:
                    /* translators: %s is the brand product name (e.g. "Two") */
                    return sprintf(__('%s has no record of this order. Cancelled here without a cancel sent to it.', 'twoinc-payment-gateway'), $product);
                case self::OUTCOME_UNKNOWN:
                    /* translators: %1$s is the brand product name (e.g. "Two"), %2$s the order state it reports */
                    return sprintf(__('%1$s reports state %2$s; not changed. Check the order in the %1$s portal.', 'twoinc-payment-gateway'), $product, $state);
                case self::OUTCOME_REFUSED:
                    return sprintf(__('Unable to confirm the order with %s.', 'twoinc-payment-gateway'), $product);
                case self::OUTCOME_READ_FAILED:
                    /* translators: %1$s is the brand product name (e.g. "Two"), %2$s the reason the read failed */
                    return sprintf(__('Could not read the order from %1$s: %2$s', 'twoinc-payment-gateway'), $product, $detail);
                case self::OUTCOME_BUSY:
                    /* translators: %s is the brand product name (e.g. "Two") */
                    return sprintf(__('This order is being checked with %s already. Reload the page in a moment.', 'twoinc-payment-gateway'), $product);
            }
            return __('This order is no longer waiting for payment, so it was not checked.', 'twoinc-payment-gateway');
        }

        private static function trigger_message(string $trigger): string
        {
            switch ($trigger) {
                case self::TRIGGER_SCHEDULED:
                    return __('Found by the scheduled check.', 'twoinc-payment-gateway');
                case self::TRIGGER_UNPAID_CANCEL:
                    return __('Found when the unpaid order time limit was reached.', 'twoinc-payment-gateway');
                case self::TRIGGER_ADMIN:
                    $user = wp_get_current_user();
                    $name = $user && isset($user->display_name) ? (string) $user->display_name : '';
                    if ($name === '') {
                        $name = __('an administrator', 'twoinc-payment-gateway');
                    }
                    /* translators: %s is the name of the admin user who ran the check */
                    return sprintf(__('Checked by %s.', 'twoinc-payment-gateway'), $name);
            }
            return '';
        }

        /** `woocommerce_order_actions`: offered for a Two order still waiting for the buyer, at any age. */
        public static function add_order_action($actions, $order = null)
        {
            if (!$order) {
                global $theorder;
                $order = $theorder;
            }
            if (!is_array($actions) || !$order || !WC_Twoinc_Helper::is_twoinc_order($order) || !in_array($order->get_status(), self::waiting_statuses(self::TRIGGER_ADMIN), true)) {
                return $actions;
            }
            $gateway = WC_Twoinc::get_instance();
            if (!$gateway->get_twoinc_order_id($order)) {
                return $actions;
            }
            /* translators: %s is the brand product name (e.g. "Two") */
            $actions[self::order_action_key()] = sprintf(__('Check status with %s', 'twoinc-payment-gateway'), self::product());
            return $actions;
        }

        /** `woocommerce_order_action_<key>`: runs the resolver now and parks the outcome as an admin notice. */
        public static function handle_order_action($order): void
        {
            $result = self::resolve(WC_Twoinc::get_instance(), (int) $order->get_id(), self::TRIGGER_ADMIN);
            $failed = in_array($result['outcome'], [self::OUTCOME_READ_FAILED, self::OUTCOME_REFUSED, self::OUTCOME_BUSY], true);
            if ($result['outcome'] === self::OUTCOME_READ_FAILED) {
                $order->add_order_note(self::outcome_message($result['outcome'], $result['state'], $result['message']));
            }
            WC_Twoinc::park_order_notice(
                (int) $order->get_id(),
                $failed ? 'error' : 'info',
                self::outcome_message($result['outcome'], $result['state'], $result['message'])
            );
        }

        /**
         * `woocommerce_cancel_unpaid_order`: WooCommerce's hold-stock time limit would cancel a pending order, and
         * the cancel would reach Two even when the buyer had verified. The resolver runs instead and cancels the
         * order only while Two still reports it UNVERIFIED, when Two has no record of it, or when Two cannot be
         * read and the order is past the 7-day window.
         */
        public static function filter_cancel_unpaid($cancel, $order)
        {
            if (!$cancel || !$order || !WC_Twoinc_Helper::is_twoinc_order($order)) {
                return $cancel;
            }
            $gateway = WC_Twoinc::get_instance();
            if (!$gateway->get_option('api_key') || !$gateway->get_merchant_id()) {
                return $cancel;
            }
            // No Two order id: the order was never created at Two (refused or failed at checkout), so there is
            // nothing to ask and WooCommerce cancels it as it would any other unpaid order.
            if (!$gateway->get_twoinc_order_id($order)) {
                return $cancel;
            }
            // The resolver cancels the order itself when it should go, under the lock and on the order as stored
            // now. WooCommerce's copy was read before the lock and must not be cancelled from here.
            self::resolve($gateway, (int) $order->get_id(), self::TRIGGER_UNPAID_CANCEL, 0);
            return false;
        }

        private static function result(string $outcome, string $state = '', string $message = ''): array
        {
            return ['outcome' => $outcome, 'state' => $state, 'message' => $message];
        }

        private static function last_checked_key(): string
        {
            return WC_Twoinc_Brand::meta_key('pending_checked_at');
        }

        private static function product(): string
        {
            return (string) WC_Twoinc_Brand::get('product_name');
        }

        /** Server-wide MySQL lock, so it is named for this site's database and table prefix. */
        private static function lock_name(int $order_id): string
        {
            global $wpdb;
            return WC_Twoinc_Brand::prefixed_name('order_') . substr(md5($wpdb->dbname . '|' . $wpdb->prefix), 0, 12) . '_' . $order_id;
        }

        private static function lock(int $order_id, int $wait): bool
        {
            global $wpdb;
            return (string) $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, %d)', self::lock_name($order_id), $wait)) === '1';
        }

        private static function unlock(int $order_id): void
        {
            global $wpdb;
            $wpdb->query($wpdb->prepare('SELECT RELEASE_LOCK(%s)', self::lock_name($order_id)));
        }

        /** The order as stored now: another request may have changed it since this one first read it. */
        private static function fresh_order(int $order_id)
        {
            clean_post_cache($order_id);
            $order_cache = 'Automattic\WooCommerce\Caches\OrderCache';
            if (function_exists('wc_get_container') && class_exists($order_cache)) {
                wc_get_container()->get($order_cache)->remove($order_id);
            }
            return wc_get_order($order_id);
        }

        private static function log(string $level, string $message): void
        {
            if (function_exists('wc_get_logger')) {
                wc_get_logger()->{$level}($message, ['source' => 'twoinc-payment-gateway']);
            }
        }
    }
}
