jQuery(function ($) {
  function toggleChildrenFields(parentRadio, childrenRadios) {
    if (!parentRadio.prop("checked")) {
      childrenRadios.prop("checked", false);
      childrenRadios.attr("disabled", true);
    } else {
      childrenRadios.prop("checked", true);
      childrenRadios.attr("disabled", false);
    }
  }

  $("body").on("click", ".woocommerce-twoinc-logo", function (e) {
    e.preventDefault();

    const $button = $(this),
      custom_uploader = wp
        .media({
          title: "Insert image",
          library: {
            type: "image"
          },
          button: {
            text: "Use this image"
          },
          multiple: false
        })
        .on("select", function () {
          const attachment = custom_uploader.state().get("selection").first().toJSON();

          const $context = $button.parent();
          let $image = $context.find(".image-container");

          $image.empty();
          $context.find(".logo_id").val(attachment.id).change().blur();
          $image.append('<img src="' + attachment.url + '">');
        })
        .open();
  });

  $("body").on(
    "change",
    "#woocommerce_woocommerce-gateway-tillit_enable_company_search",
    function (e) {
      toggleChildrenFields(
        $(this),
        $("#woocommerce_woocommerce-gateway-tillit_enable_company_search_for_others")
      );
      toggleChildrenFields(
        $(this),
        $("#woocommerce_woocommerce-gateway-tillit_enable_address_lookup")
      );
    }
  );

  jQuery("[id*='woocommerce-gateway-tillit'].wc-settings-sub-title").append(
    '<a href="#" class="collapsed setting-dropdown"><span class="dashicons dashicons-arrow-down-alt2"></span></a>'
  );
  jQuery("h3.wc-settings-sub-title a").click(function (e) {
    e.preventDefault();

    if ($(this).hasClass("collapsed")) {
      $(this).parent().next().show();
      $(this).removeClass("collapsed");
      $(this).html('<span class="dashicons dashicons-arrow-up-alt2"></span>');
    } else {
      $(this).parent().next().hide();
      $(this).addClass("collapsed");
      $(this).html('<span class="dashicons dashicons-arrow-down-alt2"></span>');
    }
  });
  jQuery("h3.wc-settings-sub-title, p.submit").before('<hr class="setting-separator" />');

  jQuery("h3.wc-settings-sub-title").next().hide();

  toggleChildrenFields(
    $("#woocommerce_woocommerce-gateway-tillit_enable_company_search"),
    $("#woocommerce_woocommerce-gateway-tillit_enable_company_search_for_others")
  );
  toggleChildrenFields(
    $("#woocommerce_woocommerce-gateway-tillit_enable_company_search"),
    $("#woocommerce_woocommerce-gateway-tillit_enable_address_lookup")
  );

  // API Key verification functionality
  let verificationTimeout;
  const $apiKeyField = $("#woocommerce_woocommerce-gateway-tillit_api_key");
  const $verificationIcon = $("#api-key-verification-icon");
  const $validIcon = $("#api-key-valid");
  const $invalidIcon = $("#api-key-invalid");
  const $loadingIcon = $("#api-key-loading");

  function showVerificationStatus(status) {
    $verificationIcon.show();
    $validIcon.hide();
    $invalidIcon.hide();
    $loadingIcon.hide();

    if (status === "valid") {
      $validIcon.show();
    } else if (status === "invalid") {
      $invalidIcon.show();
    } else if (status === "loading") {
      $loadingIcon.show();
    }
  }

  function verifyApiKey(apiKey) {
    if (!apiKey || apiKey.length < 10) {
      $verificationIcon.hide();
      return;
    }

    showVerificationStatus("loading");

    $.ajax({
      url: twoinc_admin.ajax_url,
      type: "POST",
      data: {
        action: "twoinc_verify_api_key",
        api_key: apiKey,
        nonce: twoinc_admin.nonce
      },
      success: function (response) {
        if (response.success) {
          showVerificationStatus("valid");
        } else {
          showVerificationStatus("invalid");
        }
      },
      error: function () {
        showVerificationStatus("invalid");
      }
    });
  }

  // Verify API key on input change with debouncing
  $apiKeyField.on("input", function () {
    const apiKey = $(this).val();

    clearTimeout(verificationTimeout);
    verificationTimeout = setTimeout(function () {
      verifyApiKey(apiKey);
    }, 1000); // Wait 1 second after user stops typing
  });

  // Verify on page load if API key exists
  if ($apiKeyField.val()) {
    verifyApiKey($apiKeyField.val());
  }
});
