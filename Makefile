# Local dev — see README "Set up Wordpress for local development".
# Copy .env.example to .env first; docker compose reads it natively.

run:
	docker compose up -d

install: run
	@echo "First provision runs in the wpcli container (~90s):"
	@echo "  make logs-wpcli   # watch progress"

configure:
	docker compose exec -T wpcli bash /opt/tillit-payment-gateway/dev/configure

logs:
	docker compose logs -f wordpress

logs-wpcli:
	docker compose logs -f wpcli

stop:
	docker compose down

clean:
	docker compose down -v
	rm -rf volumes/

test-unit:
	docker run --rm -v "$(CURDIR)":/app -w /app php:8.2-cli php tests/unit/run.php

test: test-unit

format:
	pre-commit run --all-files

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
patch: bumpver-patch
minor: bumpver-minor
major: bumpver-major

e2e-install:
	cd tests/e2e && npm install && npx playwright install chromium

e2e-test:
	cd tests/e2e && npx playwright test

e2e-test-headed:
	cd tests/e2e && npx playwright test --headed
