#!/usr/bin/env bash
# dev/check-php-patch.sh <image> <running-php-version>
#
# Checks that an e2e image runs the newest patch of its PHP minor (TWO-27171).
# The newest patch and its release date come from php.net
# (https://www.php.net/releases/?json&version=<minor>). An image behind it gets
# a ::warning:: naming the image, the running patch and the newest one, however
# long it has lagged. It never fails the leg; only a failed php.net lookup does.
set -euo pipefail

image=${1:?usage: $0 <image> <running-php-version>}
running=${2:?usage: $0 <image> <running-php-version>}
[[ $running =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]] || { echo "::error::php-patch: '$running' is not a PHP version" >&2; exit 1; }
minor=$(cut -d. -f1,2 <<<"$running")

release=$(curl -fsSL --retry 3 --retry-all-errors --retry-delay 3 --max-time 30 \
    "https://www.php.net/releases/?json&version=$minor") \
    || { echo "::error::php-patch: could not query php.net for PHP $minor" >&2; exit 1; }
latest=$(jq -r '.version // empty' <<<"$release")
released=$(jq -r '.date // empty' <<<"$release")
[ -n "$latest" ] && [ -n "$released" ] \
    || { echo "::error::php-patch: php.net has no release for PHP $minor" >&2; exit 1; }

newest=$(printf '%s\n%s\n' "$running" "$latest" | sort -V | tail -1)
if [ "$newest" = "$running" ]; then
    echo "$image runs PHP $running, the newest $minor patch (php.net: $latest, released $released)"
    exit 0
fi
echo "::warning title=PHP patch behind::$image runs PHP $running; php.net's newest $minor patch is $latest, released $released"
