#!/usr/bin/env bash
#
# Prints the API / merchant-portal / checkout-page hosts the RUNNING
# `wordpress` container is actually configured to hit, by execing
# dev/probe-hosts.php inside it and reformatting its output.
#
# Runs inside the `wordpress` container (not `wpcli`) because the
# TWOINC_DEV_*_HOST overrides are only threaded into that service's process
# environment by docker-compose.yaml - the container that actually serves
# checkout requests. dev/probe-hosts.php is the one place that resolution
# logic lives (WC_Twoinc_Helper::get_environment_host()); this script only
# parses its output, it does not re-derive the override-vs-default logic.
#
# Usage: dev/print-resolved-hosts.sh
# Prints nothing (and exits 0) if the container isn't reachable - callers
# use this for a "nice to have" status block, not a hard dependency.
set -euo pipefail

DUMP=$(docker compose exec -T wordpress php /var/www/html/wp-content/plugins/tillit-payment-gateway/dev/probe-hosts.php 2>/dev/null) || exit 0

API=$(sed -n 's/^get_environment_host(api): //p' <<< "$DUMP")
PORTAL=$(sed -n 's/^get_environment_host(portal): //p' <<< "$DUMP")
CHECKOUT=$(sed -n 's/^get_environment_host(checkout): //p' <<< "$DUMP")

[ -n "$API" ] && echo " API:               $API"
[ -n "$PORTAL" ] && echo " Portal:            $PORTAL"
[ -n "$CHECKOUT" ] && echo " Checkout (signup): $CHECKOUT"

exit 0
