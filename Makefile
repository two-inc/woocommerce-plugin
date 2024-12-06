archive:
	git archive --format zip HEAD > tillit-payment-gateway.zip
bumpver-%:
	SKIP=commit-msg bumpver update --$*
patch: bumpver-patch
minor: bumpver-minor
major: bumpver-major
