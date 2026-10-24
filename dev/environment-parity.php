<?php

/**
 * dev/environment-parity.php: the PrestaShop, WooCommerce and Magento plugins
 * offer the same Environment setting (TWO-26613, TWO-26604).
 *
 * This file is byte-identical in two-inc/prestashop-plugin,
 * two-inc/woocommerce-plugin and two-inc/magento-plugin. What differs is
 * dev/environment-contract.php, each plugin's own record of where it declares
 * the setting; nothing here names another plugin's code.
 *
 * Each plugin's contract is extracted by that plugin's own
 * dev/environment-contract.php: this repo's from this checkout, each
 * sibling's from files read with `gh api` (at the same branch name when the
 * sibling has one, else at `staging`, so a paired change pushed under one
 * branch name in all three repos is compared branch to branch). A plugin's
 * environment helpers are lifted out of its source and run here. The check
 * fails when:
 *   - the stored values, their order or the fresh-install default differ, or
 *     the install step does not write that default;
 *   - the dropdown offers different values (fresh, with
 *     TWO_INTERNAL_ENVIRONMENTS=1, or with staging already stored);
 *   - a stored value reads as a different environment;
 *   - the field label, description or option labels differ;
 *   - a plugin's legacy-value migration can return a value outside the stored
 *     values, rewrites a canonical value it has not registered as moving, or
 *     is not idempotent, or its upgrade step no longer calls it;
 *   - environment-cases.json or this file differs between the repos, or this
 *     repo's suite no longer reads the case table.
 * The platforms stored different values historically, so each migration maps
 * legacy values its own way: what each does is printed, not compared.
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

const REPOS = [
    'prestashop' => 'two-inc/prestashop-plugin',
    'woocommerce' => 'two-inc/woocommerce-plugin',
    'magento' => 'two-inc/magento-plugin',
];
const SELF_PATH = 'dev/environment-parity.php';
const CONTRACT_PATH = 'dev/environment-contract.php';
const FLAG = 'TWO_INTERNAL_ENVIRONMENTS';
// The siblings add these files in separate PRs, so until this date (UTC) a
// sibling ref without them is a warning; from it, a missing copy fails.
// Delete this and its warning once all three repos carry them on staging.
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

/** A single-quoted PHP string literal; group 1 is its body. */
const STR = "'((?:[^'\\\\]|\\\\.)*)'";

/** An option label: 'mode' => a translation call on a single-quoted literal. */
const LABEL_PATTERN = "/'(production|sandbox|staging)'\\s*=>\\s*(?:\\\$this->l|__)\\(\\s*" . STR . '/';

// --- Helpers for dev/environment-contract.php ------------------------------

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

/**
 * The source of a class's members, by name: constants as `const X = ...;`,
 * methods as written. Reads tokens, so braces in strings and comments are
 * not miscounted.
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
            $capture = ['kind' => $t[0], 'name' => $tokens[$next($i)][1], 'code' => ''];
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
            if ($capture['kind'] === T_CONST) {
                $consts[$capture['name']] = $capture['code'];
            }
            $capture = null; // an abstract method has no body
        }
    }
    return ['consts' => $consts, 'methods' => $methods];
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

/**
 * One plugin, as a map of closures over its files: this checkout, a local
 * sibling checkout, or the sibling's repo through gh api. A map rather than
 * a class, because Magento's setup:di:compile includes every PHP file in the
 * module that declares one, and this file must only ever run on purpose.
 *
 * Keys: name, label; has(path), file(path), method(path, class, name),
 * lift(path, class, consts, methods), call(name, ...args), constant(name),
 * value(expr).
 */
