<?php

/**
 * dev/environment-parity.php: the PrestaShop, WooCommerce and Magento plugins
 * offer the same Environment setting (TWO-26613; Plugin Build Guide §3.2 and
 * §14.6).
 *
 * This file is byte-identical in two-inc/prestashop-plugin,
 * two-inc/woocommerce-plugin and two-inc/magento-plugin, and works out which
 * one it is running in. It reads all three plugins' declarations from source:
 * its own from this checkout, the two siblings' with `gh api` (at the same
 * branch name when a sibling has one, else at `staging`, so a paired change
 * pushed under one branch name in all three repos is compared branch to
 * branch). It runs each plugin's own environment helpers, lifted out of its
 * source, and fails when:
 *   - the stored values, their order or the fresh-install default differ, or
 *     the install step does not write that default;
 *   - the dropdown offers different values (fresh, with
 *     TWO_INTERNAL_ENVIRONMENTS=1, or with staging already stored);
 *   - a stored value reads as a different environment;
 *   - the field label, description or option labels differ;
 *   - a plugin's legacy-value migration can return a value outside the stored
 *     values, rewrites a canonical value, or is not idempotent, or its upgrade
 *     step does not call it;
 *   - environment-cases.json or this file differs between the repos, or this
 *     repo's suite no longer reads the case table.
 * Each platform maps its own historical values (register D-1), so what each
 * migration does is printed, not compared.
 *
 * Usage: php dev/environment-parity.php   (run from anywhere; needs gh)
 *   ENVIRONMENT_PARITY_SIBLING_REF=<branch>  fetch each sibling at <branch>
 *                                            when it has one, else staging.
 *                                            CI passes the PR's head branch.
 *   ENVIRONMENT_PARITY_SIBLINGS_DIR=<dir>    read the siblings from local
 *                                            checkouts <dir>/<repo name>
 *                                            instead of fetching.
 */

declare(strict_types=1);

const SELF_PATH = 'dev/environment-parity.php';
const FLAG = 'TWO_INTERNAL_ENVIRONMENTS';
// The siblings add this file in separate PRs, so until this date (UTC) a
// sibling ref without it is a warning; from it, a missing copy fails. Delete
// this and its warning once all three copies are on staging.
const BOOTSTRAP_ENDS = '2026-11-07';

/** Legacy and odd stored values every read and migration is run over. */
const INPUTS = [null, '', '  ', 'production', 'sandbox', 'staging', 'prod', 'PROD', 'Production', ' production ',
    'SANDBOX', 'Sandbox', 'STAGING', 'development', 'dev', 'test', 'live', 'garbage', '0', '1'];

/** Dropdown states compared: [stored, flag]. */
const OPTION_STATES = [
    'fresh install' => [null, null],
    'fresh install, flag 1' => [null, '1'],
    'stored staging, no flag' => ['staging', null],
    'stored production, flag 1' => ['production', '1'],
];

const LABEL_PATTERN = "/'(production|sandbox|staging)'\\s*=>\\s*(?:\\\$this->l|__)\\(\\s*'((?:[^'\\\\]|\\\\.)*)'/";

/**
 * Where each plugin declares the setting. `methods` are the pure static
 * helpers lifted out of `class` and run here; `steps` are the upgrade calls
 * that must route through `migrate`.
 */
