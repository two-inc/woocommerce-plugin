let twoincUtilHelper = {
  /**
   * Check if any element in the list is null or empty
   */
  isAnyElementEmpty: function (values) {
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!v || v.length === 0) {
        return true;
      }
    }

    return false;
  },

  /**
   * Construct url to Twoinc checkout api
   */
  constructTwoincUrl: function (path, params) {
    if (!params) params = {};
    params["client"] = window.twoinc.client_name;
    params["client_v"] = window.twoinc.client_version;
    return window.twoinc.twoinc_checkout_host + path + "?" + new URLSearchParams(params).toString();
  },

  /**
   * Hash some input to store as key
   */
  getUnsecuredHash: function (inp, seed) {
    if (!seed) seed = 0;
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < inp.length; i++) {
      ch = inp.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
};

let twoincSelectWooHelper = {
  /**
   * Generate parameters for selectwoo
   */
  genSelectWooParams: function () {
    let country = jQuery("#billing_country").val();

    let twoincSearchLimit = 50;
    return {
      minimumInputLength: 3,
      width: "100%",
      escapeMarkup: function (markup) {
        return markup;
      },
      templateResult: function (data) {
        return data.html;
      },
      templateSelection: function (data) {
        return data.text;
      },
      language: {
        errorLoading: function () {
          // return wc_country_select_params.i18n_ajax_error
          // Should not show ajax error if request is cancelled
          return wc_country_select_params.i18n_searching;
        },
        inputTooShort: function (t) {
          t = t.minimum - t.input.length;
          return 1 == t
            ? wc_country_select_params.i18n_input_too_short_1
            : wc_country_select_params.i18n_input_too_short_n.replace("%qty%", t);
        },
        noResults: function () {
          return wc_country_select_params.i18n_no_matches;
        },
        searching: function () {
          return wc_country_select_params.i18n_searching;
        }
      },
      ajax: {
        dataType: "json",
        delay: 200,
        url: function (params) {
          const searchParams = new URLSearchParams({
            country: country,
            limit: twoincSearchLimit,
            offset: (params.page || 0) * twoincSearchLimit,
            q: decodeURIComponent(params.term)
          });
          return twoincUtilHelper.constructTwoincUrl("/companies/v2/company", searchParams);
        },
        data: function () {
          return {};
        },
        processResults: function (response, params) {
          const items = [];
          for (let i = 0; i < response.items.length; i++) {
            const item = response.items[i];
            items.push({
              id: item.name,
              text: item.name,
              html: item.highlight + " (" + item.national_identifier.id + ")",
              company_id: item.national_identifier.id,
              lookup_id: item.lookup_id,
              approved: false
            });
          }

          return {
            results: items,
            pagination: {
              more: false
            }
          };
        }
      }
    };
  },

  /**
   * Fix the position bug
   * https://github.com/select2/select2/issues/4614
   */
  fixSelectWooPositionCompanyName: function () {
    if (window.twoinc.enable_company_search === "yes") {
      const billingCompanyDisplay = jQuery("#billing_company_display").data("select2");

      if (billingCompanyDisplay) {
        billingCompanyDisplay.on("open", function (e) {
          this.results.clear();
          this.dropdown._positionDropdown();
        });
        billingCompanyDisplay.on("results:message", function (e) {
          this.dropdown._resizeDropdown();
          this.dropdown._positionDropdown();
        });
      }
    }
  },

  /**
   * Wait until element appear and focus
   */
  waitToFocus: function (selectWooElemId, hitsRequired, intervalDuration, callbackFunc) {
    if (isNaN(intervalDuration)) intervalDuration = 300;
    if (isNaN(hitsRequired)) hitsRequired = 2;
    let attemptsLeft = hitsRequired * 8;

    let focusInterval = setInterval(function () {
      let inpElem = jQuery('input[aria-owns="select2-' + selectWooElemId + '-results"]').get(0);
      if (inpElem) {
        // Focus on the element if not already focused
        if (inpElem != document.activeElement) inpElem.focus();
        // Mark this as a hit attempt
        hitsRequired--;
        // If reached number of required hits, do not attempt again
        if (hitsRequired <= 0) attemptsLeft = 0;
      }

      attemptsLeft--;
      if (attemptsLeft <= 0) {
        clearInterval(focusInterval);
        if (inpElem && callbackFunc) callbackFunc();
      }
    }, intervalDuration);
  },

  /**
   * Wait until element appear and focus
   */
  addSelectWooFocusFixHandler: function (selectWooElemId) {
    let billingCompanyDisplayResult = jQuery("#select2-" + selectWooElemId + "-results");

    // Ensure the element exists and the handler hasn't been added already
    if (
      billingCompanyDisplayResult.length &&
      !billingCompanyDisplayResult.attr("two-focused-handler")
    ) {
      billingCompanyDisplayResult.attr("two-focused-handler", true);

      // Create a new MutationObserver
      let observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
          for (let addedNode of mutation.addedNodes) {
            // Ensure the node has a parent and check for the correct parentNode ID
            if (
              addedNode.parentNode &&
              addedNode.parentNode.id === "select2-" + selectWooElemId + "-results"
            ) {
              twoincSelectWooHelper.waitToFocus("billing_company_display", 80, 20);
            }
          }
        });
      });

      // Observe changes to the childList of the raw DOM element
      observer.observe(billingCompanyDisplayResult[0], {
        childList: true // Monitor when child nodes are added or removed
      });
    }
  }
};

