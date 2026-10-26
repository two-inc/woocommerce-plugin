<?php

/**
 * dev/environment-parity.php: the PrestaShop, WooCommerce, Magento and
 * OpenCart plugins offer the same Environment setting (TWO-26613, TWO-26604,
 * TWO-26671).
 *
 * This file is byte-identical in two-inc/prestashop-plugin,
 * two-inc/woocommerce-plugin, two-inc/magento-plugin and
 * two-inc/opencart-plugin. Each repo also has:
 *   - dev/environment-contract.php, its own record of where it declares the
 *     setting, read only in that repo;
 *   - dev/environment-contract.json, the contract this file extracts from
 *     that repo's own code, committed.
 *
 * A run extracts this repo's contract from its own code and fails if the
 * committed snapshot differs. It then fetches each sibling's snapshot with
 * `gh api` and compares it as data: no sibling code is ever run. It fails
 * when:
 *   - the stored values, their order, the fresh-install default, the
 *     dropdown (fresh, with TWO_INTERNAL_ENVIRONMENTS=1, or with a value
 *     stored), how each of INPUTS reads, the field label, description or
 *     option labels differ, or a plugin installs a value other than its
 *     declared default;
 *   - a plugin's legacy-value migration returns a value outside the stored
 *     values, is not idempotent, or rewrites a canonical value its contract
 *     does not register as a move;
 *   - environment-cases.json or this file differs between the repos.
 * Each platform maps legacy values its own way (the platforms stored
 * different values historically), so the mappings are printed, not compared.
 *
 * Which sibling ref is read: a PR reads a sibling at the PR's branch name
 * when the sibling has that branch, and then a missing snapshot fails.
 * Otherwise (and for a push, a scheduled run or a sibling without the
 * branch) it reads the sibling at the base branch: staging, or main for a
 * push to main; a sibling with no snapshot there yet is a warning, and a
 * snapshot that differs fails.
 *
 * Usage:
 *   php dev/environment-parity.php           check (needs gh)
 *   php dev/environment-parity.php --write   regenerate this repo's snapshot
 *   ENVIRONMENT_PARITY_SIBLING_REF=<branch>  the branch to look for in each
 *                                            sibling (CI: the PR's head
 *                                            branch, or the pushed branch)
 *   ENVIRONMENT_PARITY_SIBLINGS_DIR=<dir>    read the siblings' snapshots from
 *                                            local checkouts <dir>/<repo>
 */

declare(strict_types=1);

const REPOS = [
    'prestashop' => 'two-inc/prestashop-plugin',
    'woocommerce' => 'two-inc/woocommerce-plugin',
    'magento' => 'two-inc/magento-plugin',
    'opencart' => 'two-inc/opencart-plugin',
];
const SELF_PATH = 'dev/environment-parity.php';
const SPEC_PATH = 'dev/environment-contract.php';
const SNAPSHOT_PATH = 'dev/environment-contract.json';
const WRITE_COMMAND = 'php dev/environment-parity.php --write';
const FLAG = 'TWO_INTERNAL_ENVIRONMENTS';

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

/** A single-quoted PHP string literal; group 1 is its body. */
const STR = "'((?:[^'\\\\]|\\\\.)*)'";

/** An option label: 'mode' => a translation call on a single-quoted literal. */
const LABEL_PATTERN = "/'(production|sandbox|staging)'\\s*=>\\s*(?:\\\$this->l|__)\\(\\s*" . STR . '/';

/**
 * members() cases: [source with %s for the class name, constants => value,
 * static method => [args, result]].
 */
