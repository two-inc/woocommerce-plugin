<?php

declare(strict_types=1);

/**
 * Environment setting (TWO-26604), driven by the shared case table
 * tests/unit/fixtures/environment-cases.json, which is byte-identical in the
 * PrestaShop and Magento plugins.
 */
final class EnvironmentOptionsSpec
{
    private const DEV_VARS = ['TWOINC_DEV_API_HOST', 'TWOINC_DEV_CHECKOUT_HOST', 'TWOINC_DEV_PORTAL_HOST'];

    public static function runAll(): void
    {
        $cases = json_decode((string) file_get_contents(__DIR__ . '/fixtures/environment-cases.json'), true);
        $home = $GLOBALS['test_home_url'] ?? null;
        $GLOBALS['test_home_url'] = 'https://shop.merchant.example';
        foreach (self::DEV_VARS as $var) {
            putenv($var);
        }

        try {
            foreach ($cases['resolve'] as $case) {
                self::assertResolveCase($case);
            }
            foreach ($cases['save'] as $case) {
                self::assertSaveCase($case);
            }
            self::testMigrationTable();
            self::testFormOffersTheOptionsInOrder();
            self::testMigrationPersists();
            self::testARefusedEnvironmentIsNoIdentityChange();
        } finally {
            putenv('TWO_INTERNAL_ENVIRONMENTS');
            $GLOBALS['test_home_url'] = $home;
            unset($GLOBALS['__twoinc_test_options'][self::gateway([])->get_option_key()]);
        }
        print("EnvironmentOptionsSpec passed.\n");
    }

    private static function setFlag(?string $flag): void
    {
        putenv($flag === null ? 'TWO_INTERNAL_ENVIRONMENTS' : 'TWO_INTERNAL_ENVIRONMENTS=' . $flag);
    }

    /** A gateway whose settings are exactly $options, nothing resolved through form defaults. */
    private static function gateway(array $options): EnvironmentOptionsSpecGateway
    {
        return new EnvironmentOptionsSpecGateway($options);
    }

    private static function assertResolveCase(array $case): void
    {
        self::setFlag($case['flag']);
        $stored = $case['stored'] ?? WC_Twoinc_Helper::ENVIRONMENT_MODE_DEFAULT;
        $gateway = self::gateway(['checkout_env' => $stored]);
        $description = $case['description'];

        TinyAssert::same($case['options'], WC_Twoinc_Helper::get_environment_mode_options($stored), $description . ' (options)');
        TinyAssert::same($case['effective'], WC_Twoinc_Helper::get_effective_environment_mode($gateway), $description . ' (effective)');
        TinyAssert::same($case['api_host'], $gateway->get_twoinc_checkout_host(), $description . ' (API host)');
        TinyAssert::same($case['checkout_host'], WC_Twoinc_Helper::get_environment_host('checkout', $gateway), $description . ' (checkout host)');
        TinyAssert::same($case['health_ok'], WC_Twoinc_Helper::is_environment_mode_healthy($stored), $description . ' (health)');
    }

    private static function assertSaveCase(array $case): void
    {
        self::setFlag($case['flag']);

        TinyAssert::same(
            $case['accepted'],
            WC_Twoinc_Helper::is_environment_mode_save_allowed($case['submitted'], $case['stored']),
            $case['description']
        );
    }