let twoincDomHelper = {
  /**
   * Add a placeholder after an input, used for moving the fields in HTML DOM
   */
  addPlaceholder: function ($el, name) {
    // Get an existing placeholder
    let $placeholder = jQuery("#twoinc-" + name + "-source");

    // Stop if we already have a placeholder
    if ($placeholder.length > 0) return;

    // Create a placeholder
    $placeholder = jQuery('<div id="twoinc-' + name + '-source" class="twoinc-source"></div>');

    // Add placeholder after element
    $placeholder.insertAfter($el);
  },

  /**
   * Move a field to Twoinc template location and leave a placeholder
   */
  moveField: function (selector, name) {
    // Get the element
    const $el = jQuery("#" + selector);

    // Add a placeholder
    twoincDomHelper.addPlaceholder($el, name);

    // Get the target
    const $target = jQuery("#twoinc-" + name + "-target");

    // Move the input
    $el.insertAfter($target);
  },

  /**
   * Move a field back to its original location
   */
  revertField: function (selector, name) {
    // Get the element
    const $el = jQuery("#" + selector);

    // Get the target
    const $source = jQuery("#twoinc-" + name + "-source");

    // Move the input
    if ($source.length > 0) {
      $el.insertAfter($source);
    }
  },

  /**
   * Move the fields to their original or Twoinc template location
   */
  positionFields: function () {
    setTimeout(function () {
      // If business account
      if (twoincDomHelper.isTwoincSelected()) {
        twoincDomHelper.moveField("billing_first_name_field", "fn");
        twoincDomHelper.moveField("billing_last_name_field", "ln");
        twoincDomHelper.moveField("billing_phone_field", "ph");
        twoincDomHelper.moveField("billing_email_field", "em");
      } else {
        twoincDomHelper.revertField("billing_first_name_field", "fn");
        twoincDomHelper.revertField("billing_last_name_field", "ln");
        twoincDomHelper.revertField("billing_phone_field", "ph");
        twoincDomHelper.revertField("billing_email_field", "em");
      }

      twoincDomHelper.toggleTooltip(
        '#billing_phone, label[for="billing_phone"]',
        window.twoinc.text.tooltip_phone
      );
      twoincDomHelper.toggleTooltip(
        '#billing_company_display_field .select2-container, label[for="billing_company_display"], #billing_company, label[for="billing_company"]',
        window.twoinc.text.tooltip_company
      );
    }, 100);
  },

  /**
   * Mark checkout inputs invalid
   */
  markFieldInvalid: function (fieldWrapperId) {
    const fieldWrapper = document.querySelector("#" + fieldWrapperId);

    if (fieldWrapper && fieldWrapper.classList) {
      fieldWrapper.classList.remove("woocommerce-validated");
      fieldWrapper.classList.add("woocommerce-invalid");
    }
  },

  /**
   * Toggle the visual cues for required fields
   */
  toggleRequiredCues: function ($targets, is_required) {
    // For each input
    $targets.find(":input").each(function () {
      // Get the input
      const $input = jQuery(this);

      // Get the input row
      const $row = $input.parents(".form-row");

      // Toggle the required property
      if (is_required) {
        $input.attr("required", true);

        // Add 'required' visual cue
        if ($row.find("label .twoinc-required, label .required").length == 0) {
          $row
            .find("label")
            .append('<abbr class="required twoinc-required" title="required">*</abbr>');
        }
        $row.find("label .optional").hide();
      } else {
        $input.attr("required", false);

        // Show the hidden optional visual cue
        $row.find("label .twoinc-required").remove();
        $row.find("label .optional").show();
      }
    });
  },

  /**
   * Toggle the custom business fields for Twoinc
   */
  toggleBusinessFields: function () {
    // Get the targets
    let allTargets = [
      ".woocommerce-company-fields",
      ".woocommerce-representative-fields",
      "#billing_phone_field",
      "#billing_company_display_field",
      "#billing_company_field",
      "#company_id_field",
      "#department_field",
      "#project_field",
      "#purchase_order_number_field",
      "#invoice_email_field"
    ];
    let requiredBusinessTargets = [];
    let visibleTargets = [
      ".woocommerce-company-fields",
      ".woocommerce-representative-fields",
      "#billing_phone_field"
    ];
    let requiredTargets = [];

    // Toggle the targets based on the account type
    const isTwoincSelected =
      twoincDomHelper.isTwoincVisible() && twoincDomHelper.isTwoincSelected();

    if (isTwoincSelected) {
      visibleTargets.push(
        "#department_field",
        "#project_field",
        "#purchase_order_number_field",
        "#invoice_email_field"
      );
      requiredTargets.push("#billing_phone_field");
      if (twoincDomHelper.isCountrySupported() && window.twoinc.enable_company_search === "yes") {
        visibleTargets.push("#billing_company_display_field");
        requiredTargets.push("#billing_company_display_field");
      } else {
        visibleTargets.push("#billing_company_field", "#company_id_field");
        requiredTargets.push("#billing_company_field", "#company_id_field");
      }
    } else {
      if (
        twoincDomHelper.isCountrySupported() &&
        window.twoinc.enable_company_search === "yes" &&
        window.twoinc.enable_company_search_for_others === "yes"
      ) {
        visibleTargets.push("#billing_company_display_field");
      } else {
        visibleTargets.push("#billing_company_field");
      }
    }

    allTargets = jQuery(allTargets.join(","));
    requiredTargets = jQuery(requiredTargets.join(","));
    visibleTargets = jQuery(visibleTargets.join(","));

    allTargets.addClass("hidden");
    visibleTargets.removeClass("hidden");

    // Toggle the required fields based on the account type
    twoincDomHelper.toggleRequiredCues(allTargets, false);
    twoincDomHelper.toggleRequiredCues(requiredTargets, isTwoincSelected);
  },

  /**
   * Deselect payment method and select the first available one
   */
  deselectPaymentMethod: function () {
    const paymentMethodRadioObj = jQuery(':input[value="' + window.twoinc.gateway_id + '"]');
    // Deselect the current payment method
    if (paymentMethodRadioObj) {
      paymentMethodRadioObj.prop("checked", false);
    }
  },

  /**
   * Toggle the tooltip for input fields
   */
  toggleTooltip: function (selectorStr, tooltip) {
    if (window.twoinc.display_tooltips !== "yes") return;

    jQuery(selectorStr).each(function () {
      if (twoincDomHelper.isTwoincSelected()) {
        if (!jQuery(this).attr("original-title") && tooltip !== jQuery(this).attr("title")) {
          jQuery(this).attr("original-title", jQuery(this).attr("title"));
        }
        jQuery(this).attr("title", tooltip);
      } else {
        jQuery(this).attr("title", jQuery(this).attr("original-title"));
        jQuery(this).attr("original-title", "");
      }
    });
  },

  /**
   * Toggle payment text in subtitle and description
   */
  togglePaySubtitleDesc: function (action, errSelector) {
    jQuery(".twoinc-pay-box").addClass("hidden");
    jQuery(".twoinc-pay-box.twoinc-explainer").removeClass("hidden");
    if (["checking-intent", "intent-approved", "errored"].includes(action)) {
      jQuery(".twoinc-pay-box.twoinc-explainer").addClass("hidden");
      if (action === "checking-intent") {
        jQuery(".twoinc-pay-box.twoinc-loader").removeClass("hidden");
      } else if (action === "intent-approved") {
        jQuery(".twoinc-pay-box.twoinc-intent-approved").removeClass("hidden");
      } else if (action === "errored") {
        jQuery(".twoinc-pay-box" + errSelector).removeClass("hidden");
      }
    }
  },

  /**
   * Get company name string
   */
  getCompanyName: function () {
    if (window.twoinc.enable_company_search === "yes") {
      let companyNameObj = twoincDomHelper.getCheckoutInput(
        "SPAN",
        "select",
        "select2-billing_company_display-container"
      );
      if (companyNameObj) {
        return companyNameObj.val;
      }
    } else {
      return jQuery("#billing_company").val();
    }

    return "";
  },

  /**
   * Get company data from current HTML inputs
   */
  getCompanyData: function () {
    return {
      company_name: twoincDomHelper.getCompanyName(),
      country_prefix: jQuery("#billing_country").val(),
      organization_number: jQuery("#company_id").val()
    };
  },

  /**
   * Get representative data from current HTML inputs
   */
  getRepresentativeData: function () {
    let representativeData = {};
    if (jQuery("#billing_email").val())
      representativeData["email"] = jQuery("#billing_email").val();
    if (jQuery("#billing_phone").val())
      representativeData["phone_number"] = jQuery("#billing_phone").val();
    representativeData["first_name"] = jQuery("#billing_first_name").val();
    representativeData["last_name"] = jQuery("#billing_last_name").val();
    return representativeData;
  },

  /**
   * Clear the selected selectWoo company name and id
   */
  clearSelectedCompany: function () {
    // Clear company inputs
    let billingCompanyDisplay = jQuery("#billing_company_display");
    billingCompanyDisplay.html("");
    billingCompanyDisplay.selectWoo(twoincSelectWooHelper.genSelectWooParams());
    twoincDomHelper.toggleTooltip(
      "#billing_company_display_field .select2-container",
      window.twoinc.text.tooltip_company
    );
    twoincSelectWooHelper.fixSelectWooPositionCompanyName();
    jQuery("#company_id").val("");

    // Clear the addresses, in case address get request fails
    if (window.twoinc.enable_address_lookup === "yes") {
      Twoinc.getInstance().setAddress({
        street_address: "",
        city: "",
        postal_code: ""
      });
    }

    jQuery("#select2-billing_company_display-container")
      .parent()
      .find(".select2-selection__arrow")
      .show();
    Twoinc.getInstance().customerCompany = {};
    twoincDomHelper.togglePaySubtitleDesc();

    // Update again after all elements are updated
    setTimeout(function () {
      Twoinc.getInstance().customerCompany = twoincDomHelper.getCompanyData();
      twoincDomHelper.togglePaySubtitleDesc();
    }, 3000);
  },

  /**
   * Insert the floating company id and closing button
   */
  insertFloatingCompany: function (companyId, delayInSecs) {
    if (!companyId) return;

    // Remove if exist
    jQuery(".floating-company").remove();

    let floatingCompany = jQuery(
      '<span class="floating-company">' +
        '  <span class="floating-company-id">' +
        companyId +
        "</span>" +
        '  <img src="' +
        window.twoinc.twoinc_plugin_url +
        'assets/images/x-button.svg" onclick="twoincDomHelper.clearSelectedCompany()"></img>' +
        "</span>"
    );
    floatingCompany.hide();
    floatingCompany.insertBefore("#billing_company_display");
    setTimeout(function () {
      let floatingCompany = jQuery(".floating-company");
      floatingCompany.insertBefore("#select2-billing_company_display-container");
      floatingCompany.show();
      jQuery("#select2-billing_company_display-container")
        .parent()
        .find(".select2-selection__arrow")
        .hide();
    }, delayInSecs);
  },

  /**
   * Get the company-not-in-btn, generate if not found
   */
  getCompanyNotInBtnNode: function () {
    if (jQuery("#company_not_in_btn").length) return jQuery("#company_not_in_btn");

    let companyNotInBtn = jQuery(".company_not_in_btn").clone();
    companyNotInBtn.attr("id", "company_not_in_btn");
    companyNotInBtn.removeClass("company_not_in_btn");
    return companyNotInBtn;
  },

  /**
   * Check if selected country is supported by Twoinc
   */
  isCountrySupported: function () {
    return window.twoinc.supported_buyer_countries.includes(jQuery("#billing_country").val());
  },

  /**
   * Check if twoinc payment is currently selected
   */
  isTwoincSelected: function () {
    return jQuery('input[name="payment_method"]:checked').val() === window.twoinc.gateway_id;
  },

  /**
   * Check if twoinc payment is currently visible
   */
  isTwoincVisible: function () {
    return (
      jQuery("li.wc_payment_method.payment_method_" + window.twoinc.gateway_id).css("display") !==
      "none"
    );
    //return jQuery('#payment_method_' + window.twoinc.gateway_id + ':visible').length !== 0
  },

  /**
   * Get price recursively from a DOM node
   */
  getPriceRecursively: function (node) {
    if (!node) return;
    if (node.classList && node.classList.contains("woocommerce-Price-currencySymbol")) return;
    if (node.childNodes) {
      for (let n of node.childNodes) {
        let val = twoincDomHelper.getPriceRecursively(n);
        if (val) {
          return val;
        }
      }
    }
    if (node.nodeName === "#text") {
      let val = node.textContent
        .replaceAll(window.twoinc.price_thousand_separator, "")
        .replaceAll(window.twoinc.price_decimal_separator, ".");
      if (!isNaN(val) && !isNaN(parseFloat(val))) {
        return parseFloat(val);
      }
    }
  },

  /**
   * Get price from DOM
   */
  getPrice: function (priceName) {
    let node =
      document.querySelector("." + priceName + " .woocommerce-Price-amount bdi") ||
      document.querySelector("." + priceName + " .woocommerce-Price-amount");
    return twoincDomHelper.getPriceRecursively(node);
  },

  /**
   * Rearrange descriptions in Twoinc payment to make it cleaner
   */
  rearrangeDescription: function () {
    let twoincPaymentBox = jQuery(".payment_box.payment_method_" + window.twoinc.gateway_id);
    if (twoincPaymentBox.length > 0) {
      twoincPaymentBox.after(jQuery(".abt-twoinc"));
    }
  },

  /**
   * Save checkout inputs
   */
  saveCheckoutInputs: function () {
    let checkoutInputs = [];
    let checkoutForm = document.querySelector('form[name="checkout"]');
    // if page is order-pay
    if (!checkoutForm)
      checkoutForm = document.querySelector("div.checkout.woocommerce-checkout.custom-checkout");
    // still not found
    if (!checkoutForm) return;

    for (let inp of checkoutForm.querySelectorAll('input:not([type="radio"],[type="checkbox"])')) {
      if (inp.getAttribute("id")) {
        checkoutInputs.push({
          htmlTag: inp.tagName,
          id: inp.getAttribute("id"),
          name: inp.getAttribute("name"),
          type: inp.getAttribute("type"),
          val: inp.value
        });
      }
    }
    for (let inp of checkoutForm.querySelectorAll(
      'input[type="radio"]:checked,input[type="checkbox"]:checked'
    )) {
      if (inp.getAttribute("id")) {
        checkoutInputs.push({
          htmlTag: inp.tagName,
          id: inp.getAttribute("id"),
          name: inp.getAttribute("name"),
          type: inp.getAttribute("type")
        });
      }
    }
    for (let inp of checkoutForm.querySelectorAll('span[id$="-container"]')) {
      if (inp.getAttribute("id")) {
        let textOnly = inp.textContent;
        let subs = [];
        inp.childNodes.forEach(function (val) {
          if (val.nodeType === Node.TEXT_NODE) {
            textOnly = val.nodeValue.trim();
          } else if (val.nodeType === Node.ELEMENT_NODE) {
            subs.push(val.outerHTML);
          }
        });
        checkoutInputs.push({
          htmlTag: inp.tagName,
          id: inp.getAttribute("id"),
          parentLabel: inp.parentNode.getAttribute("aria-labelledby"),
          html: inp.outerHTML,
          type: "select",
          name: inp.getAttribute("id"),
          val: textOnly,
          subs: subs
        });
      }
    }
    for (let inp of checkoutForm.querySelectorAll("select")) {
      if (inp.getAttribute("id")) {
        if (inp.querySelector('option[value="' + inp.value + '"]')) {
          checkoutInputs.push({
            htmlTag: inp.tagName,
            id: inp.getAttribute("id"),
            val: inp.value,
            optionHtml: inp.querySelector('option[value="' + inp.value + '"]').outerHTML
          });
        }
      }
    }
    sessionStorage.setItem("checkoutInputs", JSON.stringify(checkoutInputs));
  },

  /**
   * Get checkout input
   */
  getCheckoutInput: function (htmlTag, inpType, inpName) {
    let checkoutInputs = sessionStorage.getItem("checkoutInputs");
    if (!checkoutInputs) return;
    checkoutInputs = JSON.parse(checkoutInputs);
    for (let inp of checkoutInputs) {
      if (inp.htmlTag === htmlTag && inp.type === inpType && inp.name === inpName) {
        return inp;
      }
    }
  },

  /**
   * Load sessionStorage checkout inputs
   */
  loadStorageInputs: function () {
    let checkoutInputs = sessionStorage.getItem("checkoutInputs");
    if (!checkoutInputs) return;
    checkoutInputs = JSON.parse(checkoutInputs);
    for (let inp of checkoutInputs) {
      // Skip load company id/name if user logged in and has Two meta set
      if (window.twoinc.user_meta_exists) {
        let skipIds = ["company_id", "billing_company", "billing_company_display"];
        if (skipIds.includes(inp.id)) continue;
      }
      // Load all other fields
      if (inp.htmlTag === "INPUT") {
        if (inp.val && ["text", "tel", "email", "hidden"].indexOf(inp.type) >= 0) {
          if (document.querySelector("#" + inp.id) && !document.querySelector("#" + inp.id).value) {
            document.querySelector("#" + inp.id).value = inp.val;
          }
        } else if (inp.type === "radio") {
          if (document.querySelector("#" + inp.id) && inp.id != "payment_method_kco") {
            document.querySelector("#" + inp.id).click();
          }
        } else if (inp.type === "checkbox") {
          if (document.querySelector("#" + inp.id)) {
            document.querySelector("#" + inp.id).click();
          }
        }
      } else if (inp.htmlTag === "SPAN") {
        if (inp.parentLabel && inp.html) {
          if (document.querySelector("#" + inp.id)) {
            document.querySelector("#" + inp.id).remove();
          }
          let parentNode = document.querySelector('[aria-labelledby="' + inp.parentLabel + '"]');
          if (parentNode) {
            parentNode.innerHTML = inp.html + parentNode.innerHTML;
          }
          if (inp.subs && inp.subs.length > 0) {
            setTimeout(
              function (inp) {
                let elem = document.querySelector("#" + inp.id);
                if (elem) {
                  for (let sub of inp.subs) {
                    elem.innerHTML += sub;
                  }
                }
              },
              1000,
              inp
            );
          }
        }
      } else if (inp.htmlTag === "SELECT") {
        if (inp.val && inp.optionHtml) {
          let selectElem = document.querySelector("#" + inp.id);
          if (selectElem) {
            if (!selectElem.querySelector('option:not([value=""])')) {
              selectElem.innerHTML = inp.optionHtml + selectElem.innerHTML;
            }
            selectElem.value = inp.val;
          }
        }
      }
    }
  },

  /**
   * Load usermeta checkout inputs
   */
  loadUserMetaInputs: function () {
    window.twoinc.user_meta_exists = window.twoinc.billing_company && window.twoinc.company_id;
    if (document.querySelector("#billing_company_display")) {
      let selectElem = document.querySelector("#billing_company_display");
      if (!selectElem.querySelector('option:not([value=""])') && window.twoinc.user_meta_exists) {
        // Append to selectWoo
        if (!selectElem.querySelector('option[value="' + window.twoinc.billing_company + '"]')) {
          selectElem.innerHTML =
            '<option value="' +
            window.twoinc.billing_company +
            '">' +
            window.twoinc.billing_company +
            "</option>" +
            selectElem.innerHTML;
        }
        selectElem.value = window.twoinc.billing_company;

        // Append company id to company name select box
        if (window.twoinc.user_meta_exists) {
          twoincDomHelper.insertFloatingCompany(window.twoinc.company_id, 2000);
        }
      }
    }
    if (document.querySelector("#department") && window.twoinc.department) {
      document.querySelector("#department").value = window.twoinc.department;
    }
    if (document.querySelector("#project") && window.twoinc.project) {
      document.querySelector("#project").value = window.twoinc.project;
    }

    // Update the object values
    if (document.querySelector("#billing_company") && window.twoinc.billing_company) {
      document.querySelector("#billing_company").value = window.twoinc.billing_company;
    }
    if (document.querySelector("#company_id") && window.twoinc.company_id) {
      document.querySelector("#company_id").value = window.twoinc.company_id;
    }
  },

  /**
   * Get id of current or parent theme, return null if not found
   */
  getThemeBase: function () {
    if (jQuery("#webtron-css-css").length > 0) {
      return "webtron";
    } else if (jQuery("#biagiotti-mikado-default-style-css").length > 0) {
      return "biagiotti-mikado";
    } else if (jQuery("#kava-theme-style-css").length > 0) {
      return "kava";
    } else if (jQuery("#storefront-style-inline-css").length > 0) {
      return "storefront";
    } else if (jQuery("#divi-style-css").length > 0) {
      return "divi";
    } else if (jQuery("#kalium-style-css-css").length > 0) {
      return "kalium";
    } else if (jQuery("#flatsome-style-css").length > 0) {
      return "flatsome";
    } else if (jQuery("#shopkeeper-styles-css").length > 0) {
      return "shopkeeper";
    }
  },

  /**
   * Get id of current or parent theme, return null if not found
   */
  insertCustomCss: function () {
    let themeBase = twoincDomHelper.getThemeBase();
    if (themeBase) {
      jQuery("head").append(
        '<link href="' +
          window.twoinc.twoinc_plugin_url +
          "assets/css/c-" +
          themeBase +
          '.css" type="text/css" rel="stylesheet" />'
      );
    }
  }
};

