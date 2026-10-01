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
            'testIntraCommunityCodesNeedABuyerVatNumber',
            'testTheVatNumberFilterRunsBeforeTheDerivation',
            'testTheIntentCarriesNoTaxCode',
            'testEveryPayloadWithLinesCarriesTheCode',
            'testAnEsMerchantsNonZeroOrdersMatchTheGoldens',
            'testTheCodeListIsCachedAndServedStale',
            'testTheDropdownHidesCodesNeedingACallerReason',
            'testTheLabelShowsTheRateOnce',
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
            ['ES', ['goods'], 'DE', ['country' => 'FR', 'postcode' => '75001'], [], [null], 'goods to the EU for an EU buyer of another state with no VAT number'],
            ['ES', ['goods'], 'FR', ['country' => 'MC', 'postcode' => '98000'], [], [null], 'goods to Monaco for a French buyer with no VAT number'],
            ['ES', ['goods'], 'ES', ['country' => 'FR', 'postcode' => '75001'], [], [null], 'goods to the EU for a Spanish buyer'],
            ['ES', ['goods'], 'FR', $es, [], [null], 'goods delivered in mainland Spain'],
            ['ES', ['goods'], 'ES', ['country' => 'ES', 'postcode' => '07001'], [], [null], 'goods delivered to the Balearics'],
            ['ES', ['goods'], 'US', null, [], ['ES_IVA_EXPORT'], 'no delivery address: billing is the destination'],
            ['ES', ['service'], 'FR', $es, [], [null], 'service to an EU buyer of another state with no VAT number, never NON_EU_SERVICES'],
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
            ['ES', ['service', 'shipping'], 'FR', $es, [], [null, null], 'shipping follows services to an EU buyer with no VAT number'],
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

    /**
     * TWO-26153: both intra-community codes need a buyer VAT number whose prefix is an EU member state other than the
     * merchant's country, and an order create sends that number as `buyer_vat_number` for a Spanish merchant and a
     * buyer company outside Spain. `meta` is the order's meta; `sent` is the `buyer_vat_number` sent, null for none.
     * The edit, which reads the number the same way, must derive the same codes and never send the key. Merchant ''
     * is a merchant record not read yet, in a shop whose base country is Spain.
     */
    private static function testIntraCommunityCodesNeedABuyerVatNumber(): void
    {
        $GLOBALS['__twoinc_test_base_country'] = 'ES';
        $es = ['country' => 'ES', 'postcode' => '28001'];
        $fr = ['country' => 'FR', 'postcode' => '75001'];
        $no = ['country' => 'NO', 'postcode' => '0150'];
        $intraGoods = ['ES_IVA_INTRA_COMMUNITY'];
        $intraServices = ['ES_IVA_INTRA_COMMUNITY_SERVICES'];
        $cases = [
            // merchant, lines, buyer (billing) country, delivery address, meta, map, want, sent, description
            ['ES', ['goods'], 'DE', $fr, ['_billing_vat_number' => 'DE123456789'], [], $intraGoods, 'DE123456789', 'goods to the EU with a VAT number of another EU state'],
            ['ES', ['service'], 'FR', $es, ['_billing_vat_number' => 'FR12345678901'], [], $intraServices, 'FR12345678901', 'services with a VAT number of another EU state'],
            ['ES', ['service', 'shipping'], 'FR', $es, ['_billing_vat_number' => 'FR12345678901'], [], ['ES_IVA_INTRA_COMMUNITY_SERVICES', 'ES_IVA_INTRA_COMMUNITY_SERVICES'], 'FR12345678901', 'shipping follows the services'],
            ['ES', ['goods'], 'FR', ['country' => 'MC', 'postcode' => '98000'], ['_billing_vat_number' => 'FR12345678901'], [], $intraGoods, 'FR12345678901', 'Monaco counts as France'],
            ['ES', ['goods'], 'DE', $fr, ['_billing_vat_number' => 'NL123456789B01'], [], $intraGoods, 'NL123456789B01', 'the VAT prefix need not match the buyer or the destination'],
            ['ES', ['goods'], 'DE', $fr, ['_billing_vat_number' => 'ESB12345678'], [], [null], 'ESB12345678', 'goods: a VAT prefix of the merchant\'s country derives nothing'],
            ['ES', ['service'], 'FR', $es, ['_billing_vat_number' => 'ESB12345678'], [], [null], 'ESB12345678', 'services: a VAT prefix of the merchant\'s country derives nothing'],
            ['ES', ['goods'], 'DE', $fr, ['_billing_vat_number' => 'GB123456789'], [], [null], 'GB123456789', 'goods: a VAT prefix outside the EU derives nothing'],
            ['ES', ['service'], 'FR', $es, ['_billing_vat_number' => 'CHE123456789'], [], [null], 'CHE123456789', 'services: a VAT prefix outside the EU derives nothing, never NON_EU_SERVICES'],
            ['ES', ['goods'], 'GR', ['country' => 'GR', 'postcode' => '10431'], ['_billing_vat_number' => 'EL123456789'], [], $intraGoods, 'EL123456789', 'EL reads as Greece'],
            ['ES', ['service'], 'GR', $es, ['_billing_vat_number' => '123456789'], [], $intraServices, 'EL123456789', 'an unprefixed Greek number gains EL'],
            ['ES', ['service'], 'DE', $es, ['_billing_vat_number' => '123456789'], [], $intraServices, 'DE123456789', 'an unprefixed number gains the billing country'],
            ['ES', ['service'], 'DE', $es, ['_billing_vat_number' => ' de 123.456-789 '], [], $intraServices, 'DE123456789', 'spaces, dots and hyphens are stripped and the number uppercased'],
            ['ES', ['service'], 'DE', $es, ['_billing_vat_number' => ' .- '], [], [null], null, 'a number of only separators is no number'],
            ['ES', ['service'], 'MC', $es, ['_billing_vat_number' => '12345678901'], [], $intraServices, 'FR12345678901', 'an unprefixed number billed in Monaco gains FR'],
            ['ES', ['service'], 'MC', $es, ['_billing_vat_number' => 'MC12345678901'], [], [null], 'MC12345678901', 'an MC prefix is no VAT prefix and derives nothing'],
            ['ES', ['goods', 'shipping'], 'DE', $fr, [], ['standard' => 'ES_IVA_EXEMPT_ART20'], ['ES_IVA_EXEMPT_ART20', 'ES_IVA_EXEMPT_ART20'], null, 'the mapping still wins with no VAT number'],
            ['ES', ['service'], 'NO', $no, [], [], ['ES_IVA_NON_EU_SERVICES'], null, 'services outside the EU need no VAT number'],
            ['ES', ['goods'], 'DE', $no, [], [], ['ES_IVA_EXPORT'], null, 'an export needs no VAT number'],
            ['ES', ['goods'], 'ES', $no, ['_billing_vat_number' => 'ESB12345678'], [], ['ES_IVA_EXPORT'], null, 'never sent for a Spanish buyer'],
            ['NO', ['goods'], 'DE', $fr, ['_billing_vat_number' => 'DE123456789'], [], [null], null, 'never sent by a merchant outside Spain'],
            ['', ['goods'], 'DE', $fr, ['_billing_vat_number' => 'DE123456789'], [], $intraGoods, null, 'not sent until the merchant record gives the country, though a Spanish shop derives'],
            ['ES', ['goods21'], 'DE', $fr, ['_billing_vat_number' => 'DE123456789'], [], [null], 'DE123456789', 'sent on an order with no 0% line'],
            ['ES', ['goods'], 'DE', $fr, ['_vat_number' => 'FR12345678901', '_billing_vat_number' => 'DE123456789'], [], $intraGoods, 'DE123456789', 'source order: _billing_vat_number first'],
            ['ES', ['goods'], 'DE', $fr, ['_billing_vat_number' => ' ', '_vat_number' => 'FR12345678901'], [], $intraGoods, 'FR12345678901', 'source order: an empty key falls through to _vat_number'],
            ['ES', ['goods'], 'DE', $fr, ['_vat_number' => 'FR111', 'vat_number' => 'IT222'], [], $intraGoods, 'FR111', 'source order: _vat_number before vat_number'],
            ['ES', ['goods'], 'DE', $fr, ['vat_number' => 'IT222', 'VAT Number' => 'AT333'], [], $intraGoods, 'IT222', 'source order: vat_number before VAT Number'],
            ['ES', ['goods'], 'DE', $fr, ['VAT Number' => 'AT333', '_billing_eu_vat_number' => 'BE444'], [], $intraGoods, 'AT333', 'source order: VAT Number before _billing_eu_vat_number'],
            ['ES', ['goods'], 'DE', $fr, ['_billing_eu_vat_number' => 'BE444'], [], $intraGoods, 'BE444', 'source order: _billing_eu_vat_number is read'],
            ['ES', ['goods'], 'DE', $fr, ['billing_vat' => 'DE123456789'], [], [null], null, 'an unknown key is not read'],
        ];

        $codes = static function (array $payload) {
            return array_map(static function ($line) {
                return $line['tax_code'] ?? null;
            }, $payload['line_items']);
        };
        foreach ($cases as [$merchant, $lines, $buyer, $delivery, $meta, $map, $want, $sent, $description]) {
            $GLOBALS['__twoinc_test_options'][WC_Twoinc_Brand::prefixed_name('merchant_country')] = $merchant;
            self::useGateway($map);
            $order = self::order($lines, $buyer, $delivery);
            $order->meta = $meta;
            $create = WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', [], '', '', '', '', '', '', true);
            TinyAssert::same($want, $codes($create), $description . ': create codes');
            TinyAssert::same($sent, $create['buyer_vat_number'] ?? null, $description . ': buyer_vat_number');
            TinyAssert::same($sent !== null, array_key_exists('buyer_vat_number', $create), $description . ': key present only when sent');
            $edit = WC_Twoinc_Helper::compose_twoinc_edit_order($order, '', '', '', '');
            TinyAssert::same($want, $codes($edit), $description . ': edit codes');
            TinyAssert::true(!array_key_exists('buyer_vat_number', $edit), $description . ': edit never sends the key');
        }
    }

    /**
     * `twoinc_buyer_vat_number` receives the first non-empty meta value ('' for none) and its result is normalised
     * and used for both the derivation and the payload (TWO-26153). `filter` is what the filter returns given what it
     * received; null means no filter is added.
     */
    private static function testTheVatNumberFilterRunsBeforeTheDerivation(): void
    {
        $GLOBALS['__twoinc_test_options'][WC_Twoinc_Brand::prefixed_name('merchant_country')] = 'ES';
        self::useGateway([]);
        $fr = ['country' => 'FR', 'postcode' => '75001'];
        $cases = [
            // meta, filter, want codes, sent, received by the filter, description
            [[], static function ($vat) {
                return $vat === '' ? 'fr 123 456 789 01' : $vat;
            }, ['ES_IVA_INTRA_COMMUNITY_GOODS'], 'FR12345678901', '', 'the filter supplies a number when no meta has one'],
            [['_billing_vat_number' => 'DE123456789'], static function () {
                return 'NL123456789B01';
            }, ['ES_IVA_INTRA_COMMUNITY_GOODS'], 'NL123456789B01', 'DE123456789', 'the filter overrides the meta'],
            [['_billing_vat_number' => 'DE123456789'], static function () {
                return '';
            }, [null], null, 'DE123456789', 'the filter returning an empty string leaves no number'],
            [['_billing_vat_number' => 'DE123456789'], static function () {
                return 'ESB12345678';
            }, [null], 'ESB12345678', 'DE123456789', 'a filtered number of the merchant\'s country derives nothing'],
        ];
        foreach ($cases as [$meta, $filter, $want, $sent, $received, $description]) {
            remove_all_filters('twoinc_buyer_vat_number');
            $seen = [];
            add_filter('twoinc_buyer_vat_number', static function ($vat, $order) use ($filter, &$seen) {
                $seen[] = [$vat, is_object($order)];
                return $filter($vat);
            }, 10, 2);
            $order = self::order(['goods'], 'DE', $fr);
            $order->meta = $meta;
            $create = WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', [], '', '', '', '', '', '', true);
            TinyAssert::same($want, array_map(static function ($line) {
                return $line['tax_code'] ?? null;
            }, $create['line_items']), $description . ': codes');
            TinyAssert::same($sent, $create['buyer_vat_number'] ?? null, $description . ': buyer_vat_number');
            TinyAssert::same([$received, true], $seen[0] ?? null, $description . ': the filter gets the meta value and the order');
        }
        remove_all_filters('twoinc_buyer_vat_number');
    }

    /**
     * The intent carries no tax code (TWO-26226), even where create derives or maps one: the buyer's details may
     * still be partial when the intent is checked.
     */
    private static function testTheIntentCarriesNoTaxCode(): void
    {
        $GLOBALS['__twoinc_test_options'][WC_Twoinc_Brand::prefixed_name('merchant_country')] = 'ES';
        $es = ['country' => 'ES', 'postcode' => '28001'];
        $codes = static function (array $payload, string $key) {
            return array_map(static function ($line) use ($key) {
                return $line[$key] ?? null;
            }, $payload['line_items']);
        };
        $cases = [
            // lines, buyer (billing) country, delivery address, map, create's codes, description
            [['goods', 'shipping'], 'ES', ['country' => 'NO', 'postcode' => '0150'], [], ['ES_IVA_EXPORT', 'ES_IVA_EXPORT'], 'export'],
            [['goods'], 'DE', ['country' => 'FR', 'postcode' => '75001'], [], ['ES_IVA_INTRA_COMMUNITY'], 'intra-community goods'],
            [['service'], 'FR', $es, [], ['ES_IVA_INTRA_COMMUNITY_SERVICES'], 'a service to an EU buyer'],
            [['goods'], 'ES', $es, ['standard' => 'ES_IVA_EXEMPT_ART20'], ['ES_IVA_EXEMPT_ART20'], 'a mapped tax class'],
        ];
        foreach ($cases as [$lines, $buyer, $delivery, $map, $create, $description]) {
            self::useGateway($map);
            $order = self::order($lines, $buyer, $delivery);
            $sent = WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', [], '', '', '', '', '', '', true);
            TinyAssert::same($create, $codes($sent, 'tax_code'), "$description: create carries the code");
            $intent = WC_Twoinc_Helper::compose_twoinc_intent($order, []);
            $none = array_fill(0, count($lines), null);
            TinyAssert::same($none, $codes($intent, 'tax_code'), "$description: the intent carries no code");
            TinyAssert::same($none, $codes($intent, 'tax_exemption_reason_code'), "$description: nor an exemption reason");
        }
    }

    /** Create, edit and refund carry the code; the intent does not (see above); fulfilment sends no lines. */
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

    /** A rated display name already ends in its rate (TWO-26243), so the label carries the rate once. */
    private static function testTheLabelShowsTheRateOnce(): void
    {
        $cases = [
            // display_name, rate, want, description
            ['IVA General (21%)', '0.21', 'C: IVA General (21%)', 'a rated name is not given the rate again'],
            ['IVA Reducido (10%)  ', '0.1', 'C: IVA Reducido (10%)', 'trailing space does not hide the rate'],
            ['IVA Superreducido (4 %)', '0.04', 'C: IVA Superreducido (4 %)', 'a spaced rate counts as a rate'],
            ['Exento', '0', 'C: Exento (0%)', 'an unrated name gets the rate'],
            ['Inversión del sujeto pasivo (art. 84)', '0', 'C: Inversión del sujeto pasivo (art. 84) (0%)', 'a bracket without % is not a rate'],
            ['IVA (21%) general', '0.21', 'C: IVA (21%) general (21%)', 'a rate mid-name is not the trailing rate'],
            ['', '0.21', 'C (21%)', 'no name still shows the rate'],
            ['Exento', null, 'C: Exento', 'no rate appends nothing'],
        ];
        foreach ($cases as [$name, $rate, $want, $description]) {
            $options = WC_Twoinc::tax_code_options([
                ['code' => 'C', 'rate' => $rate, 'display_name' => $name, 'requires_exemption_reason' => false, 'exemption_reason_code' => null],
            ]);
            TinyAssert::same($want, $options['C'] ?? null, $description);
        }
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