function plugin(string $name, string $label, ?string $dir, string $repo, string $ref): array
{
    $files = $parsed = [];
    $lifted = 'EnvironmentParity_' . $name;
    $fetch = static function (string $path) use (&$files, $dir, $repo, $ref): ?string {
        if (array_key_exists($path, $files)) {
            return $files[$path];
        }
        if ($dir !== null) {
            $file = "{$dir}/{$path}";
            return $files[$path] = is_file($file) ? (string) file_get_contents($file) : null;
        }
        [$code, $out] = gh([
            '-H',
            'Accept: application/vnd.github.raw',
            "repos/{$repo}/contents/{$path}?ref=" . rawurlencode($ref),
        ]);
        return $files[$path] = $code === 404 ? null : $out;
    };
    $file = static function (string $path) use ($fetch): string {
        return $fetch($path) ?? throw new RuntimeException("no {$path}");
    };
    $members = static function (string $path, string $class) use (&$parsed, $file): array {
        return $parsed["{$path}#{$class}"] ??= members($file($path), $class);
    };
    $method = static function (string $path, string $class, string $name) use ($members): string {
        return $members($path, $class)['methods'][$name]
            ?? throw new RuntimeException("no method {$class}::{$name}() in {$path}");
    };
    $constant = static fn (string $const) => constant("{$lifted}::{$const}");
    return [
        'name' => $name,
        'label' => $label,
        'has' => static fn (string $path): bool => $fetch($path) !== null,
        'file' => $file,
        'method' => $method,
        // Lift the named constants and static methods of a class into a
        // class of their own, so they run here without the platform.
        'lift' => static function (string $path, string $class, array $consts, array $names) use ($members, $method, $lifted): void {
            $code = [];
            foreach ($consts as $const) {
                $code[] = $members($path, $class)['consts'][$const]
                    ?? throw new RuntimeException("no constant {$class}::{$const}");
            }
            foreach ($names as $name) {
                $code[] = 'public static ' . $method($path, $class, $name);
            }
            eval("final class {$lifted} {\n" . implode("\n", $code) . "\n}");
        },
        'call' => static fn (string $name, ...$args) => [$lifted, $name](...$args),
        'constant' => $constant,
        // A literal, or a lifted constant named as `self::X` or `Class::X`.
        'value' => static function (string $expr) use ($constant, $lifted): string {
            if (preg_match('/^' . STR . '$/', $expr, $m)) {
                return unquote($m[1]);
            }
            if (preg_match('/^(?:self|static|\\\\?\w+)::(\w+)$/', $expr, $m) && defined("{$lifted}::{$m[1]}")) {
                return (string) $constant($m[1]);
            }
            throw new RuntimeException("cannot resolve {$expr}");
        },
    ];
}

function setFlag(?string $flag): void
{
    putenv($flag === null ? FLAG : FLAG . '=' . $flag);
}

/** Load a plugin's dev/environment-contract.php from wherever its files are. */
function loadContract(array $plugin): array
{
    $tmp = tempnam(sys_get_temp_dir(), 'environment-contract');
    file_put_contents($tmp, $plugin['file'](CONTRACT_PATH));
    try {
        $spec = require $tmp;
    } finally {
        unlink($tmp);
    }
    if (!is_array($spec) || ($spec['platform'] ?? null) !== $plugin['name']) {
        throw new RuntimeException(CONTRACT_PATH . " does not describe the {$plugin['name']} plugin");
    }
    return $spec;
}

/** One plugin's contract, from its own description of where it lives. */
function contract(array $plugin, array $spec): array
{
    $h = $spec['helpers'];
    $plugin['lift']($h['file'], $h['class'], array_values($h['consts']), $h['methods']);
    $c = ['modes' => $plugin['constant']($h['consts']['modes']), 'default' => $plugin['constant']($h['consts']['default'])];
    foreach (OPTION_STATES as $state => [$stored, $flag]) {
        setFlag($flag);
        $c['options'][$state] = $plugin['call']($h['options'], $stored);
    }
    setFlag(null);
    foreach (INPUTS as $input) {
        $c['reads'][json_encode($input)] = $plugin['call']($h['read'], $input);
    }
    // A setting declared in more than one file must read the same in each.
    foreach (($spec['declarations'])($plugin) as $key => $declared) {
        if ($key !== 'labels' && count(array_unique($declared)) !== 1) {
            throw new RuntimeException("declares {$key} differently in its own files: " . json_encode($declared));
        }
        $c[$key] = $key === 'labels' ? $declared : $declared[0];
    }
    $c['case_table_sha256'] = hash('sha256', $plugin['file']($spec['cases']));

    $migration = [];
    foreach ($spec['migrate']['variants'] as $variant => ['args' => $args, 'moves' => $moves]) {
        $what = "{$plugin['name']} migration ({$variant})";
        foreach (INPUTS as $input) {
            $to = $plugin['call']($spec['migrate']['method'], $input, ...$args);
            $migration[$variant][json_encode($input)] = $to;
            if (!in_array($to, $c['modes'], true)) {
                fail("{$what} rewrites " . json_encode($input) . ' to ' . json_encode($to) . ', not a stored value.');
            } elseif ($plugin['call']($spec['migrate']['method'], $to, ...$args) !== $to) {
                fail("{$what} is not idempotent on " . json_encode($input) . '.');
            }
            if (in_array($input, $c['modes'], true) && $to !== $input && !in_array($input, $moves, true)) {
                fail("{$what} rewrites the canonical {$input} to {$to}.");
            }
        }
    }
    foreach ($spec['steps'] as ['file' => $path, 'in' => $in, 'calls' => $needle]) {
        $where = $in === null ? $plugin['file']($path) : $plugin['method']($path, $in[0], $in[1]);
        if (strpos($where, $needle) === false) {
            $at = $in === null ? $path : "{$in[0]}::{$in[1]}() in {$path}";
            fail("{$plugin['name']}: {$at} no longer calls {$needle}; the upgrade must migrate through it.");
        }
    }
    return [$c, $migration];
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
    fail("{$what} differs: {$detail}.");
}

// --- Main ------------------------------------------------------------------