/**
 * Payment terms chip selector — presentation only (TWO-24751).
 *
 * All business logic (term availability, fee quoting, selection
 * validation) lives in WC_Twoinc_Payment_Terms; this module renders the
 * data the wc-ajax endpoints return and posts the buyer's selection back.
 */
let twoincTermChips = {
  fees: {},

  config: function () {
    return (window.twoinc && window.twoinc.payment_terms) || { enabled: false };
  },

  /**
   * Re-render the chips after every checkout update (cart changes move
   * the fee quotes, so re-fetch then re-render).
   */
  refresh: function () {
    const cfg = twoincTermChips.config();
    const $container = jQuery(".twoinc-term-chips");
    if (!cfg.enabled || !cfg.terms || cfg.terms.length === 0 || $container.length === 0) {
      return;
    }
    $container.removeClass("hidden");
    twoincTermChips.render(cfg.terms, cfg.selected);

    if (cfg.offset_pricing_enabled && cfg.fees_url) {
      jQuery
        .post(cfg.fees_url, { nonce: cfg.nonce })
        .done(function (response) {
          if (response && response.success && response.data) {
            twoincTermChips.fees = response.data.fees || {};
            twoincTermChips.render(response.data.terms, response.data.selected);
          }
        })
        .fail(function () {
          // Fee labels are decorative: chips stay usable without them.
        });
    }
  },

  render: function (terms, selected) {
    const $container = jQuery(".twoinc-term-chips");
    if ($container.length === 0) return;
    $container.empty();

    const single = terms.length === 1;
    terms.forEach(function (days) {
      const isSelected = days === selected;
      const $chip = jQuery("<button>", {
        type: "button",
        class:
          "twoinc-term-chip" +
          (isSelected ? " twoinc-term-chip--selected" : "") +
          (single ? " twoinc-term-chip--single" : ""),
        role: "radio",
        "aria-checked": isSelected ? "true" : "false",
        "data-days": days,
        disabled: single
      });
      const daysLabel = (twoincTermChips.config().days_label || "%s days").replace("%s", days);
      $chip.append(jQuery("<span>", { class: "twoinc-term-chip__days", text: daysLabel }));

      const fee = twoincTermChips.fees[days];
      if (fee && parseFloat(fee.buyer_fee_share) > 0) {
        $chip.append(
          jQuery("<span>", {
            class: "twoinc-term-chip__fee",
            text: "+" + fee.buyer_fee_share + " " + fee.currency
          })
        );
      }
      if (!single) {
        $chip.on("click", function () {
          twoincTermChips.select(days);
        });
      }
      $container.append($chip);
    });

    // The selection rides the checkout form post so process_payment can
    // validate it without depending on the session.
    let $hidden = $container.find("input[name='two_selected_term']");
    if ($hidden.length === 0) {
      $hidden = jQuery("<input>", { type: "hidden", name: "two_selected_term" });
      $container.append($hidden);
    }
    $hidden.val(selected);
  },

  select: function (days) {
    const cfg = twoincTermChips.config();
    if (!cfg.select_url) return;
    jQuery
      .post(cfg.select_url, { days: days, nonce: cfg.nonce })
      .done(function (response) {
        if (response && response.success && response.data) {
          cfg.selected = response.data.selected;
          // Recalculate totals so the offset fee follows the new term;
          // updated_checkout then re-renders the chips.
          jQuery(document.body).trigger("update_checkout");
        }
      })
      .fail(function () {
        // Keep the previous selection on failure.
      });
  }
};

