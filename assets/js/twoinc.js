let twoincUtilHelper = {

    /**
     * Check if selected account type is business
     */
    isCompany: function(accountType) {
        return accountType === 'business'
    },

    /**
     * Check if any element in the list is null or empty
     */
    isAnyElementEmpty: function(values) {

        for (let i = 0; i < values.length; i++) {
            const v = values[i]
            if (!v || v.length === 0) {
                return true
            }
        }

        return false

    },

    /**
     * Construct url to Twoinc checkout api
     */
    contructTwoincUrl: function(path, params) {
        if (!params) params = {}
        params['client'] = window.twoinc.client_name
        params['client_v'] = window.twoinc.client_version
        return window.twoinc.twoinc_checkout_host + path + '?' + (new URLSearchParams(params)).toString()
    },

    /**
     * Hash some input to store as key
     */
    getUnsecuredHash: function(inp, seed) {
        if (!seed) seed = 0
        let h1 = 0xdeadbeef ^ seed
        let h2 = 0x41c6ce57 ^ seed
        for (let i = 0, ch; i < inp.length; i++) {
            ch = inp.charCodeAt(i)
            h1 = Math.imul(h1 ^ ch, 2654435761)
            h2 = Math.imul(h2 ^ ch, 1597334677)
        }
        h1 = Math.imul(h1 ^ (h1>>>16), 2246822507) ^ Math.imul(h2 ^ (h2>>>13), 3266489909)
        h2 = Math.imul(h2 ^ (h2>>>16), 2246822507) ^ Math.imul(h1 ^ (h1>>>13), 3266489909)
        return 4294967296 * (2097151 & h2) + (h1>>>0)
    }

}

let twoincSelectWooHelper = {

    /**
     * Generate parameters for selectwoo
     */
    genSelectWooParams: function() {
        let countryParams = {
            "NO": {
                "twoinc_search_host": window.twoinc.twoinc_search_host_no,
            },
            "GB": {
                "twoinc_search_host": window.twoinc.twoinc_search_host_gb,
            },
            "SE": {
                "twoinc_search_host": window.twoinc.twoinc_search_host_se,
            }
        }

        let country = jQuery('#billing_country').val()

        if (country in countryParams) {
            let twoincSearchLimit = 50
            return {
                minimumInputLength: 3,
                width: '100%',
                escapeMarkup: function(markup) {
                    return markup
                },
                templateResult: function(data)
                {
                    return data.html
                },
                templateSelection: function(data) {
                    return data.text
                },
                language: {
                    errorLoading: function() {
                        // return wc_country_select_params.i18n_ajax_error
                        // Should not show ajax error if request is cancelled
                        return wc_country_select_params.i18n_searching
                    },
                    inputTooShort: function(t) {
                        t = t.minimum - t.input.length
                        return 1 == t ? wc_country_select_params.i18n_input_too_short_1 : wc_country_select_params.i18n_input_too_short_n.replace("%qty%", t)
                    },
                    noResults: function() {
                        return wc_country_select_params.i18n_no_matches
                    },
                    searching: function() {
                        return wc_country_select_params.i18n_searching
                    },
                },
                ajax: {
                    dataType: 'json',
                    delay: 200,
                    url: function(params) {
                        params.page = params.page || 1
                        return countryParams[country].twoinc_search_host + '/search?limit=' + twoincSearchLimit + '&offset=' + ((params.page - 1) * twoincSearchLimit) + '&q=' + encodeURIComponent(params.term)
                    },
                    data: function()
                    {
                        return {}
                    },
                    processResults: function(response, params)
                    {

                        return {
                            results: twoincSelectWooHelper.extractItems(response),
                            pagination: {
                                more: (params.page * twoincSearchLimit) < response.data.total
                            }
                        }

                    }
                }
            }
        } else {
            jQuery('input[aria-owns="select2-billing_company_display-results"]').css('display: none;')
            return {
                minimumInputLength: 10000,
                width: '100%',
                language: {
                    inputTooShort: function(t) {
                        return 'Please select country Norway or United Kingdom (UK) to search'
                    },
                },
            }
        }
    },

    /**
     * Fix the position bug
     * https://github.com/select2/select2/issues/4614
     */
    fixSelectWooPositionCompanyName: function() {

        if (window.twoinc.company_name_search === 'yes') {

            const billingCompanyDisplay = jQuery('#billing_company_display').data('select2')

            if (billingCompanyDisplay) {
                billingCompanyDisplay.on('open', function(e) {
                    this.results.clear()
                    this.dropdown._positionDropdown()
                })
                billingCompanyDisplay.on('results:message', function(e) {
                    this.dropdown._resizeDropdown()
                    this.dropdown._positionDropdown()
                })
            }

        }

    },

    /**
     * Extract and format the dropdown options
     */
    extractItems: function(results) {

        if (results.status !== 'success') return []

        const items = []

        for (let i = 0; i < results.data.items.length; i++) {

            const item = results.data.items[i]

            items.push({
                id: item.name,
                text: item.name,
                html: item.highlight + ' (' + item.id + ')',
                company_id: item.id,
                company_code: item.code,
                approved: false
            })

        }

        return items

    },

    /**
     * Wait until element appear and focus
     */
    waitToFocus: function(selectWooElemId, hitsRequired, intervalDuration, callbackFunc) {

        if (isNaN(intervalDuration)) intervalDuration = 300
        if (isNaN(hitsRequired)) hitsRequired = 2
        let attemptsLeft = hitsRequired * 8

        let focusInterval = setInterval(function(){

            let inpElem = jQuery('input[aria-owns="select2-' + selectWooElemId + '-results"]').get(0)
            if (inpElem) {
                // Focus on the element if not already focused
                if (inpElem != document.activeElement) inpElem.focus()
                // Mark this as a hit attempt
                hitsRequired--
                // If reached number of required hits, do not attempt again
                if (hitsRequired <= 0) attemptsLeft = 0
            }

            attemptsLeft--
            if (attemptsLeft <= 0) {
                clearInterval(focusInterval)
                if (inpElem && callbackFunc) callbackFunc()
            }

        }, intervalDuration)

    },

    /**
     * Wait until element appear and focus
     */
    addSelectWooFocusFixHandler: function(selectWooElemId) {

        let billingCompanyDisplayResult = jQuery('#select2-' + selectWooElemId + '-results')
        if (billingCompanyDisplayResult && !billingCompanyDisplayResult.attr('two-focused-handler')) {
            billingCompanyDisplayResult.attr('two-focused-handler', true)
            billingCompanyDisplayResult.on('DOMNodeInserted', function(event) {
                if(event.target.parentNode.id == 'select2-' + selectWooElemId + '-results') {
                    twoincSelectWooHelper.waitToFocus('billing_company_display', 80, 20)
                }
            })
        }

    }

}

