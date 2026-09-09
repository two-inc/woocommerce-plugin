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

  // ── Custom request headers table ────────────────────────────────────
  // Row indices are only a POST grouping key, so a removed row leaves a gap
  // rather than forcing a renumber; validate_two_custom_headers_field()
  // re-indexes on save.
  $("body").on("click", ".twoinc-custom-header-add", function (e) {
    e.preventDefault();
    const $table = $(this).closest("td").find(".twoinc-custom-headers");
    const fieldKey = $table.data("field-key");
    const index = Date.now();
    $table
      .find("tbody")
      .append(
        '<tr class="twoinc-custom-header-row">' +
          '<td><input type="text" class="input-text regular-input" name="' +
          fieldKey +
          "[" +
          index +
          '][name]" value="" placeholder="X-WAF-TOKEN" /></td>' +
          '<td><input type="text" class="input-text regular-input" name="' +
          fieldKey +
          "[" +
          index +
          '][value]" value="" /></td>' +
          '<td><input type="checkbox" name="' +
          fieldKey +
          "[" +
          index +
          '][send_from_browser]" value="1" /></td>' +
          '<td><button type="button" class="button twoinc-custom-header-remove">' +
          twoinc_admin.i18n_remove +
          "</button></td>" +
          "</tr>"
      );
  });

  $("body").on("click", ".twoinc-custom-header-remove", function (e) {
    e.preventDefault();
    $(this).closest("tr.twoinc-custom-header-row").remove();
  });

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
    "#woocommerce_" + twoinc_admin.gateway_id + "_enable_company_search",
    function (e) {
      toggleChildrenFields(
        $(this),
        $("#woocommerce_" + twoinc_admin.gateway_id + "_enable_address_lookup")
      );
    }
  );

  jQuery("[id*='" + twoinc_admin.gateway_id + "'].wc-settings-sub-title").append(
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
    $("#woocommerce_" + twoinc_admin.gateway_id + "_enable_company_search"),
    $("#woocommerce_" + twoinc_admin.gateway_id + "_enable_address_lookup")
  );

  let verificationTimeout;
  const $apiKeyField = $("#woocommerce_" + twoinc_admin.gateway_id + "_api_key");
  const $verificationIcon = $("#api-key-verification-icon");
  const $validIcon = $("#api-key-valid");
  const $invalidIcon = $("#api-key-invalid");
  const $loadingIcon = $("#api-key-loading");

  // The last verdict that judged the key, and the key it judged — an
  // inconclusive verdict restores that indicator rather than inventing a red
  // cross, but only while the field still holds the key it applied to.
  let lastDefinitiveStatus = null;
  let lastDefinitiveKey = null;

  function indicatorForUnjudgedKey(apiKey) {
    return apiKey === lastDefinitiveKey ? lastDefinitiveStatus : null;
  }

  function showVerificationStatus(status) {
    $validIcon.hide();
    $invalidIcon.hide();
    $loadingIcon.hide();

    if (!status) {
      $verificationIcon.hide();
      return;
    }
    $verificationIcon.show();

    if (status === "valid") {
      $validIcon.show();
    } else if (status === "invalid") {
      $invalidIcon.show();
    } else if (status === "loading") {
      $loadingIcon.show();
    }
  }

  // Refresh the displayed Merchant ID + short name from a verify response,
  // so a key change reflects immediately without saving/reloading.
  function updateMerchantInfo(data) {
    if (!data || !data.merchant_id) {
      return;
    }
    $("#twoinc-merchant-id").text(data.merchant_id);
    const shortName = data.merchant_short_name || "";
    $("#twoinc-merchant-short-name").text(shortName ? " · " + shortName : "");
    $("#twoinc-merchant-info").show();
    $("#twoinc-signup-prompt").hide();
    $("#twoinc-merchant-invalid-notice").removeClass("twoinc-merchant-notice--unconfirmed").hide();
  }

  // Maps the categorized failure the AJAX handler reports (see
  // WC_Twoinc::categorize_verification_result()) to admin-facing text — no
  // raw response body/content, just enough to tell "my key is wrong" apart
  // from "Two's API is down" (TWO-25326 follow-up: today's incident showed
  // every non-200 response, 5xx and network failures included, displayed
  // identically as "API key is invalid").
  function invalidNoticeText(status, code) {
    // Translated, brand-resolved per-category text comes from PHP via
    // wp_localize_script (mirrors the days_label pattern above) — see
    // WC_Twoinc::get_api_key_notices(), which is where the product name is
    // interpolated from WC_Twoinc_Brand. The literals here are only the
    // fallback if that data didn't arrive, so they must stay brand-neutral:
    // this file ships unchanged to brand overlays, and a hardcoded product
    // name here would show the wrong brand in an overlay's admin.
    const notices = twoinc_admin.api_key_notices || {};
    switch (status) {
      case "invalid_key":
        return notices.invalid_key || "This API key is invalid or has expired.";
      case "service_error":
        return (
          notices.service_error ||
          "The payment API returned a service error (HTTP %s). This is likely temporary on the provider's side — try again shortly."
        ).replace(/%s/g, code);
      case "unreachable":
        return (
          notices.unreachable ||
          "Could not reach the payment API (network or connectivity error). Try again shortly."
        );
      case "not_configured":
        return notices.not_configured || "Enter an API key above to enable this payment method.";
      case "request_failed":
        // The AJAX request to this site's admin-ajax.php failed before Two
        // was ever contacted (jQuery's error callback fires on any
        // transport-level failure — a WordPress-side 500, an expired
        // security token, a proxy/WAF block — not specifically "Two is
        // unreachable"), so the "unreachable" wording would wrongly point
        // an admin at Two for a WP-side problem.
        return notices.request_failed || "Could not complete verification — try again shortly.";
      default:
        return code
          ? (
              notices.unexpected_response ||
              "The payment API returned an unexpected response (HTTP %s)."
            ).replace(/%s/g, code)
          : notices.unverified || "This API key could not be verified.";
    }
  }

  // A key the API actually rejected must not leave the previously fetched
  // Merchant ID on screen — that reads as "the integration is fine" when it
  // isn't. Swap it for the categorized notice instead.
  function showMerchantInfoRejected(status, code) {
    $("#twoinc-merchant-info").hide();
    $("#twoinc-signup-prompt").hide();
    $("#twoinc-merchant-invalid-notice")
      .removeClass("twoinc-merchant-notice--unconfirmed")
      .text(invalidNoticeText(status, code))
      .show();
  }

  // A verdict that judged nothing about the key: say the check did not
  // complete, and leave the Merchant ID and the signup prompt where they are.
  function showMerchantInfoUnconfirmed(status, code) {
    $("#twoinc-merchant-invalid-notice")
      .addClass("twoinc-merchant-notice--unconfirmed")
      .text(invalidNoticeText(status, code))
      .show();
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
        csrf_token: twoinc_admin.csrf_token
      },
      success: function (response) {
        if (response.success) {
          lastDefinitiveStatus = "valid";
          lastDefinitiveKey = apiKey;
          showVerificationStatus("valid");
          updateMerchantInfo(response.data);
          return;
        }
        // Whether the verdict judged the KEY is decided server-side, where the
        // categories are defined once; anything else judged nothing about it
        // and must leave the Merchant ID and key status alone (ABN-536).
        const data = response.data || {};
        if (!data.definitive) {
          showVerificationStatus(indicatorForUnjudgedKey(apiKey));
          showMerchantInfoUnconfirmed(data.status, data.code);
          return;
        }
        lastDefinitiveStatus = "invalid";
        lastDefinitiveKey = apiKey;
        showVerificationStatus("invalid");
        showMerchantInfoRejected(data.status, data.code);
      },
      error: function () {
        showVerificationStatus(indicatorForUnjudgedKey(apiKey));
        showMerchantInfoUnconfirmed("request_failed", null);
      }
    });
  }

  $apiKeyField.on("input", function () {
    const apiKey = $(this).val();

    clearTimeout(verificationTimeout);
    verificationTimeout = setTimeout(function () {
      verifyApiKey(apiKey);
    }, 1000);
  });

  // Blur fires the check immediately rather than waiting out the debounce —
  // a paste-then-tab-away must not leave the field unverified for up to a
  // second while the merchant is already looking at Save.
  $apiKeyField.on("blur", function () {
    clearTimeout(verificationTimeout);
    verifyApiKey($(this).val());
  });

  if ($apiKeyField.val()) {
    verifyApiKey($apiKeyField.val());
  }

  // ── Payment terms config (mirrors Magento payment-terms-config.js) ──────
  //
  // (A) Keep the "Default Payment Term" dropdown in sync with the offered
  //     set (ticked checkboxes ∪ custom day) live, before save.
  // (B) Render the merchant's per-term pricing rate beside each checkbox.
  (function initPaymentTermsConfig() {
    const prefix = "woocommerce_" + twoinc_admin.gateway_id + "_";
    const $container = $(".twoinc-term-checkboxes").first();
    if ($container.length === 0) {
      return;
    }
    const $checkboxes = $container.find(".twoinc-term-checkbox");
    const $customDays = $("#" + prefix + "payment_terms_custom_days");
    const $defaultTerm = $("#" + prefix + "default_payment_term");
    const daysLabel = twoinc_admin.days_label || "%s days";

    // Same rule as WC_Twoinc_Stored_Term::days(), the server's one reading of the stored value.
    function customDay() {
      const raw = String($customDays.val() == null ? "" : $customDays.val()).trim();
      return /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : 0;
    }

    function uniqueSorted(arr) {
      return arr
        .filter(function (v, i, a) {
          return a.indexOf(v) === i;
        })
        .sort(function (a, b) {
          return a - b;
        });
    }

    // An unresolved offered set is unknown, so it narrows nothing (ABN-521).
    function merchantOffers(n) {
      const merchant = (twoinc_admin.merchant_available_terms || []).map(Number);
      return merchant.length === 0 || merchant.indexOf(n) !== -1;
    }

    // Offered set: ticked checkboxes plus an offered custom day (feeds the default dropdown).
    function offeredTerms() {
      const terms = [];
      $checkboxes.filter(":checked").each(function () {
        const n = parseInt($(this).val(), 10);
        if (n > 0) terms.push(n);
      });
      const c = customDay();
      if (c > 0 && merchantOffers(c)) terms.push(c);
      return uniqueSorted(terms);
    }

    // ── (A) Default Payment Term dropdown ─────────────────────────────────
    function rebuildDefaultTerm() {
      if ($defaultTerm.length === 0) return;
      const terms = offeredTerms();
      const current = parseInt($defaultTerm.val(), 10) || 0;
      $defaultTerm.empty();
      $.each(terms, function (_, days) {
        $defaultTerm.append(
          $("<option></option>").attr("value", days).text(daysLabel.replace("%s", days))
        );
      });
      if (terms.indexOf(current) !== -1) {
        $defaultTerm.val(current);
      } else if (terms.length) {
        $defaultTerm.val(terms[0]);
      }
    }

    // ── (B) Inline merchant-rate fees ─────────────────────────────────────
    let lastFeesKey = null;

    function formatAmount(n) {
      const s = Number(n).toFixed(2);
      const sep = String(twoinc_admin.decimal_separator || ".");
      return sep === "." ? s : s.replace(".", sep);
    }

    // An empty span reads as "no fee for this term", so a term the answer did
    // not price says so instead (ABN-540).
    function noFigureLabel() {
      return " (" + (twoinc_admin.i18n_no_fee_figure || "no figure") + ")";
    }

    function markFeesUnavailable() {
      $container.find(".twoinc-term-fee").text(noFigureLabel());
    }

    function loadFees() {
      if (!$container.data("fees")) {
        return; // brand opted out of inline fees
      }
      // Fees show beside EVERY checkbox regardless of checked state, plus the
      // custom day if set (mirrors Magento's loadFees).
      let terms = $checkboxes
        .map(function () {
          return parseInt(this.value, 10);
        })
        .get()
        .filter(function (n) {
          return n > 0;
        });
      const c = customDay();
      if (c > 0 && terms.indexOf(c) === -1) terms.push(c);
      terms = uniqueSorted(terms);
      if (!terms.length) return;

      const key = terms.join(",");
      if (key === lastFeesKey) return;
      lastFeesKey = key;

      $.ajax({
        url: twoinc_admin.ajax_url,
        type: "POST",
        dataType: "json",
        data: {
          action: "twoinc_term_fees",
          csrf_token: twoinc_admin.csrf_token,
          terms: JSON.stringify(terms)
        }
      })
        .done(function (response) {
          if (!response || !response.success || !response.data || !response.data.fees) {
            lastFeesKey = null;
            markFeesUnavailable();
            return;
          }
          const fees = response.data.fees;
          // Currency comes from the answer, never guessed: the fee values are
          // its too. A set without one is refused server-side, and a unitless
          // amount reads as a percentage, so it is labelled rather than drawn.
          const currency = String(response.data.currency || "")
            .toUpperCase()
            .trim();
          if (currency === "") {
            lastFeesKey = null;
            markFeesUnavailable();
            return;
          }
          const suffix = " " + currency;
          $container.find(".twoinc-term-fee").each(function () {
            const $span = $(this);
            const term = String($span.data("term"));
            const fee = fees[term];
            if (!fee) {
              $span.text(noFigureLabel());
              return;
            }
            const pct = parseFloat(fee.percentage || 0);
            const fixed = parseFloat(fee.fixed || 0);
            const pctZero = pct === 0;
            const fixedZero = fixed === 0;
            let inner;
            if (pctZero && fixedZero) {
              inner = formatAmount(0) + suffix;
            } else if (pctZero) {
              inner = formatAmount(fixed) + suffix;
            } else if (fixedZero) {
              inner = formatAmount(pct) + "%";
            } else {
              inner = formatAmount(pct) + "% + " + formatAmount(fixed) + suffix;
            }
            $span.text(" (" + inner + ")");
          });
        })
        .fail(function () {
          // Allow a retry on the same term-set.
          lastFeesKey = null;
          markFeesUnavailable();
        });
    }

    // ── (C) Live surcharge grid (mirrors Magento's surcharge-grid.js) ────
    // Rows follow ticked terms ∩ merchant-offered terms without a save;
    // column visibility follows the surcharge method. Server render is the
    // template contract: <tr data-days> with inputs named
    // <field_key>[<days>][fixed|percentage|limit] and twoinc-col-* classes.
    const $grid = $(".twoinc-surcharge-grid").first();
    const $gridEmpty = $(".twoinc-surcharge-grid-empty").first();
    const $surchargeType = $("#" + prefix + "surcharge_type");

    function gridTerms() {
      // Mirror the PHP render (WC_Twoinc_Payment_Terms::get_available_terms):
      // ticked presets and the custom day, both narrowed to the merchant-offered set.
      const merchant = (twoinc_admin.merchant_available_terms || []).map(Number);
      const ticked = [];
      $checkboxes.filter(":checked").each(function () {
        const n = parseInt($(this).val(), 10);
        if (n > 0 && merchant.indexOf(n) !== -1) ticked.push(n);
      });
      const c = customDay();
      if (c > 0 && merchantOffers(c)) ticked.push(c);
      return uniqueSorted(ticked);
    }

    function buildGridRow(fieldKey, days) {
      // Re-created rows carry the SAVED values: the validator wipes a
      // rendered-and-blank row on save, so an empty re-created row would
      // silently clear a stored term's surcharge on untick+retick.
      const stored = (twoinc_admin.surcharge_grid || {})[days] || {};
      const cell = function (col) {
        // PRESENCE, not truthiness (isset(), matching the PHP renderer): a
        // stored numeric 0 cap is falsy in JS but a real "no cap" value —
        // `stored[col] || ""` would blank it and relay the surcharge uncapped.
        const raw = stored[col];
        return $("<td></td>")
          .addClass("twoinc-col-" + col)
          .append(
            $('<input type="text" style="width:90px" />')
              .attr("name", fieldKey + "[" + days + "][" + col + "]")
              .val(raw === undefined || raw === null ? "" : String(raw))
          );
      };
      return $("<tr></tr>")
        .attr("data-days", days)
        .append($("<td></td>").text(days))
        .append(cell("fixed"))
        .append(cell("percentage"))
        .append(cell("limit"));
    }

    function updateGridRows() {
      if ($grid.length === 0) return;
      const fieldKey = $grid.data("field-key");
      const terms = gridTerms();
      const $tbody = $grid.find("tbody");
      // Drop rows for un-ticked terms. Their SAVED values survive (the
      // validator preserves rows absent from the POST); only unsaved
      // edits in the removed row are lost.
      $tbody.find("tr").each(function () {
        if (terms.indexOf(Number($(this).attr("data-days"))) === -1) {
          $(this).remove();
        }
      });
      jQuery.each(terms, function (_, days) {
        if ($tbody.find('tr[data-days="' + days + '"]').length) return;
        const $row = buildGridRow(fieldKey, days);
        let $before = null;
        $tbody.find("tr").each(function () {
          if ($before === null && Number($(this).attr("data-days")) > days) {
            $before = $(this);
          }
        });
        if ($before) {
          $row.insertBefore($before);
        } else {
          $tbody.append($row);
        }
      });
      $grid.toggle(terms.length > 0);
      $gridEmpty.toggle(terms.length === 0);
      updateGridColumns();
    }

    function updateGridColumns() {
      if ($grid.length === 0) return;
      const type = $surchargeType.val() || "none";
      const showFixed = type === "fixed" || type === "fixed_and_percentage";
      const showPct = type === "percentage" || type === "fixed_and_percentage";
      $grid.find(".twoinc-col-fixed").toggle(showFixed);
      $grid.find(".twoinc-col-percentage").toggle(showPct);
      // The cap bounds the WHOLE fee line item, not the percentage portion
      // (TWO-25269). The column is nonetheless offered only alongside a
      // percentage method, which is where a cap is actually useful.
      $grid.find(".twoinc-col-limit").toggle(showPct);
      // No surcharge method: the whole grid row is noise.
      $(".twoinc-surcharge-grid-field").toggle(type !== "none");
      // Help text below the grid follows the surcharge method, exactly as
      // Magento's surcharge-grid.js switches its .surcharge-grid__helper-
      // text--<type> paragraphs. Only one is ever visible; "none" shows
      // none of them (the whole field row is hidden anyway).
      $(".twoinc-surcharge-grid-help").hide();
      $(".twoinc-surcharge-grid-help--" + type).show();
    }

    // ── Surcharge tax treatment/class visibility ─────────────────────
    // Both rows follow the surcharge method (no surcharge → no tax
    // question); the class dropdown additionally follows the treatment
    // (only "Specific tax class" needs it). Selection changes mirror
    // without a save; the stored values are untouched until Save.
    const $taxTreatment = $("#" + prefix + "surcharge_tax_treatment");
    const $taxClass = $("#" + prefix + "surcharge_tax_class");

    function updateTaxFields() {
      const type = $surchargeType.val() || "none";
      const treatment = $taxTreatment.val() || "standard";
      $taxTreatment.closest("tr").toggle(type !== "none");
      $taxClass.closest("tr").toggle(type !== "none" && treatment === "custom_class");
    }

    // ── Surcharge basis/description/rounding visibility ──────────────
    // These rows are only meaningful once a surcharge method is chosen;
    // no surcharge → they're noise, same rationale as updateTaxFields above.
    const $surchargeDifferential = $("#" + prefix + "surcharge_differential");
    const $surchargeLineDescription = $("#" + prefix + "surcharge_line_description");
    const $surchargeRoundingBasis = $("#" + prefix + "surcharge_rounding_basis");
    const $surchargeRoundingStep = $("#" + prefix + "surcharge_rounding_step");

    function updateSurchargeOptionFields() {
      const type = $surchargeType.val() || "none";
      const visible = type !== "none";
      $surchargeDifferential.closest("tr").toggle(visible);
      $surchargeLineDescription.closest("tr").toggle(visible);
      $surchargeRoundingBasis.closest("tr").toggle(visible);
    }

    // Rounding Step depends on both the Rounding Basis row being shown
    // AND that row's own value not being "None".
    function updateRoundingStepVisibility() {
      const type = $surchargeType.val() || "none";
      const basis = $surchargeRoundingBasis.val() || "none";
      $surchargeRoundingStep.closest("tr").toggle(type !== "none" && basis !== "none");
    }

    function onTermsChanged() {
      rebuildDefaultTerm();
      loadFees();
      updateGridRows();
    }

    $checkboxes.on("change", onTermsChanged);
    $customDays.on("change", onTermsChanged);
    $surchargeType.on("change", updateGridColumns);
    $surchargeType.on("change", updateTaxFields);
    $surchargeType.on("change", updateSurchargeOptionFields);
    $surchargeType.on("change", updateRoundingStepVisibility);
    $taxTreatment.on("change", updateTaxFields);
    $surchargeRoundingBasis.on("change", updateRoundingStepVisibility);

    rebuildDefaultTerm();
    loadFees();
    updateGridRows();
    updateTaxFields();
    updateSurchargeOptionFields();
    updateRoundingStepVisibility();
  })();

  // ── Diagnostics: on-demand merchant-profile refresh ─────────────────────
  (function initRefreshMerchantRecord() {
    const $button = $("#twoinc-refresh-merchant-record");
    const $status = $("#twoinc-refresh-merchant-record-status");
    if (!$button.length) {
      return;
    }

    function render(colour, text) {
      $status.css("color", colour).text(text);
    }

    $button.on("click", function () {
      $button.prop("disabled", true);
      render("", twoinc_admin.i18n_refreshing);

      $.ajax({
        url: twoinc_admin.ajax_url,
        type: "POST",
        data: {
          action: "twoinc_refresh_merchant_record",
          csrf_token: twoinc_admin.csrf_token
        },
        success: function (response) {
          const data = response.data || {};
          if (response.success) {
            render("#2a7f2a", [data.message, data.merchant].filter(Boolean).join(" "));
          } else {
            render("#a94442", data.message || twoinc_admin.i18n_refresh_failed);
          }
        },
        error: function () {
          render("#a94442", twoinc_admin.i18n_refresh_failed);
        },
        complete: function () {
          $button.prop("disabled", false);
        }
      });
    });
  })();
});