/**
 * Sole trader checkout — presentation only (TWO-24754).
 *
 * All business logic (country eligibility, token minting) lives in
 * WC_Twoinc_Sole_Trader; this module renders a Business / Sole trader
 * toggle, suppresses company search in sole-trader mode, opens Two's
 * hosted signup popup, and autofills the company fields from
 * GET /autofill/v1/buyer/current. Mirrors the Magento reference flow.
 */
let twoincSoleTrader = {
  mode: "business", // 'business' | 'sole_trader'
  availabilityByCountry: {},
  tokens: null,
  savedCompanySearch: null,
  messageListenerBound: false,
  // Result of the most recent autofill prefetch for the entered email.
  // ready=false until the first prefetch resolves; matches=true when the
  // buyer on the Two cookie owns the email currently typed at checkout.
  prefetched: { ready: false, buyer: null, matches: false },
  // Email the prefetch last ran for, to dedupe repeated checkout re-renders
  // (and so a pre-filled email still prefetches once on first render).
  lastPrefetchEmail: null,

  config: function () {
    return (window.twoinc && window.twoinc.sole_trader) || { enabled: false };
  },

  currentCountry: function () {
    return (jQuery("#billing_country").val() || "").toUpperCase();
  },

  enteredEmail: function () {
    return (jQuery("#billing_email").val() || "").trim();
  },

  isAvailable: function () {
    const country = twoincSoleTrader.currentCountry();
    return twoincSoleTrader.availabilityByCountry[country] === true;
  },

  /**
   * Re-evaluate the toggle after every checkout update or country change.
   * Availability is decided server-side (registry endpoint + merchant
   * toggle); responses are cached per country for the page's lifetime.
   */
  refresh: function () {
    const cfg = twoincSoleTrader.config();
    const $container = jQuery(".twoinc-sole-trader-toggle");
    if (!cfg.enabled || !cfg.availability_url || $container.length === 0) {
      twoincSoleTrader.hide();
      return;
    }
    const country = twoincSoleTrader.currentCountry();
    if (!country) {
      twoincSoleTrader.hide();
      return;
    }
    if (country in twoincSoleTrader.availabilityByCountry) {
      twoincSoleTrader.apply(twoincSoleTrader.availabilityByCountry[country]);
      return;
    }
    jQuery
      .get(cfg.availability_url, { country: country, nonce: cfg.nonce })
      .done(function (response) {
        const available = !!(
          response &&
          response.success &&
          response.data &&
          response.data.available
        );
        twoincSoleTrader.availabilityByCountry[country] = available;
        // The buyer may have changed country while the request was in
        // flight; only apply if the answer is still for the current one.
        if (twoincSoleTrader.currentCountry() === country) {
          twoincSoleTrader.apply(available);
        }
      })
      .fail(function () {
        // Fail-soft: no sole trader option, checkout proceeds as business.
        if (twoincSoleTrader.currentCountry() === country) {
          twoincSoleTrader.apply(false);
        }
      });
  },

  apply: function (available) {
    if (available) {
      twoincSoleTrader.render();
    } else {
      twoincSoleTrader.hide();
    }
  },

  hide: function () {
    jQuery(".twoinc-sole-trader-toggle").addClass("hidden").empty();
    // Re-show (e.g. country change) should prefetch afresh.
    twoincSoleTrader.lastPrefetchEmail = null;
    if (twoincSoleTrader.mode === "sole_trader") {
      twoincSoleTrader.setMode("business");
    }
  },

  render: function () {
    const cfg = twoincSoleTrader.config();
    const $container = jQuery(".twoinc-sole-trader-toggle");
    $container.empty().removeClass("hidden");

    // Mode chips (mirrors the Magento .mode_selector / .mode_item rendering).
    const $selector = jQuery("<div>", { class: "twoinc-mode-selector" });
    [
      { value: "business", label: cfg.text.registered_business },
      { value: "sole_trader", label: cfg.text.sole_trader }
    ].forEach(function (option) {
      const $chip = jQuery("<span>", {
        class: "twoinc-mode-item",
        text: option.label,
        role: "button",
        tabindex: 0,
        "data-mode": option.value
      }).on("click keypress", function (event) {
        if (event.type === "keypress" && event.which !== 13 && event.which !== 32) {
          return;
        }
        event.preventDefault();
        twoincSoleTrader.onModeChipClick(option.value);
      });
      $selector.append($chip);
    });
    $container.append($selector);

    // Bell-icon note + signup link — shown only when sole-trader mode is
    // active and signup is needed (no matching autofill), and as the
    // fallback when an auto-launched popup is blocked.
    const $note = jQuery(
      '<div class="twoinc-sole-trader-note hidden">' +
        '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">' +
        '<path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0M3.124 7.5A8.969 8.969 0 015.292 3m13.416 0a8.969 8.969 0 012.168 4.5"/>' +
        "</svg></div>"
    );
    jQuery("<a>", {
      href: "#",
      class: "twoinc-sole-trader-note__link",
      text: cfg.text.popup_prompt
    })
      .on("click", function (event) {
        event.preventDefault();
        twoincSoleTrader.launchSignup();
      })
      .appendTo($note);
    $container.append($note);

    twoincSoleTrader.updateChips();
    // Prefetch for an already-filled email (returning/logged-in buyer), so a
    // known sole trader is auto-selected without waiting for an email edit.
    twoincSoleTrader.onEmailChanged();
  },

  updateChips: function () {
    jQuery(".twoinc-sole-trader-toggle .twoinc-mode-item").each(function () {
      jQuery(this).toggleClass(
        "twoinc-mode-item--selected",
        jQuery(this).data("mode") === twoincSoleTrader.mode
      );
    });
  },

  showNote: function (show) {
    jQuery(".twoinc-sole-trader-note").toggleClass("hidden", !show);
  },

  /**
   * A mode chip was clicked. Business is immediate; Sole trader switches
   * mode then acts on the prefetched autofill result so the signup popup
   * (when needed) opens in the same synchronous gesture as the click.
   */
  onModeChipClick: function (mode) {
    if (mode === "business") {
      twoincSoleTrader.setMode("business");
      return;
    }
    twoincSoleTrader.setMode("sole_trader");
    const pf = twoincSoleTrader.prefetched;
    if (pf.ready && pf.matches && pf.buyer) {
      twoincSoleTrader.setCompany(pf.buyer.organization_number, pf.buyer.company_name);
      twoincSoleTrader.showNote(false);
    } else if (pf.ready) {
      // Prefetch resolved with no matching buyer → signup. Opening here keeps
      // the user gesture intact so the popup is not blocker-killed.
      twoincSoleTrader.launchSignup();
    } else {
      // Prefetch not ready (e.g. no email entered yet): fall back to the link.
      twoincSoleTrader.showNote(true);
    }
  },

  /**
   * Switch mode and toggle the company-search suppression. No token/buyer
   * work happens here — that is owned by the email-driven prefetch and the
   * chip-click handler.
   */
  setMode: function (mode) {
    twoincSoleTrader.mode = mode;
    twoincSoleTrader.updateChips();

    if (mode === "sole_trader") {
      // Suppress company search by the same lever the "company not in
      // list" button uses, restoring the merchant's setting on the way
      // back to business mode.
      if (twoincSoleTrader.savedCompanySearch === null) {
        twoincSoleTrader.savedCompanySearch = window.twoinc.enable_company_search;
      }
      window.twoinc.enable_company_search = "no";
      const $display = jQuery("#billing_company_display");
      if ($display.data("select2")) {
        $display.select2("destroy");
      }
      jQuery("#company_not_in_btn, #search_company_btn").hide();
      jQuery("#billing_company, #company_id").prop("readonly", true);
      twoincDomHelper.toggleBusinessFields();
    } else {
      twoincSoleTrader.showNote(false);
      jQuery("#billing_company, #company_id").prop("readonly", false);
      if (twoincSoleTrader.savedCompanySearch !== null) {
        window.twoinc.enable_company_search = twoincSoleTrader.savedCompanySearch;
        twoincSoleTrader.savedCompanySearch = null;
      }
      twoincSoleTrader.setCompany("", "");
      twoincDomHelper.toggleBusinessFields();
      Twoinc.getInstance().enableCompanySearch();
    }
  },

  /**
   * Prefetch the autofill buyer for the entered email. Runs on every email
   * change so the chip click can resolve synchronously. Mints tokens (needed
   * for the signup popup) then reads the buyer on the Two cookie; a match is
   * when that buyer owns the email currently typed at checkout.
   */
  onEmailChanged: function () {
    if (!twoincSoleTrader.isAvailable()) {
      return;
    }
    const email = twoincSoleTrader.enteredEmail();
    // Dedupe repeated checkout re-renders firing for an unchanged email.
    if (email === twoincSoleTrader.lastPrefetchEmail) {
      return;
    }
    twoincSoleTrader.lastPrefetchEmail = email;
    twoincSoleTrader.prefetched = { ready: false, buyer: null, matches: false };
    if (!email) {
      // No email to match → cannot be a known sole trader; leave business.
      if (twoincSoleTrader.mode === "sole_trader") {
        twoincSoleTrader.setMode("business");
      }
      return;
    }
    twoincSoleTrader.fetchTokens(function (ok) {
      if (!ok) {
        twoincSoleTrader.prefetched = { ready: true, buyer: null, matches: false };
        twoincSoleTrader.applyPrefetch();
        return;
      }
      twoincSoleTrader.fetchCurrentBuyer(function (buyer) {
        const entered = twoincSoleTrader.enteredEmail().toLowerCase();
        const matches = !!(buyer && buyer.email && String(buyer.email).toLowerCase() === entered);
        twoincSoleTrader.prefetched = { ready: true, buyer: buyer, matches: matches };
        twoincSoleTrader.applyPrefetch();
      });
    });
  },

  /**
   * React to a resolved prefetch: a matching buyer auto-selects Sole trader
   * and prefills the company; a non-match reverts an active Sole-trader
   * selection back to Registered business (re-clicking then starts signup).
   */
  applyPrefetch: function () {
    const pf = twoincSoleTrader.prefetched;
    if (pf.matches && pf.buyer) {
      twoincSoleTrader.setMode("sole_trader");
      twoincSoleTrader.setCompany(pf.buyer.organization_number, pf.buyer.company_name);
      twoincSoleTrader.showNote(false);
    } else if (twoincSoleTrader.mode === "sole_trader") {
      twoincSoleTrader.setMode("business");
    }
  },

  /**
   * Open the hosted signup popup, falling back to the visible link if the
   * browser blocks the window (e.g. gesture lost after a slow prefetch).
   */
  launchSignup: function () {
    const win = twoincSoleTrader.openPopup();
    twoincSoleTrader.showNote(!win);
  },

  setCompany: function (companyId, companyName) {
    jQuery("#company_id").val(companyId);
    jQuery("#billing_company").val(companyName);
    const instance = Twoinc.getInstance();
    instance.customerCompany.organization_number = companyId;
    instance.customerCompany.company_name = companyName;
    if (companyId) {
      instance.getApproval();
    }
  },

  /**
   * Mint the delegation + autofill tokens. Invokes cb(true) once tokens are
   * available (also binding the signup postMessage listener), cb(false) on
   * any failure. Tokens are short-lived, so we re-mint on each email change.
   */
  fetchTokens: function (cb) {
    const cfg = twoincSoleTrader.config();
    if (!cfg.tokens_url) {
      if (cb) cb(false);
      return;
    }
    jQuery
      .post(cfg.tokens_url, { nonce: cfg.nonce, country: twoincSoleTrader.currentCountry() })
      .done(function (response) {
        if (response && response.success && response.data && response.data.autofill_token) {
          twoincSoleTrader.tokens = response.data;
          twoincSoleTrader.bindPopupMessageListener();
          if (cb) cb(true);
        } else {
          if (cb) cb(false);
        }
      })
      .fail(function () {
        if (cb) cb(false);
      });
  },

  /**
   * Read the buyer on the Two cookie. Invokes cb(buyer) with the buyer
   * details, or cb(null) when none exist (404) or on error. No UI side
   * effects — the caller decides what to do with the result.
   */
  fetchCurrentBuyer: function (cb) {
    if (!twoincSoleTrader.tokens) {
      cb(null);
      return;
    }
    fetch(window.twoinc.twoinc_checkout_host + "/autofill/v1/buyer/current", {
      credentials: "include",
      headers: { "two-delegated-authority-token": twoincSoleTrader.tokens.autofill_token }
    })
      .then(function (response) {
        if (response.ok) return response.json();
        if (response.status === 404) return null;
        throw new Error("autofill/v1/buyer/current failed");
      })
      .then(function (json) {
        cb(json || null);
      })
      .catch(function () {
        cb(null);
      });
  },

  openPopup: function () {
    if (!twoincSoleTrader.tokens) {
      return null;
    }
    const prefill = {
      email: jQuery("#billing_email").val(),
      first_name: jQuery("#billing_first_name").val(),
      last_name: jQuery("#billing_last_name").val(),
      company_name: jQuery("#billing_company").val(),
      phone_number: jQuery("#billing_phone").val(),
      billing_address: {
        street: jQuery("#billing_address_1").val(),
        postal_code: jQuery("#billing_postcode").val(),
        city: jQuery("#billing_city").val(),
        region: jQuery("#billing_state").val() || "",
        country_code: twoincSoleTrader.currentCountry()
      }
    };
    const url =
      twoincSoleTrader.tokens.signup_url +
      "?businessToken=" +
      encodeURIComponent(twoincSoleTrader.tokens.delegation_token) +
      "&autofillToken=" +
      encodeURIComponent(twoincSoleTrader.tokens.autofill_token) +
      "&autofillData=" +
      encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(prefill)))));
    return window.open(
      url,
      "_blank",
      "location=yes,resizable=yes,scrollbars=yes,status=yes,height=805,width=610"
    );
  },

  /**
   * The hosted signup posts 'ACCEPTED' back to the opener when the buyer
   * completes registration; re-read the buyer (it now owns the entered
   * email) and apply the result — autofilling and keeping Sole trader.
   */
  bindPopupMessageListener: function () {
    if (twoincSoleTrader.messageListenerBound) {
      return;
    }
    twoincSoleTrader.messageListenerBound = true;
    window.addEventListener("message", function (event) {
      if (twoincSoleTrader.mode !== "sole_trader" || !twoincSoleTrader.tokens) {
        return;
      }
      const signupOrigin = new URL(twoincSoleTrader.tokens.signup_url).origin;
      if (event.origin !== signupOrigin) {
        return;
      }
      if (event.data === "ACCEPTED") {
        twoincSoleTrader.fetchCurrentBuyer(function (buyer) {
          const entered = twoincSoleTrader.enteredEmail().toLowerCase();
          const matches = !!(buyer && buyer.email && String(buyer.email).toLowerCase() === entered);
          twoincSoleTrader.prefetched = { ready: true, buyer: buyer, matches: matches };
          if (matches) {
            twoincSoleTrader.setCompany(buyer.organization_number, buyer.company_name);
            twoincSoleTrader.showNote(false);
          }
        });
      } else {
        twoincSoleTrader.showError();
      }
    });
  },

  showError: function () {
    const cfg = twoincSoleTrader.config();
    const $container = jQuery(".twoinc-sole-trader-toggle");
    if (!cfg.text || !cfg.text.error || $container.length === 0) {
      return;
    }
    let $error = $container.find(".twoinc-sole-trader-toggle__error");
    if ($error.length === 0) {
      $error = jQuery("<span>", { class: "twoinc-sole-trader-toggle__error" });
      $container.append($error);
    }
    $error.text(cfg.text.error);
  }
};

