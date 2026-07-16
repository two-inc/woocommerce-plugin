# Local dev — see README "Set up Wordpress for local development".
# Copy .env.example to .env first; docker compose reads it natively.

.PHONY: help install configure run debug proxy stop clean logs logs-wpcli \
	test-unit test format archive patch minor major \
	e2e-install e2e-test e2e-test-headed phpcs phpstan

.DEFAULT_GOAL := help

## Show this help
help:
	@awk '/^## /{desc=substr($$0,4)} /^[a-zA-Z_-]+:/{if(desc){printf "  \033[36m%-16s\033[0m %s\n",$$1,desc; desc=""}}' $(MAKEFILE_LIST)

## Start the WordPress + WooCommerce dev container
run:
	docker compose up -d

## Create the dev container and provision WordPress + the plugin
install: run
	@echo "First provision runs in the wpcli container (~90s):"
	@echo "  make logs-wpcli   # watch progress"

## Start WordPress with Xdebug enabled and the FRP proxy running
debug: run
	docker compose exec -T wordpress bash /var/www/html/wp-content/plugins/tillit-payment-gateway/dev/install-xdebug debug
	docker compose restart wordpress
	@./start-proxy.sh --background || true
	@PROXY_URL=$$(./start-proxy.sh url 2>/dev/null); \
	if [ -n "$$PROXY_URL" ]; then \
		docker compose exec -T wordpress bash /var/www/html/wp-content/plugins/tillit-payment-gateway/dev/patch-proxy "$$PROXY_URL"; \
	fi; \
	echo ""; \
	echo "========================================="; \
	echo " WordPress store: http://localhost:8888/"; \
	if [ -n "$$PROXY_URL" ]; then \
		echo " Proxy store:     $$PROXY_URL/"; \
	fi; \
	echo " Xdebug:          active (mode=debug, listening on port 9003)"; \
	echo "========================================="

## Run FRP proxy in foreground (Ctrl-C to stop)
proxy:
	./start-proxy.sh

## Update Two payment gateway config from TWO_* env vars
configure:
	docker compose exec -T wpcli bash /opt/tillit-payment-gateway/dev/configure

## Tail WordPress container logs
logs:
	docker compose logs -f wordpress

## Tail wpcli provisioning logs
logs-wpcli:
	docker compose logs -f wpcli

## Stop the dev container
stop:
	docker compose down

## Remove the dev container, volumes and local state
clean:
	docker compose down -v
	rm -rf volumes/

## Run the unit test harness (same suite CI runs)
test-unit:
	docker run --rm -v "$(CURDIR)":/app -w /app php:8.2-cli php tests/unit/run.php

## Run the unit test harness (same suite CI runs)
test: test-unit

## Format frontend/config files with pre-commit
format:
	pre-commit run --all-files

## Run PHP_CodeSniffer (PSR-12 gate, same as CI)
phpcs:
	@mkdir -p dev/stubs
	@test -f dev/stubs/phpcs.phar || curl -sSfL --retry 3 --retry-connrefused --max-time 30 https://github.com/PHPCSStandards/PHP_CodeSniffer/releases/download/4.0.1/phpcs.phar -o dev/stubs/phpcs.phar
	docker run --rm -v "$(CURDIR)":/app -w /app php:8.3-cli php dev/stubs/phpcs.phar

## Run PHPStan (level 2 + baseline, same as CI)
# Stub SHAs pinned below must match .github/workflows/static-analysis.yaml —
# bump both together, deliberately, alongside a baseline regen.
phpstan:
	@mkdir -p dev/stubs
	@test -f dev/stubs/phpstan.phar || curl -sSfL --retry 3 --retry-connrefused --max-time 30 https://github.com/phpstan/phpstan/releases/download/2.2.5/phpstan.phar -o dev/stubs/phpstan.phar
	@test -f dev/stubs/wordpress-stubs.php || curl -sSfL --retry 3 --retry-connrefused --max-time 30 https://raw.githubusercontent.com/php-stubs/wordpress-stubs/04ebb2e841429038322c92043154a0ff5641e3c9/wordpress-stubs.php -o dev/stubs/wordpress-stubs.php
	@test -f dev/stubs/woocommerce-stubs.php || curl -sSfL --retry 3 --retry-connrefused --max-time 30 https://raw.githubusercontent.com/php-stubs/woocommerce-stubs/8e52e5bfbcd0f5cb65a8bec696761867e3096ab7/woocommerce-stubs.php -o dev/stubs/woocommerce-stubs.php
	docker run --rm -v "$(CURDIR)":/app -w /app php:8.3-cli php dev/stubs/phpstan.phar analyse --no-progress --memory-limit=4G

## Create a versioned zip archive
archive:
	git archive --format zip HEAD > tillit-payment-gateway.zip
bumpver-%:
	@if [ "$$(git rev-parse --abbrev-ref HEAD)" != "main" ]; then \
		echo "Error: Version bumping is only allowed on the main branch. Current branch: $$(git rev-parse --abbrev-ref HEAD)"; \
		exit 1; \
	fi
	@if ! command -v gh >/dev/null 2>&1; then \
		echo "Error: gh (GitHub CLI) is not installed or not in PATH"; \
		exit 1; \
	fi
	SKIP=commit-msg bumpver update --$*
	gh release create --latest --generate-notes
## Bump patch version (main branch only)
patch: bumpver-patch
## Bump minor version (main branch only)
minor: bumpver-minor
## Bump major version (main branch only)
major: bumpver-major

e2e-install:
	cd tests/e2e && npm install && npx playwright install chromium

e2e-test:
	cd tests/e2e && npx playwright test

e2e-test-headed:
	cd tests/e2e && npx playwright test --headed
