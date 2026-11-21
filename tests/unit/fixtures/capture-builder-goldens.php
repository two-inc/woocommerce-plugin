<?php

// Usage: php capture-builder-goldens.php <checkout of the release to pin against>
// Prints the builders' output for every fixture in builderorders.php, as that checkout composes it.

declare(strict_types=1);

$root = rtrim($argv[1] ?? '', '/');
if ($root === '' || !is_file($root . '/tests/unit/bootstrap.php')) {
    fwrite(STDERR, "usage: php capture-builder-goldens.php <plugin checkout>\n");
    exit(1);
}
require $root . '/tests/unit/bootstrap.php';
require __DIR__ . '/builderorders.php';

$GLOBALS['__twoinc_test_options'] = ['woocommerce_shipping_tax_class' => ''];
$goldens = [];
foreach (twoinc_builder_fixture_orders() as $name => $build) {
    $goldens[$name] = array_diff_key(twoinc_builder_fixture_payloads($build()), ['intent' => true]);
}
echo json_encode($goldens, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), "\n";