class Twoinc {
  constructor() {
    if (instance) {
      throw "Twoinc is a singleton";
    }
    instance = this;

    this.isInitialized = false;
    this.isTwoincApproved = null;
    this.orderIntentCheck = {
      interval: null,
      pendingCheck: false,
      lastCheckOk: false,
      lastCheckHash: null
    };
    this.orderIntentLog = {};
    this.customerCompany = {
      company_name: null,
      country_prefix: null,
      organization_number: null
    };
    this.customerRepresentative = {
      email: null,
      first_name: null,
      last_name: null,
      phone_number: null
    };
    this.billingCompanySelect = null;
  }

  enableCompanySearch() {
    const self = this;

    const $body = jQuery(document.body);

    // Get the billing company field
    const $billingCompanyDisplay = $body.find("#billing_company_display");
    const $billingCompany = $body.find("#billing_company");

    // Get the company ID field
    const $companyId = $body.find("#company_id");
    if (window.twoinc.enable_company_search !== "yes") return;
    self.billingCompanySelect = $billingCompanyDisplay.selectWoo(
      twoincSelectWooHelper.genSelectWooParams()
    );
    twoincDomHelper.toggleTooltip(
      "#billing_company_display_field .select2-container",
      window.twoinc.text.tooltip_company
    );
    self.billingCompanySelect.on("select2:select", function (e) {
      const self = Twoinc.getInstance();

      // Get the option data
      const data = e.params.data;

      // Set the company name
      self.customerCompany.company_name = data.id;

      // Set the company ID
      self.customerCompany.organization_number = data.company_id;

      // Set the company ID to HTML DOM
      $companyId.val(data.company_id);

      // Set the company name to HTML DOM
      $billingCompany.val(data.id);

      // Display company ID on the right of selected company name
      setTimeout(function () {
        twoincDomHelper.insertFloatingCompany(data.company_id, 0);
      }, 0);

      // Update the company name in agreement sentence and text in subtitle/description
      twoincDomHelper.togglePaySubtitleDesc();

      // Get the company approval status
      self.getApproval();

      // Address search
      if (window.twoinc.enable_address_lookup === "yes") {
        // Fetch the company data
        self.addressLookup(data);
      }
    });

    twoincSelectWooHelper.fixSelectWooPositionCompanyName();

    self.billingCompanySelect.on("select2:open", function (e) {
      let companyNotInBtn = twoincDomHelper.getCompanyNotInBtnNode();
      jQuery("#select2-billing_company_display-results").parent().append(companyNotInBtn);
      twoincSelectWooHelper.waitToFocus("billing_company_display", null, null, function () {
        jQuery('input[aria-owns="select2-billing_company_display-results"]').on(
          "input",
          function (e) {
            let selectWooParams = twoincSelectWooHelper.genSelectWooParams();
            if (
              jQuery(this).val() &&
              jQuery(this).val().length >= selectWooParams.minimumInputLength
            ) {
              jQuery("#company_not_in_btn").show();
            } else {
              jQuery("#company_not_in_btn").hide();
            }
          }
        );
      });
      twoincSelectWooHelper.addSelectWooFocusFixHandler("billing_company_display");
    });
  }