const MEMBER_CASES = [
    'untyped constant' => ["<?php class %s { const X = ['a', 'b']; }", ['X' => ['a', 'b']], []],
    'typed array constant' => ["<?php class %s { public const array X = ['a']; }", ['X' => ['a']], []],
    'typed string constant' => ["<?php class %s { final public const string X = 'v'; }", ['X' => 'v'], []],
    'braces in strings' => [
        "<?php class %s { public static function f(\$v) { return \"{\$v}}\" . '{'; } const Y = 1; }",
        ['Y' => 1],
        ['f' => [['x'], 'x}{']],
    ],
    'class keyword before the class' => ["<?php \$n = stdClass::class; class %s { const X = 2; }", ['X' => 2], []],
    'class inside a guard' => [
        "<?php if (!class_exists('%1\$s')) { class %1\$s { const X = 3;\n"
            . " public static function g() { return self::X; } } }",
        ['X' => 3],
        ['g' => [[], 3]],
    ],
];

function fail(string $message): void
{
    fwrite(STDOUT, "::error::environment-parity: {$message}\n");
    $GLOBALS['failed'] = true;
}

function warn(string $message): void
{
    fwrite(STDOUT, "::warning::environment-parity: {$message}\n");
}

function stop(string $message): never
{
    fail($message);
    exit(1);
}

/** The one match of $pattern in $subject; throws on none or several. */
function match1(string $pattern, string $subject, string $what): array
{
    $count = preg_match_all($pattern, $subject, $m, PREG_SET_ORDER);
    if ($count !== 1) {
        throw new RuntimeException("found {$what} {$count} times, want once");
    }
    return $m[0];
}

/** The value of a single-quoted literal's body. */
function unquote(string $single): string
{
    return strtr($single, ["\\'" => "'", '\\\\' => '\\']);
}

/**
 * The strings of an OpenCart language file (`$_['key'] = 'value';`), by key.
 * Read as text, never included.
 */
function languageStrings(string $src): array
{
    preg_match_all('/^\$_\[\s*' . STR . '\s*\]\s*=\s*' . STR . '\s*;/m', $src, $m, PREG_SET_ORDER);
    $strings = [];
    foreach ($m as [, $key, $value]) {
        $strings[unquote($key)] = unquote($value);
    }
    return $strings;
}

/** Option labels in a piece of source, in the order written. */
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

/** The one node at $xpath; throws on none or several. */
function one(SimpleXMLElement $xml, string $xpath, string $what): SimpleXMLElement
{
    $nodes = $xml->xpath($xpath) ?: [];
    if (count($nodes) !== 1) {
        throw new RuntimeException("found {$what} " . count($nodes) . ' times, want once');
    }
    return $nodes[0];
}

/** A stored value as a readable key: null, or the value in single quotes. */
function keyOf(?string $value): string
{
    return $value === null ? 'null' : "'{$value}'";
}

/**
 * The source of a class's members, by name: constants as `const X = ...;`
 * (typed or not), methods as written. Reads tokens, so braces in strings
 * and comments are not miscounted.
 */
function members(string $src, string $class): array
{
    $tokens = token_get_all($src);
    $n = count($tokens);
    $skip = [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT];
    $next = static function (int $i) use ($tokens, $n, $skip): int {
        do {
            $i++;
        } while ($i < $n && is_array($tokens[$i]) && in_array($tokens[$i][0], $skip, true));
        return $i;
    };
    $isName = static fn ($t) => is_array($t) && preg_match('/^[A-Za-z_]\w*$/', $t[1]) === 1;
    for ($i = 0; $i < $n; $i++) {
        if (is_array($tokens[$i]) && $tokens[$i][0] === T_CLASS) {
            $j = $next($i);
            if (is_array($tokens[$j] ?? null) && $tokens[$j][0] === T_STRING && $tokens[$j][1] === $class) {
                break;
            }
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
            // A constant's name is the last name before `=`, after any type;
            // a method's is the first name after `function`.
            $capture = ['kind' => $t[0], 'name' => null, 'last' => null, 'code' => ''];
        } elseif ($capture !== null && $capture['name'] === null && $depth === 1) {
            if ($capture['kind'] === T_FUNCTION && $isName($t)) {
                $capture['name'] = $t[1];
            } elseif ($capture['kind'] === T_CONST && $isName($t)) {
                $capture['last'] = $t[1];
            } elseif ($capture['kind'] === T_CONST && $t === '=') {
                $capture['name'] = $capture['last'];
            }
        }
        if ($capture !== null) {
            $capture['code'] .= is_array($t) ? $t[1] : $t;
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
            if ($capture['kind'] === T_CONST && $capture['name'] !== null) {
                $consts[$capture['name']] = $capture['code'];
            }
            $capture = null; // an abstract method has no body
        }
    }
    return ['consts' => $consts, 'methods' => $methods];
}

