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
            'testPaymentValidationErrorFilterVetoes',
            'testConfirmationPageDetectionFollowsBrandPrefix',
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
        WC()->cart = null;
        WC()->customer = null;
        foreach (['twoinc_brand_file', 'twoinc_checkout_fields', 'twoinc_confirmation_url', 'twoinc_order_payload', 'twoinc_payment_terms_line', 'two_order_create', 'twoinc_payment_validation_error'] as $tag) {
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
        TinyAssert::same('https://portal.two.inc/auth/merchant/signup', WC_Twoinc_Brand::get('merchant_signup_url'));
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
        TinyAssert::same(WC_Twoinc::MERCHANT_SIGNUP_URL, WC_Twoinc_Brand::get('merchant_signup_url'));
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
}

BrandConfigSpec::runAll();
print("All tests passed.\n");
