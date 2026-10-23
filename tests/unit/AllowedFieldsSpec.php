<?php

declare(strict_types=1);

/**
 * The brand allowlist of admin settings fields, `allowed_fields` (TWO-26610):
 * a listed base field shows, an unlisted one is withheld from the form and the
 * save but keeps its stored value or declared default.
 */
final class AllowedFieldsSpec
{
    private const MERCHANT_FIELD = 'merchant_added_field';

    public static function runAll(): void
    {
        add_filter('wc_two_form_fields', [self::class, 'addMerchantField']);
        $saved = ['show_abt_link' => 'no', 'custom_headers' => [['name' => 'X-Shop', 'value' => '1', 'send_from_browser' => 'no']]];

        // [allowed_fields, stored settings row, probe, field key, expected, description]
        $cases = [
            [['title'], null, 'shown', 'title', true, 'a listed field is shown'],
            [['title'], null, 'shown', 'payment_subtitle', false, 'an unlisted field is withheld from the form'],
            [['title'], null, 'shown', 'section_checkout_fields', true, 'a section title with a listed field under it stays'],
            [['title'], null, 'shown', 'section_tax', false, 'a section title with no listed field under it is dropped'],
            [['title'], null, 'shown', self::MERCHANT_FIELD, true, 'a field added through wc_two_form_fields stays visible'],
            [['title'], null, 'option', 'enable_order_intent', 'yes', 'a withheld field still reads its declared default'],
            [['title'], null, 'option_memo', 'enable_order_intent', null, 'reading a withheld default does not memoise it into the settings'],
            [['title'], $saved, 'option', 'show_abt_link', 'no', 'a withheld field reads its saved value'],
            [['title'], $saved, 'saved', 'show_abt_link', 'no', 'a saved withheld value survives an admin save'],
            [['title'], $saved, 'saved', 'custom_headers', $saved['custom_headers'], 'saved withheld custom headers survive an admin save'],
            [['title'], $saved, 'sent_after_save', 'custom_headers', 1, 'withheld custom headers are still sent after an admin save'],
            [['title'], null, 'saved', 'enable_order_intent', null, 'an admin save does not write a withheld default'],
            [['title'], null, 'saved', 'title', 'Pay later', 'an admin save still writes a listed field'],
            [['title'], null, 'warnings', '', 0, 'a non-empty list logs no warning'],
            [[], null, 'shown', 'title', false, 'an empty list withholds every base field'],
            [[], null, 'shown', self::MERCHANT_FIELD, true, 'an empty list keeps a field added through wc_two_form_fields'],
            [[], null, 'warnings', '', 1, 'an empty list logs a warning'],
            [[], null, 'shown', 'enabled', true, 'the gateway on/off switch is always shown'],
            ['', null, 'shown', 'title', false, 'a value that is not a list withholds every base field'],
            ['', null, 'warnings', '', 1, 'a value that is not a list logs a warning'],
            [['enabled', 'no_such_field'], null, 'warnings', '', 1, 'a list naming no base field but the gateway switch logs a warning'],
            [null, null, 'shown', 'payment_subtitle', true, 'null shows every field'],
            [null, null, 'form', '', true, 'null leaves the form exactly as listing every base field does'],
            [null, null, 'warnings', '', 0, 'null logs no warning'],
        ];

        try {
            foreach ($cases as [$allowed, $stored, $probe, $key, $expected, $description]) {
                TinyAssert::same($expected, self::probe($allowed, $stored, $probe, $key), $description);
            }
        } finally {
            remove_filter('wc_two_form_fields', [self::class, 'addMerchantField']);
            WC_Twoinc_Brand::reset();
            $GLOBALS['__twoinc_test_options'] = [];
            $GLOBALS['__twoinc_test_logs'] = [];
        }
        print("AllowedFieldsSpec passed.\n");
    }

    public static function addMerchantField(array $fields): array
    {
        $fields[self::MERCHANT_FIELD] = ['title' => 'Merchant field', 'type' => 'text', 'default' => ''];
        return $fields;
    }

    /** @return mixed */
    private static function probe($allowed, ?array $stored, string $probe, string $key)
    {
        $gateway = self::gateway($allowed, $stored);
        switch ($probe) {
            case 'shown':
                return array_key_exists($key, $gateway->form_fields);
            case 'option':
                return $gateway->get_option($key);
            case 'option_memo':
                $gateway->get_option($key);
                return $gateway->settings[$key] ?? null;
            case 'saved':
                self::save($gateway);
                return $GLOBALS['__twoinc_test_options'][$gateway->get_option_key()][$key] ?? null;
            case 'sent_after_save':
                self::save($gateway);
                return count($gateway->get_custom_headers());
            case 'warnings':
                return count(array_filter($GLOBALS['__twoinc_test_logs'], static function ($log) {
                    return $log['level'] === 'warning' && strpos($log['message'], 'allowed_fields') !== false;
                }));
            case 'form':
                $every = self::gateway(array_keys($gateway->form_fields), $stored);
                return $every->form_fields === $gateway->form_fields;
        }
        throw new RuntimeException('Unknown probe ' . $probe);
    }

    /** An admin save that posts only the listed title field. */
    private static function save(AllowedFieldsSpecGateway $gateway): void
    {
        $_POST = [];
        $gateway->test_post_data = [$gateway->get_field_key('title') => 'Pay later'];
        $gateway->process_admin_options();
        $_POST = [];
    }

    /** A gateway constructed under a brand whose allowed_fields is $allowed. */
    private static function gateway($allowed, ?array $stored): AllowedFieldsSpecGateway
    {
        WC_Twoinc_Brand::reset();
        $config = WC_Twoinc_Brand::config();
        $config['allowed_fields'] = $allowed;
        $brand = new ReflectionProperty(WC_Twoinc_Brand::class, 'config');
        $brand->setAccessible(true);
        $brand->setValue(null, $config);
        $logged = new ReflectionProperty(WC_Twoinc::class, 'empty_allowlist_logged');
        $logged->setAccessible(true);
        $logged->setValue(null, false);
        $GLOBALS['__twoinc_test_logs'] = [];
        $GLOBALS['__twoinc_test_options'] = [];
        if ($stored !== null) {
            $GLOBALS['__twoinc_test_options']['woocommerce_' . $config['gateway_id'] . '_settings'] = $stored;
        }

        return new AllowedFieldsSpecGateway();
    }
}

/** The real gateway, with the submitted settings form injectable. */
final class AllowedFieldsSpecGateway extends WC_Twoinc
{
    public $test_post_data = [];
}
