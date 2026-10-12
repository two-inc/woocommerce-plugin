<?php

declare(strict_types=1);

/**
 * The "Tax codes for 0% lines" settings section (TWO-26153): when it shows, what it offers, its notices and error
 * states, its own merchant profile, the code list's retry floor, Clear, the health row and the refresh button. Admin
 * only: nothing here changes what an order sends.
 */
final class TaxCodeAdminSpec
{
    public static function runAll(): void
    {
        $tests = [
            'testTheSectionShowsWhatTheStateDecides',
            'testTheCodeListIsCachedFlooredAndServedStale',
            'testTheProfileIsTheSectionsOwn',
            'testTheTableOffersOnlyZeroRatedCodes',
            'testTheSaveHonoursClearAndTheShownRows',
            'testTheHealthRowPointsAtClear',
            'testRefreshExpiresTheSectionAndConfirmsOnReload',
        ];
        $instance = new ReflectionProperty(WC_Twoinc::class, 'instance');
        // Required before PHP 8.1.
        $instance->setAccessible(true);
        $previous = $instance->getValue();
        foreach ($tests as $test) {
            self::reset();
            try {
                self::$test();
            } finally {
                $instance->setValue(null, $previous);
                unset($_GET['twoinc_refreshed']);
            }
            print("PASS TaxCodeAdminSpec::$test\n");
        }
        self::reset();
    }

    private static function reset(): void
    {
        $GLOBALS['__twoinc_test_options'] = ['woocommerce_shipping_tax_class' => ''];
        $GLOBALS['__twoinc_test_tax_classes'] = [];
        $GLOBALS['__twoinc_test_class_rates'] = ['' => [11 => ['tax_rate' => '0.0000', 'tax_rate_country' => 'ES', 'tax_rate_name' => 'IVA 0%', 'postcode' => ['35*']]]];
        $GLOBALS['__twoinc_test_logs'] = [];
        unset($GLOBALS['__twoinc_test_base_country']);
        WC_Twoinc::reset_zero_tax_rates_memo();
    }

    private static function code(string $code, string $rate, ?string $reason = 'R'): array
    {
        return ['code' => $code, 'rate' => $rate, 'display_name' => ucfirst(strtolower($code)), 'requires_exemption_reason' => true, 'exemption_reason_code' => $reason];
    }

    /** The code lists the API gives, by country. */
    private static function lists(): array
    {
        $es = [self::code('ES_IVA_EXPORT', '0'), self::code('ES_IVA_INTRA', '0'), self::code('ES_IVA_STANDARD', '0.21', null), self::code('ES_IVA_EXEMPT_OTHER', '0', null)];
        $es[2]['requires_exemption_reason'] = false;
        $gb = [self::code('GB_VAT_ZERO', '0'), self::code('GB_VAT_REVERSE_CHARGE', '0'), self::code('GB_VAT_STANDARD', '0.2')];
        $gb[2]['requires_exemption_reason'] = false;
        return [
            'ES' => [200, ['data' => $es, 'metadata' => ['mandatory_tax_codes_enabled' => true, 'mandatory_tax_rates' => ['0']]]],
            'GB' => [200, ['data' => $gb, 'metadata' => ['mandatory_tax_codes_enabled' => false, 'mandatory_tax_rates' => []]]],
        ];
    }

    /**
     * A gateway whose stored key is "sk_test_secret", whose checkout holds merchant "mid" in `$checkout_country`, and whose API
     * answers verify with "mid" and the merchant record with `$country`.
     */
    private static function gateway(string $country = 'ES', $map = [], string $checkout_country = '')
    {
        $gateway = new TaxCodeAdminSpecGateway();
        $gateway->opts = ['api_key' => 'sk_test_secret', 'merchant_id' => 'mid', 'tax_code_map' => $map];
        $gateway->routes = [
            '/v1/merchant/verify_api_key' => [200, ['id' => 'mid', 'short_name' => 'sn']],
            '/v1/merchant/mid' => [200, ['id' => 'mid', 'country_code' => strtolower($country)]],
        ];
        foreach (self::lists() as $cc => $route) {
            $gateway->routes['/v1/tax_codes/' . $cc] = $route;
        }
        $GLOBALS['__twoinc_test_options'][WC_Twoinc_Brand::prefixed_name('merchant_country')] = $checkout_country !== '' ? $checkout_country : $country;
        $instance = new ReflectionProperty(WC_Twoinc::class, 'instance');
        $instance->setAccessible(true);
        $instance->setValue(null, $gateway);
        return $gateway;
    }

