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
            'testTheSharedCaseTable',
            'testThePlacementRecordKeepsTheCodes',
            'testAnUnconfiguredShopLooksNothingUp',
            'testARetryReplacesTheRecord',
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
            'testTheMigrationFansTheClassCodeOut',
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
        unset($GLOBALS['__twoinc_test_base_country'], $GLOBALS['__twoinc_test_find_rates'], $GLOBALS['__twoinc_test_class_rates'], $GLOBALS['__twoinc_test_tax_enabled']);
        WC_Twoinc::reset_zero_tax_rates_memo();
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
            ['ES', ['goods', 'shipping'], 'ES', ['country' => 'NO', 'postcode' => '0150'], ['standard|none' => 'ES_IVA_EXEMPT_ART20'], ['ES_IVA_EXEMPT_ART20', 'ES_IVA_EXEMPT_ART20'], 'the mapping beats the derivation'],
            ['ES', ['goods'], 'ES', $es, ['reduced-rate|none' => 'ES_IVA_ZERO'], [null], 'a mapping of another class does not apply'],
            ['NO', ['goods', 'shipping'], 'NO', ['country' => 'US', 'postcode' => '10001'], [], [null, null], 'a non-ES merchant with no mapping is untouched'],
            ['FR', ['goods'], 'FR', ['country' => 'US', 'postcode' => '10001'], ['standard|none' => 'FR_EXPORT'], ['FR_EXPORT'], 'a mapping applies whatever the merchant country'],
            ['ES', ['goods21', 'shipping21'], 'ES', ['country' => 'NO', 'postcode' => '0150'], ['standard|none' => 'ES_IVA_ZERO'], [null, null], 'a non-zero line is untouched'],
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
            ['ES', ['service'], 'GR', $es, ['_billing_vat_number' => '123456789'], [], [null], '123456789', 'an unprefixed Greek number is sent as entered, with no prefix to derive from'],
            ['ES', ['service'], 'DE', $es, ['_billing_vat_number' => '123456789'], [], [null], '123456789', 'an unprefixed number gains no prefix'],
            ['ES', ['service'], 'DE', $es, ['_billing_vat_number' => ' DE 123.456-789 '], [], $intraServices, 'DE 123.456-789', 'only leading and trailing spaces are trimmed'],
            ['ES', ['service'], 'DE', $es, ['_billing_vat_number' => 'de123456789'], [], [null], 'de123456789', 'case is kept, and a lower-case prefix names no country'],
            ['ES', ['service'], 'DE', $es, ['_billing_vat_number' => ' .- '], [], [null], '.-', 'a value of only separators is sent as entered'],
            ['ES', ['service'], 'DE', $es, ['_billing_vat_number' => "\tDE\u{00A0}123\t456\n"], [], $intraServices, "DE\u{00A0}123\t456", 'leading and trailing tabs and newlines are trimmed, inner ones kept'],
            ['ES', ['service'], 'MC', $es, ['_billing_vat_number' => '12345678901'], [], [null], '12345678901', 'an unprefixed number billed in Monaco gains no prefix'],
            ['ES', ['service'], 'MC', $es, ['_billing_vat_number' => 'MC12345678901'], [], [null], 'MC12345678901', 'an MC prefix is no VAT prefix and derives nothing'],
            ['ES', ['goods', 'shipping'], 'DE', $fr, [], ['standard|none' => 'ES_IVA_EXEMPT_ART20'], ['ES_IVA_EXEMPT_ART20', 'ES_IVA_EXEMPT_ART20'], null, 'the mapping still wins with no VAT number'],
            ['ES', ['service'], 'NO', $no, [], [], ['ES_IVA_NON_EU_SERVICES'], null, 'services outside the EU need no VAT number'],
            ['ES', ['goods'], 'DE', $no, [], [], ['ES_IVA_EXPORT'], null, 'an export needs no VAT number'],
            ['ES', ['goods'], 'ES', $no, ['_billing_vat_number' => 'ESB12345678'], [], ['ES_IVA_EXPORT'], null, 'never sent for a Spanish buyer'],
            ['NO', ['goods'], 'DE', $fr, ['_billing_vat_number' => 'DE123456789'], [], [null], null, 'never sent by a merchant outside Spain'],
            ['', ['goods'], 'DE', $fr, ['_billing_vat_number' => 'DE123456789'], [], [null], null, 'not sent, and so no intra-community code, until the merchant record gives the country'],
            ['ES', ['goods'], 'DE', $fr, ['_billing_vat_number' => 'DE123456789'], [], $intraGoods, 'DE123456789', 'the same order derives and sends once the merchant record names Spain'],
            ['ES', ['goods21'], 'DE', $fr, ['_billing_vat_number' => 'DE123456789'], [], [null], 'DE123456789', 'sent on an order with no 0% line'],
            ['ES', ['goods'], 'DE', $fr, ['_vat_number' => 'FR12345678901', '_billing_vat_number' => 'DE123456789'], [], $intraGoods, 'DE123456789', 'source order: _billing_vat_number first'],
            ['ES', ['goods'], 'DE', $fr, ['_billing_vat_number' => ' ', '_vat_number' => 'FR12345678901'], [], $intraGoods, 'FR12345678901', 'source order: an empty key falls through to _vat_number'],
            ['ES', ['goods'], 'DE', $fr, ['_vat_number' => 'FR111', 'vat_number' => 'IT222'], [], $intraGoods, 'FR111', 'source order: _vat_number before vat_number'],
            ['ES', ['goods'], 'DE', $fr, ['vat_number' => 'IT222', 'VAT Number' => 'AT333'], [], $intraGoods, 'IT222', 'source order: vat_number before VAT Number'],
            ['ES', ['goods'], 'DE', $fr, ['VAT Number' => 'AT333', '_billing_eu_vat_number' => 'BE444'], [], $intraGoods, 'AT333', 'source order: VAT Number before _billing_eu_vat_number'],
            ['ES', ['goods'], 'DE', $fr, ['_billing_eu_vat_number' => 'BE444'], [], $intraGoods, 'BE444', 'source order: _billing_eu_vat_number is read'],
            ['ES', ['goods'], 'DE', $fr, ['billing_vat' => 'DE123456789'], [], [null], null, 'an unknown key is not read'],
            ['ES', ['service'], 'DE', $es, ['_billing_vat_number' => 'n/a'], [], [null], 'n/a', 'a value with no digit is sent as entered'],
            ['ES', ['service'], 'DE', $es, ['_billing_vat_number' => 'FR'], [], $intraServices, 'FR', 'a bare prefix is sent as entered'],
            ['ES', ['service'], 'DE', $es, ['_billing_vat_number' => 'NONE'], [], [null], 'NONE', 'a word is sent as entered, its prefix NO outside the EU'],
            ['ES', ['service'], 'DE', $es, ['_billing_vat_number' => 'DE123456789,'], [], $intraServices, 'DE123456789,', 'trailing punctuation is kept'],
            ['ES', ['service'], 'DE', $es, ['_billing_vat_number' => 'DE/123456789'], [], $intraServices, 'DE/123456789', 'a slash is kept'],
            ['ES', ['service'], 'GR', $es, ['_billing_vat_number' => 'GR123456789'], [], $intraServices, 'GR123456789', 'a GR prefix is kept as entered'],
            ['ES', ['goods'], 'DE', $fr, ['_billing_vat_number' => 'n/a', '_vat_number' => 'FR12345678901'], [], [null], 'n/a', 'any value in an earlier key is used, and the next is not tried'],
            ['ES', ['goods'], 'DE', $fr, ['vat_number' => 'IT12345678901', '_vat_number_validated' => 'not-valid', 'VAT Number' => 'IT12345678901'], [], [null], null, 'Aelia: a number checked and found invalid is no number, and stops the lookup'],
            ['ES', ['goods'], 'DE', $fr, ['vat_number' => 'IT12345678901', '_vat_number_validated' => 'could-not-be-validated'], [], $intraGoods, 'IT12345678901', 'Aelia: a check that failed keeps the number'],
            ['ES', ['goods'], 'DE', $fr, ['_billing_vat_number' => 'DE123456789', '_vat_number_validated' => 'not-valid'], [], $intraGoods, 'DE123456789', 'Aelia\'s result applies to its own key only'],
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
     * `twoinc_buyer_vat_number` receives the first non-empty meta value ('' for none) and its result is trimmed
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
                return $vat === '' ? ' FR12345678901 ' : $vat;
            }, ['ES_IVA_INTRA_COMMUNITY'], 'FR12345678901', '', 'the filter supplies a number when no meta has one, trimmed'],
            [['_billing_vat_number' => 'DE123456789'], static function () {
                return 'NL123456789B01';
            }, ['ES_IVA_INTRA_COMMUNITY'], 'NL123456789B01', 'DE123456789', 'the filter overrides the meta'],
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
            // lines, buyer (billing) country, delivery address, order meta, map, create's codes, description
            [['goods', 'shipping'], 'ES', ['country' => 'NO', 'postcode' => '0150'], [], [], ['ES_IVA_EXPORT', 'ES_IVA_EXPORT'], 'export'],
            [['goods'], 'DE', ['country' => 'FR', 'postcode' => '75001'], ['_billing_vat_number' => 'DE123456789'], [], ['ES_IVA_INTRA_COMMUNITY'], 'intra-community goods'],
            [['service'], 'FR', $es, ['_billing_vat_number' => 'FR12345678901'], [], ['ES_IVA_INTRA_COMMUNITY_SERVICES'], 'a service to an EU buyer'],
            [['goods'], 'ES', $es, [], ['standard|none' => 'ES_IVA_EXEMPT_ART20'], ['ES_IVA_EXEMPT_ART20'], 'a mapped tax class'],
        ];
        foreach ($cases as [$lines, $buyer, $delivery, $meta, $map, $create, $description]) {
            self::useGateway($map);
            $order = self::order($lines, $buyer, $delivery);
            $order->meta = $meta;
            $sent = WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', [], '', '', '', '', '', '', true);
            TinyAssert::same($create, $codes($sent, 'tax_code'), "$description: create carries the code");
            $intent = WC_Twoinc_Helper::compose_twoinc_intent($order, []);
            $none = array_fill(0, count($lines), null);
            TinyAssert::same($none, $codes($intent, 'tax_code'), "$description: the intent carries no code");
            TinyAssert::same($none, $codes($intent, 'tax_exemption_reason_code'), "$description: nor an exemption reason");
            TinyAssert::true(!array_key_exists('buyer_vat_number', $intent), "$description: nor a buyer VAT number");
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

    /**
     * The screen (TWO-26153): per tax class, the exempt row, each 0% rate labelled as WooCommerce's tax table shows
     * it (a rate above 0% is not listed), then the no-rule row. The dropdowns post nothing; one JSON field carries the
     * whole mapping, and the save keeps only rows the shop has now.
     */
    private static function testTheMappingScreenRendersAndSaves(): void
    {
        $GLOBALS['__twoinc_test_tax_classes'] = ['Reduced rate'];
        $GLOBALS['__twoinc_test_class_rates'] = [
            '' => [
                11 => ['tax_rate' => '0.0000', 'tax_rate_country' => 'ES', 'tax_rate_name' => 'IVA 0%', 'postcode' => ['35*', '38*']],
                21 => ['tax_rate' => '21.0000', 'tax_rate_country' => 'ES', 'tax_rate_name' => 'IVA'],
                12 => ['tax_rate' => '0.0000', 'tax_rate_country' => '', 'tax_rate_state' => '', 'tax_rate_name' => ''],
            ],
            'reduced-rate' => [31 => ['tax_rate' => '0', 'tax_rate_country' => 'US', 'tax_rate_state' => 'NY', 'tax_rate_name' => 'Export', 'city' => ['NEW YORK']]],
        ];
        $GLOBALS['__twoinc_test_options'][WC_Twoinc_Brand::prefixed_name('merchant_country')] = 'ES';
        $gateway = self::apiGateway(['standard|exempt' => 'ES_IVA_EXPORT', 'rate:11' => 'ES_RETIRED_CODE']);
        $gateway->responses = [['response' => ['code' => 200], 'body' => json_encode(['data' => [self::entry('ES_IVA_EXPORT', 'VATEX-EU-G'), self::entry('ES_IVA_EXEMPT_OTHER', null)]])]];

        $rows = array_map(static function (array $class) {
            return $class['rows'];
        }, WC_Twoinc::tax_code_map_rows());
        TinyAssert::same([
            'standard' => [
                'standard|exempt' => 'Buyer in another EU country with a VAT number',
                'rate:11' => 'ES 35*;38* 0% (IVA 0%)',
                'rate:12' => '* 0%',
                'standard|none' => 'No rule for the address',
            ],
            'reduced-rate' => [
                'reduced-rate|exempt' => 'Buyer in another EU country with a VAT number',
                'rate:31' => 'US NY NEW YORK 0% (Export)',
                'reduced-rate|none' => 'No rule for the address',
            ],
        ], $rows, 'the rows of each class (got: ' . json_encode($rows) . ')');

        $html = $gateway->generate_two_tax_code_map_html('tax_code_map', ['title' => 'Tax codes']);
        foreach (['data-twoinc-tax-code-row="standard|exempt"', 'data-twoinc-tax-code-row="rate:31"', 'ES 35*;38* 0% (IVA 0%)', '(none)', '<option value="ES_IVA_EXPORT" selected="selected">', '<option value="ES_RETIRED_CODE" selected="selected">'] as $needle) {
            TinyAssert::true(strpos($html, $needle) !== false, "the screen shows $needle");
        }
        TinyAssert::true(strpos($html, 'ES_IVA_EXEMPT_OTHER') === false, 'EXEMPT_OTHER is not offered');
        TinyAssert::true(strpos($html, 'rate:21') === false, 'a rate above 0% has no row');
        TinyAssert::true(strpos($html, '<select name=') === false, 'no dropdown posts a field of its own');
        preg_match('/class="twoinc-tax-code-map-value" name="([^"]+)" value="([^"]*)"/', $html, $hidden);
        TinyAssert::same('woocommerce_' . WC_Twoinc_Brand::get('gateway_id') . '_tax_code_map', $hidden[1] ?? null, 'one field carries the mapping');
        $initial = json_decode(html_entity_decode($hidden[2] ?? '', ENT_QUOTES), true);
        TinyAssert::same(7, $initial['rows'] ?? null, 'it counts every row');
        TinyAssert::same(['ES_IVA_EXPORT', 'ES_RETIRED_CODE', ''], [$initial['map']['standard|exempt'], $initial['map']['rate:11'], $initial['map']['reduced-rate|none']], 'and holds each row\'s code, (none) as empty');
        TinyAssert::same($gateway->map, $gateway->validate_two_tax_code_map_field('tax_code_map', $hidden[2] ? html_entity_decode($hidden[2], ENT_QUOTES) : ''), 'saving the screen unchanged keeps the mapping');

        $post = static function (array $map, ?int $rows = null) {
            return json_encode(['rows' => $rows ?? count($map), 'map' => $map]);
        };
        $cases = [
            // posted field, expected map (null: refused), description
            [$post(['standard|exempt' => 'ES_IVA_EXPORT', 'rate:11' => '', 'rate:31' => 'es_iva_zero', 'standard|none' => 'ES_IVA_EXPORT']), ['standard|exempt' => 'ES_IVA_EXPORT', 'rate:31' => 'ES_IVA_ZERO', 'standard|none' => 'ES_IVA_EXPORT'], '(none) dropped, codes upper-cased'],
            [$post(['rate:21' => 'ES_IVA_ZERO', 'rate:99' => 'ES_IVA_ZERO', 'deleted|none' => 'ES_IVA_ZERO', 'standard' => 'ES_IVA_ZERO', 'reduced-rate|exempt' => '<b>']), [], 'only rows the shop has now, with a code of the right shape'],
            [addslashes($post(['standard|none' => 'ES_IVA_EXPORT'])), ['standard|none' => 'ES_IVA_EXPORT'], 'WordPress slashes the posted field'],
            [$post(['standard|none' => 'ES_IVA_EXPORT'], 7), null, 'fewer rows than the form counted: refused'],
            [substr($post(['standard|none' => 'ES_IVA_EXPORT']), 0, -3), null, 'a field cut short: refused'],
            ['', null, 'an empty field: refused'],
            [json_encode(['map' => []]), null, 'no row count: refused'],
        ];
        foreach ($cases as [$field, $expected, $description]) {
            try {
                $saved = $gateway->validate_two_tax_code_map_field('tax_code_map', $field);
            } catch (Exception $e) {
                $saved = null;
                TinyAssert::true(strpos($e->getMessage(), 'not saved') !== false, "$description: the refusal says nothing was saved");
            }
            TinyAssert::same($expected, $saved, $description);
        }
        TinyAssert::same($gateway->map, $gateway->validate_two_tax_code_map_field('tax_code_map', null), 'a save without the field keeps the mapping');

        $gateway->responses = [['response' => ['code' => 503], 'body' => '{}']];
        delete_option(WC_Twoinc_Brand::prefixed_name('tax_codes'));
        $html = $gateway->generate_two_tax_code_map_html('tax_code_map', ['title' => 'Tax codes']);
        TinyAssert::true(strpos($html, 'The list of tax codes could not be loaded') !== false, 'the screen says the list failed');
        TinyAssert::true(strpos($html, '<option value="ES_IVA_EXPORT" selected="selected">') !== false, 'a saved mapping still shows');
    }

    /**
     * Shared case 18 (TWO-26153): the upgrade copies each class's code to its exempt row, its no-rule row and every
     * 0% rate it has, and nothing else; it runs once, gated on the mapping's version.
     */
    private static function testTheMigrationFansTheClassCodeOut(): void
    {
        $GLOBALS['__twoinc_test_tax_classes'] = ['Reduced rate', 'Zero rate'];
        $GLOBALS['__twoinc_test_class_rates'] = [
            '' => [11 => ['tax_rate' => '0'], 21 => ['tax_rate' => '21'], 12 => ['tax_rate' => '0']],
            'reduced-rate' => [31 => ['tax_rate' => '0']],
            'zero-rate' => [41 => ['tax_rate' => '0']],
        ];
        $cases = [
            // stored map, migrated map, description
            [['standard' => 'X'], ['standard|exempt' => 'X', 'standard|none' => 'X', 'rate:11' => 'X', 'rate:12' => 'X'], '18: EX, NR and every 0% rate of the class take its code; the 21% rate and other classes none'],
            [['standard' => 'X', 'reduced-rate' => 'Y'], ['standard|exempt' => 'X', 'standard|none' => 'X', 'rate:11' => 'X', 'rate:12' => 'X', 'reduced-rate|exempt' => 'Y', 'reduced-rate|none' => 'Y', 'rate:31' => 'Y'], 'each class fans out to its own rows'],
            [['standard|none' => 'Z', 'standard' => 'X'], ['standard|none' => 'Z', 'standard|exempt' => 'X', 'rate:11' => 'X', 'rate:12' => 'X'], 'a row already set wins over the fanned-out code'],
            [['rate:41' => 'Z', 'zero-rate|exempt' => 'Y'], ['rate:41' => 'Z', 'zero-rate|exempt' => 'Y'], 'a mapping already in rows is left as it is'],
            [[], [], 'nothing to move'],
        ];
        foreach ($cases as [$stored, $expected, $description]) {
            TinyAssert::same($expected, WC_Twoinc::fan_out_tax_code_map($stored), $description);
        }

        $gateway = new class () extends WC_Twoinc {
            public function __construct()
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
            }
        };
        $migrate = new ReflectionMethod(WC_Twoinc::class, 'migrate_tax_code_map_to_rows');
        // Required before PHP 8.1.
        $migrate->setAccessible(true);
        $gateway->settings = ['tax_code_map' => ['reduced-rate' => 'Y'], 'title' => 'Two'];
        $migrate->invoke($gateway);
        $moved = ['reduced-rate|exempt' => 'Y', 'reduced-rate|none' => 'Y', 'rate:31' => 'Y'];
        TinyAssert::same($moved, get_option($gateway->get_option_key())['tax_code_map'] ?? null, 'the upgrade stores the rows');
        TinyAssert::same('Two', get_option($gateway->get_option_key())['title'] ?? null, 'and keeps every other setting');
        TinyAssert::same('2', get_option(WC_Twoinc_Brand::prefixed_name('tax_code_map_version')), 'and records the version');
        $gateway->settings = ['tax_code_map' => ['standard' => 'X']];
        $migrate->invoke($gateway);
        TinyAssert::same($moved, get_option($gateway->get_option_key())['tax_code_map'] ?? null, 'it runs once');
    }

    /** Tax rates of the case table by tax_rate_id, as the order's tax rows record them: percent. */
    private const CASE_RATES = [11 => 0.0, 12 => 0.0, 13 => 0.0, 21 => 21.0];

    /**
     * The shared tax-code case table (TWO-26153), rows 1 to 17 in the design's order, then the rows the sibling
     * plugins' reviews added. Merchant ES unless the last column says otherwise. WooCommerce taxes on the delivery
     * address here, so it is the tax address.
     *
     * Columns: lines ('goods' a standard-class product; 'service' one of class `services`; 'keyless' shipping whose
     * class follows the items and finds none; the expected code is the last line's), billing country and postcode,
     * tax address, buyer VAT number meta, the line's taxes (rate id => tax charged on 100, see CASE_RATES), the rates
     * WooCommerce finds at the tax address for a line it did not tax (rate id => percent), rows mapped (EX and NR of
     * `standard`, EX2 the exempt row of `services`, else a row key), expected code, description, merchant country,
     * and setup: `vat_exempt` (the order is VAT-exempt), `tax_status` (of the first product), `taxes_off` (taxes
     * disabled shop-wide), `class_rates` (the standard class's rates, rate id => percent).
     * Lines may also hold 'shipping', a 0% shipping line of the standard class.
     *
     * @return array<int, array>
     */
    private static function caseRows(): array
    {
        $intra = 'ES_IVA_INTRA_COMMUNITY';
        $export = 'ES_IVA_EXPORT';
        $services = 'ES_IVA_INTRA_COMMUNITY_SERVICES';
        return [
            [['goods'], 'ES 28001', 'ES 28001', '', [21 => 21.0], [], ['EX' => $intra], null, '1: non-0% lines are never touched'],
            [['goods'], 'DE 10115', 'DE 10115', 'DE123', [], [], ['EX' => $intra], $intra, '2: step 1 exempt buyer'],
            [['goods'], 'DE 10115', 'DE 10115', 'de 123', [], [], ['EX' => $intra], $intra, '3: VAT read as entered, any non-empty value counts'],
            [['goods'], 'DE 10115', 'DE 10115', '   ', [], [], ['EX' => $intra], null, '4: whitespace-only VAT is empty; NR on (none) gives no code'],
            [['goods'], 'DE 10115', 'US 10001', 'DE123', [12 => 0.0], [], ['EX' => $intra, 'rate:12' => $export], $export, '5: export: tax address outside the EU skips step 1'],
            [['goods'], 'ES 35001', 'ES 35001', '', [11 => 0.0], [], ['rate:11' => $export], $export, '6: step 2 shop\'s 0% rate'],
            [['goods'], 'US 10001', 'US 10001', '', [], [], ['NR' => $export], $export, '7: step 3 no-rule row'],
            [['goods'], 'DE 10115', 'DE 10115', 'DE123', [], [], ['NR' => $intra], null, '8: a matched row on (none) never falls through'],
            [['goods'], 'ES 28001', 'ES 28001', 'ESB123', [], [], ['EX' => $intra], null, '9: merchant-country buyer is never exempt'],
            [['goods'], 'MC 98000', 'MC 98000', 'FR123', [], [], ['EX' => $intra], $intra, '10: Monaco is in the EU VAT area'],
            [['goods'], 'GB BT1 1AA', 'GB BT1 1AA', 'XI123', [], [], ['EX' => $intra], $intra, '11: Northern Ireland (GB + BT postcode) is in the EU VAT area'],
            [['goods'], 'GB SW1A 1AA', 'GB SW1A 1AA', 'GB123', [], [], ['EX' => $intra, 'NR' => $export], $export, '12: Great Britain is outside'],
            [['goods'], 'CH 8001', 'CH 8001', 'CHE123', [], [], ['EX' => $intra, 'NR' => $export], $export, '13: Switzerland is outside'],
            [['service'], 'FR 75001', 'FR 75001', 'FR123', [], [], ['EX2' => $services], $services, '14: goods vs services comes from the merchant\'s per-class mapping'],
            [['goods', 'keyless'], 'DE 10115', 'DE 10115', 'DE123', [], [], ['EX' => $intra], $intra, '15: step 4: shared code of the order\'s coded 0% lines'],
            [['goods', 'service', 'keyless'], 'DE 10115', 'DE 10115', 'DE123', [], [], ['EX' => $intra, 'EX2' => $services], null, '16: step 4: disagreeing codes give no code'],
            [['goods', 'keyless'], 'DE 10115', 'DE 10115', '', [], [], ['EX' => $intra], null, '17: step 4 with nothing to share'],
            [['goods'], 'ES 28001', 'DE 10115', 'DE123', [], [], ['EX' => $intra, 'NR' => $export], $export, 'a buyer billed in the merchant\'s country is not exempt, wherever the goods go'],
            [['goods'], 'US 10001', 'DE 10115', 'DE123', [], [], ['EX' => $intra, 'NR' => $export], $export, 'a buyer billed outside the EU VAT area is not exempt'],
            [['goods'], 'DE 10115', 'DE 10115', 'DE123', [], [], ['EX' => $intra, 'NR' => $export], $export, 'step 1 needs a known merchant country', ''],
            [['goods'], 'ES 35001', 'ES 35001', '', [11 => 0.0, 13 => 0.0], [], ['rate:11' => $export, 'rate:13' => $intra], $export, 'the first 0% rate on the line wins'],
            [['goods'], 'ES 35001', 'ES 35001', '', [11 => 0.0, 21 => 0.0], [], ['rate:11' => $export], null, 'a 0% rate alongside a 21% one gives no code'],
            [['goods'], 'ES 35001', 'ES 35001', '', [], [11 => 0.0], ['rate:11' => $export, 'NR' => $intra], $export, 'a VAT-exempt order\'s untaxed line takes the 0% rate the shop has at the tax address', 'ES', ['vat_exempt' => true]],
            [['goods'], 'US 10001', 'US 10001', '', [], [21 => 21.0], ['NR' => $export], null, 'a VAT-exempt order\'s untaxed line whose rate is above 0% gets no code', 'ES', ['vat_exempt' => true]],
            [['goods'], 'US 10001', 'US 10001', '', [], [], ['NR' => $export], $export, 'a VAT-exempt order\'s untaxed line with no rate at the address takes the no-rule row', 'ES', ['vat_exempt' => true]],
            [['goods'], 'ES 28001', 'ES 28001', '', [], [21 => 21.0], ['NR' => 'ES_IVA_EXEMPT_ART20'], 'ES_IVA_EXEMPT_ART20', 'a product whose tax status is none takes the no-rule row, whatever rate its class has', 'ES', ['tax_status' => 'none']],
            [['goods'], 'ES 28001', 'ES 28001', '', [], [21 => 21.0], ['NR' => 'ES_IVA_EXEMPT_ART20'], 'ES_IVA_EXEMPT_ART20', 'a product whose tax status is none takes the no-rule row on a VAT-exempt order too, with no lookup', 'ES', ['tax_status' => 'none', 'vat_exempt' => true]],
            [['goods'], 'ES 28001', 'ES 28001', '', [], [21 => 21.0], ['NR' => 'ES_IVA_EXEMPT_ART20'], 'ES_IVA_EXEMPT_ART20', 'a taxable line with no rate on an order that is not VAT-exempt matched no rule: the no-rule row'],
            [['goods', 'shipping'], 'ES 35001', 'ES 35001', '', [], [11 => 0.0], ['rate:11' => $intra, 'NR' => $export], $export, 'shipping is looked up in the rates that apply to shipping', 'ES', ['vat_exempt' => true, 'shipping_rate_flag' => 'no']],
            [['goods'], 'US 10001', 'US 10001', '', [], [], ['NR' => $export], null, 'taxes disabled shop-wide: no code', 'ES', ['taxes_off' => true]],
            [['goods'], 'US 10001', 'US 10001', '', [], [], ['rate:13' => $intra], null, 'a mapped 0% rate of the class, though not on the line, stops the derivation', 'ES', ['class_rates' => [13 => 0.0]]],
            [['goods'], 'US 10001', 'US 10001', '', [], [], ['rate:99' => $intra], $export, 'a mapped rate of another class leaves the class unmapped, so the derivation applies', 'ES', ['class_rates' => [13 => 0.0]]],
            [['goods', 'keyless'], 'US 10001', 'US 10001', '', [], [], ['NR' => $export], $export, 'step 4 shares a step 3 code'],
        ];
    }

    private static function testTheSharedCaseTable(): void
    {
        $GLOBALS['__twoinc_test_tax_classes'] = ['Services'];
        $GLOBALS['__twoinc_test_options']['woocommerce_shipping_tax_class'] = 'inherit';
        $keys = ['EX' => 'standard|exempt', 'NR' => 'standard|none', 'EX2' => 'services|exempt'];
        foreach (self::caseRows() as $row) {
            [$lines, $billing, $taxAddress, $vat, $taxes, $shopRates, $rows, $expected, $description] = $row;
            $GLOBALS['__twoinc_test_options'][WC_Twoinc_Brand::prefixed_name('merchant_country')] = $row[9] ?? 'ES';
            $setup = $row[10] ?? [];
            $GLOBALS['__twoinc_test_find_rates'] = ['' => array_map(static function ($percent) use ($setup) {
                return ['rate' => $percent, 'shipping' => $setup['shipping_rate_flag'] ?? 'yes', 'compound' => 'no', 'label' => 'Tax'];
            }, $shopRates)];
            $GLOBALS['__twoinc_test_tax_enabled'] = empty($setup['taxes_off']);
            $GLOBALS['__twoinc_test_class_rates'] = ['' => array_map(static function ($percent) {
                return ['tax_rate' => (string) $percent];
            }, $setup['class_rates'] ?? [])];
            WC_Twoinc::reset_zero_tax_rates_memo();
            $map = [];
            foreach ($rows as $row_key => $code) {
                $map[$keys[$row_key] ?? $row_key] = $code;
            }
            self::useGateway($map);
            $order = self::caseOrder($lines, $billing, $taxAddress, $taxes, $setup['tax_status'] ?? 'taxable');
            $order->meta = ['_billing_vat_number' => $vat] + (empty($setup['vat_exempt']) ? [] : ['is_vat_exempt' => 'yes']);
            $sent = WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', [], '', '', '', '', '', '', true);
            $line = end($sent['line_items']);
            TinyAssert::same($expected, $line['tax_code'] ?? null, $description . ' (got: ' . json_encode($line['tax_code'] ?? null) . ')');
        }
    }

    /**
     * The placement record (TWO-26153): an order created with Two keeps the codes it was placed with on edit and
     * refund, whatever changes later. A line the record does not cover is resolved now, and step 4 shares only the
     * codes the record holds from steps 1 to 3, never derived ones.
     */
    private static function testThePlacementRecordKeepsTheCodes(): void
    {
        $GLOBALS['__twoinc_test_options']['woocommerce_shipping_tax_class'] = 'inherit';
        $GLOBALS['__twoinc_test_options'][WC_Twoinc_Brand::prefixed_name('merchant_country')] = 'ES';
        $meta = WC_Twoinc_Brand::meta_key('tax_codes');
        $codes = static function (array $payload) {
            return array_map(static function ($line) {
                return $line['tax_code'] ?? null;
            }, $payload['line_items']);
        };
        $intra = 'ES_IVA_INTRA_COMMUNITY';
        self::useGateway(['standard|exempt' => $intra]);
        $order = self::caseOrder(['goods', 'keyless'], 'DE 10115', 'DE 10115', []);
        $order->meta = ['_billing_vat_number' => 'DE123'];

        TinyAssert::same([$intra, $intra], $codes(WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', [], '', '', '', '', '', '', true)), 'create');
        TinyAssert::same(['1' => ['code' => $intra, 'step' => 'row'], '6' => ['code' => $intra, 'step' => 'keyless']], $order->meta[$meta] ?? null, 'create records each 0% line by item id and how its code was reached');
        $order->meta[$meta] = ['1' => ['code' => 'MARK', 'step' => 'row']];
        TinyAssert::same([null, null], $codes(WC_Twoinc_Helper::compose_twoinc_intent($order, [])), 'the intent sends no code');
        TinyAssert::same(['1' => ['code' => 'MARK', 'step' => 'row']], $order->meta[$meta], 'and records nothing');
        WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', [], '', '', '', '', '', '', true);

        $order->meta[WC_Twoinc_Brand::prefixed_name('order_id')] = 'two-order';
        $order->meta['_billing_vat_number'] = '';
        self::useGateway(['standard|exempt' => 'ES_IVA_EXEMPT_ART20', 'standard|none' => 'ES_IVA_EXEMPT_ART20']);
        $record = $order->meta[$meta];
        TinyAssert::same([$intra, $intra], $codes(WC_Twoinc_Helper::compose_twoinc_edit_order($order, '', '', '', '')), 'an edit after the mapping and the VAT number changed sends the recorded codes');
        $refund = new StubRefund(['shipping' => [new StubShippingItem(-10.0, 0.0, [], ['_refunded_item_id' => 6])]], []);
        TinyAssert::same([$intra], $codes(WC_Twoinc_Helper::compose_twoinc_refund($refund, 10.0, $order)), 'so does a refund');
        TinyAssert::same($record, $order->meta[$meta], 'and neither rewrites the record');

        $order->addLine(3, 'goods');
        TinyAssert::same([$intra, 'ES_IVA_EXEMPT_ART20', $intra], $codes(WC_Twoinc_Helper::compose_twoinc_edit_order($order, '', '', '', '')), 'a line added by an edit is resolved now');

        $cases = [
            // record of item 1, the code an unrecorded keyless line takes, description
            [['code' => $intra, 'step' => 'row'], $intra, 'a recorded step 1 to 3 code is shared'],
            [['code' => 'ES_IVA_EXPORT', 'step' => 'derived'], null, 'a recorded derived code is not shared, and derivation for a domestic order gives none'],
            [['code' => 'ES_IVA_EXPORT', 'step' => 'keyless'], null, 'a recorded step 4 code is not shared'],
        ];
        self::useGateway([]);
        foreach ($cases as [$entry, $expected, $description]) {
            $placed = self::caseOrder(['goods', 'keyless'], 'ES 28001', 'ES 28001', []);
            $placed->meta = [WC_Twoinc_Brand::prefixed_name('order_id') => 'two-order', $meta => ['1' => $entry]];
            TinyAssert::same([$entry['code'], $expected], $codes(WC_Twoinc_Helper::compose_twoinc_edit_order($placed, '', '', '', '')), $description);
        }
    }

    /**
     * A create attempt replaces the record an earlier attempt left on the order (TWO-26153), and an order whose
     * lines got no code still records that, so mapping rows after placement never moves it. Only a merchant outside
     * Spain with no row mapped records nothing, which clears an earlier record.
     */
    private static function testARetryReplacesTheRecord(): void
    {
        $meta = WC_Twoinc_Brand::meta_key('tax_codes');
        $none = ['code' => null, 'step' => 'row'];
        $cases = [
            // merchant, map, line taxes, record after the retry, description
            ['NO', [], [], [], 'nothing mapped outside Spain: the earlier record is cleared'],
            ['NO', ['standard|exempt' => 'X'], [21 => 21.0], [], 'no 0% line left: the earlier record is cleared'],
            ['NO', ['rate:99' => 'X'], [], ['1' => $none], 'a mapped shop records "no code" over the earlier code'],
            ['ES', ['standard|exempt' => 'X'], [], ['1' => $none], 'a Spanish merchant records "no code" over the earlier code'],
        ];
        foreach ($cases as [$merchant, $map, $taxes, $expected, $description]) {
            $GLOBALS['__twoinc_test_options'][WC_Twoinc_Brand::prefixed_name('merchant_country')] = $merchant;
            self::useGateway($map);
            $order = self::caseOrder(['goods'], 'ES 28001', 'ES 28001', $taxes);
            $order->meta = [$meta => ['1' => ['code' => 'ES_IVA_EXPORT', 'step' => 'row']]];
            $sent = WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', [], '', '', '', '', '', '', true);
            TinyAssert::same(null, $sent['line_items'][0]['tax_code'] ?? null, $description . ': the retry sends no code');
            TinyAssert::same($expected, $order->meta[$meta] ?? null, $description);
        }

        // The last order is placed; rows mapped afterwards do not give its line a code.
        $order->meta[WC_Twoinc_Brand::prefixed_name('order_id')] = 'two-order';
        self::useGateway(['standard|exempt' => 'X', 'standard|none' => 'ES_IVA_EXEMPT_ART20']);
        $edit = WC_Twoinc_Helper::compose_twoinc_edit_order($order, '', '', '', '');
        TinyAssert::same(null, $edit['line_items'][0]['tax_code'] ?? null, 'a placed line recorded with no code keeps none after the mapping changes');
    }

    /**
     * What an order costs a shop that maps nothing (TWO-26153): no buyer VAT lookup for the exempt test and no read
     * of the shop's rate table, and no placement record when no line got a code. A shop that maps rows reads each
     * class's rates once per request.
     */
    private static function testAnUnconfiguredShopLooksNothingUp(): void
    {
        $vatReads = 0;
        add_filter('twoinc_buyer_vat_number', static function ($vat) use (&$vatReads) {
            $vatReads++;
            return $vat;
        });
        $GLOBALS['__twoinc_test_class_rates'] = ['' => [13 => ['tax_rate' => '0']]];
        $cases = [
            // merchant, map, VAT reads, rate table reads, recorded, description
            ['NO', [], 0, 0, false, 'a merchant outside Spain with nothing mapped reads neither, and records no codes'],
            ['ES', [], 3, 0, true, 'a Spanish merchant with nothing mapped reads the VAT number only for the derivation and the payload, and no rates'],
            ['NO', ['rate:99' => 'X'], 1, 0, true, 'a mapped shop runs the exempt test, and records its lines\' "no code"; with no derivation it never asks whether a class is mapped'],
            ['ES', ['rate:99' => 'X'], 4, 1, true, 'a Spanish merchant\'s class with no row reads its rates once for two lines'],
        ];
        foreach ($cases as [$merchant, $map, $wantVat, $wantRates, $recorded, $description]) {
            $GLOBALS['__twoinc_test_options'][WC_Twoinc_Brand::prefixed_name('merchant_country')] = $merchant;
            $GLOBALS['__twoinc_test_class_rate_reads'] = 0;
            WC_Twoinc::reset_zero_tax_rates_memo();
            self::useGateway($map);
            $order = self::caseOrder(['goods', 'goods'], 'DE 10115', 'DE 10115', []);
            $order->meta = ['_billing_vat_number' => 'DE123'];
            $vatReads = 0;
            WC_Twoinc_Helper::compose_twoinc_order($order, 'ref', '912345678', '', '', '', [], '', '', '', '', '', '', true);
            TinyAssert::same([$wantVat, $wantRates], [$vatReads, $GLOBALS['__twoinc_test_class_rate_reads']], $description . ' (VAT reads, rate table reads)');
            TinyAssert::same($recorded, array_key_exists(WC_Twoinc_Brand::meta_key('tax_codes'), $order->meta), $description . ': a record unless nothing could code the lines');
        }
        remove_all_filters('twoinc_buyer_vat_number');
    }

    /**
     * An order for the case table: product lines of 100 at the given taxes (the first standard-class product is item
     * 1), and 'keyless' a 0% shipping line, item 6, that carries no rate.
     */
    private static function caseOrder(array $lines, string $billing, string $taxAddress, array $taxes, string $taxStatus = 'taxable'): TaxCodeSpecOrder
    {
        $items = [];
        $shipping = [];
        $tax = array_sum($taxes);
        $classed = false;
        foreach ($lines as $i => $kind) {
            if ($kind === 'keyless' || $kind === 'shipping') {
                $shipping[6] = new StubShippingItem(10.0, 0.0, []);
                $classed = $kind === 'shipping';
                continue;
            }
            $items[1 + $i] = self::caseLine($kind, $i === 0 ? $taxes : [], $i === 0 ? $taxStatus : 'taxable');
        }
        [$country, $postcode] = explode(' ', $taxAddress, 2);
        $order = new TaxCodeSpecOrder($items, $shipping, $billing, ['country' => $country, 'postcode' => $postcode], 100.0 * count($items) + ($shipping ? 10.0 : 0.0) + $tax, $tax);
        $order->itemClasses = $classed ? [''] : [];
        $order->orderTaxes = array_map(static function ($id) {
            return new StubOrderTaxItem($id, self::CASE_RATES[$id]);
        }, array_keys(self::CASE_RATES));
        return $order;
    }

    public static function caseLine(string $kind, array $taxes, string $taxStatus = 'taxable'): StubProductLineItem
    {
        return new StubProductLineItem([
            'name' => ucfirst($kind), 'line_subtotal' => 100.0, 'line_total' => 100.0, 'line_tax' => array_sum($taxes), 'tax_status' => $taxStatus,
            'taxes' => $taxes, 'tax_class' => $kind === 'service' ? 'services' : '', 'data' => new TaxCodeSpecProduct($kind === 'service'),
        ]);
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
    /** @var StubOrderTaxItem[]|null the order's tax rows; null for one 21% row, id 1 */
    public $orderTaxes;

    /** @var string[] the tax classes of the order's items, which "Shipping tax class: based on cart items" follows */
    public $itemClasses = [];

    public function get_items_tax_classes()
    {
        return $this->itemClasses;
    }
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
        return $this->orderTaxes ?? [new StubOrderTaxItem(1, 21.0)];
    }

    /** The address WooCommerce taxes on: delivery, or billing when there is none. */
    public function get_taxable_location()
    {
        return $this->delivery
            ? ['country' => $this->delivery['country'], 'state' => '', 'postcode' => $this->delivery['postcode'], 'city' => 'City']
            : ['country' => $this->buyer, 'state' => '', 'postcode' => $this->buyerPostcode, 'city' => 'City'];
    }

    public function addLine(int $id, string $kind): void
    {
        $this->items[$id] = TaxCodeSpec::caseLine($kind, []);
        $this->total += 100.0;
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