let twoincDomHelper = {

    /**
     * Initialize account type buttons
     */
    initAccountTypeButtons: function($el, name) {

        setTimeout(function(){
            // Move the account type DOM to before Billing
            jQuery('#woocommerce-account-type-container').parent().parent().prepend(jQuery('#woocommerce-account-type-container'))
            // Select the account type button based on radio val
            let accountType = twoincDomHelper.getAccountType()
            if (accountType) {
                jQuery('form.checkout.woocommerce-checkout').prepend(jQuery('.account-type-wrapper'))
                jQuery('.account-type-button[account-type-name="' + accountType + '"]').addClass('selected')
            }

            // Show the radios or the buttons for account type if number of options > 1
            if (jQuery('input[name="account_type"]').length > 1) {
                if (window.twoinc.use_account_type_buttons !== 'yes') {
                    // Show if shop configured to use buttons (and customer details form is visible, i.e. no custom payment page is displayed)
                    if (jQuery('#customer_details:visible').length !== 0) {
                        jQuery('#account_type_field').show()
                        jQuery('.woocommerce-account-type-fields__field-wrapper').show()
                    }
                } else {
                    // Show if shop configured to use banners
                    jQuery('.account-type-wrapper').show()
                }
            }

            if (jQuery('#klarna-checkout-select-other').length > 0) {
                // If Kco checkout page is displayed
                // Switching to another payment method would make account type "business" after page is reloaded
                jQuery('#klarna-checkout-select-other').on('click', function() {
                    sessionStorage.setItem('twoincAccountType', 'business')
                })
                // Clicking Business button
                jQuery('.account-type-button[account-type-name="business"]').on('click', function() {
                    // Save the account type
                    sessionStorage.setItem('twoincAccountType', twoincDomHelper.getAccountType())

                    // After page is reloaded, clicking private button will route user back to Kco
                    sessionStorage.setItem('privateClickToKco', 'y')
                    jQuery('#klarna-checkout-select-other').click()
                })
            } else if (jQuery('.woocommerce-account-type-fields').length > 0) {
                // If Normal checkout page is displayed, and Twoinc's account type radios are present
                jQuery('.account-type-button[account-type-name="personal"], .account-type-button[account-type-name="sole_trader"]').on('click', function() {

                    let hasNoPaymentExceptTwoincKco = jQuery('.wc_payment_method:not(.payment_method_woocommerce-gateway-tillit):not(.payment_method_kco)').length == 0
                    if (hasNoPaymentExceptTwoincKco) {
                        // Kco is the only payment method in private/soletrader, so clear and click it to trigger
                        jQuery('#payment_method_kco').prop('checked', false)
                    }
                    sessionStorage.setItem('twoincAccountType', twoincDomHelper.getAccountType())

                    if (sessionStorage.getItem('privateClickToKco') === 'y' || hasNoPaymentExceptTwoincKco) {
                        sessionStorage.removeItem('privateClickToKco')
                        // Clicking private button will route user back to Kco, only if user visited Kco before, or if Kco is the only payment left
                        jQuery('#payment_method_kco').click()
                    } else if (sessionStorage.getItem('businessClickToTwoinc') === 'y' && twoincDomHelper.isTwoincVisible()) {
                        // Clicking business button will auto select Twoinc payment, if Twoinc was selected before account type is changed
                        jQuery('#payment_method_woocommerce-gateway-tillit').click()
                    }

                })
            }

            // If account type button is clicked, account type is saved in case the page will be reloaded
            jQuery('.account-type-button').on('click', function() {
                sessionStorage.setItem('twoincAccountType', twoincDomHelper.getAccountType())
            })

            // Temporarily click the banner buttons if radio button is changed
            jQuery('[name="account_type"]').on('change', function() {
                jQuery('.account-type-button[account-type-name="' + jQuery(this).attr('value') + '"]').click()
            })

            // If business account type is selected and the payment method selected was Twoinc, reselect it
            jQuery('.account-type-button[account-type-name="business"]').on('click', function() {
                if (sessionStorage.getItem('businessClickToTwoinc') === 'y') {
                    // Clicking business button will auto select Twoinc payment, if Twoinc was selected before account type is changed
                    jQuery('#payment_method_woocommerce-gateway-tillit').click()
                }
            })

            // If Kco button is clicked, account type must not be business
            jQuery('#payment_method_kco').on('change', Twoinc.getInstance().onChangedToKco)

            // Init the hidden Company name field
            jQuery('#billing_company').val(twoincDomHelper.getCompanyName().trim())

            // Select last saved account type in case of redirect from another payment method
            accountType = sessionStorage.getItem('twoincAccountType')
            if (accountType) {
                jQuery('.account-type-button[account-type-name="' + accountType + '"]').click()
            }
        }, 1000)

        // Remove buttons without corresponding account type radios
        jQuery('.account-type-button').each(function(){
            let accountType = jQuery(this).attr('account-type-name')
            if (jQuery('#account_type_' + accountType).length == 0) {
                jQuery(this).remove()
            }
        })

        // Styling
        if (jQuery('input[name="account_type"]').length > 1) {
            jQuery('.account-type-button').eq(jQuery('input[name="account_type"]').length - 1).addClass('last')
            jQuery('.account-type-wrapper').addClass('actp-col-' + jQuery('input[name="account_type"]').length)
        } else {
            jQuery('.woocommerce-account-type-fields__field-wrapper').hide()
            jQuery('.account-type-wrapper').hide()
        }

        // On click the buttons, update the radio vals
        jQuery('.account-type-button').on('click', function(){
            let accountType = jQuery(this).attr('account-type-name')
            jQuery('#account_type_' + accountType).click()
            jQuery('.account-type-button').removeClass('selected')
            jQuery('.account-type-button[account-type-name="' + accountType + '"]').addClass('selected')
        })

    },

    /**
     * Add a placeholder after an input, used for moving the fields in HTML DOM
     */
    addPlaceholder: function($el, name) {

        // Get an existing placeholder
        let $placeholder = jQuery('#twoinc-'+ name +'-source')

        // Stop if we already have a placeholder
        if ($placeholder.length > 0) return

        // Create a placeholder
        $placeholder = jQuery('<div id="twoinc-'+ name +'-source" class="twoinc-source"></div>')

        // Add placeholder after element
        $placeholder.insertAfter($el)

    },

    /**
     * Move a field to Twoinc template location and leave a placeholder
     */
    moveField: function(selector, name) {

        // Get the element
        const $el = jQuery('#' + selector)

        // Add a placeholder
        twoincDomHelper.addPlaceholder($el, name)

        // Get the target
        const $target = jQuery('#twoinc-' + name + '-target')

        // Move the input
        $el.insertAfter($target)

    },

    /**
     * Move a field back to its original location
     */
    revertField: function(selector, name) {

        // Get the element
        const $el = jQuery('#' + selector)

        // Get the target
        const $source = jQuery('#twoinc-' + name + '-source')

        // Move the input
        if ($source.length > 0) {
            $el.insertAfter($source)
        }

    },

    /**
     * Move the fields to their original or Twoinc template location
     */
    positionFields: function() {

        setTimeout(function(){
            // Only swap fields around if the account type is selectable
            if (jQuery('input[name="account_type"]').length > 1) {
                // Get the account type
                const accountType = twoincDomHelper.getAccountType()

                // If business account
                if (twoincUtilHelper.isCompany(accountType)) {
                    twoincDomHelper.moveField('billing_first_name_field', 'fn')
                    twoincDomHelper.moveField('billing_last_name_field', 'ln')
                    twoincDomHelper.moveField('billing_phone_display_field', 'ph')
                    twoincDomHelper.moveField('billing_email_field', 'em')
                } else {
                    twoincDomHelper.revertField('billing_first_name_field', 'fn')
                    twoincDomHelper.revertField('billing_last_name_field', 'ln')
                    twoincDomHelper.revertField('billing_phone_display_field', 'ph')
                    twoincDomHelper.revertField('billing_email_field', 'em')
                }
            }

            twoincDomHelper.toggleTooltip(
                '#billing_phone_display, label[for="billing_phone_display"], #billing_phone, label[for="billing_phone"]',
                window.twoinc.text.tooltip_phone)
            twoincDomHelper.toggleTooltip(
                '#billing_company_display_field .select2-container, label[for="billing_company_display"], #billing_company, label[for="billing_company"]',
                window.twoinc.text.tooltip_company)
        }, 100)

    },

    /**
     * Mark checkout inputs invalid
     */
    markFieldInvalid: function(fieldWrapperId) {

        const fieldWrapper = document.querySelector('#' + fieldWrapperId)

        if (fieldWrapper && fieldWrapper.classList) {
            fieldWrapper.classList.remove('woocommerce-validated')
            fieldWrapper.classList.add('woocommerce-invalid')
        }

    },

    /**
     * Toggle the visual cues for required fields
     */
    toggleRequiredCues: function($targets, is_required) {

        // For each input
        $targets.find(':input').each(function(){

            // Get the input
            const $input = jQuery(this)

            // Get the input row
            const $row = $input.parents('.form-row')

            // Toggle the required property
            if (is_required) {
                $input.attr('required', true)

                // Add 'required' visual cue
                if ($row.find('label .twoinc-required, label .required').length == 0) {
                    $row.find('label').append('<abbr class="required twoinc-required" title="required">*</abbr>')
                }
                $row.find('label .optional').hide()
            } else {
                $input.attr('required', false)

                // Show the hidden optional visual cue
                $row.find('label .twoinc-required').remove()
                $row.find('label .optional').show()
            }

        })

    },

    /**
     * Toggle the custom business fields for Twoinc
     */
    toggleBusinessFields: function(accountType) {

        // Get the targets
        let allTargets = ['.woocommerce-company-fields', '.woocommerce-representative-fields', '#billing_phone_display_field', '#billing_phone_field',
                          '#billing_company_display_field', '#billing_company_field', '#company_id_field', '#billing_invoice_email_field',
                          '#department_field', '#project_field', '#purchase_order_number_field']
        let visibleNonbusinessTargets = ['#billing_phone_field', '#billing_company_field']
        let visibleBusinessTargets = ['.woocommerce-company-fields', '.woocommerce-representative-fields', '#billing_phone_display_field']
        let requiredBusinessTargets = []

        if (twoincDomHelper.isSelectedPaymentTwoinc()) {
            requiredBusinessTargets.push('#billing_phone_display_field')
        }
        if (twoincDomHelper.isCountrySupported()) {
            if (window.twoinc.company_name_search === 'yes') {
                visibleBusinessTargets.push('#billing_company_display_field')
                if (twoincDomHelper.isSelectedPaymentTwoinc()) {
                    requiredBusinessTargets.push('#billing_company_display_field')
                }
            } else {
                visibleBusinessTargets.push('#billing_company_field', '#company_id_field')
                if (twoincDomHelper.isSelectedPaymentTwoinc()) {
                    requiredBusinessTargets.push('#billing_company_field', '#company_id_field')
                }
            }
        } else {
            visibleBusinessTargets.push('#billing_company_field')
        }

        visibleBusinessTargets.push('#department_field', '#project_field', '#purchase_order_number_field')
        allTargets = jQuery(allTargets.join(','))
        requiredBusinessTargets = jQuery(requiredBusinessTargets.join(','))
        visibleBusinessTargets = jQuery(visibleBusinessTargets.join(','))
        visibleNonbusinessTargets = jQuery(visibleNonbusinessTargets.join(','))

        // Toggle the targets based on the account type
        const isTwoincAvailable = twoincDomHelper.isTwoincVisible() && twoincUtilHelper.isCompany(accountType)
        allTargets.addClass('hidden')
        if (isTwoincAvailable) {
            visibleBusinessTargets.removeClass('hidden')
        } else {
            visibleNonbusinessTargets.removeClass('hidden')
        }

        // Toggle the required fields based on the account type
        twoincDomHelper.toggleRequiredCues(allTargets, false)
        twoincDomHelper.toggleRequiredCues(requiredBusinessTargets, isTwoincAvailable)

    },

    /**
     * Deselect payment method and select the first available one
     */
    deselectPaymentMethod: function(paymentMethodRadioObj) {

        // Do nothing if not selected
        if (!paymentMethodRadioObj.prop('checked')) {
            return
        }

        // Deselect the current payment method
        if (paymentMethodRadioObj) {
            paymentMethodRadioObj.prop('checked', false)
        }

        // Select the first visible payment method
        let otherPaymentMethods = jQuery('#payment .wc_payment_methods input.input-radio:visible')
        if (otherPaymentMethods.length > 0) {
            if (paymentMethodRadioObj && paymentMethodRadioObj.attr('id')) {
                let radios = jQuery('#payment .wc_payment_methods input.input-radio:visible:not(#' + paymentMethodRadioObj.attr('id') + ')')
                if (sessionStorage.getItem('twoincAccountType') === 'business') {
                    radios = radios.filter(':not(#payment_method_kco)')
                }
                radios.first().click()
            } else {
                jQuery('#payment .wc_payment_methods input.input-radio:visible').first().click()
            }
        }

    },

    /**
     * Hide or show the Twoinc payment method
     */
    toggleMethod: function(isTwoincMethodHidden) {

        // Get the Twoinc payment method section
        const $twoincSection = jQuery('#payment .wc_payment_methods > li.payment_method_woocommerce-gateway-tillit')

        // Get the Twoinc payment method input
        const $twoincBox = jQuery(':input[value="woocommerce-gateway-tillit"]')

        // True if the Twoinc payment method is disabled
        const isTwoincDisabled = window.twoinc.enable_order_intent === 'yes' && isTwoincMethodHidden === true

        // Disable the Twoinc payment method for non-business orders
        if (isTwoincDisabled) {
            // twoincDomHelper.deselectPaymentMethod($twoincBox)
            // $twoincBox.attr('disabled', isTwoincDisabled)
            twoincDomHelper.deselectPaymentMethod($twoincBox)
        }

        if (twoincUtilHelper.isCompany(twoincDomHelper.getAccountType())) {

            // Show Twoinc payment option
            $twoincSection.show()

        } else {

            // Hide Twoinc payment option
            $twoincSection.hide()

        }

    },

    /**
     * Toggle the tooltip for input fields
     */
    toggleTooltip: function(selectorStr, tooltip) {

        if (window.twoinc.display_tooltips !== 'yes') return

        let isCurrentlyCompany = twoincUtilHelper.isCompany(twoincDomHelper.getAccountType())

        jQuery(selectorStr).each(function(){
            if(isCurrentlyCompany) {
                if (!jQuery(this).attr('original-title') && tooltip !== jQuery(this).attr('title')) {
                    jQuery(this).attr('original-title', jQuery(this).attr('title'))
                }
                jQuery(this).attr('title', tooltip)
            } else {
                jQuery(this).attr('title', jQuery(this).attr('original-title'))
                jQuery(this).attr('original-title', '')
            }
        })

    },

    /**
     * Select the default payment method
     */
    selectDefaultMethod: function(isTwoincMethodHidden) {

        // Get the Twoinc payment method input
        const $twoincPaymentMethod = jQuery(':input[value="woocommerce-gateway-tillit"]')

        // Get the Twoinc payment block
        const $twoincPmBlk = jQuery('.payment_method_woocommerce-gateway-tillit')

        // True if the Twoinc payment method is disabled
        const isTwoincDisabled = window.twoinc.enable_order_intent === 'yes' && isTwoincMethodHidden === true

        // Disable the Twoinc payment method for non-business orders
        if (isTwoincDisabled) {

            // $twoincPaymentMethod.attr('disabled', isTwoincDisabled)
            twoincDomHelper.deselectPaymentMethod($twoincPaymentMethod)

        } else {

            // Select the payment method for business accounts
            $twoincPaymentMethod.click()

        }

    },

    /**
     * Toggle payment text in subtitle and description
     */
    togglePaySubtitleDesc: function(action, errSelector) {

        if (action === 'checking-intent') {

            jQuery('.twoinc-pay-sub').hide()
            twoincDomHelper.showHideImportant('.twoinc-pay-sub.loader', 'show')

        } else if (action) {

            // Hide all related elements
            jQuery('.twoinc-pay-box, .twoinc-pay-sub').hide()
            twoincDomHelper.showHideImportant('.twoinc-pay-sub.loader', 'hide')

            if (action === 'intent-approved') {
                jQuery('.twoinc-pay-sub.explain-phrase').show()
                jQuery('.twoinc-pay-box.declare-aggrement').show()
            } else if (action === 'errored') {
                jQuery('.twoinc-pay-box' + errSelector).show()
            }

        }

        // Default behavior for any action including null
        if (!Twoinc.getInstance().customerCompany.organization_number) {
            jQuery('.twoinc-pay-sub.require-inputs').show()
        } else {
            jQuery('.twoinc-pay-sub.require-inputs').hide()
        }
        twoincDomHelper.updateCompanyNameAgreement()

    },

    /**
     * Toggle payment description based on country and invoice type
     */
    togglePaymentDesc: function() {

        // Display only the correct payment description
        jQuery('.twoinc-payment-desc').hide()
        if (window.twoinc.is_direct_invoice && window.twoinc.shop_base_country === 'no') {
            jQuery('.twoinc-payment-desc.payment-desc-no-funded').show()
        } else {
            jQuery('.twoinc-payment-desc.payment-desc-global').show()
        }

    },

    /**
     * Toggle Place order button
     */
    toggleActions: function() {

        // Get the account type
        const accountType = twoincDomHelper.getAccountType()

        // Get the payment method
        const paymentMethod = jQuery(':input[name="payment_method"]:checked').val()

        // Get the place order button
        const $placeOrder = jQuery('#place_order')

        // Disable the place order button if order is non-business and payment method is Twoinc
        $placeOrder.attr('disabled', !twoincUtilHelper.isCompany(accountType) && paymentMethod === 'woocommerce-gateway-tillit')

    },

    /**
     * Update company name in payment method aggrement section
     */
    updateCompanyNameAgreement: function() {

        let companyName = Twoinc.getInstance().customerCompany.company_name
        if (companyName) {
            companyName = companyName.trim()
        }
        if (companyName) {
            jQuery('.twoinc-buyer-name').text(companyName)
            jQuery('.twoinc-buyer-name').show()
            jQuery('.twoinc-buyer-name-placeholder').hide()
        } else {
            jQuery('.twoinc-buyer-name').text('')
            jQuery('.twoinc-buyer-name').hide()
            jQuery('.twoinc-buyer-name-placeholder').show()
        }

    },

    /**
     * Get company name string
     */
    getCompanyName: function()
    {

        if (window.twoinc.company_name_search === 'yes') {
            let companyNameObj = twoincDomHelper.getCheckoutInput('SPAN', 'select', 'select2-billing_company_display-container')
            if (companyNameObj) {
                return companyNameObj.val
            }
        } else {
            return jQuery('#billing_company').val()
        }

        return ''

    },

    /**
     * Get company data from current HTML inputs
     */
    getCompanyData: function()
    {

        return {
            'company_name': twoincDomHelper.getCompanyName(),
            'country_prefix': jQuery('#billing_country').val(),
            'organization_number': jQuery('#company_id').val()
        }

    },

    /**
     * Get representative data from current HTML inputs
     */
    getRepresentativeData: function()
    {

        let representativeData = {}
        if (jQuery('#billing_email').val()) representativeData['email'] = jQuery('#billing_email').val()
        if (jQuery('#billing_phone').val()) representativeData['phone_number'] = jQuery('#billing_phone').val()
        representativeData['first_name'] = jQuery('#billing_first_name').val()
        representativeData['last_name'] = jQuery('#billing_last_name').val()
        return representativeData

    },

    /**
     * Clear the selected selectWoo company name and id
     */
    clearSelectedCompany: function()
    {

        // Clear company inputs
        let billingCompanyDisplay = jQuery('#billing_company_display')
        billingCompanyDisplay.html('')
        billingCompanyDisplay.selectWoo(twoincSelectWooHelper.genSelectWooParams())
        twoincDomHelper.toggleTooltip('#billing_company_display_field .select2-container', window.twoinc.text.tooltip_company)
        twoincSelectWooHelper.fixSelectWooPositionCompanyName()
        jQuery('#company_id').val('')

        // Clear the addresses, in case address get request fails
        if (window.twoinc.address_search === 'yes') {
            jQuery('#billing_address_1').val('')
            jQuery('#billing_address_2').val('')
            jQuery('#billing_city').val('')
            jQuery('#billing_postcode').val('')
        }

        jQuery('#select2-billing_company_display-container').parent().find('.select2-selection__arrow').show()
        Twoinc.getInstance().customerCompany = {}
        twoincDomHelper.togglePaySubtitleDesc()

        // Update again after all elements are updated
        setTimeout(function(){
            Twoinc.getInstance().customerCompany = twoincDomHelper.getCompanyData()
            twoincDomHelper.togglePaySubtitleDesc()
        }, 3000)

    },

    /**
     * Insert the floating company id and closing button
     */
    insertFloatingCompany: function(companyId, delayInSecs)
    {

        if (!companyId) return

        // Remove if exist
        jQuery(".floating-company").remove()

        let floatingCompany = jQuery(
            '<span class="floating-company">'
            + '  <span class="floating-company-id">' + companyId + '</span>'
            + '  <img src="' + window.twoinc.twoinc_plugin_url + 'assets/images/x-button.svg" onclick="twoincDomHelper.clearSelectedCompany()"></img>'
            + '</span>')
        floatingCompany.hide()
        floatingCompany.insertBefore('#billing_company_display')
        setTimeout(function(){
            let floatingCompany = jQuery('.floating-company')
            floatingCompany.insertBefore('#select2-billing_company_display-container')
            floatingCompany.show()
            jQuery('#select2-billing_company_display-container').parent().find('.select2-selection__arrow').hide()
        }, delayInSecs)

    },

    /**
     * Get the company-not-in-btn, generate if not found
     */
    getCompanyNotInBtnNode: function()
    {

        if (jQuery('#company_not_in_btn').length) return jQuery('#company_not_in_btn')

        let companyNotInBtn = jQuery('.company_not_in_btn').clone()
        companyNotInBtn.attr('id', 'company_not_in_btn')
        companyNotInBtn.removeClass('company_not_in_btn')
        return companyNotInBtn

    },

    /**
     * Check if selected country is supported by Twoinc
     */
    isCountrySupported: function() {
        return ['NO', 'GB', 'SE'].includes(jQuery('#billing_country').val())
    },

    /**
     * Check if twoinc payment is currently selected
     */
    isSelectedPaymentTwoinc: function() {
        return jQuery('input[name="payment_method"]:checked').val() === 'woocommerce-gateway-tillit'
    },

    /**
     * Check if twoinc payment is currently visible
     */
    isTwoincVisible: function() {
        return jQuery('li.wc_payment_method.payment_method_woocommerce-gateway-tillit').css('display') !== 'none'
        //return jQuery('#payment_method_woocommerce-gateway-tillit:visible').length !== 0
    },

    /**
     * Get selected account type
     */
    getAccountType: function() {
        return jQuery(':input[name="account_type"]:checked').val()
    },

    /**
     * Get price recursively from a DOM node
     */
    getPriceRecursively: function(node) {
        if (!node) return
        if (node.classList && node.classList.contains('woocommerce-Price-currencySymbol')) return
        if (node.childNodes) {
            for (let n of node.childNodes) {
                let val = twoincDomHelper.getPriceRecursively(n)
                if (val) {
                    return val
                }
            }
        }
        if (node.nodeName === '#text') {
            let val = node.textContent
                .replaceAll(window.twoinc.price_thousand_separator, '')
                .replaceAll(window.twoinc.price_decimal_separator, '.')
            if (!isNaN(val) && !isNaN(parseFloat(val))) {
                return parseFloat(val)
            }
        }
    },

    /**
     * Get price from DOM
     */
    getPrice: function(priceName) {
        let node = document.querySelector('.' + priceName + ' .woocommerce-Price-amount bdi')
                   || document.querySelector('.' + priceName + ' .woocommerce-Price-amount')
        return twoincDomHelper.getPriceRecursively(node)
    },

    /**
     * Toggle hide with !important
     */
    showHideImportant: function(selector, action) {
        if (action == 'show') {
            jQuery(selector).css('display', '')
        } else if (action == 'hide') {
            jQuery(selector).css('display', '')
            jQuery(selector).attr('style', jQuery(selector).attr('style') + 'display: none!important;')
        }
    },

    /**
     * Rearrange descriptions in Twoinc payment to make it cleaner
     */
    rearrangeDescription: function() {

        let twoincPaymentLine = jQuery('label[for="payment_method_woocommerce-gateway-tillit"]')

        if (twoincPaymentLine.length > 0) {
            twoincPaymentLine.after(jQuery('.payment_method_woocommerce-gateway-tillit .twoinc-subtitle'))
        }

        let twoincPaymentBox = jQuery('.payment_box.payment_method_woocommerce-gateway-tillit')

        if (twoincPaymentBox.length > 0) {
            twoincPaymentBox.after(jQuery('#abt-twoinc-link'))

            if (twoincPaymentBox.parent().innerWidth() > 600) {
                jQuery('#abt-twoinc-link a').css('float', 'left')
            }
        }

    },

    /**
     * Save checkout inputs
     */
    saveCheckoutInputs: function() {
        let checkoutInputs = []
        let checkoutForm = document.querySelector('form[name="checkout"]')
        // if page is order-pay
        if (!checkoutForm) checkoutForm = document.querySelector('div.checkout.woocommerce-checkout.custom-checkout')
        // still not found
        if (!checkoutForm) return

        for (let inp of checkoutForm.querySelectorAll('input:not([type="radio"],[type="checkbox"])')) {
            if (inp.getAttribute('id')) {
                checkoutInputs.push({
                    'htmlTag': inp.tagName,
                    'id': inp.getAttribute('id'),
                    'name': inp.getAttribute('name'),
                    'type': inp.getAttribute('type'),
                    'val': inp.value,
                })
            }
        }
        for (let inp of checkoutForm.querySelectorAll('input[type="radio"]:checked,input[type="checkbox"]:checked')) {
            if (inp.getAttribute('id')) {
                checkoutInputs.push({
                    'htmlTag': inp.tagName,
                    'id': inp.getAttribute('id'),
                    'name': inp.getAttribute('name'),
                    'type': inp.getAttribute('type'),
                })
            }
        }
        for (let inp of checkoutForm.querySelectorAll('span[id$="-container"]')) {
            if (inp.getAttribute('id')) {
                let textOnly = inp.textContent
                let subs = []
                inp.childNodes.forEach(function(val){
                    if(val.nodeType === Node.TEXT_NODE) {
                        textOnly = val.nodeValue.trim()
                    } else if (val.nodeType === Node.ELEMENT_NODE) {
                        subs.push(val.outerHTML)
                    }
                })
                checkoutInputs.push({
                    'htmlTag': inp.tagName,
                    'id': inp.getAttribute('id'),
                    'parentLabel': inp.parentNode.getAttribute('aria-labelledby'),
                    'html': inp.outerHTML,
                    'type': 'select',
                    'name': inp.getAttribute('id'),
                    'val': textOnly,
                    'subs': subs,
                })
            }
        }
        for (let inp of checkoutForm.querySelectorAll('select')) {
            if (inp.getAttribute('id')) {
                if (inp.querySelector('option[value="' + inp.value + '"]')) {
                    checkoutInputs.push({
                        'htmlTag': inp.tagName,
                        'id': inp.getAttribute('id'),
                        'val': inp.value,
                        'optionHtml': inp.querySelector('option[value="' + inp.value + '"]').outerHTML,
                    })
                }
            }
        }
        sessionStorage.setItem('checkoutInputs', JSON.stringify(checkoutInputs))
    },

    /**
     * Get checkout input
     */
    getCheckoutInput: function(htmlTag, inpType, inpName) {
        let checkoutInputs = sessionStorage.getItem('checkoutInputs')
        if (!checkoutInputs) return
        checkoutInputs = JSON.parse(checkoutInputs)
        for (let inp of checkoutInputs) {
            if (inp.htmlTag === htmlTag && inp.type === inpType && inp.name === inpName) {
                return inp
            }
        }
    },

    /**
     * Load sessionStorage checkout inputs
     */
    loadStorageInputs: function() {
        let checkoutInputs = sessionStorage.getItem('checkoutInputs')
        if (!checkoutInputs) return
        checkoutInputs = JSON.parse(checkoutInputs)
        for (let inp of checkoutInputs) {
            // Skip load company id/name if user logged in and has Two meta set
            if (window.twoinc.user_meta_exists) {
                let skipIds = ['company_id', 'billing_company', 'billing_company_display']
                if (skipIds.includes(inp.id)) continue
            }
            // Load all other fields
            if (inp.htmlTag === 'INPUT') {
                if (inp.val && ['text', 'tel', 'email', 'hidden'].indexOf(inp.type) >= 0) {
                    if (document.querySelector('#' + inp.id) && !(document.querySelector('#' + inp.id).value)) {
                        document.querySelector('#' + inp.id).value = inp.val
                    }
                } else if (inp.type === 'radio') {
                    if (document.querySelector('#' + inp.id) && inp.id != 'payment_method_kco') {
                        document.querySelector('#' + inp.id).click()
                    }
                } else if (inp.type === 'checkbox') {
                    if (document.querySelector('#' + inp.id)) {
                        document.querySelector('#' + inp.id).click()
                    }
                }
            } else if (inp.htmlTag === 'SPAN') {
                if (inp.parentLabel && inp.html) {
                    if (document.querySelector('#' + inp.id)) {
                        document.querySelector('#' + inp.id).remove()
                    }
                    let parentNode = document.querySelector('[aria-labelledby="' + inp.parentLabel + '"]')
                    if (parentNode) {
                        parentNode.innerHTML = inp.html + parentNode.innerHTML
                    }
                    if (inp.subs && inp.subs.length > 0) {
                        setTimeout(function(inp){
                            let elem = document.querySelector('#' + inp.id)
                            if (elem) {
                                for (let sub of inp.subs) {
                                    elem.innerHTML += sub
                                }
                            }
                        }, 1000, inp)
                    }
                }
            } else if (inp.htmlTag === 'SELECT') {
                if (inp.val && inp.optionHtml) {
                    let selectElem = document.querySelector('#' + inp.id)
                    if (selectElem) {
                        if (!selectElem.querySelector('option:not([value=""])')) {
                            selectElem.innerHTML = inp.optionHtml + selectElem.innerHTML
                        }
                        selectElem.value = inp.val
                    }
                }
            }
        }
    },

    /**
     * Load usermeta checkout inputs
     */
    loadUserMetaInputs: function() {
        window.twoinc.user_meta_exists = window.twoinc.billing_company && window.twoinc.company_id
        if (document.querySelector('#billing_company_display')) {
            let selectElem = document.querySelector('#billing_company_display')
            if (!selectElem.querySelector('option:not([value=""])') && window.twoinc.user_meta_exists) {
                // Append to selectWoo
                if (!selectElem.querySelector('option[value="' + window.twoinc.billing_company + '"]')) {
                    selectElem.innerHTML = '<option value="' + window.twoinc.billing_company + '">' + window.twoinc.billing_company + '</option>' + selectElem.innerHTML
                }
                selectElem.value = window.twoinc.billing_company

                // Append company id to company name select box
                if (window.twoinc.user_meta_exists) {
                    twoincDomHelper.insertFloatingCompany(window.twoinc.company_id, 2000)
                }
            }
        }
        if (document.querySelector('#department') && window.twoinc.department) {
            document.querySelector('#department').value = window.twoinc.department
        }
        if (document.querySelector('#project') && window.twoinc.project) {
            document.querySelector('#project').value = window.twoinc.project
        }

        // Update the object values
        if (document.querySelector('#billing_company') && window.twoinc.billing_company) {
            document.querySelector('#billing_company').value = window.twoinc.billing_company
        }
        if (document.querySelector('#company_id') && window.twoinc.company_id) {
            document.querySelector('#company_id').value = window.twoinc.company_id
        }
    },

    /**
     * Get id of current or parent theme, return null if not found
     */
    getThemeBase: function() {
        if (jQuery('#webtron-css-css').length > 0) {
            return 'webtron'
        } else if (jQuery('#biagiotti-mikado-default-style-css').length > 0) {
            return 'biagiotti-mikado'
        } else if (jQuery('#kava-theme-style-css').length > 0) {
            return 'kava'
        } else if (jQuery('#storefront-style-inline-css').length > 0) {
            return 'storefront'
        } else if (jQuery('#divi-style-css').length > 0) {
            return 'divi'
        } else if (jQuery('#kalium-style-css-css').length > 0) {
            return 'kalium'
        } else if (jQuery('#flatsome-style-css').length > 0) {
            return 'flatsome'
        } else if (jQuery('#shopkeeper-styles-css').length > 0) {
            return 'shopkeeper'
        }
    },

    /**
     * Get id of current or parent theme, return null if not found
     */
    insertCustomCss: function() {
        let themeBase = twoincDomHelper.getThemeBase()
        if (themeBase) {
            jQuery('head').append('<link href="' + window.twoinc.twoinc_plugin_url + 'assets/css/c-' + themeBase + '.css" type="text/css" rel="stylesheet" />')
        }
    }

}