    private static function render($gateway): string
    {
        return $gateway->generate_two_tax_code_map_html('tax_code_map', ['title' => 'Tax codes for 0% lines']);
    }

    private static function has(string $html, string $needle): bool
    {
        return strpos($html, $needle) !== false;
    }

    /** What each state shows, first match wins, as the needles found (true) or absent (false) in the rendered section. */
    private static function testTheSectionShowsWhatTheStateDecides(): void
    {
        $intro = 'requires a tax code on every 0% line for your country';
        $n1 = 'Saved tax codes still apply at checkout';
        $n2 = 'Some saved tax codes are not valid on 0% lines';
        $n3 = 'Saved tax codes can&#039;t be read';
        $w1 = 'Checkout has not picked up your merchant details';
        $clear = 'Clear saved tax codes';
        $mandatory = static function (array $rates) {
            return static function ($g) use ($rates) {
                $g->routes['/v1/tax_codes/ES'][1]['metadata']['mandatory_tax_rates'] = $rates;
            };
        };
        $cases = [
            // country, stored map, tweak, [needle => shown], description
            ['ES', [], null, [$intro => true, $clear => false, $w1 => false], 'ES, mandatory at "0": the rows'],
            ['ES', [], $mandatory(['0.00']), [$intro => true], 'ES, mandatory at "0.00": the rows'],
            ['ES', [], $mandatory(['0.21']), ['' => true], 'mandatory, but not at 0%: hidden'],
            ['GB', [], null, ['' => true], 'GB, nothing saved: hidden'],
            ['GB', ['standard|none' => 'ES_IVA_EXPORT'], null, [$n2 => true, $clear => true, $intro => false], 'GB with an ES code: N2 and Clear'],
            ['GB', ['standard|none' => 'GB_VAT_ZERO', 'rate:11' => 'GB_VAT_REVERSE_CHARGE'], null, [$n1 => true, $clear => true, $n2 => false], 'GB with 0% GB codes: N1 and Clear'],
            ['GB', ['standard|none' => 'GB_VAT_STANDARD'], null, [$n2 => true, $clear => true], 'GB with a 20% code: N2 and Clear'],
            ['GB', 'standard|none=X', null, [$n3 => true, $clear => true, $n1 => false, $n2 => false], 'GB with an unreadable map: N3 and Clear'],
            ['ES', 'standard|none=X', null, [$n3 => true, $intro => true, $clear => true], 'ES with an unreadable map: N3 above the rows'],
            ['ES', [], static function ($g) {
                $g->opts['merchant_id'] = 'other';
            }, [$w1 => true, $intro => true], 'checkout holds another merchant id: W1'],
            ['ES', [], static function ($g) {
                $GLOBALS['__twoinc_test_options'][WC_Twoinc_Brand::prefixed_name('merchant_country')] = '';
            }, [$w1 => true, $intro => true], 'checkout has no merchant country: W1'],
            ['ES', 'standard|none=X', static function ($g) {
                $g->opts['api_key'] = '';
            }, ['' => true], 'no key, unreadable map: hidden'],
            ['IT', ['standard|none' => 'GB_VAT_ZERO'], static function ($g) {
                $g->routes['/v1/tax_codes/IT'] = [400, ['error_code' => 'COUNTRY_NOT_SUPPORTED']];
            }, [$n2 => true], 'no registry: a saved code is N2'],
            ['ES', [], static function ($g) {
                $g->routes['/v1/merchant/verify_api_key'] = [503, []];
            }, ['Could not read your merchant details from' => true, 'HTTP 503' => true, $intro => false], 'verify 503: E1'],
            ['ES', [], static function ($g) {
                $g->routes['/v1/merchant/verify_api_key'] = [401, []];
            }, ['rejected the stored API key' => true, $intro => false], 'verify 401: E1b'],
            ['ES', [], static function ($g) {
                $g->routes['/v1/merchant/mid'] = [200, ['id' => 'mid']];
            }, ['Could not read your merchant details from' => true, 'HTTP 200' => true], 'a merchant without a country: E1'],
            ['ES', [], static function ($g) {
                $g->routes['/v1/merchant/mid'] = [404, []];
                $GLOBALS['__twoinc_test_base_country'] = 'ES';
            }, ['Could not read your merchant details from' => true, $intro => false], 'no fallback to the shop base country: E1'],
            ['ES', [], static function ($g) {
                $g->routes['/v1/tax_codes/ES'] = [503, []];
            }, ['Could not check whether' => true, '(Spain, HTTP 503)' => true, $intro => false], 'a list outage, nothing cached: E2'],
        ];
        $GLOBALS['__twoinc_test_countries'] = ['ES' => 'Spain', 'GB' => 'United Kingdom (UK)'];
        foreach ($cases as [$country, $map, $tweak, $expect, $description]) {
            self::reset();
            $gateway = self::gateway($country, $map);
            if ($tweak) {
                $tweak($gateway);
            }
            $html = self::render($gateway);
            foreach ($expect as $needle => $shown) {
                if ($needle === '') {
                    TinyAssert::same('', $html, "$description: nothing is rendered");
                    continue;
                }
                TinyAssert::same($shown, self::has($html, (string) $needle), "$description: " . ($shown ? 'shows' : 'does not show') . " \"$needle\"");
            }
            if ($country === 'ES' && is_string($map) && $gateway->opts['api_key'] !== '') {
                TinyAssert::true(strpos($html, $n3) < strpos($html, 'twoinc-tax-code-map"'), "$description: N3 sits above the table");
            }
            if ($gateway->opts['api_key'] === '') {
                TinyAssert::same([], $gateway->calls, "$description: no request");
            }
            $lookups = array_column(array_filter($GLOBALS['__twoinc_test_logs'], static function ($log) {
                return strpos($log['message'], 'merchant lookup failed at') !== false;
            }), 'message');
            TinyAssert::same(self::has($html, 'Could not read your merchant details') || self::has($html, 'rejected the stored API key') ? 1 : 0, count($lookups), "$description: one resolver line per failed lookup");
            TinyAssert::same(false, strpos(implode(' ', $lookups), 'sk_test_secret'), "$description: never the key");
        }
        unset($GLOBALS['__twoinc_test_countries']);
    }

