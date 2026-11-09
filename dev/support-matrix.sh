#!/usr/bin/env bash
# dev/support-matrix.sh: discover and classify the WordPress x WooCommerce x
# PHP combinations CI tests, read from upstream on every run (TWO-27171).
#
# Usage:
#   dev/support-matrix.sh              human-readable report
#   dev/support-matrix.sh --emit-all   one JSON object for CI:
#     {"e2e": [runnable combos], "skips": [combos not run, with reasons],
#      "php_unit": [PHP minors for the unit and lint jobs]}
#
# Support window, and where each part comes from:
#   PHP          php.net/releases (?json): the minors in supported_versions,
#                that is active or security support, not end of life.
#   WordPress    WooCommerce's published version support policy, "latest minus
#   WooCommerce  one" (L-1): the current stable release series and the one
#                immediately before it, of both WordPress and WooCommerce, and
#                only the newest patch of each series.
#                https://developer.woocommerce.com/docs/contribution/contributing/version-support-policy/
#                WordPress.org itself calls only its newest release supported,
#                so for a WooCommerce extension the WooCommerce policy is the
#                wider of the two and the one that applies.
#                WordPress series, their newest patch and minimum PHP:
#                api.wordpress.org/core/version-check/1.7.
#                WooCommerce versions: api.wordpress.org/plugins/info/1.0; each
#                version's "Requires at least" (WordPress) and "Requires PHP"
#                from its readme.txt in the wordpress.org plugin SVN.
#   Floors       The plugin's declared minimums stay in the window too, at the
#                newest patch of their series: readme.txt "Requires at least"
#                (WordPress) and "Requires PHP", and the main plugin file's
#                "WC requires at least".
#
# Matrices:
#   php_unit  Every PHP minor from the declared floor to the newest supported
#             one. setup-php resolves the newest patch of each.
#   e2e       Every WordPress x WooCommerce pair in the window, times every
#             supported PHP minor, classified run or skip, first match wins:
#               WooCommerce X requires WordPress Y or later   (its readme)
#               WordPress X requires PHP Y or later           (version-check)
#               WooCommerce X requires PHP Y or later         (its readme)
#               WordPress X was never published on PHP Y: docker-library ships
#                 a WordPress series only on the PHP minors it runs on, so no
#                 wordpress:<series>-php<minor>-apache tag means no image
#               no maintained wordpress:php<minor>-apache runtime image
#               run
#
# A runnable leg builds docker/wordpress-core/Dockerfile: the runtime of
# wordpress:php<minor>-apache, which docker-library rebuilds for every PHP
# patch, with the WordPress core under test swapped in. The series tags stop
# being rebuilt once a newer series ships, so their PHP falls behind.
#
# Honest CI (TWO-24998): a transport or parse failure fails discovery, because
# an empty matrix would skip green. A Docker Hub lookup that errors (anything
# but a clean 200 or 404) counts as published, so a registry blip shows as a
# red leg rather than a silent skip.

set -euo pipefail
cd "$(dirname "$0")/.."

mode=report
case "${1:-}" in
    --emit-all) mode=all ;;
    "") ;;
    *) echo "usage: $0 [--emit-all]" >&2; exit 2 ;;
esac

HUB=https://hub.docker.com/v2/namespaces/library/repositories/wordpress/tags

log() { if [ "$mode" = report ]; then echo "$@"; fi; }
die() { echo "::error::support-matrix: $*" >&2; exit 2; }
fetch() {
    curl -fsSL --retry 3 --retry-all-errors --retry-delay 3 --max-time 30 "$1" \
        || die "could not fetch $1"
}
# ver_le A B: A <= B in version order.
ver_le() { [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -1)" = "$1" ]; }
series() { cut -d. -f1,2 <<<"$1"; }
# header <field> <text>: the version after "<field>:" in a plugin or readme header.
header() { sed -n "s/^[ *]*$1:[[:space:]]*\([0-9][0-9.]*\).*/\1/p" <<<"$2" | head -1; }

# hub_tag <tag>: exists | missing | error, for wordpress:<tag> on Docker Hub.
# Docker Hub's API, not the registry, so it cannot spend the anonymous pull
# allowance the legs need.
hub_tag() {
    local code=000
    for _ in 1 2; do
        code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$HUB/$1" 2>/dev/null) || code=000
        case $code in
            200) echo exists; return ;;
            404) echo missing; return ;;
        esac
        sleep 3
    done
    echo "::warning::support-matrix: Docker Hub answered HTTP $code for wordpress:$1; treating it as published" >&2
    echo error
}

