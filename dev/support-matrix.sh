#!/usr/bin/env bash
# dev/support-matrix.sh: discover and classify the WordPress x WooCommerce x
# PHP combinations CI tests, read from upstream on every run (TWO-27171).
#
# Usage:
#   dev/support-matrix.sh              human-readable report
#   dev/support-matrix.sh --emit-all   one JSON object for CI:
#     {"e2e": [runnable combos], "skips": [combos not run, with reasons],
#      "php_unit": [PHP minors for the unit and lint jobs]}
#   dev/support-matrix.sh --php-unit   the php_unit list alone, as a JSON
#     array. Reads only readme.txt and php.net, so an outage of the WordPress,
#     WooCommerce or Docker Hub sources cannot block the unit and static jobs.
#
# Support window, and where each part comes from:
#   PHP          php.net/releases (?json): the minors in supported_versions,
#                that is active or security support, not end of life.
#   WordPress    WooCommerce's published version support policy, quoted:
#   WooCommerce    "Woo uses a latest-minus-one (L-1) policy for WordPress and
#                  WooCommerce version compatibility."
#                  "Within each release series, only the latest patch release
#                  is officially supported."
#                https://developer.woocommerce.com/docs/contribution/contributing/version-support-policy/
#                So: the current stable release series and the one before it,
#                of both WordPress and WooCommerce, newest patch of each.
#                WordPress.org itself calls only its newest release supported,
#                so for a WooCommerce extension the WooCommerce policy is the
#                wider of the two and the one that applies.
#                WordPress series, their newest patch and minimum PHP:
#                api.wordpress.org/core/version-check/1.7.
#                The PHP minors each WordPress series supports: the core
#                handbook's "PHP Compatibility and WordPress Versions" table,
#                read through the handbook's REST endpoint
#                (make.wordpress.org/core/wp-json/wp/v2/handbook?slug=
#                php-compatibility-and-wordpress-versions). Quoted: "WordPress
#                software is tested and compatible with the versions in this
#                list." Each cell is Y or N; it retired its "beta support"
#                label in May 2026, and anything but Y counts as not declared.
#                WooCommerce versions: api.wordpress.org/plugins/info/1.0; each
#                version's "Requires at least" (WordPress) and "Requires PHP"
#                from its readme.txt in the wordpress.org plugin SVN.
#   Floors       The plugin's declared minimums stay in the window too, at the
#                newest patch of their series: readme.txt "Requires at least"
#                (WordPress) and "Requires PHP", and the main plugin file's
#                "WC requires at least". The three floors also make one e2e
#                combination together, on the declared PHP floor even where
#                php.net has ended its support.
#
# Matrices:
#   php_unit  Every PHP minor from the declared floor to the newest supported
#             one. setup-php resolves the newest patch of each.
#   e2e       Every WordPress x WooCommerce pair in the window, times every
#             supported PHP minor, classified, first match wins:
#               skip  WooCommerce X requires WordPress Y or later (its readme)
#               skip  WordPress X requires PHP Y or later      (version-check)
#               skip  WooCommerce X requires PHP Y or later    (its readme)
#               skip  no maintained wordpress:php<minor>-apache runtime image
#               run, provisional: WordPress X does not declare PHP Y yet: the
#                     handbook table has no Y for that series and minor, or no
#                     row for that series. Every php.net minor gets legs from
#                     its first GA release, but these run non-blocking
#                     (continue-on-error) with a warning, so they are exercised
#                     and cannot block. Docker images only decide whether a leg
#                     can run, never whether WordPress supports it.
#               run   otherwise, blocking
#
# A runnable leg builds docker/wordpress-core/Dockerfile: the runtime of
# wordpress:php<minor>-apache, which docker-library rebuilds for every PHP
# patch, with the WordPress core under test swapped in. The series tags stop
# being rebuilt once a newer series ships, so their PHP falls behind.
#
# Honest CI (TWO-24998): a transport or parse failure fails discovery, because
# an empty matrix would skip green, as does a matrix with no blocking leg,
# because it could never go red. A Docker Hub lookup that errors (anything but
# a clean 200 or 404) counts as published, so a registry blip shows as a red
# leg rather than a silent skip.

set -euo pipefail
cd "$(dirname "$0")/.."

mode=report
case "${1:-}" in
    --emit-all) mode=all ;;
    --php-unit) mode=unit ;;
    "") ;;
    *) echo "usage: $0 [--emit-all | --php-unit]" >&2; exit 2 ;;
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
if [ "$mode" = unit ]; then
    jq -R . <<<"$php_unit" | jq -sc '.'
    exit 0
fi

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

