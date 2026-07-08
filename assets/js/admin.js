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
    "#woocommerce_" + twoinc_admin.gateway_id + "_enable_company_search",
    function (e) {
      toggleChildrenFields(
        $(this),
        $("#woocommerce_" + twoinc_admin.gateway_id + "_enable_company_search_for_others")
      );
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
    $("#woocommerce_" + twoinc_admin.gateway_id + "_enable_company_search_for_others")
  );
  toggleChildrenFields(
    $("#woocommerce_" + twoinc_admin.gateway_id + "_enable_company_search"),
    $("#woocommerce_" + twoinc_admin.gateway_id + "_enable_address_lookup")
  );

  // API Key verification functionality
  let verificationTimeout;
  const $apiKeyField = $("#woocommerce_" + twoinc_admin.gateway_id + "_api_key");
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
          updateMerchantInfo(response.data);
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

    function customDay() {
      const c = parseInt($customDays.val(), 10);
      return c > 0 ? c : 0;
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

    // Offered set: ticked checkboxes ∪ custom day (feeds the default dropdown).
    function offeredTerms() {
      const terms = [];
      $checkboxes.filter(":checked").each(function () {
        const n = parseInt($(this).val(), 10);
        if (n > 0) terms.push(n);
      });
      const c = customDay();
      if (c > 0) terms.push(c);
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
          nonce: twoinc_admin.nonce,
          terms: JSON.stringify(terms)
        }
      })
        .done(function (response) {
          if (!response || !response.success || !response.data || !response.data.fees) {
            return; // leave spans empty
          }
          const fees = response.data.fees;
          const currency = String(response.data.currency || "")
            .toUpperCase()
            .trim();
          const suffix = currency !== "" ? " " + currency : "";
          $container.find(".twoinc-term-fee").each(function () {
            const $span = $(this);
            const term = String($span.data("term"));
            const fee = fees[term];
            if (!fee) {
              $span.text("");
              return;
            }
            const pct = parseFloat(fee.percentage || 0);
            const fixed = parseFloat(fee.fixed || 0);
            const pctZero = pct === 0;
            const fixedZero = fixed === 0;
            // Without an API-supplied currency a fixed amount is ambiguous —
            // drop it; a percentage carries its own unit and can stand alone.
            if (currency === "") {
              $span.text(pctZero ? "" : " (" + formatAmount(pct) + "%)");
              return;
            }
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
          // Allow a retry on the same term-set and clear half-populated spans.
          lastFeesKey = null;
          $container.find(".twoinc-term-fee").text("");
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
      // ticked presets ∩ merchant-offered, then UNION the custom day — a
      // custom term is offered at checkout even when it sits outside the
      // backend's preset list, so its surcharge row must stay editable.
      const merchant = (twoinc_admin.merchant_available_terms || []).map(Number);
      const ticked = [];
      $checkboxes.filter(":checked").each(function () {
        const n = parseInt($(this).val(), 10);
        if (n > 0 && merchant.indexOf(n) !== -1) ticked.push(n);
      });
      const c = customDay();
      if (c > 0) ticked.push(c);
      return uniqueSorted(ticked);
    }

    function buildGridRow(fieldKey, days) {
      // Re-created rows carry the SAVED values: the validator wipes a
      // rendered-and-blank row on save, so an empty re-created row would
      // silently clear a stored term's surcharge on untick+retick.
      const stored = (twoinc_admin.surcharge_grid || {})[days] || {};
      const cell = function (col) {
        return $("<td></td>")
          .addClass("twoinc-col-" + col)
          .append(
            $('<input type="text" style="width:90px" />')
              .attr("name", fieldKey + "[" + days + "][" + col + "]")
              .val(stored[col] || "")
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
      // Insert missing rows in day order.
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
      // Cap bounds the percentage portion — follows the percentage column.
      $grid.find(".twoinc-col-limit").toggle(showPct);
      // No surcharge method: the whole grid row is noise.
      $(".twoinc-surcharge-grid-field").toggle(type !== "none");
    }

    function onTermsChanged() {
      rebuildDefaultTerm();
      loadFees();
      updateGridRows();
    }

    $checkboxes.on("change", onTermsChanged);
    $customDays.on("change keyup", onTermsChanged);
    $surchargeType.on("change", updateGridColumns);

    rebuildDefaultTerm();
    loadFees();
    updateGridRows();
  })();
});