# --- Declared floors --------------------------------------------------------
readme=$(cat readme.txt)
plugin=$(cat tillit-payment-gateway.php)
wp_floor=$(header 'Requires at least' "$readme")
php_floor=$(header 'Requires PHP' "$readme")
wc_floor=$(header 'WC requires at least' "$plugin")
[ -n "$wp_floor" ] && [ -n "$php_floor" ] && [ -n "$wc_floor" ] \
    || die "could not read the declared floors (WordPress '$wp_floor', PHP '$php_floor', WooCommerce '$wc_floor')"
log "Declared floors: WordPress $wp_floor, WooCommerce $wc_floor, PHP $php_floor"

# --- PHP --------------------------------------------------------------------
php_json=$(fetch 'https://www.php.net/releases/?json') || exit 2
php_supported=$(jq -r '[.[].supported_versions[]?] | unique | .[]' <<<"$php_json" | sort -V) \
    || die "php.net releases feed did not parse"
[ -n "$php_supported" ] || die "php.net lists no supported PHP minors"
php_newest=$(tail -1 <<<"$php_supported")
# Each major's latest release names its last minor, so every minor from the
# floor to the newest supported one can be listed without a hand-kept range.
php_unit=$(jq -r '.[].version' <<<"$php_json" \
    | grep -E '^[0-9]+\.[0-9]+\.' \
    | awk -F. '{ for (i = 0; i <= $2; i++) print $1 "." i }' \
    | sort -V \
    | while read -r m; do
        if ver_le "$php_floor" "$m" && ver_le "$m" "$php_newest"; then echo "$m"; fi
    done)
[ -n "$php_unit" ] || die "no PHP minors between the floor $php_floor and $php_newest"
log "PHP supported (php.net): $(echo $php_supported)"
log "PHP unit and lint: $(echo $php_unit)"

