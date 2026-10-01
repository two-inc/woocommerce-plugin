<?php

declare(strict_types=1);

/**
 * Tax codes on 0% lines (TWO-24877): the merchant's per-tax-class mapping, the Spanish derivation from the order,
 * and the mapping screen's code list.
 */
final class TaxCodeSpec
{
    public static function runAll(): void
    {
        $tests = [
            'testZeroRateLinesCarryTheResolvedCode',
            'testEveryPayloadWithLinesCarriesTheCode',
            'testAnEsMerchantsNonZeroOrdersMatchTheGoldens',
            'testTheCodeListIsCachedAndServedStale',
            'testTheDropdownHidesCodesNeedingACallerReason',
            'testTheMappingScreenRendersAndSaves',
            'testTheMerchantCountryComesFromTheMerchantRecord',
        ];
        foreach ($tests as $test) {
            self::reset();
            try {
                self::$test();
            } finally {
                self::useGateway(null);
            }
            print("PASS TaxCodeSpec::$test\n");
        }
        self::reset();
    }

    private static function reset(): void
    {
        $GLOBALS['__twoinc_test_options'] = ['woocommerce_shipping_tax_class' => ''];
        $GLOBALS['__twoinc_test_http_calls'] = [];
        $GLOBALS['__twoinc_test_tax_classes'] = [];
        unset($GLOBALS['__twoinc_test_base_country']);
        foreach (['twoinc_payment_terms_line', 'twoinc_order_payload', 'two_order_create', 'two_order_edit'] as $tag) {
            remove_all_filters($tag);
        }
    }