/** Lift named constants and static methods into a class of their own. */
function lift(string $src, string $class, array $consts, array $methods, string $as): void
{
    $members = members($src, $class);
    $code = [];
    foreach ($consts as $const) {
        $code[] = $members['consts'][$const] ?? throw new RuntimeException("no constant {$class}::{$const}");
    }
    foreach ($methods as $name) {
        $code[] = 'public static ' . ($members['methods'][$name]
            ?? throw new RuntimeException("no method {$class}::{$name}()"));
    }
    eval("final class {$as} {\n" . implode("\n", $code) . "\n}");
}

/** Run MEMBER_CASES; a parser that misreads them would misread a plugin. */
function selfTest(): void
{
    foreach (MEMBER_CASES as $case => [$template, $consts, $calls]) {
        $class = 'EnvironmentParityCase' . md5($case);
        $lifted = $class . 'Lifted';
        try {
            lift(sprintf($template, $class), $class, array_keys($consts), array_keys($calls), $lifted);
            foreach ($consts as $name => $want) {
                if (constant("{$lifted}::{$name}") !== $want) {
                    throw new RuntimeException("constant {$name} reads " . json_encode(constant("{$lifted}::{$name}")));
                }
            }
            foreach ($calls as $name => [$args, $want]) {
                if ([$lifted, $name](...$args) !== $want) {
                    throw new RuntimeException("{$name}() returns " . json_encode([$lifted, $name](...$args)));
                }
            }
        } catch (Throwable $e) {
            fail("members() misreads the case '{$case}': " . $e->getMessage() . '; fix members() in ' . SELF_PATH . '.');
        }
    }
}

