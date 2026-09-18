#!/usr/bin/env bash
#
# Resolve a WordPress version to the newest version at or below it whose
# official Docker image is published. Prints that version to stdout, and any
# GitHub annotation to stderr.
#
# Usage: resolve-wordpress-image-tag.sh <wordpress-version> <tag-suffix>
#   e.g. resolve-wordpress-image-tag.sh 7.1.1 -php8.2-apache  ->  7.1.0
#
# wordpress.org announces a release the moment it ships and Docker Hub
# publishes the image for it hours later (ABN-614), so the announced version
# is not yet a pullable tag. A leg that cannot pull its image is noise rather
# than coverage, so lagging by a point release is the trade — made visible by
# the warning below rather than absorbed silently.
set -uo pipefail

TAGS_API="https://hub.docker.com/v2/namespaces/library/repositories/wordpress/tags"
MAX_PAGES=5

current=${1:?usage: $0 <wordpress-version> <tag-suffix>}
suffix=${2:?usage: $0 <wordpress-version> <tag-suffix>}

warn() { echo "::warning::e2e: $*" >&2; }
die() {
    echo "::error::e2e: $*" >&2
    exit 1
}

tags=$(mktemp)
trap 'rm -f "$tags"' EXIT

# Docker Hub's own API, not the registry: separate quota, so this cannot eat
# the anonymous `docker pull` allowance the legs go on to need.
fetch_tags() {
    local url="$TAGS_API?page_size=100&name=$suffix" page
    for _ in $(seq 1 $MAX_PAGES); do
        page=$(curl -fsSL --retry 5 --retry-all-errors --retry-delay 3 "$url") || return 1
        jq -er '.results[].name' <<<"$page" >>"$tags" || return 1
        url=$(jq -r '.next // empty' <<<"$page") || return 1
        [ -n "$url" ] || break
    done
}

# A rate-limited or unreachable Docker Hub must not red a build of its own, so
# fall back to the floating minor-line tag: published for the whole life of the
# minor, so of the candidates it is the likeliest to pull.
if ! fetch_tags; then
    line=$(cut -d. -f1,2 <<<"$current")
    warn "could not list wordpress image tags on Docker Hub; using wordpress:$line$suffix unverified"
    echo "$line"
    exit 0
fi

published=$(awk -v s="$suffix" '
    {
        n = length($0) - length(s)
        if (n > 0 && substr($0, n + 1) == s) {
            v = substr($0, 1, n)
            if (v ~ /^[0-9]+(\.[0-9]+)*$/) print v
        }
    }' "$tags")

if grep -qxF "$current" <<<"$published"; then
    resolved=$current
else
    # Sorted ascending with $current spliced in, the entry before it is the
    # newest published version that does not overshoot it.
    resolved=$(printf '%s\n%s\n' "$published" "$current" | sort -V -u \
        | awk -v c="$current" '$0 == c { exit } { last = $0 } END { print last }')
fi

[ -n "$resolved" ] || die "no published wordpress:<version>$suffix image at or below WordPress $current"

if [ "$resolved" != "$current" ]; then
    warn "WordPress $current is the current release but no wordpress:$current$suffix image is published; this leg runs on $resolved instead. A lag that persists means the Docker Hub publish has stalled."
fi

echo "$resolved"