class Twoinc {

    constructor()
    {

        if (instance) {
            throw 'Twoinc is a singleton'
        }
        instance = this

        this.isInitialized = false
        this.isTwoincMethodHidden = true
        this.isTwoincApproved = null
        this.billingPhoneInput = null
        this.orderIntentCheck = {
            'interval': null,
            'pendingCheck': false,
            'lastCheckOk': false,
            'lastCheckHash': null
        }
        this.orderIntentLog = {}
        this.customerCompany = {
            'company_name': null,
            'country_prefix': null,
            'organization_number': null
        }
        this.customerCompanyInfo = {
            'company_code': null
        }
        this.customerRepresentative = {
            'email': null,
            'first_name': null,
            'last_name': null,
            'phone_number': null
        }
        this.billingCompanySelect = null

    }

    /**
     * Initialize Twoinc code
     */
    initialize(loadSavedInputs) {
        if (this.isInitialized) {
            return
        }
        const $body = jQuery(document.body)

        // Stop if not the checkout page
        if (jQuery('#order_review').length === 0) return

        // Get the billing country field
        const $billingCountry = $body.find('#billing_country')

        // Get the billing company field
        const $billingCompanyDisplay = $body.find('#billing_company_display')
        const $billingCompany = $body.find('#billing_company')

        // Get the company ID field
        const $companyId = $body.find('#company_id')

        // If we found the field
        if (jQuery('[name="account_type"]:checked').length > 0) {
            // Toggle the business fields
            twoincDomHelper.toggleBusinessFields(twoincDomHelper.getAccountType())

            // Move the fields to correct positions
            twoincDomHelper.positionFields()
        }

        // Twoinc is hidden if selected account type is not company
        this.isTwoincMethodHidden = !twoincUtilHelper.isCompany(twoincDomHelper.getAccountType())

        if (window.twoinc.company_name_search === 'yes') {

            // Focus on search input on country open
            $billingCountry.on('select2:open', function(e){
                twoincSelectWooHelper.waitToFocus('billing_country')
            })

            // Turn the select input into select2
            setTimeout(function(){
                Twoinc.getInstance().billingCompanySelect = $billingCompanyDisplay.selectWoo(twoincSelectWooHelper.genSelectWooParams())
                twoincDomHelper.toggleTooltip('#billing_company_display_field .select2-container', window.twoinc.text.tooltip_company)
                Twoinc.getInstance().billingCompanySelect.on('select2:select', function(e){

                    // Get the option data
                    const data = e.params.data

                    // Set the company name
                    Twoinc.getInstance().customerCompany.company_name = data.id

                    // Set the company ID
                    Twoinc.getInstance().customerCompany.organization_number = data.company_id

                    // Set the company code
                    Twoinc.getInstance().customerCompanyInfo.company_code = data.company_code

                    // Set the company ID to HTML DOM
                    $companyId.val(data.company_id)

                    // Set the company name to HTML DOM
                    $billingCompany.val(data.id)

                    // Display company ID on the right of selected company name
                    setTimeout(function(){
                        twoincDomHelper.insertFloatingCompany(data.company_id, 0)
                    }, 0)

                    // Update the company name in agreement sentence and text in subtitle/description
                    twoincDomHelper.togglePaySubtitleDesc()

                    // Get the company approval status
                    Twoinc.getInstance().getApproval()

                    // Address search
                    if (window.twoinc.address_search === 'yes') {
                        // Clear the addresses, in case address get request fails
                        jQuery('#billing_address_1').val('')
                        jQuery('#billing_city').val('')
                        jQuery('#billing_postcode').val('')

                        // Fetch the company data
                        Twoinc.getInstance().getAddress()
                    }

                })

                twoincSelectWooHelper.fixSelectWooPositionCompanyName()

                Twoinc.getInstance().billingCompanySelect.on('select2:open', function(e){
                    let companyNotInBtn = twoincDomHelper.getCompanyNotInBtnNode()
                    jQuery('#select2-billing_company_display-results').parent().append(companyNotInBtn)
                    twoincSelectWooHelper.waitToFocus('billing_company_display', null, null, function(){
                        jQuery('input[aria-owns="select2-billing_company_display-results"]').on('input', function(e){
                            let selectWooParams = twoincSelectWooHelper.genSelectWooParams()
                            if (jQuery(this).val() && jQuery(this).val().length >= selectWooParams.minimumInputLength) {
                                jQuery('#company_not_in_btn').show()
                            } else {
                                jQuery('#company_not_in_btn').hide()
                            }
                        })
                    })
                    twoincSelectWooHelper.addSelectWooFocusFixHandler('billing_company_display')
                })

            }, 800)

        }

        // Disable or enable actions based on the account type
        $body.on('updated_checkout', Twoinc.getInstance().onUpdatedCheckout)

        $body.on('click', '#company_not_in_btn', function() {
            jQuery('#billing_company_display').val("")
            jQuery('#company_id').val("")
            Twoinc.getInstance().customerCompany = twoincDomHelper.getCompanyData()
            window.twoinc.company_name_search = 'no'

            jQuery('#company_not_in_btn').hide()
            jQuery('#search_company_btn').show()
            Twoinc.getInstance().billingCompanySelect.select2('close')

            twoincDomHelper.toggleBusinessFields(twoincDomHelper.getAccountType())
        })

        $body.on('click', '#search_company_btn', function() {
            jQuery('#billing_company').val("")
            jQuery('#company_id').val("")
            Twoinc.getInstance().customerCompany = twoincDomHelper.getCompanyData()

            jQuery('#search_company_btn').hide()
            window.twoinc.company_name_search = 'yes'

            twoincDomHelper.toggleBusinessFields(twoincDomHelper.getAccountType())
        })

        // Handle the representative inputs blur event
        $body.on('blur', '#billing_first_name, #billing_last_name, #billing_email, #billing_phone', this.onRepresentativeInputBlur)

        // Handle the representative inputs blur event
        $body.on('blur', '#company_id, #billing_company_display', this.onCompanyManualInputBlur)

        // Handle the phone inputs change event
        $body.on('change', '#billing_phone_display', this.onPhoneInputChange)
        $body.on('keyup', '#billing_phone_display', this.onPhoneInputChange)
        setTimeout(function(){
            jQuery('.iti__country-list').on('click', Twoinc.getInstance().onPhoneInputChange)
        }, 1000)

        // Handle the company inputs change event
        $body.on('change', '#select2-billing_company_display-container', twoincDomHelper.togglePaySubtitleDesc)
        $body.on('change', '#billing_company', function() {
            Twoinc.getInstance().customerCompany.company_name = twoincDomHelper.getCompanyName()
            twoincDomHelper.togglePaySubtitleDesc()
        })

        // Handle the country inputs change event
        $body.on('change', '#billing_country', this.onCountryInputChange)

        $body.on('click', '#place_order', function(){
            clearInterval(Twoinc.getInstance().orderIntentCheck.interval)
            Twoinc.getInstance().orderIntentCheck.interval = null
            Twoinc.getInstance().orderIntentCheck.pendingCheck = false
        })

        $body.on('checkout_error', function(){
            clearInterval(Twoinc.getInstance().orderIntentCheck.interval)
            Twoinc.getInstance().orderIntentCheck.interval = null
            Twoinc.getInstance().orderIntentCheck.pendingCheck = false
        })

        // Handle account type change
        $body.on('change', '[name="account_type"]', this.onChangeAccountType)

        setInterval(function(){
            if (Twoinc.getInstance().orderIntentCheck.pendingCheck) Twoinc.getInstance().getApproval()
            twoincDomHelper.saveCheckoutInputs()
        }, 3000)

        // Add customization for current theme if any
        twoincDomHelper.insertCustomCss()

        twoincDomHelper.loadUserMetaInputs()
        if (loadSavedInputs) twoincDomHelper.loadStorageInputs()
        if (jQuery('.floating-company-id') && jQuery('.floating-company-id').text()) {
            // Trigger address search
            Twoinc.getInstance().getAddress()
        }
        this.initBillingPhoneDisplay()
        setTimeout(function(){
            twoincDomHelper.saveCheckoutInputs()
            Twoinc.getInstance().customerCompany = twoincDomHelper.getCompanyData()
            Twoinc.getInstance().customerRepresentative = twoincDomHelper.getRepresentativeData()
            twoincDomHelper.insertFloatingCompany(Twoinc.getInstance().customerCompany.organization_number, 0)
            Twoinc.getInstance().getApproval()
        }, 1000)
        this.updateElements()
        this.isInitialized = true
    }

