archive:
	git archive --format zip HEAD > tillit-payment-gateway.zip
mo:
	for l in en nb_NO sv_SE nl_NL; do make mo-$$l; done
mo-%:
	msgcat languages/twoinc-payment-gateway-$*.po | msgfmt -o languages/twoinc-payment-gateway-$*.mo -