    /** The list: a day's cache with metadata, a 5-minute floor per country, a registry-less country cached as empty. */
    private static function testTheCodeListIsCachedFlooredAndServedStale(): void
    {
        $gateway = self::gateway('ES');
        $option = WC_Twoinc_Brand::prefixed_name('tax_codes');
        $tried = WC_Twoinc_Brand::prefixed_name('tax_codes_tried');
        $count = static function () use ($gateway) {
            return count(array_filter($gateway->calls, static function ($call) {
                return strpos($call, '/v1/tax_codes/') === 0;
            }));
        };
        $meta = null;
        $codes = $gateway->get_tax_codes('es', $meta);
        TinyAssert::same([['ES_IVA_EXPORT', 'ES_IVA_INTRA', 'ES_IVA_STANDARD'], true, 1], [array_column($codes, 'code'), $meta['mandatory'], $count()], 'fetched, a code needing a reason dropped, mandatory');

        $steps = [
            // before the call, the route, [codes, mandatory, http, list calls so far], description
            [static function () {
            }, null, [3, true, 0, 1], 'a fresh list is served without a call'],
            [static function () use ($option, $tried) {
                $GLOBALS['__twoinc_test_options'][$option]['fetched_at'] = time() - 86401;
                $GLOBALS['__twoinc_test_options'][$tried] = 'ES:' . (time() - 301);
            }, [503, []], [3, true, 0, 2], 'an expired list is fetched again past the floor, and a failure serves the last one'],
            [static function () {
            }, [503, []], [3, true, 0, 2], 'inside the floor nothing is fetched'],
            [static function () use ($option, $tried) {
                unset($GLOBALS['__twoinc_test_options'][$option]['metadata']);
                $GLOBALS['__twoinc_test_options'][$tried] = 'ES:' . (time() - 301);
            }, [503, []], [null, false, 503, 3], 'an entry without metadata is a miss, so a failure is E2'],
            [static function () {
            }, [200, self::lists()['ES'][1]], [null, false, 0, 3], 'and the floor holds for the country'],
            [static function () use ($tried) {
                $GLOBALS['__twoinc_test_options'][$tried] = 'GB:' . time();
            }, [200, self::lists()['ES'][1]], [3, true, 0, 4], 'another country\'s floor does not hold'],
        ];
        foreach ($steps as [$before, $route, $want, $description]) {
            $before();
            if ($route !== null) {
                $gateway->routes['/v1/tax_codes/ES'] = $route;
            }
            $codes = $gateway->get_tax_codes('ES', $meta);
            TinyAssert::same($want, [$codes === null ? null : count($codes), $meta['mandatory'], $meta['http'], $count()], $description);
        }

        $gateway->routes['/v1/tax_codes/IT'] = [400, ['error_code' => 'COUNTRY_NOT_SUPPORTED']];
        TinyAssert::same([[], false], [$gateway->get_tax_codes('IT', $meta), $meta['mandatory']], 'no registry is an answer: no codes, not mandatory');
        $GLOBALS['__twoinc_test_options'][$tried] = '';
        TinyAssert::same([], $gateway->get_tax_codes('IT', $meta), 'and it is cached');
        TinyAssert::same(5, $count(), 'one request for it');
        $gateway->routes['/v1/tax_codes/PL'] = [400, ['error_code' => 'VALIDATION_ERROR']];
        TinyAssert::same([null, 400], [$gateway->get_tax_codes('PL', $meta), $meta['http']], 'any other 400 is a failure');
    }