    /**
     * One row per derivation rule of the spec. `lines` are the order's lines: `goods` or `service` for a product
     * line (`goods21` for one at 21%), `shipping` for a 0% shipping line. `want` is each line's tax_code, null for
     * none. On the base branch, which sends no code, every row wanting one fails.
     */
    private static function testZeroRateLinesCarryTheResolvedCode(): void
    {
        $es = ['country' => 'ES', 'postcode' => '28001'];
        $cases = [
            // merchant, lines, buyer (billing) country and optional postcode, delivery address (null: none, so billing), map, want, description
            ['ES', ['goods'], 'ES', ['country' => 'NO', 'postcode' => '0150'], [], ['ES_IVA_EXPORT'], 'goods delivered outside the EU'],
            ['ES', ['goods'], 'ES', ['country' => 'ES', 'postcode' => '35001'], [], ['ES_IVA_EXPORT'], 'goods delivered to Las Palmas'],
            ['ES', ['goods'], 'ES', ['country' => 'ES', 'postcode' => '38001'], [], ['ES_IVA_EXPORT'], 'goods delivered to Tenerife'],
            ['ES', ['goods'], 'ES', ['country' => 'ES', 'postcode' => '51001'], [], ['ES_IVA_EXPORT'], 'goods delivered to Ceuta'],
            ['ES', ['goods'], 'ES', ['country' => 'ES', 'postcode' => '52001'], [], ['ES_IVA_EXPORT'], 'goods delivered to Melilla'],
            ['ES', ['goods'], 'DE', ['country' => 'FR', 'postcode' => '75001'], [], ['ES_IVA_INTRA_COMMUNITY_GOODS'], 'goods to the EU for an EU buyer of another state'],
            ['ES', ['goods'], 'FR', ['country' => 'MC', 'postcode' => '98000'], [], ['ES_IVA_INTRA_COMMUNITY_GOODS'], 'Monaco counts as France'],
            ['ES', ['goods'], 'ES', ['country' => 'FR', 'postcode' => '75001'], [], [null], 'goods to the EU for a Spanish buyer'],
            ['ES', ['goods'], 'FR', $es, [], [null], 'goods delivered in mainland Spain'],
            ['ES', ['goods'], 'ES', ['country' => 'ES', 'postcode' => '07001'], [], [null], 'goods delivered to the Balearics'],
            ['ES', ['goods'], 'US', null, [], ['ES_IVA_EXPORT'], 'no delivery address: billing is the destination'],
            ['ES', ['service'], 'FR', $es, [], ['ES_IVA_INTRA_COMMUNITY_SERVICES'], 'service to an EU buyer of another state'],
            ['ES', ['service'], 'ES', ['country' => 'FR', 'postcode' => '75001'], [], [null], 'service to a Spanish buyer'],
            ['ES', ['service'], 'NO', ['country' => 'NO', 'postcode' => '0150'], [], ['ES_IVA_NON_EU_SERVICES'], 'service to a buyer outside the EU'],
            ['ES', ['service'], 'US', $es, [], ['ES_IVA_NON_EU_SERVICES'], 'service to a buyer outside the EU, delivered in Spain'],
            ['ES', ['service'], 'ES 35001', $es, [], ['ES_IVA_NON_EU_SERVICES'], 'service to a buyer billed in Las Palmas'],
            ['ES', ['service'], 'ES 38001', null, [], ['ES_IVA_NON_EU_SERVICES'], 'service to a buyer billed in Tenerife'],
            ['ES', ['service'], 'ES 51001', $es, [], ['ES_IVA_NON_EU_SERVICES'], 'service to a buyer billed in Ceuta'],
            ['ES', ['service'], 'ES 52001', $es, [], ['ES_IVA_NON_EU_SERVICES'], 'service to a buyer billed in Melilla'],
            ['ES', ['service'], 'ES 28001', ['country' => 'ES', 'postcode' => '35001'], [], [null], 'service delivered to the Canaries for a mainland buyer'],
            ['ES', ['goods'], 'ES 35001', $es, [], [null], 'goods delivered in mainland Spain for a buyer billed in the Canaries'],
            ['ES', ['goods', 'service', 'shipping'], 'ES', ['country' => 'NO', 'postcode' => '0150'], [], ['ES_IVA_EXPORT', null, 'ES_IVA_EXPORT'], 'shipping follows the goods'],
            ['ES', ['service', 'shipping'], 'FR', $es, [], ['ES_IVA_INTRA_COMMUNITY_SERVICES', 'ES_IVA_INTRA_COMMUNITY_SERVICES'], 'shipping follows the services'],
            ['ES', ['service', 'shipping'], 'NO', ['country' => 'NO', 'postcode' => '0150'], [], ['ES_IVA_NON_EU_SERVICES', 'ES_IVA_NON_EU_SERVICES'], 'shipping follows non-EU services'],
            ['ES', ['goods', 'shipping'], 'ES', ['country' => 'NO', 'postcode' => '0150'], ['standard' => 'ES_IVA_EXEMPT_ART20'], ['ES_IVA_EXEMPT_ART20', 'ES_IVA_EXEMPT_ART20'], 'the mapping beats the derivation'],
            ['ES', ['goods'], 'ES', $es, ['reduced-rate' => 'ES_IVA_ZERO'], [null], 'a mapping of another class does not apply'],
            ['NO', ['goods', 'shipping'], 'NO', ['country' => 'US', 'postcode' => '10001'], [], [null, null], 'a non-ES merchant with no mapping is untouched'],
            ['FR', ['goods'], 'FR', ['country' => 'US', 'postcode' => '10001'], ['standard' => 'FR_EXPORT'], ['FR_EXPORT'], 'a mapping applies whatever the merchant country'],
            ['ES', ['goods21', 'shipping21'], 'ES', ['country' => 'NO', 'postcode' => '0150'], ['standard' => 'ES_IVA_ZERO'], [null, null], 'a non-zero line is untouched'],
        ];

        foreach ($cases as [$merchant, $lines, $buyer, $delivery, $map, $want, $description]) {
            $GLOBALS['__twoinc_test_options'][WC_Twoinc_Brand::prefixed_name('merchant_country')] = $merchant;
            self::useGateway($map);
            $order = self::order($lines, $buyer, $delivery);
            $sent = WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', [], '', '', '', '', '', '', true);
            TinyAssert::same($want, array_map(static function ($line) {
                return $line['tax_code'] ?? null;
            }, $sent['line_items']), $description);
            if ($want === array_fill(0, count($want), null)) {
                self::useGateway([]);
                $GLOBALS['__twoinc_test_options'][WC_Twoinc_Brand::prefixed_name('merchant_country')] = 'NO';
                $before = WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', [], '', '', '', '', '', '', true);
                TinyAssert::same(json_encode($before), json_encode($sent), $description . ': byte-identical to a payload with no resolver at work');
            }
        }
    }