$root = dirname(__DIR__);
setFlag(null);
if (!is_file($root . '/' . CONTRACT_PATH)) {
    stop('no ' . CONTRACT_PATH . ' in this checkout.');
}
$self = (require $root . '/' . CONTRACT_PATH)['platform'] ?? null;
if (!isset(REPOS[$self])) {
    stop(CONTRACT_PATH . ' names no known platform.');
}

$siblingsDir = getenv('ENVIRONMENT_PARITY_SIBLINGS_DIR') ?: null;
$requested = getenv('ENVIRONMENT_PARITY_SIBLING_REF') ?: 'staging';
$plugins = [];
foreach (REPOS as $name => $repo) {
    $repoName = basename($repo);
    if ($name === $self) {
        $plugins[$name] = plugin($name, "{$repoName} (this checkout)", $root, $repo, '');
    } elseif ($siblingsDir !== null) {
        $plugins[$name] = plugin($name, "{$siblingsDir}/{$repoName}", "{$siblingsDir}/{$repoName}", $repo, '');
    } else {
        // A branch the sibling lacks is the normal case for a change on one
        // side only, so it falls back to staging.
        $ref = 'staging';
        if ($requested !== 'staging' && gh(["repos/{$repo}/branches/{$requested}", '--jq', '.name'])[0] === 0) {
            $ref = $requested;
        }
        $plugins[$name] = plugin($name, "{$repo}@{$ref}", null, $repo, $ref);
    }
}
$siblings = array_diff_key($plugins, [$self => true]);
echo "environment-parity: {$self} compared with "
    . implode(' and ', array_map(static fn ($p) => $p['label'], $siblings)) . ".\n";

$contracts = $migrations = [];
$selfSpec = null;
foreach ($plugins as $name => $plugin) {
    if ($name !== $self && !$plugin['has'](CONTRACT_PATH)) {
        if (gmdate('Y-m-d') < BOOTSTRAP_ENDS) {
            echo "::warning::environment-parity: {$plugin['label']} has no " . CONTRACT_PATH
                . ' yet, so it is not compared; until ' . BOOTSTRAP_ENDS . " that is a warning.\n";
        } else {
            fail("{$plugin['label']} has no " . CONTRACT_PATH . '.');
        }
        unset($plugins[$name]);
        continue;
    }
    try {
        $spec = loadContract($plugin);
        $selfSpec = $name === $self ? $spec : $selfSpec;
        [$contracts[$name], $migrations[$name]] = contract($plugin, $spec);
    } catch (Throwable $e) {
        fail("{$plugin['label']}: " . $e->getMessage() . '.');
        unset($plugins[$name]);
    }
}

foreach (array_unique(array_merge(...array_map('array_keys', array_values($contracts)))) as $key) {
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
if ($selfSpec !== null) {
    $readers = 0;
    $files = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator("{$root}/{$selfSpec['tests']}", FilesystemIterator::SKIP_DOTS)
    );
    foreach ($files as $file) {
        if (
            substr($file->getFilename(), -4) === '.php'
            && strpos((string) file_get_contents($file->getPathname()), 'environment-cases.json') !== false
        ) {
            $readers++;
        }
    }
    if ($readers === 0) {
        fail("no PHP file under {$selfSpec['tests']}/ reads environment-cases.json; the suite must run the case table.");
    }
}

// This file must be the same in all three.
$mine = (string) file_get_contents(__FILE__);
foreach ($siblings as $plugin) {
    if (!$plugin['has'](SELF_PATH)) {
        if (gmdate('Y-m-d') < BOOTSTRAP_ENDS) {
            echo "::warning::environment-parity: {$plugin['label']} has no " . SELF_PATH
                . ' yet; until ' . BOOTSTRAP_ENDS . " that is a warning.\n";
        } else {
            fail("{$plugin['label']} has no " . SELF_PATH . '; all three plugins must carry the same copy.');
        }
    } elseif ($plugin['file'](SELF_PATH) !== $mine) {
        fail(SELF_PATH . " differs from the copy at {$plugin['label']}; the three must be byte-identical.");
    }
}

if (!empty($GLOBALS['failed'])) {
    exit(1);
}

$c = $contracts[$self];
printf(
    "environment-parity OK across %s: stored values %s, default %s, labels %s, case table sha256 %s.\n",
    implode(', ', array_keys($contracts)),
    implode(', ', $c['modes']),
    $c['default'],
    implode(', ', $c['labels']),
    $c['case_table_sha256']
);
foreach ($c['options'] as $state => $options) {
    printf("  dropdown, %s: %s\n", $state, implode(', ', $options));
}
echo "Legacy-value migration per plugin (printed, not compared):\n";
foreach ($migrations as $name => $variants) {
    foreach ($variants as $variant => $map) {
        $moved = array_map(static fn ($from, $to) => "{$from}->{$to}", array_keys($map), $map);
        printf("  %s, %s: %s\n", $name, $variant, implode(' ', $moved));
    }
}