    /** The section's profile: its own lookup, a day per key and environment, a 5-minute floor, never checkout's id. */
    private static function testTheProfileIsTheSectionsOwn(): void
    {
        $gateway = self::gateway('ES');
        $gateway->opts['merchant_id'] = '';
        $verifies = static function () use ($gateway) {
            return count(array_keys($gateway->calls, '/v1/merchant/verify_api_key', true));
        };
        $steps = [
            // before, [country or null, verifies so far], description
            [static function () {
            }, ['ES', 1], 'looked up through the key'],
            [static function () {
            }, ['ES', 1], 'held for a day'],
            [static function ($g) {
                $g->opts['api_key'] = 'new-key';
                $g->routes['/v1/merchant/mid'] = [200, ['country_code' => 'SE']];
            }, ['SE', 2], 'a key swapped without a save is looked up again'],
            [static function ($g) {
                $g->host = 'https://sandbox.test';
                $g->routes['/v1/merchant/verify_api_key'] = [503, []];
            }, [null, 3], 'an environment swap too, and a failure leaves no profile for the new slot'],
            [static function () {
            }, [null, 3], 'inside the floor nothing is fetched'],
            [static function ($g) {
                $g->host = 'https://api.test';
                $g->opts['api_key'] = 'new-key';
                $GLOBALS['__twoinc_test_options'][WC_Twoinc_Brand::prefixed_name('tax_code_profile')] = null;
            }, [null, 4], 'a lost slot is looked up afresh'],
            [static function () {
                $option = WC_Twoinc_Brand::prefixed_name('tax_code_profile');
                $GLOBALS['__twoinc_test_options'][$option] = ['slot' => md5('new-key|https://api.test'), 'merchant_id' => 'mid', 'country' => 'SE', 'fetched_at' => 1, 'tried_at' => 1, 'failure' => null];
            }, ['SE', 5], 'an expired profile is served when the lookup fails'],
        ];
        foreach ($steps as [$before, $want, $description]) {
            $before($gateway);
            $failure = null;
            $profile = $gateway->get_tax_code_profile($failure);
            TinyAssert::same($want, [$profile['country'] ?? null, $verifies()], $description);
        }
        TinyAssert::same('', $gateway->opts['merchant_id'], 'checkout\'s merchant id is never written');
    }

