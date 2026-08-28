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
            'testFieldPrioritiesMatchDesiredCheckoutOrder',
            'testBillingCompanyDisplayAlwaysRegisteredRegardlessOfCheckbox',
            'testNativeBillingCompanyRegisteredWhenCoreDropsIt',
            'testNativeBillingCompanyNeverOverwritten',
            'testCompanyPriorityClampPreventsInversionAboveOptionals',
            'testLocaleDefaultCountryPriorityStaysBelowCompany',
            'testBuyerCompanyNameComesFromTheCapture',
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
            'testSurchargeRefusalIsVisibleAndNothingPartiallySaves',
            'testCustomPaymentTermFieldHiddenUnlessGenuinelyCustom',
            'testCustomPaymentTermReconciledOnSaveWhenItMatchesATickedPreset',
            'testCustomPaymentTermTicksAnUnofferedButOfferedUntickedMatch',
            'testCustomPaymentTermNotReconciledWhenGenuinelyCustom',
            'testZeroCapOnAnUnrenderedRowDoesNotBlockEnabling',
            'testDisablingSurchargesIsNeverBlockedByAZeroCap',
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
            'testSoleTraderTokensEchoNormalisedCountry',
            'testSoleTraderHasNoMerchantToggleSetting',
            'testSkipConfirmAuthRendersUnderDebugOptions',
            'testSkipConfirmAuthStoredValueSurvivesSectionMove',
            'testSkipConfirmAuthCopyIsTranslatedInEveryLocale',
            'testDisableSslVerifyRendersUnderDiagnostics',
            'testVendorNameFieldHasCaptionAndHelpText',
            'testFormFieldDescriptionsUseOverlayProductNameNotTwo',
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
            'testDevHostOverridesAreIndependentAndProductionSafe',
            'testOrderEditNeverCarriesTheOrganisationNumber',
            'testCompanyIdFieldHasNoFormatValidationToTripOverAPrefixedNumber',
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
            'testGateKeepsMethodWhenTheOnlyMonetaryComponentIsAZeroCap',
            'testBuyerFeeShareTreatsANegativeStoredCapAsAbsent',
            'testGateFxCheckAppliesOnOrderPayEndpoint',
            'testBuyerFeeShareSameCurrencyNeverTouchesFx',
            'testBuyerFeeShareRelaysAConfiguredZeroCapVerbatim',
            'testBuyerFeeShareRoundsMonetaryValuesToTwoDecimalPlaces',
            'testFeeRequestGrossAmountIsRoundedToTwoDecimalPlaces',
            'testBuyerFeeShareCapRoundingToZeroRelaysZeroCap',
            'testBuyerFeeShareFixedRoundingToZeroChargesZero',
            'testBuyerFeeShareAbsentCapChargesUncappedPercentage',
            'testStoredCommaDecimalCapIsNormalisedNotDropped',
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
            'testPaymentBoxRendersCompanySearchTileSlotBetweenSoleTraderAndIntentMessage',
            'testDeclinedBoxCarriesCompanyTemplate',
            'testDeclinedNoticeIgnoresABrandOverrideKey',
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
            'testIntentLoaderRendersTheSharedSpinnerAndVisibleText',
            'testIntentVerdictBoxesHoldABareSentence',
            'testIntentVerdictBoxesAreAnnounced',
            'testIntentLoaderCopyIsTranslatedInEveryLocale',
            'testCompanyRequiredCopyIsTranslatedInEveryLocale',
            'testPoTranslationParserRejectsWhatItMustReject',
            'testIntentLoaderSuppressedWithTheNoticeButErrorBoxesSurvive',
            'testCompanySearchTileSlotAndDeclinedTemplateSurviveNoticeSuppression',
            'testAssetVersionTracksFileMtimeNotPluginVersion',
            'testAssetVersionFallsBackToPluginVersionWhenFileMissing',
            'testCompanySearchLocationDerivedFromEnableCompanySearchBothDirections',
            'testCompanySearchLocationFallsBackToPaymentTileOnNullOrEmpty',
            'testCompanySearchLocationSettingDroppedFromUpgradedInstalls',
            'testEnableCompanySearchForOthersSettingDroppedFromUpgradedInstalls',
            'testCategorizeVerificationResultDistinguishesFailureReasons',
            'testVerifyApiKeyDistinguishesUnreachableFromNotConfigured',
            'testApiKeyVerificationStatusCachedAcrossCallsWithinTtl',
            'testIsAvailableFalseWhenApiKeyVerificationFails',
            'testIsAvailableTrueOnlyWhenEnabledAndVerified',
            'testCheckoutWindowTwoincSuppressedOnVerificationFailure',
            'testVerifyApiKeyMalformedResponseNotMiscategorizedAsNotConfigured',
            'testAdminLiveVerificationWarmsCheckoutCache',
            'testCachedStatusMissTimeoutIsShortNotAdminDefault',
            'testApiKeyNoticesCarryTwoProductNameAndStatusPlaceholder',
            'testApiKeyNoticesUseOverlayProductNameNotTwo',
            'testApiKeyNoticeCatalogueWithBadPlaceholdersDegradesNotFatals',
            'testApiKeyNoticesNeverShipAnUnfillablePlaceholder',
            'testApiKeyNoticeDroppingTheStatusPlaceholderDegrades',
            'testApiKeyNoticeCopyIsTranslatedInEveryLocale',
            'testFulfilmentTriggerStatusesDefaultToCompleted',
            'testFulfilmentTriggerStatusesNormalizeWcPrefix',
            'testFulfilmentTriggerStatusHonoursMerchantConfiguredNonCompletedStatus',
            'testFulfilmentTriggerStatusDoesNotFireForUnconfiguredStatus',
            'testFulfilmentTriggerExcludesCancelledAndRefundedFromOptionsAndStoredValue',
            'testCancelledOrderNeverMisdispatchesAsFulfilmentEvenIfConfiguredAsTrigger',
            'testShouldDisableSslVerifyFollowsToggleInEveryEnvironment',
            'testPaymentSubtitlePrefersMerchantFreeTextOverBrandTagline',
            'testPaymentSubtitleFallsBackToBrandTaglineWhenBlank',
            'testTaxSubtotalsRequiredWhenMerchantOptsIn',
            'testTaxSubtotalsSettingIsOnByDefaultForNewInstalls',
            'testSeTaxSubtotalsBackfill',
            'testSeTaxSubtotalsBackfillDoesNotUndoAMerchantOptOut',
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
        unset($GLOBALS['__twoinc_test_price_decimals']);
        // The STORE currency is a separate global from the ACTIVE one
        // (bootstrap.php stubs get_option('woocommerce_currency') and
        // get_woocommerce_currency() independently), and it was never reset
        // here. The whole suite runs in one process, so a test that set it
        // and then failed an assertion before its own unset leaked a
        // non-default store currency into every test after it — turning one
        // failure into a cascade in unrelated specs. Reset both together.
        unset($GLOBALS['__twoinc_test_store_currency']);
        unset($GLOBALS['__twoinc_test_base_country']);
        unset($GLOBALS['test_home_url']);
        // Developer host overrides (TWO-40 §9). Real process env vars, so a
        // test that sets one and then fails an assertion before its own
        // cleanup would leak it into every test after it.
        foreach (WC_Twoinc_Helper::DEV_HOST_ENV_VARS as $var) {
            putenv($var);
        }
        $GLOBALS['__twoinc_test_options'] = [];
        unset($_POST[WC_Twoinc_Payment_Terms::SESSION_KEY]);
        WC_Twoinc_Payment_Terms::reset_fee_cache();
        WC_Twoinc_Sole_Trader::reset_cache();
        WC_Twoinc::reset_merchant_record_memo();
        WC_Twoinc_FX::reset_request_cache();
        unset($GLOBALS['__twoinc_test_translations']);
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

    /**
     * #33 — Doug's desired checkout field order: name -> country -> company
     * -> native address fields -> phone/email -> every optional field at the
     * bottom. The optional fields must land after phone/email (WC's native
     * priorities 100/110) regardless of company's own priority, so they
     * can't drift back up if company's position ever changes.
     */
    private static function testFieldPrioritiesMatchDesiredCheckoutOrder(): void
    {
        $gateway = new class () extends WC_Twoinc {
            public function __construct()
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
            }

            public function get_option($key, $empty_value = null)
            {
                $enabled = [
                    'add_field_invoice_email',
                    'add_field_purchase_order_number',
                    'add_field_project',
                    'add_field_department',
                ];
                return in_array($key, $enabled, true) ? 'yes' : '';
            }

            public function get_enable_company_search()
            {
                return 'yes';
            }
        };

        $checkout = new WC_Twoinc_Checkout($gateway);

        $fields = [
            'billing' => [
                'billing_first_name' => ['priority' => 10],
                'billing_last_name' => ['priority' => 20],
                'billing_company' => ['priority' => 30],
                'billing_address_1' => ['priority' => 50],
                'billing_address_2' => ['priority' => 60],
                'billing_city' => ['priority' => 70],
                'billing_postcode' => ['priority' => 90],
                'billing_phone' => ['priority' => 100],
                'billing_email' => ['priority' => 110],
            ],
        ];

        $fields = $checkout->move_country_field($fields);
        $fields = $checkout->update_company_fields($fields);

        $billing = $fields['billing'];
        $p = static function (string $key) use ($billing) {
            return $billing[$key]['priority'];
        };

        // Country lands right after last name, before company — checked
        // against BOTH the native (possibly-hidden) billing_company field
        // and the visible billing_company_display field, not just one:
        // the two are set independently (update_company_fields() derives
        // company_display's priority from billing_company's, but nothing
        // enforces they stay linked at every call site), so a regression
        // that only re-inverts one of them must still fail this test (#33).
        TinyAssert::true($p('billing_last_name') < $p('billing_country'), 'country must be after last name');
        TinyAssert::true($p('billing_country') < $p('billing_company'), 'country must be before native billing_company');
        TinyAssert::true($p('billing_country') < $p('billing_company_display'), 'country must be before billing_company_display');

        // Every optional field sits after native phone/email, i.e. at the
        // very bottom, regardless of company's own priority.
        foreach (['invoice_email', 'purchase_order_number', 'project', 'department'] as $optional) {
            TinyAssert::true(
                $p('billing_email') < $p($optional),
                $optional . ' must sit after billing_email (native priority 110)'
            );
        }

        // And they preserve their own documented mutual order.
        TinyAssert::true($p('invoice_email') < $p('purchase_order_number'));
        TinyAssert::true($p('purchase_order_number') < $p('project'));
        TinyAssert::true($p('project') < $p('department'));
    }

    /**
     * TWO-25326 §7.1, correction 2026-08-04 round 3 (Doug's ruling). The ONE
     * company-search control must always be registered by
     * update_company_fields() — the checkbox this ticket is about
     * ("Enable company search in address entry") only ever decides WHERE it
     * renders (address area vs payment tile, via `company_search_location`
     * — see derive_company_search_location() and
     * twoincDomHelper.syncCompanySearchTileLocation() in twoinc.js), never
     * whether it exists. A gate here that skips registration when the
     * checkbox is unchecked is exactly the bug this correction closes: the
     * payment-tile relocation JS then has nothing to move, and the buyer
     * sees no working search anywhere on the page. Checked in both
     * directions so a regression that reintroduces the gate in either
     * direction fails here rather than only live.
     */
    private static function testBillingCompanyDisplayAlwaysRegisteredRegardlessOfCheckbox(): void
    {
        foreach (['yes', 'no', null, ''] as $enableCompanySearch) {
            $gateway = new class ($enableCompanySearch) extends WC_Twoinc {
                private $enable_company_search;

                public function __construct($enable_company_search)
                {
                    $this->id = WC_Twoinc_Brand::get('gateway_id');
                    $this->enable_company_search = $enable_company_search;
                }

                public function get_option($key, $empty_value = null)
                {
                    return '';
                }

                public function get_enable_company_search()
                {
                    return $this->enable_company_search;
                }
            };

            $checkout = new WC_Twoinc_Checkout($gateway);
            $fields = $checkout->update_company_fields(['billing' => []]);

            TinyAssert::true(
                isset($fields['billing']['billing_company_display']),
                'billing_company_display must be registered when get_enable_company_search() returns ' . var_export($enableCompanySearch, true)
            );

            // The capture popover anchors to a text input; a <select> here
            // gives it nothing to attach to and no value to paint into.
            TinyAssert::same('text', $fields['billing']['billing_company_display']['type']);
            TinyAssert::same(false, isset($fields['billing']['billing_company_display']['options']));
        }
    }

    /**
     * Doug, 2026-08-19 (#486). WooCommerce core DELETES its own company field
     * — `unset($fields['company'])` in
     * WC_Countries::get_default_address_fields() — when
     * `woocommerce_checkout_company_field` reads 'hidden', which is also that
     * option's default on any store whose default checkout is the block
     * checkout. `#billing_company_field` was then absent from the rendered DOM
     * entirely (live-confirmed on staging), and it is one of the two
     * company-NAME surfaces toggleBusinessFields() chooses between, the field
     * WooCommerce POSTs the captured name in, and where the "search for
     * company" affordance is appended. Registering it here puts it beyond that
     * store-level toggle, exactly as billing_company_display/company_id
     * already are.
     *
     * `['billing' => []]` is precisely the shape the filter chain hands over
     * on such a store, so this is the real case, not a synthetic one.
     */
    private static function testNativeBillingCompanyRegisteredWhenCoreDropsIt(): void
    {
        $gateway = new class () extends WC_Twoinc {
            public function __construct()
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
            }

            public function get_option($key, $empty_value = null)
            {
                return '';
            }
        };

        // Production filter order: move_country_field at priority 20, then
        // update_company_fields at 23. That order is load-bearing here —
        // move_country_field runs while billing_company is still absent and has
        // only its own `?? 30` fallback to position country against, and this
        // registration has to land at the priority that fallback assumed (#33).
        $checkout = new WC_Twoinc_Checkout($gateway);
        $fields = $checkout->move_country_field(['billing' => []]);
        $fields = $checkout->update_company_fields($fields);

        TinyAssert::true(
            isset($fields['billing']['billing_company']),
            'billing_company must be registered even when core dropped it'
        );
        // Optional server-side: required-ness is decided client-side per
        // capture mode and per payment method (toggleBusinessFields'
        // requiredTargets). A server-side `required` would make every non-Two
        // checkout unsubmittable without a company name.
        TinyAssert::true(
            $fields['billing']['billing_company']['required'] === false,
            'billing_company must not be server-side required'
        );
        // NOT pre-hidden, unlike billing_company_display and company_id: this
        // is the surface a manual-entry buyer sees, and it must be on screen
        // before this plugin's JS has run at all.
        TinyAssert::true(
            !in_array('hidden', $fields['billing']['billing_company']['class'], true),
            'billing_company must not start hidden'
        );
        // Country still lands above it (#33), which is what move_country_field's
        // own `?? 30` fallback and this registration's shared
        // $company_name_priority are for.
        TinyAssert::true(
            $fields['billing']['billing_country']['priority'] < $fields['billing']['billing_company']['priority'],
            'country must still sit above the force-registered billing_company'
        );
    }

    /**
     * The other half of the same change: a floor, never an override. A store
     * that does render the field — or a brand overlay that adjusts its label,
     * required-ness or priority — owns its own definition, and this plugin
     * must not flatten it back to the default shape.
     */
    private static function testNativeBillingCompanyNeverOverwritten(): void
    {
        $gateway = new class () extends WC_Twoinc {
            public function __construct()
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
            }

            public function get_option($key, $empty_value = null)
            {
                return '';
            }
        };

        $existing = [
            'label' => 'Organisation',
            'required' => true,
            'class' => ['form-row-wide', 'brand-company'],
            'priority' => 45,
        ];

        $fields = (new WC_Twoinc_Checkout($gateway))->update_company_fields([
            'billing' => ['billing_company' => $existing],
        ]);

        TinyAssert::true(
            $fields['billing']['billing_company'] === $existing,
            'an existing billing_company definition must survive untouched'
        );
    }

    /**
     * #33 review (Vader) — if a future brand overlay ever pushes
     * billing_company's own priority unusually high, company/company_id/
     * country must not invert above the fixed optional-fields baseline
     * (200). Both move_country_field() and update_company_fields() clamp
     * their read of company's priority at 190 to guarantee this.
     */
    private static function testCompanyPriorityClampPreventsInversionAboveOptionals(): void
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

            public function get_enable_company_search()
            {
                return 'yes';
            }
        };

        $checkout = new WC_Twoinc_Checkout($gateway);

        // A brand overlay pushing billing_company's priority far above the
        // optional baseline must still be clamped safe.
        $fields = ['billing' => ['billing_company' => ['priority' => 1000]]];

        $fields = $checkout->move_country_field($fields);
        $fields = $checkout->update_company_fields($fields);

        $billing = $fields['billing'];

        TinyAssert::true($billing['billing_country']['priority'] < 200, 'country must stay below the optional baseline');
        TinyAssert::true($billing['billing_company_display']['priority'] < 200, 'company must stay below the optional baseline');
        TinyAssert::true($billing['company_id']['priority'] < 200, 'company_id must stay below the optional baseline');
        TinyAssert::true($billing['company_id']['priority'] < $billing['invoice_email']['priority'], 'company_id must sort before the optional fields');
    }

    /**
     * #33 (live-staging regression, 2026-07-31) — WooCommerce's own
     * address-i18n.js re-derives #billing_country_field's client-side
     * priority from WC_Countries::get_country_locale()'s 'default' entry on
     * EVERY checkout load (not only when the buyer changes country), then
     * physically re-sorts the billing form's DOM by that priority —
     * entirely independent of the woocommerce_checkout_fields chain that
     * move_country_field()/update_company_fields() hook into. Confirmed
     * live against the real woocom-dev.staging.two.inc pod: server-rendered
     * HTML had country correctly above company, but the browser's own JS
     * silently re-inverted them a few hundred ms after load, using the
     * hardcoded core defaults (company priority 30, country priority 40)
     * from that locale array — values this plugin never touched before.
     * This never reproduced against a local fixture because it depends on
     * WooCommerce's bundled JS reading server-localized JSON, not on
     * anything this plugin's own tests exercised.
     *
     * sync_locale_country_priority() closes that second, independent path.
     */
    private static function testLocaleDefaultCountryPriorityStaysBelowCompany(): void
    {
        $gateway = new class () extends WC_Twoinc {
            public function __construct()
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
            }
        };

        $checkout = new WC_Twoinc_Checkout($gateway);

        // Shape mirrors WC_Countries::get_default_address_fields(): bare
        // keys ('company', 'country'), not the 'billing_'-prefixed shape
        // move_country_field()/update_company_fields() operate on.
        $locale_default = [
            'company' => ['priority' => 30],
            'country' => ['priority' => 40],
        ];

        $fixed = $checkout->sync_locale_country_priority($locale_default);

        TinyAssert::true(
            $fixed['country']['priority'] < $fixed['company']['priority'],
            'locale-default country priority must stay below company, or address-i18n.js re-inverts them client-side'
        );

        // Same clamp ceiling as the server-side fix: an unusually high
        // company priority must not push country's derived value out of
        // its intended band either.
        $clamped = $checkout->sync_locale_country_priority(['company' => ['priority' => 1000]]);
        TinyAssert::true($clamped['country']['priority'] < 200, 'locale-default country priority must stay below the optional baseline even if company priority is huge');

        // Review finding (Vader) — if 'country' is ever absent from the
        // locale-default array, this must be a no-op, not an auto-vivified
        // ['priority' => X] entry with no type/label/class that would then
        // be treated as the field's real definition downstream.
        $no_country = $checkout->sync_locale_country_priority(['company' => ['priority' => 30]]);
        TinyAssert::true(!isset($no_country['country']), 'must not fabricate a country entry when WC did not provide one');
    }

    private static function testBuyerCompanyNameComesFromTheCapture(): void
    {
        $captured = new StubOrder();
        $captured->meta['company_name'] = 'Captured Buyer AS';

        $cases = [
            [$captured, 'Captured Buyer AS', 'the capture wins over the billing address line'],
            [new StubOrder(), 'Test Buyer AS', 'no capture recorded falls back to the address line']
        ];

        foreach ($cases as [$order, $expected, $description]) {
            $body = WC_Twoinc_Helper::compose_twoinc_order(
                $order,
                'test-order-reference',
                '912345678',
                'IT',
                'Project X',
                '',
                []
            );
            TinyAssert::same($expected, $body['buyer']['company']['company_name'], $description);
            // The address's own organisation name is never the capture's.
            TinyAssert::same('Test Buyer AS', $body['billing_address']['organization_name'], $description);
        }
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
     * The chip fee label goes out already formatted by the store's
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
        // The Cap column is only live alongside a percentage, and the check
        // reads the POSTED type because type and grid are saved together.
        $gateway->test_post_data = [$gateway->get_field_key('surcharge_type') => 'fixed_and_percentage'];

        // Comma decimals normalise to dots; empty cells drop; blank rows omit;
        // non-positive term keys are skipped.
        $clean = $gateway->validate_two_surcharge_grid_field('surcharge_grid', [
            '30' => ['fixed' => '10,50', 'percentage' => '2.5', 'limit' => ''],
            '60' => ['fixed' => '', 'percentage' => '', 'limit' => ''],
            '0'  => ['fixed' => '5'],
        ]);
        TinyAssert::same([30 => ['fixed' => '10.50', 'percentage' => '2.5']], $clean);

        $threw = false;
        try {
            $gateway->validate_two_surcharge_grid_field('surcharge_grid', [30 => ['fixed' => '-1']]);
        } catch (Exception $e) {
            $threw = true;
        }
        TinyAssert::true($threw);

        $threw = false;
        try {
            $gateway->validate_two_surcharge_grid_field('surcharge_grid', [30 => ['percentage' => '150']]);
        } catch (Exception $e) {
            $threw = true;
        }
        TinyAssert::true($threw);

        // A cap of exactly 0 is rejected (TWO-25289) — it bounds the whole
        // fee line, so it silently wipes the fixed fee too, and the intent
        // it is mistaken for is expressible with 0% and 0 fixed instead.
        $threw = false;
        $message = '';
        try {
            $gateway->validate_two_surcharge_grid_field('surcharge_grid', [30 => ['percentage' => '2.5', 'limit' => '0']]);
        } catch (Exception $e) {
            $threw = true;
            $message = $e->getMessage();
        }
        TinyAssert::true($threw, 'a cap of 0 must be rejected');
        TinyAssert::true(strpos($message, 'cannot be 0') !== false, 'the error must say a cap of 0 is the problem');
        // '0.00' and '0,00' are the same value typed differently and are
        // rejected the same way — a decimal-formatted zero must not slip past.
        foreach (['0.00', '0,00', '00'] as $zero) {
            $threw = false;
            try {
                $gateway->validate_two_surcharge_grid_field('surcharge_grid', [30 => ['limit' => $zero]]);
            } catch (Exception $e) {
                $threw = true;
            }
            TinyAssert::true($threw, sprintf('a cap typed as "%s" must be rejected', $zero));
        }

        // A SUB-CENT cap is rejected too: it is rounded to 2dp before it goes
        // on the wire, so 0.001 would pass an exact-zero check and then arrive
        // as a hard cap of 0.00 — the outcome being refused, one step later.
        foreach (['0.001', '0.004', '0,004'] as $subcent) {
            $threw = false;
            try {
                $gateway->validate_two_surcharge_grid_field('surcharge_grid', [30 => ['limit' => $subcent]]);
            } catch (Exception $e) {
                $threw = true;
            }
            TinyAssert::true($threw, sprintf('a sub-cent cap of "%s" must be rejected', $subcent));
        }
        // 0.005 rounds UP to 0.01, so it survives — the boundary is where the
        // rounding lands, not an arbitrary threshold.
        TinyAssert::same(
            [30 => ['limit' => '0.005']],
            $gateway->validate_two_surcharge_grid_field('surcharge_grid', [30 => ['limit' => '0.005']]),
            'a cap that rounds UP to 0.01 must survive'
        );

        // An EMPTY cap stays valid and still means "no cap" — absence and
        // zero are different values and only the explicit zero is refused.
        // A zero PERCENTAGE and a zero FIXED fee also stay valid: that pair
        // is exactly what the rejection message tells the merchant to use.
        TinyAssert::same(
            [30 => ['fixed' => '0', 'percentage' => '0']],
            $gateway->validate_two_surcharge_grid_field('surcharge_grid', [
                30 => ['fixed' => '0', 'percentage' => '0', 'limit' => ''],
            ]),
            'zero percentage + zero fixed with an empty cap is the sanctioned "no fee" row'
        );

        TinyAssert::same([], $gateway->validate_two_surcharge_grid_field('surcharge_grid', ''));

        // The Cap column is HIDDEN for a type without a percentage, but a
        // hidden input still posts, so a cap stored while the type was
        // percentage keeps arriving. Refusing it would fail the whole save
        // over a cell the merchant can neither see nor clear, so the zero rule
        // is skipped while the column is hidden — for every such type,
        // 'none' included, because disabling surcharges is a normal save.
        foreach (['fixed', 'none'] as $type_without_percentage) {
            $hidden = self::gateway();
            $hidden->test_post_data = [$hidden->get_field_key('surcharge_type') => $type_without_percentage];
            TinyAssert::same(
                [30 => ['fixed' => '5', 'limit' => '0']],
                $hidden->validate_two_surcharge_grid_field('surcharge_grid', [
                    30 => ['fixed' => '5', 'percentage' => '', 'limit' => '0'],
                ]),
                sprintf('a legacy zero cap must never block a "%s" save', $type_without_percentage)
            );
            // SKIPPED, not dropped. A valid cap must survive a round trip
            // through a type that hides the column, exactly as the equally
            // inapplicable percentage cell does — otherwise disabling and
            // re-enabling surcharges silently discards every configured cap.
            TinyAssert::same(
                [30 => ['percentage' => '2.5', 'limit' => '50']],
                $hidden->validate_two_surcharge_grid_field('surcharge_grid', [
                    30 => ['percentage' => '2.5', 'limit' => '50'],
                ]),
                sprintf('a valid cap must survive a "%s" save, not be discarded', $type_without_percentage)
            );
        }
    }

    /**
     * TWO-25289 round 3. Two defects in one flow, both invisible from a
     * validator called in isolation, so this test drives the REAL
     * WooCommerce save loop (process_admin_options) and the REAL settings
     * render (admin_options).
     *
     * 1. The refusal was SILENT. WooCommerce records a throwing validator's
     *    message with WC_Settings_API::add_error and nothing in core prints
     *    that bucket — display_errors() is the gateway's job and this plugin
     *    never called it. A merchant who typed a cap of 0 saw the grid edit
     *    revert with no notice on a page that looked like it saved.
     *
     * 2. The save was PARTIAL. Core skips only the field that threw, so
     *    refusing the grid still saved surcharge_type: switching a shop with
     *    a stored zero from none to percentage enabled surcharges and
     *    rejected the grid, leaving the shop live at a cap of 0 — which
     *    clamps the whole fee line to nothing.
     */
    private static function testSurchargeRefusalIsVisibleAndNothingPartiallySaves(): void
    {
        $gateway = self::gateway();
        $gateway->init_form_fields();
        $option_key = $gateway->get_option_key();
        // The state a pre-TWO-25289 grid could legitimately have saved:
        // surcharges off, and a cap of 0 sitting on an offered term.
        $GLOBALS['__twoinc_test_options'][$option_key] = [
            'surcharge_type' => 'none',
            'surcharge_tax_treatment' => 'standard',
            'payment_terms_days' => ['30'],
            'surcharge_grid' => [30 => ['percentage' => '2.5', 'limit' => '0']],
        ];
        // The merchant switches the method to percentage. The grid row posts
        // the stored zero straight back, because that is what is in the cell.
        $gateway->test_post_data = [
            $gateway->get_field_key('surcharge_type') => 'percentage',
            $gateway->get_field_key('surcharge_tax_treatment') => 'standard',
            $gateway->get_field_key('payment_terms_days') => ['30'],
            $gateway->get_field_key('surcharge_grid') => [
                30 => ['fixed' => '', 'percentage' => '2.5', 'limit' => '0'],
            ],
        ];
        $gateway->process_admin_options();
        $saved = get_option($option_key, []);

        // Neither field lands. Before the fix surcharge_type was 'percentage'
        // here while the grid still held the zero — surcharges live, fee
        // clamped to nothing, nobody told.
        TinyAssert::same('none', $saved['surcharge_type'], 'enabling must not survive a refused grid');
        TinyAssert::same(
            [30 => ['percentage' => '2.5', 'limit' => '0']],
            $saved['surcharge_grid'],
            'the refused grid must keep its stored value, not a half-applied edit'
        );

        // Both refusals were recorded, and BOTH name the cap of 0 rather than
        // some generic failure — the merchant has to know which cell to fix.
        $errors = implode("\n", $gateway->get_errors());
        TinyAssert::true(strpos($errors, 'cannot be 0') !== false, 'the grid must refuse the cap of 0');
        TinyAssert::true(
            strpos($errors, 'before enabling a percentage surcharge') !== false,
            'the type field must refuse the enable for the same reason'
        );

        // And the refusal is now VISIBLE: admin_options() prints the notice,
        // above the settings form rather than below the grid.
        ob_start();
        $gateway->admin_options();
        $html = ob_get_clean();
        TinyAssert::true(strpos($html, 'woocommerce_errors') !== false, 'the settings page must print the error notice');
        TinyAssert::true(strpos($html, 'cannot be 0') !== false, 'the cap refusal must reach the page');
        TinyAssert::true(
            strpos($html, 'woocommerce_errors') < strpos($html, '<table class="form-table"'),
            'the notice must precede the settings form'
        );

        // A clean save prints NO notice — the call is unconditional, so an
        // empty error bucket must stay silent.
        $clean = self::gateway();
        $clean->init_form_fields();
        ob_start();
        $clean->admin_options();
        $clean_html = ob_get_clean();
        TinyAssert::same(false, strpos($clean_html, 'woocommerce_errors'), 'no notice without errors');
    }

    /**
     * The mitigation that keeps the symmetric refusal from becoming a dead
     * end. A rendered row always posts its three inputs, so a stored zero on
     * a row that was NOT rendered is absent from the POST — and refusing over
     * a cell the merchant can neither see nor clear would lock them out of
     * enabling surcharges entirely. It surfaces instead when the term comes
     * back into view, which is where the grid's own rule fires with the row
     * on screen. Same principle as the grid validator's preservation loop.
     */
    private static function testZeroCapOnAnUnrenderedRowDoesNotBlockEnabling(): void
    {
        $gateway = self::gateway();
        $gateway->test_post_data = [
            $gateway->get_field_key('surcharge_tax_treatment') => 'standard',
            // Only the 30-day row was on the form, and its cap is fine. The
            // stored zero lives on 60, whose row was never rendered.
            $gateway->get_field_key('surcharge_grid') => [
                30 => ['fixed' => '', 'percentage' => '2.5', 'limit' => ''],
            ],
        ];
        TinyAssert::same(
            'percentage',
            $gateway->validate_surcharge_type_field('surcharge_type', 'percentage'),
            'an unrendered legacy zero must not block enabling'
        );

        // No grid in the POST at all (no rows rendered) is the same case.
        $gateway = self::gateway();
        $gateway->test_post_data = [
            $gateway->get_field_key('surcharge_tax_treatment') => 'standard',
        ];
        TinyAssert::same(
            'percentage',
            $gateway->validate_surcharge_type_field('surcharge_type', 'percentage')
        );
    }

    /**
     * The escape hatch. A cap is inert without a percentage, so only the
     * percentage-bearing methods can be blocked by one — otherwise a shop
     * that had somehow reached the refused state could not turn surcharges
     * OFF to get out of it.
     */
    private static function testDisablingSurchargesIsNeverBlockedByAZeroCap(): void
    {
        foreach (['none', 'fixed'] as $type_without_percentage) {
            $gateway = self::gateway();
            $gateway->test_post_data = [
                $gateway->get_field_key('surcharge_tax_treatment') => 'standard',
                $gateway->get_field_key('surcharge_grid') => [
                    30 => ['fixed' => '5', 'percentage' => '', 'limit' => '0'],
                ],
            ];
            TinyAssert::same(
                $type_without_percentage,
                $gateway->validate_surcharge_type_field('surcharge_type', $type_without_percentage),
                sprintf('a zero cap must never block a "%s" save', $type_without_percentage)
            );
        }

        // A cap that is NOT zero never blocks anything, and neither does an
        // empty one — absence is the legitimate "no cap".
        foreach (['50', '0.01', ''] as $fine) {
            $gateway = self::gateway();
            $gateway->test_post_data = [
                $gateway->get_field_key('surcharge_tax_treatment') => 'standard',
                $gateway->get_field_key('surcharge_grid') => [
                    30 => ['percentage' => '2.5', 'limit' => $fine],
                ],
            ];
            TinyAssert::same(
                'fixed_and_percentage',
                $gateway->validate_surcharge_type_field('surcharge_type', 'fixed_and_percentage'),
                sprintf('a cap of "%s" must not block enabling', $fine)
            );
        }

        // A SUB-CENT cap does block: it rounds to 0.00 on the wire, so it is
        // the refused value spelled differently, and the two fields must
        // agree about that.
        $gateway = self::gateway();
        $gateway->test_post_data = [
            $gateway->get_field_key('surcharge_tax_treatment') => 'standard',
            $gateway->get_field_key('surcharge_grid') => [
                30 => ['percentage' => '2.5', 'limit' => '0,004'],
            ],
        ];
        $threw = false;
        try {
            $gateway->validate_surcharge_type_field('surcharge_type', 'percentage');
        } catch (Exception $e) {
            $threw = true;
        }
        TinyAssert::true($threw, 'a sub-cent cap must block enabling, as it blocks the grid');
    }

    private static function testSurchargeGridEnforcesMerchantFixedCap(): void
    {
        $limit_option = WC_Twoinc_Brand::prefixed_name('merchant_surcharge_limit');
        $checked_option = WC_Twoinc_Brand::prefixed_name('merchant_surcharge_limit_checked_on');
        $GLOBALS['__twoinc_test_options'][$limit_option] = json_encode(['amount' => 25.0, 'currency' => 'EUR']);
        $GLOBALS['__twoinc_test_options'][$checked_option] = time();
        $gateway = self::gateway();
        // A percentage-bearing type, so the Cap column is live and the `limit`
        // assertions below exercise the rule rather than the drop path.
        $gateway->test_post_data = [$gateway->get_field_key('surcharge_type') => 'fixed_and_percentage'];

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

        // Matching store currency: the fixed paragraph claims the enforced
        // maximum, on top of the always-shown base sentence.
        $GLOBALS['__twoinc_test_store_currency'] = 'EUR';
        $gateway = self::validationGateway(['payment_terms_days' => [30]], [30]);
        $html = $gateway->generate_two_surcharge_grid_html('surcharge_grid', []);
        TinyAssert::true(
            strpos($html, 'Enter the amount you want to charge your customer. Max EUR 25.') !== false,
            'expected base + Max sentence for matching currency'
        );
        TinyAssert::true(strpos($html, 'Max 100%.') !== false, 'the percentage ceiling is always claimable');

        // Store currency differs from the cap's: save-validation skips the
        // cap (Woo does no FX conversion), so the fixed help text must not
        // claim a maximum it will not enforce — but the base sentence still
        // renders; "no cap" must not mean "no help at all" (TWO-25498).
        $GLOBALS['__twoinc_test_store_currency'] = 'NOK';
        $html = $gateway->generate_two_surcharge_grid_html('surcharge_grid', []);
        TinyAssert::true(strpos($html, 'Max EUR') === false, 'fixed Max sentence must be omitted on currency mismatch');
        TinyAssert::true(strpos($html, 'Max NOK') === false, 'no fixed maximum may be claimed on currency mismatch');
        TinyAssert::true(
            strpos($html, 'twoinc-surcharge-grid-help--fixed"') !== false,
            'the fixed help paragraph always renders, cap or not'
        );
        TinyAssert::true(strpos($html, 'Max 100%.') !== false, 'percentage ceiling is always claimable');
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
     * container. Mirrors Magento's #surcharge-grid-container.
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

    /**
     * TWO-25498. The "Custom Payment Terms (days)" row is hidden server-side
     * (no JS flash) unless the stored custom value is genuinely custom — not
     * a duplicate of a backend-offered preset row, ticked or not.
     */
    private static function testCustomPaymentTermFieldHiddenUnlessGenuinelyCustom(): void
    {
        // self::gateway() offers [14, 30, 60, 90] from the backend.
        $gateway = self::gateway();
        $option_key = $gateway->get_option_key();

        // Genuinely custom: 45 is not offered at all.
        $GLOBALS['__twoinc_test_options'][$option_key] = [
            'payment_terms_days' => ['30'],
            'payment_terms_custom_days' => '45',
        ];
        $gateway->init_settings();
        $html = $gateway->generate_two_custom_payment_days_html('payment_terms_custom_days', []);
        TinyAssert::true(strpos($html, 'style="display:none;"') === false, 'a genuinely custom value must render visible');

        // Duplicate of a ticked preset: hidden.
        $GLOBALS['__twoinc_test_options'][$option_key] = [
            'payment_terms_days' => ['30'],
            'payment_terms_custom_days' => '30',
        ];
        $gateway->init_settings();
        $html = $gateway->generate_two_custom_payment_days_html('payment_terms_custom_days', []);
        TinyAssert::true(strpos($html, 'style="display:none;"') !== false, 'a value duplicating a ticked preset must render hidden');

        // Duplicate of an OFFERED-BUT-UNTICKED preset (60 is offered by the
        // backend but not in payment_terms_days here): hidden too, since it
        // already has a preset row to fold into.
        $GLOBALS['__twoinc_test_options'][$option_key] = [
            'payment_terms_days' => ['30'],
            'payment_terms_custom_days' => '60',
        ];
        $gateway->init_settings();
        $html = $gateway->generate_two_custom_payment_days_html('payment_terms_custom_days', []);
        TinyAssert::true(strpos($html, 'style="display:none;"') !== false, 'a value duplicating an unticked but offered preset must render hidden');

        // Empty: hidden.
        $GLOBALS['__twoinc_test_options'][$option_key] = [
            'payment_terms_days' => ['30'],
            'payment_terms_custom_days' => '',
        ];
        $gateway->init_settings();
        $html = $gateway->generate_two_custom_payment_days_html('payment_terms_custom_days', []);
        TinyAssert::true(strpos($html, 'style="display:none;"') !== false, 'an empty custom value must render hidden');
    }

    /**
     * TWO-25498. On save, a custom value that now duplicates a term the
     * merchant just ticked is redundant — it is cleared and folded into the
     * checkbox selection (already there in this case, but the write path is
     * exercised regardless). Drives the real save loop, like
     * testSurchargeRefusalIsVisibleAndNothingPartiallySaves above.
     */
    private static function testCustomPaymentTermReconciledOnSaveWhenItMatchesATickedPreset(): void
    {
        $gateway = self::gateway();
        $gateway->init_form_fields();
        $option_key = $gateway->get_option_key();
        $GLOBALS['__twoinc_test_options'][$option_key] = [
            'payment_terms_days' => ['14'],
            'payment_terms_custom_days' => '30',
        ];
        // The merchant ticks 30 (previously offered only via the custom
        // field) on this save.
        $gateway->test_post_data = [
            $gateway->get_field_key('surcharge_tax_treatment') => 'standard',
            $gateway->get_field_key('payment_terms_days') => ['14', '30'],
            $gateway->get_field_key('payment_terms_custom_days') => '30',
        ];
        $gateway->process_admin_options();
        $saved = get_option($option_key, []);

        TinyAssert::same('', $saved['payment_terms_custom_days'], 'a custom value duplicating a newly-ticked preset must be cleared');
        TinyAssert::same([14, 30], $saved['payment_terms_days'], 'the day count must survive in the checkbox selection');
    }

    /**
     * TWO-25498. A custom value matching an offered-but-currently-UNticked
     * preset (60 is offered by the backend but wasn't ticked this save)
     * must actually tick that preset, not just clear the custom value — the
     * bug this fix targets: the old genuine-check only ever compared
     * against the ticked set, so this fold-in branch was unreachable.
     */
    private static function testCustomPaymentTermTicksAnUnofferedButOfferedUntickedMatch(): void
    {
        $gateway = self::gateway();
        $gateway->init_form_fields();
        $option_key = $gateway->get_option_key();
        $GLOBALS['__twoinc_test_options'][$option_key] = [
            'payment_terms_days' => ['14'],
            'payment_terms_custom_days' => '60',
        ];
        // The merchant doesn't touch the checkboxes on this save — 60 stays
        // unticked in the POST, but it matches an offered preset row.
        $gateway->test_post_data = [
            $gateway->get_field_key('surcharge_tax_treatment') => 'standard',
            $gateway->get_field_key('payment_terms_days') => ['14'],
            $gateway->get_field_key('payment_terms_custom_days') => '60',
        ];
        $gateway->process_admin_options();
        $saved = get_option($option_key, []);

        TinyAssert::same('', $saved['payment_terms_custom_days'], 'a custom value matching an offered preset must be cleared even when unticked');
        TinyAssert::same([14, 60], $saved['payment_terms_days'], 'the matching preset must be ticked into the checkbox selection');
    }

    private static function testCustomPaymentTermNotReconciledWhenGenuinelyCustom(): void
    {
        $gateway = self::gateway();
        $gateway->init_form_fields();
        $option_key = $gateway->get_option_key();
        $GLOBALS['__twoinc_test_options'][$option_key] = [];
        $gateway->test_post_data = [
            $gateway->get_field_key('surcharge_tax_treatment') => 'standard',
            $gateway->get_field_key('payment_terms_days') => ['14'],
            $gateway->get_field_key('payment_terms_custom_days') => '45',
        ];
        $gateway->process_admin_options();
        $saved = get_option($option_key, []);

        TinyAssert::same('45', $saved['payment_terms_custom_days'], 'a genuinely custom value must survive the save untouched');
        TinyAssert::same([14], $saved['payment_terms_days'], 'ticked presets are unaffected when nothing needs reconciling');
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
        TinyAssert::same('GB', $response['data']['country']);
    }

    /** PDEV-4669: echoed country is normalised to the ISO code the hosted signup expects. */
    private static function testSoleTraderTokensEchoNormalisedCountry(): void
    {
        $gateway = self::tokenMintingGateway(['SOLE_TRADER']);
        $_REQUEST = ['country' => ' gb '];
        $response = self::runTokensHandler($gateway);
        $_REQUEST = [];
        TinyAssert::true($response['success']);
        TinyAssert::same('GB', $response['data']['country']);
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
            'section_diagnostics',
            $sections['skip_confirm_auth'] ?? null,
            'skip_confirm_auth must render under the Diagnostics heading'
        );
        // Sanity on the walker itself, not on this field: if it reported
        // 'section_diagnostics' for everything the assertion above would pass
        // vacuously, so pin one field known to live in another section.
        TinyAssert::same(
            'section_checkout_fields',
            $sections['display_tooltips'] ?? null,
            'walker sanity check: display_tooltips is expected in the checkout '
                . 'fields group — if that field was deliberately moved, repoint '
                . 'this assertion at another non-diagnostics field'
        );
        // And the option stays off by default wherever it is rendered.
        TinyAssert::same('no', $gateway->form_fields['skip_confirm_auth']['default']);
    }

    /**
     * disable_ssl_verify was moved out of General into Diagnostics
     * (TWO-25386 follow-up) — assert the section it actually renders under,
     * using the same array-walk approach as
     * testSkipConfirmAuthRendersUnderDebugOptions, rather than just checking
     * key presence.
     */
    private static function testDisableSslVerifyRendersUnderDiagnostics(): void
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
            'section_diagnostics',
            $sections['disable_ssl_verify'] ?? null,
            'disable_ssl_verify must render under the Diagnostics heading'
        );
        // Sanity on the walker itself, pin one field known to stay in General.
        TinyAssert::same(
            'section_general',
            $sections['api_key'] ?? null,
            'walker sanity check: api_key is expected in the General group'
        );
    }

    /**
     * vendor_name's caption and help text (TWO-25386 follow-up) — the field
     * carries no default/config behaviour to pin, so this asserts only the
     * copy: an accurate caption and a description explaining that the value
     * is sent verbatim on order create/edit requests to identify the site.
     */
    private static function testVendorNameFieldHasCaptionAndHelpText(): void
    {
        $gateway = new class () extends WC_Twoinc {
            public function __construct()
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
            }
        };
        $gateway->init_form_fields();
        $field = $gateway->form_fields['vendor_name'] ?? [];

        TinyAssert::same('Vendor name (optional)', $field['title'] ?? null);
        TinyAssert::true(
            isset($field['description']) && $field['description'] !== '',
            'vendor_name must have help text explaining what it does'
        );
    }

    /**
     * TWO-25386 brand-name sweep: a batch of admin settings descriptions
     * (vendor_name, fulfilment_trigger_statuses, enable_tax_subtotals) used
     * to hardcode the literal "Two" instead of interpolating the brand's
     * product name, same defect class as testApiKeyNoticesUseOverlayProductNameNotTwo.
     * A white-label overlay would have had its own copy tell the merchant
     * to contact "Two" instead of the overlay brand.
     */
    private static function testFormFieldDescriptionsUseOverlayProductNameNotTwo(): void
    {
        self::useTestbrand();

        $gateway = new class () extends WC_Twoinc {
            public function __construct()
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
            }
        };
        $gateway->init_form_fields();

        foreach (['vendor_name', 'fulfilment_trigger_statuses', 'enable_tax_subtotals'] as $key) {
            $description = $gateway->form_fields[$key]['description'] ?? '';
            TinyAssert::true(
                strpos($description, 'Testbrand') !== false,
                "$key description must name the overlay brand, got: $description"
            );
            TinyAssert::true(
                strpos($description, 'Two') === false,
                "$key description must not name Two, got: $description"
            );
        }
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
        TinyAssert::same('title', $gateway->form_fields['section_diagnostics']['type']);
        TinyAssert::same(false, array_key_exists('default', $gateway->form_fields['section_diagnostics']));

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

        // Dev-sniffed hostname (*.staging.two.inc) with the default mode: the
        // free-text test-host override was removed (TWO-25386), so a
        // dev-sniffed shop now always resolves to the brand's staging host.
        $GLOBALS['test_home_url'] = 'https://woocom.staging.two.inc';
        TinyAssert::same(
            'https://api.staging.two.inc',
            $make([])->get_twoinc_checkout_host()
        );

        // An explicit mode beats the sniffer — even on a dev hostname.
        TinyAssert::same(
            'https://api.staging.two.inc',
            $make(['checkout_env' => 'staging'])->get_twoinc_checkout_host()
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

        // Dev-sniffed shop, default mode: staging both ways (no test-host
        // override to consult since TWO-25386 removed it).
        $GLOBALS['test_home_url'] = 'https://woocom.staging.two.inc';
        $gateway = $make([]);
        TinyAssert::same('https://api.staging.two.inc', $gateway->get_twoinc_checkout_host());
        TinyAssert::same(
            'https://checkout.staging.two.inc',
            WC_Twoinc_Helper::get_environment_host('checkout', $gateway)
        );
        TinyAssert::same(
            'https://checkout.staging.two.inc/soletrader/signup',
            WC_Twoinc_Sole_Trader::get_signup_page_url($gateway)
        );

        // A dev-sniffed shop with an explicit mode follows that mode, not
        // the staging fallback.
        $gateway = $make(['checkout_env' => 'sandbox']);
        TinyAssert::same('https://api.sandbox.two.inc', $gateway->get_twoinc_checkout_host());
        TinyAssert::same(
            'https://checkout.sandbox.two.inc',
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
        $gateway = $make([]);
        TinyAssert::same('https://api.staging.testbrand.example', $gateway->get_twoinc_checkout_host());
        TinyAssert::same(
            'https://checkout.staging.testbrand.example',
            WC_Twoinc_Helper::get_environment_host('checkout', $gateway)
        );
    }

    /**
     * TWO-40 §3. An internally-minted `TWO:`-prefixed identifier travels the
     * same single write/pairing/validation/submission path as any registry
     * number — the ONE special case is display.
     *
     * The unavoidable platform wrinkle the guide warns about is a native
     * "identification number"-style field with its own format validation, on
     * which a colon-bearing value simply fails to save. WooCommerce has none:
     * the org number rides a plugin-registered plain text field with no
     * `validate` and no `type` coercion, and the prefix must never be stripped
     * to make some field accept it. Asserted rather than assumed, because
     * adding a `validate` here later would break sole-trader checkout silently
     * and nowhere near this line.
     */
    private static function testCompanyIdFieldHasNoFormatValidationToTripOverAPrefixedNumber(): void
    {
        $gateway = new class extends WC_Twoinc {
            public function __construct()
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
            }

            public function get_option($key, $empty_value = null)
            {
                return '';
            }
        };

        $field = (new WC_Twoinc_Checkout($gateway))->update_company_fields(['billing' => []])['billing']['company_id'];

        TinyAssert::true(
            !array_key_exists('validate', $field),
            'company_id must carry no format validation — a TWO: value has to save verbatim'
        );
        TinyAssert::true(
            !array_key_exists('maxlength', $field) && !array_key_exists('custom_attributes', $field),
            'company_id must carry no length cap or input attributes to truncate a minted identifier'
        );
        TinyAssert::same(false, $field['required']);
    }

    /**
     * TWO-40 §4/§6. The organisation number is captured once, at checkout, on
     * the invoice-role address, and stored on the order — and no later
     * edit-time path can overwrite it with an empty value, because no
     * edit-time path sends it at all.
     *
     * This is the WooCommerce audit the porting guide asks for. On the
     * platform this ports from, the admin-edit and tracking-number-update
     * paths DID send the buyer company, and both could send it empty once the
     * checkout session that resolved it was gone. Here the edit body carries
     * the addresses and the line items and no buyer company at all, so there
     * is nothing for a session-less request to blank. Pinned as a test rather
     * than left as a reading of the code, because "the edit body grew a buyer
     * block" is exactly the change that would reintroduce it silently.
     */
    private static function testOrderEditNeverCarriesTheOrganisationNumber(): void
    {
        $create = self::composeOrder();
        // Given: creation is where the number is carried
        TinyAssert::same('912345678', $create['buyer']['company']['organization_number']);

        // When: the same order is composed for an edit PUT
        $edit = WC_Twoinc_Helper::compose_twoinc_edit_order(new StubOrder(), 'IT', 'Project X', '', '');

        // Then: no buyer block at all, so no organisation number to blank
        TinyAssert::same(false, array_key_exists('buyer', $edit));
        TinyAssert::same(
            false,
            strpos(json_encode($edit), 'organization_number') !== false
        );
    }

    /**
     * TWO-40 §9. Three service hosts, three INDEPENDENT developer overrides,
     * every one of them refused on anything that could be a production shop.
     *
     * The checkout-page override matters on its own rather than riding on the
     * API one: that host is loaded by the BUYER'S BROWSER (sole-trader signup,
     * company search), so a value the shop's own server process can reach is
     * not necessarily one the browser can.
     */
    private static function testDevHostOverridesAreIndependentAndProductionSafe(): void
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

        // Given: a dev-sniffed shop carrying the never-configured default mode
        $GLOBALS['test_home_url'] = 'https://woocom.staging.two.inc';
        putenv('TWOINC_DEV_API_HOST=http://portal.localhost/api');
        $gateway = $make([]);

        // When: only the API override is set
        // Then: only the API host moves. The other two fall back on their own
        // rather than inheriting it — the whole point of them being separate.
        TinyAssert::same('http://portal.localhost/api', $gateway->get_twoinc_checkout_host());
        TinyAssert::same(
            'https://checkout.staging.two.inc',
            WC_Twoinc_Helper::get_environment_host('checkout', $gateway)
        );
        TinyAssert::same(
            'https://portal.two.inc/auth/merchant/signup',
            WC_Twoinc_Helper::get_merchant_portal_signup_url($gateway)
        );

        // When: the checkout-page override is set too
        putenv('TWOINC_DEV_CHECKOUT_HOST=https://checkout.tunnel.example');
        TinyAssert::same(
            'https://checkout.tunnel.example',
            WC_Twoinc_Helper::get_environment_host('checkout', $gateway)
        );
        // And the sole-trader signup page follows it, because it is built from
        // that same host rather than from a second resolution of its own.
        TinyAssert::same(
            'https://checkout.tunnel.example/soletrader/signup',
            WC_Twoinc_Sole_Trader::get_signup_page_url($gateway)
        );
        // The API host is unmoved by it.
        TinyAssert::same('http://portal.localhost/api', $gateway->get_twoinc_checkout_host());

        // When: the portal override is set
        // Then: the ORIGIN is replaced and the brand's own signup path kept.
        putenv('TWOINC_DEV_PORTAL_HOST=http://portal.localhost/');
        TinyAssert::same(
            'http://portal.localhost/auth/merchant/signup',
            WC_Twoinc_Helper::get_merchant_portal_signup_url($gateway)
        );

        // When: the same variables leak into a real merchant shop's process
        // Then: not one of them is honoured. This is the gate that has to hold
        // even if a deployment accidentally inherits a developer's env.
        $GLOBALS['test_home_url'] = 'https://shop.merchant.example';
        $production = $make([]);
        TinyAssert::same('https://api.two.inc', $production->get_twoinc_checkout_host());
        TinyAssert::same(
            'https://checkout.two.inc',
            WC_Twoinc_Helper::get_environment_host('checkout', $production)
        );
        TinyAssert::same(
            'https://portal.two.inc/auth/merchant/signup',
            WC_Twoinc_Helper::get_merchant_portal_signup_url($production)
        );

        // And: a merchant who has explicitly chosen an environment has said
        // which one they want, so an env var does not get to overrule that
        // either — even back on the dev-sniffed hostname.
        $GLOBALS['test_home_url'] = 'https://woocom.staging.two.inc';
        $explicit = $make(['checkout_env' => 'sandbox']);
        TinyAssert::same('https://api.sandbox.two.inc', $explicit->get_twoinc_checkout_host());
        TinyAssert::same(
            'https://checkout.sandbox.two.inc',
            WC_Twoinc_Helper::get_environment_host('checkout', $explicit)
        );

        // And: an unknown service name never resolves to an override.
        TinyAssert::same('', WC_Twoinc_Helper::get_dev_host_override('nonexistent', $gateway));
    }

    /**
     * TWO-25386: stub gateway for the fulfilment-trigger, SSL-verify and
     * subtitle tests below — same shape as the checkout-host stubs above,
     * plus recording on_order_completed calls so the dispatch tests can
     * assert without touching a real WC order.
     */
    private static function fulfilmentTriggerGateway(array $options)
    {
        return new class ($options) extends WC_Twoinc {
            private $options;
            public $completedCalls = [];
            public $cancelledCalls = [];
            public function __construct($options)
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
                $this->options = $options;
            }
            public function get_option($key, $empty_value = null)
            {
                return $this->options[$key] ?? $empty_value ?? '';
            }
            public function on_order_completed($order_id)
            {
                $this->completedCalls[] = $order_id;
                return true;
            }
            public function on_order_cancelled($order_id)
            {
                $this->cancelledCalls[] = $order_id;
                return true;
            }
        };
    }

    private static function testFulfilmentTriggerStatusesDefaultToCompleted(): void
    {
        $gateway = self::fulfilmentTriggerGateway([]);
        TinyAssert::same(['completed'], $gateway->get_fulfilment_trigger_statuses());
    }

    private static function testFulfilmentTriggerStatusesNormalizeWcPrefix(): void
    {
        $gateway = self::fulfilmentTriggerGateway(['fulfilment_trigger_statuses' => ['wc-on-hold', 'processing']]);
        TinyAssert::same(['on-hold', 'processing'], $gateway->get_fulfilment_trigger_statuses());
    }

    /**
     * The real bug TWO-25386 closes: WooCommerce used to fire fulfilment
     * only on the hardcoded 'completed' hook, silently desyncing any
     * merchant whose workflow never reaches that status (e.g. a
     * custom-order-status plugin). A merchant-configured non-'completed'
     * status must now dispatch fulfilment via the woocommerce_order_edit_status
     * fallback hook, the same path the constructor's per-status add_action
     * loop uses for the primary WooCommerce core status hooks.
     */
    private static function testFulfilmentTriggerStatusHonoursMerchantConfiguredNonCompletedStatus(): void
    {
        $gateway = self::fulfilmentTriggerGateway(['fulfilment_trigger_statuses' => ['processing']]);

        self::withGatewayInstance($gateway, function () {
            WC_Twoinc::on_order_edit_status(501, 'processing');
        });

        TinyAssert::same(
            [501],
            $gateway->completedCalls,
            'a merchant-configured non-completed status must trigger fulfilment'
        );
    }

    /**
     * The flip side: once a merchant has narrowed the trigger set, a status
     * NOT in that set — including the old hardcoded 'completed' — must not
     * fire fulfilment. Otherwise the setting is decorative.
     */
    private static function testFulfilmentTriggerStatusDoesNotFireForUnconfiguredStatus(): void
    {
        $gateway = self::fulfilmentTriggerGateway(['fulfilment_trigger_statuses' => ['processing']]);

        self::withGatewayInstance($gateway, function () {
            WC_Twoinc::on_order_edit_status(502, 'completed');
        });

        TinyAssert::same(
            [],
            $gateway->completedCalls,
            'completed must not fire fulfilment when it is not the configured trigger status'
        );
    }

    /**
     * Adversarial-review finding (TWO-25386): 'cancelled' and 'refunded'
     * have their own dedicated dispatch with different Two API semantics —
     * they must never be selectable as a fulfilment trigger, or a merchant
     * could configure "Cancelled" and have Two told a cancelled order was
     * fulfilled.
     */
    private static function testFulfilmentTriggerExcludesCancelledAndRefundedFromOptionsAndStoredValue(): void
    {
        $gateway = self::fulfilmentTriggerGateway([]);
        $method = new ReflectionMethod(WC_Twoinc::class, 'get_order_status_options');
        $method->setAccessible(true);
        $options = $method->invoke($gateway);
        TinyAssert::true(!array_key_exists('cancelled', $options), 'cancelled must not be a selectable trigger status');
        TinyAssert::true(!array_key_exists('refunded', $options), 'refunded must not be a selectable trigger status');

        // Defensively stripped from the stored value too, in case a stale
        // or hand-edited settings row contains one.
        $gateway = self::fulfilmentTriggerGateway(['fulfilment_trigger_statuses' => ['cancelled', 'processing']]);
        TinyAssert::same(['processing'], $gateway->get_fulfilment_trigger_statuses());

        // If every configured status is excluded, fall back to 'completed'
        // rather than leaving fulfilment un-triggerable.
        $gateway = self::fulfilmentTriggerGateway(['fulfilment_trigger_statuses' => ['cancelled', 'refunded']]);
        TinyAssert::same(['completed'], $gateway->get_fulfilment_trigger_statuses());
    }

    /**
     * The actual safety net, independent of the multiselect's own options
     * list: on_order_edit_status() checks cancelled/refunded FIRST and
     * unconditionally, ahead of the merchant-configured trigger set, so a
     * cancellation can never be mis-dispatched as a fulfilment even against
     * a stale settings row.
     */
    private static function testCancelledOrderNeverMisdispatchesAsFulfilmentEvenIfConfiguredAsTrigger(): void
    {
        $gateway = self::fulfilmentTriggerGateway(['fulfilment_trigger_statuses' => ['cancelled']]);

        self::withGatewayInstance($gateway, function () {
            WC_Twoinc::on_order_edit_status(503, 'cancelled');
        });

        TinyAssert::same([503], $gateway->cancelledCalls, 'cancelled must still dispatch on_order_cancelled');
        TinyAssert::same([], $gateway->completedCalls, 'cancelled must never dispatch on_order_completed');
    }

    /**
     * The toggle alone decides the outcome — no environment carve-out.
     * Merchants behind a corporate TLS-terminating proxy need the bypass
     * in production too.
     */
    private static function testShouldDisableSslVerifyFollowsToggleInEveryEnvironment(): void
    {
        $cases = [
            ['no', 'PROD', false, 'toggle off must never bypass, even in production'],
            ['no', 'staging', false, 'toggle off must never bypass, even outside production'],
            ['yes', 'PROD', true, 'toggle on must bypass in production'],
            ['yes', 'staging', true, 'toggle on must bypass outside production'],
        ];
        foreach ($cases as [$toggle, $env, $expected, $message]) {
            $gateway = self::fulfilmentTriggerGateway(['disable_ssl_verify' => $toggle, 'checkout_env' => $env]);
            $method = new ReflectionMethod(WC_Twoinc::class, 'should_disable_ssl_verify');
            $method->setAccessible(true);
            TinyAssert::same($expected, $method->invoke($gateway), $message);
        }
    }

    private static function testPaymentSubtitlePrefersMerchantFreeTextOverBrandTagline(): void
    {
        self::useTaglineBrand();
        $gateway = self::fulfilmentTriggerGateway(['payment_subtitle' => 'Buy now, pay in 30 days']);
        TinyAssert::same(
            '<div class="twoinc-payment-subtitle">Buy now, pay in 30 days</div>',
            $gateway->get_pay_subtitle()
        );
    }

    private static function testPaymentSubtitleFallsBackToBrandTaglineWhenBlank(): void
    {
        self::useTaglineBrand();
        $gateway = self::fulfilmentTriggerGateway([]);
        TinyAssert::same(
            '<div class="twoinc-payment-subtitle">For all companies, '
                . '<a href="https://taglinebrand.example/faq" target="_blank" rel="noopener">'
                . 'read more</a>.</div>',
            $gateway->get_pay_subtitle()
        );
    }

    /**
     * TWO-25502: the merchant setting is the only source of truth. A Swedish
     * base country no longer forces it on at read time — the one-time
     * backfill below is what keeps Swedish shops sending subtotals.
     */
    private static function testTaxSubtotalsRequiredWhenMerchantOptsIn(): void
    {
        $prop = new ReflectionProperty(WC_Twoinc::class, 'instance');
        $prop->setAccessible(true);

        foreach ([['NO', 'no', false], ['NO', 'yes', true], ['SE', 'no', false], ['SE', 'yes', true]] as $case) {
            list($country, $stored, $expected) = $case;
            $GLOBALS['__twoinc_test_base_country'] = $country;
            $prop->setValue(null, self::fulfilmentTriggerGateway(['enable_tax_subtotals' => $stored]));
            TinyAssert::same(
                $expected,
                WC_Twoinc_Helper::is_tax_subtotals_required_by_twoinc(),
                "base country $country with stored '$stored'"
            );
        }

        $prop->setValue(null, null);
    }

    private static function testTaxSubtotalsSettingIsOnByDefaultForNewInstalls(): void
    {
        $gateway = new class () extends WC_Twoinc {
            public function __construct()
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
            }
        };
        $gateway->init_form_fields();
        $field = $gateway->form_fields['enable_tax_subtotals'];

        TinyAssert::same('Validate tax subtotals', $field['title']);
        TinyAssert::same('yes', $field['default']);
        TinyAssert::true(
            strpos($field['description'], 'Sweden') === false,
            "description must not claim Sweden is unconditional, got: {$field['description']}"
        );
    }

    /**
     * Gateway whose settings blob comes from the seeded wp option, so
     * update_option() writes back through the same row the migration reads.
     */
    private static function taxSubtotalsGateway(): WC_Twoinc
    {
        return new class () extends WC_Twoinc {
            public function __construct()
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
                $this->init_settings();
            }
        };
    }

    private static function seedTaxSubtotalsSettings(?string $stored): string
    {
        $key = 'woocommerce_' . WC_Twoinc_Brand::get('gateway_id') . '_settings';
        // A brand-new install has no row at all; WC_Settings_API then serves
        // the field default rather than anything the migration could read.
        $GLOBALS['__twoinc_test_options'][$key] = $stored === null ? [] : ['enable_tax_subtotals' => $stored];
        return $key;
    }

    private static function runTaxSubtotalsBackfill(WC_Twoinc $gateway): void
    {
        $method = new ReflectionMethod(WC_Twoinc::class, 'migrate_se_tax_subtotals');
        $method->setAccessible(true);
        $method->invoke($gateway);
    }

    /**
     * TWO-25502: the backfill opts a Swedish install in exactly once, and
     * touches nothing else. Each case runs twice to prove the marker holds.
     */
    private static function testSeTaxSubtotalsBackfill(): void
    {
        $cases = [
            ['SE', 'no', 'yes', 'Swedish install that stored no is opted in'],
            ['SE', 'yes', 'yes', 'Swedish install already on is left alone'],
            ['NO', 'no', 'no', 'non-Swedish install is never touched'],
            ['SE', null, null, 'install with no stored key keeps the field default'],
        ];
        foreach ($cases as $case) {
            list($country, $stored, $expected, $description) = $case;
            $GLOBALS['__twoinc_test_base_country'] = $country;
            $key = self::seedTaxSubtotalsSettings($stored);
            delete_option(WC_Twoinc_Brand::prefixed_name('tax_subtotals_se_backfilled'));

            self::runTaxSubtotalsBackfill(self::taxSubtotalsGateway());
            self::runTaxSubtotalsBackfill(self::taxSubtotalsGateway());

            $actual = $GLOBALS['__twoinc_test_options'][$key]['enable_tax_subtotals'] ?? null;
            TinyAssert::same($expected, $actual, $description);
        }
    }

    private static function testSeTaxSubtotalsBackfillDoesNotUndoAMerchantOptOut(): void
    {
        $GLOBALS['__twoinc_test_base_country'] = 'SE';
        $key = self::seedTaxSubtotalsSettings('no');

        self::runTaxSubtotalsBackfill(self::taxSubtotalsGateway());
        TinyAssert::same('yes', $GLOBALS['__twoinc_test_options'][$key]['enable_tax_subtotals']);

        $GLOBALS['__twoinc_test_options'][$key]['enable_tax_subtotals'] = 'no';
        self::runTaxSubtotalsBackfill(self::taxSubtotalsGateway());
        TinyAssert::same('no', $GLOBALS['__twoinc_test_options'][$key]['enable_tax_subtotals']);
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
            /** @var array<int,array{endpoint:string,payload:array}> non-FX requests, for payload assertions */
            public $requests = [];

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
                    $this->requests[] = ['endpoint' => $endpoint, 'payload' => $payload];
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

    private static function testGateKeepsMethodWhenTheOnlyMonetaryComponentIsAZeroCap(): void
    {
        // Sharper than the percentage-only case above. A stored cap of 0 is
        // relayed rather than dropped now (TWO-25289), so it reaches the FX
        // gate where it never used to - and this gate WITHHOLDS the payment
        // method. Without exempting zero from the FX requirement, one term
        // carrying a zero cap took Two offline for the whole checkout over a
        // conversion with no work to do: 0 is 0 in every currency.
        $GLOBALS['__twoinc_test_currency'] = 'NOK';
        $gateway = self::fxGateway(null, [new WP_Error()], [
            'payment_terms_days' => [30],
            'surcharge_type' => 'percentage',
            // A REAL stored zero, not a blank. The admin grid refuses this
            // now, but rows stored before that validation existed are
            // deliberately not migrated.
            'surcharge_grid' => [30 => ['percentage' => 1.5, 'limit' => '0']],
        ]);
        $result = $gateway->apply_brand_availability_gate(['woocommerce-gateway-tillit' => 'gw']);
        TinyAssert::true(
            isset($result['woocommerce-gateway-tillit']),
            'a zero cap needs no FX rate and must never withhold the method'
        );
        TinyAssert::same(0, $gateway->fx_requests, 'a zero cap must not even trigger a rate lookup');
        foreach ($GLOBALS['__twoinc_test_logs'] as $entry) {
            TinyAssert::true(
                $entry['level'] !== 'error',
                'a zero cap is not a fail-closed condition: nothing may be logged at error'
            );
        }

        // And the fee block still carries the zero cap verbatim.
        $share = WC_Twoinc_Payment_Terms::build_buyer_fee_share($gateway, 30);
        TinyAssert::same(0.0, $share['cap'], 'the zero cap is still relayed, uncoverted');
    }

    private static function testBuyerFeeShareTreatsANegativeStoredCapAsAbsent(): void
    {
        // Dropping the `> 0` filter to let a zero through must not also let a
        // NEGATIVE through. A negative cap is nonsense the admin grid rejects,
        // so it can only arrive by a hand edit or an import - the same routes
        // cited as the reason for relaying a stored zero - and relaying
        // `cap => -10.0` would be refused upstream. Absent, as before.
        $gateway = self::fxGateway(null, [], [
            'surcharge_type' => 'fixed_and_percentage',
            'surcharge_grid' => [30 => ['fixed' => 2.5, 'percentage' => 1.5, 'limit' => '-10']],
        ]);
        $share = WC_Twoinc_Payment_Terms::build_buyer_fee_share($gateway, 30);
        TinyAssert::true(!isset($share['cap']), 'a negative stored cap must never be relayed');
        TinyAssert::same(2.5, $share['surcharge'], 'the rest of the row is unaffected');
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

    private static function testBuyerFeeShareRelaysAConfiguredZeroCapVerbatim(): void
    {
        // A cap of exactly 0 STORED against a term is relayed as cap => 0.0,
        // not normalised to absent (TWO-25289). This boundary used to apply a
        // `> 0` filter, so a stored 0 became "no cap" and the percentage went
        // out UNCAPPED — an overcharge, and the opposite of the merchant's
        // instruction. The admin grid now refuses a zero cap, but a 0 can
        // still arrive by a route the grid does not police (a row stored
        // before that validation existed, `wp option update`, an import), and
        // those must not be relayed uncapped either.
        $gateway = self::fxGateway(null, [], [
            'surcharge_type' => 'fixed_and_percentage',
            'surcharge_grid' => [30 => ['fixed' => 2.5, 'percentage' => 1.5, 'limit' => '0']],
        ]);
        $share = WC_Twoinc_Payment_Terms::build_buyer_fee_share($gateway, 30);
        TinyAssert::true(array_key_exists('cap', $share), 'a stored zero cap must not be dropped from the payload');
        TinyAssert::same(0.0, $share['cap'], 'a stored zero cap is relayed as 0, never as "no cap"');
        // The fixed fee is still SENT alongside it. The cap bounds the whole
        // fee line, so the API is the thing that zeroes this - the plugin must
        // not pre-empt that by withholding the fixed fee, or the two sides
        // would disagree about what was asked for. This interaction is the
        // stated rationale for refusing a zero cap at entry, so assert it.
        TinyAssert::same(2.5, $share['surcharge'], 'the fixed fee is still relayed beside a zero cap');
        TinyAssert::same(0, $gateway->fx_requests, 'same-currency stores never reach the FX layer');
    }

    private static function testBuyerFeeShareRoundsMonetaryValuesToTwoDecimalPlaces(): void
    {
        // The pricing API refuses a monetary value finer than two decimal
        // places rather than rounding it, so an over-precise configured
        // amount was rejected upstream and surfaced to the buyer as a
        // generic error (TWO-25289). Two decimals fixed, deliberately NOT
        // wc_get_price_decimals(): a store configured for 3 or 4 price
        // decimals would otherwise have its surcharge request refused.
        $gateway = self::fxGateway(null, [], [
            'surcharge_type' => 'fixed_and_percentage',
            'surcharge_grid' => [30 => ['fixed' => 10.999, 'percentage' => 1.5, 'limit' => 20.005]],
        ]);
        $share = WC_Twoinc_Payment_Terms::build_buyer_fee_share($gateway, 30);
        TinyAssert::same(11.0, $share['surcharge'], 'the fixed fee is rounded to 2dp before the request');
        TinyAssert::same(20.01, $share['cap'], 'the cap is rounded to 2dp before the request');
        TinyAssert::same(0, $gateway->fx_requests, 'no conversion involved: this is the same-currency path');

        // And on the converted path, where the arithmetic itself produces
        // more precision than the API accepts: 10.00 EUR at 1/0.085 is
        // 117.6470... NOK.
        $GLOBALS['__twoinc_test_currency'] = 'NOK';
        $converting = self::fxGateway(null, [self::fxOk(['NOK' => 0.085])], [
            'payment_terms_days' => [30],
            'surcharge_type' => 'fixed_and_percentage',
            // Distinct inputs, so a cap/surcharge swap cannot pass:
            // 10.00 EUR -> 117.65 NOK, 20.00 EUR -> 235.29 NOK.
            'surcharge_grid' => [30 => ['fixed' => 20.0, 'percentage' => 1.5, 'limit' => 10.0]],
        ]);
        $converted = WC_Twoinc_Payment_Terms::build_buyer_fee_share($converting, 30);
        TinyAssert::same(117.65, $converted['cap'], 'the converted cap is rounded to 2dp');
        TinyAssert::same(235.29, $converted['surcharge'], 'the converted fixed fee is rounded to 2dp');
        TinyAssert::true($converting->fx_requests > 0, 'the conversion path must really have run');
    }

    private static function testFeeRequestGrossAmountIsRoundedToTwoDecimalPlaces(): void
    {
        // gross_amount travels in the SAME payload as cap and surcharge, and
        // the API refuses any of them finer than 2dp. It used to be rounded
        // with WC_Twoinc_Helper::round_amt(), i.e. wc_get_price_decimals(), so
        // a store configured for 3 or 4 price decimals had the whole request
        // refused - the exact failure the cap/surcharge rounding fixes, on the
        // sibling field (TWO-25289).
        $GLOBALS['__twoinc_test_price_decimals'] = 4;
        try {
            $gateway = self::fxGateway(null, [], [
                'payment_terms_days' => [30],
                'surcharge_type' => 'percentage',
                'surcharge_grid' => [30 => ['percentage' => 1.5]],
            ]);
            WC_Twoinc_Payment_Terms::fetch_term_fee($gateway, 30, 100.12345, 'NO');
            $pricing = null;
            foreach ($gateway->requests as $request) {
                if ($request['endpoint'] === '/v1/pricing/order/fee') {
                    $pricing = $request['payload'];
                }
            }
            TinyAssert::true(is_array($pricing), 'the pricing quote must have been requested');
            TinyAssert::same('100.12', $pricing['gross_amount'], 'gross_amount is 2dp regardless of store price precision');
        } finally {
            unset($GLOBALS['__twoinc_test_price_decimals']);
        }
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

    /**
     * TWO-25289 round 3. Round 2 added an is_numeric gate to the cap READ
     * path, which turned a comma-formatted stored cap into an absent one —
     * and absent means UNCAPPED, so the failure direction was an overcharge
     * where the pre-TWO-25289 code capped correctly.
     *
     * A comma decimal is the plugin's own accepted spelling: the save path
     * and the merchant-minimum validator both normalise it before they
     * validate, so "1,50" reaches the stored option from a hand edit, an
     * import, or an option written before that normalisation existed. It is
     * normalised on read too, not dropped.
     */
    private static function testStoredCommaDecimalCapIsNormalisedNotDropped(): void
    {
        $gateway = self::termsGateway([
            'surcharge_type' => 'percentage',
            'surcharge_grid' => [30 => ['percentage' => '3', 'limit' => '1,50']],
        ]);
        TinyAssert::same(
            ['percentage' => 3.0, 'surcharge_basis' => 'buyer_pays', 'cap' => 1.5],
            WC_Twoinc_Payment_Terms::build_buyer_fee_share($gateway, 30),
            'a comma-decimal cap must cap at 1.50, not relay an uncapped percentage'
        );

        // A comma-spelled ZERO is still a zero cap, relayed verbatim — the
        // normalisation must not make absence and zero converge either way.
        $gateway = self::termsGateway([
            'surcharge_type' => 'percentage',
            'surcharge_grid' => [30 => ['percentage' => '3', 'limit' => '0,00']],
        ]);
        $share = WC_Twoinc_Payment_Terms::build_buyer_fee_share($gateway, 30);
        TinyAssert::true(array_key_exists('cap', $share), 'a comma-spelled zero cap must still be a cap');
        TinyAssert::same(0.0, $share['cap']);

        // Genuinely non-numeric junk stays absent, and so does a negative —
        // normalising commas must not weaken either guard.
        foreach (['abc', '', '-10', '-1,5'] as $junk) {
            $gateway = self::termsGateway([
                'surcharge_type' => 'percentage',
                'surcharge_grid' => [30 => ['percentage' => '3', 'limit' => $junk]],
            ]);
            $share = WC_Twoinc_Payment_Terms::build_buyer_fee_share($gateway, 30);
            TinyAssert::same(
                false,
                array_key_exists('cap', $share),
                sprintf('a cap of "%s" must be absent, not relayed', $junk)
            );
        }
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
     * chips, and the chips above the sole-trader note slot, matching the
     * Magento Luma renderer. Pinned because the whole box is one
     * concatenated string, so ordering is a silent, easy regression.
     *
     * The sole-trader MODE chips themselves are not part of this box at all
     * (TWO-40 §0 correction) — they render inside the company-search
     * dropdown. `twoinc-sole-trader-note-slot` here only ever holds the
     * signup-prompt note and in-flight error.
     */
    private static function testPaymentBoxOrdersTaglineChipsThenSoleTrader(): void
    {
        self::useTaglineBrand();
        $html = self::gateway()->build_payment_description();

        $tagline = strpos($html, 'twoinc-payment-subtitle');
        $chips = strpos($html, 'twoinc-term-chips');
        $sole_trader = strpos($html, 'twoinc-sole-trader-note-slot');
        $about = strpos($html, 'abt-twoinc');

        TinyAssert::true($tagline !== false, 'tagline block missing');
        TinyAssert::true($chips !== false, 'chips container missing');
        TinyAssert::true($sole_trader !== false, 'sole-trader note slot missing');
        TinyAssert::true($about !== false, 'about block missing');

        TinyAssert::true($tagline < $chips, 'tagline must precede the chips');
        TinyAssert::true($chips < $sole_trader, 'chips must precede the sole-trader note slot');
        TinyAssert::true($sole_trader < $about, 'about block must trail the box');
    }

    /**
     * The company-search-tile-location slot renders between the sole-trader
     * note slot and the intent message (TWO-25326 §7.1, ruling 2026-08-03,
     * superseding the standalone company-tile-label this ticket originally
     * shipped in PR #431).
     *
     * Position is asserted, not just presence: the requirement names the
     * sole-trader note slot and the intent message as its two anchors, and
     * the whole box is one concatenated sprintf, so an edit that moves the
     * slot is a silent regression exactly like the ordering test above
     * guards against.
     *
     * Empty and hidden on render regardless of the `enable_company_search`
     * setting — twoinc.js's syncCompanySearchTileLocation() is what moves the
     * real company-search fields into it and unhides it, client-side, and
     * this markup does not know the setting's value at all (it is read from
     * `window.twoinc.company_search_location`, not baked into this HTML).
     */
    private static function testPaymentBoxRendersCompanySearchTileSlotBetweenSoleTraderAndIntentMessage(): void
    {
        self::useTaglineBrand();
        $html = self::gateway()->build_payment_description();

        $sole_trader = strpos($html, 'twoinc-sole-trader-note-slot');
        $slot = strpos($html, 'twoinc-company-search-tile-slot');
        $intent = strpos($html, 'twoinc-pay-box');

        TinyAssert::true($sole_trader !== false, 'sole-trader note slot missing');
        TinyAssert::true($slot !== false, 'company-search tile slot missing');
        TinyAssert::true($intent !== false, 'intent/notice pay box missing');

        TinyAssert::true($sole_trader < $slot, 'sole-trader note slot must precede the tile slot');
        TinyAssert::true($slot < $intent, 'tile slot must precede the intent message');

        TinyAssert::true(
            strpos($html, '<div class="twoinc-company-search-tile-slot hidden"></div>') !== false,
            'the tile slot must ship empty and hidden'
        );

        // §7.2/§7.3: the standalone tile label PR #431 shipped is gone
        // outright, not just replaced in this position.
        TinyAssert::true(
            strpos($html, 'twoinc-company-tile-label') === false,
            'the superseded standalone company tile label must not be emitted'
        );
    }

    /**
     * TWO-25326 §7.1, correction 2026-08-04. The short-lived standalone
     * `company_search_location` admin setting from PR #436 is gone; the
     * SAME location decision is now derived from the pre-existing
     * `enable_company_search` checkbox by
     * WC_Twoinc_Checkout::derive_company_search_location(). Flip both
     * directions directly against that pure function — no gateway, no
     * WP/WC stubs needed — so a mutation that inverts or drops the branch
     * fails here rather than only in the JS suite (which drives
     * `window.twoinc.company_search_location` directly and so cannot see
     * this PHP-side derivation at all).
     */
    private static function testCompanySearchLocationDerivedFromEnableCompanySearchBothDirections(): void
    {
        $derive = new ReflectionMethod(WC_Twoinc_Checkout::class, 'derive_company_search_location');
        $derive->setAccessible(true);

        TinyAssert::same(
            'address_area',
            $derive->invoke(null, 'yes'),
            'checkbox checked ("yes") must render in the address area'
        );
        TinyAssert::same(
            'payment_tile',
            $derive->invoke(null, 'no'),
            'checkbox unchecked ("no") must relocate into the payment tile, not disappear'
        );
    }

    /**
     * get_enable_company_search() can return null (both the current and the
     * legacy `enable_company_name` option keys unset) or '' (WooCommerce's
     * WC_Settings_API::get_option empty-string convention) — neither is
     * "yes", so both must land on the safe side: relocated into the payment
     * tile, never silently missing from the checkout entirely (#33-style
     * regression the fallback in get_enable_company_search() exists to
     * prevent).
     */
    private static function testCompanySearchLocationFallsBackToPaymentTileOnNullOrEmpty(): void
    {
        $derive = new ReflectionMethod(WC_Twoinc_Checkout::class, 'derive_company_search_location');
        $derive->setAccessible(true);

        TinyAssert::same('payment_tile', $derive->invoke(null, null));
        TinyAssert::same('payment_tile', $derive->invoke(null, ''));
    }

    /**
     * TWO-25326 §7.1, correction 2026-08-04 (adversarial review finding,
     * Yoda). `company_search_location` (PR #436) lived for less than a day
     * before this correction deleted the admin field and its getter — any
     * merchant who touched it during that window has the key sitting inert
     * in their settings row. `drop_removed_settings()` (same mechanism as
     * `enable_sole_trader`, TWO-25163) must clean it up on an upgraded
     * install, mirroring `testSoleTraderHasNoMerchantToggleSetting` above.
     */
    private static function testCompanySearchLocationSettingDroppedFromUpgradedInstalls(): void
    {
        $gateway = new class () extends WC_Twoinc {
            public function __construct()
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
            }
        };
        $gateway->init_form_fields();
        TinyAssert::same(false, array_key_exists('company_search_location', $gateway->form_fields));

        $key = $gateway->get_option_key();
        $drop = new ReflectionMethod(WC_Twoinc::class, 'drop_removed_settings');
        $drop->setAccessible(true);

        $GLOBALS['__twoinc_test_options'][$key] = ['company_search_location' => 'payment_tile', 'api_key' => 'keep-me'];
        $gateway->init_settings();
        $drop->invoke($gateway);
        TinyAssert::same(['api_key' => 'keep-me'], $GLOBALS['__twoinc_test_options'][$key]);
    }

    /**
     * TWO-25326, Doug's ruling: the standalone "Enable company name search
     * for other payment options" setting is removed outright — whether
     * company search shows for OTHER payment methods now follows the same
     * "Enable company search in address entry" checkbox directly, with no
     * independent toggle. Mirrors
     * testCompanySearchLocationSettingDroppedFromUpgradedInstalls above: the
     * admin field must be gone, and drop_removed_settings() must clean the
     * option key up on an install that saved it before removal.
     */
    private static function testEnableCompanySearchForOthersSettingDroppedFromUpgradedInstalls(): void
    {
        $gateway = new class () extends WC_Twoinc {
            public function __construct()
            {
                $this->id = WC_Twoinc_Brand::get('gateway_id');
            }
        };
        $gateway->init_form_fields();
        TinyAssert::same(
            false,
            array_key_exists('enable_company_search_for_others', $gateway->form_fields)
        );

        $key = $gateway->get_option_key();
        $drop = new ReflectionMethod(WC_Twoinc::class, 'drop_removed_settings');
        $drop->setAccessible(true);

        $GLOBALS['__twoinc_test_options'][$key] = [
            'enable_company_search_for_others' => 'yes',
            'api_key' => 'keep-me'
        ];
        $gateway->init_settings();
        $drop->invoke($gateway);
        TinyAssert::same(['api_key' => 'keep-me'], $GLOBALS['__twoinc_test_options'][$key]);
    }

    /**
     * The declined ("not available") box carries the same company-token
     * mechanism as the approved notice (TWO-25326 §7.3, ruling 2026-08-03):
     * %1$s is the brand product name, resolved here; %2$s is the buyer's
     * captured company, left as the {company} token for twoinc.js to
     * substitute, since only the browser knows it.
     */
    private static function testDeclinedBoxCarriesCompanyTemplate(): void
    {
        self::useTaglineBrand();
        $html = self::gateway()->build_payment_description();

        TinyAssert::true(
            strpos(
                $html,
                'twoinc-pay-box twoinc-err-payment-default hidden" role="alert" data-company-template="Taglinebrand is not'
                . ' available for this order by {company}"'
            ) !== false,
            'the declined box must carry the company template, brand name resolved, company tokenised'
        );

        // The no-company fallback text is still the box's own visible content.
        TinyAssert::true(
            strpos($html, 'Invoice purchase with Taglinebrand is not available for this order.') !== false,
            'the no-company fallback sentence must be unchanged'
        );
    }

    /**
     * 2026-08-04 ruling (TWO-25326): the declined/"not available" notice is
     * never brand-overridable. WC_Twoinc no longer reads an
     * 'intent_declined_notice' brand key at all, so a brand file declaring
     * one (fixtures/decidedoverridebrand.php) must be silently ignored —
     * the platform default copy renders regardless, with only the brand's
     * product_name substituted the normal way.
     */
    private static function testDeclinedNoticeIgnoresABrandOverrideKey(): void
    {
        add_filter('twoinc_brand_file', static function ($file) {
            return __DIR__ . '/fixtures/decidedoverridebrand.php';
        });

        $html = self::gateway()->build_payment_description();

        TinyAssert::true(
            strpos(
                $html,
                'twoinc-pay-box twoinc-err-payment-default hidden" role="alert" data-company-template="Decidedoverridebrand'
                . ' is not available for this order by {company}"'
            ) !== false,
            'the declined box must render the platform default copy, ignoring the brand override key'
        );
        TinyAssert::true(
            strpos($html, 'This override must never render') === false,
            'a brand-declared intent_declined_notice must never reach rendered output'
        );
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
                'data-company-template="This order by {company} is likely to be accepted by Two"'
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
                    'data-company-template="This order by {company} is likely to be accepted by ' . $product . '"'
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
     * The order-intent loading state renders the shared spinner GIF beside
     * the VISIBLE words "Checking availability" — the cross-platform target
     * agreed 2026-08-04 for TWO-25326, the same asset and the same sentence
     * on all four checkouts.
     *
     * Both halves of the thing this replaces are asserted gone, because
     * either surviving reproduces the reported bug: the three dots (this
     * checkout was the only one of the four showing no words at all) and the
     * `.twoinc-sr-only` wrapper that kept the sentence off screen. The dot
     * RULE must survive in the stylesheet, though — the term-chip fee quote
     * still uses it, and deleting it with this markup would take the chips'
     * loading state out with it.
     */
    private static function testIntentLoaderRendersTheSharedSpinnerAndVisibleText(): void
    {
        $html = self::gateway()->build_payment_description();
        // Asserted as ONE composed string rather than three independent
        // substring checks (review round 1): separate checks pass however the
        // nodes are ordered or nested, and "spinner, then sentence, both direct
        // children of the announced region" is the thing being pinned.
        TinyAssert::true(
            strpos(
                $html,
                '<div class="twoinc-pay-box twoinc-loader hidden" role="status">'
                . '<span class="twoinc-loader__spinner" aria-hidden="true"></span>'
                . '<span class="twoinc-loader__text">Checking availability</span>'
                . '</div>'
            ) !== false,
            'the loader must render the spinner then the visible sentence, inside the announced region'
        );
        TinyAssert::true(
            strpos($html, 'twoinc-dots') === false,
            'the wordless three-dot pulse must be gone from the loader markup'
        );
        TinyAssert::true(
            strpos($html, 'twoinc-sr-only') === false,
            'and the sentence must no longer be hidden behind a screen-reader-only span'
        );

        // What the STYLESHEET does with these classes — the spinner's paint, the
        // verdict colours, the loader's layout — is asserted in
        // tests/js/intent-loading-state.test.js against jsdom's real cascade.
        // Raw-text greps over the CSS were tried here first and were wrong three
        // ways (review round 1): blind to a commented-out declaration, blind to a
        // later overriding rule, and blind to an at-rule-wrapped copy.
        //
        // The asset's existence still belongs here, though: it is a file in the
        // release tree, not a computed style, and a background-image URL pointing
        // at nothing fails silently — no console error, just no motion.
        TinyAssert::true(
            is_file(dirname(__DIR__, 2) . '/assets/images/loader.gif'),
            'the spinner asset must exist in the tree the stylesheet resolves against'
        );

        $css = (string) file_get_contents(dirname(__DIR__, 2) . '/assets/css/twoinc.css');
        TinyAssert::true(
            strpos($css, '.twoinc-dots {') !== false,
            'the shared dot rule must survive for the term-chip fee quote'
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
     * The verdict boxes hold a bare sentence — no title, no nested markup — on
     * all three (TWO-25326, 2026-08-04).
     *
     * The colour and border that make them read as verdicts rather than as tile
     * copy live in the stylesheet, and are asserted against jsdom's real
     * cascade in tests/js/intent-loading-state.test.js. What is markup, and so
     * belongs here: the PrestaShop box grew a marketing heading above its
     * sentence, that heading is dropped in the same pass, and this platform must
     * not grow one. Round 1 checked only the phone-number box, which is the one
     * box a heading would never have been added to.
     */
    private static function testIntentVerdictBoxesHoldABareSentence(): void
    {
        $html = self::gateway()->build_payment_description();

        foreach (
            [
                'twoinc-intent-approved' => 'the approved notice',
                'twoinc-err-payment-default' => 'the "not available" box',
                'twoinc-err-phone-number' => 'the phone-number box',
            ] as $class => $label
        ) {
            TinyAssert::same(
                1,
                preg_match(
                    // `[^<]+`, not `[^<]*`: an EMPTY box passed the star form
                    // (review round 2), and a verdict box with no sentence in it
                    // is exactly as broken as one with a heading above it.
                    '#<div class="twoinc-pay-box ' . preg_quote($class, '#') . ' hidden"[^>]*>[^<]+</div>#',
                    $html
                ),
                $label . ' must hold a bare sentence, with no title or nested markup'
            );
        }
    }

    /**
     * Every verdict box is announced (review round 1).
     *
     * The loader carried role="status" and the three boxes carried nothing, so a
     * screen-reader buyer heard that a check had started and never heard how it
     * ended — and the colour this pass adds does nothing for them. Asserted per
     * box because the failure mode is one of the three being missed, and
     * asserted on the role NAME because polite/assertive is a deliberate split:
     * an approval can wait for a gap in speech, a decline has just deselected
     * the payment method under the buyer.
     */
    private static function testIntentVerdictBoxesAreAnnounced(): void
    {
        $html = self::gateway()->build_payment_description();

        foreach (
            [
                'twoinc-loader' => 'status',
                'twoinc-intent-approved' => 'status',
                'twoinc-err-payment-default' => 'alert',
                'twoinc-err-phone-number' => 'alert',
            ] as $class => $role
        ) {
            TinyAssert::same(
                1,
                preg_match(
                    '#<div class="twoinc-pay-box ' . preg_quote($class, '#') . ' hidden" role="'
                        . $role . '"#',
                    $html
                ),
                $class . ' must carry role="' . $role . '"'
            );
        }
    }

    /**
     * TWO-25224: the switch governs the reassurance messaging around the
     * order-intent pre-check, and the loading state is part of that — a
     * brand that declined the approval sentence was still announcing
     * "Checking availability" while the check ran.
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
            strpos($html, 'Checking availability') === false,
            'and none of the loading copy either — it is on-screen text now, so it would be plainly visible'
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

    /**
     * TWO-25326 §7.1-§7.3, ruling 2026-08-03: the standalone company-tile
     * label this section originally tested (PR #431) is gone outright, on
     * every brand, notice switch or not — it is superseded, not conditional.
     * The company-search tile slot that replaces its POSITION is unrelated to
     * the notice switch entirely: it exists to let the location SETTING
     * (§7.1) move the search control into the tile, which has nothing to do
     * with whether the approved-intent reassurance copy is on. It must
     * therefore render on BOTH a brand that suppresses the notice and one
     * that does not.
     *
     * The declined ("not available") box is the one still worth pinning
     * against the switch here (TWO-25224's rule, extended by §7.3's new
     * company template): it is NEVER gated on
     * 'intent_approved_notice_enabled', so its data-company-template must
     * survive even on a brand that suppresses the approved notice entirely.
     */
    private static function testCompanySearchTileSlotAndDeclinedTemplateSurviveNoticeSuppression(): void
    {
        add_filter('twoinc_brand_file', static function ($file) {
            return __DIR__ . '/fixtures/suppressednoticebrand.php';
        });
        TinyAssert::same(false, WC_Twoinc_Brand::get('intent_approved_notice_enabled'));

        $html = self::gateway()->build_payment_description();
        TinyAssert::true(
            strpos($html, 'twoinc-company-tile-label') === false,
            'the superseded standalone company tile label must never be emitted'
        );
        TinyAssert::true(
            strpos($html, '<div class="twoinc-company-search-tile-slot hidden"></div>') !== false,
            'the tile slot must still render on a brand that suppresses the approved notice'
        );
        TinyAssert::true(
            strpos(
                $html,
                'twoinc-pay-box twoinc-err-payment-default hidden" role="alert" data-company-template="Suppressednoticebrand'
                . ' is not available for this order by {company}"'
            ) !== false,
            'the declined box\'s company template must survive the approved notice being suppressed'
        );

        self::reset();
        self::useTaglineBrand();
        $enabled_html = self::gateway()->build_payment_description();
        TinyAssert::true(
            strpos($enabled_html, '<div class="twoinc-company-search-tile-slot hidden"></div>') !== false,
            'the tile slot must also render on a brand with the notice on'
        );
    }

    /**
     * Enqueued asset versions must key off the asset file's own mtime, not
     * the static plugin version — a CDN/browser cache-busting fix. Two real
     * files with different mtimes must resolve to different versions, and
     * touching one file must not change the other's version.
     */
    private static function testAssetVersionTracksFileMtimeNotPluginVersion(): void
    {
        $js = WC_TWOINC_PLUGIN_PATH . 'assets/js/twoinc.js';
        $css = WC_TWOINC_PLUGIN_PATH . 'assets/css/twoinc.css';

        TinyAssert::same((string) filemtime($js), twoinc_get_asset_version('assets/js/twoinc.js'));
        TinyAssert::same((string) filemtime($css), twoinc_get_asset_version('assets/css/twoinc.css'));

        // Bumping one file's mtime changes only that file's resolved version.
        $original_js_mtime = filemtime($js);
        $css_version_before = twoinc_get_asset_version('assets/css/twoinc.css');
        try {
            touch($js, $original_js_mtime + 3600);
            TinyAssert::same((string) ($original_js_mtime + 3600), twoinc_get_asset_version('assets/js/twoinc.js'));
            TinyAssert::same($css_version_before, twoinc_get_asset_version('assets/css/twoinc.css'));
        } finally {
            touch($js, $original_js_mtime);
        }
    }

    /**
     * A missing/renamed asset must fall back to the plugin version string,
     * not emit a PHP warning or an empty `?ver=` argument.
     */
    private static function testAssetVersionFallsBackToPluginVersionWhenFileMissing(): void
    {
        $GLOBALS['__twoinc_test_plugin_version'] = '9.9.9-test';
        try {
            TinyAssert::same('9.9.9-test', twoinc_get_asset_version('assets/js/does-not-exist.js'));
        } finally {
            unset($GLOBALS['__twoinc_test_plugin_version']);
        }
    }

    /**
     * TWO-25326 follow-up (2026-08-05 incident). Before this change, EVERY
     * non-200 response — an actual 401/403, a Two 5xx, or a network
     * failure that never got a response at all — was treated identically
     * as "invalid key" everywhere this plugin surfaces the outcome. These
     * assert categorize_verification_result() actually tells them apart.
     */
    private static function testCategorizeVerificationResultDistinguishesFailureReasons(): void
    {
        TinyAssert::same('ok', WC_Twoinc::categorize_verification_result(['body' => ['id' => '1'], 'code' => 200])['status']);
        TinyAssert::same('invalid_key', WC_Twoinc::categorize_verification_result(['body' => [], 'code' => 401])['status']);
        TinyAssert::same('invalid_key', WC_Twoinc::categorize_verification_result(['body' => [], 'code' => 403])['status']);
        TinyAssert::same('service_error', WC_Twoinc::categorize_verification_result(['body' => [], 'code' => 500])['status']);
        TinyAssert::same('service_error', WC_Twoinc::categorize_verification_result(['body' => [], 'code' => 503])['status']);
        TinyAssert::same('unreachable', WC_Twoinc::categorize_verification_result(['error' => 'unreachable', 'code' => null])['status']);
        TinyAssert::same('not_configured', WC_Twoinc::categorize_verification_result(null)['status']);
        $other = WC_Twoinc::categorize_verification_result(['body' => [], 'code' => 404]);
        TinyAssert::same('error', $other['status']);
        TinyAssert::same(404, $other['code']);
    }

    /**
     * verify_api_key() itself must not collapse "not configured" (no
     * key/host) and "unreachable" (a real network/timeout failure talking
     * to Two) into the same falsy return — that is exactly the distinction
     * an admin diagnosing today's routing incident needed.
     */
    private static function testVerifyApiKeyDistinguishesUnreachableFromNotConfigured(): void
    {
        $gateway = new class () extends WC_Twoinc {
            public $options = ['api_key' => 'key'];
            public $host = 'https://api.example';
            public $wp_error_response = true;

            public function __construct()
            {
            }

            public function get_twoinc_checkout_host()
            {
                return $this->host;
            }

            public function get_option($key, $empty_value = null)
            {
                return $this->options[$key] ?? $empty_value ?? '';
            }

            public function make_request($endpoint, $payload = [], $method = 'POST', $params = [], $api_key_override = null, $timeout = 30)
            {
                return $this->wp_error_response ? new WP_Error('http_request_failed', 'timed out') : false;
            }
        };

        TinyAssert::same('unreachable', WC_Twoinc::categorize_verification_result($gateway->verify_api_key())['status']);

        // No host configured at all: a fundamentally different situation
        // from a reachable host that times out, and must stay distinct.
        $gateway->host = '';
        TinyAssert::same(null, $gateway->verify_api_key());
        TinyAssert::same('not_configured', WC_Twoinc::categorize_verification_result($gateway->verify_api_key())['status']);
    }

    /**
     * is_available() / the checkout bootstrap must not fire a live
     * verify_api_key() HTTP call on every evaluation — get_api_key_verification_status()
     * is expected to serve the second call from its transient cache
     * without touching make_request() again.
     */
    private static function testApiKeyVerificationStatusCachedAcrossCallsWithinTtl(): void
    {
        $gateway = new class () extends WC_Twoinc {
            public $options = ['api_key' => 'key'];
            public $responses = [];
            public $make_request_calls = 0;

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
                $this->make_request_calls++;
                return array_shift($this->responses);
            }
        };

        $gateway->responses[] = ['response' => ['code' => 200], 'body' => json_encode(['id' => '42', 'short_name' => 'Acme'])];

        $first = $gateway->get_api_key_verification_status();
        TinyAssert::same('ok', $first['status']);
        TinyAssert::same(1, $gateway->make_request_calls);

        $second = $gateway->get_api_key_verification_status();
        TinyAssert::same('ok', $second['status']);
        TinyAssert::same(1, $gateway->make_request_calls); // still 1: served from cache, no second HTTP call

        // A different gateway instance (a fresh api_key => a different
        // cache key) is NOT served from the first instance's cache.
        $other = new class () extends WC_Twoinc {
            public $options = ['api_key' => 'a-different-key'];
            public $responses = [];
            public $make_request_calls = 0;

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
                $this->make_request_calls++;
                return array_shift($this->responses);
            }
        };
        $other->responses[] = new WP_Error('http_request_failed', 'timed out');
        $other_status = $other->get_api_key_verification_status();
        TinyAssert::same('unreachable', $other_status['status']);
        TinyAssert::same(1, $other->make_request_calls);
    }

    /**
     * The Two payment method must not be listed as available when the
     * stored key cannot currently be verified — for ANY of the failure
     * categories, not only an actual 401/403 (TWO-25326 follow-up: today's
     * incident was a routing failure, which must hide the gateway exactly
     * as an actually-invalid key would).
     */
    private static function testIsAvailableFalseWhenApiKeyVerificationFails(): void
    {
        $make_gateway = static function ($response) {
            return new class ($response) extends WC_Twoinc {
                public $options = ['api_key' => 'key'];
                public $enabled = 'yes';
                private $response;

                public function __construct($response)
                {
                    $this->response = $response;
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
                    return $this->response;
                }
            };
        };

        TinyAssert::same(false, $make_gateway(['response' => ['code' => 401], 'body' => json_encode([])])->is_available());
        $GLOBALS['__twoinc_test_transients'] = [];
        TinyAssert::same(false, $make_gateway(['response' => ['code' => 503], 'body' => json_encode([])])->is_available());
        $GLOBALS['__twoinc_test_transients'] = [];
        TinyAssert::same(false, $make_gateway(new WP_Error('http_request_failed', 'timed out'))->is_available());
    }

    /**
     * is_available() must AND the two independent conditions together: a
     * disabled-but-verified gateway stays hidden (unchanged core
     * behaviour), and an enabled gateway with a verified key is the only
     * combination that is actually available.
     */
    private static function testIsAvailableTrueOnlyWhenEnabledAndVerified(): void
    {
        $gateway = new class () extends WC_Twoinc {
            public $options = ['api_key' => 'key'];
            public $enabled = 'no';

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
                return ['response' => ['code' => 200], 'body' => json_encode(['id' => '42'])];
            }
        };

        // Verified key, but the merchant has disabled the gateway itself.
        TinyAssert::same(false, $gateway->is_available());

        $gateway->enabled = 'yes';
        $GLOBALS['__twoinc_test_transients'] = [];
        TinyAssert::same(true, $gateway->is_available());
    }

    /**
     * `window.twoinc` is what the payment-tile bootstrap AND the
     * address-block company-search widget both gate on entirely (see the
     * top-level `if (window.twoinc)` guard in twoinc.js) — so withholding
     * it on a verification failure is what stops company search from
     * rendering/enabling itself on a broken integration, for ANY failure
     * reason (TWO-25326 follow-up).
     */
    private static function testCheckoutWindowTwoincSuppressedOnVerificationFailure(): void
    {
        $GLOBALS['__twoinc_test_is_checkout'] = true;

        $gateway = new class () extends WC_Twoinc {
            public $options = ['api_key' => 'key'];
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
        $gateway->responses[] = ['response' => ['code' => 401], 'body' => json_encode(['message' => 'invalid'])];

        $checkout = new WC_Twoinc_Checkout($gateway);
        ob_start();
        $checkout->inject_cart_details();
        $output = ob_get_clean();

        TinyAssert::same('', trim($output));
        unset($GLOBALS['__twoinc_test_is_checkout']);
    }

    /**
     * Review round 1 (Vader): a truthy, non-WP_Error response that lacks a
     * 'body' key at all must not fall through to the same null
     * verify_api_key() returns for "not configured" — that would tell an
     * admin to "enter an API key" when one is already configured and a
     * response WAS received, just an unexpected/malformed one.
     */
    private static function testVerifyApiKeyMalformedResponseNotMiscategorizedAsNotConfigured(): void
    {
        $gateway = new class () extends WC_Twoinc {
            public $options = ['api_key' => 'key'];

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

            public function make_request($endpoint, $payload = [], $method = 'POST', $params = [], $api_key_override = null, $timeout = 30)
            {
                // Truthy, not a WP_Error, but no 'body' key — the
                // malformed/unexpected shape probed in review round 1.
                return ['response' => ['code' => 503]];
            }
        };

        $result = $gateway->verify_api_key();
        $category = WC_Twoinc::categorize_verification_result($result)['status'];
        TinyAssert::same(false, $category === 'not_configured');
        TinyAssert::same('error', $category);
    }

    /**
     * Review round 1 (Han): the settings page's own live re-check
     * (verify_api_key_action() / the AJAX handler, via
     * cache_verification_result()) must feed the SAME cache
     * get_api_key_verification_status() reads, so a merchant who just
     * fixed their key doesn't wait out API_KEY_VERIFICATION_TTL for
     * checkout to notice.
     */
    private static function testAdminLiveVerificationWarmsCheckoutCache(): void
    {
        $gateway = new class () extends WC_Twoinc {
            public $options = ['api_key' => 'key'];
            public $make_request_calls = 0;

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
                $this->make_request_calls++;
                return ['response' => ['code' => 200], 'body' => json_encode(['id' => '42', 'short_name' => 'Acme'])];
            }
        };

        // Simulates the settings-page load: a fresh, live, uncached check —
        // exactly what verify_api_key_action() does.
        $gateway->verify_api_key_action();
        TinyAssert::same(1, $gateway->make_request_calls);

        // The checkout-facing cache must already be warm from that — no
        // second HTTP call.
        $status = $gateway->get_api_key_verification_status();
        TinyAssert::same('ok', $status['status']);
        TinyAssert::same(1, $gateway->make_request_calls);
    }

    /**
     * Review round 1 (Yoda): a cache-miss check evaluated inline in a
     * customer-facing request (is_available(), inject_cart_details()) must
     * use a short, explicit timeout — not verify_api_key()'s 30s
     * admin-page default, which would block that page render for up to
     * 30s while Two is unreachable.
     */
    private static function testCachedStatusMissTimeoutIsShortNotAdminDefault(): void
    {
        $gateway = new class () extends WC_Twoinc {
            public $options = ['api_key' => 'key'];
            public $seen_timeout = null;

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
                $this->seen_timeout = $timeout;
                return ['response' => ['code' => 200], 'body' => json_encode(['id' => '42'])];
            }
        };

        $gateway->get_api_key_verification_status();
        TinyAssert::same(WC_Twoinc::API_KEY_VERIFICATION_TIMEOUT, $gateway->seen_timeout);
        TinyAssert::same(true, WC_Twoinc::API_KEY_VERIFICATION_TIMEOUT < 30);
    }

    private static function testApiKeyNoticesCarryTwoProductNameAndStatusPlaceholder(): void
    {
        $notices = self::gateway()->get_api_key_notices();

        TinyAssert::same(
            "Two's API returned a service error (HTTP %s). This is likely temporary on Two's side — try again shortly.",
            $notices['service_error']
        );
        TinyAssert::same(
            "Could not reach Two's API (network or connectivity error). Try again shortly.",
            $notices['unreachable']
        );
        TinyAssert::same('Enter an API key above to enable Two.', $notices['not_configured']);
        TinyAssert::same(
            "Two's API returned an unexpected response (HTTP %s).",
            $notices['unexpected_response']
        );
    }

    private static function testApiKeyNoticesUseOverlayProductNameNotTwo(): void
    {
        // The brand overlay's admin must never be told to contact "Two":
        // the notice copy carries the brand's product name, and the '%s'
        // admin.js substitutes the HTTP status code into must survive the
        // brand interpolation.
        self::useTestbrand();

        $notices = self::gateway()->get_api_key_notices();

        foreach (['service_error', 'unreachable', 'not_configured', 'unexpected_response'] as $key) {
            TinyAssert::true(
                strpos($notices[$key], 'Testbrand') !== false,
                "Notice '$key' must name the overlay brand, got: " . $notices[$key]
            );
            TinyAssert::true(
                strpos($notices[$key], 'Two') === false,
                "Notice '$key' must not name Two, got: " . $notices[$key]
            );
        }

        TinyAssert::same(
            "Testbrand's API returned a service error (HTTP %s). This is likely temporary on Testbrand's side — try again shortly.",
            $notices['service_error']
        );
        TinyAssert::same(
            "Testbrand's API returned an unexpected response (HTTP %s).",
            $notices['unexpected_response']
        );
    }

    private static function testApiKeyNoticeCatalogueWithBadPlaceholdersDegradesNotFatals(): void
    {
        $templates = WC_Twoinc::api_key_notice_templates();
        // A runtime-installed catalogue is not gated by this repo's msgfmt
        // check: translate.wordpress.org imports and Loco-edited .mo files can
        // carry a placeholder the source never had. On PHP 8 sprintf() throws
        // for that, and this runs inside admin_enqueue_scripts — unhandled it
        // would take the whole gateway settings page down.
        $GLOBALS['__twoinc_test_translations'] = [
            // One placeholder more than the source declares.
            $templates['service_error'] => 'Tjenestefeil hos %1$s (HTTP %2$s) — %3$s.',
            // A status placeholder in a template that has none: nothing would
            // substitute it, so this must degrade rather than render a raw %s.
            $templates['unreachable'] => 'Nådde ikke %1$s (HTTP %2$s).',
            // Same shortfall expressed with bare rather than numbered
            // placeholders. (An outright invalid specifier such as a stray
            // "100% klar" is deliberately NOT asserted on: PHP 7.4 silently
            // drops the bad conversion and returns a string where PHP 8
            // throws, so the two supported floors disagree — and a mangled
            // sentence is not the failure this guard exists for.)
            $templates['not_configured'] => 'Skriv inn en nøkkel for %s (%s).',
        ];

        $notices = self::gateway()->get_api_key_notices();

        TinyAssert::same($templates['unverified'], $notices['service_error']);
        TinyAssert::same($templates['unverified'], $notices['unreachable']);
        TinyAssert::same($templates['unverified'], $notices['not_configured']);
        // Only the broken categories degrade; the rest render normally.
        TinyAssert::same(
            "Two's API returned an unexpected response (HTTP %s).",
            $notices['unexpected_response']
        );
        TinyAssert::same('This API key is invalid or has expired.', $notices['invalid_key']);
        // And no degraded notice carries a placeholder nothing will fill.
        foreach ($notices as $key => $notice) {
            if ($key === 'service_error' || $key === 'unexpected_response') {
                continue; // admin.js substitutes the status code into these two
            }
            TinyAssert::true(
                strpos($notice, '%s') === false,
                "the '$key' notice must not reach the admin with an unsubstituted placeholder"
            );
        }
        // And the failure is not swallowed silently. Match the message rather
        // than counting every log line, so an unrelated log cannot satisfy it —
        // and expect one line PER broken category, naming it: four can break at
        // once and a single line naming none of them is not diagnosable.
        TinyAssert::same(3, self::countNoticeMismatchLogs(), 'each broken category must be logged');
        foreach (['service_error', 'unreachable', 'not_configured'] as $key) {
            TinyAssert::same(1, self::countNoticeMismatchLogs($key), "the '$key' failure must name itself");
        }

        // ...but only once per category. These notices are rebuilt on every
        // wp-admin page view and a bad catalogue stays bad, so an unthrottled
        // log would grow without bound.
        self::gateway()->get_api_key_notices();
        self::gateway()->get_api_key_notices();
        TinyAssert::same(3, self::countNoticeMismatchLogs(), 'the mismatch log must be throttled per category');

        // Assert the TRANSIENT, not just the count: a per-request static would
        // satisfy the repeat-call assertion above and still write a line on
        // every wp-admin page view, which is the thing that has to stop. The
        // transient is the only observable difference between the two.
        foreach (['service_error', 'unreachable', 'not_configured'] as $key) {
            TinyAssert::true(
                (bool) get_transient(WC_Twoinc_Brand::prefixed_name('notice_format_logged_' . $key)),
                "the '$key' log must be throttled by a transient that outlives the request"
            );
        }
        // A category whose translation is fine must not be throttled — that
        // would suppress its first real failure.
        TinyAssert::same(
            false,
            get_transient(WC_Twoinc_Brand::prefixed_name('notice_format_logged_unexpected_response'))
        );
    }

    private static function countNoticeMismatchLogs(string $category = ''): int
    {
        $needle = $category === ''
            ? 'does not match the source placeholders'
            : 'the "' . $category . '" API key notice does not match';

        return count(array_filter(
            $GLOBALS['__twoinc_test_logs'],
            static function ($entry) use ($needle) {
                return strpos($entry['message'] ?? '', $needle) !== false;
            }
        ));
    }

    private static function testApiKeyNoticeDroppingTheStatusPlaceholderDegrades(): void
    {
        $templates = WC_Twoinc::api_key_notice_templates();
        // vsprintf accepts a format string that uses fewer arguments than it is
        // given, so a translation that simply omits the status placeholder
        // formats cleanly — and the notice loses the HTTP status code, the one
        // detail that tells an admin which failure they are looking at. There is
        // no error to catch here; only the missing placeholder reveals it.
        $GLOBALS['__twoinc_test_translations'] = [
            $templates['service_error'] => 'Tjenestefeil hos %1$s. Prøv igjen snart.',
        ];

        $notices = self::gateway()->get_api_key_notices();

        TinyAssert::same($templates['unverified'], $notices['service_error']);
        TinyAssert::same(1, self::countNoticeMismatchLogs('service_error'));
        // A translation that KEEPS the placeholder is untouched.
        TinyAssert::same(
            "Two's API returned an unexpected response (HTTP %s).",
            $notices['unexpected_response']
        );
        TinyAssert::same(0, self::countNoticeMismatchLogs('unexpected_response'));
    }

    private static function testApiKeyNoticesNeverShipAnUnfillablePlaceholder(): void
    {
        $templates = WC_Twoinc::api_key_notice_templates();
        // The three notices the plugin does not format, and the fallback the
        // degraded path returns, are all translated strings too — nothing
        // downstream substitutes into them, so a catalogue that invented a
        // specifier would otherwise print it verbatim at the admin. Covers the
        // shapes str_replace('%s') alone would have missed.
        $GLOBALS['__twoinc_test_translations'] = [
            $templates['invalid_key'] => 'Nøkkelen er ugyldig %s.',
            $templates['request_failed'] => 'Kunne ikke fullføre %1$s.',
            $templates['unverified'] => 'Kunne ikke verifisere %d.',
        ];

        $notices = self::gateway()->get_api_key_notices();

        TinyAssert::same('Nøkkelen er ugyldig .', $notices['invalid_key']);
        TinyAssert::same('Kunne ikke fullføre .', $notices['request_failed']);
        TinyAssert::same('Kunne ikke verifisere .', $notices['unverified']);

        // An escaped percent and a literal percent in prose both survive on the
        // notices the plugin does not format at all.
        $GLOBALS['__twoinc_test_translations'] = [
            $templates['invalid_key'] => 'Bare 100% av nøklene, 50%% av tiden.',
        ];
        TinyAssert::same(
            'Bare 100% av nøklene, 50%% av tiden.',
            self::gateway()->get_api_key_notices()['invalid_key']
        );

        // The two status-free categories ARE formatted, and formatting
        // UNescapes '%%s' into a literal '%s'. Nothing downstream substitutes
        // into those two — admin.js only fills the status code in the other
        // two — so it would render verbatim at the admin unless the formatted
        // result is stripped as well.
        $GLOBALS['__twoinc_test_translations'] = [
            $templates['unreachable'] => 'Nådde ikke %1$s (%%s).',
            $templates['not_configured'] => 'Skriv inn en nøkkel for %1$s (%%d).',
        ];
        $notices = self::gateway()->get_api_key_notices();
        TinyAssert::same('Nådde ikke Two ().', $notices['unreachable']);
        TinyAssert::same('Skriv inn en nøkkel for Two ().', $notices['not_configured']);
    }

    private static function testApiKeyNoticeCopyIsTranslatedInEveryLocale(): void
    {
        $languages = dirname(__DIR__, 2) . '/languages/';

        // Read the msgids off the live source rather than retyping them: the
        // regression this exists to catch is the copy being reworded without
        // the catalogues being regenerated, and a hardcoded copy of the
        // literal cannot see that. __() is stubbed to identity here, so
        // api_key_notice_templates() carries the untranslated source strings.
        $msgids = WC_Twoinc::api_key_notice_templates();
        // The four brand-bearing entries are the point of TWO-25326's fix; the
        // other three carry no placeholder and are checked alongside them.
        foreach (['service_error', 'unreachable', 'not_configured', 'unexpected_response'] as $key) {
            TinyAssert::true(
                strpos($msgids[$key], '%') !== false,
                "the '$key' msgid must carry a placeholder for the brand, not a hardcoded product name"
            );
            TinyAssert::true(
                strpos($msgids[$key], 'Two') === false,
                "the '$key' msgid must not hardcode a product name"
            );
        }

        $pot = file_get_contents($languages . 'twoinc-payment-gateway.pot');
        foreach ($msgids as $key => $msgid) {
            // The length floor is load-bearing: a degenerate short msgid would
            // make every strpos() below vacuously true.
            TinyAssert::true(
                is_string($msgid) && strlen($msgid) > 20,
                "the '$key' notice must carry copy to translate"
            );
            TinyAssert::true(
                strpos($pot, $msgid) !== false,
                "the .pot is missing the '$key' API-key notice msgid — regenerate it"
            );
        }

        // One recognisable fragment per locale is enough: the msgid assertion
        // pins the lookup, and a fragment survives any later rewording of the
        // rest of the sentence.
        $fragments = [
            'nb_NO' => ['returnerte en tjenestefeil', 'Kunne ikke nå API-et til %s'],
            'nl_NL' => ['gaf een servicefout terug', 'Kon de API van %s niet bereiken'],
            'sv_SE' => ['returnerade ett tjänstefel', 'Det gick inte att nå API:et för %s'],
        ];

        foreach ($fragments as $locale => $expected) {
            $mo = file_get_contents($languages . 'twoinc-payment-gateway-' . $locale . '.mo');
            foreach ($msgids as $key => $msgid) {
                // A msgid that has drifted from the source literal misses the
                // lookup and renders English however good the msgstr is. __()
                // is stubbed to identity here, so nothing else can see that.
                TinyAssert::true(
                    strpos($mo, $msgid) !== false,
                    "compiled $locale msgid for '$key' has drifted from the source literal "
                        . '(recompile with msgfmt after editing the .po?)'
                );
            }
            foreach ($expected as $fragment) {
                TinyAssert::true(
                    strpos($mo, $fragment) !== false,
                    "compiled $locale catalogue is missing the API-key notice copy — "
                        . 'that shop would render English'
                );
            }
        }
    }

    /**
     * "Checking availability" is now VISIBLE buyer-facing copy on every
     * checkout, so an untranslated catalogue is now a visible English string
     * on a Norwegian, Dutch or Swedish shop rather than a screen-reader-only
     * one. Same shape as the API-key notice check above and for the same
     * reason: the msgid is read back off the rendered markup rather than
     * retyped, so rewording the sentence without regenerating the catalogues
     * fails here instead of shipping.
     */
    private static function testIntentLoaderCopyIsTranslatedInEveryLocale(): void
    {
        $languages = dirname(__DIR__, 2) . '/languages/';
        $msgid = 'Checking availability';

        // __() is stubbed to identity in this suite, so the rendered markup
        // carries the untranslated source string — which is the msgid the
        // catalogues have to match exactly.
        TinyAssert::true(
            strpos(self::gateway()->build_payment_description(), '>' . $msgid . '<') !== false,
            'the loader sentence has been reworded — update this msgid and the catalogues with it'
        );

        TinyAssert::true(
            strpos((string) file_get_contents($languages . 'twoinc-payment-gateway.pot'), $msgid) !== false,
            'the .pot is missing the loader sentence — regenerate it'
        );

        // Every locale the plugin ships, discovered rather than listed (review
        // round 1): a hardcoded list silently exempts a catalogue added later.
        $expected = [
            'nb_NO' => 'Sjekker tilgjengelighet',
            'nl_NL' => 'Beschikbaarheid controleren',
            'sv_SE' => 'Kontrollerar tillgänglighet',
        ];
        $catalogues = glob($languages . 'twoinc-payment-gateway-*.po');
        TinyAssert::true($catalogues !== false && $catalogues !== [], 'no .po catalogues found at all');
        $visited = [];
        foreach ($catalogues as $po) {
            preg_match('/twoinc-payment-gateway-(.+)\.po$/', $po, $m);
            $locale = $m[1];
            $visited[] = $locale;
            TinyAssert::true(
                isset($expected[$locale]),
                "locale $locale has no expected loader translation in this test — add one"
            );

            // PAIRING, not two independent searches (review round 1). Searching
            // the catalogue for the msgid and for the translation separately
            // passes when the translation is attached to some OTHER msgid, and
            // that shop then renders the wrong sentence. Read the msgstr that
            // actually follows this msgid.
            TinyAssert::same(
                $expected[$locale],
                self::poTranslation((string) file_get_contents($po), $msgid),
                "the $locale catalogue does not pair the loader sentence with its translation"
            );

            // No assertion on the compiled .mo here (review round 2). The obvious
            // one — two independent strpos over the binary — has exactly the
            // non-pairing flaw the .po check above was fixed for: it passes with
            // this msgid's own msgstr empty and the expected text belonging to a
            // different entry. .github/scripts/check-catalogues.sh already decodes
            // every .mo with msgunfmt and diffs it against its .po, so "the .po is
            // right" plus that gate IS "the .mo is right" — and that is a real
            // gate rather than a substring search over binary.
        }

        // Prove the DISCOVERY, not just the loop body (review round 8). The glob
        // exists so a catalogue added later cannot be silently exempted — but nothing
        // asserted which locales it actually found, so narrowing it to a single
        // hardcoded filename passed identically, which is the exact failure the glob
        // was introduced to prevent.
        sort($visited);
        $wanted = array_keys($expected);
        sort($wanted);
        TinyAssert::same(
            implode(',', $wanted),
            implode(',', $visited),
            'the catalogue discovery did not visit every locale this plugin ships'
        );
    }

    /**
     * The refusal a buyer meets when no company has been selected. Weaker than
     * the loader-copy check above, which reads its msgid off rendered markup:
     * this sentence lives in a submit branch, so the msgid is retyped here and
     * the call site is asserted to still spell it that way. Rewording it
     * without the catalogues therefore fails here rather than shipping English
     * to a Norwegian, Dutch or Swedish shop.
     */
    private static function testCompanyRequiredCopyIsTranslatedInEveryLocale(): void
    {
        $languages = dirname(__DIR__, 2) . '/languages/';
        $msgid = 'Please select your company before paying with %s.';

        TinyAssert::true(
            strpos(
                (string) file_get_contents(dirname(__DIR__, 2) . '/class/WC_Twoinc.php'),
                "__('" . $msgid . "', 'twoinc-payment-gateway')"
            ) !== false,
            'the company-required sentence has been reworded — update this msgid and the catalogues with it'
        );

        TinyAssert::true(
            strpos((string) file_get_contents($languages . 'twoinc-payment-gateway.pot'), $msgid) !== false,
            'the .pot is missing the company-required sentence — regenerate it'
        );

        $expected = [
            'nb_NO' => 'Velg selskapet ditt før du betaler med %s.',
            'nl_NL' => 'Selecteer uw bedrijf voordat u betaalt met %s.',
            'sv_SE' => 'Välj ditt företag innan du betalar med %s.',
        ];
        $catalogues = glob($languages . 'twoinc-payment-gateway-*.po');
        TinyAssert::true($catalogues !== false && $catalogues !== [], 'no .po catalogues found at all');
        $visited = [];
        foreach ($catalogues as $po) {
            preg_match('/twoinc-payment-gateway-(.+)\.po$/', $po, $m);
            $locale = $m[1];
            $visited[] = $locale;
            TinyAssert::true(
                isset($expected[$locale]),
                "locale $locale has no expected company-required translation in this test — add one"
            );

            TinyAssert::same(
                $expected[$locale],
                self::poTranslation((string) file_get_contents($po), $msgid),
                "the $locale catalogue does not pair the company-required sentence with its translation"
            );
        }

        sort($visited);
        $wanted = array_keys($expected);
        sort($wanted);
        TinyAssert::same(
            implode(',', $wanted),
            implode(',', $visited),
            'the catalogue discovery did not visit every locale this plugin ships'
        );
    }

    /**
     * Direct cases for poTranslation(), which every safety property in its docblock
     * needed and none had: all eight mutations of that parser survived the suite
     * (review round 6, found by mutation, not by reading).
     *
     * The live catalogues cannot exercise any of this — they contain no fuzzy entry,
     * no msgctxt, no plural and no CRLF — which is exactly why the parser's own
     * docblock said the fuzzy case was "latent today". Latent is not covered.
     * Inline .po fixtures instead, one per property.
     */
    private static function testPoTranslationParserRejectsWhatItMustReject(): void
    {
        $entry = "#: class/WC_Twoinc.php\nmsgid \"Checking availability\"\nmsgstr \"Sjekker\"\n";

        TinyAssert::same(
            'Sjekker',
            self::poTranslation("\n" . $entry, 'Checking availability'),
            'the plain case must resolve, or every rejection below is vacuous'
        );

        // A fuzzy entry is not a translation: msgfmt drops it from the .mo, so the
        // shop renders English. check-catalogues.sh cannot see it either — msgfmt
        // drops fuzzy from BOTH sides of its diff.
        TinyAssert::same(
            '',
            self::poTranslation("\n#, fuzzy\n" . $entry, 'Checking availability'),
            'a fuzzy entry must not count as a translation'
        );
        // Flag lists carry more than one entry.
        TinyAssert::same(
            '',
            self::poTranslation("\n#, php-format, fuzzy\n" . $entry, 'Checking availability'),
            'fuzzy must be found inside a multi-flag list'
        );
        // ...but a non-fuzzy flag must NOT reject, or the guard is just "reject any
        // flagged entry".
        TinyAssert::same(
            'Sjekker',
            self::poTranslation("\n#, php-format\n" . $entry, 'Checking availability'),
            'a non-fuzzy flag must not reject the entry'
        );

        // A msgctxt entry is a DIFFERENT message; __() with no context resolves the
        // context-less one, so matching this would report a translation the shop
        // never renders.
        TinyAssert::same(
            '',
            self::poTranslation(
                "\n#: class/WC_Twoinc.php\nmsgctxt \"admin\"\nmsgid \"Checking availability\"\nmsgstr \"Sjekker\"\n",
                'Checking availability'
            ),
            'a msgctxt-scoped entry must not be matched'
        );

        // CRLF, so a Windows checkout parses identically rather than mysteriously
        // returning ''. TWO entries separated by a blank line, deliberately: with one
        // entry the ENTRY splitter never has to match a blank line at all, and
        // narrowing it from `\R` to `\n` survived a single-entry fixture (review
        // round 6, found by mutation).
        $other = "#: class/WC_Twoinc.php\nmsgid \"Something else\"\nmsgstr \"Noe annet\"\n";
        TinyAssert::same(
            'Sjekker',
            self::poTranslation(
                str_replace("\n", "\r\n", "\n" . $other . "\n" . $entry),
                'Checking availability'
            ),
            'a CRLF catalogue must parse the same as LF, across an entry boundary'
        );
        // And the LF equivalent, so the assertion above is about line endings rather
        // than about which entry is found.
        TinyAssert::same(
            'Sjekker',
            self::poTranslation("\n" . $other . "\n" . $entry, 'Checking availability'),
            'the second entry of a multi-entry catalogue must be found'
        );

        // A plural entry has no single msgstr; yielding '' fails the caller loudly
        // rather than half-reading it.
        TinyAssert::same(
            '',
            self::poTranslation(
                "\nmsgid \"Checking availability\"\nmsgid_plural \"Checking\"\nmsgstr[0] \"Sjekker\"\n",
                'Checking availability'
            ),
            'a plural entry must not be half-read'
        );

        // First occurrence wins, so a continuation line cannot overwrite the field
        // it continues.
        TinyAssert::same(
            'first',
            self::poTranslation(
                "\nmsgid \"Checking availability\"\nmsgstr \"first\"\nmsgstr \"second\"\n",
                'Checking availability'
            ),
            'the first msgstr must win'
        );

        // Escapes survive the round trip both ways: a quote in the msgid is matched
        // through addcslashes, and one in the msgstr comes back unescaped.
        TinyAssert::same(
            'He said "hi"',
            self::poTranslation(
                "\nmsgid \"Say \\\"hi\\\"\"\nmsgstr \"He said \\\"hi\\\"\"\n",
                'Say "hi"'
            ),
            'escaped quotes must round-trip in both msgid and msgstr'
        );

        // A msgid that is a PREFIX of this one must not match it, and vice versa.
        TinyAssert::same(
            '',
            self::poTranslation("\nmsgid \"Checking\"\nmsgstr \"Sjekker\"\n", 'Checking availability'),
            'a shorter msgid must not match a longer one'
        );
    }

    private static function poTranslation(string $po, string $msgid): string
    {
        // Split into entries on blank lines and read each one's fields, rather
        // than pattern-matching a msgid/msgstr pair out of the whole file.
        //
        // Round 2 tried the regex and it could not be made safe: every attempt to
        // require that the line above the msgid is not a `msgctxt` was defeated by
        // the newline-matching alternative sliding forward one line. A `msgctxt`
        // entry sharing this msgid MUST NOT be matched — gettext treats it as a
        // different message and __() with no context resolves the context-less
        // entry, so the bad case is the context-less one sitting at `msgstr ""`
        // while the contextual one carries the translation: a shop rendering
        // English with this test saying translated.
        //
        // Deliberately minimal beyond that: single-line `msgid`/`msgstr` only,
        // which is the shape every entry this is used for has. A multi-line or
        // plural entry yields '' and fails the caller's assertion loudly rather
        // than being silently mis-read — a wrong-but-plausible answer is the one
        // outcome a catalogue check must not produce.
        //
        // `\R` throughout so a CRLF catalogue (a Windows checkout, core.autocrlf)
        // parses identically; a mystery '' there would be a real time sink.
        foreach (preg_split('/(?:\R)(?:[[:blank:]]*\R)+/', $po) as $entry) {
            $fields = [];
            $fuzzy = false;
            foreach (preg_split('/\R/', $entry) as $line) {
                // A fuzzy entry is NOT a translation (review round 4). msgfmt
                // excludes it from the .mo by default, so the shop renders English
                // while a naive read of the .po says translated — the identical
                // failure shape as the msgctxt case above. And check-catalogues.sh
                // cannot catch it: msgfmt drops fuzzy entries from BOTH sides of
                // its diff, so that gate stays green. Latent today (no fuzzy
                // entries in languages/), which is exactly when to close it.
                if (preg_match('/^#,[[:blank:]]*(.*)$/', $line, $flags) === 1) {
                    $fuzzy = $fuzzy || in_array('fuzzy', preg_split('/[[:blank:]]*,[[:blank:]]*/', $flags[1]), true);
                }
                if (preg_match('/^(msgctxt|msgid|msgstr) "(.*)"[[:blank:]]*$/', $line, $m) === 1) {
                    // First occurrence wins, so a continuation line cannot
                    // overwrite the field it continues.
                    $fields[$m[1]] = $fields[$m[1]] ?? $m[2];
                }
            }
            if (
                $fuzzy
                || isset($fields['msgctxt'])
                || ($fields['msgid'] ?? null) !== addcslashes($msgid, '"\\')
            ) {
                continue;
            }

            return stripcslashes($fields['msgstr'] ?? '');
        }

        return '';
    }
}

BrandConfigSpec::runAll();
print("All tests passed.\n");