function platforms(): array
{
    return [
        'prestashop' => [
            'repo' => 'two-inc/prestashop-plugin',
            'marker' => 'twopayment.php',
            'cases' => 'tests/fixtures/environment-cases.json',
            'tests' => 'tests',
            'class' => ['twopayment.php', 'Twopayment'],
            'consts' => ['modes' => 'TWO_ENVIRONMENTS', 'default' => 'TWO_ENVIRONMENT_DEFAULT'],
            'methods' => ['isTwoInternalEnvironmentsEnabled', 'recogniseTwoEnvironment', 'normaliseTwoEnvironment',
                'getTwoEnvironmentOptions'],
            'options' => 'getTwoEnvironmentOptions',
            'read' => 'normaliseTwoEnvironment',
            // upgrade-2.7.8.php rewrites every stored row through the read path.
            'migrate' => ['normaliseTwoEnvironment', ['every shop' => [[], []]]],
            'steps' => [['upgrade/upgrade-2.7.8.php', null, null, 'Twopayment::normaliseTwoEnvironment(']],
            'files' => ['twopayment.php', 'upgrade/upgrade-2.7.8.php'],
            'declarations' => static function (callable $file, callable $method, callable $value): array {
                $src = $file('twopayment.php');
                $field = match1(
                    "/'label'\\s*=>\\s*\\\$this->l\\(\\s*" . STR . "\\s*\\),\\s*'name'\\s*=>\\s*'PS_TWO_ENVIRONMENT',"
                    . "\\s*'desc'\\s*=>\\s*\\\$this->l\\(\\s*" . STR . "\\s*\\)/",
                    $src,
                    'the PS_TWO_ENVIRONMENT HelperForm input'
                );
                $install = match1(
                    "/Configuration::updateValue\\(\\s*'PS_TWO_ENVIRONMENT'\\s*,\\s*([^)]+?)\\s*\\)/",
                    $method('twopayment.php', 'Twopayment', 'installTwoSettings'),
                    'the PS_TWO_ENVIRONMENT write in installTwoSettings()'
                );
                return [
                    'install_default' => [$value($install[1])],
                    'labels' => labels($method('twopayment.php', 'Twopayment', 'getTwoEnvironmentLabel')),
                    'field_label' => [unquote($field[1])],
                    'description' => [unquote($field[2])],
                ];
            },
        ],
        'woocommerce' => [
            'repo' => 'two-inc/woocommerce-plugin',
            'marker' => 'class/WC_Twoinc_Helper.php',
            'cases' => 'tests/unit/fixtures/environment-cases.json',
            'tests' => 'tests',
            'class' => ['class/WC_Twoinc_Helper.php', 'WC_Twoinc_Helper'],
            'consts' => ['modes' => 'ENVIRONMENT_MODES', 'default' => 'ENVIRONMENT_MODE_DEFAULT'],
            'methods' => ['is_internal_environments_enabled', 'recognise_environment_mode',
                'normalise_environment_mode', 'get_environment_mode_options', 'migrate_environment_mode'],
            'options' => 'get_environment_mode_options',
            'read' => 'normalise_environment_mode',
            // Register D-1: a shop that released builds sent to staging by its
            // development hostname migrates its production to staging.
            'migrate' => ['migrate_environment_mode', [
                'released host' => [[false], []],
                'development host' => [[true], ['production']],
            ]],
            'steps' => [
                ['class/WC_Twoinc.php', 'WC_Twoinc', '__construct', '$this->migrate_checkout_env()'],
                ['class/WC_Twoinc.php', 'WC_Twoinc', 'migrate_checkout_env', 'WC_Twoinc_Helper::migrate_environment_mode('],
            ],
            'files' => ['class/WC_Twoinc_Helper.php', 'class/WC_Twoinc.php'],
            'declarations' => static function (callable $file, callable $method, callable $value): array {
                $field = match1(
                    "/'checkout_env'\\s*=>\\s*\\[(.*?)\\n\\s*\\],/s",
                    $file('class/WC_Twoinc.php'),
                    'the checkout_env form field'
                )[1];
                $gettext = "__\\(\\s*" . STR . "\\s*,\\s*'twoinc-payment-gateway'\\s*\\)";
                return [
                    'install_default' => [$value(match1("/'default'\\s*=>\\s*([^,\\n]+?)\\s*,/", $field, 'the field default')[1])],
                    'labels' => labels($method('class/WC_Twoinc.php', 'WC_Twoinc', 'get_checkout_env_options')),
                    'field_label' => [unquote(match1("/'title'\\s*=>\\s*{$gettext}/", $field, 'the field title')[1])],
                    'description' => [unquote(match1("/'description'\\s*=>\\s*{$gettext}/", $field, 'the field description')[1])],
                ];
            },
        ],
        'magento' => [
            'repo' => 'two-inc/magento-plugin',
            'marker' => 'Model/Config/EnvironmentMode.php',
            'cases' => 'Test/Unit/Model/Config/_files/environment-cases.json',
            'tests' => 'Test',
            'class' => ['Model/Config/EnvironmentMode.php', 'EnvironmentMode'],
            'consts' => ['modes' => 'MODES', 'default' => 'DEFAULT_MODE'],
            'methods' => ['isInternalEnvironmentsEnabled', 'recognise', 'normalise', 'options', 'migrate'],
            'options' => 'options',
            'read' => 'normalise',
            // The data patch deletes empty rows, which then read the
            // config.xml default; migrate() gives the same for them.
            'migrate' => ['migrate', ['every scope' => [[], []]]],
            'steps' => [['Setup/Patch/Data/NormaliseEnvironmentMode.php', 'NormaliseEnvironmentMode', 'apply',
                'EnvironmentMode::migrate(']],
            'files' => ['Model/Config/EnvironmentMode.php', 'Model/Config/Source/Mode.php', 'etc/config.xml',
                'etc/adminhtml/system.xml', 'etc/adminhtml/brand_form_template.xml',
                'Setup/Patch/Data/NormaliseEnvironmentMode.php'],
            'declarations' => static function (callable $file, callable $method, callable $value): array {
                $config = xml($file('etc/config.xml'), 'etc/config.xml');
                $out = [
                    'install_default' => [(string) (one(
                        $config,
                        '/config/default/payment/two_payment/mode',
                        'etc/config.xml payment/two_payment/mode'
                    ))],
                    'labels' => labels($method('Model/Config/Source/Mode.php', 'Mode', 'toOptionArray')),
                    'field_label' => [],
                    'description' => [],
                ];
                // Both admin forms declare the field: the base section and the
                // template every brand's section is built from.
                foreach (['etc/adminhtml/system.xml', 'etc/adminhtml/brand_form_template.xml'] as $path) {
                    $field = one(xml($file($path), $path), '//field[@id="mode"]', "{$path} field mode");
                    $out['field_label'][] = (string) $field->label;
                    $out['description'][] = (string) $field->comment;
                }
                return $out;
            },
        ],
    ];
}