    /** The table: a row per tax class, the cases as columns, only 0% codes as "CODE - name", markers, widths, names. */
    private static function testTheTableOffersOnlyZeroRatedCodes(): void
    {
        $GLOBALS['__twoinc_test_tax_classes'] = ['Reduced rate'];
        $gateway = self::gateway('ES', ['standard|exempt' => 'ES_IVA_STANDARD', 'rate:11' => 'ES_GONE', 'standard|none' => 'ES_IVA_EXPORT']);
        $html = self::render($gateway);
        $cases = [
            // needle, shown, description
            ['<td colspan="2"', true, 'the section spans the form'],
            ['<th scope="col">VAT-registered buyer, other EU state</th>', true, 'the exempt column'],
            ['<th scope="col">Your 0% tax rates</th>', true, 'the rates column'],
            ['<th scope="col">Buyer&#039;s address does not match a tax rate (no tax charged, e.g. exports)</th>', true, 'the no-rate column'],
            ['No 0% tax rate in this class', true, 'a class without a 0% rate says so'],
            ['>ES_IVA_EXPORT - Es_iva_export</option>', true, 'a 0% code as "CODE - name"'],
            ['<option value="ES_IVA_STANDARD" selected="selected">ES_IVA_STANDARD (not valid on 0% lines)</option>', true, 'a saved code not at 0% is marked'],
            ['<option value="ES_GONE" selected="selected">ES_GONE (no longer listed)</option>', true, 'a saved unlisted code is marked'],
            ['ES_GONE: no longer listed', true, 'and named under its select'],
            ['<option value="ES_IVA_STANDARD">', false, 'a code not at 0% is never offered'],
            ['ES_IVA_EXEMPT_OTHER', false, 'nor one needing a reason'],
            ['(21%)', false, 'the label leaves the rate out'],
            ['aria-label="Standard: Your 0% tax rates: ES 35* 0% (IVA 0%)"', true, 'a rate\'s select is named by class, column and rate'],
            ['aria-label="Reduced rate: VAT-registered buyer, other EU state"', true, 'the exempt select by class and column'],
            ['min-width:calc(' . (int) ceil(strlen('ES_IVA_STANDARD') * 1.1) . 'ch + 3em)', true, 'every select fits the longest code'],
            ['<select name=', false, 'no select posts a field of its own'],
            ['<h4 class="twoinc-tax-code-title" style="margin:0 0 8px;">Tax codes for 0% lines</h4>', true, 'the section title is a heading'],
            ['<label', false, 'and no label tied to no control'],
            ['<th scope="row">Reduced rate</th>', true, 'a class names its row'],
            ['Clear saved tax codes', false, 'no Clear on a readable mapping'],
        ];
        foreach ($cases as [$needle, $shown, $description]) {
            TinyAssert::same($shown, self::has($html, $needle), $description);
        }
        TinyAssert::same(1, substr_count($html, '<th scope="row">Reduced rate</th>'), 'one row per tax class');
    }

