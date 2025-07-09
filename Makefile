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