const STR = "'((?:[^'\\\\]|\\\\.)*)'";

function fail(string $message): void
{
    fwrite(STDOUT, "::error::environment-parity: {$message}\n");
    $GLOBALS['failed'] = true;
}

function stop(string $message): never
{
    fail($message);
    exit(1);
}

function match1(string $pattern, string $subject, string $what): array
{
    $count = preg_match_all($pattern, $subject, $m, PREG_SET_ORDER);
    if ($count !== 1) {
        throw new RuntimeException("found {$what} {$count} times, want once");
    }
    return $m[0];
}

function unquote(string $single): string
{
    return strtr($single, ["\\'" => "'", '\\\\' => '\\']);
}

function labels(string $code): array
{
    preg_match_all(LABEL_PATTERN, $code, $m, PREG_SET_ORDER);
    $labels = [];
    foreach ($m as [, $mode, $label]) {
        $labels[$mode] = unquote($label);
    }
    return $labels;
}

function xml(string $src, string $path): SimpleXMLElement
{
    $xml = simplexml_load_string($src);
    if ($xml === false) {
        throw new RuntimeException("{$path} is not well-formed XML");
    }
    return $xml;
}

function one(SimpleXMLElement $xml, string $xpath, string $what): SimpleXMLElement
{
    $nodes = $xml->xpath($xpath) ?: [];
    if (count($nodes) !== 1) {
        throw new RuntimeException("found {$what} " . count($nodes) . ' times, want once');
    }
    return $nodes[0];
}

/**
 * The source of a class's members, by name: constants as `const X = ...;`,
 * methods as written. Reads tokens, so braces in strings and comments are
 * not miscounted.
 */