    /** Clear wins, rows count only while shown, a changed row must hold a 0% code, a missing field keeps the map. */
    private static function testTheSaveHonoursClearAndTheShownRows(): void
    {
        $stored = ['standard|exempt' => 'ES_IVA_STANDARD', 'standard|none' => 'ES_IVA_EXPORT'];
        $post = static function (array $map) {
            return json_encode(['rows' => count($map), 'map' => $map]);
        };
        $rows = static function (array $over) {
            return array_merge(['standard|exempt' => 'ES_IVA_STANDARD', 'rate:11' => '', 'standard|none' => 'ES_IVA_EXPORT'], $over);
        };
        $cases = [
            // country, stored, field, clear, expected (null: refused), description
            ['ES', $stored, $post($rows(['rate:11' => 'ES_IVA_INTRA'])), false, ['standard|exempt' => 'ES_IVA_STANDARD', 'rate:11' => 'ES_IVA_INTRA', 'standard|none' => 'ES_IVA_EXPORT'], 'a new 0% code is saved, an unchanged marked one kept'],
            ['ES', $stored, $post($rows(['rate:11' => 'es_iva_intra', 'standard|none' => ''])), false, ['standard|exempt' => 'ES_IVA_STANDARD', 'rate:11' => 'ES_IVA_INTRA'], '(none) dropped, codes upper-cased'],
            ['ES', $stored, $post($rows(['rate:11' => 'ES_IVA_STANDARD'])), false, null, 'a changed row may not take a code not at 0%'],
            ['ES', $stored, $post($rows(['rate:11' => 'ES_UNLISTED'])), false, null, 'nor an unlisted one'],
            ['ES', $stored, $post($rows(['rate:99' => 'ES_IVA_INTRA', 'deleted|none' => 'ES_IVA_INTRA'])), null, $stored, 'rows the shop does not have are dropped'],
            ['ES', $stored, substr($post($rows([])), 0, -3), false, null, 'a field cut short is refused'],
            ['ES', $stored, $post($rows(['rate:11' => 'ES_IVA_INTRA'])), true, [], 'Clear wins over changed rows'],
            ['GB', $stored, $post($rows(['rate:11' => 'GB_VAT_ZERO'])), false, $stored, 'rows posted while hidden change nothing'],
            ['GB', $stored, null, true, [], 'Clear while hidden'],
            ['GB', 'standard|none=X', null, false, 'standard|none=X', 'a save without the field keeps even an unreadable map'],
            ['GB', 'standard|none=X', null, true, [], 'Clear empties an unreadable map'],
            ['GB', $stored, substr($post($rows([])), 0, -3), false, $stored, 'a field cut short while hidden changes nothing, quietly'],
            ['ES', $stored, $post($rows(['rate:11' => 'ES_IVA_INTRA'])), 'verify503', $stored, 'edits while the merchant cannot be read are kept out, with a notice'],
            ['ES', $stored, $post($rows(['rate:11' => 'ES_IVA_INTRA'])), 'list503', $stored, 'edits while the code list cannot be read are kept out, with a notice'],
            ['ES', $stored, $post($rows([])), 'list503', $stored, 'an unchanged table while the list cannot be read says nothing'],
        ];
        foreach ($cases as [$country, $map, $field, $clear, $expected, $description]) {
            self::reset();
            $gateway = self::gateway($country, $map);
            $GLOBALS['__twoinc_test_admin_errors'] = [];
            if ($clear === 'verify503') {
                $gateway->routes['/v1/merchant/verify_api_key'] = [503, []];
            } elseif ($clear === 'list503') {
                $gateway->routes['/v1/tax_codes/ES'] = [503, []];
            }
            $gateway->test_post_data = $clear === true ? [$gateway->get_field_key('tax_code_map') . '_clear' => '1'] : [];
            $refused = false;
            try {
                $saved = $gateway->validate_two_tax_code_map_field('tax_code_map', $field);
            } catch (Exception $e) {
                $saved = null;
                $refused = true;
                TinyAssert::true(strpos($e->getMessage(), 'not saved') !== false, "$description: the refusal says nothing was saved");
            }
            TinyAssert::same($expected, $saved, $description);
            $notices = $GLOBALS['__twoinc_test_admin_errors'] ?? [];
            $notified = is_string($clear) && strpos($description, 'says nothing') === false;
            TinyAssert::same($notified ? 1 : 0, count($notices), "$description: admin notices " . json_encode($notices));
            if ($notified) {
                TinyAssert::true(strpos($notices[0], 'were not saved') !== false && strpos($notices[0], 'HTTP 503') !== false, "$description: the notice says why: " . $notices[0]);
            }
            TinyAssert::true(!$refused || $expected === null, "$description: no validation error");
        }
        $gateway = self::gateway('GB', []);
        $gateway->opts['tax_code_map'] = $gateway->validate_two_tax_code_map_field('tax_code_map', null);
        TinyAssert::same([], WC_Twoinc::read_tax_code_map(), 'a cleared map reads as empty');
    }

