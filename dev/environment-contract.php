<?php

/**
 * Where this plugin declares the Environment setting (TWO-26613). Read only
 * by this repo's dev/environment-parity.php, which extracts the contract from
 * this repo's own code into dev/environment-contract.json; the other plugins
 * compare that JSON as data. After changing this file or the code it names,
 * run `php dev/environment-parity.php --write` and commit the JSON. Runs
 * inside that script and uses its helpers; declare no functions or classes.
 */

return [
    'platform' => 'woocommerce',
    'cases' => 'tests/unit/fixtures/environment-cases.json',
    'helpers' => [
        'file' => 'class/WC_Twoinc_Helper.php',
        'class' => 'WC_Twoinc_Helper',
        'consts' => ['modes' => 'ENVIRONMENT_MODES', 'default' => 'ENVIRONMENT_MODE_DEFAULT'],
        'methods' => [
            'is_internal_environments_enabled',
            'recognise_environment_mode',
            'normalise_environment_mode',
            'get_environment_mode_options',
            'migrate_environment_mode',
        ],
        'options' => 'get_environment_mode_options',
        'read' => 'normalise_environment_mode',
    ],
    // Released builds sent an empty or unknown value to production, and a
    // shop with a development hostname (and no developer API host) to
    // staging, so the migration keeps each shop where it was (TWO-26604).
    'migrate' => [
        'method' => 'migrate_environment_mode',
        'variants' => [
            'released host' => ['args' => [false], 'moves' => []],
            'development host' => ['args' => [true], 'moves' => ['production']],
        ],
    ],
    'declarations' => static function (array $p): array {
        $field = match1(
            "/'checkout_env'\\s*=>\\s*\\[(.*?)\\n\\s*\\],/s",
            $p['file']('class/WC_Twoinc.php'),
            'the checkout_env form field'
        )[1];
        $gettext = "__\\(\\s*" . STR . "\\s*,\\s*'twoinc-payment-gateway'\\s*\\)";
        return [
            'install_default' => [$p['value'](match1("/'default'\\s*=>\\s*([^,\\n]+?)\\s*,/", $field, 'its default')[1])],
            'labels' => labels($p['method']('class/WC_Twoinc.php', 'WC_Twoinc', 'get_checkout_env_options')),
            'field_label' => [unquote(match1("/'title'\\s*=>\\s*{$gettext}/", $field, 'its title')[1])],
            'description' => [unquote(match1("/'description'\\s*=>\\s*{$gettext}/", $field, 'its description')[1])],
        ];
    },
];
