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