  /**
   * Initialize Twoinc code
   */
  initialize(loadSavedInputs) {
    const self = this;

    if (this.isInitialized) {
      return;
    }
    const $body = jQuery(document.body);

    // Stop if not the checkout page
    if (jQuery("#order_review").length === 0) return;

    // Set up the business fields when the gateway is visible — or when
    // company search should serve other payment methods while this
    // gateway is gated away. (Note isTwoincVisible() is also true when
    // the gateway <li> is absent entirely — .css() on an empty set — so
    // the second clause guards intent, not today's behaviour: it must
    // survive any future tightening of isTwoincVisible.)
    if (
      twoincDomHelper.isTwoincVisible() ||
      (window.twoinc.enable_company_search === "yes" &&
        window.twoinc.enable_company_search_for_others === "yes")
    ) {
      // Toggle the business fields
      twoincDomHelper.toggleBusinessFields();

      // Move the fields to correct positions
      twoincDomHelper.positionFields();
    }

    // Focus on search input on country open
    jQuery("#billing_country").on("select2:open", function (e) {
      twoincSelectWooHelper.waitToFocus("billing_country");
    });

    // Enable company search
    this.enableCompanySearch();
    setTimeout(this.enableCompanySearch, 800);

    // Disable or enable actions based on the account type
    $body.on("updated_checkout", Twoinc.getInstance().onUpdatedCheckout);

    $body.on("click", "#company_not_in_btn", function () {
      window.twoinc.enable_company_search = "no";

      jQuery("#billing_company_display").val("");
      jQuery("#company_id").val("");
      Twoinc.getInstance().customerCompany = twoincDomHelper.getCompanyData();
      jQuery("#company_not_in_btn").hide();
      jQuery("#search_company_btn").show();
      Twoinc.getInstance().billingCompanySelect.select2("destroy");

      twoincDomHelper.toggleBusinessFields();
    });

    $body.on("click", "#search_company_btn", function () {
      window.twoinc.enable_company_search = "yes";

      self.enableCompanySearch();

      jQuery("#billing_company").val("");
      jQuery("#company_id").val("");
      Twoinc.getInstance().customerCompany = twoincDomHelper.getCompanyData();

      jQuery("#search_company_btn").hide();
      twoincDomHelper.toggleBusinessFields();
    });

    // Handle the representative inputs blur event
    $body.on(
      "blur",
      "#billing_first_name, #billing_last_name, #billing_email, #billing_phone",
      self.onRepresentativeInputBlur
    );

    // Handle the representative inputs blur event
    $body.on("blur", "#company_id, #billing_company_display", self.onCompanyManualInputBlur);

    // Handle the company inputs change event
    $body.on(
      "change",
      "#select2-billing_company_display-container",
      twoincDomHelper.togglePaySubtitleDesc
    );
    $body.on("change", "#billing_company", function () {
      Twoinc.getInstance().customerCompany.company_name = twoincDomHelper.getCompanyName();
      twoincDomHelper.togglePaySubtitleDesc();
    });

    // Handle the country inputs change event
    $body.on("change", "#billing_country", self.onCountryInputChange);

    // Re-evaluate the sole-trader autofill prefetch whenever the email
    // changes, so a returning sole trader is auto-selected and the signup
    // popup can open synchronously on the chip click.
    $body.on("change", "#billing_email", function () {
      twoincSoleTrader.onEmailChanged();
    });

    $body.on("click", "#place_order", function () {
      clearInterval(Twoinc.getInstance().orderIntentCheck.interval);
      Twoinc.getInstance().orderIntentCheck.interval = null;
      Twoinc.getInstance().orderIntentCheck.pendingCheck = false;
    });

    $body.on("checkout_error", function () {
      clearInterval(Twoinc.getInstance().orderIntentCheck.interval);
      Twoinc.getInstance().orderIntentCheck.interval = null;
      Twoinc.getInstance().orderIntentCheck.pendingCheck = false;
    });

    setInterval(function () {
      if (Twoinc.getInstance().orderIntentCheck.pendingCheck) Twoinc.getInstance().getApproval();
      twoincDomHelper.saveCheckoutInputs();
    }, 3000);

    // Add customization for current theme if any
    twoincDomHelper.insertCustomCss();

    twoincDomHelper.loadUserMetaInputs();
    if (loadSavedInputs) twoincDomHelper.loadStorageInputs();
    setTimeout(function () {
      twoincDomHelper.saveCheckoutInputs();
      Twoinc.getInstance().customerCompany = twoincDomHelper.getCompanyData();
      Twoinc.getInstance().customerRepresentative = twoincDomHelper.getRepresentativeData();
      twoincDomHelper.insertFloatingCompany(
        Twoinc.getInstance().customerCompany.organization_number,
        0
      );
      Twoinc.getInstance().getApproval();
    }, 1000);
    this.updateElements();
    this.isInitialized = true;
  }

