#!/usr/bin/env bash
# dev/check-php-patch.sh <running-php-version>
#
# Checks that an e2e image runs the newest patch of its PHP minor (TWO-27171).
# The newest patch and its release date come from php.net
# (https://www.php.net/releases/?json&version=<minor>).
#   on the newest patch (or newer than php.net lists)  pass
#   behind, newest patch released 7 days ago or less   ::warning::, pass
#   behind, newest patch released more than 7 days ago ::error::, fail
# The 7 days cover docker-library rebuilding its images after a PHP release.
# An image that lags for longer needs a base that keeps up, not a longer grace.
set -euo pipefail

GRACE_DAYS=7
running=${1:?usage: $0 <running-php-version>}
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
    echo "PHP $running is the newest $minor patch (php.net: $latest, released $released)"
    exit 0
fi

age=$((($(date -u +%s) - $(date -u -d "$released" +%s)) / 86400))
msg="image runs PHP $running but php.net released $latest on $released ($age days ago)"
if [ "$age" -le "$GRACE_DAYS" ]; then
    echo "::warning title=PHP patch behind::$msg; within the $GRACE_DAYS-day grace for image rebuilds"
    exit 0
fi
echo "::error title=PHP patch behind::$msg; past the $GRACE_DAYS-day grace, so the image is not keeping up"
exit 1
