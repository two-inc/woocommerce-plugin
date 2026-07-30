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
            'testInvoiceEmailFieldHasNoPlaceholder',
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
            'testLegacyDaysOnInvoiceOptionRowsDropped',
            'testPaymentTermsValidationNonDestructiveOnUnresolvedOrNarrowedList',
            'testSurchargeGridPreservesRowsNotOnTheForm',
            'testChipFeeAmountCarriesCurrencySymbolNotCode',
            'testPaymentTermsDefaultFallsBackToShortest',
            'testBuyerFeeShareShapes',
            'testBuyerFeeShareRounding',
            'testRoundingStepOptionsCanonicalAndNarrowed',
            'testRoundingStepValidationEnforcesBrandOptions',
            'testSurchargeGridValidationNormalisesAndRejects',
            'testSurchargeGridEnforcesMerchantFixedCap',
            'testSurchargeCapZeroAmountFromApiMeansNoLimit',
            'testSurchargeGridCurrencyNoteNamesTheStoreCurrency',
            'testSurchargeGridHelpTextOmitsMaxOnCurrencyMismatch',
            'testSurchargeGridNotesShareTheGridsWidthContainer',
            'testSurchargeFeeStandardModeUnchanged',
            'testSurchargeFeeCustomClassTaxedAtSelectedClassRates',
            'testSurchargeFeeAlwaysZeroNeverTaxed',
            'testSurchargeFeeCustomClassFallsBackWhenClassDeleted',
            'testSurchargeTaxSettingsValidationAndStaleNotice',
            'testNeverTaxedTreatmentSuppressedUnconditionally',
            'testSurchargeTaxTreatmentRequiresExplicitSelection',
            'testPaymentTermsValidationRequiresSelection',
            'testDefaultTermCoercedToOfferedSet',
            'testOrderPayloadCarriesSelectedAndAvailableTerms',
            'testPaymentTermsInvalidPostFallsBackToDefault',
            'testPaymentTermsDisabledMeansNoPayloadTerms',
            'testSoleTraderAvailableWhenRegistryListsIt',
            'testSoleTraderTokensRefusedForNonCapableCountry',
            'testSoleTraderTokensMintedForCapableCountry',
            'testSoleTraderHasNoMerchantToggleSetting',
            'testSkipConfirmAuthRendersUnderDebugOptions',
            'testSkipConfirmAuthStoredValueSurvivesSectionMove',
            'testSkipConfirmAuthCopyIsTranslatedInEveryLocale',
            'testSoleTraderHiddenWhenRegistryOmitsIt',
            'testSoleTraderRegistryErrorFallsBackToNoSoleTrader',
            'testSoleTraderRegistryRejectsMalformedCountry',
            'testSoleTraderRegistryResponseCachedPerRequest',
            'testSoleTraderTokenMintReadsHeaderCaseInsensitively',
            'testSoleTraderTokenMintFailsClosed',
            'testSoleTraderSignupUrlFollowsEnvAndFilter',
            'testEnvironmentModeNormalisesStoredCheckoutEnv',
            'testEnvironmentHostFollowsModeAndBrandTemplate',
            'testLocaleFollowsRequestLocaleWithEnglishFallback',
            'testCheckoutHostPrefersExplicitModeOverDevSniffing',
            'testServiceHostsShareTheApiHostsEnvironment',
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
            'testFxFirstScheduledRunIsNearTermNotOneIntervalOut',
            'testFxColdCacheFetchesOnceAndFailureThrottlesRetries',
            'testFxGateFailsClosedWhenNoRateEverFetched',
            'testFxGateConvertsBasketAcrossCurrencies',
            'testFxGateUsesLastKnownGoodOnApiFailure',
            'testFxMerchantMinimumJudgedAcrossCurrencies',
            'testBuyerFeeShareConvertsFixedAndCapAcrossCurrencies',
            'testBuyerFeeShareFailsClosedWhenNoRateAvailable',
            'testGateWithholdsMethodWhenSurchargeCurrencyUnquotable',
            'testGateKeepsMethodWhenSurchargeIsPercentageOnly',
            'testGateFxCheckAppliesOnOrderPayEndpoint',
            'testBuyerFeeShareSameCurrencyNeverTouchesFx',
            'testBuyerFeeShareCapRoundingToZeroRelaysZeroCap',
            'testBuyerFeeShareFixedRoundingToZeroChargesZero',
            'testBuyerFeeShareAbsentCapChargesUncappedPercentage',
            'testCartFeeSkippedOnQuoteCurrencyMismatch',
            'testMinimumDescriptionShowsConvertedFloorWhenRateAvailable',
            'testDeployedCommitGitlinkWinsOverSidecar',
            'testGarbageOrEmptySidecarFallsThroughToGitlink',
            'testGarbageOrEmptyGitlinkFallsThroughToSidecar',
            'testNoProvenanceSourcesYieldsBareVersion',
            'testClientVersionNeverEmitsTrailingPlus',
            'testClientVersionSuffixesShortShaWhenStamped',
            'testClientVersionIsQueryEncodedAsPlus',
            'testPaymentBoxOrdersTaglineChipsThenSoleTrader',
            'testSelectedTermInputPrecedesChipsContainer',
            'testBrandWithoutTaglineEmitsNoTaglineBlock',
            'testTaglineSentenceIsPlatformCopyWithBrandFaqLink',
            'testRetiredFreeFormSubtitleKeyIsInert',
            'testNonStringBrandFaqUrlEmitsNoTagline',
            'testIntentApprovedNoticeDisabledBrandEmitsNoBlock',
            'testIntentApprovedNoticeDefaultBrandCarriesBothVariants',
            'testIntentApprovedNoticeBrandTemplateUsedVerbatim',
            'testIntentApprovedNoticeEmptyCopyOverrideIsInert',
            'testIntentApprovedNoticeSwitchAbsentDefaultsOn',
            'testIntentApprovedNoticeOverlayDeclaringNothingKeepsNoticeOn',
            'testIntentApprovedNoticeInvalidSwitchReportsAndDefaultsOn',
            'testIntentLoaderRendersTheOneSharedDotPulse',
            'testIntentLoaderSuppressedWithTheNoticeButErrorBoxesSurvive',
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
        // The STORE currency is a separate global from the ACTIVE one
        // (bootstrap.php stubs get_option('woocommerce_currency') and
        // get_woocommerce_currency() independently), and it was never reset
        // here. The whole suite runs in one process, so a test that set it
        // and then failed an assertion before its own unset leaked a
        // non-default store currency into every test after it — turning one
        // failure into a cascade in unrelated specs. Reset both together.
        unset($GLOBALS['__twoinc_test_store_currency']);
        unset($GLOBALS['test_home_url']);
        $GLOBALS['__twoinc_test_options'] = [];
        unset($_POST[WC_Twoinc_Payment_Terms::SESSION_KEY]);
        WC_Twoinc_Payment_Terms::reset_fee_cache();
        WC_Twoinc_Sole_Trader::reset_cache();
        WC_Twoinc::reset_merchant_record_memo();
        WC_Twoinc_FX::reset_request_cache();
        $GLOBALS['__twoinc_test_transients'] = [];
        $GLOBALS['__twoinc_test_logs'] = [];
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
        // Two ships no checkout tagline; an overlay supplies its FAQ URL.
        TinyAssert::same(null, WC_Twoinc_Brand::get('checkout_subtitle_faq_url'));
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

    /**
     * The optional invoice-email field must carry no hint of its own
     * (TWO-25287) — the "only for invoices sent by <brand>" copy was never
     * asked for, and the sibling optional fields (PO number, project,
     * department) have never had one. Same removal as the PrestaShop
     * counterpart, TWO-25281.
     */
    private static function testInvoiceEmailFieldHasNoPlaceholder(): void
    {
        $gateway = new class () extends WC_Twoinc {
            public function __construct()
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
            }

            public function get_option($key, $empty_value = null)
            {
                return $key === 'add_field_invoice_email' ? 'yes' : '';
            }
        };

        $checkout = new WC_Twoinc_Checkout($gateway);
        $fields = $checkout->update_company_fields(['billing' => []]);

        TinyAssert::true(
            isset($fields['billing']['invoice_email']),
            'invoice_email field must still be added when the option is on'
        );
        TinyAssert::true(
            !array_key_exists('placeholder', $fields['billing']['invoice_email']),
            'invoice_email must not define a placeholder'
        );
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
        TinyAssert::same(21, $gateway->get_merchant_due_in_days());
        $minimum = $gateway->get_platform_minimum_order();
        TinyAssert::same(['amount' => 100.0, 'currency' => 'NOK', 'basis' => 'net'], $minimum);
        TinyAssert::same(['amount' => 25.0, 'currency' => 'EUR'], $gateway->get_merchant_surcharge_limit(true));
        TinyAssert::same(1, $gateway->calls);

        // The caches live in dedicated wp_options, never the settings blob —
        // a frontend TTL-expiry write into the blob can silently revert a
        // concurrent admin settings save (WC_Settings_API::update_option
        // rewrites the whole array from an in-memory snapshot).
        TinyAssert::same(21, (int) $GLOBALS['__twoinc_test_options'][WC_Twoinc_Brand::prefixed_name('merchant_due_in_days')]);
        TinyAssert::true(isset($GLOBALS['__twoinc_test_options'][WC_Twoinc_Brand::prefixed_name('platform_minimum_order')]));
        TinyAssert::same(false, array_key_exists('merchant_due_in_days', $gateway->options));
        TinyAssert::same(false, array_key_exists('merchant_due_in_days_checked_on', $gateway->options));
        TinyAssert::same(false, array_key_exists('platform_minimum_order', $gateway->options));
        TinyAssert::same(false, array_key_exists('platform_minimum_order_last_checked_on', $gateway->options));

        // Next request with every TTL expired and the API down: one capped
        // stall total (memo covers failures), each consumer keeps its own
        // degrade posture — days serves stale, minimum blanks to null,
        // terms serve stale.
        foreach (['merchant_available_terms_checked_on', 'merchant_due_in_days_checked_on', 'platform_minimum_order_checked_on', 'merchant_surcharge_limit_checked_on'] as $name) {
            $GLOBALS['__twoinc_test_options'][WC_Twoinc_Brand::prefixed_name($name)] = time() - 3601;
        }
        WC_Twoinc::reset_merchant_record_memo();
        WC_Twoinc_FX::reset_request_cache();
        $GLOBALS['__twoinc_test_transients'] = [];
        $gateway->responses[] = new WP_Error('http_request_failed', 'down');

        TinyAssert::same([30, 60], $gateway->get_merchant_available_terms(true));
        TinyAssert::same(21, $gateway->get_merchant_due_in_days());
        TinyAssert::same(null, $gateway->get_platform_minimum_order());
        TinyAssert::same(['amount' => 25.0, 'currency' => 'EUR'], $gateway->get_merchant_surcharge_limit(true));
        TinyAssert::same(2, $gateway->calls);
    }

    private static function testLegacyDaysOnInvoiceOptionRowsDropped(): void
    {
        // TWO-24859: the merchant's default due-in-days cache moved from
        // `days_on_invoice` to `merchant_due_in_days`. No value is carried
        // across - the row is a 1h TTL cache of GET /v1/merchant, so the new
        // key self-heals on the first request with an API key - but the old
        // rows must not be left behind as orphans.
        $gateway = new class () extends WC_Twoinc {
            public function __construct()
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
            }
        };
        $drop = new ReflectionMethod(WC_Twoinc::class, 'drop_renamed_option_rows');
        $drop->setAccessible(true);

        $legacy_days = WC_Twoinc_Brand::prefixed_name('days_on_invoice');
        $legacy_checked = WC_Twoinc_Brand::prefixed_name('days_on_invoice_checked_on');
        $current_days = WC_Twoinc_Brand::prefixed_name('merchant_due_in_days');

        $GLOBALS['__twoinc_test_options'][$legacy_days] = 21;
        $GLOBALS['__twoinc_test_options'][$legacy_checked] = time();
        $GLOBALS['__twoinc_test_options'][$current_days] = 30;

        $drop->invoke($gateway);

        TinyAssert::same(false, array_key_exists($legacy_days, $GLOBALS['__twoinc_test_options']));
        TinyAssert::same(false, array_key_exists($legacy_checked, $GLOBALS['__twoinc_test_options']));
        // The renamed row is untouched.
        TinyAssert::same(30, $GLOBALS['__twoinc_test_options'][$current_days]);

        // Nothing stored under the legacy names: self-limiting, no writes.
        $drop->invoke($gateway);
        TinyAssert::same(false, array_key_exists($legacy_days, $GLOBALS['__twoinc_test_options']));
        TinyAssert::same(30, $GLOBALS['__twoinc_test_options'][$current_days]);
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

    /**
     * ABN-468: the chip fee label goes out already formatted by the store's
     * own price format, so the buyer sees the currency SYMBOL — Magento's
     * priceUtils.formatPrice behaviour, not the currency code the pricing
     * API echoes back. Tags stripped and entities decoded, because the chip
     * is rendered with jQuery `text`.
     */
    private static function testChipFeeAmountCarriesCurrencySymbolNotCode(): void
    {
        TinyAssert::same('€12.50', WC_Twoinc_Payment_Terms::format_fee_amount(12.5, 'EUR'));
        TinyAssert::same('£7.00', WC_Twoinc_Payment_Terms::format_fee_amount(7.0, 'gbp'));
        // A currency with no symbol of its own still formats, and still
        // carries no bare code-after-amount layout.
        TinyAssert::same('kr99.00', WC_Twoinc_Payment_Terms::format_fee_amount(99.0, 'NOK'));
        TinyAssert::true(strpos(WC_Twoinc_Payment_Terms::format_fee_amount(12.5, 'EUR'), 'EUR') === false);
        TinyAssert::true(strpos(WC_Twoinc_Payment_Terms::format_fee_amount(12.5, 'EUR'), '<') === false);
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
        $GLOBALS['__twoinc_test_store_currency'] = 'NOK';
        $clean = $gateway->validate_two_surcharge_grid_field('surcharge_grid', [30 => ['fixed' => '9999']]);
        TinyAssert::same([30 => ['fixed' => '9999']], $clean);
        unset($GLOBALS['__twoinc_test_store_currency']);

        // Only the ACTIVE currency diverges (multicurrency admin session).
        // The posted amounts are still store-denominated, so the cap binds
        // exactly as it does in a single-currency session (TWO-25268).
        $GLOBALS['__twoinc_test_currency'] = 'NOK';
        $message = '';
        try {
            $gateway->validate_two_surcharge_grid_field('surcharge_grid', [30 => ['fixed' => '9999']]);
        } catch (Exception $e) {
            $message = $e->getMessage();
        }
        TinyAssert::true(
            strpos($message, 'EUR 25') !== false,
            "the cap must not be skipped when only the active currency differs, got: $message"
        );
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

    /**
     * The grid's amounts are denominated in the STORE currency, so the note
     * that states the denomination — and the symbol in the limit sentence —
     * must come from the saved woocommerce_currency option, never from the
     * ACTIVE currency of the request. Under a multicurrency plugin an admin
     * browsing in USD was told "Amounts are shown in USD" for numbers the
     * plugin reads as EUR (TWO-25268).
     */
    private static function testSurchargeGridCurrencyNoteNamesTheStoreCurrency(): void
    {
        // Active currency diverges from the store currency, as a
        // multicurrency admin session does.
        $GLOBALS['__twoinc_test_store_currency'] = 'EUR';
        $GLOBALS['__twoinc_test_currency'] = 'USD';
        $gateway = self::validationGateway(['payment_terms_days' => [30]], [30]);
        $html = $gateway->generate_two_surcharge_grid_html('surcharge_grid', []);

        TinyAssert::true(
            strpos($html, 'Amounts are shown in EUR.') !== false,
            'the currency note must name the store currency'
        );
        TinyAssert::true(
            strpos($html, 'Amounts are shown in USD.') === false,
            'the currency note must not name the active currency'
        );
        // Same source for the symbol in the limit sentence. The stub
        // get_woocommerce_currency_symbol() echoes the code back.
        TinyAssert::true(
            strpos($html, 'Enter a limit amount (in EUR )') !== false,
            'the limit sentence symbol must derive from the store currency'
        );

        unset($GLOBALS['__twoinc_test_store_currency']);
        unset($GLOBALS['__twoinc_test_currency']);
        unset($GLOBALS['test_home_url']);
    }

    private static function testSurchargeGridHelpTextOmitsMaxOnCurrencyMismatch(): void
    {
        $limit_option = WC_Twoinc_Brand::prefixed_name('merchant_surcharge_limit');
        $GLOBALS['__twoinc_test_options'][$limit_option] = json_encode(['amount' => 25.0, 'currency' => 'EUR']);

        // Matching store currency: the grid claims the enforced maximum.
        $GLOBALS['__twoinc_test_store_currency'] = 'EUR';
        $gateway = self::validationGateway(['payment_terms_days' => [30]], [30]);
        $html = $gateway->generate_two_surcharge_grid_html('surcharge_grid', []);
        TinyAssert::true(strpos($html, 'Max EUR 25.') !== false, 'expected Max sentence for matching currency');

        // Store currency differs from the cap's: save-validation skips the
        // cap (Woo does no FX conversion), so the help text must not claim
        // a fixed maximum it will not enforce. The fixed-amount help
        // paragraph disappears entirely and the combined variant degrades
        // to the percentage-only wording (ABN-476) — the percentage
        // ceiling itself is always enforced, so "Max: 100%" stays.
        $GLOBALS['__twoinc_test_store_currency'] = 'NOK';
        $html = $gateway->generate_two_surcharge_grid_html('surcharge_grid', []);
        TinyAssert::true(strpos($html, 'Max EUR') === false, 'fixed Max sentence must be omitted on currency mismatch');
        TinyAssert::true(strpos($html, 'Max NOK') === false, 'no fixed maximum may be claimed on currency mismatch');
        TinyAssert::true(
            strpos($html, 'twoinc-surcharge-grid-help--fixed"') === false,
            'the fixed-only help paragraph must not render without an enforceable cap'
        );
        TinyAssert::true(strpos($html, 'Max: 100%.') !== false, 'percentage ceiling is always claimable');
        unset($GLOBALS['__twoinc_test_store_currency']);

        // An active-currency-only divergence is NOT a mismatch: the cap is
        // enforced against store-denominated amounts, so the Max sentence
        // must still be claimed (TWO-25268).
        $GLOBALS['__twoinc_test_currency'] = 'NOK';
        $html = $gateway->generate_two_surcharge_grid_html('surcharge_grid', []);
        TinyAssert::true(
            strpos($html, 'Max EUR 25.') !== false,
            'the Max sentence must survive an active-currency-only divergence'
        );
        unset($GLOBALS['__twoinc_test_currency']);
        unset($GLOBALS['test_home_url']);
    }

    /**
     * The grid table and the notes/help paragraphs below it must sit inside
     * ONE width container (.twoinc-surcharge-grid-container, max-width in
     * admin.css) so the help text wraps at the grid's width rather than the
     * full width of the WooCommerce settings cell. The table therefore
     * carries no width of its own — admin.css makes it 100% of the
     * container. Mirrors Magento's #surcharge-grid-container (ABN-476).
     */
    private static function testSurchargeGridNotesShareTheGridsWidthContainer(): void
    {
        $gateway = self::validationGateway(['payment_terms_days' => [30]], [30]);
        $html = $gateway->generate_two_surcharge_grid_html('surcharge_grid', []);

        $open = strpos($html, '<div class="twoinc-surcharge-grid-container">');
        TinyAssert::true($open !== false, 'expected a single width container around the grid');
        $close = strrpos($html, '</div>');
        TinyAssert::true($close !== false && $close > $open, 'container must be closed after its contents');

        // Grid and every note/help paragraph live inside that container.
        foreach (['<table class="widefat twoinc-surcharge-grid"', 'twoinc-surcharge-grid-currency-note', 'twoinc-surcharge-grid-help--percentage', 'twoinc-surcharge-grid-empty'] as $needle) {
            $at = strpos($html, $needle);
            TinyAssert::true($at !== false && $at > $open && $at < $close, $needle . ' must render inside the width container');
        }

        // No competing width on the table itself — the container owns it.
        TinyAssert::true(strpos($html, 'max-width:620px') === false, 'the table must not carry its own width');
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

        // Treatment validation enforces the OFFERED modes. 'always_zero' is
        // no longer offered to a shop that does not already store it, so it is
        // rejected here too — the rule is not UI-only (TWO-25279).
        TinyAssert::same('standard', $gateway->validate_surcharge_tax_treatment_field('surcharge_tax_treatment', 'standard'));
        $threw = false;
        try {
            $gateway->validate_surcharge_tax_treatment_field('surcharge_tax_treatment', 'always_zero');
        } catch (Exception $e) {
            $threw = true;
        }
        TinyAssert::true($threw, 'a shop that never stored the never-taxed mode cannot newly post it');
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

    /**
     * TWO-25279: the never-taxed treatment is a plugin-supplied mode, not a
     * tax rule the merchant set up, so it is never offered — an untaxed fee is
     * a 0%-rate tax class under "Specific tax class".
     *
     * Enforce-only, with NO grandfathering: a shop that already stores the
     * mode does not get the option back, is refused at save, and is told so
     * loudly on the settings page. Its stored value is never silently
     * rewritten, so the fee stays untaxed at checkout until the merchant
     * chooses — which is exactly why the notice has to be visible.
     */
    private static function testNeverTaxedTreatmentSuppressedUnconditionally(): void
    {
        $GLOBALS['__twoinc_test_tax_classes'] = ['B2B Levy'];

        // Never configured -> not offered. No raw settings row at all, which
        // is the fresh-install shape.
        unset($GLOBALS['__twoinc_test_options']);
        $fresh = self::surchargeFeeGateway([]);
        TinyAssert::same(
            ['', 'standard', 'custom_class'],
            array_keys($fresh->get_surcharge_tax_treatment_options()),
            'a shop that never chose is not offered the never-taxed mode'
        );
        TinyAssert::same('', $fresh->get_surcharge_never_taxed_notice(), 'nothing to report on a fresh install');

        // On another mode -> still not offered, still nothing to report.
        $standard = self::surchargeFeeGateway(['surcharge_tax_treatment' => 'standard']);
        $GLOBALS['__twoinc_test_options'][$standard->get_option_key()] = [
            'surcharge_tax_treatment' => 'standard',
        ];
        TinyAssert::same(
            ['', 'standard', 'custom_class'],
            array_keys($standard->get_surcharge_tax_treatment_options()),
            'a shop on another mode is not offered the never-taxed mode'
        );
        TinyAssert::same('', $standard->get_surcharge_never_taxed_notice(), 'a real treatment is not reported');

        // Already stored -> STILL not offered (no grandfathering), and the
        // settings field renders the same suppressed list.
        //
        // Driven off the RAW settings row, which is what the production code
        // reads: $this->settings is still empty while init_form_fields() runs,
        // so a test that only injected the harness option array would pass
        // with the source reverted.
        $legacy = self::surchargeFeeGateway([
            'surcharge_type' => 'percentage',
            'surcharge_tax_treatment' => WC_Twoinc::NEVER_TAXED_SURCHARGE_TREATMENT,
        ]);
        $GLOBALS['__twoinc_test_options'][$legacy->get_option_key()] = [
            'surcharge_type' => 'percentage',
            'surcharge_tax_treatment' => WC_Twoinc::NEVER_TAXED_SURCHARGE_TREATMENT,
        ];
        TinyAssert::same(
            ['', 'standard', 'custom_class'],
            array_keys($legacy->get_surcharge_tax_treatment_options()),
            'a shop already storing the mode does NOT get the option back'
        );
        $legacy->init_form_fields();
        TinyAssert::same(
            ['', 'standard', 'custom_class'],
            array_keys($legacy->form_fields['surcharge_tax_treatment']['options']),
            'the settings field must render the suppressed list, not a hardcoded one'
        );

        // Fail loud: the field carries a VISIBLE error (not a tooltip), and it
        // names the consequence rather than merely saying "invalid".
        $notice = $legacy->get_surcharge_never_taxed_notice();
        TinyAssert::true($notice !== '', 'a shop storing the mode must be told');
        TinyAssert::true(strpos($notice, 'UNTAXED') !== false, 'the notice spells out the consequence');
        TinyAssert::same(
            $notice,
            $legacy->form_fields['surcharge_tax_treatment']['description'],
            'the notice must be the visible field description, not the tooltip'
        );
        TinyAssert::true(
            is_string($legacy->form_fields['surcharge_tax_treatment']['desc_tip'])
            && strpos($legacy->form_fields['surcharge_tax_treatment']['desc_tip'], 'Standard applies') !== false,
            'the help text moves to the tooltip so the error can occupy the visible slot'
        );

        // The notice must read the RAW settings row, not $this->get_option():
        // it is called from init_form_fields(), which the constructor runs
        // BEFORE init_settings(), so $this->settings is still empty and
        // get_option() would silently report no stored treatment — dropping
        // the one warning this exists to raise. A gateway whose injected
        // option layer is empty but whose raw row holds the mode must still be
        // warned, which a test that only injected the option layer could not
        // tell apart.
        $rawOnly = self::surchargeFeeGateway([]);
        $GLOBALS['__twoinc_test_options'][$rawOnly->get_option_key()] = [
            'surcharge_tax_treatment' => WC_Twoinc::NEVER_TAXED_SURCHARGE_TREATMENT,
        ];
        TinyAssert::same('', $rawOnly->get_option('surcharge_tax_treatment'), 'pin: the injected option layer is empty for this gateway');
        TinyAssert::true(
            $rawOnly->get_surcharge_never_taxed_notice() !== '',
            'the notice must read the raw settings row, not $this->settings'
        );

        // Refused at save, on BOTH fields, with no already-stored exemption.
        $threw = false;
        $message = '';
        try {
            $legacy->validate_surcharge_tax_treatment_field(
                'surcharge_tax_treatment',
                WC_Twoinc::NEVER_TAXED_SURCHARGE_TREATMENT
            );
        } catch (Exception $e) {
            $threw = true;
            $message = $e->getMessage();
        }
        TinyAssert::true($threw, 'resubmitting the stored mode is refused — there is no grandfathering');
        TinyAssert::true(
            strpos($message, 'untaxed for every destination') !== false,
            'the refusal names the consequence, not just "one of the offered modes"'
        );
        $threw = false;
        try {
            $legacy->validate_surcharge_type_field('surcharge_type', 'percentage');
        } catch (Exception $e) {
            $threw = true;
        }
        TinyAssert::true($threw, 'the surcharge-type gate refuses to keep surcharges enabled against it');

        // The merchant tax configuration is NOT rewritten by any of the above
        // — the fee really is still untaxed at checkout, which is what the
        // notice exists to surface.
        TinyAssert::same(
            WC_Twoinc::NEVER_TAXED_SURCHARGE_TREATMENT,
            $GLOBALS['__twoinc_test_options'][$legacy->get_option_key()]['surcharge_tax_treatment'],
            'reading and reporting must not silently rewrite the stored treatment'
        );
        TinyAssert::same(
            WC_Twoinc::NEVER_TAXED_SURCHARGE_TREATMENT,
            WC_Twoinc_Payment_Terms::resolve_surcharge_tax_treatment($legacy)['treatment'],
            'the runtime still applies the stored treatment — no silent migration'
        );

        // The shared predicate: exact match only. A padded row resolves to
        // Standard at checkout, so it must NOT be reported as never-taxed —
        // it is refused as unoffered instead.
        TinyAssert::true($fresh->is_never_taxed_surcharge_treatment('always_zero'));
        foreach (['', ' always_zero ', 'always_zero ', 'standard', 'custom_class', null, false, 0, []] as $other) {
            TinyAssert::same(
                false,
                $fresh->is_never_taxed_surcharge_treatment($other),
                'must NOT read as never-taxed: ' . var_export($other, true)
            );
        }
        $padded = self::surchargeFeeGateway([
            'surcharge_type' => 'percentage',
            'surcharge_tax_treatment' => ' always_zero ',
        ]);
        $GLOBALS['__twoinc_test_options'][$padded->get_option_key()] = [
            'surcharge_type' => 'percentage',
            'surcharge_tax_treatment' => ' always_zero ',
        ];
        TinyAssert::same(
            '',
            $padded->get_surcharge_never_taxed_notice(),
            'a padded row resolves to Standard at checkout, so claiming it is untaxed would be false'
        );
        TinyAssert::same(
            'standard',
            WC_Twoinc_Payment_Terms::resolve_surcharge_tax_treatment($padded)['treatment'],
            'pin the resolver behaviour the notice is calibrated against'
        );
        unset($GLOBALS['__twoinc_test_options']);

        $blanked = self::surchargeFeeGateway(['surcharge_type' => 'percentage', 'surcharge_tax_treatment' => '']);
        $threw = false;
        try {
            $blanked->validate_surcharge_type_field('surcharge_type', 'percentage');
        } catch (Exception $e) {
            $threw = true;
        }
        TinyAssert::true($threw, 'the surcharge-type gate also rejects a blanked treatment');
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
        TinyAssert::true(
            strpos($field['desc_tip'], 'Never taxed') === false,
            'the help text must not offer the never-taxed mode as a choice'
        );
        TinyAssert::same('', $field['description'], 'the visible slot is empty until there is an error to report');
        TinyAssert::same(['', 'standard', 'custom_class'], array_keys($field['options']));
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
        $fresh->test_post_data = [$fresh->get_field_key('surcharge_tax_treatment') => 'standard'];
        TinyAssert::same('percentage', $fresh->validate_surcharge_type_field('surcharge_type', 'percentage'));

        // ...but not with a mode the shop is not offered. Both validators must
        // agree, or the type gate passes, the treatment field throws, WC keeps
        // the old (blank) treatment, and the shop ends up with surcharges
        // enabled and no treatment — the very state this gate exists to
        // prevent (TWO-25279).
        $fresh->test_post_data = [$fresh->get_field_key('surcharge_tax_treatment') => 'always_zero'];
        $threw = false;
        try {
            $fresh->validate_surcharge_type_field('surcharge_type', 'percentage');
        } catch (Exception $e) {
            $threw = true;
        }
        TinyAssert::true($threw, 'the type gate must refuse a treatment the shop is not offered');

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

    private static function testSoleTraderAvailableWhenRegistryListsIt(): void
    {
        $gateway = self::soleTraderGateway([], [
            '/registry/v1/supported-company-types/' => self::registryOk(['SOLE_TRADER']),
        ]);
        TinyAssert::true(WC_Twoinc_Sole_Trader::is_available($gateway, 'GB'));
        // Lowercase input normalises to the same country
        WC_Twoinc_Sole_Trader::reset_cache();
        TinyAssert::true(WC_Twoinc_Sole_Trader::is_available($gateway, 'gb'));
    }

    /**
     * Run the token-minting wc-ajax handler with $gateway installed as the
     * gateway singleton, and return the recorded JSON response.
     */
    private static function runTokensHandler($gateway): array
    {
        $prop = new ReflectionProperty(WC_Twoinc::class, 'instance');
        $prop->setAccessible(true);
        $prop->setValue(null, $gateway);
        $GLOBALS['__twoinc_test_ajax_json'] = null;
        try {
            WC_Twoinc_Sole_Trader::ajax_tokens();
        } finally {
            $prop->setValue(null, null);
        }
        return $GLOBALS['__twoinc_test_ajax_json'];
    }

    /** Gateway that would happily mint if it were ever asked to. */
    private static function tokenMintingGateway(array $types): WC_Payment_Gateway
    {
        return self::soleTraderGateway([], [
            '/registry/v1/supported-company-types/' => self::registryOk($types),
            '/registry/v1/delegation' => [
                'response' => ['code' => 200],
                'headers' => ['two-delegated-authority-token' => 'reg-token'],
            ],
            '/autofill/v1/delegation' => [
                'response' => ['code' => 200],
                'headers' => ['two-delegated-authority-token' => 'autofill-token'],
            ],
        ]);
    }

    private static function testSoleTraderTokensRefusedForNonCapableCountry(): void
    {
        // With the merchant toggle gone (TWO-25163) the country check is the
        // ONLY authorisation gate on the token mint. A country the registry
        // does not list must still be refused, and must not reach either
        // delegation endpoint.
        $gateway = self::tokenMintingGateway([]);
        $_REQUEST = ['country' => 'NO'];
        $response = self::runTokensHandler($gateway);
        $_REQUEST = [];
        TinyAssert::same(false, $response['success']);
        TinyAssert::same(['/registry/v1/supported-company-types/NO'], $gateway->requests);

        // A missing country is equally unauthorised (and never hits the API).
        WC_Twoinc_Sole_Trader::reset_cache();
        $gateway = self::tokenMintingGateway(['SOLE_TRADER']);
        $_REQUEST = [];
        $response = self::runTokensHandler($gateway);
        TinyAssert::same(false, $response['success']);
        TinyAssert::same([], $gateway->requests);
    }

    private static function testSoleTraderTokensMintedForCapableCountry(): void
    {
        $gateway = self::tokenMintingGateway(['SOLE_TRADER']);
        $_REQUEST = ['country' => 'GB'];
        $response = self::runTokensHandler($gateway);
        $_REQUEST = [];
        TinyAssert::true($response['success']);
        TinyAssert::same('reg-token', $response['data']['delegation_token']);
        TinyAssert::same('autofill-token', $response['data']['autofill_token']);
        TinyAssert::same(
            'https://checkout.two.inc/soletrader/signup',
            $response['data']['signup_url']
        );
    }

    /**
     * WooCommerce renders form_fields in array order, and a `type => title`
     * entry opens a section that runs until the next one. So "which section
     * is this field in" is answered by walking the array and taking the last
     * title seen before the field — assert that, not just key presence
     * (TWO-25283).
     */
    private static function testSkipConfirmAuthRendersUnderDebugOptions(): void
    {
        $gateway = new class () extends WC_Twoinc {
            public function __construct()
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
            }
        };
        $gateway->init_form_fields();

        $section = null;
        $sections = [];
        foreach ($gateway->form_fields as $name => $field) {
            if (isset($field['type']) && $field['type'] === 'title') {
                $section = $name;
                continue;
            }
            $sections[$name] = $section;
        }

        TinyAssert::same(
            'section_debug',
            $sections['skip_confirm_auth'] ?? null,
            'skip_confirm_auth must render under the Debug Options heading'
        );
        // Sanity on the walker itself, not on this field: if it reported
        // 'section_debug' for everything the assertion above would pass
        // vacuously, so pin one field known to live in another section.
        TinyAssert::same(
            'section_checkout_options',
            $sections['display_tooltips'] ?? null,
            'walker sanity check: display_tooltips is expected in the checkout '
                . 'group — if that field was deliberately moved, repoint this '
                . 'assertion at another non-debug field'
        );
        // And the option stays off by default wherever it is rendered.
        TinyAssert::same('no', $gateway->form_fields['skip_confirm_auth']['default']);
    }

    /**
     * A merchant who enabled the option keeps it after the section move.
     * WC_Settings_API keeps every field in ONE serialised option row keyed by
     * field name and stores nothing for `title` fields, so section membership
     * is presentation only — this seeds the row the way an upgraded install
     * has it and reads it back through the same get_option() call the
     * confirmation callback makes (TWO-25283).
     *
     * What it pins is the read: the stored 'yes' reaches the caller, and a
     * shop that never touched the key still gets the 'no' default, which only
     * resolves while the field is declared. It cannot prove the section move
     * is what preserved the value — no code path stores or reads the section —
     * so a rename or an accidental drop of the field is the failure it
     * actually catches.
     */
    private static function testSkipConfirmAuthStoredValueSurvivesSectionMove(): void
    {
        $gateway = new class () extends WC_Twoinc {
            public function __construct()
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
            }
        };
        $gateway->init_form_fields();
        $key = $gateway->get_option_key();

        // Section headings are pure presentation: they declare no stored
        // value, so which one a field sits under cannot reach the row.
        TinyAssert::same('title', $gateway->form_fields['section_debug']['type']);
        TinyAssert::same(false, array_key_exists('default', $gateway->form_fields['section_debug']));

        $GLOBALS['__twoinc_test_options'][$key] = ['skip_confirm_auth' => 'yes', 'api_key' => 'keep-me'];
        $gateway->init_settings();
        TinyAssert::same('yes', $gateway->get_option('skip_confirm_auth'));

        // A shop that never touched it resolves the field default instead.
        $GLOBALS['__twoinc_test_options'][$key] = ['api_key' => 'keep-me'];
        $gateway->init_settings();
        TinyAssert::same('no', $gateway->get_option('skip_confirm_auth'));

        // And the dead-key sweeper must not start treating it as removed.
        $GLOBALS['__twoinc_test_options'][$key] = ['skip_confirm_auth' => 'yes', 'api_key' => 'keep-me'];
        $gateway->init_settings();
        $drop = new ReflectionMethod(WC_Twoinc::class, 'drop_removed_settings');
        // Required below 8.1, where reflection still honours visibility.
        // Unconditional to match the file's ten other call sites: gating only
        // this one would not make the suite deprecation-clean on 8.5 and would
        // read as if it did. CI's top rung is 8.4.
        $drop->setAccessible(true);
        $drop->invoke($gateway);
        TinyAssert::same(
            ['skip_confirm_auth' => 'yes', 'api_key' => 'keep-me'],
            $GLOBALS['__twoinc_test_options'][$key]
        );

        unset($GLOBALS['__twoinc_test_options'][$key]);
    }

    /**
     * The new label and description ship translated in every locale the repo
     * carries. Asserted against the COMPILED .mo, not the .po, for the reason
     * the tagline test spells out: WordPress reads only the .mo, and both ways
     * this silently reverts to English on a translated shop — a forgotten
     * msgfmt, or a fuzzy marker, which msgfmt drops — are invisible in the .po
     * text (TWO-25283).
     */
    private static function testSkipConfirmAuthCopyIsTranslatedInEveryLocale(): void
    {
        $languages = dirname(__DIR__, 2) . '/languages/';

        // Read the msgids off the live field rather than retyping them: the
        // regression this exists to catch is the source copy being edited
        // without the catalogues being regenerated, and a hardcoded copy of
        // the literal cannot see that. __() is stubbed to identity here, so
        // form_fields carries the untranslated source string.
        $gateway = new class () extends WC_Twoinc {
            public function __construct()
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
            }
        };
        $gateway->init_form_fields();
        //
        // The cost of reading them rather than retyping them: the pair moving
        // together in the WRONG direction is now invisible here — a clause
        // dropped from the source and from all three msgstrs still passes.
        // Nothing pins the copy's content; that is a review job.
        $field = $gateway->form_fields['skip_confirm_auth'] ?? [];
        $msgids = [$field['label'] ?? null, $field['description'] ?? null];
        foreach ($msgids as $msgid) {
            // The length floor is load-bearing: a degenerate short msgid would
            // make every strpos() below vacuously true.
            TinyAssert::true(
                is_string($msgid) && strlen($msgid) > 20,
                'skip_confirm_auth must carry both a label and a description to translate'
            );
        }

        // A msgid absent from the template is untranslatable for whoever
        // maintains the catalogues next, and nothing else would report it.
        $pot = file_get_contents($languages . 'twoinc-payment-gateway.pot');
        foreach ($msgids as $msgid) {
            TinyAssert::true(
                strpos($pot, $msgid) !== false,
                'the .pot is missing a skip_confirm_auth msgid — regenerate it'
            );
        }
        // One recognisable fragment per locale is enough: the msgid assertion
        // below is what pins the lookup, and a fragment survives any later
        // rewording of the rest of the sentence.
        $fragments = [
            'nl_NL' => ['zonder geldige WordPress-nonce', 'de aanvullende WordPress-nonce'],
            'nb_NO' => ['uten gyldig WordPress-nonce', 'bare over den ekstra WordPress-noncen'],
            'sv_SE' => ['utan giltig WordPress-nonce', 'bara över den extra WordPress-noncen'],
        ];

        foreach ($fragments as $locale => $expected) {
            $mo = file_get_contents($languages . 'twoinc-payment-gateway-' . $locale . '.mo');
            foreach ($msgids as $msgid) {
                // A msgid that has drifted from the source literal misses the
                // lookup and renders English however good the msgstr is. __()
                // is stubbed to identity here, so nothing else can see that.
                TinyAssert::true(
                    strpos($mo, $msgid) !== false,
                    "compiled $locale msgid has drifted from the source literal "
                        . '(recompile with msgfmt after editing the .po?)'
                );
            }
            foreach ($expected as $fragment) {
                TinyAssert::true(
                    strpos($mo, $fragment) !== false,
                    "compiled $locale catalogue is missing the skip_confirm_auth copy — "
                        . 'that shop would render English'
                );
            }
        }
    }

    private static function testSoleTraderHasNoMerchantToggleSetting(): void
    {
        $gateway = new class () extends WC_Twoinc {
            public function __construct()
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
            }
        };
        $gateway->init_form_fields();
        // Nothing merchant-facing left to configure (TWO-25163) — neither the
        // toggle nor the section heading that existed only to carry it.
        TinyAssert::same(false, array_key_exists('enable_sole_trader', $gateway->form_fields));
        TinyAssert::same(false, array_key_exists('section_sole_trader', $gateway->form_fields));

        // An upgraded install that stored the toggle has the dead key removed
        // from the settings blob rather than left behind.
        $key = $gateway->get_option_key();
        $drop = new ReflectionMethod(WC_Twoinc::class, 'drop_removed_settings');
        $drop->setAccessible(true);

        $GLOBALS['__twoinc_test_options'][$key] = ['enable_sole_trader' => 'no', 'api_key' => 'keep-me'];
        $gateway->init_settings();
        $drop->invoke($gateway);
        TinyAssert::same(['api_key' => 'keep-me'], $GLOBALS['__twoinc_test_options'][$key]);

        // Nothing stored: the routine self-limits and leaves the blob alone.
        $GLOBALS['__twoinc_test_options'][$key] = ['api_key' => 'keep-me'];
        $gateway->init_settings();
        $drop->invoke($gateway);
        TinyAssert::same(['api_key' => 'keep-me'], $GLOBALS['__twoinc_test_options'][$key]);
    }

    private static function testSoleTraderHiddenWhenRegistryOmitsIt(): void
    {
        // Countries without sole trader support return an empty list:
        // registered businesses need no registry enrollment, so the
        // endpoint deliberately omits them.
        $gateway = self::soleTraderGateway([], [
            '/registry/v1/supported-company-types/' => self::registryOk([]),
        ]);
        TinyAssert::same(false, WC_Twoinc_Sole_Trader::is_available($gateway, 'NO'));
    }

    private static function testSoleTraderRegistryErrorFallsBackToNoSoleTrader(): void
    {
        // Network error
        $gateway = self::soleTraderGateway([], []);
        TinyAssert::same([], WC_Twoinc_Sole_Trader::get_supported_company_types($gateway, 'GB'));

        // Non-200
        WC_Twoinc_Sole_Trader::reset_cache();
        $gateway = self::soleTraderGateway([], [
            '/registry/v1/supported-company-types/' => ['response' => ['code' => 404], 'body' => ''],
        ]);
        TinyAssert::same([], WC_Twoinc_Sole_Trader::get_supported_company_types($gateway, 'GB'));

        // Malformed body
        WC_Twoinc_Sole_Trader::reset_cache();
        $gateway = self::soleTraderGateway([], [
            '/registry/v1/supported-company-types/' => ['response' => ['code' => 200], 'body' => 'not json'],
        ]);
        TinyAssert::same([], WC_Twoinc_Sole_Trader::get_supported_company_types($gateway, 'GB'));
    }

    private static function testSoleTraderRegistryRejectsMalformedCountry(): void
    {
        $gateway = self::soleTraderGateway([], [
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
        $gateway = self::soleTraderGateway([], [
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
        $gateway = self::soleTraderGateway([], [
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
        $gateway = self::soleTraderGateway([], [
            '/registry/v1/delegation' => [
                'response' => ['code' => 200],
                'headers' => ['two-delegated-authority-token' => 'reg-token'],
            ],
            '/autofill/v1/delegation' => ['response' => ['code' => 500], 'headers' => []],
        ]);
        TinyAssert::same(null, WC_Twoinc_Sole_Trader::mint_tokens($gateway));

        // Missing header on a 200 also fails closed
        $gateway = self::soleTraderGateway([], [
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

    private static function testLocaleFollowsRequestLocaleWithEnglishFallback(): void
    {
        // The locale travels as the Accept-Language header and the invoice
        // PDF `lang` param, so it must describe the language of the request
        // being served. determine_locale() is the source (the stub is the
        // only definition in the harness — reverting to get_user_locale()
        // would fatal here), and an empty result falls back to en_US rather
        // than sending a blank header.
        $GLOBALS['__twoinc_test_locale'] = 'nb_NO';
        try {
            TinyAssert::same('nb_NO', WC_Twoinc_Helper::get_locale());
            $GLOBALS['__twoinc_test_locale'] = '';
            TinyAssert::same('en_US', WC_Twoinc_Helper::get_locale());
        } finally {
            unset($GLOBALS['__twoinc_test_locale']);
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

    /**
     * The invariant TWO-25170 violated: every service host the gateway emits
     * resolves to the environment the API host resolves to. A dev-sniffed shop
     * on the never-configured default mode reaches staging over the API, so its
     * hosted signup page has to be staging's — a production page rejects the
     * staging-minted delegation token with 401.
     */
    private static function testServiceHostsShareTheApiHostsEnvironment(): void
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

        // Dev-sniffed shop, default mode, default test host: staging both ways.
        $GLOBALS['test_home_url'] = 'https://woocom.staging.two.inc';
        $gateway = $make(['test_checkout_host' => 'https://api.staging.two.inc']);
        TinyAssert::same('https://api.staging.two.inc', $gateway->get_twoinc_checkout_host());
        TinyAssert::same(
            'https://checkout.staging.two.inc',
            WC_Twoinc_Helper::get_environment_host('checkout', $gateway)
        );
        TinyAssert::same(
            'https://checkout.staging.two.inc/soletrader/signup',
            WC_Twoinc_Sole_Trader::get_signup_page_url($gateway)
        );

        // The page host tracks whichever environment the test host names.
        $gateway = $make(['test_checkout_host' => 'https://api.sandbox.two.inc']);
        TinyAssert::same('https://api.sandbox.two.inc', $gateway->get_twoinc_checkout_host());
        TinyAssert::same(
            'https://checkout.sandbox.two.inc',
            WC_Twoinc_Helper::get_environment_host('checkout', $gateway)
        );

        // An unclassifiable test host (local tunnel) is still not production.
        $gateway = $make(['test_checkout_host' => 'http://localhost:8080']);
        TinyAssert::same(
            'https://checkout.staging.two.inc',
            WC_Twoinc_Helper::get_environment_host('checkout', $gateway)
        );

        // A dev shop deliberately pointed at the production API keeps the
        // production page, so the pair stays consistent in that direction too.
        $gateway = $make(['test_checkout_host' => 'https://api.two.inc']);
        TinyAssert::same('https://api.two.inc', $gateway->get_twoinc_checkout_host());
        TinyAssert::same(
            'https://checkout.two.inc',
            WC_Twoinc_Helper::get_environment_host('checkout', $gateway)
        );

        // A real merchant shop is untouched: production API, production page.
        $GLOBALS['test_home_url'] = 'https://shop.merchant.example';
        $gateway = $make([]);
        TinyAssert::same('https://api.two.inc', $gateway->get_twoinc_checkout_host());
        TinyAssert::same(
            'https://checkout.two.inc',
            WC_Twoinc_Helper::get_environment_host('checkout', $gateway)
        );

        // Brand-agnostic: an overlay's own domains follow the same rule, with
        // no brand-specific branch — the resolution is template-driven.
        WC_Twoinc_Brand::reset();
        self::useTestbrand();
        $GLOBALS['test_home_url'] = 'https://woocom-brand.staging.two.inc';
        $gateway = $make(['test_checkout_host' => 'https://api.staging.testbrand.example']);
        TinyAssert::same('https://api.staging.testbrand.example', $gateway->get_twoinc_checkout_host());
        TinyAssert::same(
            'https://checkout.staging.testbrand.example',
            WC_Twoinc_Helper::get_environment_host('checkout', $gateway)
        );
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
     *
     * No `: WC_Twoinc` return type — that widens the anonymous class away
     * and static analysis then cannot see $fx_requests on the returned
     * object. Returning it untyped lets the exact anon class be inferred.
     */
    private static function fxGateway(?array $platform_minimum, array $fx_responses, array $options = [])
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

    /**
     * Assert the StubWcLogger recorded a message at $level containing
     * $needle. Withholding a payment method (or a surcharge) is invisible
     * to the merchant, so the LEVEL is part of the contract, not decoration
     * — an error condition reported at warning is a missed signal.
     */
    private static function assertLogged(string $level, string $needle): void
    {
        foreach ($GLOBALS['__twoinc_test_logs'] as $entry) {
            if ($entry['level'] === $level && strpos($entry['message'], $needle) !== false) {
                return;
            }
        }
        throw new RuntimeException(
            'Expected a ' . $level . '-level log containing ' . var_export($needle, true)
            . '; got ' . var_export($GLOBALS['__twoinc_test_logs'], true)
        );
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

    private static function testFxFirstScheduledRunIsNearTermNotOneIntervalOut(): void
    {
        // Cold install: the first run of the recurring series must be
        // near-term so the cache is warm before any realistic first
        // checkout. Scheduling it a full REFRESH_INTERVAL out (the
        // pre-TWO-25183 behaviour) left six hours in which the first
        // cross-currency checkout paid a synchronous fetch, or failed its
        // gate closed when that fetch failed.
        $before = time();
        WC_Twoinc_FX::maybe_schedule_refresh();
        $call = $GLOBALS['__twoinc_test_as_schedule_calls'][0];

        TinyAssert::true($call['timestamp'] <= $before + WC_Twoinc_FX::INITIAL_REFRESH_DELAY);
        TinyAssert::true($call['timestamp'] < $before + WC_Twoinc_FX::REFRESH_INTERVAL);
        // The cadence itself is unchanged — only the first run moved.
        TinyAssert::same(WC_Twoinc_FX::REFRESH_INTERVAL, $call['interval']);
        // Anti-stampede guarantee must survive the change.
        TinyAssert::same(true, $call['unique']);
    }

    private static function testFxColdCacheFetchesOnceAndFailureThrottlesRetries(): void
    {
        // Nothing ever stored (cold install, scheduled warm-up not run
        // yet): a conversion fetches inline rather than concluding "no
        // rates".
        TinyAssert::same(false, get_option(WC_Twoinc_FX::option_key()));
        $gateway = self::fxGateway(null, [self::fxOk(self::FX_TABLE)]);
        self::assertClose(0.085, WC_Twoinc_FX::get_rate($gateway, 'NOK', 'EUR'));
        TinyAssert::same(1, $gateway->fx_requests);

        // Cold cache and a dead API: one attempt, then the retry throttle
        // (FAILURE_RETRY_WINDOW) holds off further attempts across request
        // cycles — a flapping API must not be hammered once per conversion.
        delete_option(WC_Twoinc_FX::option_key());
        delete_transient(WC_Twoinc_FX::fresh_transient_key());
        delete_transient(WC_Twoinc_FX::retry_transient_key());
        WC_Twoinc_FX::reset_request_cache();
        $failing = self::fxGateway(null, [new WP_Error(), new WP_Error(), new WP_Error()]);
        TinyAssert::same(null, WC_Twoinc_FX::get_rate($failing, 'NOK', 'EUR'));
        TinyAssert::same(1, $failing->fx_requests);
        WC_Twoinc_FX::reset_request_cache();
        TinyAssert::same(null, WC_Twoinc_FX::get_rate($failing, 'NOK', 'EUR'));
        TinyAssert::same(1, $failing->fx_requests);
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

    private static function testBuyerFeeShareFailsClosedWhenNoRateAvailable(): void
    {
        // No rate ever fetched: a wrong-currency amount must never be sent,
        // so no fee block is produced. This is the defence-in-depth
        // backstop — TWO-25269's real answer is the availability gate
        // withholding the method (see the gate tests below) — and it is
        // reported at ERROR level, because a silently dropped surcharge
        // charges the buyer nothing and tells nobody.
        $GLOBALS['__twoinc_test_currency'] = 'NOK';
        $gateway = self::fxGateway(null, [new WP_Error()], [
            'surcharge_type' => 'fixed_and_percentage',
            'surcharge_grid' => [30 => ['fixed' => 2.5, 'percentage' => 1.5, 'limit' => 10.0]],
        ]);
        TinyAssert::same(null, WC_Twoinc_Payment_Terms::build_buyer_fee_share($gateway, 30));
        self::assertLogged('error', 'no FX rate to convert configured EUR amounts to checkout currency NOK');
    }

    private static function testGateWithholdsMethodWhenSurchargeCurrencyUnquotable(): void
    {
        // TWO-25269: the fail-CLOSED answer. Surcharge enabled, store
        // currency (EUR) diverges from checkout (NOK), a term carries a
        // monetary component, and no rate exists -> the payment method is
        // withheld outright rather than the surcharge silently vanishing.
        $GLOBALS['__twoinc_test_currency'] = 'NOK';
        $gateway = self::fxGateway(null, [new WP_Error()], [
            'payment_terms_days' => [30],
            'surcharge_type' => 'fixed_and_percentage',
            'surcharge_grid' => [30 => ['fixed' => 2.5, 'percentage' => 1.5, 'limit' => 10.0]],
        ]);
        $result = $gateway->apply_brand_availability_gate(['woocommerce-gateway-tillit' => 'gw']);
        TinyAssert::true(!isset($result['woocommerce-gateway-tillit']), 'unquotable surcharge withholds the method');
        self::assertLogged('error', 'no FX rate for the configured EUR surcharge amounts in checkout currency NOK');
    }

    private static function testGateKeepsMethodWhenSurchargeIsPercentageOnly(): void
    {
        // The FX gate must not over-reject: a percentage-only surcharge is
        // currency-agnostic, so an unavailable rate is irrelevant to it and
        // the method stays offered even across currencies.
        $GLOBALS['__twoinc_test_currency'] = 'NOK';
        $gateway = self::fxGateway(null, [new WP_Error()], [
            'payment_terms_days' => [30],
            'surcharge_type' => 'percentage',
            'surcharge_grid' => [30 => ['percentage' => 1.5]],
        ]);
        $result = $gateway->apply_brand_availability_gate(['woocommerce-gateway-tillit' => 'gw']);
        TinyAssert::same('gw', $result['woocommerce-gateway-tillit']);
        TinyAssert::same(0, $gateway->fx_requests, 'a percentage-only grid must never consult the FX layer');
    }

    private static function testGateFxCheckAppliesOnOrderPayEndpoint(): void
    {
        // The minimums skip the order-pay endpoint (the session cart is not
        // the basket being paid for), but FX resolvability does not depend
        // on a basket and order-pay is exactly a place a surcharge still
        // gets applied — so the FX check sits OUTSIDE that guard.
        $GLOBALS['__twoinc_test_currency'] = 'NOK';
        $GLOBALS['__twoinc_test_is_order_pay'] = true;
        try {
            $gateway = self::fxGateway(null, [new WP_Error()], [
                'payment_terms_days' => [30],
                'surcharge_type' => 'fixed',
                'surcharge_grid' => [30 => ['fixed' => 2.5]],
            ]);
            $result = $gateway->apply_brand_availability_gate(['woocommerce-gateway-tillit' => 'gw']);
            TinyAssert::true(!isset($result['woocommerce-gateway-tillit']), 'order-pay must still be FX-gated');
        } finally {
            unset($GLOBALS['__twoinc_test_is_order_pay']);
        }
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

    private static function testBuyerFeeShareCapRoundingToZeroRelaysZeroCap(): void
    {
        // A CONFIGURED cap that rounds to 0.00 once converted is relayed AS
        // 0.00. It is NOT a failure and must never be dropped, withheld or
        // turned into "no cap": per the pricing API's contract a cap of
        // zero clamps the fee to zero, which is a different instruction
        // from an absent cap. The cap bounds the WHOLE fee line item, so
        // this zeroes any fixed surcharge alongside it too — reported at
        // info, never as a failure. Charging nothing is what a cap worth
        // nothing in this currency says. An earlier revision failed closed
        // here on the false premise that 0 read downstream as "uncapped"
        // (TWO-25269).
        $GLOBALS['__twoinc_test_currency'] = 'JPY';
        $gateway = self::fxGateway(null, [self::fxOk(['JPY' => 1000000.0])], [
            // Store currency EUR (default in these tests). The fixture
            // makes 1 JPY worth 1000000 EUR, i.e. an absurdly weak
            // EUR->JPY rate, so a 0.001 EUR cap rounds away entirely.
            'payment_terms_days' => [30],
            'surcharge_type' => 'fixed_and_percentage',
            'surcharge_grid' => [30 => ['percentage' => 1.5, 'limit' => 0.001]],
        ]);
        $share = WC_Twoinc_Payment_Terms::build_buyer_fee_share($gateway, 30);
        TinyAssert::true(is_array($share), 'a cap rounding to zero must still produce a fee block');
        TinyAssert::same(0.0, $share['cap'], 'the zero cap is relayed, not dropped');
        TinyAssert::same(1.5, $share['percentage']);
        TinyAssert::true($gateway->fx_requests > 0, 'the cross-currency conversion path must really have run');
        self::assertLogged('info', 'rounds to 0.00 in checkout currency JPY; the whole fee is capped at 0.00');
        // One line per call, and no second line beside it. (Not a
        // per-request latch: like the fixed->0.00 log next to it, this fires
        // once per term quoted, which is deliberate — a per-request latch is
        // the ERROR channel, and this is not a failure.)
        TinyAssert::same(1, count($GLOBALS['__twoinc_test_logs']), 'one info line per call, nothing beside it');
        foreach ($GLOBALS['__twoinc_test_logs'] as $entry) {
            TinyAssert::true(
                !in_array($entry['level'], ['error', 'warning'], true),
                'a zero cap is not a failure: nothing may be logged at error or warning'
            );
        }
    }

    private static function testBuyerFeeShareFixedRoundingToZeroChargesZero(): void
    {
        // A FIXED amount rounding to 0.00 is NOT a failure: a legitimately
        // tiny configured fee can be genuinely negligible in a stronger
        // currency, and 0.00 is arithmetically correct. Rejecting the
        // method because a merchant configured 0.001 would be a WRONG
        // rejection — so the quote proceeds at 0.00, logged at info, and
        // the method stays offered.
        $GLOBALS['__twoinc_test_currency'] = 'JPY';
        $gateway = self::fxGateway(null, [self::fxOk(['JPY' => 1000000.0])], [
            'payment_terms_days' => [30],
            'surcharge_type' => 'fixed',
            'surcharge_grid' => [30 => ['fixed' => 0.001]],
        ]);
        $share = WC_Twoinc_Payment_Terms::build_buyer_fee_share($gateway, 30);
        TinyAssert::true(is_array($share), 'a fixed amount rounding to zero must still produce a fee block');
        TinyAssert::same(0.0, $share['surcharge']);
        self::assertLogged('info', 'rounds to 0.00 in checkout currency JPY; charging 0.00');

        $result = $gateway->apply_brand_availability_gate(['woocommerce-gateway-tillit' => 'gw']);
        TinyAssert::same('gw', $result['woocommerce-gateway-tillit'], 'a zero-rounding fixed fee keeps the method');
    }

    private static function testBuyerFeeShareAbsentCapChargesUncappedPercentage(): void
    {
        // THE regression pin for TWO-25269 item 4: "no cap defined" is a
        // completely legitimate configuration and must keep charging a
        // non-zero surcharge, uncapped, with the method offered. Absence is
        // not the same as a cap of 0: absence means uncapped, 0 clamps the
        // fee to zero, and neither is a failure. Cross-currency so the
        // conversion path really runs with $cap === null.
        $GLOBALS['__twoinc_test_currency'] = 'NOK';
        $gateway = self::fxGateway(null, [self::fxOk(self::FX_TABLE)], [
            'payment_terms_days' => [30],
            'surcharge_type' => 'fixed_and_percentage',
            'surcharge_grid' => [30 => ['fixed' => 2.5, 'percentage' => 1.5]],
        ]);
        $share = WC_Twoinc_Payment_Terms::build_buyer_fee_share($gateway, 30);
        TinyAssert::true(is_array($share), 'an absent cap must not withhold the surcharge');
        TinyAssert::same(29.41, $share['surcharge'], 'fixed 2.50 EUR at 1/0.085 is 29.41 NOK');
        TinyAssert::same(1.5, $share['percentage']);
        TinyAssert::true(!isset($share['cap']), 'no cap configured means no cap key — the percentage is uncapped');
        TinyAssert::same(0, count($GLOBALS['__twoinc_test_logs']), 'an absent cap must not be logged as a failure');

        $result = $gateway->apply_brand_availability_gate(['woocommerce-gateway-tillit' => 'gw']);
        TinyAssert::same('gw', $result['woocommerce-gateway-tillit'], 'an absent cap must keep the method offered');
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

    /**
     * Scratch component dir containing a plugin main file, plus whichever
     * of the two provenance sources the caller asked for. Returns the dir.
     */
    private static function makeComponentDir(array $files): string
    {
        $dir = sys_get_temp_dir() . '/twoinc-prov-' . bin2hex(random_bytes(6));
        mkdir($dir, 0777, true);
        file_put_contents($dir . '/main.php', "<?php\n");
        foreach ($files as $name => $contents) {
            file_put_contents($dir . '/' . $name, $contents);
        }
        return $dir;
    }

    private static function removeComponentDir(string $dir): void
    {
        foreach ((array) glob($dir . '/{,.}*', GLOB_BRACE) as $path) {
            if (is_file($path)) {
                unlink($path);
            }
        }
        if (is_dir($dir)) {
            rmdir($dir);
        }
    }

    private static function provenanceOf(string $dir, string $version): string
    {
        $method = new ReflectionMethod(WC_Twoinc::class, 'describe_component_provenance');
        $method->setAccessible(true);
        return $method->invoke(null, $dir . '/main.php', $version);
    }

    private static function clientVersion(): string
    {
        $method = new ReflectionMethod(WC_Twoinc::class, 'client_version');
        $method->setAccessible(true);
        return $method->invoke(null);
    }

    private static function testDeployedCommitGitlinkWinsOverSidecar(): void
    {
        // The gitlink reflects what is checked out RIGHT NOW; the sidecar is
        // frozen at the build that stamped it, so when both are present the
        // gitlink is authoritative (org-wide order, TWO-25196).
        $gitlink = 'gitdir: /var/sync/worktrees/' . str_repeat('a', 40) . "\n";
        $dir = self::makeComponentDir([
            '.two-deployed-commit' => "deadbee\n",
            '.git' => $gitlink,
        ]);
        try {
            $described = self::provenanceOf($dir, '2.23.9');
            TinyAssert::true(strpos($described, '2.23.9 (aaaaaaaaaaaa,') === 0, $described);
        } finally {
            self::removeComponentDir($dir);
        }
    }

    private static function testGarbageOrEmptySidecarFallsThroughToGitlink(): void
    {
        // An empty or non-hex sidecar must not win, and must not suppress
        // the gitlink that git-synced shops still rely on.
        $sha = str_repeat('b', 40);
        $gitlink = 'gitdir: /var/sync/worktrees/' . $sha . "\n";
        foreach (["\n", '   ', 'not-a-sha', 'abc', str_repeat('f', 41)] as $junk) {
            $dir = self::makeComponentDir([
                '.two-deployed-commit' => $junk,
                '.git' => $gitlink,
            ]);
            try {
                $described = self::provenanceOf($dir, '2.23.9');
                TinyAssert::true(strpos($described, '2.23.9 (bbbbbbbbbbbb,') === 0, $described);
            } finally {
                self::removeComponentDir($dir);
            }
        }
    }

    private static function testGarbageOrEmptyGitlinkFallsThroughToSidecar(): void
    {
        // Mirror of the above now that the gitlink is first: a `.git` file
        // that carries no usable SHA (submodule pointer, plain gitdir, too
        // few hex chars) must fall through to the sidecar, not to null.
        $pointers = [
            "\n",
            '   ',
            'gitdir: ../.git/modules/twoinc',
            'gitdir: /var/sync/worktrees/abcdef',
            'gitdir: /var/sync/worktrees/' . str_repeat('f', 41),
            'ref: refs/heads/staging',
        ];
        foreach ($pointers as $pointer) {
            $dir = self::makeComponentDir([
                '.two-deployed-commit' => "deadbee\n",
                '.git' => $pointer,
            ]);
            try {
                $described = self::provenanceOf($dir, '2.23.9');
                TinyAssert::true(strpos($described, '2.23.9 (deadbee,') === 0, $described);
            } finally {
                self::removeComponentDir($dir);
            }
        }
    }

    private static function testNoProvenanceSourcesYieldsBareVersion(): void
    {
        $dir = self::makeComponentDir([]);
        try {
            TinyAssert::same('2.23.9', self::provenanceOf($dir, '2.23.9'));
        } finally {
            self::removeComponentDir($dir);
        }
    }

    private static function testClientVersionNeverEmitsTrailingPlus(): void
    {
        // No sidecar and no gitlink SHA in the checkout: client_v is the
        // bare version, never "2.23.9+".
        $GLOBALS['__twoinc_test_plugin_version'] = '2.23.9';
        try {
            $value = self::clientVersion();
            TinyAssert::same('2.23.9', $value);
            TinyAssert::true(substr($value, -1) !== '+', $value);
        } finally {
            unset($GLOBALS['__twoinc_test_plugin_version']);
        }
    }

    private static function testClientVersionSuffixesShortShaWhenStamped(): void
    {
        // With the release stamp present, client_v carries the 7-char SHA.
        $stamp = WC_TWOINC_PLUGIN_PATH . '.two-deployed-commit';
        $preexisting = is_file($stamp) ? file_get_contents($stamp) : null;
        $GLOBALS['__twoinc_test_plugin_version'] = '2.23.9';
        file_put_contents($stamp, "1a2b3c4\n");
        try {
            TinyAssert::same('2.23.9+1a2b3c4', self::clientVersion());
        } finally {
            unset($GLOBALS['__twoinc_test_plugin_version']);
            if ($preexisting === null) {
                unlink($stamp);
            } else {
                file_put_contents($stamp, $preexisting);
            }
        }
    }

    private static function testClientVersionIsQueryEncodedAsPlus(): void
    {
        // make_request builds its query with http_build_query, which
        // percent-encodes '+' as %2B. A literal '+' would decode to a
        // space server-side, so this encoding is load-bearing.
        TinyAssert::same(
            'client_v=2.23.9%2B1a2b3c4',
            http_build_query(['client_v' => '2.23.9+1a2b3c4'])
        );
    }

    /**
     * Brand file declaring a tagline, so the tagline block renders. Uses an
     * inline filter rather than the shared testbrand fixture, which other
     * specs assert against.
     */
    private static function useTaglineBrand(): void
    {
        add_filter('twoinc_brand_file', static function ($file) {
            return __DIR__ . '/fixtures/taglinebrand.php';
        });
    }

    /**
     * The payment box must order the brand tagline above the term
     * chips, and the chips above the sole-trader toggle, matching the
     * Magento Luma renderer. Pinned because the whole box is one
     * concatenated string, so ordering is a silent, easy regression.
     */
    private static function testPaymentBoxOrdersTaglineChipsThenSoleTrader(): void
    {
        self::useTaglineBrand();
        $html = self::gateway()->build_payment_description();

        $tagline = strpos($html, 'twoinc-payment-subtitle');
        $chips = strpos($html, 'twoinc-term-chips');
        $sole_trader = strpos($html, 'twoinc-sole-trader-toggle');
        $about = strpos($html, 'abt-twoinc');

        TinyAssert::true($tagline !== false, 'tagline block missing');
        TinyAssert::true($chips !== false, 'chips container missing');
        TinyAssert::true($sole_trader !== false, 'sole-trader toggle missing');
        TinyAssert::true($about !== false, 'about block missing');

        TinyAssert::true($tagline < $chips, 'tagline must precede the chips');
        TinyAssert::true($chips < $sole_trader, 'chips must precede the sole-trader toggle');
        TinyAssert::true($sole_trader < $about, 'about block must trail the box');
    }

    /**
     * The chips JS appends its own copy of the selected-term input inside
     * the chips container, and the LAST such input wins the POST. The
     * server-rendered one must therefore stay ahead of the container, or a
     * stale server value would override the buyer's chip selection.
     */
    private static function testSelectedTermInputPrecedesChipsContainer(): void
    {
        self::useTaglineBrand();
        // Payment terms must actually be enabled, or the input is never
        // rendered and this asserts nothing.
        $gateway = new class extends WC_Twoinc {
            public function __construct()
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
            }

            public function get_merchant_available_terms(bool $refresh = false): array
            {
                return [14, 30, 60];
            }

            public function get_option($key, $empty_value = null)
            {
                if ($key === 'payment_terms_days') {
                    return [14, 30, 60];
                }
                return $empty_value ?? '';
            }
        };

        $html = $gateway->build_payment_description();
        $input = strpos($html, WC_Twoinc_Payment_Terms::SESSION_KEY);
        $chips = strpos($html, 'twoinc-term-chips');

        TinyAssert::true($input !== false, 'server-rendered term input missing');
        TinyAssert::true(
            $input < $chips,
            'server-rendered term input must precede the chips container'
        );
    }

    /**
     * A brand leaving checkout_subtitle_faq_url unset (the Two default)
     * emits no tagline wrapper at all — the reorder must not introduce an
     * empty div into vanilla checkout.
     */
    private static function testBrandWithoutTaglineEmitsNoTaglineBlock(): void
    {
        $html = self::gateway()->build_payment_description();
        TinyAssert::same(null, WC_Twoinc_Brand::get('checkout_subtitle_faq_url'));
        TinyAssert::true(
            strpos($html, 'twoinc-payment-subtitle') === false,
            'a brand with no tagline must emit no tagline block'
        );
    }

    /**
     * The tagline sentence is platform copy (a literal msgid gettext can
     * extract) and the brand contributes only the FAQ link target. Pinned
     * because the previous shape handed the whole sentence to __() as a
     * variable msgid, which no catalogue can ever carry (TWO-25270): a
     * brand's source-language tagline then rendered on every locale.
     */
    private static function testTaglineSentenceIsPlatformCopyWithBrandFaqLink(): void
    {
        self::useTaglineBrand();
        $html = self::gateway()->get_pay_subtitle();

        TinyAssert::same(
            '<div class="twoinc-payment-subtitle">For all companies, '
                . '<a href="https://taglinebrand.example/faq" target="_blank" rel="noopener">'
                . 'read more</a>.</div>',
            $html
        );

        // The literal passed to __() must appear verbatim in the catalogues,
        // or the string is unreachable for translators however it renders.
        $languages = dirname(__DIR__, 2) . '/languages/';
        $pot = file_get_contents($languages . 'twoinc-payment-gateway.pot');
        TinyAssert::true(
            strpos($pot, 'msgid "For all companies, %1$sread more%2$s."') !== false,
            'tagline msgid missing from the .pot — it would be untranslatable'
        );

        // And every locale that ships a tagline translation must still
        // carry it. Asserted against the COMPILED .mo, not the .po:
        // WordPress reads only the .mo, the pair is hand-maintained, and
        // the two ways this silently reverts to English on a Dutch shop —
        // a forgotten msgfmt, or a fuzzy marker (which msgfmt drops) — are
        // both invisible in the .po text. Binary strpos is enough: msgstrs
        // are stored verbatim in the .mo string table.
        $translated = [
            'nl_NL' => 'Voor alle bedrijven, %1$slees meer%2$s.',
            'nb_NO' => 'For alle bedrifter, %1$sles mer%2$s.',
            'sv_SE' => 'För alla företag, %1$släs mer%2$s.',
        ];
        foreach ($translated as $locale => $msgstr) {
            $mo = file_get_contents($languages . 'twoinc-payment-gateway-' . $locale . '.mo');
            TinyAssert::true(
                strpos($mo, $msgstr) !== false,
                "compiled $locale catalogue carries no tagline translation — that shop "
                    . 'would render English (recompile with msgfmt?)'
            );
            // The msgid has to match the source literal too, or the lookup
            // misses and WordPress renders English however good the msgstr
            // is. A msgid typo is otherwise undetectable here: __() is
            // stubbed to identity, so the render assertion above cannot see
            // it.
            TinyAssert::true(
                strpos($mo, 'For all companies, %1$sread more%2$s.') !== false,
                "compiled $locale msgid has drifted from the source literal"
            );
        }
        // Both placeholders are pinned by that same match, which carries
        // them verbatim — a msgstr that dropped %2$s would sprintf an
        // unclosed <a>, and wp_kses_post does not balance tags, so the
        // anchor would swallow the payment box. Asserting %1$s/%2$s
        // anywhere in a .mo separately would be vacuous: other msgstrs in
        // these catalogues carry both.
    }

    /**
     * The retired 'checkout_subtitle' key is inert: a brand declaring a
     * whole sentence there gets no tagline at all, never that sentence.
     * Pinned so a "legacy support" path cannot quietly restore the
     * variable-msgid render that made the tagline untranslatable.
     */
    private static function testRetiredFreeFormSubtitleKeyIsInert(): void
    {
        add_filter('twoinc_brand_file', static function () {
            return __DIR__ . '/fixtures/legacysubtitlebrand.php';
        });

        TinyAssert::same('', self::gateway()->get_pay_subtitle());
    }

    /**
     * A non-string FAQ URL yields no tagline rather than reaching esc_url,
     * which fatals on an array under PHP 8 and would take the checkout page
     * down. What this pins is the guard, not the fatal: the harness stubs
     * esc_url as identity (so dropping is_string fails here on the rendered
     * href, not on a TypeError), and for the same reason the sibling case —
     * a scheme real esc_url rejects, returning '' for the same guard to
     * drop — cannot be exercised at all.
     */
    private static function testNonStringBrandFaqUrlEmitsNoTagline(): void
    {
        add_filter('twoinc_brand_file', static function () {
            return __DIR__ . '/fixtures/badfaqurlbrand.php';
        });

        TinyAssert::same('', self::gateway()->get_pay_subtitle());
    }

    /**
     * The off switch: 'intent_approved_notice_enabled' => false suppresses
     * the notice entirely — no markup at all, since an empty div would
     * still occupy the payment box's spacing. Also pins that a `false`
     * overlay value survives the brand merge: array_merge keeps it, but a
     * falsy-means-absent filter anywhere in the loader would silently
     * turn the switch back on.
     */
    private static function testIntentApprovedNoticeDisabledBrandEmitsNoBlock(): void
    {
        add_filter('twoinc_brand_file', static function ($file) {
            return __DIR__ . '/fixtures/suppressednoticebrand.php';
        });
        TinyAssert::same(false, WC_Twoinc_Brand::get('intent_approved_notice_enabled'));

        $html = self::gateway()->build_payment_description();
        TinyAssert::true(
            strpos($html, 'twoinc-intent-approved') === false,
            'a brand disabling the notice must emit no notice block'
        );
    }

    /**
     * Switch on, no copy override (the Two defaults): the platform default
     * copy renders. The div's text is the no-company sentence and
     * data-company-template carries the company variant with the brand
     * name already resolved and the company name left as a token — the
     * server cannot know the buyer's company, so the JS substitutes it.
     */
    private static function testIntentApprovedNoticeDefaultBrandCarriesBothVariants(): void
    {
        TinyAssert::same(true, WC_Twoinc_Brand::get('intent_approved_notice_enabled'));
        TinyAssert::same(null, WC_Twoinc_Brand::get('intent_approved_notice'));

        $html = self::gateway()->build_payment_description();
        TinyAssert::true(
            strpos($html, 'twoinc-pay-box twoinc-intent-approved hidden') !== false,
            'the default brand must emit the notice block'
        );
        TinyAssert::true(
            strpos($html, 'Your invoice with Two is likely to be accepted, subject to additional checks.') !== false,
            'the notice text must be the no-company variant'
        );
        TinyAssert::true(
            strpos(
                $html,
                'data-company-template="Your invoice with Two is likely to be accepted for {company},'
                . ' subject to additional checks."'
            ) !== false,
            'the notice must carry the company variant, brand name resolved, company name tokenised'
        );
    }

    /**
     * The copy override: a non-empty brand string is the company-variant
     * template, used verbatim. The no-company fallback stays the platform
     * default — this layer cannot drop a clause out of arbitrary copy.
     */
    private static function testIntentApprovedNoticeBrandTemplateUsedVerbatim(): void
    {
        add_filter('twoinc_brand_file', static function ($file) {
            return __DIR__ . '/fixtures/customnoticebrand.php';
        });

        $html = self::gateway()->build_payment_description();
        TinyAssert::true(
            strpos($html, 'data-company-template="Brand copy: Customnoticebrand may accept this for {company}."') !== false,
            'a brand template must be used verbatim for the company variant'
        );
        TinyAssert::true(
            strpos($html, 'Your invoice with Customnoticebrand is likely to be accepted, subject to additional checks.') !== false,
            'the no-company fallback stays the platform default copy'
        );
    }

    /**
     * Empty and whitespace-only copy overrides are INERT (TWO-25218): both
     * render the platform default copy with the notice ON. '' used to mean
     * "suppressed"; a stale overlay still carrying one must degrade to the
     * default wording, not to a broken store and not to a silent off.
     */
    private static function testIntentApprovedNoticeEmptyCopyOverrideIsInert(): void
    {
        foreach (['inertemptynoticebrand', 'blanknoticecopybrand'] as $fixture) {
            WC_Twoinc_Brand::reset();
            remove_all_filters('twoinc_brand_file');
            add_filter('twoinc_brand_file', static function ($file) use ($fixture) {
                return __DIR__ . '/fixtures/' . $fixture . '.php';
            });

            $product = WC_Twoinc_Brand::get('product_name');
            $html = self::gateway()->build_payment_description();
            TinyAssert::true(
                strpos($html, 'twoinc-pay-box twoinc-intent-approved hidden') !== false,
                $fixture . ': an inert copy override must still emit the notice block'
            );
            TinyAssert::true(
                strpos($html, 'Your invoice with ' . $product . ' is likely to be accepted, subject to additional checks.') !== false,
                $fixture . ': an inert copy override must render the platform default copy'
            );
            TinyAssert::true(
                strpos(
                    $html,
                    'data-company-template="Your invoice with ' . $product
                    . ' is likely to be accepted for {company}, subject to additional checks."'
                ) !== false,
                $fixture . ': the company variant must be the platform default copy too'
            );
        }
    }

    /**
     * Absent switch means the documented default true. Unreachable through
     * a brand file (brands/two.php always declares the key), so the
     * resolved config is reflected into the loader with the key removed —
     * which is the shape a brand overlay predating the key resolves to
     * against a stale base.
     */
    private static function testIntentApprovedNoticeSwitchAbsentDefaultsOn(): void
    {
        $config = WC_Twoinc_Brand::config();
        unset($config['intent_approved_notice_enabled']);
        $cache = new ReflectionProperty(WC_Twoinc_Brand::class, 'config');
        $cache->setAccessible(true);
        $cache->setValue(null, $config);

        TinyAssert::same(null, WC_Twoinc_Brand::get('intent_approved_notice_enabled'));
        TinyAssert::true(
            strpos(self::gateway()->build_payment_description(), 'twoinc-intent-approved') !== false,
            'an absent switch must default to the notice being shown'
        );
        TinyAssert::same([], $GLOBALS['__twoinc_test_logs'], 'absent is the documented default, not an error');
    }

    /**
     * Must not regress: a third-party overlay declaring NEITHER notice key
     * keeps the notice ON, with the platform default copy.
     */
    private static function testIntentApprovedNoticeOverlayDeclaringNothingKeepsNoticeOn(): void
    {
        add_filter('twoinc_brand_file', static function ($file) {
            return __DIR__ . '/fixtures/silentnoticebrand.php';
        });
        TinyAssert::same('silentnoticebrand', WC_Twoinc_Brand::get('code'));

        $html = self::gateway()->build_payment_description();
        TinyAssert::true(
            strpos($html, 'twoinc-pay-box twoinc-intent-approved hidden') !== false,
            'an overlay with no notice opinion must keep the notice on'
        );
        TinyAssert::true(
            strpos($html, 'Your invoice with Silentnoticebrand is likely to be accepted, subject to additional checks.') !== false,
            'and must render the platform default copy'
        );
    }

    /**
     * A non-bool switch is a reported error and then the documented
     * default true — never a silent third behaviour, and never a throw on
     * a buyer-facing render. The log line has to name the key, the
     * offending value's type and the brand code, or a store operator
     * cannot act on it.
     */
    private static function testIntentApprovedNoticeInvalidSwitchReportsAndDefaultsOn(): void
    {
        add_filter('twoinc_brand_file', static function ($file) {
            return __DIR__ . '/fixtures/invalidnoticeswitchbrand.php';
        });
        TinyAssert::same('', WC_Twoinc_Brand::get('intent_approved_notice_enabled'));

        $html = self::gateway()->build_payment_description();
        TinyAssert::true(
            strpos($html, 'twoinc-pay-box twoinc-intent-approved hidden') !== false,
            'an invalid switch must fall back to the notice being shown'
        );

        TinyAssert::same(1, count($GLOBALS['__twoinc_test_logs']), 'the invalid switch must be reported exactly once');
        $entry = $GLOBALS['__twoinc_test_logs'][0];
        TinyAssert::same('error', $entry['level']);
        TinyAssert::same('twoinc-payment-gateway', $entry['context']['source'] ?? null);
        TinyAssert::true(
            strpos($entry['message'], 'intent_approved_notice_enabled') !== false,
            'the log line must name the offending key'
        );
        TinyAssert::true(
            strpos($entry['message'], 'string') !== false,
            'the log line must name the offending value type'
        );
        TinyAssert::true(
            strpos($entry['message'], 'invalidnoticeswitchbrand') !== false,
            'the log line must name the brand code'
        );
    }

    /**
     * The order-intent loading state renders the shared three-dot pulse,
     * decorative dots plus an announced accessible name — not the old
     * rotating image, and not a second copy of the dot animation. The CSS
     * assertions are the point of the refactor: one .twoinc-dots rule and
     * one keyframes block serve both the term chips and this loader.
     */
    private static function testIntentLoaderRendersTheOneSharedDotPulse(): void
    {
        $html = self::gateway()->build_payment_description();
        TinyAssert::true(
            strpos($html, '<div class="twoinc-pay-box twoinc-loader hidden" role="status">') !== false,
            'the loader keeps its pay-box state class and announces itself'
        );
        TinyAssert::true(
            strpos($html, '<span class="twoinc-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>')
                !== false,
            'the loader must render the shared dot markup, dots hidden from assistive technology'
        );

        $css = (string) file_get_contents(dirname(__DIR__, 2) . '/assets/css/twoinc.css');
        TinyAssert::true(
            strpos($css, '.twoinc-dots {') !== false,
            'the shared dot rule must exist'
        );
        TinyAssert::same(
            1,
            preg_match_all('/@keyframes\s+twoinc-dot-pulse/', $css),
            'exactly one dot animation may be declared'
        );
        TinyAssert::same(
            0,
            preg_match_all('/@keyframes\s+spin|loader\.svg/', $css),
            'the retired rotating spinner must be gone from the stylesheet'
        );
    }

    /**
     * TWO-25224: the switch governs the reassurance messaging around the
     * order-intent pre-check, and the loading state is part of that — a
     * brand that declined the approval sentence was still announcing
     * "Checking your order, one moment." while the check ran.
     *
     * The two ERROR boxes are deliberately NOT gated: a merchant who wants
     * no reassurance still needs failures surfaced, or a declined buyer
     * sees nothing at all. This test fails if either half regresses — the
     * loader coming back, or the error boxes disappearing with it.
     */
    private static function testIntentLoaderSuppressedWithTheNoticeButErrorBoxesSurvive(): void
    {
        add_filter('twoinc_brand_file', static function ($file) {
            return __DIR__ . '/fixtures/suppressednoticebrand.php';
        });
        TinyAssert::same(false, WC_Twoinc_Brand::get('intent_approved_notice_enabled'));

        $html = self::gateway()->build_payment_description();
        TinyAssert::true(
            strpos($html, 'twoinc-loader') === false,
            'a brand disabling the notice must emit no order-intent loading state'
        );
        TinyAssert::true(
            strpos($html, 'Checking your order') === false,
            'and none of the loading copy either, not even as a screen-reader name'
        );
        TinyAssert::true(
            strpos($html, 'twoinc-pay-box twoinc-err-payment-default hidden') !== false,
            'the default payment error box must survive the notice being off'
        );
        TinyAssert::true(
            strpos($html, 'twoinc-pay-box twoinc-err-phone-number hidden') !== false,
            'the phone-number error box must survive the notice being off'
        );
    }
}

BrandConfigSpec::runAll();
print("All tests passed.\n");