  /**
   * Get singleton instance
   */
  static getInstance() {
    if (!instance) instance = new Twoinc();
    return instance;
  }

  /**
   * Check if all the required details are collected
   *
   * @returns {boolean}
   */
  updateElements() {
    // Check approval again
    this.getApproval();

    // Update the text in subtitle and description
    twoincDomHelper.togglePaySubtitleDesc();

    // Rearrange the DOMs in Twoinc payment
    twoincDomHelper.rearrangeDescription();

    this.toggleDueInDays();
    this.getDueInDays();
  }

  /**
   * Check if all the required details are collected
   *
   * @returns {boolean}
   */
  isReadyApprovalCheck() {
    if (window.twoinc.enable_order_intent !== "yes") {
      return false;
    }

    if (!Twoinc.getInstance().customerCompany.organization_number) {
      return false;
    }

    let values = [].concat(Object.values(this.customerCompany));

    return !twoincUtilHelper.isAnyElementEmpty(values);
  }

  /**
   * Check the company approval status by creating an order intent
   */
  getApproval() {
    if (!this.isReadyApprovalCheck()) return;

    if (this.orderIntentCheck.interval) {
      this.orderIntentCheck.pendingCheck = true;
      return;
    }

    this.orderIntentCheck.interval = setInterval(function () {
      let gross_amount = twoincDomHelper.getPrice("order-total");
      let tax_amount = twoincDomHelper.getPrice("tax-rate");
      if (!gross_amount) {
        return;
      }
      if (!tax_amount) {
        tax_amount = 0;
      }
      let net_amount = gross_amount - tax_amount;

      let jsonBody = JSON.stringify({
        merchant_id: window.twoinc.merchant?.id,
        merchant_short_name: window.twoinc.merchant?.short_name,
        gross_amount: gross_amount.toFixed(2),
        net_amount: net_amount.toFixed(2),
        tax_amount: tax_amount.toFixed(2),
        invoice_type: "FUNDED_INVOICE",
        buyer: {
          company: Twoinc.getInstance().customerCompany,
          representative: Twoinc.getInstance().customerRepresentative
        },
        currency: window.twoinc.currency,
        line_items: [
          {
            name: "Cart",
            description: "",
            gross_amount: gross_amount.toFixed(2),
            net_amount: net_amount.toFixed(2),
            discount_amount: "0",
            tax_amount: tax_amount.toFixed(2),
            tax_class_name: "VAT " + ((100.0 * tax_amount) / net_amount).toFixed(2) + "%",
            tax_rate: "" + ((1.0 * tax_amount) / net_amount).toFixed(6),
            unit_price: net_amount.toFixed(2),
            quantity: 1,
            quantity_unit: "item",
            image_url: "",
            product_page_url: "",
            type: "PHYSICAL",
            details: {
              categories: [],
              barcodes: []
            }
          }
        ]
      });

      let hashedBody = twoincUtilHelper.getUnsecuredHash(jsonBody);
      if (Twoinc.getInstance().orderIntentLog[hashedBody]) {
        twoincDomHelper.togglePaySubtitleDesc(
          ...Twoinc.getInstance().orderIntentLog[hashedBody].split("|")
        );
        return;
      }
      Twoinc.getInstance().orderIntentCheck["lastCheckHash"] = hashedBody;

      clearInterval(Twoinc.getInstance().orderIntentCheck.interval);
      Twoinc.getInstance().orderIntentCheck.interval = null;
      Twoinc.getInstance().orderIntentCheck.pendingCheck = false;

      if (!Twoinc.getInstance().isReadyApprovalCheck()) return;

      twoincDomHelper.togglePaySubtitleDesc("checking-intent");

      // Create an order intent
      const approvalResponse = jQuery.ajax({
        url: twoincUtilHelper.constructTwoincUrl("/v1/order_intent"),
        contentType: "application/json; charset=utf-8",
        dataType: "json",
        method: "POST",
        xhrFields: { withCredentials: true },
        data: jsonBody
      });

      approvalResponse.done(function (response) {
        // Store the approved state
        Twoinc.getInstance().isTwoincApproved = response.approved;

        if (!response.approved) {
          twoincDomHelper.deselectPaymentMethod();
        }

        // Update tracking number
        if (response.tracking_id && document.querySelector("#tracking_id")) {
          document.querySelector("#tracking_id").value = response.tracking_id;
        }

        // Display messages and update order intent logs
        Twoinc.getInstance().processOrderIntentResponse(response);
      });

      approvalResponse.fail(function (response) {
        // Store the approved state
        Twoinc.getInstance().isTwoincApproved = false;

        twoincDomHelper.deselectPaymentMethod();

        // Display messages and update order intent logs
        Twoinc.getInstance().processOrderIntentResponse(response);
      });
    }, 1000);
  }

  /**
   * Update page after order intent request complete
   */
  processOrderIntentResponse(response) {
    let displayMsgId = "";
    let invalidFields = [];

    if (response.approved) {
      displayMsgId = "intent-approved";
    } else {
      // Display error messages
      displayMsgId = "errored|.twoinc-err-payment-default";
      if (response.status >= 400) {
        // @TODO: use code in checkout-api
        let errMsg = response.responseJSON;
        if (typeof response.responseJSON !== "string") {
          if ("error_details" in response.responseJSON && response.responseJSON["error_details"]) {
            errMsg = response.responseJSON["error_details"];
          } else if ("error_code" in response.responseJSON && response.responseJSON["error_code"]) {
            errMsg = response.responseJSON["error_code"];
          }
        }

        if (errMsg.includes("Invalid phone number")) {
          displayMsgId = "errored|.twoinc-err-phone-number";
          invalidFields.append("billing_phone_field");
        }
      }

      // Update order intent log
      this.orderIntentCheck["lastCheckOk"] = response.approved;
      // this.orderIntentLog = {}
      this.orderIntentLog[this.orderIntentCheck["lastCheckHash"]] = displayMsgId;
    }

    // Update twoinc message
    let twoincSubtitleExistCheck = setInterval(function () {
      if (jQuery("#payment .blockOverlay").length === 0) {
        // woocommerce's update_checkout is not running
        twoincDomHelper.togglePaySubtitleDesc(...displayMsgId.split("|"));
        for (let fld of invalidFields) {
          twoincDomHelper.markFieldInvalid(fld);
        }
        clearInterval(twoincSubtitleExistCheck);
      }
    }, 1000);
  }