    /** WooCommerce's column of the migration table: legacy values keep the hosts they reached. */
    private static function testMigrationTable(): void
    {
        $cases = [
            ['production', 'production', 'production kept'],
            ['PROD', 'production', 'legacy option key to production'],
            ['Production', 'production', 'pre-2026-08-31 default to production'],
            ['prod', 'production', 'alias to production'],
            ['sandbox', 'sandbox', 'sandbox kept'],
            ['SANDBOX', 'sandbox', 'legacy option key to sandbox'],
            ['staging', 'staging', 'staging kept'],
            ['STAGING', 'staging', 'staging in any case kept'],
            ['', 'production', 'empty reached production before, so stays on production'],
            [null, 'sandbox', 'missing key read the sandbox field default, so stays on sandbox'],
            ['Demo', 'production', 'any other value reached production before, so stays on production'],
        ];

        foreach ($cases as [$stored, $expected, $description]) {
            TinyAssert::same($expected, WC_Twoinc_Helper::migrate_environment_mode($stored), $description);
        }

        // A shop released builds sent to staging by its hostname keeps staging.
        $sniffed = [
            ['production', 'staging', 'sniffed production keeps staging'],
            ['', 'staging', 'sniffed empty keeps staging'],
            ['Demo', 'staging', 'sniffed unknown keeps staging'],
            ['sandbox', 'sandbox', 'sniffing never touched sandbox'],
            [null, 'sandbox', 'a missing key read sandbox, never sniffed'],
        ];
        foreach ($sniffed as [$stored, $expected, $description]) {
            TinyAssert::same($expected, WC_Twoinc_Helper::migrate_environment_mode($stored, true), $description);
        }

        // The sniff as released builds ran it: a development hostname, and no developer API host.
        $hosts = [
            ['https://shop.merchant.example', null, false, 'a merchant domain was never sniffed'],
            ['http://localhost:8888', null, true, 'localhost was sniffed'],
            ['https://woocom.staging.two.inc', null, true, 'a two.inc dev subdomain was sniffed'],
            ['http://localhost:8888', 'http://portal.localhost/api', false, 'a developer API host took over instead'],
        ];
        foreach ($hosts as [$home, $devApiHost, $expected, $description]) {
            $GLOBALS['test_home_url'] = $home;
            putenv($devApiHost === null ? 'TWOINC_DEV_API_HOST' : 'TWOINC_DEV_API_HOST=' . $devApiHost);
            TinyAssert::same($expected, WC_Twoinc_Helper::was_sniffed_to_staging(), $description);
        }
        putenv('TWOINC_DEV_API_HOST');
        $GLOBALS['test_home_url'] = 'https://shop.merchant.example';
    }

    /** The dropdown and the field validator read the raw stored row. */
    private static function testFormOffersTheOptionsInOrder(): void
    {
        $cases = [
            [null, ['checkout_env' => 'sandbox'], ['production' => 'Production', 'sandbox' => 'Sandbox'], 'outside Two infra: production then sandbox'],
            ['1', ['checkout_env' => 'sandbox'], ['production' => 'Production', 'sandbox' => 'Sandbox', 'staging' => 'Staging'], 'on Two infra: staging last'],
            [null, ['checkout_env' => 'staging'], ['production' => 'Production', 'sandbox' => 'Sandbox', 'staging' => 'Staging'], 'a stored staging stays offered'],
            [null, null, ['production' => 'Production', 'sandbox' => 'Sandbox'], 'fresh install: staging refused without the flag'],
        ];

        foreach ($cases as [$flag, $row, $expected, $description]) {
            self::setFlag($flag);
            $gateway = self::gateway([]);
            if ($row === null) {
                unset($GLOBALS['__twoinc_test_options'][$gateway->get_option_key()]);
            } else {
                $GLOBALS['__twoinc_test_options'][$gateway->get_option_key()] = $row;
            }

            TinyAssert::same($expected, $gateway->get_checkout_env_options(), $description);
            $refused = false;
            try {
                $gateway->validate_checkout_env_field('checkout_env', 'staging');
            } catch (Exception $e) {
                $refused = $e->getMessage() === 'Select a valid environment.';
            }
            TinyAssert::same(!isset($expected['staging']), $refused, $description . ' (save)');
        }
    }