    /** The checklist names the unreadable mapping and the way out. */
    private static function testTheHealthRowPointsAtClear(): void
    {
        $row = new ReflectionMethod(WC_Twoinc::class, 'checkout_visibility_row');
        $row->setAccessible(true);
        foreach ([['standard|none=X', true, 'an unreadable map'], [['standard|none' => 'ES_IVA_EXPORT'], false, 'a readable one']] as [$map, $named, $description]) {
            $gateway = self::gateway('ES', $map);
            $value = $row->invoke($gateway)['value'];
            TinyAssert::same($named, strpos($value, 'Use "Clear saved tax codes" under Tax.') !== false, "$description: $value");
        }
    }

    /** "Refresh merchant profile" expires the section's profile and list, and the reload confirms it. */
    private static function testRefreshExpiresTheSectionAndConfirmsOnReload(): void
    {
        $gateway = self::gateway('ES');
        self::render($gateway);
        $before = count($gateway->calls);
        self::render($gateway);
        TinyAssert::same($before, count($gateway->calls), 'a second render asks nothing');
        WC_Twoinc::expire_tax_code_section_caches();
        $gateway->routes['/v1/tax_codes/ES'] = [503, []];
        $html = self::render($gateway);
        TinyAssert::same(['/v1/merchant/verify_api_key', '/v1/merchant/mid', '/v1/tax_codes/ES'], array_slice($gateway->calls, $before), 'after a refresh the profile and list are asked again');
        TinyAssert::true(self::has($html, 'requires a tax code'), 'and a failed list still serves the last one');

        $gateway->opts['merchant_short_name'] = 'sn';
        $quiet = $gateway->generate_two_refresh_merchant_record_html('refresh', ['title' => 'Refresh']);
        $_GET['twoinc_refreshed'] = '1700000000000';
        $landed = $gateway->generate_two_refresh_merchant_record_html('refresh', ['title' => 'Refresh']);
        TinyAssert::same([false, true], [self::has($quiet, 'Merchant profile refreshed.'), self::has($landed, 'Merchant profile refreshed. sn - mid')], 'the reload confirms the refresh');
    }
}

final class TaxCodeAdminSpecGateway extends WC_Twoinc
{
    public $calls = [];
    public $routes = [];
    public $opts = [];
    public $host = 'https://api.test';

    public function __construct()
    {
        $this->id = WC_Twoinc_Brand::get('gateway_id');
        $this->enabled = 'yes';
    }

    public function get_option($key, $empty_value = null)
    {
        return $this->opts[$key] ?? ($empty_value ?? '');
    }

    public function get_twoinc_checkout_host()
    {
        return $this->host;
    }

    public function make_request($endpoint, $payload = [], $method = 'POST', $params = [], $api_key_override = null, $timeout = 30)
    {
        $this->calls[] = $endpoint;
        [$code, $body] = $this->routes[$endpoint] ?? [500, []];
        return ['response' => ['code' => $code], 'body' => json_encode($body)];
    }
}