  addressLookup(selectedCompany) {
    const self = this;
    const addressResponse = jQuery.ajax({
      dataType: "json",
      url: twoincUtilHelper.constructTwoincUrl(`/companies/v2/company/${selectedCompany.lookup_id}`)
    });
    addressResponse.done(function (response) {
      // Use new address lookup by default
      if (response.addresses) {
        self.setAddress(response.addresses[0]);
      }
    });
  }

  setAddress(address) {
    jQuery("#billing_address_1").val(address.street_address);
    jQuery("#billing_address_2").val("");
    jQuery("#billing_city").val(address.city);
    jQuery("#billing_postcode").val(address.postal_code);
    // Update order review in case there is a shipping change
    jQuery(document.body).trigger("update_checkout");
  }

  /**
   * Get the actual due in days to display on page
   */
  getDueInDays() {
    if (
      !Twoinc.getInstance().customerCompany ||
      !Twoinc.getInstance().customerCompany.organization_number ||
      !Twoinc.getInstance().customerCompany.country_prefix
    )
      return;

    let params = {
      merchant_id: window.twoinc.merchant?.id,
      merchant_short_name: window.twoinc.merchant?.short_name,
      buyer_organization_number: Twoinc.getInstance().customerCompany.organization_number,
      country_prefix: Twoinc.getInstance().customerCompany.country_prefix
    };

    // Create a get due in days request
    const dueInDaysResponse = jQuery.ajax({
      url: twoincUtilHelper.constructTwoincUrl("/v1/payment_terms", params),
      dataType: "json",
      method: "GET"
    });

    dueInDaysResponse.done(function (response) {
      window.twoinc.custom_due_in_days = typeof response.due_in_days !== "undefined";

      Twoinc.getInstance().toggleDueInDays();
    });

    dueInDaysResponse.fail(function (response) {
      Twoinc.getInstance().toggleDueInDays();
    });
  }

  /**
   * Display due in days only if the buyer does not have custom payment term
   */
  toggleDueInDays() {
    if (window.twoinc.custom_due_in_days) {
      jQuery(".payment-term-number").hide();
      jQuery(".payment-term-nonumber").show();
    } else {
      jQuery(".payment-term-nonumber").hide();
      jQuery(".payment-term-number").show();
    }
  }

  /**
   * Handle the woocommerce updated checkout event
   */
  onUpdatedCheckout() {
    Twoinc.getInstance().updateElements();

    jQuery('input[name="payment_method"]').on("change", function () {
      twoincDomHelper.toggleBusinessFields();
    });

    twoincDomHelper.rearrangeDescription();

    twoincTermChips.refresh();
    twoincSoleTrader.refresh();
  }

  /**
   * Handle the company manual input changes
   *
   * @param event
   */

  onCompanyManualInputBlur(event) {
    const $input = jQuery(this);

    let inputName = $input.attr("name");

    if (inputName === "company_id") {
      Twoinc.getInstance().customerCompany.organization_number = $input.val();
    } else if (inputName === "billing_company_display") {
      Twoinc.getInstance().customerCompany.company_name = $input.val();
    }

    Twoinc.getInstance().getApproval();
  }

  /**
   * Handle the representative input changes
   *
   * @param event
   */

  onRepresentativeInputBlur(event) {
    const $input = jQuery(this);

    let inputName = $input.attr("name").replace("billing_", "");

    if (inputName === "phone") inputName += "_number";

    Twoinc.getInstance().customerRepresentative[inputName] = $input.val();

    Twoinc.getInstance().getApproval();
  }

  /**
   * Handle the country input changes
   *
   * @param event
   */

  onCountryInputChange(event) {
    const $input = jQuery(this);

    Twoinc.getInstance().customerCompany.country_prefix = $input.val();

    twoincDomHelper.toggleBusinessFields();

    twoincDomHelper.clearSelectedCompany();

    // Sole trader availability is per-country; re-evaluate the toggle.
    twoincSoleTrader.refresh();

    Twoinc.getInstance().getApproval();
  }
}

let instance = null;
let isTwoincSelected = null;
jQuery(function () {
  if (window.twoinc) {
    // WooCommerce core's own radio-click handler for payment method
    // selection (checkout.js payment_method_selected) calls
    // e.stopPropagation() and only fires a bare `payment_method_selected`
    // event on document.body — it never triggers `update_checkout`. This
    // gateway's buyer surcharge fee (apply_cart_fee) is conditional on
    // which payment method is currently chosen, so without an explicit
    // recalculation trigger here the fee neither appears when switching
    // TO this gateway nor disappears when switching AWAY from it, until
    // something unrelated (e.g. a term-chip click) happens to fire
    // update_checkout first. Bound once at page load; WC fires
    // payment_method_selected only when the checked radio actually
    // changes, so this does not cause extra recalculations on unrelated
    // re-renders.
    jQuery(document.body).on("payment_method_selected", function () {
      jQuery(document.body).trigger("update_checkout");
    });

    if (window.twoinc.enable_order_intent === "yes") {
      const initIfGatewayPresent = function () {
        if (jQuery("#payment_method_" + window.twoinc.gateway_id).length > 0) {
          // Run Twoinc code if order intent is enabled
          Twoinc.getInstance().initialize(true);
          return true;
        }
        return false;
      };
      if (!initIfGatewayPresent()) {
        // The gateway can be absent at page load yet appear later: the
        // server-side availability gate re-evaluates per order-review
        // refresh (basket total crossing the platform minimum, billing
        // country change). The old one-shot check left company search
        // unwired for the whole session. Re-check on every
        // updated_checkout; and when company search is enabled for other
        // methods, wire it immediately — that setting exists precisely
        // for checkouts where this gateway isn't offered.
        if (
          window.twoinc.enable_company_search === "yes" &&
          window.twoinc.enable_company_search_for_others === "yes"
        ) {
          Twoinc.getInstance().initialize(true);
        } else {
          const $body = jQuery(document.body);
          const retryInit = function () {
            // initialize(false): the load-time saved-input replay must not
            // run mid-session — replaying stored radio/checkbox clicks
            // TOGGLES state the buyer set after page load.
            if (jQuery("#payment_method_" + window.twoinc.gateway_id).length > 0) {
              Twoinc.getInstance().initialize(false);
              $body.off("updated_checkout", retryInit);
            }
          };
          $body.on("updated_checkout", retryInit);
        }
      }
    } else {
      // Handle initialization every time order review (right panel) is updated
      jQuery(document.body).on("updated_checkout", function () {
        // If shop defaults payment method to Twoinc, run Twoinc code
        if (twoincDomHelper.isTwoincSelected()) {
          Twoinc.getInstance().initialize(false);
          Twoinc.getInstance().onUpdatedCheckout();
        }

        // Run Twoinc code if Twoinc payment is selected
        jQuery("#payment_method_" + window.twoinc.gateway_id).on("change", function () {
          Twoinc.getInstance().initialize(false);
          Twoinc.getInstance().onUpdatedCheckout();
        });
      });

      // If last selected payment method is Twoinc, run Twoinc code anyway
      let lastSelectedPayment = twoincDomHelper.getCheckoutInput(
        "INPUT",
        "radio",
        "payment_method"
      );
      if (
        lastSelectedPayment &&
        lastSelectedPayment.id === "payment_method_" + window.twoinc.gateway_id
      ) {
        Twoinc.getInstance().initialize(true);
      }

      // Otherwise do not run Twoinc code
    }

    // I can not find my company button
    jQuery("#billing_company_field").append(jQuery("#search_company_btn"));
    jQuery("#company_not_in_btn").hide();
    jQuery("#search_company_btn").hide();

    setTimeout(function () {
      // Init the hidden Company name field
      const companyName = twoincDomHelper.getCompanyName().trim();
      if (companyName) {
        jQuery("#billing_company").val(companyName);
      }
    }, 1000);
  }
});
