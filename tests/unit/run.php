<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

final class TinyAssert
{
    public static function same($expected, $actual, string $message = ''): void
    {
        if ($expected !== $actual) {
            throw new RuntimeException($message !== '' ? $message : 'Expected ' . var_export($expected, true) . ', got ' . var_export($actual, true));
        }
    }

    public static function true($value, string $message = ''): void
    {
        if ($value !== true) {
            throw new RuntimeException($message !== '' ? $message : 'Expected true, got ' . var_export($value, true));
        }
    }
}

final class BrandConfigSpec
{
    public static function runAll(): void
    {
        $tests = [
            'testBrandLoaderReturnsTwoDefaults',
            'testGatewayIdAndMetaIdentityUnchanged',
            'testConstantsMatchBrandConfig',
            'testBrandFileFilterMergesOverDefaults',
            'testEnvVarCannotEscapeBrandsDirectory',
            'testCheckoutFieldsHookFires',
            'testConfirmationUrlHookReceivesUrlAndOrderId',
            'testOrderPayloadHookAugmentsBody',
            'testPaymentTermsLineHookAdjustsLineItems',
            'testEditOrderAppliesSameBrandHooks',
            'testLegacyOrderCreateFilterRunsBeforeOrderPayload',
            'testBrandFileReturningNonArrayFallsBackToDefaults',
            'testMetaKeysDeriveFromBrandPrefix',
            'testConfirmationUrlParamsDeriveFromBrandPrefix',
            'testAvailabilityGateAbsentForTwoBrand',
            'testAvailabilityGateRemovesGatewayWhenUnmet',
            'testAvailabilityGateKeepsGatewayAtExactMinimum',
            'testAvailabilityGateComparesNetNotGross',
            'testMerchantMinimumRaisesTheBar',
            'testMerchantMinimumValidationRejectsValuesAtOrBelowPlatformMinimum',
            'testMerchantMinimumValidationSkipsFloorCheckAcrossCurrencies',
            'testPaymentValidationErrorFilterVetoes',
            'testConfirmationPageDetectionFollowsBrandPrefix',
            'testPaymentTermsResolveBrandIntersectAdminSubset',
            'testPaymentTermsSelectorVisibleOnlyWithMultiple',
            'testPaymentTermsDefaultFallsBackToShortest',
            'testBuyerFeeShareShapes',
            'testBuyerFeeShareRounding',
            'testRoundingStepOptionsCanonicalAndNarrowed',
            'testRoundingStepValidationEnforcesBrandOptions',
            'testSurchargeGridValidationNormalisesAndRejects',
            'testPaymentTermsValidationRequiresSelection',
            'testDefaultTermCoercedToOfferedSet',
            'testOrderPayloadCarriesSelectedAndAvailableTerms',
            'testPaymentTermsInvalidPostFallsBackToDefault',
            'testPaymentTermsDisabledMeansNoPayloadTerms',
            'testSoleTraderAvailableWhenRegistryAndToggleAgree',
            'testSoleTraderHiddenWhenToggleOff',
            'testSoleTraderHiddenWhenRegistryOmitsIt',
            'testSoleTraderRegistryErrorFallsBackToNoSoleTrader',
            'testSoleTraderRegistryRejectsMalformedCountry',
            'testSoleTraderRegistryResponseCachedPerRequest',
            'testSoleTraderTokenMintReadsHeaderCaseInsensitively',
            'testSoleTraderTokenMintFailsClosed',
            'testSoleTraderSignupUrlFollowsEnvAndFilter',
        ];
        foreach ($tests as $test) {
            self::reset();
            self::$test();
            print("PASS BrandConfigSpec::$test\n");
        }
    }

    private static function reset(): void
    {
        WC_Twoinc_Brand::reset();
        putenv('TWO_BRAND_CODE');
        unset($GLOBALS['__twoinc_test_currency']);
        unset($_POST[WC_Twoinc_Payment_Terms::SESSION_KEY]);
        WC_Twoinc_Payment_Terms::reset_fee_cache();
        WC_Twoinc_Sole_Trader::reset_cache();
        WC()->cart = null;
        WC()->customer = null;
        foreach (['twoinc_brand_file', 'twoinc_checkout_fields', 'twoinc_confirmation_url', 'twoinc_order_payload', 'twoinc_payment_terms_line', 'two_order_create', 'twoinc_payment_validation_error', 'twoinc_sole_trader_signup_url'] as $tag) {
            remove_all_filters($tag);
        }
    }