function members(string $src, string $class): array
{
    $tokens = token_get_all($src);
    $n = count($tokens);
    $text = static fn ($t) => is_array($t) ? $t[1] : $t;
    $next = static function (int $i) use ($tokens, $n): int {
        for ($i++; $i < $n && is_array($tokens[$i]) && in_array($tokens[$i][0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true); $i++) {
        }
        return $i;
    };
    for ($i = 0; $i < $n; $i++) {
        if (!is_array($tokens[$i]) || $tokens[$i][0] !== T_CLASS) {
            continue;
        }
        $j = $next($i);
        if (is_array($tokens[$j] ?? null) && $tokens[$j][0] === T_STRING && $tokens[$j][1] === $class) {
            break;
        }
    }
    if ($i >= $n) {
        throw new RuntimeException("no class {$class}");
    }
    while ($i < $n && $tokens[$i] !== '{') {
        $i++;
    }
    $consts = $methods = [];
    $depth = 0;
    $capture = null;
    for (; $i < $n; $i++) {
        $t = $tokens[$i];
        $opens = $t === '{' || (is_array($t) && in_array($t[0], [T_CURLY_OPEN, T_DOLLAR_OPEN_CURLY_BRACES], true));
        if ($depth === 1 && $capture === null && is_array($t) && in_array($t[0], [T_CONST, T_FUNCTION], true)) {
            $name = $tokens[$next($i)][1];
            $capture = ['kind' => $t[0], 'name' => $name, 'code' => ''];
        }
        if ($capture !== null) {
            $capture['code'] .= $text($t);
        }
        if ($opens) {
            $depth++;
        } elseif ($t === '}') {
            $depth--;
            if ($depth === 0) {
                break;
            }
            if ($depth === 1 && $capture !== null && $capture['kind'] === T_FUNCTION) {
                $methods[$capture['name']] = $capture['code'];
                $capture = null;
            }
        } elseif ($t === ';' && $depth === 1 && $capture !== null) {
            if ($capture['kind'] === T_CONST) {
                $consts[$capture['name']] = $capture['code'];
            }
            $capture = null; // an abstract or interface method has no body
        }
    }
    return ['consts' => $consts, 'methods' => $methods];
}

/** Read one file of a plugin: this checkout, a local sibling, or gh api. */
final class Source
{
    /** @var array<string, string> */
    private $cache = [];

    public function __construct(public string $label, private ?string $dir, private string $repo, private string $ref)
    {
    }

    public function has(string $path): bool
    {
        return $this->fetch($path) !== null;
    }

    public function get(string $path): string
    {
        $src = $this->fetch($path);
        if ($src === null) {
            throw new RuntimeException("{$this->label} has no {$path}");
        }
        return $src;
    }

    private function fetch(string $path): ?string
    {
        if (array_key_exists($path, $this->cache)) {
            return $this->cache[$path];
        }
        if ($this->dir !== null) {
            $file = "{$this->dir}/{$path}";
            return $this->cache[$path] = is_file($file) ? (string) file_get_contents($file) : null;
        }
        [$code, $out] = gh(['-H', 'Accept: application/vnd.github.raw',
            "repos/{$this->repo}/contents/{$path}?ref=" . rawurlencode($this->ref)]);
        if ($code === 404) {
            return $this->cache[$path] = null;
        }
        return $this->cache[$path] = $out;
    }
}

/** Run `gh api` with retries. Returns [0, stdout] or [404, ''], else stops. */
function gh(array $args): array
{
    for ($attempt = 1; $attempt <= 3; $attempt++) {
        $proc = proc_open(array_merge(['gh', 'api'], $args), [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        if (!is_resource($proc)) {
            stop('could not run gh.');
        }
        $out = stream_get_contents($pipes[1]);
        $err = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        if (proc_close($proc) === 0) {
            return [0, (string) $out];
        }
        if (strpos((string) $err, 'HTTP 404') !== false) {
            return [404, ''];
        }
        sleep($attempt * 2);
    }
    stop('gh api ' . implode(' ', $args) . ' failed: ' . trim((string) $err));
}

function setFlag(?string $flag): void
{
    putenv($flag === null ? FLAG : FLAG . '=' . $flag);
}

/** One plugin's contract, from its source. */
function contract(string $platform, array $p, Source $source): array
{
    [$classFile, $className] = $p['class'];
    $parsed = [];
    $memberOf = static function (string $path, string $class) use ($source, &$parsed): array {
        return $parsed["{$path}#{$class}"] ??= members($source->get($path), $class);
    };
    $method = static function (string $path, string $class, string $name) use ($memberOf): string {
        $code = $memberOf($path, $class)['methods'][$name] ?? null;
        if ($code === null) {
            throw new RuntimeException("no method {$class}::{$name}() in {$path}");
        }
        return $code;
    };

    // Lift the helpers into a class of their own and run them.
    $members = $memberOf($classFile, $className);
    $code = [];
    foreach ($p['consts'] as $const) {
        $code[] = $members['consts'][$const] ?? throw new RuntimeException("no constant {$className}::{$const}");
    }
    foreach ($p['methods'] as $name) {
        $code[] = 'public static ' . $method($classFile, $className, $name);
    }
    $lifted = 'EnvironmentParity_' . $platform;
    eval("final class {$lifted} {\n" . implode("\n", $code) . "\n}");
    $const = static fn (string $key) => constant("{$lifted}::{$p['consts'][$key]}");
    $value = static function (string $expr) use ($p, $lifted, $className): string {
        if (preg_match('/^' . STR . '$/', $expr, $m)) {
            return unquote($m[1]);
        }
        if (
            preg_match('/^(?:self|static|\\\\?' . preg_quote($className, '/') . ')::(\w+)$/', $expr, $m)
            && in_array($m[1], $p['consts'], true)
        ) {
            return constant("{$lifted}::{$m[1]}");
        }
        throw new RuntimeException("cannot resolve {$expr}");
    };

    $c = ['modes' => $const('modes'), 'default' => $const('default')];
    foreach (OPTION_STATES as $state => [$stored, $flag]) {
        setFlag($flag);
        $c['options'][$state] = [$lifted, $p['options']]($stored);
    }
    setFlag(null);
    foreach (INPUTS as $input) {
        $c['reads'][json_encode($input)] = [$lifted, $p['read']]($input);
    }
    // A setting declared in more than one file must read the same in each.
    foreach (($p['declarations'])([$source, 'get'], $method, $value) as $key => $declared) {
        if ($key !== 'labels' && count(array_unique($declared)) !== 1) {
            throw new RuntimeException("declares {$key} differently in its own files: " . json_encode($declared));
        }
        $c[$key] = $key === 'labels' ? $declared : $declared[0];
    }

    [$migrate, $variants] = $p['migrate'];
    $migration = [];
    foreach ($variants as $variant => [$args, $moves]) {
        foreach (INPUTS as $input) {
            $to = [$lifted, $migrate]($input, ...$args);
            $migration[$variant][json_encode($input)] = $to;
            if (!in_array($to, $c['modes'], true)) {
                fail("{$platform} migration ({$variant}) rewrites " . json_encode($input) . ' to ' . json_encode($to)
                    . ', which is not a stored value.');
            } elseif ([$lifted, $migrate]($to, ...$args) !== $to) {
                fail("{$platform} migration ({$variant}) is not idempotent on " . json_encode($input) . '.');
            }
            if (in_array($input, $c['modes'], true) && $to !== $input && !in_array($input, $moves, true)) {
                fail("{$platform} migration ({$variant}) rewrites the canonical {$input} to {$to}.");
            }
        }
    }
    foreach ($p['steps'] as [$path, $class, $name, $needle]) {
        $where = $class === null ? $source->get($path) : $method($path, $class, $name);
        if (strpos($where, $needle) === false) {
            fail("{$platform}: {$path}" . ($name ? " {$name}()" : '') . " no longer calls {$needle}...); the upgrade must migrate through it.");
        }
    }
    return [$c, $migration];
}

// ---------------------------------------------------------------------------

$root = dirname(__DIR__);
$platforms = platforms();
$self = null;
foreach ($platforms as $name => $p) {
    if (is_file("{$root}/{$p['marker']}")) {
        $self = $name;
    }
}
if ($self === null) {
    stop('cannot tell which plugin this is: none of ' . implode(', ', array_column($platforms, 'marker')) . ' here.');
}
setFlag(null);

$siblingsDir = getenv('ENVIRONMENT_PARITY_SIBLINGS_DIR') ?: null;
$requested = getenv('ENVIRONMENT_PARITY_SIBLING_REF') ?: 'staging';
$sources = [];
foreach ($platforms as $name => $p) {
    $repoName = basename($p['repo']);
    if ($name === $self) {
        $sources[$name] = new Source("{$repoName} (this checkout)", $root, $p['repo'], '');
    } elseif ($siblingsDir !== null) {
        $sources[$name] = new Source("{$siblingsDir}/{$repoName}", "{$siblingsDir}/{$repoName}", $p['repo'], '');
    } else {
        // A branch the sibling lacks is the normal case for a change on one
        // side only, so it falls back to staging.
        $ref = 'staging';
        if ($requested !== 'staging') {
            [$code] = gh(['repos/' . $p['repo'] . '/branches/' . $requested, '--jq', '.name']);
            $ref = $code === 0 ? $requested : 'staging';
        }
        $sources[$name] = new Source("{$p['repo']}@{$ref}", null, $p['repo'], $ref);
    }
}
echo 'environment-parity: ' . $self . ' compared with ' . implode(' and ', array_map(
    static fn ($s) => $s->label,
    array_values(array_diff_key($sources, [$self => true]))
)) . ".\n";

$contracts = $migrations = [];
foreach ($platforms as $name => $p) {
    try {
        [$contracts[$name], $migrations[$name]] = contract($name, $p, $sources[$name]);
        $contracts[$name]['case_table_sha256'] = hash('sha256', $sources[$name]->get($p['cases']));
    } catch (Throwable $e) {
        fail("{$sources[$name]->label}: " . $e->getMessage() . '.');
    }
}

// Every key the same on all three. A plugin that could not be read is
// already a failure, so compare what was read.
$keys = array_unique(array_merge(...array_map('array_keys', array_values($contracts) ?: [[]])));
function compare(string $what, array $values): void
{
    $seen = array_map(static fn ($v) => json_encode($v, JSON_UNESCAPED_SLASHES), $values);
    if (count(array_unique($seen)) === 1) {
        return;
    }
    // For a map (dropdown states, reads), name only the entries that differ.
    $first = reset($values);
    if (is_array($first) && array_keys($first) !== range(0, count($first) - 1)) {
        $subkeys = array_unique(array_merge(...array_map(static fn ($v) => array_keys((array) $v), array_values($values))));
        foreach ($subkeys as $sub) {
            compare("{$what} {$sub}", array_map(static fn ($v) => is_array($v) ? ($v[$sub] ?? null) : null, $values));
        }
        return;
    }
    fail("{$what} differs: " . implode('; ', array_map(static fn ($k, $v) => "{$k} {$v}", array_keys($seen), $seen)) . '.');
}

foreach ($keys as $key) {
    compare($key, array_map(static fn ($c) => $c[$key] ?? null, $contracts));
}
foreach ($contracts as $name => $c) {
    if ($c['install_default'] !== $c['default']) {
        fail("{$name} installs {$c['install_default']} but declares the default {$c['default']}.");
    }
    if (array_keys($c['labels']) !== $c['modes']) {
        fail("{$name} labels " . json_encode(array_keys($c['labels'])) . ', not every stored value in order.');
    }
}

// This repo's suite must still run the case table.
$p = $platforms[$self];
$readers = [];
$it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator("{$root}/{$p['tests']}", FilesystemIterator::SKIP_DOTS));
foreach ($it as $file) {
    if (substr($file->getFilename(), -4) === '.php' && strpos((string) file_get_contents($file->getPathname()), 'environment-cases.json') !== false) {
        $readers[] = $file->getFilename();
    }
}
if (!$readers) {
    fail("no PHP file under {$p['tests']}/ reads environment-cases.json; the suite must run the shared case table.");
}

// This file must be the same in all three.
$mine = (string) file_get_contents(__FILE__);
foreach ($sources as $name => $source) {
    if ($name === $self) {
        continue;
    }
    if (!$source->has(SELF_PATH)) {
        if (gmdate('Y-m-d') < BOOTSTRAP_ENDS) {
            echo "::warning::environment-parity: {$source->label} has no " . SELF_PATH . ' yet; until ' . BOOTSTRAP_ENDS . " that is a warning.\n";
        } else {
            fail("{$source->label} has no " . SELF_PATH . '; all three plugins must carry the same copy.');
        }
    } elseif ($source->get(SELF_PATH) !== $mine) {
        fail(SELF_PATH . " differs from the copy at {$source->label}; the three must be byte-identical.");
    }
}

if (!empty($GLOBALS['failed'])) {
    exit(1);
}

$c = $contracts[$self];
printf(
    "environment-parity OK: stored values %s, default %s, labels %s, case table sha256 %s.\n",
    implode(', ', $c['modes']),
    $c['default'],
    implode(', ', $c['labels']),
    $c['case_table_sha256']
);
foreach ($c['options'] as $state => $options) {
    printf("  dropdown, %s: %s\n", $state, implode(', ', $options));
}
echo "Legacy-value migration per platform (register D-1, printed not compared):\n";
foreach ($migrations as $name => $variants) {
    foreach ($variants as $variant => $map) {
        $moved = [];
        foreach ($map as $from => $to) {
            $moved[] = "{$from}->{$to}";
        }
        printf("  %s, %s: %s\n", $name, $variant, implode(' ', $moved));
    }
}