    /** Create, edit, intent and refund all carry the code; fulfilment sends no lines. */
    private static function testEveryPayloadWithLinesCarriesTheCode(): void
    {
        $GLOBALS['__twoinc_test_options'][WC_Twoinc_Brand::prefixed_name('merchant_country')] = 'ES';
        self::useGateway([]);
        $order = self::order(['goods', 'shipping'], 'ES', ['country' => 'NO', 'postcode' => '0150']);
        $codes = static function (array $payload) {
            return array_map(static function ($line) {
                return $line['tax_code'] ?? null;
            }, $payload['line_items']);
        };

        TinyAssert::same(['ES_IVA_EXPORT', 'ES_IVA_EXPORT'], $codes(WC_Twoinc_Helper::compose_twoinc_edit_order($order, '', '', '', '')), 'edit');
        TinyAssert::same(['ES_IVA_EXPORT', 'ES_IVA_EXPORT'], $codes(WC_Twoinc_Helper::compose_twoinc_intent($order, [])), 'intent');

        // A partial refund is sent as full line items, so each carries the code of the line it refunds.
        $refund = new StubRefund([
            'line_item' => [new StubProductLineItem([
                'name' => 'Goods', 'line_subtotal' => -100.0, 'line_total' => -100.0, 'line_tax' => 0.0, 'taxes' => [],
                'data' => new TaxCodeSpecProduct(false), 'meta' => ['_refunded_item_id' => 1],
            ])],
            'shipping' => [new StubShippingItem(-10.0, 0.0, [], ['_refunded_item_id' => 6])],
        ], []);
        TinyAssert::same(['ES_IVA_EXPORT', 'ES_IVA_EXPORT'], $codes(WC_Twoinc_Helper::compose_twoinc_refund($refund, 110.0, $order)), 'refund');

        // A hook after the builder sees the code, and can change it.
        add_filter('twoinc_order_payload', static function ($body) {
            TinyAssert::same('ES_IVA_EXPORT', $body['line_items'][0]['tax_code'] ?? null, 'the payload hook sees the code');
            $body['line_items'][0]['tax_code'] = 'ES_IVA_EXEMPT_ART21';
            return $body;
        });
        $sent = WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', [], '', '', '', '', '', '', true);
        TinyAssert::same('ES_IVA_EXEMPT_ART21', $sent['line_items'][0]['tax_code'], 'the hook overrides the code');
    }

    /** The builder goldens whose lines are all taxed are byte-identical for a Spanish merchant too. */
    private static function testAnEsMerchantsNonZeroOrdersMatchTheGoldens(): void
    {
        $GLOBALS['__twoinc_test_options'][WC_Twoinc_Brand::prefixed_name('merchant_country')] = 'ES';
        $goldens = json_decode((string) file_get_contents(__DIR__ . '/fixtures/builder-goldens.json'), true);
        $fixtures = twoinc_builder_fixture_orders();
        foreach (['coupon_fee_taxed_shipping', 'gift_card_residual', 'mistaxed_shipping'] as $name) {
            foreach (twoinc_builder_fixture_payloads($fixtures[$name]()) as $type => $payload) {
                $want = $goldens[$name][$type === 'intent' ? 'order_create' : $type];
                $want = $type === 'intent' ? $want['line_items'] : $want;
                $have = $type === 'intent' ? $payload['line_items'] : $payload;
                TinyAssert::same(json_encode($want), json_encode($have), "$name $type");
            }
        }
    }

    private static function testTheCodeListIsCachedAndServedStale(): void
    {
        $gateway = self::apiGateway();
        $gateway->responses = [['response' => ['code' => 200], 'body' => json_encode(['data' => [self::entry('ES_IVA_EXPORT', 'VATEX-EU-G')], 'country_code' => 'ES'])]];
        $first = $gateway->get_tax_codes('es');
        TinyAssert::same(['ES_IVA_EXPORT', null], [$first['codes'][0]['code'], $first['error']], 'the fetched list');
        TinyAssert::same(['/v1/tax_codes/ES'], $gateway->calls, 'fetched for the country');

        $gateway->get_tax_codes('ES');
        TinyAssert::same(1, count($gateway->calls), 'a fresh list is served without a call');

        $option = WC_Twoinc_Brand::prefixed_name('tax_codes');
        $GLOBALS['__twoinc_test_options'][$option]['fetched_at'] = time() - 86401;
        $gateway->responses = [['response' => ['code' => 503], 'body' => '{}']];
        $stale = $gateway->get_tax_codes('ES');
        TinyAssert::same(2, count($gateway->calls), 'an expired list is fetched again');
        TinyAssert::same('ES_IVA_EXPORT', $stale['codes'][0]['code'] ?? null, 'a failed fetch serves the last list');
        TinyAssert::true(is_string($stale['error']), 'and says the fetch failed');

        $gateway->responses = [['response' => ['code' => 400], 'body' => json_encode(['error_message' => 'Country not supported'])]];
        $none = $gateway->get_tax_codes('PL');
        TinyAssert::same([], $none['codes'], 'no list for another country');
        TinyAssert::true(strpos((string) $none['error'], 'Country not supported') !== false, 'the API reason is shown: ' . $none['error']);
    }

