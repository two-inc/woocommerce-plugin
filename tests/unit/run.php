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
            'testFeeLineItemNameUsesResolvedLabelWithoutPrefix',
            'testEditOrderAppliesSameBrandHooks',
            'testShippingDetailsOmitTrackingWithoutMeta',
            'testShippingDetailsFromShipmentTrackingMeta',
            'testProcessUpdateRefusesTerminalStates',
            'testShippingDetailsCarriedByCreateAndEditBodies',
            'testShippingDetailsFilterOverrides',
            'testShippingDetailsFilterGarbageDiscarded',
            'testLegacyOrderCreateFilterRunsBeforeOrderPayload',
            'testBrandFileReturningNonArrayFallsBackToDefaults',
            'testMetaKeysDeriveFromBrandPrefix',
            'testConfirmationUrlParamsDeriveFromBrandPrefix',
            'testAvailabilityGateAbsentForTwoBrand',
            'testAvailabilityGateRemovesGatewayWhenUnmet',
            'testAvailabilityGateKeepsGatewayAtExactMinimum',
            'testAvailabilityGateComparesNetNotGross',
            'testAvailabilityGateRestrictsBillingCountry',
            'testAvailabilityGateSkipsMinimumsOnEmptyCart',
            'testAvailabilityGateSkipsMinimumsOnOrderPayPage',
            'testMerchantMinimumRaisesTheBar',
            'testMerchantMinimumValidationRejectsValuesAtOrBelowPlatformMinimum',
            'testMerchantMinimumValidationSkipsFloorCheckAcrossCurrencies',
            'testPaymentValidationErrorFilterVetoes',
            'testConfirmationPageDetectionFollowsBrandPrefix',
            'testPaymentTermsResolveBackendIntersectAdminSubset',
            'testMerchantAvailableTermsFetchNormalisesCachesAndServesStale',
            'testMerchantAvailableTermsInvalidatedOnMerchantIdChange',
            'testDeactivationCleanupClearsSettingsAndTermCache',
            'testMerchantRecordFetchSharedAcrossConsumersAndOffTheBlob',
            'testPaymentTermsValidationNonDestructiveOnUnresolvedOrNarrowedList',
            'testSurchargeGridPreservesRowsNotOnTheForm',
            'testPaymentTermsSelectorVisibleOnlyWithMultiple',
            'testPaymentTermsDefaultFallsBackToShortest',
            'testBuyerFeeShareShapes',
            'testBuyerFeeShareRounding',
            'testRoundingStepOptionsCanonicalAndNarrowed',
            'testRoundingStepValidationEnforcesBrandOptions',
            'testSurchargeGridValidationNormalisesAndRejects',
            'testSurchargeGridEnforcesMerchantFixedCap',
            'testSurchargeCapZeroAmountFromApiMeansNoLimit',
            'testSurchargeGridHelpTextOmitsMaxOnCurrencyMismatch',
            'testSurchargeFeeStandardModeUnchanged',
            'testSurchargeFeeCustomClassTaxedAtSelectedClassRates',
            'testSurchargeFeeAlwaysZeroNeverTaxed',
            'testSurchargeFeeCustomClassFallsBackWhenClassDeleted',
            'testSurchargeTaxSettingsValidationAndStaleNotice',
            'testSurchargeTaxTreatmentRequiresExplicitSelection',
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
            'testEnvironmentModeNormalisesStoredCheckoutEnv',
            'testEnvironmentHostFollowsModeAndBrandTemplate',
            'testCheckoutHostPrefersExplicitModeOverDevSniffing',
            'testCheckoutEnvOptionsPreserveStoredModeWithoutSettingsApi',
            'testInvoiceDownloadStreamsPdf',
            'testInvoiceDownloadFulfillingIsInfoNotice',
            'testInvoiceDownloadFulfilledRetriesOnceThenStreams',
            'testInvoiceDownloadFulfilledRetryFailureIsError',
            'testInvoiceDownloadOtherStateNamesState',
            'testInvoiceDownloadOtherErrorKeepsTodayBehaviour',
            'testInvoiceDownloadMissingOrderIdIsError',
            'testInvoiceDownload200NonPdfIsError',
            'testInvoiceDownloadCreditNoteOmitsVOriginal',
            'testInvoiceDownloadCapabilityGate',
            'testInvoiceDownloadNonceScopedToOrderAndVariant',
            'testInvoiceDownloadNoticeIsolatedPerOrder',
            'testInvoiceStreamFilenameSanitizesOrderId',
            'testNegativeDiscountGuardPassesLegitimateDiscount',
            'testNegativeDiscountGuardThrowsOnNegativeLineDiscount',
            'testNegativeDiscountGuardThrowsOnNegativeOrderDiscount',
            'testNegativeDiscountGuardNoFalsePositiveFromEarlyRounding',
            'testNegativeDiscountGuardSkipsRefundLineItems',
            'testFxSameCurrencyShortCircuitsWithoutNetwork',
            'testFxCrossRatesFromEurPivotTable',
            'testFxFreshCacheServesAcrossRequestsWithoutRefetch',
            'testFxStaleRefreshFailureFallsBackToLastKnownGood',
            'testFxMalformedResponsesAreRejected',
            'testFxUncachedCurrencyRefetchesOnceThenConcludes',
            'testFxFreshTableMissingCurrencyDoesNotRefetch',
            'testFxCorruptedStoredTableIsRejectedNotFatal',
            'testFxDuplicateScheduleGuardedByUniqueFlag',
            'testFxGateFailsClosedWhenNoRateEverFetched',
            'testFxGateConvertsBasketAcrossCurrencies',
            'testFxGateUsesLastKnownGoodOnApiFailure',
            'testFxMerchantMinimumJudgedAcrossCurrencies',
            'testBuyerFeeShareConvertsFixedAndCapAcrossCurrencies',
            'testBuyerFeeShareWithheldWhenNoRateAvailable',
            'testBuyerFeeShareSameCurrencyNeverTouchesFx',
            'testBuyerFeeShareCapRoundingToZeroWithholdsWholeSurcharge',
            'testCartFeeSkippedOnQuoteCurrencyMismatch',
            'testMinimumDescriptionShowsConvertedFloorWhenRateAvailable',
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
        unset($GLOBALS['test_home_url']);
        $GLOBALS['__twoinc_test_options'] = [];
        unset($_POST[WC_Twoinc_Payment_Terms::SESSION_KEY]);
        WC_Twoinc_Payment_Terms::reset_fee_cache();
        WC_Twoinc_Sole_Trader::reset_cache();
        WC_Twoinc::reset_merchant_record_memo();
        WC_Twoinc_FX::reset_request_cache();
        $GLOBALS['__twoinc_test_transients'] = [];
        $GLOBALS['__twoinc_test_as_scheduled'] = [];
        $GLOBALS['__twoinc_test_as_schedule_calls'] = [];
        WC()->cart = null;
        WC()->customer = null;
        WC()->session = null;
        unset($GLOBALS['__twoinc_test_tax_classes'], $GLOBALS['__twoinc_test_tax_rates']);
        foreach (['twoinc_brand_file', 'twoinc_checkout_fields', 'twoinc_confirmation_url', 'twoinc_order_payload', 'twoinc_payment_terms_line', 'two_order_create', 'twoinc_payment_validation_error', 'twoinc_sole_trader_signup_url', 'twoinc_shipping_details'] as $tag) {
            remove_all_filters($tag);
        }
    }

    /**
     * Gateway instance with only the brand-derived id set — the full
     * constructor needs a WooCommerce install. The API-resolved platform
     * minimum is injected per test; null = none configured.
     */
    private static function gateway(?array $platform_minimum = null): WC_Twoinc
    {
        return new class ($platform_minimum) extends WC_Twoinc {
            private $test_platform_minimum;

            public function __construct($platform_minimum = null)
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
                $this->test_platform_minimum = $platform_minimum;
            }

            public function get_platform_minimum_order()
            {
                return $this->test_platform_minimum;
            }

            public function get_merchant_available_terms(bool $refresh = false): array
            {
                // A typical resolved merchant record (TWO-24812); the fetch/
                // cache protocol has its own dedicated test.
                return [14, 30, 60, 90];
            }
        };
    }

    private const EUR_250_NET = ['amount' => 250.0, 'currency' => 'EUR', 'basis' => 'net'];

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
        // Two ships no checkout subtitle; an overlay supplies one.
        TinyAssert::same('', WC_Twoinc_Brand::get('checkout_subtitle'));
        TinyAssert::same('integration@two.inc', WC_Twoinc_Brand::get('production_key_contact_email'));
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
            return 'https://shop.example/example-overlay-gateway/confirm?order_id=' . $order_id;
        }, 10, 2);

        $body = self::composeOrder();

        TinyAssert::same(
            'https://shop.example/example-overlay-gateway/confirm?order_id=42',
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

    private static function testFeeLineItemNameUsesResolvedLabelWithoutPrefix(): void
    {
        // TWO-25046: the API line-item name for a cart fee must be the
        // fee's own (already resolved, translated, brand-correct) name —
        // no hardcoded 'Fee - ' prefix. Magento's ComposeOrder is the
        // reference: it never prefixes the surcharge description.
        $fee = new class {
            public function get_name()
            {
                return 'Servicekosten';
            }

            public function get_total()
            {
                return 10.0;
            }

            public function get_total_tax()
            {
                return 2.5;
            }

            public function get_taxes()
            {
                return ['total' => []];
            }
        };

        $items = WC_Twoinc_Helper::get_line_items([], [], [$fee], new StubOrder());

        TinyAssert::same(1, count($items));
        TinyAssert::same('Servicekosten', $items[0]['name']);
        TinyAssert::same('SERVICE', $items[0]['type']);
        TinyAssert::true(
            strpos($items[0]['name'], 'Fee - ') === false,
            'Fee line-item name must not carry a hardcoded prefix'
        );
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

    private static function testShippingDetailsOmitTrackingWithoutMeta(): void
    {
        $body = self::composeOrder();

        TinyAssert::true(isset($body['shipping_details']['expected_delivery_date']));
        TinyAssert::same(false, array_key_exists('tracking_number', $body['shipping_details']));
        TinyAssert::same(false, array_key_exists('carrier_name', $body['shipping_details']));
        TinyAssert::same(false, array_key_exists('carrier_tracking_url', $body['shipping_details']));
    }

    private static function testShippingDetailsFromShipmentTrackingMeta(): void
    {
        // Predefined-carrier entry: provider slug becomes carrier_name and
        // no tracking URL is sent (it lives in the tracking plugin's
        // carrier list, not in meta). The LATEST entry must win.
        $order = new StubOrder();
        $order->meta['_wc_shipment_tracking_items'] = [
            ['tracking_provider' => 'dhl', 'tracking_number' => 'OLD-1'],
            ['tracking_provider' => 'postnord-se', 'tracking_number' => 'PN123456789SE'],
        ];

        $details = WC_Twoinc_Helper::get_shipping_details($order);

        TinyAssert::same('PN123456789SE', $details['tracking_number']);
        TinyAssert::same('postnord-se', $details['carrier_name']);
        TinyAssert::same(false, array_key_exists('carrier_tracking_url', $details));

        // Custom-carrier entry: free-text provider name wins over the slug
        // and its link is forwarded.
        $order->meta['_wc_shipment_tracking_items'] = [
            [
                'tracking_provider' => '',
                'custom_tracking_provider' => 'Nordic Couriers',
                'custom_tracking_link' => 'https://track.example/PN1',
                'tracking_number' => 'NC-42',
            ],
        ];

        $details = WC_Twoinc_Helper::get_shipping_details($order);

        TinyAssert::same('NC-42', $details['tracking_number']);
        TinyAssert::same('Nordic Couriers', $details['carrier_name']);
        TinyAssert::same('https://track.example/PN1', $details['carrier_tracking_url']);

        // Malformed entries (no tracking_number, or non-array) must not
        // emit partial tracking fields.
        $order->meta['_wc_shipment_tracking_items'] = [
            ['tracking_provider' => 'dhl', 'tracking_number' => ''],
        ];
        $details = WC_Twoinc_Helper::get_shipping_details($order);
        TinyAssert::same(false, array_key_exists('tracking_number', $details));
        TinyAssert::same(false, array_key_exists('carrier_name', $details));

        $order->meta['_wc_shipment_tracking_items'] = ['not-an-entry'];
        $details = WC_Twoinc_Helper::get_shipping_details($order);
        TinyAssert::same(false, array_key_exists('tracking_number', $details));

        // The meta key is world-writable: numeric values are normalised to
        // strings, whitespace-only and non-scalar values are dropped, and
        // a tracking number with no provider fields emits no carrier_name.
        $order->meta['_wc_shipment_tracking_items'] = [
            ['tracking_provider' => 'dhl', 'tracking_number' => 12345],
        ];
        $details = WC_Twoinc_Helper::get_shipping_details($order);
        TinyAssert::same('12345', $details['tracking_number']);

        $order->meta['_wc_shipment_tracking_items'] = [
            ['tracking_number' => 'LONESOME-1'],
        ];
        $details = WC_Twoinc_Helper::get_shipping_details($order);
        TinyAssert::same('LONESOME-1', $details['tracking_number']);
        TinyAssert::same(false, array_key_exists('carrier_name', $details));

        $order->meta['_wc_shipment_tracking_items'] = [
            ['tracking_provider' => 'dhl', 'tracking_number' => '   '],
        ];
        $details = WC_Twoinc_Helper::get_shipping_details($order);
        TinyAssert::same(false, array_key_exists('tracking_number', $details));

        $order->meta['_wc_shipment_tracking_items'] = [
            ['tracking_provider' => ['nested'], 'tracking_number' => ['nested']],
        ];
        $details = WC_Twoinc_Helper::get_shipping_details($order);
        TinyAssert::same(false, array_key_exists('tracking_number', $details));
        TinyAssert::same(false, array_key_exists('carrier_name', $details));

        // Booleans are dropped, not coerced (strval(true) would emit '1').
        $order->meta['_wc_shipment_tracking_items'] = [
            ['tracking_provider' => 'dhl', 'tracking_number' => true],
        ];
        $details = WC_Twoinc_Helper::get_shipping_details($order);
        TinyAssert::same(false, array_key_exists('tracking_number', $details));
    }

    private static function testProcessUpdateRefusesTerminalStates(): void
    {
        // The Two API rejects order edits once fulfilment has started;
        // without this gate a post-completion change (tracking number
        // added late) would fire a guaranteed-rejected edit on every
        // admin save. No-HTTP is asserted structurally: composing and
        // sending would fatal on StubOrder methods that don't exist.
        $gateway = new class () extends WC_Twoinc {
            public function __construct()
            {
            }
        };
        $method = new ReflectionMethod(WC_Twoinc::class, 'process_update_twoinc_order');
        $method->setAccessible(true);

        $twoinc_meta = [
            'order_reference' => 'test-order-reference',
            'company_id' => '912345678',
            'department' => '',
            'project' => '',
            'purchase_order_number' => '',
            'invoice_emails' => [],
            'payment_reference_message' => '',
            'payment_reference_ocr' => '',
            'payment_reference' => '',
            'payment_reference_type' => '',
            'vendor_name' => '',
        ];

        foreach (["FULFILLING", "FULFILLED", "DELIVERED", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED"] as $state) {
            $order = new StubOrder();
            $order->meta[WC_Twoinc_Brand::meta_key('order_state')] = $state;
            TinyAssert::same(false, $method->invoke($gateway, $order, $twoinc_meta), "state $state must refuse the edit");
        }

        // Editable state whose body hash is already current: in sync,
        // returns true, still without composing an HTTP request.
        $order = new StubOrder();
        $order->meta[WC_Twoinc_Brand::meta_key('order_state')] = 'CONFIRMED';
        $order->meta[WC_Twoinc_Brand::meta_key('req_body_hash')] = WC_Twoinc_Helper::hash_order($order, $twoinc_meta);
        TinyAssert::same(true, $method->invoke($gateway, $order, $twoinc_meta));
    }

    private static function testShippingDetailsCarriedByCreateAndEditBodies(): void
    {
        $order = new StubOrder();
        $order->meta['_wc_shipment_tracking_items'] = [
            ['tracking_provider' => 'bring', 'tracking_number' => 'BR-7'],
        ];

        $create = WC_Twoinc_Helper::compose_twoinc_order(
            $order,
            'test-order-reference',
            '912345678',
            'IT',
            'Project X',
            '',
            []
        );
        $edit = WC_Twoinc_Helper::compose_twoinc_edit_order($order, 'IT', 'Project X', '', '');

        TinyAssert::same('BR-7', $create['shipping_details']['tracking_number']);
        TinyAssert::same('bring', $create['shipping_details']['carrier_name']);
        // Tracking fields only — expected_delivery_date is computed from
        // "now" per call and would flake across a midnight rollover.
        TinyAssert::same('BR-7', $edit['shipping_details']['tracking_number']);
        TinyAssert::same('bring', $edit['shipping_details']['carrier_name']);
    }

    private static function testShippingDetailsFilterOverrides(): void
    {
        // Merchant escape hatch (TWO-24762 option 2): tracking data living
        // outside the shipment-tracking meta convention can be injected.
        add_filter('twoinc_shipping_details', static function ($details, $order) {
            $details['tracking_number'] = 'FILTERED-1';
            $details['carrier_name'] = 'Filter Carrier';
            return $details;
        }, 10, 2);

        $body = self::composeOrder();

        TinyAssert::same('FILTERED-1', $body['shipping_details']['tracking_number']);
        TinyAssert::same('Filter Carrier', $body['shipping_details']['carrier_name']);
    }

    private static function testShippingDetailsFilterGarbageDiscarded(): void
    {
        // The filter fires at checkout order creation too — a broken
        // merchant callback returning a non-array must not be able to put
        // scalar garbage in the create body (that would break checkout,
        // not just tracking). The composed value wins instead.
        add_filter('twoinc_shipping_details', static function ($details, $order) {
            return null;
        }, 10, 2);

        $body = self::composeOrder();

        TinyAssert::true(is_array($body['shipping_details']));
        TinyAssert::true(isset($body['shipping_details']['expected_delivery_date']));
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
        $result = self::gateway(self::EUR_250_NET)->apply_brand_availability_gate($gateways);

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
        $result = self::gateway(self::EUR_250_NET)->apply_brand_availability_gate($gateways);

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
        $result = self::gateway(self::EUR_250_NET)->apply_brand_availability_gate($gateways);
        TinyAssert::same('gw', $result['woocommerce-gateway-testbrand']);

        // EUR 250 gross with tax is below EUR 250 net: the credit check
        // would decline it, so the gate must hide the method
        WC()->cart = new StubCart(250.0, 43.39);
        $result = self::gateway(self::EUR_250_NET)->apply_brand_availability_gate($gateways);
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

    private static function testAvailabilityGateRestrictsBillingCountry(): void
    {
        // The brand gate's billing-country restriction stands alone now
        // that the minimum is API-resolved: an over-minimum basket from
        // an unsupported country is still gated.
        self::useTestbrand();
        WC()->cart = new StubCart(1000.0);
        WC()->customer = new StubCustomer('DE');
        $GLOBALS['__twoinc_test_currency'] = 'EUR';

        $gateways = ['woocommerce-gateway-testbrand' => 'gw'];
        $result = self::gateway(self::EUR_250_NET)->apply_brand_availability_gate($gateways);

        TinyAssert::true(!isset($result['woocommerce-gateway-testbrand']));
    }

    private static function testAvailabilityGateSkipsMinimumsOnEmptyCart(): void
    {
        // No live basket to judge (e.g. a cartless REST context): the
        // minimums must not hide the gateway on a zero-value cart — the
        // API still enforces them at order creation.
        self::useTestbrand();
        WC()->cart = new StubCart(0.0, 0.0, true);
        WC()->customer = new StubCustomer('NL');
        $GLOBALS['__twoinc_test_currency'] = 'EUR';

        $gateways = ['woocommerce-gateway-testbrand' => 'gw'];
        $result = self::gateway(self::EUR_250_NET)->apply_brand_availability_gate($gateways);

        TinyAssert::same('gw', $result['woocommerce-gateway-testbrand']);
    }

    private static function testAvailabilityGateSkipsMinimumsOnOrderPayPage(): void
    {
        // Pay-for-order page: the session cart is not the basket being
        // paid, so an under-minimum (or stale) cart must not hide the
        // gateway. The billing-country gate still applies there.
        self::useTestbrand();
        WC()->cart = new StubCart(100.0);
        WC()->customer = new StubCustomer('NL');
        $GLOBALS['__twoinc_test_currency'] = 'EUR';
        $GLOBALS['__twoinc_test_is_order_pay'] = true;

        try {
            $gateways = ['woocommerce-gateway-testbrand' => 'gw'];
            $result = self::gateway(self::EUR_250_NET)->apply_brand_availability_gate($gateways);
            TinyAssert::same('gw', $result['woocommerce-gateway-testbrand']);

            WC()->customer = new StubCustomer('DE');
            $result = self::gateway(self::EUR_250_NET)->apply_brand_availability_gate($gateways);
            TinyAssert::true(!isset($result['woocommerce-gateway-testbrand']));
        } finally {
            unset($GLOBALS['__twoinc_test_is_order_pay']);
        }
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
        $gateway = self::gateway(self::EUR_250_NET);

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
                self::gateway(self::EUR_250_NET)->validate_merchant_minimum_order_field('merchant_minimum_order', '10')
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
     * (the real gateway constructor needs a WooCommerce install). The
     * merchant's backend `available_terms` set is injectable; the default
     * mirrors a typical resolved merchant record (TWO-24812).
     */
    private static function termsGateway(array $options, array $merchant_terms = [14, 30, 60, 90]): WC_Payment_Gateway
    {
        return new class ($options, $merchant_terms) extends WC_Payment_Gateway {
            private $options;
            private $merchant_terms;

            public function __construct($options, $merchant_terms)
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
                $this->options = $options;
                $this->merchant_terms = $merchant_terms;
            }

            public function get_option($key, $empty_value = null)
            {
                return $this->options[$key] ?? $empty_value ?? '';
            }

            public function get_merchant_available_terms(bool $refresh = false): array
            {
                return $this->merchant_terms;
            }
        };
    }

    private static function testPaymentTermsResolveBackendIntersectAdminSubset(): void
    {
        // No admin subset and no custom term: nothing offered → backend default
        $gateway = self::termsGateway([]);
        TinyAssert::same([], WC_Twoinc_Payment_Terms::get_available_terms($gateway));
        TinyAssert::same(false, WC_Twoinc_Payment_Terms::is_enabled($gateway));

        // Admin narrows within the backend set; entries outside it drop
        $gateway = self::termsGateway(['payment_terms_days' => ['60', '30', '7']]);
        TinyAssert::same([30, 60], WC_Twoinc_Payment_Terms::get_available_terms($gateway));
        TinyAssert::true(WC_Twoinc_Payment_Terms::is_enabled($gateway));

        // A term the backend has withdrawn drops out even while the stale
        // admin subset still ticks it (TWO-24812: backend list is source)
        $gateway = self::termsGateway(['payment_terms_days' => ['30', '60']], [30]);
        TinyAssert::same([30], WC_Twoinc_Payment_Terms::get_available_terms($gateway));

        // Unresolved backend set (no record yet): presets gone, feature off
        $gateway = self::termsGateway(['payment_terms_days' => ['30', '60']], []);
        TinyAssert::same([], WC_Twoinc_Payment_Terms::get_available_terms($gateway));
        TinyAssert::same(false, WC_Twoinc_Payment_Terms::is_enabled($gateway));

        // A custom term is unioned in even when outside the backend presets
        $gateway = self::termsGateway(['payment_terms_days' => ['30'], 'payment_terms_custom_days' => '45']);
        TinyAssert::same([30, 45], WC_Twoinc_Payment_Terms::get_available_terms($gateway));

        // Custom term alone (no presets ticked) still offers a term
        $gateway = self::termsGateway(['payment_terms_custom_days' => '45']);
        TinyAssert::same([45], WC_Twoinc_Payment_Terms::get_available_terms($gateway));
        TinyAssert::true(WC_Twoinc_Payment_Terms::is_enabled($gateway));
    }

    private static function testMerchantAvailableTermsFetchNormalisesCachesAndServesStale(): void
    {
        $gateway = new class () extends WC_Twoinc {
            public $options = ['api_key' => 'key'];
            public $responses = [];
            public $calls = 0;

            public function __construct()
            {
            }

            public function get_merchant_id()
            {
                return 'mid';
            }

            public function get_option($key, $empty_value = null)
            {
                return $this->options[$key] ?? $empty_value ?? '';
            }

            public function update_option($key, $value = '')
            {
                $this->options[$key] = $value;
                return true;
            }

            public function make_request($endpoint, $payload = [], $method = 'POST', $params = [], $api_key_override = null, $timeout = 30)
            {
                $this->calls++;
                return array_shift($this->responses);
            }
        };
        $checked_option = WC_Twoinc_Brand::prefixed_name('merchant_available_terms_checked_on');
        $expire = static function () use ($checked_option) {
            $GLOBALS['__twoinc_test_options'][$checked_option] = time() - 901;
            // TTL expiry only ever happens across requests, so an expiry is
            // also a request boundary for the per-request record memo.
            WC_Twoinc::reset_merchant_record_memo();
        WC_Twoinc_FX::reset_request_cache();
        $GLOBALS['__twoinc_test_transients'] = [];
        };

        // Default (cache-only) read NEVER fetches, even with a cold cache —
        // the seam is reached from the constructor / cart totals / wc-ajax,
        // none of which may block on HTTP.
        TinyAssert::same([], $gateway->get_merchant_available_terms());
        TinyAssert::same(0, $gateway->calls);

        // First refresh: normalised (ints, dedup, non-positive dropped,
        // non-numeric dropped rather than intval'd to a phantom 1, sorted)
        $gateway->responses[] = ['response' => ['code' => 200], 'body' => json_encode(['available_terms' => [60, 30, 30, 0, -5, 90, [7], true, null]])];
        TinyAssert::same([30, 60, 90], $gateway->get_merchant_available_terms(true));
        TinyAssert::same(1, $gateway->calls);

        // Within the TTL: served from the cached option, no request —
        // and cache-only reads see the refreshed list
        TinyAssert::same([30, 60, 90], $gateway->get_merchant_available_terms(true));
        TinyAssert::same([30, 60, 90], $gateway->get_merchant_available_terms());
        TinyAssert::same(1, $gateway->calls);

        // Fetch failure after expiry: last-known list served, not blanked
        $expire();
        $gateway->responses[] = new WP_Error('http_request_failed', 'down');
        TinyAssert::same([30, 60, 90], $gateway->get_merchant_available_terms(true));
        TinyAssert::same(2, $gateway->calls);

        // ...and the failure still bumped the TTL clock: an immediate
        // re-refresh does NOT hammer the API (one stall per TTL, not per view)
        TinyAssert::same([30, 60, 90], $gateway->get_merchant_available_terms(true));
        TinyAssert::same(2, $gateway->calls);

        // Successful response WITHOUT the field (older backend): stale kept
        $expire();
        $gateway->responses[] = ['response' => ['code' => 200], 'body' => json_encode(['due_in_days' => 14])];
        TinyAssert::same([30, 60, 90], $gateway->get_merchant_available_terms(true));

        // Successful explicit [] : the backend says nothing is offerable
        $expire();
        $gateway->responses[] = ['response' => ['code' => 200], 'body' => json_encode(['available_terms' => []])];
        TinyAssert::same([], $gateway->get_merchant_available_terms(true));

        // No API key: no fetch attempted even on refresh. The TTL must be
        // expired and a sentinel response queued, or this would pass on the
        // TTL gate alone without ever exercising the api_key guard.
        $expire();
        $bare = clone $gateway;
        $bare->options = [];
        $bare->calls = 0;
        $bare->responses = [['response' => ['code' => 200], 'body' => json_encode(['available_terms' => [7]])]];
        $bare->get_merchant_available_terms(true);
        TinyAssert::same(0, $bare->calls);
    }

    private static function testMerchantAvailableTermsInvalidatedOnMerchantIdChange(): void
    {
        $terms_option = WC_Twoinc_Brand::prefixed_name('merchant_available_terms');
        $checked_option = WC_Twoinc_Brand::prefixed_name('merchant_available_terms_checked_on');
        $GLOBALS['__twoinc_test_options'][$terms_option] = '[30,60]';
        $GLOBALS['__twoinc_test_options'][$checked_option] = 999;

        $gateway = new class () extends WC_Twoinc {
            public $options = [
                'api_key' => 'key',
                'merchant_id' => 'old-merchant',
            ];
            public $responses = [];

            public function __construct()
            {
            }

            public function get_twoinc_checkout_host()
            {
                return 'https://api.example';
            }

            public function get_option($key, $empty_value = null)
            {
                return $this->options[$key] ?? $empty_value ?? '';
            }

            public function update_option($key, $value = '')
            {
                $this->options[$key] = $value;
                return true;
            }

            public function make_request($endpoint, $payload = [], $method = 'POST', $params = [], $api_key_override = null, $timeout = 30)
            {
                return array_shift($this->responses);
            }
        };

        // Saved key re-verifies to a DIFFERENT merchant: the old merchant's
        // cached term list must be dropped (serve-stale would otherwise pin
        // it under the new identity).
        $gateway->responses[] = ['response' => ['code' => 200], 'body' => json_encode(['id' => 'new-merchant', 'short_name' => 'nm'])];
        $gateway->verify_api_key();
        TinyAssert::same('new-merchant', $gateway->options['merchant_id']);
        TinyAssert::same(false, array_key_exists($terms_option, $GLOBALS['__twoinc_test_options']));
        TinyAssert::same(false, array_key_exists($checked_option, $GLOBALS['__twoinc_test_options']));
        TinyAssert::same([], $gateway->get_merchant_available_terms());

        // Same merchant re-verifying does NOT drop the cache
        $GLOBALS['__twoinc_test_options'][$terms_option] = '[30,60]';
        $GLOBALS['__twoinc_test_options'][$checked_option] = 999;
        $gateway->responses[] = ['response' => ['code' => 200], 'body' => json_encode(['id' => 'new-merchant', 'short_name' => 'nm'])];
        $gateway->verify_api_key();
        TinyAssert::same('[30,60]', $GLOBALS['__twoinc_test_options'][$terms_option]);
    }

    private static function testDeactivationCleanupClearsSettingsAndTermCache(): void
    {
        $settings_option = 'woocommerce_woocommerce-gateway-tillit_settings';
        $terms_option = WC_Twoinc_Brand::prefixed_name('merchant_available_terms');
        $checked_option = WC_Twoinc_Brand::prefixed_name('merchant_available_terms_checked_on');

        $make_gateway = static function (string $clear) {
            $gateway = new class () extends WC_Twoinc {
                public $options = [];

                public function __construct()
                {
                    $this->id = 'woocommerce-gateway-tillit';
                }

                public function get_option($key, $empty_value = null)
                {
                    return $this->options[$key] ?? $empty_value ?? '';
                }
            };
            $gateway->options['clear_options_on_deactivation'] = $clear;
            return $gateway;
        };
        $seed = static function () use ($settings_option, $terms_option, $checked_option) {
            $GLOBALS['__twoinc_test_options'][$settings_option] = ['api_key' => 'key'];
            $GLOBALS['__twoinc_test_options'][$terms_option] = '[30,60]';
            $GLOBALS['__twoinc_test_options'][$checked_option] = 999;
        };

        // Toggle key absent from the settings blob: the state every merchant
        // who never opened the toggle is in. Default is no-wipe, so nothing
        // is deleted — same contract as an explicit 'no'.
        $seed();
        $absent_gateway = $make_gateway('no');
        unset($absent_gateway->options['clear_options_on_deactivation']);
        TinyAssert::same(false, array_key_exists('clear_options_on_deactivation', $absent_gateway->options));
        $absent_gateway->on_deactivate_plugin();
        TinyAssert::true(array_key_exists($settings_option, $GLOBALS['__twoinc_test_options']));
        TinyAssert::true(array_key_exists($terms_option, $GLOBALS['__twoinc_test_options']));
        TinyAssert::true(array_key_exists($checked_option, $GLOBALS['__twoinc_test_options']));

        // Toggle off: deactivation leaves everything in place
        $seed();
        $make_gateway('no')->on_deactivate_plugin();
        TinyAssert::true(array_key_exists($settings_option, $GLOBALS['__twoinc_test_options']));
        TinyAssert::true(array_key_exists($terms_option, $GLOBALS['__twoinc_test_options']));
        TinyAssert::true(array_key_exists($checked_option, $GLOBALS['__twoinc_test_options']));

        // Toggle on: settings blob AND the dedicated term-cache options go —
        // the cache lives outside the settings blob (TWO-24812), so clearing
        // only the blob would leave orphaned rows.
        $seed();
        $make_gateway('yes')->on_deactivate_plugin();
        TinyAssert::same(false, array_key_exists($settings_option, $GLOBALS['__twoinc_test_options']));
        TinyAssert::same(false, array_key_exists($terms_option, $GLOBALS['__twoinc_test_options']));
        TinyAssert::same(false, array_key_exists($checked_option, $GLOBALS['__twoinc_test_options']));
    }

    private static function testMerchantRecordFetchSharedAcrossConsumersAndOffTheBlob(): void
    {
        $gateway = new class () extends WC_Twoinc {
            public $options = [
                'api_key' => 'key',
                'merchant_id' => 'mid',
            ];
            public $responses = [];
            public $calls = 0;

            public function __construct()
            {
            }

            public function get_merchant_id()
            {
                return 'mid';
            }

            public function get_option($key, $empty_value = null)
            {
                return $this->options[$key] ?? $empty_value ?? '';
            }

            public function update_option($key, $value = '')
            {
                $this->options[$key] = $value;
                return true;
            }

            public function make_request($endpoint, $payload = [], $method = 'POST', $params = [], $api_key_override = null, $timeout = 30)
            {
                $this->calls++;
                return array_shift($this->responses);
            }
        };

        $record = [
            'due_in_days' => 21,
            'min_order_amount' => 100,
            'min_order_currency' => 'nok',
            'min_order_basis' => 'net',
            'available_terms' => [30, 60],
            'surcharge_limit_amount' => 25,
            'surcharge_limit_currency' => 'eur',
        ];
        $gateway->responses[] = ['response' => ['code' => 200], 'body' => json_encode($record)];

        // All four consumers in one request: exactly ONE wire fetch
        TinyAssert::same([30, 60], $gateway->get_merchant_available_terms(true));
        TinyAssert::same(21, $gateway->get_merchant_default_days_on_invoice());
        $minimum = $gateway->get_platform_minimum_order();
        TinyAssert::same(['amount' => 100.0, 'currency' => 'NOK', 'basis' => 'net'], $minimum);
        TinyAssert::same(['amount' => 25.0, 'currency' => 'EUR'], $gateway->get_merchant_surcharge_limit(true));
        TinyAssert::same(1, $gateway->calls);

        // The caches live in dedicated wp_options, never the settings blob —
        // a frontend TTL-expiry write into the blob can silently revert a
        // concurrent admin settings save (WC_Settings_API::update_option
        // rewrites the whole array from an in-memory snapshot).
        TinyAssert::same(21, (int) $GLOBALS['__twoinc_test_options'][WC_Twoinc_Brand::prefixed_name('days_on_invoice')]);
        TinyAssert::true(isset($GLOBALS['__twoinc_test_options'][WC_Twoinc_Brand::prefixed_name('platform_minimum_order')]));
        TinyAssert::same(false, array_key_exists('days_on_invoice', $gateway->options));
        TinyAssert::same(false, array_key_exists('days_on_invoice_last_checked_on', $gateway->options));
        TinyAssert::same(false, array_key_exists('platform_minimum_order', $gateway->options));
        TinyAssert::same(false, array_key_exists('platform_minimum_order_last_checked_on', $gateway->options));

        // Next request with every TTL expired and the API down: one capped
        // stall total (memo covers failures), each consumer keeps its own
        // degrade posture — days serves stale, minimum blanks to null,
        // terms serve stale.
        foreach (['merchant_available_terms_checked_on', 'days_on_invoice_checked_on', 'platform_minimum_order_checked_on', 'merchant_surcharge_limit_checked_on'] as $name) {
            $GLOBALS['__twoinc_test_options'][WC_Twoinc_Brand::prefixed_name($name)] = time() - 3601;
        }
        WC_Twoinc::reset_merchant_record_memo();
        WC_Twoinc_FX::reset_request_cache();
        $GLOBALS['__twoinc_test_transients'] = [];
        $gateway->responses[] = new WP_Error('http_request_failed', 'down');

        TinyAssert::same([30, 60], $gateway->get_merchant_available_terms(true));
        TinyAssert::same(21, $gateway->get_merchant_default_days_on_invoice());
        TinyAssert::same(null, $gateway->get_platform_minimum_order());
        TinyAssert::same(['amount' => 25.0, 'currency' => 'EUR'], $gateway->get_merchant_surcharge_limit(true));
        TinyAssert::same(2, $gateway->calls);
    }

    private static function testPaymentTermsValidationNonDestructiveOnUnresolvedOrNarrowedList(): void
    {
        // Unresolved backend list (fresh install first save, or API down on
        // a cold cache): the checkboxes were never rendered, so an empty
        // POST is not a merchant choice — stored selection survives, no
        // mandatory-selection throw.
        $gateway = self::validationGateway(['payment_terms_days' => [30, 60]], []);
        TinyAssert::same([30, 60], $gateway->validate_two_payment_terms_field('payment_terms_days', []));

        // Narrowed list between render and save: a previously saved tick
        // outside the current backend list still saves (read-time intersect
        // enforces the live list; save-time must not erase the tick).
        $gateway = self::validationGateway(['payment_terms_days' => [30, 60]], [30, 90]);
        TinyAssert::same([30, 60], $gateway->validate_two_payment_terms_field('payment_terms_days', ['30', '60']));

        // A day in neither the backend list nor the stored subset still drops
        $gateway = self::validationGateway(['payment_terms_days' => [30]], [30, 60]);
        TinyAssert::same([30], $gateway->validate_two_payment_terms_field('payment_terms_days', ['30', '17']));

        // The default-term validator has the same degrade path: nothing
        // rendered/posted keeps the stored default rather than blanking it
        $gateway = self::validationGateway(['payment_terms_days' => [30, 60], 'default_payment_term' => '60'], []);
        TinyAssert::same('60', $gateway->validate_default_payment_term_field('default_payment_term', ''));

        // ...and a saved custom term must not punch through it: with the
        // checkbox field unrendered, the posted custom term (the only thing
        // the degraded form can post) must not repoint the stored default
        $gateway = self::validationGateway(
            ['payment_terms_days' => [30, 60], 'default_payment_term' => '30', 'payment_terms_custom_days' => '45'],
            []
        );
        $custom_key = $gateway->get_field_key('payment_terms_custom_days');
        $_POST[$custom_key] = '45';
        TinyAssert::same('30', $gateway->validate_default_payment_term_field('default_payment_term', '45'));
        unset($_POST[$custom_key]);
    }

    private static function testSurchargeGridPreservesRowsNotOnTheForm(): void
    {
        // Preservation keys on the POSTed row keys (what was actually on
        // the form), not the live term set — the set can shift between
        // render and save, and the sibling terms field validates first.

        // A row for a withdrawn term is not posted and survives untouched
        $gateway = self::validationGateway(
            ['surcharge_grid' => [60 => ['percentage' => '2.5'], 30 => ['fixed' => '9']]],
            [30]
        );
        $saved = $gateway->validate_two_surcharge_grid_field('surcharge_grid', [30 => ['fixed' => '5']]);
        TinyAssert::same(['fixed' => '5'], $saved[30]);
        TinyAssert::same(['percentage' => '2.5'], $saved[60]);

        // Same-save re-tick: the term is back in the offered set, but its
        // row was never rendered — the stored row must still survive
        $gateway = self::validationGateway(
            ['surcharge_grid' => [60 => ['percentage' => '2.5'], 30 => ['fixed' => '9']]],
            [30, 60]
        );
        $saved = $gateway->validate_two_surcharge_grid_field('surcharge_grid', [30 => ['fixed' => '9']]);
        TinyAssert::same(['percentage' => '2.5'], $saved[60]);

        // No rows rendered at all (unresolved list → null POST): the whole
        // stored grid survives instead of being wiped
        $gateway = self::validationGateway(
            ['surcharge_grid' => [60 => ['percentage' => '2.5'], 30 => ['fixed' => '9']]],
            []
        );
        $saved = $gateway->validate_two_surcharge_grid_field('surcharge_grid', null);
        TinyAssert::same(['fixed' => '9'], $saved[30]);
        TinyAssert::same(['percentage' => '2.5'], $saved[60]);

        // A rendered-and-blanked row posts its key with empty cells and is
        // deliberately deleted (blanking is an edit, not an omission)
        $gateway = self::validationGateway(
            ['surcharge_grid' => [30 => ['fixed' => '9']]],
            [30]
        );
        $saved = $gateway->validate_two_surcharge_grid_field('surcharge_grid', [30 => ['fixed' => '', 'percentage' => '', 'limit' => '']]);
        TinyAssert::same(false, array_key_exists(30, $saved));
    }

    /**
     * WC_Twoinc fake for validator tests: in-memory options plus an
     * injectable backend term list (cache-only accessor).
     */
    private static function validationGateway(array $options, array $merchant_terms): WC_Twoinc
    {
        return new class ($options, $merchant_terms) extends WC_Twoinc {
            public $options;
            private $merchant_terms;

            public function __construct($options = [], $merchant_terms = [])
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
                $this->options = $options;
                $this->merchant_terms = $merchant_terms;
            }

            public function get_option($key, $empty_value = null)
            {
                return $this->options[$key] ?? $empty_value ?? '';
            }

            public function update_option($key, $value = '')
            {
                $this->options[$key] = $value;
                return true;
            }

            public function get_merchant_available_terms(bool $refresh = false): array
            {
                return $this->merchant_terms;
            }
        };
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

        // Fixed amounts are configured in the store currency; when the
        // active checkout currency differs they are FX-converted
        // (TWO-25104 closed the parity gap vs Magento). With no rate ever
        // fetched the surcharge is withheld — a wrong-currency amount is
        // never sent. The conversion itself is covered by the FX tests.
        $GLOBALS['__twoinc_test_currency'] = 'GBP';
        $gateway = self::fxGateway(null, [new WP_Error()], [
            'surcharge_type' => 'fixed',
            'surcharge_grid' => [30 => ['fixed' => '10']],
        ]);
        TinyAssert::same(null, WC_Twoinc_Payment_Terms::build_buyer_fee_share($gateway, 30));
        unset($GLOBALS['__twoinc_test_currency']);
        unset($GLOBALS['test_home_url']);
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

    private static function testSurchargeGridEnforcesMerchantFixedCap(): void
    {
        $limit_option = WC_Twoinc_Brand::prefixed_name('merchant_surcharge_limit');
        $checked_option = WC_Twoinc_Brand::prefixed_name('merchant_surcharge_limit_checked_on');
        $GLOBALS['__twoinc_test_options'][$limit_option] = json_encode(['amount' => 25.0, 'currency' => 'EUR']);
        $GLOBALS['__twoinc_test_options'][$checked_option] = time();
        $gateway = self::gateway();

        // At the cap: allowed
        $clean = $gateway->validate_two_surcharge_grid_field('surcharge_grid', [30 => ['fixed' => '25']]);
        TinyAssert::same([30 => ['fixed' => '25']], $clean);

        // Above the cap: rejected, message names the cap
        $message = '';
        try {
            $gateway->validate_two_surcharge_grid_field('surcharge_grid', [30 => ['fixed' => '25.01']]);
        } catch (Exception $e) {
            $message = $e->getMessage();
        }
        TinyAssert::true(strpos($message, 'EUR 25') !== false, "cap message missing, got: $message");

        // Locale comma input is normalised BEFORE the cap check — '25,01'
        // is 25.01 over a 25 cap, not a string that dodges the comparison.
        $message = '';
        try {
            $gateway->validate_two_surcharge_grid_field('surcharge_grid', [30 => ['fixed' => '25,01']]);
        } catch (Exception $e) {
            $message = $e->getMessage();
        }
        TinyAssert::true(strpos($message, 'EUR 25') !== false, "comma-locale cap message missing, got: $message");

        // The cap binds the fixed column only — percentage and per-order
        // limit columns are governed by their own rules.
        $clean = $gateway->validate_two_surcharge_grid_field('surcharge_grid', [30 => ['percentage' => '90', 'limit' => '100']]);
        TinyAssert::same([30 => ['percentage' => '90', 'limit' => '100']], $clean);

        // Store currency differs from the cap's: Woo does no FX conversion,
        // so the cap is skipped here (the backend still enforces).
        $GLOBALS['__twoinc_test_currency'] = 'NOK';
        $clean = $gateway->validate_two_surcharge_grid_field('surcharge_grid', [30 => ['fixed' => '9999']]);
        TinyAssert::same([30 => ['fixed' => '9999']], $clean);
        unset($GLOBALS['__twoinc_test_currency']);
        unset($GLOBALS['test_home_url']);

        // No cap configured: behaviour unchanged
        unset($GLOBALS['__twoinc_test_options'][$limit_option]);
        $clean = $gateway->validate_two_surcharge_grid_field('surcharge_grid', [30 => ['fixed' => '9999']]);
        TinyAssert::same([30 => ['fixed' => '9999']], $clean);
    }

    private static function testSurchargeCapZeroAmountFromApiMeansNoLimit(): void
    {
        // A zero-amount cap record from the API means "no limit", not
        // "nothing may be charged": it caches the no-limit marker, so no
        // enforcement and no Max sentence downstream.
        $gateway = new class () extends WC_Twoinc {
            public $options = ['api_key' => 'key', 'merchant_id' => 'mid'];
            public $responses = [];

            public function __construct()
            {
            }

            public function get_merchant_id()
            {
                return 'mid';
            }

            public function get_option($key, $empty_value = null)
            {
                return $this->options[$key] ?? $empty_value ?? '';
            }

            public function update_option($key, $value = '')
            {
                $this->options[$key] = $value;
                return true;
            }

            public function make_request($endpoint, $payload = [], $method = 'POST', $params = [], $api_key_override = null, $timeout = 30)
            {
                return array_shift($this->responses);
            }
        };
        $gateway->responses[] = ['response' => ['code' => 200], 'body' => json_encode([
            'surcharge_limit_amount' => 0,
            'surcharge_limit_currency' => 'eur',
        ])];

        TinyAssert::same(null, $gateway->get_merchant_surcharge_limit(true));
        // The no-limit outcome is cached as the empty marker...
        TinyAssert::same('', $GLOBALS['__twoinc_test_options'][WC_Twoinc_Brand::prefixed_name('merchant_surcharge_limit')]);
        // ...and save-validation applies no cap.
        $clean = $gateway->validate_two_surcharge_grid_field('surcharge_grid', [30 => ['fixed' => '9999']]);
        TinyAssert::same([30 => ['fixed' => '9999']], $clean);
    }

    private static function testSurchargeGridHelpTextOmitsMaxOnCurrencyMismatch(): void
    {
        $limit_option = WC_Twoinc_Brand::prefixed_name('merchant_surcharge_limit');
        $GLOBALS['__twoinc_test_options'][$limit_option] = json_encode(['amount' => 25.0, 'currency' => 'EUR']);

        // Matching store currency: the grid claims the enforced maximum.
        $GLOBALS['__twoinc_test_currency'] = 'EUR';
        $gateway = self::validationGateway(['payment_terms_days' => [30]], [30]);
        $html = $gateway->generate_two_surcharge_grid_html('surcharge_grid', []);
        TinyAssert::true(strpos($html, 'Max EUR 25.') !== false, 'expected Max sentence for matching currency');

        // Store currency differs from the cap's: save-validation skips the
        // cap (Woo does no FX conversion), so the help text must not claim
        // a maximum it will not enforce.
        $GLOBALS['__twoinc_test_currency'] = 'NOK';
        $html = $gateway->generate_two_surcharge_grid_html('surcharge_grid', []);
        TinyAssert::true(strpos($html, 'Max') === false, 'Max sentence must be omitted on currency mismatch');
        unset($GLOBALS['__twoinc_test_currency']);
        unset($GLOBALS['test_home_url']);
    }

    // ── Surcharge tax treatment (TWO-25070) ────────────────────────────

    /**
     * Gateway fake for the surcharge cart-fee path: options injected, one
     * merchant term offered, and the pricing endpoint canned to quote a
     * 12.50 buyer fee share.
     */
    private static function surchargeFeeGateway(array $options): WC_Twoinc
    {
        return new class ($options) extends WC_Twoinc {
            private $options;

            public function __construct($options = [])
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
                $this->options = $options;
            }

            public function get_option($key, $empty_value = null)
            {
                return $this->options[$key] ?? $empty_value ?? '';
            }

            public function get_merchant_available_terms(bool $refresh = false): array
            {
                return [30, 60];
            }

            public function make_request($endpoint, $payload = [], $method = 'POST', $params = [], $api_key_override = null, $timeout = 30)
            {
                if (strpos($endpoint, '/v1/pricing/order/fee') === 0) {
                    return [
                        'response' => ['code' => 200],
                        'body' => json_encode(['buyer_fee_share' => '12.50', 'currency' => 'EUR']),
                    ];
                }
                return new WP_Error();
            }
        };
    }

    /**
     * Drive the woocommerce_cart_calculate_fees handler end-to-end (session
     * gateway match, term resolution, fee quote, add_fee) against a
     * StubFeeCart, and return the cart for assertions on the recorded
     * add_fee call. $options rides on top of a minimal enabled-surcharge
     * configuration.
     */
    private static function runApplyCartFee(array $options): StubFeeCart
    {
        $gateway = self::surchargeFeeGateway(array_merge([
            'surcharge_type' => 'percentage',
            'payment_terms_days' => [30],
            'surcharge_grid' => [30 => ['percentage' => 2.0]],
        ], $options));
        return self::withGatewayInstance($gateway, static function () use ($gateway) {
            WC_Twoinc_Payment_Terms::reset_fee_cache();
            WC()->session = new StubSession();
            WC()->session->set('chosen_payment_method', $gateway->id);
            WC()->customer = new StubCustomer('US');
            $cart = new StubFeeCart();
            WC_Twoinc_Payment_Terms::apply_cart_fee($cart);
            TinyAssert::same(1, count($cart->fees), 'expected exactly one surcharge fee line');
            return $cart;
        });
    }

    private static function testSurchargeFeeStandardModeUnchanged(): void
    {
        // Regression pin: no tax-treatment option stored (pre-feature
        // install) → the pre-feature 3-arg taxable call, byte-for-byte, so
        // WC taxes the fee under Standard exactly as today.
        $GLOBALS['__twoinc_test_tax_classes'] = ['Reduced rate'];
        $GLOBALS['__twoinc_test_tax_rates'] = ['' => [25.0], 'reduced-rate' => [5.0]];

        $fee = self::runApplyCartFee([])->fees[0];
        TinyAssert::same(3, $fee['argc'], 'standard mode must keep the pre-feature 3-arg add_fee call');
        TinyAssert::same(true, $fee['taxable']);
        TinyAssert::same(12.5, $fee['amount']);
        TinyAssert::same(12.5 * 0.25, $fee['tax'], 'standard mode taxes at the Standard rate');

        // An explicit 'standard' selection is identical.
        $fee = self::runApplyCartFee(['surcharge_tax_treatment' => 'standard'])->fees[0];
        TinyAssert::same(3, $fee['argc']);
        TinyAssert::same(true, $fee['taxable']);
    }

    private static function testSurchargeFeeCustomClassTaxedAtSelectedClassRates(): void
    {
        // 'B2B Levy' carries TWO simultaneous destination-matched rate rows
        // (the US state+local / CA GST+PST shape): WC's engine applies them
        // additively, and the fee must be taxed at 5% + 2%, not at the 25%
        // Standard rate.
        $GLOBALS['__twoinc_test_tax_classes'] = ['B2B Levy', 'Reduced rate'];
        $GLOBALS['__twoinc_test_tax_rates'] = [
            '' => [25.0],
            'b2b-levy' => [5.0, 2.0],
            'reduced-rate' => [10.0],
        ];

        $fee = self::runApplyCartFee([
            'surcharge_tax_treatment' => 'custom_class',
            'surcharge_tax_class' => 'b2b-levy',
        ])->fees[0];
        TinyAssert::same(4, $fee['argc'], 'custom_class mode must pass the tax_class argument');
        TinyAssert::same(true, $fee['taxable']);
        TinyAssert::same('b2b-levy', $fee['tax_class']);
        // 5% + 2% of 12.50 = 0.875 (exact in binary floating point).
        TinyAssert::same(0.875, $fee['tax'], 'multi-rate rows for the selected class stack additively');
    }

    private static function testSurchargeFeeAlwaysZeroNeverTaxed(): void
    {
        // Fat Standard rate and a "Zero rate" class that a merchant has
        // (mis)filled with rate rows: always_zero must not consult either —
        // it is add_fee(…, taxable: false), not a binding to any class, so
        // the guarantee is destination-independent by construction.
        $GLOBALS['__twoinc_test_tax_classes'] = ['Zero rate'];
        $GLOBALS['__twoinc_test_tax_rates'] = ['' => [25.0], 'zero-rate' => [19.0]];

        $fee = self::runApplyCartFee(['surcharge_tax_treatment' => 'always_zero'])->fees[0];
        TinyAssert::same(3, $fee['argc'], 'always_zero must not pass a tax class');
        TinyAssert::same(false, $fee['taxable']);
        TinyAssert::same(0.0, $fee['tax']);
    }

    private static function testSurchargeFeeCustomClassFallsBackWhenClassDeleted(): void
    {
        // The stored class was deleted from WooCommerce → Settings → Tax.
        // Core's add_fee would silently tax it as Standard; the resolver
        // must degrade to EXPLICIT standard treatment instead (same tax
        // outcome, but visible in settings and never passing a dead slug).
        $GLOBALS['__twoinc_test_tax_classes'] = ['Reduced rate'];
        $GLOBALS['__twoinc_test_tax_rates'] = ['' => [25.0], 'reduced-rate' => [5.0]];

        $options = [
            'surcharge_tax_treatment' => 'custom_class',
            'surcharge_tax_class' => 'deleted-class',
        ];
        $settings = WC_Twoinc_Payment_Terms::get_surcharge_settings(
            self::surchargeFeeGateway(array_merge(['surcharge_type' => 'percentage'], $options))
        );
        TinyAssert::same('standard', $settings['tax_treatment'], 'a dead slug must degrade to standard treatment');
        TinyAssert::same('', $settings['tax_class']);

        $fee = self::runApplyCartFee($options)->fees[0];
        TinyAssert::same(3, $fee['argc'], 'fallback must use the plain 3-arg call, never a dead slug');
        TinyAssert::same(true, $fee['taxable']);
        TinyAssert::same(12.5 * 0.25, $fee['tax'], 'fallback taxes at the Standard rate');

        // An empty stored class in custom_class mode degrades the same way.
        $settings = WC_Twoinc_Payment_Terms::get_surcharge_settings(
            self::surchargeFeeGateway(['surcharge_type' => 'percentage', 'surcharge_tax_treatment' => 'custom_class'])
        );
        TinyAssert::same('standard', $settings['tax_treatment']);
    }

    private static function testSurchargeTaxSettingsValidationAndStaleNotice(): void
    {
        $GLOBALS['__twoinc_test_tax_classes'] = ['B2B Levy'];

        // Options are built live from WC_Tax, keyed by slug.
        $gateway = self::surchargeFeeGateway([]);
        $options = $gateway->get_surcharge_tax_class_options();
        TinyAssert::same(['', 'b2b-levy'], array_keys($options));
        TinyAssert::same('B2B Levy', $options['b2b-levy']);

        // A pathological class name whose slug sanitises to '' is skipped —
        // it must not overwrite the '' placeholder option.
        $GLOBALS['__twoinc_test_tax_classes'] = ['!!!', 'B2B Levy'];
        $options = $gateway->get_surcharge_tax_class_options();
        TinyAssert::same(['', 'b2b-levy'], array_keys($options), 'empty-slug class must not clobber the placeholder');
        TinyAssert::same('— select a tax class —', $options['']);
        $GLOBALS['__twoinc_test_tax_classes'] = ['B2B Levy'];

        // Save-validation: live slug and '' pass, a dead slug is rejected
        // (WC's select validation does not enforce option membership).
        TinyAssert::same('b2b-levy', $gateway->validate_surcharge_tax_class_field('surcharge_tax_class', 'b2b-levy'));
        TinyAssert::same('', $gateway->validate_surcharge_tax_class_field('surcharge_tax_class', ''));
        $threw = false;
        try {
            $gateway->validate_surcharge_tax_class_field('surcharge_tax_class', 'deleted-class');
        } catch (Exception $e) {
            $threw = true;
        }
        TinyAssert::true($threw, 'a non-live tax class must be rejected at save');

        // Treatment validation enforces the three modes.
        TinyAssert::same('always_zero', $gateway->validate_surcharge_tax_treatment_field('surcharge_tax_treatment', 'always_zero'));
        $threw = false;
        try {
            $gateway->validate_surcharge_tax_treatment_field('surcharge_tax_treatment', 'zero_rate_class');
        } catch (Exception $e) {
            $threw = true;
        }
        TinyAssert::true($threw);

        // Stale-selection notice: shown only when custom_class is selected
        // AND the stored slug no longer matches a live class.
        $stale = self::surchargeFeeGateway([
            'surcharge_tax_treatment' => 'custom_class',
            'surcharge_tax_class' => 'deleted-class',
        ]);
        TinyAssert::true(strpos($stale->get_surcharge_tax_class_stale_notice(), 'no longer exists') !== false);

        // The stored slug is echoed into the settings description (raw HTML
        // context) — a crafted value must come out HTML-escaped.
        $crafted = self::surchargeFeeGateway([
            'surcharge_tax_treatment' => 'custom_class',
            'surcharge_tax_class' => '<script>alert(1)</script>',
        ]);
        $notice = $crafted->get_surcharge_tax_class_stale_notice();
        TinyAssert::true(strpos($notice, '<script>') === false, 'stale notice must HTML-escape the stored slug');
        TinyAssert::true(strpos($notice, '&lt;script&gt;') !== false);

        $healthy = self::surchargeFeeGateway([
            'surcharge_tax_treatment' => 'custom_class',
            'surcharge_tax_class' => 'b2b-levy',
        ]);
        TinyAssert::same('', $healthy->get_surcharge_tax_class_stale_notice());
        $standard = self::surchargeFeeGateway([
            'surcharge_tax_treatment' => 'standard',
            'surcharge_tax_class' => 'deleted-class',
        ]);
        TinyAssert::same('', $standard->get_surcharge_tax_class_stale_notice(), 'no notice outside custom_class mode');
    }

    private static function testSurchargeTaxTreatmentRequiresExplicitSelection(): void
    {
        $GLOBALS['__twoinc_test_tax_classes'] = ['B2B Levy'];

        // Field definition: placeholder option first, NO pre-selected
        // default — a never-configured shop starts unselected.
        $gateway = self::surchargeFeeGateway([]);
        $gateway->init_form_fields();
        $field = $gateway->form_fields['surcharge_tax_treatment'];
        TinyAssert::same('', $field['default'], 'treatment must not default to any mode');
        TinyAssert::same(['', 'standard', 'custom_class', 'always_zero'], array_keys($field['options']));
        TinyAssert::same('-- Select surcharge tax treatment --', $field['options']['']);

        // The '' placeholder is storable while surcharges stay disabled.
        $off = self::surchargeFeeGateway(['surcharge_type' => 'none']);
        TinyAssert::same('', $off->validate_surcharge_tax_treatment_field('surcharge_tax_treatment', ''));

        // ...but rejected when the SAME save enables surcharges (the
        // posted sibling value wins over the stored one).
        $off->test_post_data = [$off->get_field_key('surcharge_type') => 'percentage'];
        $threw = false;
        try {
            $off->validate_surcharge_tax_treatment_field('surcharge_tax_treatment', '');
        } catch (Exception $e) {
            $threw = true;
        }
        TinyAssert::true($threw, 'empty treatment must be rejected while enabling surcharges');

        // ...and when surcharges are already enabled in stored settings —
        // no silent save-as-standard.
        $on = self::surchargeFeeGateway(['surcharge_type' => 'fixed']);
        $threw = false;
        try {
            $on->validate_surcharge_tax_treatment_field('surcharge_tax_treatment', '');
        } catch (Exception $e) {
            $threw = true;
        }
        TinyAssert::true($threw, 'empty treatment must be rejected while surcharges are enabled');

        // ENABLING surcharges is itself blocked while no treatment is
        // selected: WooCommerce's per-field validation only skips the
        // failing field, so without this a save could still flip the type
        // on while the treatment error merely left the treatment unset.
        $fresh = self::surchargeFeeGateway([]);
        $threw = false;
        try {
            $fresh->validate_surcharge_type_field('surcharge_type', 'percentage');
        } catch (Exception $e) {
            $threw = true;
        }
        TinyAssert::true($threw, 'enabling surcharges with no treatment must be blocked');

        // Enabling and picking a treatment in the same save passes.
        $fresh->test_post_data = [$fresh->get_field_key('surcharge_tax_treatment') => 'always_zero'];
        TinyAssert::same('percentage', $fresh->validate_surcharge_type_field('surcharge_type', 'percentage'));

        // Disabling never needs a treatment.
        TinyAssert::same('none', self::surchargeFeeGateway([])->validate_surcharge_type_field('surcharge_type', 'none'));

        // Persisted-value nuance: a merchant whose STORED treatment is
        // 'standard' (accepted under the old default) is untouched — the
        // value round-trips through save-validation and the runtime
        // resolver reads it as-is.
        $legacy = self::surchargeFeeGateway(['surcharge_type' => 'percentage', 'surcharge_tax_treatment' => 'standard']);
        TinyAssert::same('standard', $legacy->validate_surcharge_tax_treatment_field('surcharge_tax_treatment', 'standard'));
        TinyAssert::same('percentage', $legacy->validate_surcharge_type_field('surcharge_type', 'percentage'));
        TinyAssert::same('standard', WC_Twoinc_Payment_Terms::resolve_surcharge_tax_treatment($legacy)['treatment']);

        // A shop that enabled surcharges BEFORE the treatment field existed
        // (enabled type, no stored treatment) keeps the pre-feature runtime
        // behaviour: the resolver degrades '' to 'standard' — checkout is
        // never blocked by the new admin rule.
        $prefeature = self::surchargeFeeGateway(['surcharge_type' => 'percentage']);
        TinyAssert::same('standard', WC_Twoinc_Payment_Terms::resolve_surcharge_tax_treatment($prefeature)['treatment']);
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

    private static function testEnvironmentModeNormalisesStoredCheckoutEnv(): void
    {
        $cases = [
            ['', 'production'],
            ['PROD', 'production'],
            ['Production', 'production'],
            ['SANDBOX', 'sandbox'],
            ['staging', 'staging'],
            // Outside the allowlist -> production (the pre-template host for
            // every unrecognised value). The mode splices into the API
            // hostname, so hostile admin input must not steer it off-domain.
            ['evil.example/', 'production'],
            ['api.evil.example/#', 'production'],
            ['foo', 'production'],
        ];
        foreach ($cases as [$stored, $expected]) {
            $gateway = self::soleTraderGateway(['checkout_env' => $stored], []);
            TinyAssert::same($expected, WC_Twoinc_Helper::get_environment_mode($gateway), $stored ?: '(empty)');
        }
    }

    private static function testEnvironmentHostFollowsModeAndBrandTemplate(): void
    {
        // Two brand (default): production drops the mode suffix.
        $gateway = self::soleTraderGateway([], []);
        TinyAssert::same('https://api.two.inc', WC_Twoinc_Helper::get_environment_host('api', $gateway));

        $gateway = self::soleTraderGateway(['checkout_env' => 'SANDBOX'], []);
        TinyAssert::same('https://api.sandbox.two.inc', WC_Twoinc_Helper::get_environment_host('api', $gateway));

        $gateway = self::soleTraderGateway(['checkout_env' => 'staging'], []);
        TinyAssert::same('https://api.staging.two.inc', WC_Twoinc_Helper::get_environment_host('api', $gateway));
        TinyAssert::same('https://checkout.staging.two.inc', WC_Twoinc_Helper::get_environment_host('checkout', $gateway));

        // A brand overlay's template carries the brand's own domain.
        WC_Twoinc_Brand::reset();
        self::useTestbrand();
        TinyAssert::same(
            'https://api.staging.testbrand.example',
            WC_Twoinc_Helper::get_environment_host('api', $gateway)
        );
    }

    private static function testCheckoutHostPrefersExplicitModeOverDevSniffing(): void
    {
        $make = static function (array $options) {
            return new class ($options) extends WC_Twoinc {
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
        };

        // Non-dev hostname, default mode: production host.
        $GLOBALS['test_home_url'] = 'https://shop.merchant.example';
        TinyAssert::same('https://api.two.inc', $make([])->get_twoinc_checkout_host());

        // Dev-sniffed hostname (*.staging.two.inc) with the default mode:
        // legacy behaviour, the configured test host wins.
        $GLOBALS['test_home_url'] = 'https://woocom.staging.two.inc';
        TinyAssert::same(
            'https://api.staging.example',
            $make(['test_checkout_host' => 'https://api.staging.example'])->get_twoinc_checkout_host()
        );

        // An explicit mode beats the sniffer — even on a dev hostname.
        TinyAssert::same(
            'https://api.staging.two.inc',
            $make(['checkout_env' => 'staging', 'test_checkout_host' => 'https://api.staging.example'])->get_twoinc_checkout_host()
        );

        // Non-dev brand shop with explicit staging mode: no sniffing needed.
        $GLOBALS['test_home_url'] = 'https://brand-shop.staging.brand.example';
        TinyAssert::same('https://api.staging.two.inc', $make(['checkout_env' => 'staging'])->get_twoinc_checkout_host());
    }

    private static function testCheckoutEnvOptionsPreserveStoredModeWithoutSettingsApi(): void
    {
        // The options builder must read the raw settings row, never
        // WC_Settings_API::get_option — that path re-enters
        // init_form_fields() on installs missing the key (fresh installs)
        // and recurses. The stub gateway would mask that, so assert the
        // read goes through the wp option instead.
        $gateway = new class () extends WC_Twoinc {
            public function __construct()
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
            }
            public function get_option($key, $empty_value = null)
            {
                throw new RuntimeException('settings API consulted from options builder');
            }
        };
        $key = $gateway->get_option_key();

        // Fresh install: no settings row at all.
        TinyAssert::same(['PROD', 'SANDBOX'], array_keys($gateway->get_checkout_env_options()));

        // Stored custom allowlisted mode is preserved as an option.
        $GLOBALS['__twoinc_test_options'][$key] = ['checkout_env' => 'staging'];
        TinyAssert::same(['PROD', 'SANDBOX', 'staging'], array_keys($gateway->get_checkout_env_options()));

        // Garbage is NOT perpetuated as a selectable option.
        $GLOBALS['__twoinc_test_options'][$key] = ['checkout_env' => 'evil.example/'];
        TinyAssert::same(['PROD', 'SANDBOX'], array_keys($gateway->get_checkout_env_options()));
    }

    // ── Invoice download state check (TWO-25041) ────────────────────

    /**
     * Gateway fake for the invoice-download flow: make_request pops queued
     * responses per endpoint prefix (so the retry can see a different
     * response than the first fetch) and logs every call with its params
     * and timeout.
     */
    private static function invoiceGateway(array $responses): WC_Twoinc
    {
        return new class ($responses) extends WC_Twoinc {
            private $responses;
            public $requests = [];

            public function __construct($responses)
            {
                $this->responses = $responses;
            }

            public function get_option($key, $empty_value = null)
            {
                return $empty_value ?? '';
            }

            public function make_request($endpoint, $payload = [], $method = 'POST', $params = [], $api_key_override = null, $timeout = 30)
            {
                $this->requests[] = ['endpoint' => $endpoint, 'params' => $params, 'timeout' => $timeout];
                foreach ($this->responses as $prefix => &$queue) {
                    if (strpos($endpoint, $prefix) === 0) {
                        return count($queue) > 1 ? array_shift($queue) : $queue[0];
                    }
                }
                return new WP_Error();
            }
        };
    }

    private static function invoiceOrder(): StubOrder
    {
        $order = new StubOrder();
        $order->meta[WC_Twoinc_Brand::prefixed_name('order_id')] = 'two-order-id';
        return $order;
    }

    private static function pdfOk(): array
    {
        return ['response' => ['code' => 200], 'body' => '%PDF-1.4 test'];
    }

    private static function notFulfilled(): array
    {
        return ['response' => ['code' => 400], 'body' => json_encode(['error_code' => 'ORDER_NOT_FULFILLED'])];
    }

    private static function orderState(string $state): array
    {
        return ['response' => ['code' => 200], 'body' => json_encode(['state' => $state])];
    }

    private static function invoiceCallCount($gateway): int
    {
        return count(array_filter($gateway->requests, static function ($r) {
            return strpos($r['endpoint'], '/v1/invoice/') === 0;
        }));
    }

    private static function testInvoiceDownloadStreamsPdf(): void
    {
        $gateway = self::invoiceGateway(['/v1/invoice/' => [self::pdfOk()]]);
        $result = $gateway->resolve_invoice_download(self::invoiceOrder(), 'original');
        TinyAssert::same('stream', $result['action']);
        TinyAssert::same('%PDF-1.4 test', $result['body']);
        // Straight-through success: one invoice fetch, no order-state fetch.
        TinyAssert::same(1, count($gateway->requests));
        TinyAssert::same('original', $gateway->requests[0]['params']['v']);
        // A blocking browser navigation chaining up to three serial calls:
        // must run on a tighter timeout than make_request's default 30s.
        TinyAssert::true($gateway->requests[0]['timeout'] < 30);
    }

    private static function testInvoiceDownloadFulfillingIsInfoNotice(): void
    {
        $gateway = self::invoiceGateway([
            '/v1/invoice/' => [self::notFulfilled()],
            '/v1/order/' => [self::orderState('FULFILLING')],
        ]);
        $result = $gateway->resolve_invoice_download(self::invoiceOrder(), 'original');
        TinyAssert::same('notice', $result['action']);
        TinyAssert::same('info', $result['level']);
        TinyAssert::true(strpos($result['message'], 'still being prepared') !== false);
        // No pointless retry while the order is still FULFILLING.
        TinyAssert::same(1, self::invoiceCallCount($gateway));
    }

    private static function testInvoiceDownloadFulfilledRetriesOnceThenStreams(): void
    {
        $gateway = self::invoiceGateway([
            '/v1/invoice/' => [self::notFulfilled(), self::pdfOk()],
            '/v1/order/' => [self::orderState('FULFILLED')],
        ]);
        $result = $gateway->resolve_invoice_download(self::invoiceOrder(), 'original');
        TinyAssert::same('stream', $result['action']);
        TinyAssert::same(2, self::invoiceCallCount($gateway));
    }

    private static function testInvoiceDownloadFulfilledRetryFailureIsError(): void
    {
        $gateway = self::invoiceGateway([
            '/v1/invoice/' => [self::notFulfilled(), self::notFulfilled()],
            '/v1/order/' => [self::orderState('FULFILLED')],
        ]);
        $result = $gateway->resolve_invoice_download(self::invoiceOrder(), 'original');
        TinyAssert::same('notice', $result['action']);
        TinyAssert::same('error', $result['level']);
        // The terminal message surfaces the API error_code, not only the
        // bare HTTP code (get_twoinc_error_msg's generic 400 string).
        TinyAssert::true(strpos($result['message'], 'ORDER_NOT_FULFILLED') !== false);
        // Retried exactly once.
        TinyAssert::same(2, self::invoiceCallCount($gateway));
    }

    private static function testInvoiceDownloadOtherStateNamesState(): void
    {
        $gateway = self::invoiceGateway([
            '/v1/invoice/' => [self::notFulfilled()],
            '/v1/order/' => [self::orderState('CANCELLED')],
        ]);
        $result = $gateway->resolve_invoice_download(self::invoiceOrder(), 'original');
        TinyAssert::same('notice', $result['action']);
        TinyAssert::same('info', $result['level']);
        TinyAssert::true(strpos($result['message'], 'CANCELLED') !== false);
        TinyAssert::same(1, self::invoiceCallCount($gateway));
    }

    private static function testInvoiceDownloadOtherErrorKeepsTodayBehaviour(): void
    {
        $gateway = self::invoiceGateway([
            '/v1/invoice/' => [['response' => ['code' => 403], 'body' => json_encode(['error_code' => 'FORBIDDEN'])]],
        ]);
        $result = $gateway->resolve_invoice_download(self::invoiceOrder(), 'original');
        TinyAssert::same('notice', $result['action']);
        TinyAssert::same('error', $result['level']);
        TinyAssert::true(strpos($result['message'], 'FORBIDDEN') !== false);
        // Errors other than ORDER_NOT_FULFILLED never trigger the
        // order-state fetch: today's terminal path, unchanged.
        TinyAssert::same(1, count($gateway->requests));
    }

    private static function testInvoiceDownloadMissingOrderIdIsError(): void
    {
        $gateway = self::invoiceGateway([]);
        $result = $gateway->resolve_invoice_download(new StubOrder(), 'original');
        TinyAssert::same('notice', $result['action']);
        TinyAssert::same('error', $result['level']);
        // Never call the API with an empty order id.
        TinyAssert::same(0, count($gateway->requests));
    }

    private static function testInvoiceDownload200NonPdfIsError(): void
    {
        $gateway = self::invoiceGateway([
            '/v1/invoice/' => [['response' => ['code' => 200], 'body' => json_encode(['unexpected' => 'json'])]],
        ]);
        $result = $gateway->resolve_invoice_download(self::invoiceOrder(), 'original');
        // A 200 that is not a PDF must not be streamed as a .pdf.
        TinyAssert::same('notice', $result['action']);
        TinyAssert::same('error', $result['level']);
    }

    private static function testInvoiceDownloadCreditNoteOmitsVOriginal(): void
    {
        $gateway = self::invoiceGateway(['/v1/invoice/' => [self::pdfOk()]]);
        $result = $gateway->resolve_invoice_download(self::invoiceOrder(), 'credit_note');
        TinyAssert::same('stream', $result['action']);
        TinyAssert::same(false, array_key_exists('v', $gateway->requests[0]['params']));
        TinyAssert::true(strpos($result['filename'], 'credit-note') !== false);
    }

    /**
     * A StubOrder that is a Two order (payment method matches the brand
     * gateway id) with a Two order-id meta, registered as wc_get_order(42).
     */
    private static function registerTwoOrder(): StubOrder
    {
        $order = self::invoiceOrder();
        $order->payment_method = WC_Twoinc_Brand::get('gateway_id');
        $GLOBALS['__twoinc_test_wc_orders'] = [42 => $order];
        return $order;
    }

    private static function runDownloadHandler(): string
    {
        try {
            WC_Twoinc::ajax_download_invoice();
        } catch (RuntimeException $e) {
            return $e->getMessage();
        }
        return '';
    }

    private static function withGatewayInstance(WC_Twoinc $gateway, callable $fn)
    {
        $prop = new ReflectionProperty(WC_Twoinc::class, 'instance');
        $prop->setAccessible(true);
        $prop->setValue(null, $gateway);
        try {
            return $fn();
        } finally {
            $prop->setValue(null, null);
        }
    }

    private static function testInvoiceDownloadCapabilityGate(): void
    {
        $_GET['_wpnonce'] = 'test';
        $_GET['order_id'] = '42';
        $_GET['variant'] = 'original';

        // The order lookup runs before the capability gate: an unknown
        // order 404s regardless of capabilities.
        $GLOBALS['__twoinc_test_caps'] = [];
        $GLOBALS['__twoinc_test_object_caps'] = [];
        $GLOBALS['__twoinc_test_wc_orders'] = [];
        TinyAssert::true(strpos(self::runDownloadHandler(), 'Order not found') !== false);

        // The gate is the per-order meta capability: holding the blanket
        // edit_shop_orders type capability but NOT edit_shop_order on this
        // specific order (multi-vendor / restricted-visibility plugins hook
        // the meta-cap) must be denied.
        self::registerTwoOrder();
        $GLOBALS['__twoinc_test_caps'] = ['edit_shop_orders'];
        $GLOBALS['__twoinc_test_object_caps'] = ['edit_shop_order:41'];
        $message = self::runDownloadHandler();
        TinyAssert::true(strpos($message, 'not allowed') !== false, 'expected wp_die without per-order edit_shop_order');

        // With the per-order grant the gate passes: the handler proceeds to
        // the API call (WP_Error here → error notice) and redirects back to
        // the order edit screen with the notice parked in a transient.
        $GLOBALS['__twoinc_test_object_caps'] = ['edit_shop_order:42'];
        $GLOBALS['__twoinc_test_transients'] = [];
        $message = self::withGatewayInstance(self::invoiceGateway([]), function () {
            return self::runDownloadHandler();
        });
        TinyAssert::true(strpos($message, 'redirect:') === 0, 'per-order grant must pass the gate and redirect');
        TinyAssert::true(isset($GLOBALS['__twoinc_test_transients']['twoinc_invoice_notice_1_42']), 'notice transient must be keyed by user AND order');

        unset($_GET['_wpnonce'], $_GET['order_id'], $_GET['variant']);
        unset($GLOBALS['__twoinc_test_caps'], $GLOBALS['__twoinc_test_object_caps'], $GLOBALS['__twoinc_test_wc_orders'], $GLOBALS['__twoinc_test_transients']);
    }

    private static function testInvoiceDownloadNonceScopedToOrderAndVariant(): void
    {
        // Mint side: the order-screen download button.
        $order = self::registerTwoOrder();
        $GLOBALS['__twoinc_test_nonce_url_actions'] = [];
        ob_start();
        self::invoiceGateway([])->add_invoice_credit_note_urls($order);
        ob_end_clean();
        TinyAssert::same(['twoinc_download_invoice_42_original'], $GLOBALS['__twoinc_test_nonce_url_actions']);

        // Verify side: the ajax handler checks the SAME order+variant-scoped
        // action — not the shared twoinc_admin_nonce the XHR handlers use.
        $_GET['_wpnonce'] = 'test';
        $_GET['order_id'] = '42';
        $_GET['variant'] = 'original';
        $GLOBALS['__twoinc_test_caps'] = [];
        $GLOBALS['__twoinc_test_object_caps'] = [];
        $GLOBALS['__twoinc_test_referer_actions'] = [];
        self::runDownloadHandler();
        TinyAssert::same(['twoinc_download_invoice_42_original'], $GLOBALS['__twoinc_test_referer_actions']);

        unset($_GET['_wpnonce'], $_GET['order_id'], $_GET['variant']);
        unset($GLOBALS['__twoinc_test_caps'], $GLOBALS['__twoinc_test_object_caps'], $GLOBALS['__twoinc_test_wc_orders']);
        unset($GLOBALS['__twoinc_test_nonce_url_actions'], $GLOBALS['__twoinc_test_referer_actions']);
    }

    private static function testInvoiceDownloadNoticeIsolatedPerOrder(): void
    {
        // The renderer must be STATIC: it is registered on admin_notices in
        // load_twoinc_classes() (plugins_loaded), not the gateway
        // constructor — on the order edit screen the gateway is only
        // constructed during the metabox render, AFTER admin_notices has
        // fired, so a constructor registration silently never renders the
        // notice (the TWO-25041 "button does nothing" bug).
        TinyAssert::true(
            (new ReflectionMethod(WC_Twoinc::class, 'render_invoice_download_notice'))->isStatic(),
            'render_invoice_download_notice must be static so plugins_loaded can register it without a gateway instance'
        );

        $GLOBALS['__twoinc_test_transients'] = [
            'twoinc_invoice_notice_1_42' => ['level' => 'info', 'message' => 'notice for order 42'],
            'twoinc_invoice_notice_1_43' => ['level' => 'error', 'message' => 'notice for order 43'],
        ];

        $render = static function () {
            ob_start();
            WC_Twoinc::render_invoice_download_notice();
            return ob_get_clean();
        };

        // No resolvable order id on the current screen: render nothing,
        // consume nothing (no leaking onto unrelated wp-admin pages).
        TinyAssert::same('', $render());
        TinyAssert::same(2, count($GLOBALS['__twoinc_test_transients']));

        // HPOS order edit screen for order 42: only order 42's notice
        // renders and only its transient is consumed.
        $_GET['page'] = 'wc-orders';
        $_GET['id'] = '42';
        $out = $render();
        TinyAssert::true(strpos($out, 'notice for order 42') !== false);
        TinyAssert::true(strpos($out, 'notice for order 43') === false, 'order B notice must not leak to order A screen');
        TinyAssert::true(!isset($GLOBALS['__twoinc_test_transients']['twoinc_invoice_notice_1_42']));
        TinyAssert::true(isset($GLOBALS['__twoinc_test_transients']['twoinc_invoice_notice_1_43']));
        unset($_GET['page'], $_GET['id']);

        // Legacy (post.php?post=N) order edit screen for order 43.
        $_GET['post'] = '43';
        $out = $render();
        TinyAssert::true(strpos($out, 'notice for order 43') !== false);
        TinyAssert::same(0, count($GLOBALS['__twoinc_test_transients']));
        unset($_GET['post']);

        unset($GLOBALS['__twoinc_test_transients']);
    }

    private static function testInvoiceStreamFilenameSanitizesOrderId(): void
    {
        $gateway = self::invoiceGateway(['/v1/invoice/' => [self::pdfOk()]]);
        $order = new StubOrder();
        $order->meta[WC_Twoinc_Brand::prefixed_name('order_id')] = 'ab"c;d e/f.pdf';
        $result = $gateway->resolve_invoice_download($order, 'original');
        TinyAssert::same('stream', $result['action']);
        // Raw meta lands in a quoted Content-Disposition filename: anything
        // outside [A-Za-z0-9_-] must be stripped.
        TinyAssert::true(strpos($result['filename'], 'abcdefpdf.pdf') !== false);
        TinyAssert::same(false, strpbrk($result['filename'], '";/ ') !== false, 'filename must not carry quote/semicolon/slash/space');
    }

    // ── Negative-discount guard (TWO-25097) ─────────────────────────

    private static function testNegativeDiscountGuardPassesLegitimateDiscount(): void
    {
        // (a) A legitimate positive discount passes through untouched.
        $line_item = new StubProductLineItem([
            'name' => 'Discounted widget',
            'line_subtotal' => 100.0,
            'line_total' => 90.0,
            'line_tax' => 22.5,
            'quantity' => 2,
        ]);

        $items = WC_Twoinc_Helper::get_line_items([$line_item], [], [], new StubOrder());

        TinyAssert::same(1, count($items));
        TinyAssert::same('10.00', $items[0]['discount_amount']);
        TinyAssert::same('90.00', $items[0]['net_amount']);

        // Order-level surface: zero discount composes as plain '0.00'.
        $body = self::composeOrder();
        TinyAssert::same('0.00', $body['discount_amount']);

        // Order-level surface: a positive total discount passes untouched
        // through both compose bodies.
        $order = new class extends StubOrder {
            public function get_total_discount()
            {
                return 12.5;
            }
        };
        $body = WC_Twoinc_Helper::compose_twoinc_order($order, 'test-order-reference', '912345678', 'IT', 'Project X', '', []);
        TinyAssert::same('12.50', $body['discount_amount']);
        $body = WC_Twoinc_Helper::compose_twoinc_edit_order($order, 'IT', 'Project X', '', '');
        TinyAssert::same('12.50', $body['discount_amount']);
    }

    private static function testNegativeDiscountGuardThrowsOnNegativeLineDiscount(): void
    {
        // (b) A genuinely negative line discount fails loud with a clear
        // message — never silently clamped to zero.
        $line_item = new StubProductLineItem([
            'name' => 'Broken widget',
            'line_subtotal' => 90.0,
            'line_total' => 100.0,
        ]);

        $thrown = null;
        try {
            WC_Twoinc_Helper::get_line_items([$line_item], [], [], new StubOrder());
        } catch (Exception $e) {
            $thrown = $e;
        }

        TinyAssert::true($thrown instanceof Exception, 'negative line discount must throw');
        TinyAssert::true(
            strpos($thrown->getMessage(), 'Negative discount amount calculated') !== false,
            'exception must name the negative-discount failure'
        );
        TinyAssert::true(
            strpos($thrown->getMessage(), 'Broken widget') !== false,
            'exception must identify the offending product'
        );
    }

    private static function testNegativeDiscountGuardThrowsOnNegativeOrderDiscount(): void
    {
        // (b) Order-level surfaces: both compose bodies guard
        // get_total_discount().
        $order = new class extends StubOrder {
            public function get_total_discount()
            {
                return -5.0;
            }
        };

        $thrown = null;
        try {
            WC_Twoinc_Helper::compose_twoinc_order($order, 'test-order-reference', '912345678', 'IT', 'Project X', '', []);
        } catch (Exception $e) {
            $thrown = $e;
        }
        TinyAssert::true($thrown instanceof Exception, 'negative order discount must fail order create');
        TinyAssert::true(
            strpos($thrown->getMessage(), 'Negative discount amount calculated') !== false,
            'create exception must name the negative-discount failure'
        );

        $thrown = null;
        try {
            WC_Twoinc_Helper::compose_twoinc_edit_order($order, 'IT', 'Project X', '', '');
        } catch (Exception $e) {
            $thrown = $e;
        }
        TinyAssert::true($thrown instanceof Exception, 'negative order discount must fail order edit');
    }

    private static function testNegativeDiscountGuardNoFalsePositiveFromEarlyRounding(): void
    {
        // (c) Rounding-order regression (the PrestaShop TWO-24741 round-1
        // finding): a native-precision difference that only goes negative
        // if the operands are rounded early must NOT false-positive.
        //
        // 25.024 - 25.026 = -0.002 at native precision, which rounds to
        // zero at the payload boundary. Rounding the operands first gives
        // 25.02 - 25.03 = -0.01, a phantom negative that would fire the
        // fail-loud throw on a legitimate cart.
        $line_item = new StubProductLineItem([
            'name' => 'Residue widget',
            'line_subtotal' => 25.024,
            'line_total' => 25.026,
        ]);

        $items = WC_Twoinc_Helper::get_line_items([$line_item], [], [], new StubOrder());

        TinyAssert::same(1, count($items));
        // Once-rounded sub-cent residue is zero — and plain '0.00', never
        // a negative-zero '-0.00' artefact in the payload.
        TinyAssert::same('0.00', $items[0]['discount_amount']);

        // Same shape at the order level: sub-cent float residue in
        // get_total_discount() must not fail checkout.
        $order = new class extends StubOrder {
            public function get_total_discount()
            {
                return -0.002;
            }
        };
        $body = WC_Twoinc_Helper::compose_twoinc_order($order, 'test-order-reference', '912345678', 'IT', 'Project X', '', []);
        TinyAssert::same('0.00', $body['discount_amount']);
    }

    private static function testNegativeDiscountGuardSkipsRefundLineItems(): void
    {
        // Refund bodies carry NEGATED line amounts: refunding a discounted
        // line gives e.g. -100 - (-90) = -10, a legitimately negative
        // discount diff. The guard must not fire there — refund behaviour
        // is unchanged (compose_twoinc_refund passes is_refund = true).
        $line_item = new StubProductLineItem([
            'name' => 'Refunded widget',
            'line_subtotal' => -100.0,
            'line_total' => -90.0,
            'line_tax' => -22.5,
        ]);

        $items = WC_Twoinc_Helper::get_line_items([$line_item], [], [], new StubOrder(), true);

        TinyAssert::same(1, count($items));
        TinyAssert::same('-10.00', $items[0]['discount_amount']);
    }

    // ── FX conversion layer (TWO-25104) ────────────────────────────────

    /**
     * Gateway fake for the FX layer: injectable platform minimum and
     * options, canned /refdata/v1/fx-rates responses consumed as a queue
     * (last entry sticky), and a request counter for over-fetch
     * assertions. Any other endpoint errors — the FX layer must never
     * stray off its own endpoint.
     */
    private static function fxGateway(?array $platform_minimum, array $fx_responses, array $options = []): WC_Twoinc
    {
        return new class ($platform_minimum, $fx_responses, $options) extends WC_Twoinc {
            private $test_platform_minimum;
            private $fx_responses;
            private $options;
            public $fx_requests = 0;

            public function __construct($platform_minimum, $fx_responses, $options)
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
                $this->test_platform_minimum = $platform_minimum;
                $this->fx_responses = $fx_responses;
                $this->options = $options;
            }

            public function get_option($key, $empty_value = null)
            {
                return $this->options[$key] ?? $empty_value ?? '';
            }

            public function get_platform_minimum_order()
            {
                return $this->test_platform_minimum;
            }

            public function get_merchant_available_terms(bool $refresh = false): array
            {
                return [14, 30, 60, 90];
            }

            public function make_request($endpoint, $payload = [], $method = 'POST', $params = [], $api_key_override = null, $timeout = 30)
            {
                if (strpos($endpoint, '/refdata/v1/fx-rates') !== 0) {
                    return new WP_Error();
                }
                $this->fx_requests++;
                if (count($this->fx_responses) > 1) {
                    return array_shift($this->fx_responses);
                }
                return $this->fx_responses[0] ?? new WP_Error();
            }
        };
    }

    private static function fxOk(array $rates, string $as_of = '2026-07-14'): array
    {
        return [
            'response' => ['code' => 200],
            'body' => json_encode(['base' => 'EUR', 'as_of' => $as_of, 'rates' => $rates]),
        ];
    }

    /** The EUR-pivot fixture: 1 NOK = 0.085 EUR, 1 SEK = 0.088 EUR. */
    private const FX_TABLE = ['NOK' => 0.085, 'SEK' => 0.088];

    /**
     * Age the stored FX table past the freshness window on BOTH signals
     * (the freshness transient and the durable fetched_at fallback that
     * covers object-cache eviction of the transient) — simulates "6h+
     * later" for tests that need a genuinely stale table, as opposed to
     * merely an evicted transient.
     */
    private static function ageStoredFxTable(): void
    {
        delete_transient(WC_Twoinc_FX::fresh_transient_key());
        $raw = $GLOBALS['__twoinc_test_options'][WC_Twoinc_FX::option_key()] ?? null;
        TinyAssert::true($raw !== null, 'ageStoredFxTable requires a table already stored');
        $table = json_decode($raw, true);
        $table['fetched_at'] = time() - WC_Twoinc_FX::REFRESH_INTERVAL - WC_Twoinc_FX::FRESHNESS_GRACE - 1;
        $GLOBALS['__twoinc_test_options'][WC_Twoinc_FX::option_key()] = json_encode($table);
    }

    private static function assertClose(float $expected, $actual, string $message = ''): void
    {
        TinyAssert::true(
            is_float($actual) && abs($expected - $actual) < 1e-9,
            $message !== '' ? $message : 'Expected ~' . $expected . ', got ' . var_export($actual, true)
        );
    }

    private static function testFxSameCurrencyShortCircuitsWithoutNetwork(): void
    {
        // Same-currency conversion is identity and must not touch the
        // cache or the network — single-currency stores never pay for FX.
        $gateway = self::fxGateway(null, []);
        TinyAssert::same(1.0, WC_Twoinc_FX::get_rate($gateway, 'EUR', 'EUR'));
        TinyAssert::same(1.0, WC_Twoinc_FX::get_rate($gateway, 'nok', 'NOK'));
        TinyAssert::same(0, $gateway->fx_requests);
    }

    private static function testFxCrossRatesFromEurPivotTable(): void
    {
        $gateway = self::fxGateway(null, [self::fxOk(self::FX_TABLE)]);

        // Cross rate through the EUR pivot: units of `to` per one `from`
        // is eur_value(from) / eur_value(to) — the endpoint's own formula.
        self::assertClose(0.085 / 0.088, WC_Twoinc_FX::get_rate($gateway, 'NOK', 'SEK'));
        // The base itself is 1 by definition, in both directions.
        self::assertClose(1 / 0.085, WC_Twoinc_FX::get_rate($gateway, 'EUR', 'NOK'));
        self::assertClose(0.085, WC_Twoinc_FX::get_rate($gateway, 'NOK', 'EUR'));
        // The whole table arrived on one fetch: no per-pair requests.
        TinyAssert::same(1, $gateway->fx_requests);
        // convert() is rate * amount, unrounded.
        self::assertClose(100 * 0.085, WC_Twoinc_FX::convert($gateway, 100.0, 'NOK', 'EUR'));
    }

    private static function testFxFreshCacheServesAcrossRequestsWithoutRefetch(): void
    {
        $gateway = self::fxGateway(null, [self::fxOk(self::FX_TABLE)]);
        WC_Twoinc_FX::get_rate($gateway, 'NOK', 'EUR');
        TinyAssert::same(1, $gateway->fx_requests);
        TinyAssert::same('2026-07-14', WC_Twoinc_FX::get_as_of($gateway));

        // A new PHP request (request memo gone) within the 6h freshness
        // window is served from the stored table — no HTTP.
        WC_Twoinc_FX::reset_request_cache();
        self::assertClose(0.085, WC_Twoinc_FX::get_rate($gateway, 'NOK', 'EUR'));
        TinyAssert::same(1, $gateway->fx_requests);
    }

    private static function testFxStaleRefreshFailureFallsBackToLastKnownGood(): void
    {
        // Seed the durable cache.
        $seeder = self::fxGateway(null, [self::fxOk(self::FX_TABLE)]);
        WC_Twoinc_FX::get_rate($seeder, 'NOK', 'EUR');

        // 6h later (freshness transient lapsed) the rates API is down: the
        // refresh attempt fails and conversion falls back to the stored
        // last-known-good table rather than flapping to null.
        WC_Twoinc_FX::reset_request_cache();
        self::ageStoredFxTable();
        $failing = self::fxGateway(null, [new WP_Error()]);
        self::assertClose(0.085, WC_Twoinc_FX::get_rate($failing, 'NOK', 'EUR'));
        TinyAssert::same(1, $failing->fx_requests);

        // The failure arms the retry throttle: the next request cycle must
        // not hammer the API again.
        WC_Twoinc_FX::reset_request_cache();
        self::assertClose(0.085, WC_Twoinc_FX::get_rate($failing, 'NOK', 'EUR'));
        TinyAssert::same(1, $failing->fx_requests);
    }

    private static function testFxMalformedResponsesAreRejected(): void
    {
        // Non-JSON body.
        $gateway = self::fxGateway(null, [['response' => ['code' => 200], 'body' => 'not json']]);
        TinyAssert::same(null, WC_Twoinc_FX::get_rate($gateway, 'NOK', 'EUR'));

        // Rates present but all garbage (zero/negative/non-numeric) — a
        // poisoned table must not be stored as last-known-good.
        WC_Twoinc_FX::reset_request_cache();
        $gateway = self::fxGateway(null, [[
            'response' => ['code' => 200],
            'body' => json_encode(['base' => 'EUR', 'rates' => ['NOK' => 0, 'SEK' => -1, 'DKK' => 'x']]),
        ]]);
        TinyAssert::same(null, WC_Twoinc_FX::get_rate($gateway, 'NOK', 'EUR'));
        TinyAssert::same(false, get_option(WC_Twoinc_FX::option_key()));

        // Non-2xx.
        WC_Twoinc_FX::reset_request_cache();
        $gateway = self::fxGateway(null, [['response' => ['code' => 500], 'body' => '']]);
        TinyAssert::same(null, WC_Twoinc_FX::get_rate($gateway, 'NOK', 'EUR'));
    }

    private static function testFxUncachedCurrencyRefetchesOnceThenConcludes(): void
    {
        // Seed a STALE table (freshness transient expired) that carries
        // NOK but not DKK: a currency missing from a stale table is
        // inconclusive (a newer fetch might carry it), so one live
        // re-fetch is worth it before giving up.
        $seeder = self::fxGateway(null, [self::fxOk(['NOK' => 0.085])]);
        WC_Twoinc_FX::get_rate($seeder, 'NOK', 'EUR');
        self::ageStoredFxTable();

        WC_Twoinc_FX::reset_request_cache();
        $gateway = self::fxGateway(null, [self::fxOk(['NOK' => 0.085, 'DKK' => 0.134])]);
        self::assertClose(0.134 / 0.085, WC_Twoinc_FX::get_rate($gateway, 'DKK', 'NOK'));
        TinyAssert::same(1, $gateway->fx_requests);

        // A currency still absent after that re-fetch is genuinely
        // unsupported: null, and no further request in the same cycle.
        TinyAssert::same(null, WC_Twoinc_FX::get_rate($gateway, 'XXX', 'NOK'));
        TinyAssert::same(1, $gateway->fx_requests);
    }

    private static function testFxFreshTableMissingCurrencyDoesNotRefetch(): void
    {
        // The bug three reviewers converged on: a currency missing from a
        // table that is ALREADY FRESH must not trigger a re-fetch. The
        // endpoint always returns its complete table, so "fresh but
        // missing DKK" already conclusively means DKK is unsupported —
        // re-fetching would repeat that same conclusion on every request
        // for every buyer in that currency (an unbounded synchronous-fetch
        // loop disguised as a cache).
        $seeder = self::fxGateway(null, [self::fxOk(['NOK' => 0.085])]);
        WC_Twoinc_FX::get_rate($seeder, 'NOK', 'EUR');

        WC_Twoinc_FX::reset_request_cache();
        $gateway = self::fxGateway(null, [self::fxOk(['NOK' => 0.085, 'DKK' => 0.134])]);
        TinyAssert::same(null, WC_Twoinc_FX::get_rate($gateway, 'DKK', 'NOK'));
        TinyAssert::same(0, $gateway->fx_requests, 'a fresh table must not be re-fetched for a currency it conclusively lacks');

        // Across many simulated requests in the same unsupported
        // currency, still zero fetches — this was the reproduced
        // per-request fetch storm.
        for ($i = 0; $i < 5; $i++) {
            WC_Twoinc_FX::reset_request_cache();
            TinyAssert::same(null, WC_Twoinc_FX::get_rate($gateway, 'DKK', 'NOK'));
        }
        TinyAssert::same(0, $gateway->fx_requests);
    }

    private static function testFxCorruptedStoredTableIsRejectedNotFatal(): void
    {
        // A table can reach wp_options by a route other than fetch_table
        // (a DB import, an older/newer plugin version's shape, manual
        // editing). A poisoned rate — zero, negative, or non-numeric —
        // must be dropped on read, not divided against: reproduced as a
        // DivisionByZeroError before the fix.
        $GLOBALS['__twoinc_test_options'][WC_Twoinc_FX::option_key()] = json_encode([
            'base' => 'EUR',
            'rates' => ['NOK' => 0, 'SEK' => -1, 'DKK' => 'not-a-number'],
            'as_of' => '2026-07-14',
            'fetched_at' => time(),
        ]);
        $gateway = self::fxGateway(null, []);
        TinyAssert::same(null, WC_Twoinc_FX::get_rate($gateway, 'NOK', 'EUR'));
        TinyAssert::same(null, WC_Twoinc_FX::get_rate($gateway, 'SEK', 'DKK'));

        // A valid entry alongside garbage entries is still usable — only
        // the poisoned keys are dropped, not the whole table.
        $GLOBALS['__twoinc_test_options'][WC_Twoinc_FX::option_key()] = json_encode([
            'base' => 'EUR',
            'rates' => ['NOK' => 0.085, 'SEK' => -1],
            'as_of' => '2026-07-14',
            'fetched_at' => time(),
        ]);
        WC_Twoinc_FX::reset_request_cache();
        self::assertClose(0.085, WC_Twoinc_FX::get_rate(self::fxGateway(null, []), 'NOK', 'EUR'));
    }

    private static function testFxDuplicateScheduleGuardedByUniqueFlag(): void
    {
        // Two concurrent requests in the cold state (nothing scheduled
        // yet) both observe "not scheduled" before either schedules — the
        // has-scheduled-action check is not atomic with the schedule
        // call. $unique = true is what prevents a duplicate recurring
        // series from being created; assert it is actually passed.
        WC_Twoinc_FX::maybe_schedule_refresh();
        TinyAssert::same(1, count($GLOBALS['__twoinc_test_as_schedule_calls']));
        TinyAssert::same(true, $GLOBALS['__twoinc_test_as_schedule_calls'][0]['unique']);
        TinyAssert::same(WC_Twoinc_FX::refresh_hook(), $GLOBALS['__twoinc_test_as_schedule_calls'][0]['hook']);

        // Already scheduled: a second call is a no-op.
        WC_Twoinc_FX::maybe_schedule_refresh();
        TinyAssert::same(1, count($GLOBALS['__twoinc_test_as_schedule_calls']));
    }

    private static function testFxGateFailsClosedWhenNoRateEverFetched(): void
    {
        // Cross-currency basket, rates API down, nothing ever cached: the
        // basket cannot be proven to satisfy the funding partner's
        // minimum — the gateway is removed (fail closed, as before
        // TWO-25104, when any cross-currency basket failed closed).
        self::useTestbrand();
        WC()->cart = new StubCart(10000.0);
        WC()->customer = new StubCustomer('NL');
        $GLOBALS['__twoinc_test_currency'] = 'NOK';

        $gateway = self::fxGateway(self::EUR_250_NET, [new WP_Error()]);
        $result = $gateway->apply_brand_availability_gate(['woocommerce-gateway-testbrand' => 'gw']);
        TinyAssert::true(!isset($result['woocommerce-gateway-testbrand']));
    }

    private static function testFxGateConvertsBasketAcrossCurrencies(): void
    {
        // The cross-currency scenario the ticket demands: a NOK basket
        // judged against a EUR minimum via the endpoint rate. 250 EUR net
        // at 1 NOK = 0.085 EUR is 2941.18 NOK.
        self::useTestbrand();
        WC()->customer = new StubCustomer('NL');
        $GLOBALS['__twoinc_test_currency'] = 'NOK';
        $gateways = ['woocommerce-gateway-testbrand' => 'gw'];

        // 3000 NOK net → 255 EUR ≥ 250: offered.
        WC()->cart = new StubCart(3000.0);
        $gateway = self::fxGateway(self::EUR_250_NET, [self::fxOk(self::FX_TABLE)]);
        $result = $gateway->apply_brand_availability_gate($gateways);
        TinyAssert::same('gw', $result['woocommerce-gateway-testbrand']);

        // 2900 NOK net → 246.50 EUR < 250: removed.
        WC()->cart = new StubCart(2900.0);
        WC_Twoinc_FX::reset_request_cache();
        $result = $gateway->apply_brand_availability_gate($gateways);
        TinyAssert::true(!isset($result['woocommerce-gateway-testbrand']));
    }

    private static function testFxGateUsesLastKnownGoodOnApiFailure(): void
    {
        // A basket that passes on cached rates keeps passing while the
        // rates API is down — gates run on last-known-good, so a transient
        // outage never flaps the gateway off checkout.
        self::useTestbrand();
        WC()->customer = new StubCustomer('NL');
        $GLOBALS['__twoinc_test_currency'] = 'NOK';
        WC()->cart = new StubCart(3000.0);

        $seeder = self::fxGateway(null, [self::fxOk(self::FX_TABLE)]);
        WC_Twoinc_FX::get_rate($seeder, 'NOK', 'EUR');

        WC_Twoinc_FX::reset_request_cache();
        self::ageStoredFxTable();
        $gateway = self::fxGateway(self::EUR_250_NET, [new WP_Error()]);
        $result = $gateway->apply_brand_availability_gate(['woocommerce-gateway-testbrand' => 'gw']);
        TinyAssert::same('gw', $result['woocommerce-gateway-testbrand']);
    }

    private static function testFxMerchantMinimumJudgedAcrossCurrencies(): void
    {
        // The merchant's own minimum (store currency EUR) now judges a
        // NOK basket via FX instead of failing open on the mismatch.
        WC()->customer = new StubCustomer('NO');
        $GLOBALS['__twoinc_test_currency'] = 'NOK';
        $gateways = ['woocommerce-gateway-tillit' => 'gw'];

        // 6000 NOK → 510 EUR ≥ 500: offered.
        WC()->cart = new StubCart(6000.0);
        $gateway = self::fxGateway(null, [self::fxOk(self::FX_TABLE)], ['merchant_minimum_order' => '500']);
        $result = $gateway->apply_brand_availability_gate($gateways);
        TinyAssert::same('gw', $result['woocommerce-gateway-tillit']);

        // 5800 NOK → 493 EUR < 500: removed.
        WC()->cart = new StubCart(5800.0);
        WC_Twoinc_FX::reset_request_cache();
        $result = $gateway->apply_brand_availability_gate($gateways);
        TinyAssert::true(!isset($result['woocommerce-gateway-tillit']));

        // No rate ever fetched: fail closed (TWO-25104 semantics — the
        // pre-FX fail-open on the merchant's bar is gone; an unprovable
        // basket is not offered the gateway).
        $GLOBALS['__twoinc_test_options'] = [];
        $GLOBALS['__twoinc_test_transients'] = [];
        WC_Twoinc_FX::reset_request_cache();
        WC()->cart = new StubCart(6000.0);
        $gateway = self::fxGateway(null, [new WP_Error()], ['merchant_minimum_order' => '500']);
        $result = $gateway->apply_brand_availability_gate($gateways);
        TinyAssert::true(!isset($result['woocommerce-gateway-tillit']));
    }

    private static function testBuyerFeeShareConvertsFixedAndCapAcrossCurrencies(): void
    {
        // Fixed surcharge and cap are configured in the store currency
        // (EUR) and must reach the pricing request in the active checkout
        // currency (NOK) at the endpoint rate: 1 EUR = 1/0.085 NOK.
        $GLOBALS['__twoinc_test_currency'] = 'NOK';
        $gateway = self::fxGateway(null, [self::fxOk(self::FX_TABLE)], [
            'surcharge_type' => 'fixed_and_percentage',
            'surcharge_grid' => [30 => ['fixed' => 2.5, 'percentage' => 1.5, 'limit' => 10.0]],
        ]);

        $share = WC_Twoinc_Payment_Terms::build_buyer_fee_share($gateway, 30);
        TinyAssert::same(29.41, $share['surcharge'], 'fixed 2.50 EUR at 1/0.085 is 29.41 NOK');
        TinyAssert::same(117.65, $share['cap'], 'cap 10.00 EUR at 1/0.085 is 117.65 NOK');
        // The percentage component is currency-agnostic and untouched.
        TinyAssert::same(1.5, $share['percentage']);
    }

    private static function testBuyerFeeShareWithheldWhenNoRateAvailable(): void
    {
        // No rate ever fetched: a wrong-currency amount must never be
        // sent, so the whole surcharge is withheld for the quote (fail
        // soft to no fee — checkout is never blocked).
        $GLOBALS['__twoinc_test_currency'] = 'NOK';
        $gateway = self::fxGateway(null, [new WP_Error()], [
            'surcharge_type' => 'fixed_and_percentage',
            'surcharge_grid' => [30 => ['fixed' => 2.5, 'percentage' => 1.5, 'limit' => 10.0]],
        ]);
        TinyAssert::same(null, WC_Twoinc_Payment_Terms::build_buyer_fee_share($gateway, 30));
    }

    private static function testBuyerFeeShareSameCurrencyNeverTouchesFx(): void
    {
        // Regression pin for single-currency stores: amounts pass through
        // exactly as configured and the FX layer is never consulted.
        $gateway = self::fxGateway(null, [], [
            'surcharge_type' => 'fixed_and_percentage',
            'surcharge_grid' => [30 => ['fixed' => 2.5, 'percentage' => 1.5, 'limit' => 10.0]],
        ]);
        $share = WC_Twoinc_Payment_Terms::build_buyer_fee_share($gateway, 30);
        TinyAssert::same(2.5, $share['surcharge']);
        TinyAssert::same(10.0, $share['cap']);
        TinyAssert::same(0, $gateway->fx_requests);
    }

    private static function testBuyerFeeShareCapRoundingToZeroWithholdsWholeSurcharge(): void
    {
        // A cap configured in a strong store currency can round to 0.00
        // once converted into a much weaker checkout currency. Dropping
        // only the cap (as an earlier version of this code did) would
        // send the percentage fee UNCAPPED — the opposite of the
        // merchant's configuration — so the whole surcharge is withheld
        // instead, same as the no-rate-available case.
        $GLOBALS['__twoinc_test_currency'] = 'JPY';
        $gateway = self::fxGateway(null, [self::fxOk(['JPY' => 1000000.0])], [
            // Store currency EUR (default in these tests): a cap of 0.001
            // EUR converts to 1000000 * 0.001 = 1000 JPY... use an
            // absurdly weak rate the other way so the cap rounds to 0.
            'surcharge_type' => 'fixed_and_percentage',
            'surcharge_grid' => [30 => ['fixed' => 0.001, 'percentage' => 1.5, 'limit' => 0.001]],
        ]);
        TinyAssert::same(null, WC_Twoinc_Payment_Terms::build_buyer_fee_share($gateway, 30));
    }

    private static function testCartFeeSkippedOnQuoteCurrencyMismatch(): void
    {
        // The fee enters the basket at the pricing endpoint's output — a
        // response echoing a different currency than the cart's would land
        // as a raw number in the wrong money, so it is skipped.
        $gateway = new class () extends WC_Twoinc {
            public function __construct()
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
            }

            public function get_option($key, $empty_value = null)
            {
                $options = [
                    'surcharge_type' => 'percentage',
                    'payment_terms_days' => [30],
                    'surcharge_grid' => [30 => ['percentage' => 2.0]],
                ];
                return $options[$key] ?? $empty_value ?? '';
            }

            public function get_merchant_available_terms(bool $refresh = false): array
            {
                return [30, 60];
            }

            public function make_request($endpoint, $payload = [], $method = 'POST', $params = [], $api_key_override = null, $timeout = 30)
            {
                return [
                    'response' => ['code' => 200],
                    'body' => json_encode(['buyer_fee_share' => '12.50', 'currency' => 'GBP']),
                ];
            }
        };
        self::withGatewayInstance($gateway, static function () use ($gateway) {
            WC_Twoinc_Payment_Terms::reset_fee_cache();
            WC()->session = new StubSession();
            WC()->session->set('chosen_payment_method', $gateway->id);
            WC()->customer = new StubCustomer('US');
            $cart = new StubFeeCart();
            WC_Twoinc_Payment_Terms::apply_cart_fee($cart);
            TinyAssert::same(0, count($cart->fees), 'a wrong-currency quote must not become a cart fee');
        });
    }

    private static function testMinimumDescriptionShowsConvertedFloorWhenRateAvailable(): void
    {
        // Display conversion: with a rate, the settings help text shows an
        // approximate store-currency floor (250 EUR / 0.085 = 2941.18 NOK);
        // without one it fails soft to the native-only wording.
        self::useTestbrand();
        $GLOBALS['__twoinc_test_store_currency'] = 'NOK';
        try {
            $gateway = self::fxGateway(self::EUR_250_NET, [self::fxOk(self::FX_TABLE)]);
            $description = $gateway->get_merchant_minimum_order_description();
            TinyAssert::true(strpos($description, 'approximately NOK 2,941.18') !== false, $description);

            $GLOBALS['__twoinc_test_options'] = [];
            $GLOBALS['__twoinc_test_transients'] = [];
            WC_Twoinc_FX::reset_request_cache();
            $gateway = self::fxGateway(self::EUR_250_NET, [new WP_Error()]);
            $description = $gateway->get_merchant_minimum_order_description();
            TinyAssert::true(strpos($description, 'cannot be checked') !== false, $description);
        } finally {
            unset($GLOBALS['__twoinc_test_store_currency']);
        }
    }
}

BrandConfigSpec::runAll();
print("All tests passed.\n");