    /**
     * Gateway instance with only the brand-derived id set — the full
     * constructor needs a WooCommerce install.
     */
    private static function gateway(): WC_Twoinc
    {
        return new class () extends WC_Twoinc {
            public function __construct()
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
            }
        };
    }

    private static function useTestbrand(): void
    {
        add_filter('twoinc_brand_file', static function ($file) {
            return __DIR__ . '/fixtures/testbrand.php';
        });
    }

    private static function composeOrder(): array
    {
        return WC_Twoinc_Helper::compose_twoinc_order(
            new StubOrder(),
            'test-order-reference',
            '912345678',
            'IT',
            'Project X',
            '',
            []
        );
    }

    private static function testBrandLoaderReturnsTwoDefaults(): void
    {
        TinyAssert::same('two', WC_Twoinc_Brand::get('code'));
        TinyAssert::same('Two', WC_Twoinc_Brand::get('product_name'));
        TinyAssert::same('Two', WC_Twoinc_Brand::get('provider'));
        TinyAssert::same('https://portal.two.inc/auth/merchant/signup', WC_Twoinc_Brand::get('sign_up_url'));
        TinyAssert::same(WC_TWOINC_PLUGIN_URL . 'assets/images/two-logo.svg', WC_Twoinc_Brand::get('logo_url'));
        TinyAssert::same('Business invoice - %s days', WC_Twoinc_Brand::get('title_default'));
        TinyAssert::same(null, WC_Twoinc_Brand::get('not_a_key'));
    }

    private static function testGatewayIdAndMetaIdentityUnchanged(): void
    {
        // BC pin: live installs key payment-method associations on this id
        TinyAssert::same('woocommerce-gateway-tillit', WC_Twoinc_Brand::get('gateway_id'));
    }

    private static function testConstantsMatchBrandConfig(): void
    {
        // The constants stay for BC; they must not drift from the brand
        // config the runtime now reads.
        TinyAssert::same(WC_Twoinc::PROVIDER, WC_Twoinc_Brand::get('provider'));
        TinyAssert::same(WC_Twoinc::PROVIDER_FULL_NAME, WC_Twoinc_Brand::get('provider_full_name'));
        TinyAssert::same(WC_Twoinc::PRODUCT_NAME, WC_Twoinc_Brand::get('product_name'));
        // Constant name keeps its BC spelling; the brand key uses the
        // cross-plugin canonical sign_up_url (Magento's spelling)
        TinyAssert::same(WC_Twoinc::MERCHANT_SIGNUP_URL, WC_Twoinc_Brand::get('sign_up_url'));
        TinyAssert::same(WC_Twoinc::ALERT_EMAIL_ADDRESS, WC_Twoinc_Brand::get('alert_email_address'));
    }

    private static function testBrandFileFilterMergesOverDefaults(): void
    {
        add_filter('twoinc_brand_file', static function ($file) {
            return __DIR__ . '/fixtures/testbrand.php';
        });

        TinyAssert::same('testbrand', WC_Twoinc_Brand::get('code'));
        TinyAssert::same('Testbrand', WC_Twoinc_Brand::get('product_name'));
        TinyAssert::same('woocommerce-gateway-testbrand', WC_Twoinc_Brand::get('gateway_id'));
        // Keys the overlay does not declare fall through to Two defaults
        TinyAssert::same('Two', WC_Twoinc_Brand::get('provider'));
    }

    private static function testEnvVarCannotEscapeBrandsDirectory(): void
    {
        // basename() confines the env override to brands/; a traversal
        // attempt resolves to a missing file and the defaults load.
        putenv('TWO_BRAND_CODE=../tests/unit/fixtures/testbrand');

        TinyAssert::same('two', WC_Twoinc_Brand::get('code'));
    }

    private static function testCheckoutFieldsHookFires(): void
    {
        add_filter('twoinc_checkout_fields', static function ($fields) {
            $fields['billing']['billing_vendor_name'] = ['type' => 'text'];
            return $fields;
        });

        $checkout = new WC_Twoinc_Checkout(null);
        $fields = $checkout->apply_brand_checkout_fields(['billing' => []]);

        TinyAssert::true(isset($fields['billing']['billing_vendor_name']));
    }

    private static function testConfirmationUrlHookReceivesUrlAndOrderId(): void
    {
        $captured = [];
        add_filter('twoinc_confirmation_url', static function ($url, $order_id) use (&$captured) {
            $captured = [$url, $order_id];
            return 'https://shop.example/abn-payment-gateway/confirm?order_id=' . $order_id;
        }, 10, 2);

        $body = self::composeOrder();

        TinyAssert::same(
            'https://shop.example/abn-payment-gateway/confirm?order_id=42',
            $body['merchant_urls']['merchant_confirmation_url']
        );
        TinyAssert::true(strpos($captured[0], '/twoinc-payment-gateway/confirm?order_id=42') !== false, 'Filter must receive the default URL: ' . $captured[0]);
        TinyAssert::same(42, $captured[1]);
    }

    private static function testOrderPayloadHookAugmentsBody(): void
    {
        add_filter('twoinc_order_payload', static function ($payload, $order) {
            $payload['vendor_name'] = 'Overlay Vendor';
            $payload['__order_is_object'] = is_object($order);
            return $payload;
        }, 10, 2);

        $body = self::composeOrder();

        TinyAssert::same('Overlay Vendor', $body['vendor_name']);
        TinyAssert::same(true, $body['__order_is_object']);
        // Base composition is untouched around the augmentation
        TinyAssert::same('NOK', $body['currency']);
        TinyAssert::same('42', $body['merchant_order_id']);
    }

    private static function testPaymentTermsLineHookAdjustsLineItems(): void
    {
        add_filter('twoinc_payment_terms_line', static function ($line_items, $payload) {
            $line_items[] = [
                'name' => 'Surcharge for ' . $payload['currency'],
                'type' => 'SERVICE',
            ];
            return $line_items;
        }, 10, 2);

        $body = self::composeOrder();

        TinyAssert::same(1, count($body['line_items']));
        TinyAssert::same('Surcharge for NOK', $body['line_items'][0]['name']);
    }

    private static function testEditOrderAppliesSameBrandHooks(): void
    {
        // Create/edit symmetry: a brand line item or payload mutation applied
        // at creation must survive the edit PUT body too.
        add_filter('twoinc_payment_terms_line', static function ($line_items, $payload) {
            $line_items[] = ['name' => 'Brand line', 'type' => 'SERVICE'];
            return $line_items;
        }, 10, 2);
        add_filter('twoinc_order_payload', static function ($payload, $order) {
            $payload['vendor_name'] = 'Overlay Vendor';
            return $payload;
        }, 10, 2);

        $body = WC_Twoinc_Helper::compose_twoinc_edit_order(new StubOrder(), 'IT', 'Project X', '', '');

        TinyAssert::same('Brand line', $body['line_items'][0]['name']);
        TinyAssert::same('Overlay Vendor', $body['vendor_name']);
    }

    private static function testLegacyOrderCreateFilterRunsBeforeOrderPayload(): void
    {
        $payload_saw_legacy = null;
        add_filter('two_order_create', static function ($payload) {
            $payload['legacy_marker'] = 'yes';
            return $payload;
        });
        add_filter('twoinc_order_payload', static function ($payload, $order) use (&$payload_saw_legacy) {
            $payload_saw_legacy = isset($payload['legacy_marker']);
            $payload['new_marker'] = 'yes';
            return $payload;
        }, 10, 2);

        $body = self::composeOrder();

        TinyAssert::same(true, $payload_saw_legacy, 'twoinc_order_payload must see two_order_create result');
        TinyAssert::same('yes', $body['legacy_marker']);
        TinyAssert::same('yes', $body['new_marker']);
    }

    private static function testMetaKeysDeriveFromBrandPrefix(): void
    {
        TinyAssert::same('_twoinc_order_reference', WC_Twoinc_Brand::meta_key('order_reference'));
        TinyAssert::same('twoinc_order_id', WC_Twoinc_Brand::prefixed_name('order_id'));

        WC_Twoinc_Brand::reset();
        self::useTestbrand();

        // Live stores hold data under the overlay's prefix — the keys
        // must follow the brand, not the literal
        TinyAssert::same('_testbrand_order_reference', WC_Twoinc_Brand::meta_key('order_reference'));
        TinyAssert::same('testbrand_company_id', WC_Twoinc_Brand::prefixed_name('company_id'));
    }

    private static function testConfirmationUrlParamsDeriveFromBrandPrefix(): void
    {
        self::useTestbrand();

        $body = self::composeOrder();
        $url = $body['merchant_urls']['merchant_confirmation_url'];

        TinyAssert::true(strpos($url, 'testbrand_order_reference=test-order-reference') !== false, $url);
        TinyAssert::true(strpos($url, 'testbrand_nonce=') !== false, $url);
    }

    private static function testAvailabilityGateAbsentForTwoBrand(): void
    {
        // No WC() cart/customer set up: with no gate configured the
        // filter must not even look at them
        $gateways = ['woocommerce-gateway-tillit' => 'gw'];

        TinyAssert::same($gateways, self::gateway()->apply_brand_availability_gate($gateways));
    }

    private static function testAvailabilityGateRemovesGatewayWhenUnmet(): void
    {
        self::useTestbrand();
        WC()->cart = new StubCart(249.99);
        WC()->customer = new StubCustomer('NL');
        $GLOBALS['__twoinc_test_currency'] = 'EUR';

        $gateways = ['woocommerce-gateway-testbrand' => 'gw', 'other' => 'x'];
        $result = self::gateway()->apply_brand_availability_gate($gateways);

        TinyAssert::true(!isset($result['woocommerce-gateway-testbrand']));
        TinyAssert::same('x', $result['other']);
    }

    private static function testAvailabilityGateKeepsGatewayAtExactMinimum(): void
    {
        self::useTestbrand();
        WC()->cart = new StubCart(250.0);
        WC()->customer = new StubCustomer('NL');
        $GLOBALS['__twoinc_test_currency'] = 'EUR';

        $gateways = ['woocommerce-gateway-testbrand' => 'gw'];
        $result = self::gateway()->apply_brand_availability_gate($gateways);

        // The minimum is inclusive: an exactly-minimum basket passes
        TinyAssert::same('gw', $result['woocommerce-gateway-testbrand']);
    }

    private static function testAvailabilityGateComparesNetNotGross(): void
    {
        self::useTestbrand();
        WC()->customer = new StubCustomer('NL');
        $GLOBALS['__twoinc_test_currency'] = 'EUR';
        $gateways = ['woocommerce-gateway-testbrand' => 'gw'];

        // EUR 302.50 gross with EUR 52.50 tax is exactly EUR 250 net: passes
        WC()->cart = new StubCart(302.50, 52.50);
        $result = self::gateway()->apply_brand_availability_gate($gateways);
        TinyAssert::same('gw', $result['woocommerce-gateway-testbrand']);

        // EUR 250 gross with tax is below EUR 250 net: the credit check
        // would decline it, so the gate must hide the method
        WC()->cart = new StubCart(250.0, 43.39);
        $result = self::gateway()->apply_brand_availability_gate($gateways);
        TinyAssert::true(!isset($result['woocommerce-gateway-testbrand']));
    }

    private static function testPaymentValidationErrorFilterVetoes(): void
    {
        TinyAssert::same(null, self::gateway()->get_brand_payment_validation_error(42));

        add_filter('twoinc_payment_validation_error', static function ($error, $order_id) {
            return 'You must first accept the payment terms (order ' . $order_id . ')';
        }, 10, 2);

        TinyAssert::same(
            'You must first accept the payment terms (order 42)',
            self::gateway()->get_brand_payment_validation_error(42)
        );
    }

    private static function testMerchantMinimumRaisesTheBar(): void
    {
        // No platform gate (Two brand): the merchant minimum gates alone
        WC()->customer = new StubCustomer('NO');
        $GLOBALS['__twoinc_test_currency'] = 'EUR';
        $gateway = new class () extends WC_Twoinc {
            public function __construct()
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
            }

            public function get_option($key, $empty_value = null)
            {
                return $key === 'merchant_minimum_order' ? '500' : '';
            }
        };

        $gateways = ['woocommerce-gateway-tillit' => 'gw'];
        WC()->cart = new StubCart(499.0);
        $result = $gateway->apply_brand_availability_gate($gateways);
        TinyAssert::true(!isset($result['woocommerce-gateway-tillit']));

        // Gross basis by default for a standalone merchant minimum
        WC()->cart = new StubCart(500.0, 100.0);
        $result = $gateway->apply_brand_availability_gate($gateways);
        TinyAssert::same('gw', $result['woocommerce-gateway-tillit']);
    }

    private static function testMerchantMinimumValidationRejectsValuesAtOrBelowPlatformMinimum(): void
    {
        self::useTestbrand();
        $gateway = self::gateway();

        $threw = false;
        try {
            $gateway->validate_merchant_minimum_order_field('merchant_minimum_order', '250');
        } catch (Exception $e) {
            $threw = true;
        }
        TinyAssert::true($threw, 'A value equal to the platform minimum must be rejected');

        TinyAssert::same('251', $gateway->validate_merchant_minimum_order_field('merchant_minimum_order', '251'));
        TinyAssert::same('', $gateway->validate_merchant_minimum_order_field('merchant_minimum_order', ''));
    }

    private static function testMerchantMinimumValidationSkipsFloorCheckAcrossCurrencies(): void
    {
        // Store currency GBP vs platform minimum in EUR: WooCommerce has
        // no FX source (until TWO-24776), so the floor comparison is
        // skipped on save — the gate enforces both minima independently.
        self::useTestbrand();
        $GLOBALS['__twoinc_test_store_currency'] = 'GBP';
        try {
            TinyAssert::same(
                '10',
                self::gateway()->validate_merchant_minimum_order_field('merchant_minimum_order', '10')
            );
        } finally {
            unset($GLOBALS['__twoinc_test_store_currency']);
        }
    }

    private static function testConfirmationPageDetectionFollowsBrandPrefix(): void
    {
        // The read side is the half that strands in-flight orders if it
        // drifts from the write side: both must derive from meta_prefix.
        self::useTestbrand();
        $gateway = new class () extends WC_Twoinc {
            public function __construct()
            {
            }
        };
        $is_confirmation_page = new ReflectionMethod(WC_Twoinc::class, 'is_confirmation_page');
        $is_confirmation_page->setAccessible(true);

        $_REQUEST = [
            'order_id' => '42',
            'testbrand_order_reference' => 'ref',
            'testbrand_nonce' => 'nonce',
        ];
        TinyAssert::true($is_confirmation_page->invoke($gateway));

        // Params under another brand's prefix must NOT be detected
        $_REQUEST = [
            'order_id' => '42',
            'twoinc_order_reference' => 'ref',
            'twoinc_nonce' => 'nonce',
        ];
        TinyAssert::same(false, $is_confirmation_page->invoke($gateway));
        $_REQUEST = [];
    }

    private static function testBrandFileReturningNonArrayFallsBackToDefaults(): void
    {
        add_filter('twoinc_brand_file', static function ($file) {
            return __DIR__ . '/fixtures/nonarray.php';
        });

        // The (array) cast turns a scalar into a numeric-keyed array that
        // merges harmlessly; all named keys keep their Two defaults.
        TinyAssert::same('Two', WC_Twoinc_Brand::get('product_name'));
        TinyAssert::same('woocommerce-gateway-tillit', WC_Twoinc_Brand::get('gateway_id'));
    }

    /**
     * Gateway fake with configurable options for the payment-terms logic
     * (the real gateway constructor needs a WooCommerce install).
     */
    private static function termsGateway(array $options): WC_Payment_Gateway
    {
        return new class ($options) extends WC_Payment_Gateway {
            private $options;

            public function __construct($options)
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
                $this->options = $options;
            }

            public function get_option($key, $empty_value = null)
            {
                return $this->options[$key] ?? $empty_value ?? '';
            }
        };
    }

    private static function testPaymentTermsResolveBrandIntersectAdminSubset(): void
    {
        // No admin subset and no custom term: nothing offered → backend default
        $gateway = self::termsGateway([]);
        TinyAssert::same([], WC_Twoinc_Payment_Terms::get_available_terms($gateway));
        TinyAssert::same(false, WC_Twoinc_Payment_Terms::is_enabled($gateway));

        // Admin narrows within the brand set; entries outside it drop
        $gateway = self::termsGateway(['payment_terms_days' => ['60', '30', '7']]);
        TinyAssert::same([30, 60], WC_Twoinc_Payment_Terms::get_available_terms($gateway));
        TinyAssert::true(WC_Twoinc_Payment_Terms::is_enabled($gateway));

        // A custom term is unioned in even when outside the brand presets
        $gateway = self::termsGateway(['payment_terms_days' => ['30'], 'payment_terms_custom_days' => '45']);
        TinyAssert::same([30, 45], WC_Twoinc_Payment_Terms::get_available_terms($gateway));

        // Custom term alone (no presets ticked) still offers a term
        $gateway = self::termsGateway(['payment_terms_custom_days' => '45']);
        TinyAssert::same([45], WC_Twoinc_Payment_Terms::get_available_terms($gateway));
        TinyAssert::true(WC_Twoinc_Payment_Terms::is_enabled($gateway));
    }

    private static function testPaymentTermsSelectorVisibleOnlyWithMultiple(): void
    {
        // One offered term: feature active but applied silently (no chooser)
        $gateway = self::termsGateway(['payment_terms_days' => ['30']]);
        TinyAssert::true(WC_Twoinc_Payment_Terms::is_enabled($gateway));
        TinyAssert::same(false, WC_Twoinc_Payment_Terms::is_selector_visible($gateway));

        // Two offered terms: chooser visible
        $gateway = self::termsGateway(['payment_terms_days' => ['30', '60']]);
        TinyAssert::true(WC_Twoinc_Payment_Terms::is_selector_visible($gateway));

        // No terms: neither active nor visible
        $gateway = self::termsGateway([]);
        TinyAssert::same(false, WC_Twoinc_Payment_Terms::is_enabled($gateway));
        TinyAssert::same(false, WC_Twoinc_Payment_Terms::is_selector_visible($gateway));
    }

    private static function testPaymentTermsDefaultFallsBackToShortest(): void
    {
        $gateway = self::termsGateway(['payment_terms_days' => ['30', '60'], 'default_payment_term' => '60']);
        TinyAssert::same(60, WC_Twoinc_Payment_Terms::get_default_term($gateway));

        // Configured default outside the offered set: shortest offered wins
        $gateway = self::termsGateway([
            'payment_terms_days' => ['30', '90'],
            'default_payment_term' => '60',
        ]);
        TinyAssert::same(30, WC_Twoinc_Payment_Terms::get_default_term($gateway));
    }

    private static function testBuyerFeeShareShapes(): void
    {
        // type none (and unset/invalid): no block at all
        TinyAssert::same(null, WC_Twoinc_Payment_Terms::build_buyer_fee_share(self::termsGateway(['surcharge_type' => 'none']), 30));
        TinyAssert::same(null, WC_Twoinc_Payment_Terms::build_buyer_fee_share(self::termsGateway([]), 30));

        // percentage: the term's grid percentage + buyer_pays basis; no surcharge/cap
        $gateway = self::termsGateway([
            'surcharge_type' => 'percentage',
            'surcharge_grid' => [30 => ['percentage' => '2.5']],
        ]);
        TinyAssert::same(
            ['percentage' => 2.5, 'surcharge_basis' => 'buyer_pays'],
            WC_Twoinc_Payment_Terms::build_buyer_fee_share($gateway, 30)
        );

        // percentage with a cap (limit)
        $gateway = self::termsGateway([
            'surcharge_type' => 'percentage',
            'surcharge_grid' => [30 => ['percentage' => '3', 'limit' => '50']],
        ]);
        TinyAssert::same(
            ['percentage' => 3.0, 'surcharge_basis' => 'buyer_pays', 'cap' => 50.0],
            WC_Twoinc_Payment_Terms::build_buyer_fee_share($gateway, 30)
        );

        // fixed only: percentage 0.0 (never the API default 100), surcharge present, no cap
        $gateway = self::termsGateway([
            'surcharge_type' => 'fixed',
            'surcharge_grid' => [30 => ['fixed' => '10', 'percentage' => '5', 'limit' => '50']],
        ]);
        TinyAssert::same(
            ['percentage' => 0.0, 'surcharge_basis' => 'buyer_pays', 'surcharge' => 10.0],
            WC_Twoinc_Payment_Terms::build_buyer_fee_share($gateway, 30)
        );

        // fixed_and_percentage: both, plus cap
        $gateway = self::termsGateway([
            'surcharge_type' => 'fixed_and_percentage',
            'surcharge_grid' => [30 => ['fixed' => '10', 'percentage' => '2', 'limit' => '40']],
        ]);
        TinyAssert::same(
            ['percentage' => 2.0, 'surcharge_basis' => 'buyer_pays', 'surcharge' => 10.0, 'cap' => 40.0],
            WC_Twoinc_Payment_Terms::build_buyer_fee_share($gateway, 30)
        );

        // a term with no grid row → percentage 0.0, no surcharge/cap
        $gateway = self::termsGateway([
            'surcharge_type' => 'percentage',
            'surcharge_grid' => [30 => ['percentage' => '2.5']],
        ]);
        TinyAssert::same(
            ['percentage' => 0.0, 'surcharge_basis' => 'buyer_pays'],
            WC_Twoinc_Payment_Terms::build_buyer_fee_share($gateway, 60)
        );

        // differential: the default term (shortest offered = 14) rides as reference_terms
        $gateway = self::termsGateway([
            'payment_terms_days' => ['14', '30'],
            'surcharge_type' => 'percentage',
            'surcharge_grid' => [30 => ['percentage' => '2']],
            'surcharge_differential' => '1',
        ]);
        TinyAssert::same(
            ['percentage' => 2.0, 'surcharge_basis' => 'buyer_pays', 'reference_terms' => ['type' => 'NET_TERMS', 'duration_days' => 14]],
            WC_Twoinc_Payment_Terms::build_buyer_fee_share($gateway, 30)
        );

        // end_of_month: reference_terms carries duration_days_calculated_from
        $gateway = self::termsGateway([
            'payment_terms_days' => ['14', '30'],
            'surcharge_type' => 'percentage',
            'surcharge_grid' => [30 => ['percentage' => '2']],
            'surcharge_differential' => '1',
            'payment_terms_type' => 'end_of_month',
        ]);
        TinyAssert::same(
            ['percentage' => 2.0, 'surcharge_basis' => 'buyer_pays', 'reference_terms' => ['type' => 'NET_TERMS', 'duration_days' => 14, 'duration_days_calculated_from' => 'END_OF_MONTH']],
            WC_Twoinc_Payment_Terms::build_buyer_fee_share($gateway, 30)
        );

        // Fixed amounts are sent as configured (store currency); WooCommerce
        // does no multi-currency conversion (documented parity gap vs Magento),
        // so the amount rides regardless of the active display currency.
        $GLOBALS['__twoinc_test_currency'] = 'GBP';
        $gateway = self::termsGateway([
            'surcharge_type' => 'fixed',
            'surcharge_grid' => [30 => ['fixed' => '10']],
        ]);
        TinyAssert::same(
            ['percentage' => 0.0, 'surcharge_basis' => 'buyer_pays', 'surcharge' => 10.0],
            WC_Twoinc_Payment_Terms::build_buyer_fee_share($gateway, 30)
        );
        unset($GLOBALS['__twoinc_test_currency']);
    }

    private static function testBuyerFeeShareRounding(): void
    {
        $base = ['surcharge_type' => 'percentage', 'surcharge_grid' => [30 => ['percentage' => '2']]];
        $expectBase = ['percentage' => 2.0, 'surcharge_basis' => 'buyer_pays'];

        // up/down/standard map to the API enum; step rides as a float
        foreach ([['up', '1.00', 1.0, 'UP'], ['down', '0.50', 0.5, 'DOWN'], ['standard', '5.00', 5.0, 'STANDARD']] as $c) {
            $gateway = self::termsGateway($base + ['surcharge_rounding_basis' => $c[0], 'surcharge_rounding_step' => $c[1]]);
            TinyAssert::same(
                $expectBase + ['rounding' => ['step' => $c[2], 'basis' => $c[3]]],
                WC_Twoinc_Payment_Terms::build_buyer_fee_share($gateway, 30)
            );
        }

        // none / step<=0 / negative / unset / unmapped / empty basis → no rounding block
        foreach ([['none', '1.00'], ['up', '0'], ['up', '-1.00'], ['up', ''], ['garbage', '1.00'], ['', '1.00']] as $c) {
            $gateway = self::termsGateway($base + ['surcharge_rounding_basis' => $c[0], 'surcharge_rounding_step' => $c[1]]);
            TinyAssert::same($expectBase, WC_Twoinc_Payment_Terms::build_buyer_fee_share($gateway, 30));
        }

        // rounding is IGNORED for fixed-only (no percentage component, mirrors Magento $hasPercentage gate)
        $gateway = self::termsGateway([
            'surcharge_type' => 'fixed',
            'surcharge_grid' => [30 => ['fixed' => '10']],
            'surcharge_rounding_basis' => 'up',
            'surcharge_rounding_step' => '1.00',
        ]);
        TinyAssert::same(
            ['percentage' => 0.0, 'surcharge_basis' => 'buyer_pays', 'surcharge' => 10.0],
            WC_Twoinc_Payment_Terms::build_buyer_fee_share($gateway, 30)
        );

        // rounding rides alongside reference_terms (differential)
        $gateway = self::termsGateway($base + [
            'payment_terms_days' => ['14', '30'],
            'surcharge_differential' => '1',
            'surcharge_rounding_basis' => 'standard',
            'surcharge_rounding_step' => '0.50',
        ]);
        TinyAssert::same(
            $expectBase + [
                'rounding' => ['step' => 0.5, 'basis' => 'STANDARD'],
                'reference_terms' => ['type' => 'NET_TERMS', 'duration_days' => 14],
            ],
            WC_Twoinc_Payment_Terms::build_buyer_fee_share($gateway, 30)
        );

        // type none: no block at all, rounding ignored
        $gateway = self::termsGateway([
            'surcharge_type' => 'none',
            'surcharge_rounding_basis' => 'up',
            'surcharge_rounding_step' => '1.00',
        ]);
        TinyAssert::same(null, WC_Twoinc_Payment_Terms::build_buyer_fee_share($gateway, 30));
    }

    private static function testRoundingStepOptionsCanonicalAndNarrowed(): void
    {
        $method = new ReflectionMethod(WC_Twoinc::class, 'get_rounding_step_options');
        $method->setAccessible(true);
        $gateway = self::gateway();

        // Default brand: all five steps, canonical two-decimal, ascending
        TinyAssert::same(
            ['0.10' => '0.10', '0.50' => '0.50', '1.00' => '1.00', '5.00' => '5.00', '10.00' => '10.00'],
            $method->invoke($gateway)
        );

        // Overlay narrows + reorders; invalid entries (<=0, non-numeric) are
        // skipped, not fatal — fixture declares [1.00, 0.50, 0, -2, 'x']
        self::useTestbrand();
        WC_Twoinc_Brand::reset();
        TinyAssert::same(
            ['0.50' => '0.50', '1.00' => '1.00'],
            $method->invoke($gateway)
        );
    }

    private static function testRoundingStepValidationEnforcesBrandOptions(): void
    {
        $gateway = self::gateway();
        // Empty = no rounding, always allowed.
        TinyAssert::same('', $gateway->validate_surcharge_rounding_step_field('surcharge_rounding_step', ''));
        // A step the brand offers passes through unchanged.
        TinyAssert::same('1.00', $gateway->validate_surcharge_rounding_step_field('surcharge_rounding_step', '1.00'));
        // A value the brand does not offer is rejected, so the option-list
        // narrowing is enforced, not merely cosmetic.
        $threw = false;
        try {
            $gateway->validate_surcharge_rounding_step_field('surcharge_rounding_step', '3.33');
        } catch (Exception $e) {
            $threw = true;
        }
        TinyAssert::true($threw);
    }

    private static function testSurchargeGridValidationNormalisesAndRejects(): void
    {
        $gateway = self::gateway();

        // Comma decimals normalise to dots; empty cells drop; blank rows omit;
        // non-positive term keys are skipped.
        $clean = $gateway->validate_two_surcharge_grid_field('surcharge_grid', [
            '30' => ['fixed' => '10,50', 'percentage' => '2.5', 'limit' => ''],
            '60' => ['fixed' => '', 'percentage' => '', 'limit' => ''],
            '0'  => ['fixed' => '5'],
        ]);
        TinyAssert::same([30 => ['fixed' => '10.50', 'percentage' => '2.5']], $clean);

        // Negative value rejected
        $threw = false;
        try {
            $gateway->validate_two_surcharge_grid_field('surcharge_grid', [30 => ['fixed' => '-1']]);
        } catch (Exception $e) {
            $threw = true;
        }
        TinyAssert::true($threw);

        // Percentage > 100 rejected
        $threw = false;
        try {
            $gateway->validate_two_surcharge_grid_field('surcharge_grid', [30 => ['percentage' => '150']]);
        } catch (Exception $e) {
            $threw = true;
        }
        TinyAssert::true($threw);

        // Non-array input → empty grid
        TinyAssert::same([], $gateway->validate_two_surcharge_grid_field('surcharge_grid', ''));
    }

    private static function testPaymentTermsValidationRequiresSelection(): void
    {
        $gateway = self::gateway();
        $custom_key = $gateway->get_field_key('payment_terms_custom_days');

        // Valid selection normalises to sorted unique ints within brand terms
        unset($_POST[$custom_key]);
        TinyAssert::same([30, 60], $gateway->validate_two_payment_terms_field('payment_terms_days', ['60', '30', '7']));

        // Empty selection + no custom term → rejected (selection mandatory)
        $threw = false;
        try {
            $gateway->validate_two_payment_terms_field('payment_terms_days', []);
        } catch (Exception $e) {
            $threw = true;
        }
        TinyAssert::true($threw);

        // Empty selection but a custom term posted → accepted
        $_POST[$custom_key] = '45';
        TinyAssert::same([], $gateway->validate_two_payment_terms_field('payment_terms_days', []));
        unset($_POST[$custom_key]);
    }

    private static function testDefaultTermCoercedToOfferedSet(): void
    {
        $gateway = self::gateway();
        $terms_key = $gateway->get_field_key('payment_terms_days');
        $custom_key = $gateway->get_field_key('payment_terms_custom_days');

        // Offered = ticked checkboxes; a default within it is kept verbatim.
        $_POST[$terms_key] = ['30', '60'];
        unset($_POST[$custom_key]);
        TinyAssert::same('60', $gateway->validate_default_payment_term_field('default_payment_term', '60'));

        // A default no longer offered repoints to the shortest offered term.
        TinyAssert::same('30', $gateway->validate_default_payment_term_field('default_payment_term', '90'));

        // The custom day joins the offered set and can become the default.
        $_POST[$terms_key] = ['60'];
        $_POST[$custom_key] = '45';
        TinyAssert::same('45', $gateway->validate_default_payment_term_field('default_payment_term', '45'));
        // Shortest of {45,60} wins when the posted default is not offered.
        TinyAssert::same('45', $gateway->validate_default_payment_term_field('default_payment_term', '14'));

        unset($_POST[$terms_key], $_POST[$custom_key]);
    }

    private static function testOrderPayloadCarriesSelectedAndAvailableTerms(): void
    {
        $gateway = self::termsGateway(['payment_terms_days' => ['14', '30', '60', '90']]);
        $_POST[WC_Twoinc_Payment_Terms::SESSION_KEY] = '60';

        $payment_terms = WC_Twoinc_Payment_Terms::get_order_payload_terms($gateway, new StubOrder());
        $body = WC_Twoinc_Helper::compose_twoinc_order(
            new StubOrder(),
            'test-order-reference',
            '912345678',
            '',
            '',
            '',
            [],
            '',
            '',
            '',
            '',
            '',
            '',
            false,
            $payment_terms
        );

        TinyAssert::same(['type' => 'NET_TERMS', 'duration_days' => 60], $body['terms']);
        TinyAssert::same([14, 30, 60, 90], $body['available_terms']);
    }

    private static function testPaymentTermsInvalidPostFallsBackToDefault(): void
    {
        $gateway = self::termsGateway(['payment_terms_days' => ['30', '60'], 'default_payment_term' => '30']);
        $_POST[WC_Twoinc_Payment_Terms::SESSION_KEY] = '17';

        $payment_terms = WC_Twoinc_Payment_Terms::get_order_payload_terms($gateway, new StubOrder());
        TinyAssert::same(30, $payment_terms['terms']['duration_days']);
    }

    private static function testPaymentTermsDisabledMeansNoPayloadTerms(): void
    {
        // No terms configured: empty offer → no payload terms (backend default)
        $gateway = self::termsGateway([]);
        TinyAssert::same(null, WC_Twoinc_Payment_Terms::get_order_payload_terms($gateway, new StubOrder()));

        // And the composed body carries no terms keys at all
        $body = self::composeOrder();
        TinyAssert::same(false, array_key_exists('terms', $body));
        TinyAssert::same(false, array_key_exists('available_terms', $body));
    }

    /**
     * Gateway fake whose make_request returns canned responses keyed by
     * endpoint prefix (the sole-trader logic talks to the registry +
     * delegation endpoints through it).
     */
    private static function soleTraderGateway(array $options, array $responses): WC_Payment_Gateway
    {
        return new class ($options, $responses) extends WC_Payment_Gateway {
            private $options;
            private $responses;
            public $requests = [];

            public function __construct($options, $responses)
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
                $this->options = $options;
                $this->responses = $responses;
            }

            public function get_option($key, $empty_value = null)
            {
                return $this->options[$key] ?? $empty_value ?? '';
            }

            public function make_request($endpoint, $payload = [], $method = 'POST', $params = [], $api_key_override = null, $timeout = 30)
            {
                $this->requests[] = $endpoint;
                foreach ($this->responses as $prefix => $response) {
                    if (strpos($endpoint, $prefix) === 0) {
                        return $response;
                    }
                }
                return new WP_Error();
            }
        };
    }

    private static function registryOk(array $types): array
    {
        return [
            'response' => ['code' => 200],
            'body' => json_encode(['supported_company_types' => $types]),
        ];
    }

    private static function testSoleTraderAvailableWhenRegistryAndToggleAgree(): void
    {
        $gateway = self::soleTraderGateway(['enable_sole_trader' => 'yes'], [
            '/registry/v1/supported-company-types/' => self::registryOk(['SOLE_TRADER']),
        ]);
        TinyAssert::true(WC_Twoinc_Sole_Trader::is_available($gateway, 'GB'));
        // Lowercase input normalises to the same country
        WC_Twoinc_Sole_Trader::reset_cache();
        TinyAssert::true(WC_Twoinc_Sole_Trader::is_available($gateway, 'gb'));
    }

    private static function testSoleTraderHiddenWhenToggleOff(): void
    {
        $gateway = self::soleTraderGateway(['enable_sole_trader' => 'no'], [
            '/registry/v1/supported-company-types/' => self::registryOk(['SOLE_TRADER']),
        ]);
        TinyAssert::same(false, WC_Twoinc_Sole_Trader::is_available($gateway, 'GB'));
    }

    private static function testSoleTraderHiddenWhenRegistryOmitsIt(): void
    {
        // Countries without sole trader support return an empty list:
        // registered businesses need no registry enrollment, so the
        // endpoint deliberately omits them.
        $gateway = self::soleTraderGateway(['enable_sole_trader' => 'yes'], [
            '/registry/v1/supported-company-types/' => self::registryOk([]),
        ]);
        TinyAssert::same(false, WC_Twoinc_Sole_Trader::is_available($gateway, 'NO'));
    }

    private static function testSoleTraderRegistryErrorFallsBackToNoSoleTrader(): void
    {
        // Network error
        $gateway = self::soleTraderGateway(['enable_sole_trader' => 'yes'], []);
        TinyAssert::same([], WC_Twoinc_Sole_Trader::get_supported_company_types($gateway, 'GB'));

        // Non-200
        WC_Twoinc_Sole_Trader::reset_cache();
        $gateway = self::soleTraderGateway(['enable_sole_trader' => 'yes'], [
            '/registry/v1/supported-company-types/' => ['response' => ['code' => 404], 'body' => ''],
        ]);
        TinyAssert::same([], WC_Twoinc_Sole_Trader::get_supported_company_types($gateway, 'GB'));

        // Malformed body
        WC_Twoinc_Sole_Trader::reset_cache();
        $gateway = self::soleTraderGateway(['enable_sole_trader' => 'yes'], [
            '/registry/v1/supported-company-types/' => ['response' => ['code' => 200], 'body' => 'not json'],
        ]);
        TinyAssert::same([], WC_Twoinc_Sole_Trader::get_supported_company_types($gateway, 'GB'));
    }

    private static function testSoleTraderRegistryRejectsMalformedCountry(): void
    {
        $gateway = self::soleTraderGateway(['enable_sole_trader' => 'yes'], [
            '/registry/v1/supported-company-types/' => self::registryOk(['SOLE_TRADER']),
        ]);
        // Never hits the API for junk country input
        TinyAssert::same([], WC_Twoinc_Sole_Trader::get_supported_company_types($gateway, ''));
        TinyAssert::same([], WC_Twoinc_Sole_Trader::get_supported_company_types($gateway, 'G'));
        TinyAssert::same([], WC_Twoinc_Sole_Trader::get_supported_company_types($gateway, 'GBR'));
        TinyAssert::same([], $gateway->requests);
    }

    private static function testSoleTraderRegistryResponseCachedPerRequest(): void
    {
        $gateway = self::soleTraderGateway(['enable_sole_trader' => 'yes'], [
            '/registry/v1/supported-company-types/' => self::registryOk(['SOLE_TRADER']),
        ]);
        WC_Twoinc_Sole_Trader::get_supported_company_types($gateway, 'GB');
        WC_Twoinc_Sole_Trader::get_supported_company_types($gateway, 'GB');
        WC_Twoinc_Sole_Trader::get_supported_company_types($gateway, 'gb');
        TinyAssert::same(1, count($gateway->requests));
        // A different country is its own cache entry
        WC_Twoinc_Sole_Trader::get_supported_company_types($gateway, 'US');
        TinyAssert::same(2, count($gateway->requests));
    }

    private static function testSoleTraderTokenMintReadsHeaderCaseInsensitively(): void
    {
        $gateway = self::soleTraderGateway(['enable_sole_trader' => 'yes'], [
            '/registry/v1/delegation' => [
                'response' => ['code' => 200],
                'headers' => ['Two-Delegated-Authority-Token' => 'reg-token'],
            ],
            '/autofill/v1/delegation' => [
                'response' => ['code' => 200],
                'headers' => ['two-delegated-authority-token' => 'autofill-token'],
            ],
        ]);
        TinyAssert::same(
            ['delegation_token' => 'reg-token', 'autofill_token' => 'autofill-token'],
            WC_Twoinc_Sole_Trader::mint_tokens($gateway)
        );
    }

    private static function testSoleTraderTokenMintFailsClosed(): void
    {
        // Second mint failing voids the pair — never hand the browser half a flow
        $gateway = self::soleTraderGateway(['enable_sole_trader' => 'yes'], [
            '/registry/v1/delegation' => [
                'response' => ['code' => 200],
                'headers' => ['two-delegated-authority-token' => 'reg-token'],
            ],
            '/autofill/v1/delegation' => ['response' => ['code' => 500], 'headers' => []],
        ]);
        TinyAssert::same(null, WC_Twoinc_Sole_Trader::mint_tokens($gateway));

        // Missing header on a 200 also fails closed
        $gateway = self::soleTraderGateway(['enable_sole_trader' => 'yes'], [
            '/registry/v1/delegation' => ['response' => ['code' => 200], 'headers' => []],
            '/autofill/v1/delegation' => [
                'response' => ['code' => 200],
                'headers' => ['two-delegated-authority-token' => 'autofill-token'],
            ],
        ]);
        TinyAssert::same(null, WC_Twoinc_Sole_Trader::mint_tokens($gateway));
    }

    private static function testSoleTraderSignupUrlFollowsEnvAndFilter(): void
    {
        $gateway = self::soleTraderGateway([], []);
        TinyAssert::same('https://checkout.two.inc/soletrader/signup', WC_Twoinc_Sole_Trader::get_signup_page_url($gateway));

        $gateway = self::soleTraderGateway(['checkout_env' => 'SANDBOX'], []);
        TinyAssert::same('https://checkout.sandbox.two.inc/soletrader/signup', WC_Twoinc_Sole_Trader::get_signup_page_url($gateway));

        // Brand overlays adjust via the filter
        add_filter('twoinc_sole_trader_signup_url', function ($url) {
            return $url . '?brand=acme';
        });
        TinyAssert::same('https://checkout.sandbox.two.inc/soletrader/signup?brand=acme', WC_Twoinc_Sole_Trader::get_signup_page_url($gateway));
    }
}

BrandConfigSpec::runAll();
print("All tests passed.\n");