# --- WordPress's declared PHP support ----------------------------------------
compat_json=$(fetch 'https://make.wordpress.org/core/wp-json/wp/v2/handbook?slug=php-compatibility-and-wordpress-versions') || exit 2
# One "<series>\t<PHP column>\t<cell>" line per table cell, from every table
# whose header row starts "WP / PHP Version". A column is a minor ("8.5") or
# an open range ("8.3 and newer", "5.6 and older").
wp_compat=$(jq -r '.[0].content.rendered // empty' <<<"$compat_json" \
    | tr -d '\r\n' \
    | sed -e 's#</tr>#\n#g' -e 's#</t[hd]>#\t#g' -e 's#<[^>]*>##g' -e 's#&nbsp;# #g' \
    | awk -F'\t' '
        function trim(s) { gsub(/^[[:space:]]+|[[:space:]]+$/, "", s); return s }
        trim($1) ~ /WP \/ PHP Version$/ { n = NF; for (i = 2; i <= NF; i++) col[i] = trim($i); next }
        n && trim($1) ~ /^[0-9]+\.[0-9]+$/ {
            for (i = 2; i <= n; i++) if (col[i] != "") print trim($1) "\t" col[i] "\t" trim($i)
        }') || die "the WordPress PHP compatibility page did not parse"
[ -n "$wp_compat" ] || die "the WordPress PHP compatibility page has no 'WP / PHP Version' table"
# wp_declares <series> <php minor>: the table marks that minor Y for that series.
wp_declares() {
    awk -F'\t' -v s="$1" -v p="$2" '
        function le(a, b,  x, y) {
            split(a, x, "."); split(b, y, ".")
            return x[1] + 0 < y[1] + 0 || (x[1] + 0 == y[1] + 0 && x[2] + 0 <= y[2] + 0)
        }
        $1 != s { next }
        { v = $2; sub(/ .*/, "", v) }
        $2 == p || ($2 ~ / and newer$/ && le(v, p)) || ($2 ~ / and older$/ && le(p, v)) { print $3; exit }
    ' <<<"$wp_compat" | grep -qx Y
}
for s in $wp_window; do
    cut -f1 <<<"$wp_compat" | grep -qxF "$s" \
        || echo "::warning::support-matrix: WordPress's PHP compatibility table has no row for WordPress $s yet, so its legs run non-blocking" >&2
done

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
for php in $php_supported $php_floor; do runtime[$php]=$(hub_tag "php$php-apache"); done

entries=()
# classify <wordpress series> <woocommerce series> <php minor>
classify() {
    local wps=$1 wcs=$2 php=$3 wp wc reason= provisional=
    wp=$(wp_patch "$wps")
    wc=${wc_ver[$wcs]}
    if ! ver_le "${wc_wp[$wcs]}" "$wp"; then
        reason="WooCommerce $wc requires WordPress ${wc_wp[$wcs]} or later"
    elif ! ver_le "$(series "$(wp_php "$wps")")" "$php"; then
        reason="WordPress $wp requires PHP $(wp_php "$wps") or later"
    elif ! ver_le "$(series "${wc_php[$wcs]}")" "$php"; then
        reason="WooCommerce $wc requires PHP ${wc_php[$wcs]} or later"
    elif [ "${runtime[$php]}" = missing ]; then
        reason="no wordpress:php$php-apache runtime image"
    elif ! wp_declares "$wps" "$php"; then
        provisional="WordPress $wps does not declare PHP $php (WordPress's PHP compatibility table); runs non-blocking"
    fi
    entries+=("$(jq -nc --arg wordpress "$wp" --arg series "$wps" --arg woocommerce "$wc" \
        --arg php "$php" --arg reason "$reason" --arg provisional "$provisional" \
        '{wordpress: $wordpress, wordpress_series: $series, woocommerce: $woocommerce,
          php: $php, reason: $reason, provisional: ($provisional != ""),
          provisional_reason: $provisional}')")
}

for wps in $wp_window; do
    for wcs in $wc_window; do
        for php in $php_supported; do classify "$wps" "$wcs" "$php"; done
    done
done
# The floor leg: the declared WordPress, WooCommerce and PHP minimums together,
# kept even where php.net has ended support for that PHP (spec rule 2).
if ! grep -qxF "$php_floor" <<<"$php_supported"; then
    classify "$wp_floor" "$wc_floor" "$php_floor"
fi

all=$(printf '%s\n' "${entries[@]}" | jq -sc '.')
e2e=$(jq -c '[.[] | select(.reason == "") | del(.reason)]' <<<"$all")
provisional=$(jq '[.[] | select(.reason == "" and .provisional)] | length' <<<"$all")
skips=$(jq -c '[.[] | select(.reason != "") | {wordpress, woocommerce, php, reason}]' <<<"$all")
unit=$(jq -R . <<<"$php_unit" | jq -sc '.')
runs=$(jq length <<<"$e2e")
[ "$runs" -gt 0 ] || echo "::warning::support-matrix: every combination is a skip, so e2e tests nothing this run" >&2
[ "$runs" -eq 0 ] || [ "$provisional" -lt "$runs" ] \
    || die "every runnable combination is non-blocking, so e2e could never fail; check WordPress's PHP compatibility table"

if [ "$mode" = all ]; then
    jq -nc --argjson e2e "$e2e" --argjson skips "$skips" --argjson php_unit "$unit" \
        '{e2e: $e2e, skips: $skips, php_unit: $php_unit}'
    exit 0
fi

echo
echo "E2E combinations ($runs run, of which $provisional provisional, $(jq length <<<"$skips") skip):"
jq -r '.[] | "WordPress \(.wordpress)  WooCommerce \(.woocommerce)  PHP \(.php)" as $c
    | if .reason != "" then "  SKIP  \($c): \(.reason)"
      elif .provisional then "  RUN*  \($c): \(.provisional_reason)"
      else "  RUN   \($c)" end' <<<"$all"