    /** migrate_checkout_env() writes the rewritten row back, and leaves a fresh install unwritten. */
    private static function testMigrationPersists(): void
    {
        $cases = [
            [['checkout_env' => 'PROD', 'title' => 'x'], ['checkout_env' => 'production', 'title' => 'x'], 'a legacy value is rewritten and the rest of the row kept'],
            [['title' => 'x'], ['title' => 'x', 'checkout_env' => 'sandbox'], 'a row without the key gets sandbox'],
            [['checkout_env' => 'staging'], ['checkout_env' => 'staging'], 'a canonical row is left alone'],
            [null, null, 'a fresh install writes nothing'],
        ];
        $GLOBALS['test_home_url'] = 'https://shop.merchant.example';

        foreach ($cases as [$row, $expected, $description]) {
            $gateway = self::gateway([]);
            $key = $gateway->get_option_key();
            if ($row === null) {
                unset($GLOBALS['__twoinc_test_options'][$key]);
            } else {
                $GLOBALS['__twoinc_test_options'][$key] = $row;
            }
            $gateway->settings = $row ?? ['checkout_env' => 'sandbox'];
            $migrate = new ReflectionMethod(WC_Twoinc::class, 'migrate_checkout_env');
            $migrate->setAccessible(true);
            $migrate->invoke($gateway);

            TinyAssert::same($expected, $GLOBALS['__twoinc_test_options'][$key] ?? null, $description);
        }
        // On a hostname released builds sent to staging, the row keeps staging.
        $GLOBALS['test_home_url'] = 'http://localhost:8888';
        $gateway = self::gateway([]);
        $GLOBALS['__twoinc_test_options'][$gateway->get_option_key()] = ['checkout_env' => 'PROD'];
        $gateway->settings = ['checkout_env' => 'PROD'];
        $migrate = new ReflectionMethod(WC_Twoinc::class, 'migrate_checkout_env');
        $migrate->setAccessible(true);
        $migrate->invoke($gateway);
        $GLOBALS['test_home_url'] = 'https://shop.merchant.example';
        TinyAssert::same(['checkout_env' => 'staging'], $GLOBALS['__twoinc_test_options'][$gateway->get_option_key()], 'a sniffed shop is written as staging');
    }

    /** A posted environment the save refuses never counts as the identity changing. */
    private static function testARefusedEnvironmentIsNoIdentityChange(): void
    {
        $cases = [
            [null, 'staging', false, 'staging refused without the flag: no identity change'],
            ['1', 'staging', true, 'staging accepted with the flag: identity changes'],
            [null, 'production', true, 'production accepted: identity changes'],
        ];

        foreach ($cases as [$flag, $posted, $expected, $description]) {
            self::setFlag($flag);
            $gateway = self::gateway(['api_key' => 'k', 'checkout_env' => 'sandbox']);
            $GLOBALS['__twoinc_test_options'][$gateway->get_option_key()] = ['checkout_env' => 'sandbox'];
            $before = new ReflectionProperty(WC_Twoinc::class, 'identity_before_save');
            $before->setAccessible(true);
            $before->setValue($gateway, ['api_key' => 'k', 'checkout_env' => 'sandbox']);
            $gateway->post_data = [
                $gateway->get_field_key('api_key') => 'k',
                $gateway->get_field_key('checkout_env') => $posted,
            ];
            $changing = new ReflectionMethod(WC_Twoinc::class, 'identity_changing_in_save');
            $changing->setAccessible(true);

            TinyAssert::same($expected, $changing->invoke($gateway), $description);
        }
    }
}

/**
 * A gateway whose settings are exactly the given options, nothing resolved
 * through form defaults, and whose submitted settings form is $post_data.
 */
final class EnvironmentOptionsSpecGateway extends WC_Twoinc
{
    public $post_data = [];

    private $options;

    public function __construct(array $options)
    {
        $this->id = WC_Twoinc_Brand::get('gateway_id');
        $this->options = $options;
    }

    public function get_option($key, $empty_value = null)
    {
        return $this->options[$key] ?? $empty_value ?? '';
    }

    public function get_post_data()
    {
        return $this->post_data;
    }
}
