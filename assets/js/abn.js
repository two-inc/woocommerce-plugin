let abnUtilHelper = {
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
   * Construct url to ABN checkout api
   */
  constructABNUrl: function (path, params) {
    if (!params) params = {};
    params["client"] = window.abn.client_name;
    params["client_v"] = window.abn.client_version;
    return window.abn.abn_checkout_host + path + "?" + new URLSearchParams(params).toString();
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

let abnSelectWooHelper = {
  /**
   * Generate parameters for selectwoo
   */
  genSelectWooParams: function () {
    let country = jQuery("#billing_country").val();

    let abnSearchLimit = 50;
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
            limit: abnSearchLimit,
            offset: (params.page || 0) * abnSearchLimit,
            q: decodeURIComponent(params.term)
          });
          return abnUtilHelper.constructABNUrl("/companies/v2/company", searchParams);
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
    if (window.abn.enable_company_search === "yes") {
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
              abnSelectWooHelper.waitToFocus("billing_company_display", 80, 20);
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

let abnDomHelper = {
  /**
   * Add a placeholder after an input, used for moving the fields in HTML DOM
   */
  addPlaceholder: function ($el, name) {
    // Get an existing placeholder
    let $placeholder = jQuery("#abn-" + name + "-source");

    // Stop if we already have a placeholder
    if ($placeholder.length > 0) return;

    // Create a placeholder
    $placeholder = jQuery('<div id="abn-' + name + '-source" class="abn-source"></div>');

    // Add placeholder after element
    $placeholder.insertAfter($el);
  },

  /**
   * Move a field to ABN template location and leave a placeholder
   */
  moveField: function (selector, name) {
    // Get the element
    const $el = jQuery("#" + selector);

    // Add a placeholder
    abnDomHelper.addPlaceholder($el, name);

    // Get the target
    const $target = jQuery("#abn-" + name + "-target");

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
    const $source = jQuery("#abn-" + name + "-source");

    // Move the input
    if ($source.length > 0) {
      $el.insertAfter($source);
    }
  },

  /**
   * Move the fields to their original or ABN template location
   */
  positionFields: function () {
    setTimeout(function () {
      // If business account
      if (abnDomHelper.isABNSelected()) {
        abnDomHelper.moveField("billing_first_name_field", "fn");
        abnDomHelper.moveField("billing_last_name_field", "ln");
        abnDomHelper.moveField("billing_phone_field", "ph");
        abnDomHelper.moveField("billing_email_field", "em");
      } else {
        abnDomHelper.revertField("billing_first_name_field", "fn");
        abnDomHelper.revertField("billing_last_name_field", "ln");
        abnDomHelper.revertField("billing_phone_field", "ph");
        abnDomHelper.revertField("billing_email_field", "em");
      }

      abnDomHelper.toggleTooltip(
        '#billing_phone, label[for="billing_phone"]',
        window.abn.text.tooltip_phone
      );
      abnDomHelper.toggleTooltip(
        '#billing_company_display_field .select2-container, label[for="billing_company_display"], #billing_company, label[for="billing_company"]',
        window.abn.text.tooltip_company
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
        if ($row.find("label .abn-required, label .required").length == 0) {
          $row
            .find("label")
            .append('<abbr class="required abn-required" title="required">*</abbr>');
        }
        $row.find("label .optional").hide();
      } else {
        $input.attr("required", false);

        // Show the hidden optional visual cue
        $row.find("label .abn-required").remove();
        $row.find("label .optional").show();
      }
    });
  },

  toggleABNTermsVisibility: function (visible) {
    field = jQuery("#abn_terms_field");
    if (visible) {
      field.removeClass("hidden");
    } else {
      field.addClass("hidden");
    }
  },

  /**
   * Toggle the custom business fields for ABN
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
    const isABNSelected = abnDomHelper.isABNVisible() && abnDomHelper.isABNSelected();

    if (isABNSelected) {
      visibleTargets.push(
        "#department_field",
        "#project_field",
        "#purchase_order_number_field",
        "#invoice_email_field"
      );
      requiredTargets.push("#billing_phone_field");
      if (abnDomHelper.isCountrySupported() && window.abn.enable_company_search === "yes") {
        visibleTargets.push("#billing_company_display_field");
        requiredTargets.push("#billing_company_display_field");
      } else {
        visibleTargets.push("#billing_company_field", "#company_id_field");
        requiredTargets.push("#billing_company_field", "#company_id_field");
      }
    } else {
      if (
        abnDomHelper.isCountrySupported() &&
        window.abn.enable_company_search === "yes" &&
        window.abn.enable_company_search_for_others === "yes"
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
    abnDomHelper.toggleRequiredCues(allTargets, false);
    abnDomHelper.toggleRequiredCues(requiredTargets, isABNSelected);
  },

  /**
   * Deselect payment method and select the first available one
   */
  deselectPaymentMethod: function () {
    const paymentMethodRadioObj = jQuery(':input[value="woocommerce-gateway-tillit"]');
    // Deselect the current payment method
    if (paymentMethodRadioObj) {
      paymentMethodRadioObj.prop("checked", false);
    }
  },

  /**
   * Toggle the tooltip for input fields
   */
  toggleTooltip: function (selectorStr, tooltip) {
    if (window.abn.display_tooltips !== "yes") return;

    jQuery(selectorStr).each(function () {
      if (abnDomHelper.isABNSelected()) {
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
    jQuery(".abn-pay-box").addClass("hidden");
    jQuery(".abn-pay-box.abn-explainer").removeClass("hidden");
    if (["checking-intent", "intent-approved", "errored"].includes(action)) {
      jQuery(".abn-pay-box.abn-explainer").addClass("hidden");
      if (action === "checking-intent") {
        jQuery(".abn-pay-box.abn-loader").removeClass("hidden");
      } else if (action === "intent-approved") {
        jQuery(".abn-pay-box.abn-intent-approved").removeClass("hidden");
      } else if (action === "errored") {
        jQuery(".abn-pay-box" + errSelector).removeClass("hidden");
      }
    }
  },

  /**
   * Get company name string
   */
  getCompanyName: function () {
    if (window.abn.enable_company_search === "yes") {
      let companyNameObj = abnDomHelper.getCheckoutInput(
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
      company_name: abnDomHelper.getCompanyName(),
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
    billingCompanyDisplay.selectWoo(abnSelectWooHelper.genSelectWooParams());
    abnDomHelper.toggleTooltip(
      "#billing_company_display_field .select2-container",
      window.abn.text.tooltip_company
    );
    abnSelectWooHelper.fixSelectWooPositionCompanyName();
    jQuery("#company_id").val("");

    // Clear the addresses, in case address get request fails
    if (window.abn.enable_address_lookup === "yes") {
      ABN.getInstance().setAddress({
        street_address: "",
        city: "",
        postal_code: ""
      });
    }

    jQuery("#select2-billing_company_display-container")
      .parent()
      .find(".select2-selection__arrow")
      .show();
    ABN.getInstance().customerCompany = {};
    abnDomHelper.togglePaySubtitleDesc();

    // Update again after all elements are updated
    setTimeout(function () {
      ABN.getInstance().customerCompany = abnDomHelper.getCompanyData();
      abnDomHelper.togglePaySubtitleDesc();
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
        window.abn.abn_plugin_url +
        'assets/images/x-button.svg" onclick="abnDomHelper.clearSelectedCompany()"></img>' +
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
   * Check if selected country is supported by ABN
   */
  isCountrySupported: function () {
    return window.abn.supported_buyer_countries.includes(jQuery("#billing_country").val());
  },

  /**
   * Check if abn payment is currently selected
   */
  isABNSelected: function () {
    return jQuery('input[name="payment_method"]:checked').val() === "woocommerce-gateway-abn";
  },

  /**
   * Check if abn payment is currently visible
   */
  isABNVisible: function () {
    return (
      jQuery("li.wc_payment_method.payment_method_woocommerce-gateway-abn").css("display") !==
      "none"
    );
    //return jQuery('#payment_method_woocommerce-gateway-abn:visible').length !== 0
  },

  /**
   * Get price recursively from a DOM node
   */
  getPriceRecursively: function (node) {
    if (!node) return;
    if (node.classList && node.classList.contains("woocommerce-Price-currencySymbol")) return;
    if (node.childNodes) {
      for (let n of node.childNodes) {
        let val = abnDomHelper.getPriceRecursively(n);
        if (val) {
          return val;
        }
      }
    }
    if (node.nodeName === "#text") {
      let val = node.textContent
        .replaceAll(window.abn.price_thousand_separator, "")
        .replaceAll(window.abn.price_decimal_separator, ".");
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
    return abnDomHelper.getPriceRecursively(node);
  },

  /**
   * Rearrange descriptions in ABN payment to make it cleaner
   */
  rearrangeDescription: function () {
    let abnPaymentBox = jQuery(".payment_box.payment_method_woocommerce-gateway-abn");
    if (abnPaymentBox.length > 0) {
      abnPaymentBox.after(jQuery(".abt-abn"));
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
      // Skip load company id/name if user logged in and has ABN meta set
      if (window.abn.user_meta_exists) {
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
    window.abn.user_meta_exists = window.abn.billing_company && window.abn.company_id;
    if (document.querySelector("#billing_company_display")) {
      let selectElem = document.querySelector("#billing_company_display");
      if (!selectElem.querySelector('option:not([value=""])') && window.abn.user_meta_exists) {
        // Append to selectWoo
        if (!selectElem.querySelector('option[value="' + window.abn.billing_company + '"]')) {
          selectElem.innerHTML =
            '<option value="' +
            window.abn.billing_company +
            '">' +
            window.abn.billing_company +
            "</option>" +
            selectElem.innerHTML;
        }
        selectElem.value = window.abn.billing_company;

        // Append company id to company name select box
        if (window.abn.user_meta_exists) {
          abnDomHelper.insertFloatingCompany(window.abn.company_id, 2000);
        }
      }
    }
    if (document.querySelector("#department") && window.abn.department) {
      document.querySelector("#department").value = window.abn.department;
    }
    if (document.querySelector("#project") && window.abn.project) {
      document.querySelector("#project").value = window.abn.project;
    }

    // Update the object values
    if (document.querySelector("#billing_company") && window.abn.billing_company) {
      document.querySelector("#billing_company").value = window.abn.billing_company;
    }
    if (document.querySelector("#company_id") && window.abn.company_id) {
      document.querySelector("#company_id").value = window.abn.company_id;
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
    let themeBase = abnDomHelper.getThemeBase();
    if (themeBase) {
      jQuery("head").append(
        '<link href="' +
          window.abn.abn_plugin_url +
          "assets/css/c-" +
          themeBase +
          '.css" type="text/css" rel="stylesheet" />'
      );
    }
  }
};

class ABN {
  constructor() {
    if (instance) {
      throw "ABN is a singleton";
    }
    instance = this;

    this.isInitialized = false;
    this.isABNApproved = null;
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
    this.BVCompanyRegex = /(?:^|\s)B(?:\.)?V(?:\.)?$/i;
  }

  enableCompanySearch() {
    const self = this;

    const $body = jQuery(document.body);

    // Get the billing company field
    const $billingCompanyDisplay = $body.find("#billing_company_display");
    const $billingCompany = $body.find("#billing_company");

    // Get the company ID field
    const $companyId = $body.find("#company_id");
    if (window.abn.enable_company_search !== "yes") return;
    self.billingCompanySelect = $billingCompanyDisplay.selectWoo(
      abnSelectWooHelper.genSelectWooParams()
    );
    abnDomHelper.toggleTooltip(
      "#billing_company_display_field .select2-container",
      window.abn.text.tooltip_company
    );
    self.billingCompanySelect.on("select2:select", function (e) {
      const self = ABN.getInstance();

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
        abnDomHelper.insertFloatingCompany(data.company_id, 0);
      }, 0);

      // Update the company name in agreement sentence and text in subtitle/description
      abnDomHelper.togglePaySubtitleDesc();

      // Get the company approval status
      self.getApproval();

      // Address search
      if (window.abn.enable_address_lookup === "yes") {
        // Fetch the company data
        self.addressLookup(data);
      }
    });

    abnSelectWooHelper.fixSelectWooPositionCompanyName();

    self.billingCompanySelect.on("select2:open", function (e) {
      let companyNotInBtn = abnDomHelper.getCompanyNotInBtnNode();
      jQuery("#select2-billing_company_display-results").parent().append(companyNotInBtn);
      abnSelectWooHelper.waitToFocus("billing_company_display", null, null, function () {
        jQuery('input[aria-owns="select2-billing_company_display-results"]').on(
          "input",
          function (e) {
            let selectWooParams = abnSelectWooHelper.genSelectWooParams();
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
      abnSelectWooHelper.addSelectWooFocusFixHandler("billing_company_display");
    });
  }

  /**
   * Initialize ABN code
   */
  initialize(loadSavedInputs) {
    const self = this;

    if (this.isInitialized) {
      return;
    }
    const $body = jQuery(document.body);

    // Stop if not the checkout page
    if (jQuery("#order_review").length === 0) return;

    // If we found the field
    if (abnDomHelper.isABNVisible()) {
      // Toggle the business fields
      abnDomHelper.toggleBusinessFields();

      // Move the fields to correct positions
      abnDomHelper.positionFields();
    }

    // Focus on search input on country open
    jQuery("#billing_country").on("select2:open", function (e) {
      abnSelectWooHelper.waitToFocus("billing_country");
    });

    // Enable company search
    this.enableCompanySearch();
    setTimeout(this.enableCompanySearch, 800);

    // Disable or enable actions based on the account type
    $body.on("updated_checkout", ABN.getInstance().onUpdatedCheckout);

    $body.on("click", "#company_not_in_btn", function () {
      window.abn.enable_company_search = "no";

      jQuery("#billing_company_display").val("");
      jQuery("#company_id").val("");
      ABN.getInstance().customerCompany = abnDomHelper.getCompanyData();
      jQuery("#company_not_in_btn").hide();
      jQuery("#search_company_btn").show();
      ABN.getInstance().billingCompanySelect.select2("destroy");

      abnDomHelper.toggleBusinessFields();
    });

    $body.on("click", "#search_company_btn", function () {
      window.abn.enable_company_search = "yes";

      self.enableCompanySearch();

      jQuery("#billing_company").val("");
      jQuery("#company_id").val("");
      ABN.getInstance().customerCompany = abnDomHelper.getCompanyData();

      jQuery("#search_company_btn").hide();
      abnDomHelper.toggleBusinessFields();
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
      abnDomHelper.togglePaySubtitleDesc
    );
    $body.on("change", "#billing_company", function () {
      ABN.getInstance().customerCompany.company_name = abnDomHelper.getCompanyName();
      abnDomHelper.togglePaySubtitleDesc();
    });

    // Handle the country inputs change event
    $body.on("change", "#billing_country", self.onCountryInputChange);

    $body.on("click", "#place_order", function () {
      clearInterval(ABN.getInstance().orderIntentCheck.interval);
      ABN.getInstance().orderIntentCheck.interval = null;
      ABN.getInstance().orderIntentCheck.pendingCheck = false;
    });

    $body.on("checkout_error", function () {
      clearInterval(ABN.getInstance().orderIntentCheck.interval);
      ABN.getInstance().orderIntentCheck.interval = null;
      ABN.getInstance().orderIntentCheck.pendingCheck = false;
    });

    setInterval(function () {
      if (ABN.getInstance().orderIntentCheck.pendingCheck) ABN.getInstance().getApproval();
      abnDomHelper.saveCheckoutInputs();
    }, 3000);

    // Add customization for current theme if any
    abnDomHelper.insertCustomCss();

    abnDomHelper.loadUserMetaInputs();
    if (loadSavedInputs) abnDomHelper.loadStorageInputs();
    setTimeout(function () {
      abnDomHelper.saveCheckoutInputs();
      ABN.getInstance().customerCompany = abnDomHelper.getCompanyData();
      ABN.getInstance().customerRepresentative = abnDomHelper.getRepresentativeData();
      abnDomHelper.insertFloatingCompany(ABN.getInstance().customerCompany.organization_number, 0);
      ABN.getInstance().getApproval();
    }, 1000);
    this.updateElements();
    this.isInitialized = true;
  }

  /**
   * Get singleton instance
   */
  static getInstance() {
    if (!instance) instance = new ABN();
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
    abnDomHelper.togglePaySubtitleDesc();

    // Rearrange the DOMs in ABN payment
    abnDomHelper.rearrangeDescription();

    // Show or hide the ABN terms
    abnDomHelper.toggleABNTermsVisibility(abnDomHelper.isABNSelected());

    this.toggleDueInDays();
    this.getDueInDays();
  }

  /**
   * Check if all the required details are collected
   *
   * @returns {boolean}
   */
  isReadyApprovalCheck() {
    if (window.abn.enable_order_intent !== "yes") {
      return false;
    }

    if (!ABN.getInstance().customerCompany.organization_number) {
      return false;
    }

    let values = [].concat(Object.values(this.customerCompany));

    return !abnUtilHelper.isAnyElementEmpty(values);
  }

  /**
   * Check the company approval status by creating an order intent
   */
  getApproval() {
    if (!this.isReadyApprovalCheck()) return;

    // Do not fire order intent for BV companies in NL
    if (this.customerCompany.country_prefix.toLowerCase() == "nl") {
      let isBVCompany = this.BVCompanyRegex.test(this.customerCompany.company_name);
      if (!isBVCompany) {
        abnDomHelper.togglePaySubtitleDesc();
        return;
      }
    }

    if (this.orderIntentCheck.interval) {
      this.orderIntentCheck.pendingCheck = true;
      return;
    }

    this.orderIntentCheck.interval = setInterval(function () {
      let gross_amount = abnDomHelper.getPrice("order-total");
      let tax_amount = abnDomHelper.getPrice("tax-rate");
      if (!gross_amount) {
        return;
      }
      if (!tax_amount) {
        tax_amount = 0;
      }
      let net_amount = gross_amount - tax_amount;

      let jsonBody = JSON.stringify({
        merchant_id: window.abn.merchant?.id,
        merchant_short_name: window.abn.merchant?.short_name,
        gross_amount: gross_amount.toFixed(2),
        net_amount: net_amount.toFixed(2),
        tax_amount: tax_amount.toFixed(2),
        invoice_type: "FUNDED_INVOICE",
        buyer: {
          company: ABN.getInstance().customerCompany,
          representative: ABN.getInstance().customerRepresentative
        },
        currency: window.abn.currency,
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

      let hashedBody = abnUtilHelper.getUnsecuredHash(jsonBody);
      if (ABN.getInstance().orderIntentLog[hashedBody]) {
        abnDomHelper.togglePaySubtitleDesc(
          ...ABN.getInstance().orderIntentLog[hashedBody].split("|")
        );
        return;
      }
      ABN.getInstance().orderIntentCheck["lastCheckHash"] = hashedBody;

      clearInterval(ABN.getInstance().orderIntentCheck.interval);
      ABN.getInstance().orderIntentCheck.interval = null;
      ABN.getInstance().orderIntentCheck.pendingCheck = false;

      if (!ABN.getInstance().isReadyApprovalCheck()) return;

      abnDomHelper.togglePaySubtitleDesc("checking-intent");

      // Create an order intent
      const approvalResponse = jQuery.ajax({
        url: abnUtilHelper.constructABNUrl("/v1/order_intent"),
        contentType: "application/json; charset=utf-8",
        dataType: "json",
        method: "POST",
        xhrFields: { withCredentials: true },
        data: jsonBody
      });

      approvalResponse.done(function (response) {
        // Store the approved state
        ABN.getInstance().isABNApproved = response.approved;

        if (!response.approved) {
          abnDomHelper.deselectPaymentMethod();
        }

        // Update tracking number
        if (response.tracking_id && document.querySelector("#tracking_id")) {
          document.querySelector("#tracking_id").value = response.tracking_id;
        }

        // Display messages and update order intent logs
        ABN.getInstance().processOrderIntentResponse(response);
      });

      approvalResponse.fail(function (response) {
        // Store the approved state
        ABN.getInstance().isABNApproved = false;

        abnDomHelper.deselectPaymentMethod();

        // Display messages and update order intent logs
        ABN.getInstance().processOrderIntentResponse(response);
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
      displayMsgId = "errored|.abn-err-payment-default";
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
          displayMsgId = "errored|.abn-err-phone-number";
          invalidFields.append("billing_phone_field");
        }
      }

      // Update order intent log
      this.orderIntentCheck["lastCheckOk"] = response.approved;
      // this.orderIntentLog = {}
      this.orderIntentLog[this.orderIntentCheck["lastCheckHash"]] = displayMsgId;
    }

    // Update abn message
    let abnSubtitleExistCheck = setInterval(function () {
      if (jQuery("#payment .blockOverlay").length === 0) {
        // woocommerce's update_checkout is not running
        abnDomHelper.togglePaySubtitleDesc(...displayMsgId.split("|"));
        for (let fld of invalidFields) {
          abnDomHelper.markFieldInvalid(fld);
        }
        clearInterval(abnSubtitleExistCheck);
      }
    }, 1000);
  }

  addressLookup(selectedCompany) {
    const self = this;
    const addressResponse = jQuery.ajax({
      dataType: "json",
      url: abnUtilHelper.constructABNUrl(`/companies/v2/company/${selectedCompany.lookup_id}`)
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
      !ABN.getInstance().customerCompany ||
      !ABN.getInstance().customerCompany.organization_number ||
      !ABN.getInstance().customerCompany.country_prefix
    )
      return;

    let params = {
      merchant_id: window.abn.merchant?.id,
      merchant_short_name: window.abn.merchant?.short_name,
      buyer_organization_number: ABN.getInstance().customerCompany.organization_number,
      country_prefix: ABN.getInstance().customerCompany.country_prefix
    };

    // Create a get due in days request
    const dueInDaysResponse = jQuery.ajax({
      url: abnUtilHelper.constructABNUrl("/v1/payment_terms", params),
      dataType: "json",
      method: "GET"
    });

    dueInDaysResponse.done(function (response) {
      window.abn.custom_due_in_days = typeof response.due_in_days !== "undefined";

      ABN.getInstance().toggleDueInDays();
    });

    dueInDaysResponse.fail(function (response) {
      ABN.getInstance().toggleDueInDays();
    });
  }

  /**
   * Display due in days only if the buyer does not have custom payment term
   */
  toggleDueInDays() {
    if (window.abn.custom_due_in_days) {
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
    ABN.getInstance().updateElements();

    jQuery('input[name="payment_method"]').on("change", function () {
      abnDomHelper.toggleBusinessFields();
      abnDomHelper.toggleABNTermsVisibility(abnDomHelper.isABNSelected());
    });

    abnDomHelper.rearrangeDescription();
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
      ABN.getInstance().customerCompany.organization_number = $input.val();
    } else if (inputName === "billing_company_display") {
      ABN.getInstance().customerCompany.company_name = $input.val();
    }

    ABN.getInstance().getApproval();
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

    ABN.getInstance().customerRepresentative[inputName] = $input.val();

    ABN.getInstance().getApproval();
  }

  /**
   * Handle the country input changes
   *
   * @param event
   */

  onCountryInputChange(event) {
    const $input = jQuery(this);

    ABN.getInstance().customerCompany.country_prefix = $input.val();

    abnDomHelper.toggleBusinessFields();

    abnDomHelper.clearSelectedCompany();

    ABN.getInstance().getApproval();
  }
}

let instance = null;
jQuery(function () {
  if (window.abn) {
    if (window.abn.enable_order_intent === "yes") {
      if (jQuery("#payment_method_woocommerce-gateway-abn").length > 0) {
        // Run ABN code if order intent is enabled
        ABN.getInstance().initialize(true);
      }
    } else {
      // Handle initialization every time order review (right panel) is updated
      jQuery(document.body).on("updated_checkout", function () {
        // If shop defaults payment method to ABN, run ABN code
        if (abnDomHelper.isABNSelected()) {
          ABN.getInstance().initialize(false);
          ABN.getInstance().onUpdatedCheckout();
        }

        // Run ABN code if ABN payment is selected
        jQuery("#payment_method_woocommerce-gateway-abn").on("change", function () {
          ABN.getInstance().initialize(false);
          ABN.getInstance().onUpdatedCheckout();
        });
      });

      // If last selected payment method is ABN, run ABN code anyway
      let lastSelectedPayment = abnDomHelper.getCheckoutInput("INPUT", "radio", "payment_method");
      if (
        lastSelectedPayment &&
        lastSelectedPayment.id === "payment_method_woocommerce-gateway-abn"
      ) {
        ABN.getInstance().initialize(true);
      }

      // Otherwise do not run ABN code
    }

    // I can not find my company button
    jQuery("#billing_company_field").append(jQuery("#search_company_btn"));
    jQuery("#company_not_in_btn").hide();
    jQuery("#search_company_btn").hide();

    setTimeout(function () {
      // Init the hidden Company name field
      const companyName = abnDomHelper.getCompanyName().trim();
      if (companyName) {
        jQuery("#billing_company").val(companyName);
      }
    }, 1000);
  }
});