/** Run `gh api` with retries. Returns [0, stdout] or [404, ''], else stops. */
function gh(array $args): array
{
    $err = '';
    for ($attempt = 1; $attempt <= 3; $attempt++) {
        $proc = proc_open(array_merge(['gh', 'api'], $args), [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        if (!is_resource($proc)) {
            stop('could not run gh.');
        }
        $out = (string) stream_get_contents($pipes[1]);
        $err = (string) stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        if (proc_close($proc) === 0) {
            return [0, $out];
        }
        if (strpos($err, 'HTTP 404') !== false) {
            return [404, ''];
        }
        sleep($attempt * 2);
    }
    stop('gh api ' . implode(' ', $args) . ' failed: ' . trim($err));
}

function setFlag(?string $flag): void
{
    putenv($flag === null ? FLAG : FLAG . '=' . $flag);
}

/**
 * This repo's snapshot, extracted from its own code as dev/environment-
 * contract.php describes. Only this repo's code is ever run here.
 */
function extractSnapshot(string $root, array $spec): array
{
    $file = static function (string $path) use ($root): string {
        $src = is_file("{$root}/{$path}") ? file_get_contents("{$root}/{$path}") : false;
        return $src === false ? throw new RuntimeException("no {$path}") : $src;
    };
    $h = $spec['helpers'];
    $lifted = 'EnvironmentParity_' . $spec['platform'];
    try {
        lift($file($h['file']), $h['class'], array_values($h['consts']), $h['methods'], $lifted);
    } catch (RuntimeException $e) {
        throw new RuntimeException($e->getMessage() . " in {$h['file']}; update 'helpers' in " . SPEC_PATH);
    }
    $call = static fn (string $name, ...$args) => [$lifted, $name](...$args);
    $p = [
        'file' => $file,
        'method' => static fn (string $path, string $class, string $name): string => members($file($path), $class)
            ['methods'][$name] ?? throw new RuntimeException(
                "no method {$class}::{$name}() in {$path}; update 'declarations' in " . SPEC_PATH
            ),
        'value' => static function (string $expr) use ($lifted): string {
            if (preg_match('/^' . STR . '$/', $expr, $m)) {
                return unquote($m[1]);
            }
            if (preg_match('/^(?:self|static|\\\\?\w+)::(\w+)$/', $expr, $m) && defined("{$lifted}::{$m[1]}")) {
                return (string) constant("{$lifted}::{$m[1]}");
            }
            throw new RuntimeException("cannot resolve {$expr}; add its constant to 'helpers.consts' in " . SPEC_PATH);
        },
    ];

    $c = [
        'modes' => constant("{$lifted}::{$h['consts']['modes']}"),
        'default' => constant("{$lifted}::{$h['consts']['default']}"),
    ];
    foreach (OPTION_STATES as $state => [$stored, $flag]) {
        setFlag($flag);
        // A plugin whose rule takes the flag as an argument names the method
        // that reads its raw value ('flag'); the others read the process.
        $c['options'][$state] = isset($h['flag'])
            ? $call($h['options'], $stored, $call($h['flag'], $flag))
            : $call($h['options'], $stored);
    }
    setFlag(null);
    foreach (INPUTS as $input) {
        $c['reads'][keyOf($input)] = $call($h['read'], $input);
    }
    // A setting declared in more than one file must read the same in each.
    foreach (($spec['declarations'])($p) as $key => $declared) {
        if ($key !== 'labels' && count(array_unique($declared)) !== 1) {
            throw new RuntimeException("declares {$key} differently in its own files: " . json_encode($declared));
        }
        $c[$key] = $key === 'labels' ? $declared : $declared[0];
    }
    $c['case_table_sha256'] = hash('sha256', $file($spec['cases']));

    $migration = [];
    foreach ($spec['migrate']['variants'] as $variant => ['args' => $args, 'moves' => $moves]) {
        $map = [];
        foreach (INPUTS as $input) {
            $map[keyOf($input)] = $call($spec['migrate']['method'], $input, ...$args);
        }
        $migration[$variant] = ['moves' => $moves, 'map' => $map];
    }
    return [
        '_comment' => 'Generated by `' . WRITE_COMMAND . '` (TWO-26613). Do not edit by hand.',
        'platform' => $spec['platform'],
        'inputs' => array_map('keyOf', INPUTS),
        'contract' => $c,
        'migration' => $migration,
    ];
}

function encode(array $snapshot): string
{
    return json_encode($snapshot, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n";
}

/** Shape problems in a snapshot read as data, or null when it is usable. */
function shapeError(mixed $snapshot, string $platform): ?string
{
    if (!is_array($snapshot) || ($snapshot['platform'] ?? null) !== $platform) {
        return "is not a {$platform} snapshot";
    }
    if (($snapshot['inputs'] ?? null) !== array_map('keyOf', INPUTS)) {
        return 'was generated over a different INPUTS list';
    }
    foreach (['modes', 'default', 'install_default', 'options', 'reads', 'labels'] as $key) {
        if (!array_key_exists($key, $snapshot['contract'] ?? [])) {
            return "has no contract.{$key}";
        }
    }
    foreach ($snapshot['migration'] ?? [null] as $variant) {
        if (!is_array($variant['moves'] ?? null) || !is_array($variant['map'] ?? null)) {
            return 'has a migration without moves and map';
        }
    }
    return null;
}

/** Migration invariants, checked on a snapshot as data. */
function checkMigration(string $name, array $snapshot): void
{
    $modes = $snapshot['contract']['modes'];
    foreach ($snapshot['migration'] as $variant => ['moves' => $moves, 'map' => $map]) {
        $what = "{$name} migration ({$variant})";
        foreach ($map as $from => $to) {
            if (!in_array($to, $modes, true)) {
                fail("{$what} rewrites {$from} to " . json_encode($to) . ', not a stored value; fix the migration.');
            } elseif (($map[keyOf($to)] ?? null) !== $to) {
                fail("{$what} is not idempotent: {$from} becomes {$to}, which becomes " . json_encode($map[keyOf($to)] ?? null) . '.');
            }
        }
        foreach ($modes as $mode) {
            $to = $map[keyOf($mode)] ?? null;
            if ($to !== $mode && !in_array($mode, $moves, true)) {
                fail("{$what} rewrites the canonical {$mode} to " . json_encode($to) . "; fix the migration, or register"
                    . " the move under the variant's 'moves' in that plugin's " . SPEC_PATH . '.');
            }
        }
    }
}

/** Fail unless every plugin has the same value; for a map, name each entry that differs. */
function compare(string $what, array $values): void
{
    $seen = array_map(static fn ($v) => json_encode($v, JSON_UNESCAPED_SLASHES), $values);
    if (count(array_unique($seen)) === 1) {
        return;
    }
    $first = reset($values);
    if (is_array($first) && !array_is_list($first)) {
        $subkeys = array_unique(array_merge(...array_map(
            static fn ($v) => array_keys((array) $v),
            array_values($values)
        )));
        foreach ($subkeys as $sub) {
            compare("{$what} {$sub}", array_map(static fn ($v) => is_array($v) ? ($v[$sub] ?? null) : null, $values));
        }
        return;
    }
    $detail = implode('; ', array_map(static fn ($k, $v) => "{$k} {$v}", array_keys($seen), $seen));
    fail("{$what} differs: {$detail}. Fix the plugin that is wrong, then run `" . WRITE_COMMAND . '` there and commit.');
}

/** Read one file of a sibling, as text: [found, text]. Never executed. */
function siblingFile(string $repo, ?string $dir, string $ref, string $path): array
{
    if ($dir !== null) {
        return is_file("{$dir}/{$path}") ? [true, (string) file_get_contents("{$dir}/{$path}")] : [false, ''];
    }
    [$code, $out] = gh([
        '-H',
        'Accept: application/vnd.github.raw',
        "repos/{$repo}/contents/{$path}?ref=" . rawurlencode($ref),
    ]);
    return [$code === 0, $out];
}

// --- Main ------------------------------------------------------------------

$root = dirname(__DIR__);
setFlag(null);
selfTest();
if (!is_file($root . '/' . SPEC_PATH)) {
    stop('no ' . SPEC_PATH . ' in this checkout.');
}
$spec = require $root . '/' . SPEC_PATH;
$self = $spec['platform'] ?? null;
if (!isset(REPOS[$self])) {
    stop(SPEC_PATH . " names no known platform; set 'platform' to one of " . implode(', ', array_keys(REPOS)) . '.');
}
try {
    $fresh = extractSnapshot($root, $spec);
} catch (Throwable $e) {
    stop("{$self}: " . $e->getMessage() . '.');
}

if (in_array('--write', $argv, true)) {
    file_put_contents($root . '/' . SNAPSHOT_PATH, encode($fresh));
    echo 'environment-parity: wrote ' . SNAPSHOT_PATH . ".\n";
    exit(0);
}

$committed = is_file($root . '/' . SNAPSHOT_PATH) ? (string) file_get_contents($root . '/' . SNAPSHOT_PATH) : null;
if ($committed !== encode($fresh)) {
    $what = $committed === null ? 'is missing' : 'does not match this checkout';
    fail(SNAPSHOT_PATH . " {$what}: run `" . WRITE_COMMAND . '` and commit it.');
}

$siblingsDir = getenv('ENVIRONMENT_PARITY_SIBLINGS_DIR') ?: null;
$requested = getenv('ENVIRONMENT_PARITY_SIBLING_REF') ?: 'staging';
$base = $requested === 'main' ? 'main' : 'staging';
$snapshots = [$self => $fresh];
$mine = (string) file_get_contents(__FILE__);
$labels = [];
foreach (REPOS as $name => $repo) {
    if ($name === $self) {
        continue;
    }
    $dir = $siblingsDir === null ? null : $siblingsDir . '/' . basename($repo);
    // Strict only where the sibling carries the same branch: a paired change.
    $ref = $base;
    if ($dir === null && !in_array($requested, ['staging', 'main'], true)) {
        [$code] = gh(['repos/' . $repo . '/branches/' . rawurlencode($requested), '--jq', '.name']);
        $ref = $code === 0 ? $requested : $base;
    }
    $strict = $dir !== null || $ref === $requested && $ref !== $base;
    $label = $labels[$name] = $dir ?? "{$repo}@{$ref}";

    [$found, $json] = siblingFile($repo, $dir, $ref, SNAPSHOT_PATH);
    if (!$found) {
        $msg = "{$label} has no " . SNAPSHOT_PATH;
        if ($strict) {
            fail("{$msg}; add it on that branch with `" . WRITE_COMMAND . '` and commit it.');
        } else {
            warn("{$msg} yet, so it is not compared.");
        }
        continue;
    }
    $snapshot = json_decode($json, true);
    $error = shapeError($snapshot, $name);
    if ($error !== null) {
        fail("{$label} " . SNAPSHOT_PATH . " {$error}; run `" . WRITE_COMMAND . '` there and commit.');
        continue;
    }
    $snapshots[$name] = $snapshot;

    [$found, $theirs] = siblingFile($repo, $dir, $ref, SELF_PATH);
    if (!$found || $theirs !== $mine) {
        fail(SELF_PATH . ' ' . ($found ? 'differs from' : 'is missing at') . " {$label}; every copy must be byte-identical.");
    }
}

$contracts = array_map(static fn ($s) => $s['contract'], $snapshots);
foreach (array_unique(array_merge(...array_map('array_keys', array_values($contracts)))) as $key) {
    compare($key, array_map(static fn ($c) => $c[$key] ?? null, $contracts));
}
foreach ($snapshots as $name => $snapshot) {
    $c = $snapshot['contract'];
    if ($c['install_default'] !== $c['default']) {
        fail("{$name} installs {$c['install_default']} but declares the default {$c['default']}; fix the install step.");
    }
    if (array_keys($c['labels']) !== $c['modes']) {
        fail("{$name} labels " . json_encode(array_keys($c['labels'])) . ', not every stored value in order.');
    }
    checkMigration($name, $snapshot);
}

if (!empty($GLOBALS['failed'])) {
    exit(1);
}

$c = $fresh['contract'];
printf(
    "environment-parity OK across %s (%s): stored values %s, default %s, labels %s, case table sha256 %s.\n",
    implode(', ', array_keys($snapshots)),
    implode(', ', $labels),
    implode(', ', $c['modes']),
    $c['default'],
    implode(', ', $c['labels']),
    $c['case_table_sha256']
);
foreach ($c['options'] as $state => $options) {
    printf("  dropdown, %s: %s\n", $state, implode(', ', $options));
}
echo "Legacy-value migration per plugin (printed, not compared):\n";
foreach ($snapshots as $name => $snapshot) {
    foreach ($snapshot['migration'] as $variant => ['moves' => $moves, 'map' => $map]) {
        $moved = array_map(static fn ($from, $to) => "{$from}->{$to}", array_keys($map), $map);
        $registered = $moves ? ' (registered moves: ' . implode(', ', $moves) . ')' : '';
        printf("  %s, %s%s: %s\n", $name, $variant, $registered, implode(' ', $moved));
    }
}