    /**
     * Get singleton instance
     */
    static getInstance() {
        if (!instance) instance = new Twoinc()
        return instance
    }


    /**
     * Initialize billing phone display
     */
    initBillingPhoneDisplay() {

        let billingPhoneInputField = document.querySelector("#billing_phone_display")
        if (!billingPhoneInputField) return

        this.billingPhoneInput = window.intlTelInput(billingPhoneInputField, {
            utilsScript: window.twoinc.intl_tel_input_utils_js,
            preferredCountries: [window.twoinc.shop_base_country],
            separateDialCode: true,
            customPlaceholder: function(selectedCountryPlaceholder, selectedCountryData) {
                if (selectedCountryData.iso2 === 'gb') {
                    return '7700 900077'
                } else if (selectedCountryData.iso2 === 'no') {
                    return '073 70143'
                }
                else if(selectedCountryData.iso2 === 'se') {
                    return '765 195 285'
                }
                return selectedCountryPlaceholder.replace(/[0-9]/g, 'X')
            }
        })
        if (jQuery('#billing_phone').length > 0) {
            this.billingPhoneInput.setNumber(jQuery('#billing_phone').val())
        }
    }

    /**
     * Check if all the required details are collected
     *
     * @returns {boolean}
     */
    updateElements() {

        // Check approval again
        this.getApproval()

        // Toggle the action buttons
        twoincDomHelper.toggleActions()

        // Enable or disable the Twoinc method
        twoincDomHelper.toggleMethod(this.isTwoincMethodHidden)

        // Update the text in subtitle and description
        twoincDomHelper.togglePaySubtitleDesc()

        // Rearrange the DOMs in Twoinc payment
        twoincDomHelper.rearrangeDescription()

        // Display correct payment description
        twoincDomHelper.togglePaymentDesc()

        this.toggleDueInDays()
        this.getDueInDays()

    }