# --- WordPress --------------------------------------------------------------
wp_json=$(fetch 'https://api.wordpress.org/core/version-check/1.7/') || exit 2
# "<series> <newest patch> <minimum PHP>", one line per series.
wp_series=$(jq -r '.offers[]
        | select(.current | test("^[0-9]+\\.[0-9]+(\\.[0-9]+)?$"))
        | "\(.current) \(.php_version)"' <<<"$wp_json" \
    | sort -V -u \
    | awk '{ split($1, v, "."); s = v[1] "." v[2]; ver[s] = $1; php[s] = $2 }
           END { for (s in ver) print s, ver[s], php[s] }' \
    | sort -V) || die "WordPress version-check API did not parse"
[ -n "$wp_series" ] || die "WordPress version-check API listed no releases"
grep -q "^$wp_floor " <<<"$wp_series" \
    || die "WordPress $wp_floor (the declared floor) is not among the version-check offers"
wp_window=$({ awk '{ print $1 }' <<<"$wp_series" | tail -2; echo "$wp_floor"; } | sort -V -u)
wp_patch() { awk -v s="$1" '$1 == s { print $2 }' <<<"$wp_series"; }
wp_php() { awk -v s="$1" '$1 == s { print $3 }' <<<"$wp_series"; }
log "WordPress window (L-1 + floor):"
for s in $wp_window; do log "  $(wp_patch "$s") (requires PHP $(wp_php "$s"))"; done

# --- WooCommerce ------------------------------------------------------------
wc_json=$(fetch 'https://api.wordpress.org/plugins/info/1.0/woocommerce.json') || exit 2
wc_stable=$(jq -r '.version' <<<"$wc_json")
[[ $wc_stable =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "WooCommerce stable version '$wc_stable' is not a release"
# "<series> <newest patch>", stable releases only, none newer than the stable tag.
wc_series=$(jq -r '.versions | keys[] | select(test("^[0-9]+\\.[0-9]+\\.[0-9]+$"))' <<<"$wc_json" \
    | sort -V \
    | while read -r v; do if ver_le "$v" "$wc_stable"; then echo "$v"; fi; done \
    | awk -F. '{ s = $1 "." $2; v[s] = $0 } END { for (s in v) print s, v[s] }' \
    | sort -V)
grep -q "^$wc_floor " <<<"$wc_series" \
    || die "WooCommerce $wc_floor (the declared floor) has no release on wordpress.org"
wc_window=$({ awk '{ print $1 }' <<<"$wc_series" | tail -2; echo "$wc_floor"; } | sort -V -u)
declare -A wc_ver=() wc_wp=() wc_php=()
log "WooCommerce window (L-1 + floor):"
for s in $wc_window; do
    v=$(awk -v s="$s" '$1 == s { print $2 }' <<<"$wc_series")
    req=$(fetch "https://plugins.svn.wordpress.org/woocommerce/tags/$v/readme.txt") || exit 2
    req=$(tr -d '\r' <<<"$req")
    wc_ver[$s]=$v
    wc_wp[$s]=$(header 'Requires at least' "$req")
    wc_php[$s]=$(header 'Requires PHP' "$req")
    [ -n "${wc_wp[$s]}" ] && [ -n "${wc_php[$s]}" ] \
        || die "WooCommerce $v readme.txt has no 'Requires at least' or 'Requires PHP'"
    log "  $v (requires WordPress ${wc_wp[$s]}, PHP ${wc_php[$s]})"
done

# --- Classify ---------------------------------------------------------------
declare -A runtime=()
for php in $php_supported; do runtime[$php]=$(hub_tag "php$php-apache"); done

entries=()
for wps in $wp_window; do
    wp=$(wp_patch "$wps")
    for wcs in $wc_window; do
        wc=${wc_ver[$wcs]}
        for php in $php_supported; do
            reason=
            if ! ver_le "${wc_wp[$wcs]}" "$wp"; then
                reason="WooCommerce $wc requires WordPress ${wc_wp[$wcs]} or later"
            elif ! ver_le "$(series "$(wp_php "$wps")")" "$php"; then
                reason="WordPress $wp requires PHP $(wp_php "$wps") or later"
            elif ! ver_le "$(series "${wc_php[$wcs]}")" "$php"; then
                reason="WooCommerce $wc requires PHP ${wc_php[$wcs]} or later"
            elif [ "$(hub_tag "$wps-php$php-apache")" = missing ]; then
                reason="WordPress $wps was never published on PHP $php (no wordpress:$wps-php$php-apache image)"
            elif [ "${runtime[$php]}" = missing ]; then
                reason="no maintained wordpress:php$php-apache runtime image"
            fi
            entries+=("$(jq -nc --arg wordpress "$wp" --arg series "$wps" --arg woocommerce "$wc" \
                --arg php "$php" --arg reason "$reason" \
                '{wordpress: $wordpress, wordpress_series: $series, woocommerce: $woocommerce,
                  php: $php, reason: $reason}')")
        done
    done
done

all=$(printf '%s\n' "${entries[@]}" | jq -sc '.')
e2e=$(jq -c '[.[] | select(.reason == "") | del(.reason)]' <<<"$all")
skips=$(jq -c '[.[] | select(.reason != "") | {wordpress, woocommerce, php, reason}]' <<<"$all")
unit=$(jq -R . <<<"$php_unit" | jq -sc '.')
runs=$(jq length <<<"$e2e")
[ "$runs" -gt 0 ] || echo "::warning::support-matrix: every combination is a skip, so e2e tests nothing this run" >&2

if [ "$mode" = all ]; then
    jq -nc --argjson e2e "$e2e" --argjson skips "$skips" --argjson php_unit "$unit" \
        '{e2e: $e2e, skips: $skips, php_unit: $php_unit}'
    exit 0
fi

echo
echo "E2E combinations ($runs run, $(jq length <<<"$skips") skip):"
jq -r '.[] | if .reason == "" then "  RUN   WordPress \(.wordpress)  WooCommerce \(.woocommerce)  PHP \(.php)"
             else "  SKIP  WordPress \(.wordpress)  WooCommerce \(.woocommerce)  PHP \(.php): \(.reason)" end' <<<"$all"
