tag:
	eval $$(bumpver show --environ) && git tag abn-$${CURRENT_VERSION} -f && git push origin abn-$${CURRENT_VERSION} -f && git push -f
archive:
	eval $$(bumpver show --environ) && mkdir -p artifacts/$${CURRENT_VERSION} && git archive --format zip HEAD > artifacts/$${CURRENT_VERSION}/abn-payment-gateway.zip
publish: archive
	gsutil cp -r artifacts/* gs://achteraf-betalen/woocommerce/ && ./scripts/publish-to-bucket.py