    /**
     * Check if all the required details are collected
     *
     * @returns {boolean}
     */
    isReadyApprovalCheck() {

        if (window.twoinc.enable_order_intent !== 'yes') {
            return false
        }

        if (!Twoinc.getInstance().customerCompany.organization_number) {
            return false
        }

        let values = [].concat(Object.values(this.customerCompany))

        return !twoincUtilHelper.isAnyElementEmpty(values)

    }

    /**
     * Check the company approval status by creating an order intent
     */
    getApproval() {

        if (!this.isReadyApprovalCheck()) return

        if (this.orderIntentCheck.interval) {
            this.orderIntentCheck.pendingCheck = true
            return
        }

        this.orderIntentCheck.interval = setInterval(function() {
            let gross_amount = twoincDomHelper.getPrice('order-total')
            let tax_amount = twoincDomHelper.getPrice('tax-rate')
            if (!gross_amount) {
                return
            }
            if (!tax_amount) {
                tax_amount = 0
            }
            let net_amount = gross_amount - tax_amount

            let jsonBody = JSON.stringify({
                "merchant_short_name": window.twoinc.merchant_short_name,
                "gross_amount": "" + gross_amount,
                "invoice_type": 'FUNDED_INVOICE',
                "buyer": {
                    "company": Twoinc.getInstance().customerCompany,
                    "representative": Twoinc.getInstance().customerRepresentative
                },
                "currency": window.twoinc.currency,
                "line_items": [{
                    "name": "Cart",
                    "description": "",
                    "gross_amount": gross_amount.toFixed(2),
                    "net_amount": net_amount.toFixed(2),
                    "discount_amount": "0",
                    "tax_amount": tax_amount.toFixed(2),
                    "tax_class_name": "VAT " + (100.0 * tax_amount / net_amount).toFixed(2) + "%",
                    "tax_rate": "" + (1.0 * tax_amount / net_amount).toFixed(6),
                    "unit_price": net_amount.toFixed(2),
                    "quantity": 1,
                    "quantity_unit": "item",
                    "image_url": "",
                    "product_page_url": "",
                    "type": "PHYSICAL",
                    "details": {
                        "categories": [],
                        "barcodes": []
                    },
                }]
            })

            let hashedBody = twoincUtilHelper.getUnsecuredHash(jsonBody)
            if (Twoinc.getInstance().orderIntentLog[hashedBody]) {
                twoincDomHelper.togglePaySubtitleDesc(...Twoinc.getInstance().orderIntentLog[hashedBody].split('|'))
                return
            }
            Twoinc.getInstance().orderIntentCheck['lastCheckHash'] = hashedBody

            clearInterval(Twoinc.getInstance().orderIntentCheck.interval)
            Twoinc.getInstance().orderIntentCheck.interval = null
            Twoinc.getInstance().orderIntentCheck.pendingCheck = false

            if (!Twoinc.getInstance().isReadyApprovalCheck()) return

            twoincDomHelper.togglePaySubtitleDesc('checking-intent')

            // Create an order intent
            const approvalResponse = jQuery.ajax({
                url: twoincUtilHelper.contructTwoincUrl('/v1/order_intent'),
                contentType: "application/json; charset=utf-8",
                dataType: 'json',
                method: 'POST',
                xhrFields: {withCredentials: true},
                data: jsonBody
            })

            approvalResponse.done(function(response){

                // Store the approved state
                Twoinc.getInstance().isTwoincApproved = response.approved

                // Toggle the Twoinc payment method
                Twoinc.getInstance().isTwoincMethodHidden = !(Twoinc.getInstance().isTwoincApproved && twoincUtilHelper.isCompany(twoincDomHelper.getAccountType()))

                // Show or hide the Twoinc payment method
                twoincDomHelper.toggleMethod(Twoinc.getInstance().isTwoincMethodHidden)

                // Display correct payment description
                window.twoinc.is_direct_invoice = (response.invoice_type && response.invoice_type === 'DIRECT_INVOICE')
                twoincDomHelper.togglePaymentDesc()

                // Select the default payment method
                twoincDomHelper.selectDefaultMethod(Twoinc.getInstance().isTwoincMethodHidden)

                // Update tracking number
                if (response.tracking_id && document.querySelector('#tracking_id')) {
                    document.querySelector('#tracking_id').value = response.tracking_id
                }

                // Display messages and update order intent logs
                Twoinc.getInstance().processOrderIntentResponse(response)

            })

            approvalResponse.fail(function(response){

                // Store the approved state
                Twoinc.getInstance().isTwoincApproved = false

                // Toggle the Twoinc payment method
                Twoinc.getInstance().isTwoincMethodHidden = true

                // Show or hide the Twoinc payment method
                twoincDomHelper.toggleMethod(Twoinc.getInstance().isTwoincMethodHidden)

                // Select the default payment method
                twoincDomHelper.selectDefaultMethod(Twoinc.getInstance().isTwoincMethodHidden)

                // Display messages and update order intent logs
                Twoinc.getInstance().processOrderIntentResponse(response)

            })
        }, 1000)

    }

