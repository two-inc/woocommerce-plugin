<?php

declare(strict_types=1);

/**
 * The payment term the buyer chose reaches the order Two is asked to create (ABN-621).
 *
 * Drives the whole chain with nothing stubbed on it: the select-term AJAX
 * (WC_Twoinc_Payment_Terms::ajax_select_term, which records the selection in
 * the session) or the hidden checkout field posted with the submit, then
 * WC_Twoinc::process_payment(), the real get_order_payload_terms() /
 * compose_twoinc_order(), and the real make_request(). The body is read at
 * wp_remote_request(), the lowest seam the offline suite has: it is the exact
 * JSON that would be serialised onto POST /v1/order. Only the answers on the
 * wire are canned.
 *
 * A default-only test cannot see a dropped selection, because a dropped
 * selection and the default look identical on the wire. Hence the offered set
 * {30, 60, 90} with 30 the default, and a row per non-default term.
 */
final class OrderTermWireSpec
{
    private const COMPANY_ID = '912345678';

    public static function runAll(): void
    {
        self::testSelectedTermIsWhatTheOrderBodyCarries();
        self::testTermThatIsNotOfferedIsNotSilentlyReplacedByTheDefault();
        print("OrderTermWireSpec passed.\n");
    }

    /**
     * A gateway whose settings are fixed and nothing else: make_request() and
     * make_order_request() are the real ones.
     */
    private static function gateway(string $termType): WC_Twoinc
    {
        return new class ($termType) extends WC_Twoinc {
            public $icon = '';
            private $termType;

            public function __construct(string $termType)
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
                $this->termType = $termType;
            }

            public function get_merchant_id()
            {
                return 'mid';
            }

            public function get_option($key, $empty_value = null)
            {
                $options = [
                    'api_key' => 'key',
                    'payment_terms_days' => ['30', '60', '90'],
                    'default_payment_term' => '30',
                    'payment_terms_type' => $this->termType,
                ];
                return $options[$key] ?? $empty_value ?? '';
            }

            public function get_merchant_available_terms(): array
            {
                return [30, 60, 90];
            }

            public function get_merchant_default_term(): ?int
            {
                return 30;
            }

            public function get_supported_buyer_countries()
            {
                return null;
            }
        };
    }

    private static function order()
    {
        $order = new class extends StubOrder {
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
        };
        $order->payment_method = WC_Twoinc_Brand::get('gateway_id');

        return $order;
    }

    /**
     * The buyer chooses a term and places the order.
     *
     * @param string $channel 'ajax' records the selection through the select-term AJAX and posts no term with the
     *                        submit; 'posted' leaves the session on the default and posts the hidden field with the submit
     *
     * @return array{0:array,1:?array,2:object,3:mixed} the select-term reply (ajax only), the POST /v1/order body
     *                                                  (null when none was sent), the order, process_payment()'s result
     */
    private static function placeOrderSelecting(string $channel, int $selectedDays, string $termType): array
    {
        $gateway = self::gateway($termType);
        $order = self::order();
        $GLOBALS['__twoinc_test_wc_orders'] = [42 => $order];
        $GLOBALS['__twoinc_test_notices'] = [];
        $GLOBALS['__twoinc_test_logs'] = [];
        $GLOBALS['__twoinc_test_http_calls'] = [];
        $GLOBALS['__twoinc_test_http_response'] = [
            'response' => ['code' => 200],
            'body' => '{"id":"two-1","status":"APPROVED","state":"VERIFIED","payment_url":"https://pay.example/1","merchant_urls":{"merchant_confirmation_url":"https://shop.example/thanks"}}',
            'headers' => [],
        ];
        WC()->session = new StubSession();
        WC()->cart = new StubCart(150.0, 21.0, false);
        $_POST = [];
        $_REQUEST = [];

        $instance = new ReflectionProperty(WC_Twoinc::class, 'instance');
        $instance->setAccessible(true);
        $instance->setValue(null, $gateway);
        $reply = [];
        try {
            if ($channel === 'ajax') {
                // 1. The buyer picks a chip: the checkout posts it and the plugin records it in the session.
                $_POST = ['days' => (string) $selectedDays];
                $GLOBALS['__twoinc_test_ajax_json'] = null;
                WC_Twoinc_Payment_Terms::ajax_select_term();
                $reply = (array) $GLOBALS['__twoinc_test_ajax_json'];
                $_POST = [];
            } else {
                // The session has not caught up with the chip: the hidden field is the only signal on the submit.
                WC()->session->set(WC_Twoinc_Payment_Terms::SESSION_KEY, 30);
                $_POST = [WC_Twoinc_Payment_Terms::SESSION_KEY => (string) $selectedDays];
            }

            // 2. The buyer submits payment.
            $_POST += ['company_id' => self::COMPANY_ID, 'company_name' => 'Buyer AS', WC_Twoinc::TERMS_CONSENT_FIELD => '1'];
            $result = $gateway->process_payment(42);
        } finally {
            $instance->setValue(null, null);
            $_POST = [];
        }

        $bodies = [];
        foreach ($GLOBALS['__twoinc_test_http_calls'] as $call) {
            $path = (string) parse_url($call['url'], PHP_URL_PATH);
            if (($call['args']['method'] ?? '') === 'POST' && $path === '/v1/order') {
                $bodies[] = json_decode((string) $call['args']['body'], true);
            }
        }
        TinyAssert::true(count($bodies) <= 1, 'at most one POST /v1/order reached the wire');

        return [$reply, $bodies[0] ?? null, $order, $result];
    }

    private static function testSelectedTermIsWhatTheOrderBodyCarries(): void
    {
        // [channel, selected days, term type, expected duration_days, expected calculated_from, description]
        $cases = [
            ['ajax', 30, 'standard', 30, null, 'the default recorded through the AJAX is sent as 30 (control)'],
            ['ajax', 60, 'standard', 60, null, 'a non-default 60 recorded through the AJAX is sent as 60, not the 30-day default'],
            ['ajax', 90, 'standard', 90, null, 'a non-default 90 recorded through the AJAX is sent as 90, not the 30-day default'],
            ['ajax', 60, 'end_of_month', 60, 'END_OF_MONTH', 'an end-of-month 60 recorded through the AJAX is sent as 60 with END_OF_MONTH'],
            ['ajax', 90, 'end_of_month', 90, 'END_OF_MONTH', 'an end-of-month 90 recorded through the AJAX is sent as 90 with END_OF_MONTH'],
            ['posted', 30, 'standard', 30, null, 'the default posted with the submit is sent as 30 (control)'],
            ['posted', 60, 'standard', 60, null, 'a non-default 60 posted with the submit is sent as 60 while the session still holds 30'],
            ['posted', 90, 'standard', 90, null, 'a non-default 90 posted with the submit is sent as 90 while the session still holds 30'],
            ['posted', 60, 'end_of_month', 60, 'END_OF_MONTH', 'an end-of-month 60 posted with the submit is sent as 60 with END_OF_MONTH'],
        ];
        foreach ($cases as [$channel, $selected, $termType, $expectedDays, $expectedFrom, $description]) {
            [, $body, $order, $result] = self::placeOrderSelecting($channel, $selected, $termType);

            TinyAssert::same('success', $result['result'] ?? null, $description . ': the order was placed: ' . json_encode($result));
            TinyAssert::true(is_array($body), $description . ': POST /v1/order reached the wire');
            $terms = $body['terms'] ?? null;
            TinyAssert::true(is_array($terms), $description . ': the body carries a terms object');
            TinyAssert::same('NET_TERMS', $terms['type'] ?? null, $description . ': terms.type');
            TinyAssert::same($expectedDays, $terms['duration_days'] ?? null, $description . ': terms.duration_days');
            TinyAssert::same($expectedFrom, $terms['duration_days_calculated_from'] ?? null, $description . ': terms.duration_days_calculated_from');
            TinyAssert::same($expectedDays, $order->meta[WC_Twoinc_Brand::meta_key('selected_term_days')] ?? null, $description . ': the order records the term it was sent with');
        }
    }

    /**
     * CURRENT BEHAVIOUR for a term that is not offered, pinned so a change in
     * either direction is a deliberate, visible edit. It differs by channel:
     *
     * - Posted with the submit: refused. process_payment() stops before
     *   POST /v1/order and tells the buyer the term is no longer available.
     * - Recorded through the select-term AJAX: FINDING, a silent default.
     *   set_selected_term() quietly substitutes the default, the AJAX answers
     *   success with the substituted term, and a submit that carries no posted
     *   term goes out as the 30-day default although the request named 45.
     *   The hidden field a real checkout posts alongside would catch it (the
     *   first row), so the exposure is a client that records a term and
     *   submits without the field.
     */
    private static function testTermThatIsNotOfferedIsNotSilentlyReplacedByTheDefault(): void
    {
        // [channel, selected days, POST /v1/order duration_days today (null: refused, none sent), description]
        $cases = [
            ['posted', 45, null, 'a 45 posted with the submit is not offered and the submit is refused before POST /v1/order'],
            ['ajax', 45, 30, 'FINDING, silent default: a 45 recorded through the AJAX is not offered and is sent as the 30-day default'],
        ];
        foreach ($cases as [$channel, $selected, $currentDays, $description]) {
            [$reply, $body, , $result] = self::placeOrderSelecting($channel, $selected, 'standard');

            if ($currentDays === null) {
                TinyAssert::same('failure', $result['result'] ?? null, $description . ': the submit fails');
                TinyAssert::same(null, $body, $description . ': nothing is sent to POST /v1/order');
                continue;
            }
            TinyAssert::same('success', $result['result'] ?? null, $description . ': the order is placed');
            TinyAssert::same($currentDays, $body['terms']['duration_days'] ?? null, $description . ': terms.duration_days');
            TinyAssert::same(['success' => true, 'data' => ['selected' => $currentDays]], $reply, $description . ': the AJAX reports success with the substituted term');
        }
    }
}