    private static function testTheDropdownHidesCodesNeedingACallerReason(): void
    {
        $options = WC_Twoinc::tax_code_options([
            self::entry('ES_IVA_EXPORT', 'VATEX-EU-G'),
            self::entry('ES_IVA_EXEMPT_OTHER', null),
            ['code' => 'ES_IVA_STANDARD', 'rate' => '0.21', 'display_name' => 'IVA general', 'requires_exemption_reason' => false, 'exemption_reason_code' => null],
        ]);
        TinyAssert::same(['ES_IVA_EXPORT', 'ES_IVA_STANDARD'], array_keys($options), 'EXEMPT_OTHER is hidden');
        TinyAssert::same('ES_IVA_STANDARD: IVA general (21%)', $options['ES_IVA_STANDARD'], 'the label');
    }

    private static function testTheMappingScreenRendersAndSaves(): void
    {
        $GLOBALS['__twoinc_test_tax_classes'] = ['Reduced rate', 'Zero rate'];
        $GLOBALS['__twoinc_test_options'][WC_Twoinc_Brand::prefixed_name('merchant_country')] = 'ES';
        $gateway = self::apiGateway(['standard' => 'ES_IVA_EXPORT', 'zero-rate' => 'ES_RETIRED_CODE']);
        $gateway->responses = [['response' => ['code' => 200], 'body' => json_encode(['data' => [self::entry('ES_IVA_EXPORT', 'VATEX-EU-G'), self::entry('ES_IVA_EXEMPT_OTHER', null)]])]];

        $html = $gateway->generate_two_tax_code_map_html('tax_code_map', ['title' => 'Tax codes']);
        foreach (['[standard]', '[reduced-rate]', '[zero-rate]', '(none)', '<option value="ES_IVA_EXPORT" selected="selected">', '<option value="ES_RETIRED_CODE" selected="selected">'] as $needle) {
            TinyAssert::true(strpos($html, $needle) !== false, "the screen shows $needle");
        }
        TinyAssert::true(strpos($html, 'ES_IVA_EXEMPT_OTHER') === false, 'EXEMPT_OTHER is not offered');

        $saved = $gateway->validate_two_tax_code_map_field('tax_code_map', [
            'standard' => 'ES_IVA_EXPORT', 'reduced-rate' => '', 'zero-rate' => 'es_iva_zero', 'deleted-class' => 'ES_IVA_ZERO', 'x' => '<b>',
        ]);
        TinyAssert::same(['standard' => 'ES_IVA_EXPORT', 'zero-rate' => 'ES_IVA_ZERO'], $saved, 'one map of live classes, (none) dropped');

        $gateway->responses = [['response' => ['code' => 503], 'body' => '{}']];
        delete_option(WC_Twoinc_Brand::prefixed_name('tax_codes'));
        $html = $gateway->generate_two_tax_code_map_html('tax_code_map', ['title' => 'Tax codes']);
        TinyAssert::true(strpos($html, 'The list of tax codes could not be loaded') !== false, 'the screen says the list failed');
        TinyAssert::true(strpos($html, '<option value="ES_IVA_EXPORT" selected="selected">') !== false, 'a saved mapping still shows');
    }

    private static function testTheMerchantCountryComesFromTheMerchantRecord(): void
    {
        $GLOBALS['__twoinc_test_base_country'] = 'ES';
        TinyAssert::same('ES', WC_Twoinc::get_merchant_country(), 'the shop base country stands in');

        $gateway = self::apiGateway();
        $gateway->responses = [['response' => ['code' => 200], 'body' => json_encode(['id' => 'mid', 'country_code' => 'se'])]];
        WC_Twoinc::reset_merchant_record_memo();
        TinyAssert::true($gateway->refresh_merchant_record_caches(true), 'the record was stored');
        TinyAssert::same('SE', WC_Twoinc::get_merchant_country(), 'the merchant record wins');
    }

    private static function entry(string $code, ?string $reason): array
    {
        return [
            'code' => $code, 'country_code' => 'ES', 'rate' => '0', 'category' => 'G', 'display_name' => $code,
            'requires_exemption_reason' => true, 'exemption_reason_code' => $reason,
        ];
    }

    private static function order(array $lines, string $buyer, ?array $delivery): TaxCodeSpecOrder
    {
        $items = [];
        $shipping = [];
        $total = 0.0;
        $tax = 0.0;
        foreach ($lines as $i => $kind) {
            $rated = substr($kind, -2) === '21';
            $kind = $rated ? substr($kind, 0, -2) : $kind;
            if ($kind === 'shipping') {
                $shipping[5 + $i] = new StubShippingItem(10.0, $rated ? 2.1 : 0.0, $rated ? [1 => 2.1] : []);
                $total += 10.0;
                $tax += $rated ? 2.1 : 0.0;
                continue;
            }
            $items[1 + $i] = new StubProductLineItem([
                'name' => ucfirst($kind), 'line_subtotal' => 100.0, 'line_total' => 100.0,
                'line_tax' => $rated ? 21.0 : 0.0, 'taxes' => $rated ? [1 => 21.0] : [],
                'data' => new TaxCodeSpecProduct($kind === 'service'),
            ]);
            $total += 100.0;
            $tax += $rated ? 21.0 : 0.0;
        }
        return new TaxCodeSpecOrder($items, $shipping, $buyer, $delivery, $total + $tax, $tax);
    }