    /**
     * Update page after order intent request complete
     */
    processOrderIntentResponse(response)
    {
        let displayMsgId = ''
        let invalidFields = []

        if (response.approved) {

            displayMsgId = 'intent-approved'

        } else {

            // Display error messages
            if (response.status >= 400) {
                // @TODO: use code in checkout-api
                let errMsg = response.responseJSON
                if (typeof response.responseJSON !== 'string') {
                    if ('error_details' in response.responseJSON && response.responseJSON['error_details']) {
                        errMsg = response.responseJSON['error_details']
                    } else if ('error_code' in response.responseJSON && response.responseJSON['error_code']) {
                        errMsg = response.responseJSON['error_code']
                    }
                }

                if (errMsg.startsWith('Minimum Payment using ')) {
                    displayMsgId = 'errored|.err-amt-min'
                } else if (errMsg.startsWith('Maximum Payment using ')) {
                    displayMsgId = 'errored|.err-amt-max'
                } else if (errMsg.includes('Invalid phone number')) {
                    displayMsgId = 'errored|.err-phone'
                    invalidFields.append('billing_phone_field')
                } else if (errMsg === 'SAME_BUYER_SELLER_ERROR') {
                    displayMsgId = 'errored|.err-buyer-same-seller'
                } else {
                    displayMsgId = 'errored|.err-payment-default'
                }
            } else {
                let errMsg = null
                if (response.approved === false) { // rejected
                    displayMsgId = 'errored|.err-payment-rejected'
                } else {
                    displayMsgId = 'errored|.err-payment-default'
                }
            }

            // Update order intent log
            this.orderIntentCheck['lastCheckOk'] = response.approved
            // this.orderIntentLog = {}
            this.orderIntentLog[this.orderIntentCheck['lastCheckHash']] = displayMsgId

        }

        // Update twoinc message
        let twoincSubtitleExistCheck = setInterval(function() {
            if (jQuery('#payment .blockOverlay').length === 0) {
                // woocommerce's update_checkout is not running
                twoincDomHelper.togglePaySubtitleDesc(...displayMsgId.split('|'))
                for (let fld of invalidFields) {
                    twoincDomHelper.markFieldInvalid(fld)
                }
                clearInterval(twoincSubtitleExistCheck)
            }
        }, 1000)

    }

    /**
     * Get the address from address search
     */
    getAddress()
    {

        // Get country
        let country_prefix = Twoinc.getInstance().customerCompany.country_prefix
        if (!country_prefix || !['GB', 'SE'].includes(country_prefix)) country_prefix = 'NO'


        // Get company ID
        let company_id = jQuery('#company_id').val()

        const addressResponse = jQuery.ajax({
            dataType: 'json',
            url: twoincUtilHelper.contructTwoincUrl('/v1/' + country_prefix + '/company/' + company_id + '/address')
        })

        addressResponse.done(function(response){

            // If we have the company location
            if (response.address) {

                // Get the company location object
                const companyLocation = response.address

                // Populate the street name and house number fields
                jQuery('#billing_address_1').val(companyLocation.streetAddress)

                // Populate the city
                jQuery('#billing_city').val(companyLocation.city)

                // Populate the postal code
                jQuery('#billing_postcode').val(companyLocation.postalCode)

                // Update order review in case there is a shipping change
                jQuery(document.body).trigger('update_checkout')

            }

        })

    }

    /**
     * Get the actual due in days to display on page
     */
    getDueInDays()
    {

        if (!Twoinc.getInstance().customerCompany || !Twoinc.getInstance().customerCompany.organization_number
            || !Twoinc.getInstance().customerCompany.country_prefix) return

        let jsonBody = JSON.stringify({
            "merchant_short_name": window.twoinc.merchant_short_name,
            "buyer_organization_number": Twoinc.getInstance().customerCompany.organization_number,
            "country_prefix": Twoinc.getInstance().customerCompany.country_prefix
        })

        // Create a get due in days request
        const dueInDaysResponse = jQuery.ajax({
            url: twoincUtilHelper.contructTwoincUrl('/v1/payment_terms'),
            contentType: "application/json; charset=utf-8",
            dataType: 'json',
            method: 'POST',
            data: jsonBody
        })

        dueInDaysResponse.done(function(response){

            window.twoinc.custom_due_in_days = typeof response.due_in_days !== 'undefined'

            Twoinc.getInstance().toggleDueInDays()

        })

        dueInDaysResponse.fail(function(response){

            Twoinc.getInstance().toggleDueInDays()

        })
    }