    /** Installs a builder-side gateway whose only setting is the tax code map; null restores the real one. */
    private static function useGateway(?array $map): void
    {
        static $previous = false;
        $instance = new ReflectionProperty(WC_Twoinc::class, 'instance');
        // Required before PHP 8.1.
        $instance->setAccessible(true);
        if ($previous === false) {
            $previous = $instance->getValue();
        }
        if ($map === null) {
            $instance->setValue(null, $previous);
            $previous = false;
            return;
        }
        $instance->setValue(null, new class ($map) extends WC_Twoinc {
            private $map;

            public function __construct($map)
            {
                $this->map = $map;
            }

            public function get_option($key, $empty_value = null)
            {
                return $key === 'tax_code_map' ? $this->map : ($empty_value ?? '');
            }
        });
    }

    /** A gateway with a key and a merchant id whose API replies are queued in `responses`. */
    private static function apiGateway(array $map = [])
    {
        $gateway = new class () extends WC_Twoinc {
            public $calls = [];
            public $responses = [];
            public $map = [];

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
                if ($key === 'tax_code_map') {
                    return $this->map;
                }
                return $key === 'api_key' ? 'key' : ($empty_value ?? '');
            }

            public function make_request($endpoint, $payload = [], $method = 'POST', $params = [], $api_key_override = null, $timeout = 30)
            {
                $this->calls[] = $endpoint;
                return array_shift($this->responses) ?? ['response' => ['code' => 500], 'body' => ''];
            }
        };
        $gateway->map = $map;
        $instance = new ReflectionProperty(WC_Twoinc::class, 'instance');
        // Required before PHP 8.1.
        $instance->setAccessible(true);
        self::useGateway([]);
        $instance->setValue(null, $gateway);
        return $gateway;
    }
}

final class TaxCodeSpecProduct
{
    private $virtual;

    public function __construct(bool $virtual)
    {
        $this->virtual = $virtual;
    }

    public function is_virtual()
    {
        return $this->virtual;
    }

    public function is_downloadable()
    {
        return false;
    }

    public function get_name()
    {
        return $this->virtual ? 'Service' : 'Goods';
    }

    public function get_description()
    {
        return '';
    }

    public function get_id()
    {
        return 0;
    }

    public function get_permalink()
    {
        return '';
    }

    public function get_sku()
    {
        return '';
    }
}

final class TaxCodeSpecOrder extends StubOrder
{
    private $items;
    private $shipping;
    private $buyer;
    private $buyerPostcode;
    private $delivery;
    private $total;
    private $tax;

    public function __construct(array $items, array $shipping, string $buyer, ?array $delivery, float $total, float $tax)
    {
        $this->items = $items;
        $this->shipping = $shipping;
        [$this->buyer, $this->buyerPostcode] = array_pad(explode(' ', $buyer, 2), 2, '10001');
        $this->delivery = $delivery;
        $this->total = $total;
        $this->tax = $tax;
    }

    public function get_items($type = 'line_item')
    {
        return $type === 'line_item' ? $this->items : ($type === 'shipping' ? $this->shipping : []);
    }

    public function get_item($id)
    {
        return $this->items[$id] ?? $this->shipping[$id] ?? false;
    }

    public function get_taxes()
    {
        return [new StubOrderTaxItem(1, 21.0)];
    }

    public function get_total()
    {
        return $this->total;
    }

    public function get_total_tax()
    {
        return $this->tax;
    }

    public function get_currency()
    {
        return 'EUR';
    }

    public function get_billing_country()
    {
        return $this->buyer;
    }

    public function get_billing_postcode()
    {
        return $this->buyerPostcode;
    }

    public function get_shipping_address_1()
    {
        return $this->delivery ? 'Street 1' : '';
    }

    public function get_shipping_city()
    {
        return $this->delivery ? 'City' : '';
    }

    public function get_shipping_postcode()
    {
        return $this->delivery['postcode'] ?? '';
    }

    public function get_shipping_country()
    {
        return $this->delivery['country'] ?? '';
    }
}