    /**
     * Display due in days only if the buyer does not have custom payment term
     */
    toggleDueInDays() {
        if (window.twoinc.custom_due_in_days) {
            jQuery('.payment-term-number').hide()
            jQuery('.payment-term-nonumber').show()
        } else {
            jQuery('.payment-term-nonumber').hide()
            jQuery('.payment-term-number').show()
        }
    }


    /**
     * Handle the woocommerce updated checkout event
     */
    onUpdatedCheckout() {

        Twoinc.getInstance().updateElements()

        jQuery('#payment_method_kco').on('change', Twoinc.getInstance().onChangedToKco)

        jQuery('#payment_method_woocommerce-gateway-tillit').on('change', function(){
            // If current selected payment is Twoinc, clicking "business" will select Twoinc payment again
            if (twoincDomHelper.isSelectedPaymentTwoinc()) {
                sessionStorage.setItem('businessClickToTwoinc', 'y')
            }
        })

        jQuery('input[name="payment_method"]').on('change', function(){
            twoincDomHelper.toggleBusinessFields(twoincDomHelper.getAccountType())
        })

        if (twoincDomHelper.isSelectedPaymentTwoinc()) {
            sessionStorage.setItem('businessClickToTwoinc', 'y')
        }

        // Hide and clear unnecessary payment methods
        twoincDomHelper.toggleMethod(Twoinc.getInstance().isTwoincMethodHidden)
        jQuery('#payment .wc_payment_methods input.input-radio').each(function() {
            setTimeout(function() {
                if (jQuery(this).is(":hidden")) {
                    twoincDomHelper.deselectPaymentMethod(jQuery(this))
                }
            }, 1000)
        })
        twoincDomHelper.rearrangeDescription()

        // Disable click to return to Twoinc/Kco if some other payment method is selected
        jQuery('.wc_payment_method:not(.payment_method_woocommerce-gateway-tillit):not(.payment_method_kco)').on('click', function() {
            sessionStorage.removeItem('privateClickToKco')
            sessionStorage.removeItem('businessClickToTwoinc')
        })

    }

    /**
     * Handle the account type change
     */
    onChangeAccountType() {

        // Get the input
        const $input = jQuery(this)

        // Get the account type
        const accountType = twoincDomHelper.getAccountType()

        // Hide the method for non-business accounts
        if (!twoincUtilHelper.isCompany(accountType)) {
            Twoinc.getInstance().isTwoincMethodHidden = true
            // Clear method tick
            twoincDomHelper.deselectPaymentMethod(jQuery('#payment_method_woocommerce-gateway-tillit'))
        } else if (Twoinc.getInstance().isTwoincApproved) {
            Twoinc.getInstance().isTwoincMethodHidden = false
            // Force select twoinc payment
            jQuery('#payment_method_woocommerce-gateway-tillit').click()
        }

        // Toggle the business fields
        twoincDomHelper.toggleBusinessFields($input.val())

        // Move the fields to correct positions
        twoincDomHelper.positionFields()

        // Show or hide the payment method
        // twoincDomHelper.toggleMethod(Twoinc.getInstance().isTwoincMethodHidden)

    }

    /**
     * Handle the company manual input changes
     *
     * @param event
     */

    onCompanyManualInputBlur(event) {

        const $input = jQuery(this)

        let inputName = $input.attr('name')

        if (inputName === 'company_id') {
            Twoinc.getInstance().customerCompany.organization_number = $input.val()
        } else if (inputName === 'billing_company_display') {
            Twoinc.getInstance().customerCompany.company_name = $input.val()
        }

        Twoinc.getInstance().getApproval()

    }

    /**
     * Handle the representative input changes
     *
     * @param event
     */

    onRepresentativeInputBlur(event)
    {

        const $input = jQuery(this)

        let inputName = $input.attr('name').replace('billing_', '')

        if (inputName === 'phone') inputName += '_number'

        Twoinc.getInstance().customerRepresentative[inputName] = $input.val()

        Twoinc.getInstance().getApproval()

    }

    /**
     * Handle the phone number input changes
     *
     * @param event
     */

    onPhoneInputChange(event)
    {

        setTimeout(function(){
            let currentVal = jQuery('#billing_phone').attr('value')
            let newVal = Twoinc.getInstance().billingPhoneInput.getNumber()
            if (newVal && currentVal !== newVal) {
                jQuery('#billing_phone').val(newVal)
                jQuery('#billing_phone').attr('value', newVal)
                Twoinc.getInstance().customerRepresentative['phone_number'] = newVal
                // Twoinc.getInstance().getApproval()
            }
        }, 200)

    }

    /**
     * Handle the country input changes
     *
     * @param event
     */

    onCountryInputChange(event)
    {

        const $input = jQuery(this)

        Twoinc.getInstance().customerCompany.country_prefix = $input.val()

        twoincDomHelper.toggleBusinessFields(twoincDomHelper.getAccountType())

        twoincDomHelper.clearSelectedCompany()

        Twoinc.getInstance().getApproval()

    }

    /**
     * Handle when Kco payment is selected
     *
     * @param event
     */

    onChangedToKco(event)
    {

        let accountType = twoincDomHelper.getAccountType()
        if (twoincUtilHelper.isCompany(accountType)) accountType = 'personal'
        sessionStorage.setItem('twoincAccountType', accountType)

    }

}


let instance = null
let isSelectedPaymentTwoinc = null
jQuery(function(){
    if (window.twoinc) {

        if (window.twoinc.enable_order_intent === 'yes') {
            if (jQuery('#payment_method_woocommerce-gateway-tillit').length > 0) {
                // Run Twoinc code if order intent is enabled
                Twoinc.getInstance().initialize(true)
            }
        } else {

            // Handle initialization every time order review (right panel) is updated
            jQuery(document.body).on('updated_checkout', function(){

                // If shop defaults payment method to Twoinc, run Twoinc code
                if (twoincDomHelper.isSelectedPaymentTwoinc()) {
                    Twoinc.getInstance().initialize(false)
                    Twoinc.getInstance().onUpdatedCheckout()
                } else {
                    twoincDomHelper.toggleMethod(Twoinc.getInstance().isTwoincMethodHidden)
                }

                // Run Twoinc code if Twoinc payment is selected
                jQuery('#payment_method_woocommerce-gateway-tillit').on('change', function(){
                    Twoinc.getInstance().initialize(false)
                    Twoinc.getInstance().onUpdatedCheckout()
                })

                // Run Twoinc code if Business is selected
                if (twoincUtilHelper.isCompany(twoincDomHelper.getAccountType())) {
                    Twoinc.getInstance().initialize(false)
                    Twoinc.getInstance().onUpdatedCheckout()
                }

                // If invoice fee is charged to buyer, order price will change when payment method is changed from/to Twoinc
                // Also, run Twoinc code if payment method selected is Twoinc
                if (window.twoinc.invoice_fee_to_buyer === 'yes') {
                    isSelectedPaymentTwoinc = twoincDomHelper.isSelectedPaymentTwoinc()
                    if (isSelectedPaymentTwoinc) {
                        Twoinc.getInstance().initialize(false)
                        Twoinc.getInstance().onUpdatedCheckout()
                    }

                    // Update right sidebar order review when the payment method changes
                    jQuery('.woocommerce-checkout [name="payment_method"]').on('change', function() {
                        let currentSelectedPaymentTwoinc = twoincDomHelper.isSelectedPaymentTwoinc()
                        if (currentSelectedPaymentTwoinc || isSelectedPaymentTwoinc) {
                            jQuery(document.body).trigger('update_checkout')
                        }
                        isSelectedPaymentTwoinc = currentSelectedPaymentTwoinc
                        if (isSelectedPaymentTwoinc) {
                            Twoinc.getInstance().initialize(false)
                            Twoinc.getInstance().onUpdatedCheckout()
                        }
                    })
                }

            })

            // If last selected payment method is Twoinc, run Twoinc code anyway
            let lastSelectedPayment = twoincDomHelper.getCheckoutInput('INPUT', 'radio', 'payment_method')
            if (lastSelectedPayment && lastSelectedPayment.id === 'payment_method_woocommerce-gateway-tillit') {
                Twoinc.getInstance().initialize(true)
            }

            // Otherwise do not run Twoinc code
        }

        // Show or hide Twoinc payment method on account type change
        jQuery('.woocommerce-checkout [name="account_type"]').on('change', function() {
            twoincDomHelper.toggleMethod(Twoinc.getInstance().isTwoincMethodHidden)
        })

        // I can not find my company button
        jQuery('#billing_company_field').append(jQuery('#search_company_btn'))
        jQuery('#company_not_in_btn').hide()
        jQuery('#search_company_btn').hide()

        // Intitialization of DOMs
        twoincDomHelper.initAccountTypeButtons()

    }
})
