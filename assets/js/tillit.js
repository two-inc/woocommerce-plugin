let tillitUtilHelper = {

    /**
     * Check if selected account type is business
     */
    isCompany: function(accountType) {
        return accountType === 'business'
    },

    /**
     * Construct url to Tillit checkout api
     */
    contructTillitUrl: function(path, params = {}) {
        params['client'] = window.tillit.client_name
        params['client_v'] = window.tillit.client_version
        return window.tillit.tillit_checkout_host + path + '?' + (new URLSearchParams(params)).toString()
    },

    /**
     * Get error messages from plugin translation
     */
    getMessage: function(key) {

        if (key && key in window.tillit.messages) {
            return [window.tillit.messages[key],]
        }
        return []

    },

    /**
     * Hash some input to store as key
     */
    getUnsecuredHash: function(inp, seed = 0) {
        let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed
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

let tillitSelectWooHelper = {

    /**
     * Generate parameters for selectwoo
     */
    genSelectWooParams: function() {
        let countryParams = {
            "NO": {
                "tillit_search_host": window.tillit.tillit_search_host_no,
            },
            "GB": {
                "tillit_search_host": window.tillit.tillit_search_host_gb,
            }
        }

        let country = jQuery('#billing_country').val()

        if (country in countryParams) {
            let tillitSearchLimit = 50
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
                    url: function(params){
                        params.page = params.page || 1
                        return countryParams[country].tillit_search_host + '/search?limit=' + tillitSearchLimit + '&offset=' + ((params.page - 1) * tillitSearchLimit) + '&q=' + params.term
                    },
                    data: function()
                    {
                        return {}
                    },
                    processResults: function(response, params)
                    {

                        return {
                            results: tillitSelectWooHelper.extractItems(response),
                            pagination: {
                                more: (params.page * tillitSearchLimit) < response.data.total
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

        if (Tillit.getInstance().withCompanyNameSearch) {

            const instance = jQuery('.woocommerce-checkout #billing_company_display').data('select2')

            if (instance) {
                instance.on('open', function(e) {
                    this.results.clear()
                    this.dropdown._positionDropdown()
                })
                instance.on('results:message', function(e) {
                    this.dropdown._resizeDropdown()
                    this.dropdown._positionDropdown()
                })
            }

        }

    },

    /**
     * Fix for themes not supporting selectWoo css
     */
    fixSelectWooHeightUnsupportedCss: function() {

        setTimeout(function(){
            if (jQuery('#billing_company_display_field .select2-container').outerHeight() < 0.9 * jQuery('#billing_email').outerHeight()) {
                jQuery('span[aria-labelledby="select2-billing_company_display-container"]').outerHeight(jQuery('#billing_email').outerHeight())
                jQuery('[aria-labelledby="select2-billing_company_display-container"]>span').css('height', '100%')
                jQuery('#select2-billing_company_display-container').css('line-height', jQuery('#select2-billing_company_display-container').innerHeight() + 'px')
            }
        }, 2000)

    },

    /**
     * Extract and format the dropdown options
     */
    extractItems: function(results) {

        if (results.status !== 'success') return []

        const items = []

        for(let i = 0; i < results.data.items.length; i++) {

            const item = results.data.items[i]

            items.push({
                id: item.name,
                text: item.name,
                html: item.highlight + ' (' + item.id + ')',
                company_id: item.id,
                approved: false
            })

        }

        return items

    }

}

let tillitDomHelper = {

    /**
     * Initialize account type buttons
     */
    initAccountTypeButtons: function($el, name) {

        setTimeout(function(){
            // Move the account type DOM to before Billing
            jQuery('#woocommerce-account-type-container').parent().parent().prepend(jQuery('#woocommerce-account-type-container'))
            // Select the account type button based on radio val
            let accountType = tillitDomHelper.getAccountType()
            if (accountType) {
                jQuery('form.checkout.woocommerce-checkout').prepend(jQuery('.account-type-wrapper'))
                jQuery('.account-type-button[account-type-name="' + accountType + '"]').addClass('selected')
            }

            if (jQuery('#klarna-checkout-select-other').length > 0) {
                jQuery('#klarna-checkout-select-other').on('click', function() {
                    sessionStorage.setItem('tillitAccountType', 'business')
                })
                jQuery('.account-type-button[account-type-name="business"]').on('click', function() {
                    sessionStorage.setItem('tillitAccountType', tillitDomHelper.getAccountType())
                    sessionStorage.setItem('privateClickToKlarna', 'y')
                    jQuery('#klarna-checkout-select-other').click()
                })
            } else if (jQuery('.woocommerce-account-type-fields').length > 0) {
                jQuery('.account-type-button[account-type-name="personal"]').on('click', function() {
                    sessionStorage.setItem('tillitAccountType', tillitDomHelper.getAccountType())
                    if (sessionStorage.getItem('privateClickToKlarna') === 'y') {
                        jQuery('#payment_method_kco').click()
                        sessionStorage.removeItem('privateClickToKlarna')
                    }
                })
                jQuery('.account-type-button[account-type-name="sole_trader"]').on('click', function() {
                    sessionStorage.setItem('tillitAccountType', tillitDomHelper.getAccountType())
                    if (sessionStorage.getItem('privateClickToKlarna') === 'y') {
                        jQuery('#payment_method_kco').click()
                        sessionStorage.removeItem('privateClickToKlarna')
                    }
                })
            }

            jQuery('.account-type-button').on('click', function() {
                sessionStorage.setItem('tillitAccountType', tillitDomHelper.getAccountType())
            })

            // Select last saved account type in case of redirect from another payment method
            accountType = sessionStorage.getItem('tillitAccountType')
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
            jQuery('.account-type-wrapper').hide()
        }

        // Hide the radio buttons
        jQuery('.woocommerce-account-type-fields__field-wrapper').hide()
        jQuery('#account_type_field').hide()

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
        let $placeholder = jQuery('#tillit-'+ name +'-source')

        // Stop if we already have a placeholder
        if ($placeholder.length > 0) return

        // Create a placeholder
        $placeholder = jQuery('<div id="tillit-'+ name +'-source" class="tillit-source"></div>')

        // Add placeholder after element
        $placeholder.insertAfter($el)

    },

    /**
     * Move a field to Tillit template location and leave a placeholder
     */
    moveField: function(selector, name) {

        // Get the element
        const $el = jQuery('#' + selector)

        // Add a placeholder
        tillitDomHelper.addPlaceholder($el, name)

        // Get the target
        const $target = jQuery('#tillit-' + name + '-target')

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
        const $source = jQuery('#tillit-' + name + '-source')

        // Move the input
        if ($source.length > 0) {
            $el.insertAfter($source)
        }

    },

    /**
     * Move the fields to their original or Tillit template location
     */
    positionFields: function() {

        setTimeout(function(){
            // Get the account type
            const accountType = tillitDomHelper.getAccountType()

            // If business account
            if (tillitUtilHelper.isCompany(accountType)) {
                tillitDomHelper.moveField('billing_first_name_field', 'fn')
                tillitDomHelper.moveField('billing_last_name_field', 'ln')
                tillitDomHelper.moveField('billing_phone_display_field', 'ph')
                tillitDomHelper.moveField('billing_email_field', 'em')

                // Hide/Show the divs
                jQuery('.tillit-source').hide()
                jQuery('.tillit-target').show()
            } else {
                tillitDomHelper.revertField('billing_first_name_field', 'fn')
                tillitDomHelper.revertField('billing_last_name_field', 'ln')
                tillitDomHelper.revertField('billing_phone_display_field', 'ph')
                tillitDomHelper.revertField('billing_email_field', 'em')

                // Hide/Show the divs
                jQuery('.tillit-target').hide()
                jQuery('.tillit-source').show()
            }
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
     * Toggle the required property for company fields
     */
    toggleRequiredFields($targets, is_required) {

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
                if ($row.find('label .tillit-required').length == 0) {
                    $row.find('label').append('<abbr class="required tillit-required" title="required">*</abbr>')
                }
                $row.find('label .optional').hide()
            } else {
                $input.attr('required', false)

                // Show the hidden optional visual cue
                $row.find('label .tillit-required').remove()
                $row.find('label .optional').show()
            }

        })

    },

    /**
     * Toggle the company fields
     */
    toggleCompanyFields(accountType) {

        // Get the targets
        let $visibleNoncompanyTargets = '#billing_phone_field, #billing_company_field'
        let $visibleCompanyTargets = '.woocommerce-company-fields, .woocommerce-representative-fields, #company_id_field, #billing_company_display_field, #billing_phone_display_field'
        let $requiredCompanyTargets = '#billing_phone_display_field'
        if (window.tillit.company_name_search !== 'yes') {
            $visibleCompanyTargets += ', #billing_company_field'
            $requiredCompanyTargets += ', #billing_company_field'
        }
        if (window.tillit.mark_tillit_fields_required === 'yes') {
            $requiredCompanyTargets = $visibleCompanyTargets
        }
        $visibleCompanyTargets += ', #department_field, #project_field'
        $requiredCompanyTargets = jQuery($requiredCompanyTargets)
        $visibleCompanyTargets = jQuery($visibleCompanyTargets)
        $visibleNoncompanyTargets = jQuery($visibleNoncompanyTargets)

        // Toggle the targets based on the account type
        const isTillitVisible = jQuery('#payment_method_woocommerce-gateway-tillit').length !== 0
        if (isTillitVisible) {
            jQuery('#account_type_field').removeClass('hidden')
        } else {
            jQuery('#account_type_field').addClass('hidden')
        }
        const isTillitAvailable = isTillitVisible && tillitUtilHelper.isCompany(accountType)
        if (isTillitAvailable) {
            $visibleNoncompanyTargets.addClass('hidden')
            $visibleCompanyTargets.removeClass('hidden')
        } else {
            $visibleCompanyTargets.addClass('hidden')
            $visibleNoncompanyTargets.removeClass('hidden')
        }

        // Toggle the required fields based on the account type
        tillitDomHelper.toggleRequiredFields($requiredCompanyTargets, isTillitAvailable)

    },

    /**
     * Hide or show the Tillit payment method
     */
    toggleMethod: function(isTillitMethodHidden) {

        // Get the Tillit payment method section
        const $tillitSection = jQuery('#payment .wc_payment_methods > li.payment_method_woocommerce-gateway-tillit')
        const $otherPaymentSections = jQuery('#payment .wc_payment_methods > li:not([class*="payment_method_woocommerce-gateway-tillit"])')

        // Get the Tillit payment method input
        const $tillitBox = jQuery(':input[value="woocommerce-gateway-tillit"]')

        // True if the Tillit payment method is disabled
        const isTillitDisabled = window.tillit.enable_order_intent === 'yes' && isTillitMethodHidden === true

        // If Tillit is disabled
        if (isTillitDisabled) {

            $tillitBox.prop('checked', false)

        }

        // Disable the Tillit payment method for non-business orders
        $tillitBox.attr('disabled', isTillitDisabled)

        if (tillitUtilHelper.isCompany(tillitDomHelper.getAccountType())) {

            // Show Tillit payment option
            $tillitSection.removeClass('hidden')

            // If Tillit is approved and setting is to hide other payment methods
            if (window.tillit.display_other_payments !== 'yes') {
                if (isTillitDisabled) $otherPaymentSections.show()
                else $otherPaymentSections.hide()
            }

        } else {

            // Hide Tillit payment option
            $tillitSection.addClass('hidden')

            // Always show other methods for non-business purchases
            $otherPaymentSections.show()

        }

    },

    /**
     * Select the default payment method
     */
    selectDefaultMethod: function(isTillitMethodHidden) {

        // Get the Tillit payment method input
        const $tillitPaymentMethod = jQuery(':input[value="woocommerce-gateway-tillit"]')

        // Get the Tillit payment block
        const $tillitPmBlk = jQuery('.payment_method_woocommerce-gateway-tillit')

        // True if the Tillit payment method is disabled
        const isTillitDisabled = window.tillit.enable_order_intent === 'yes' && isTillitMethodHidden === true

        // Disable the Tillit payment method for non-business orders
        $tillitPaymentMethod.attr('disabled', isTillitDisabled)

        // If tillit method cannot be used
        if (isTillitDisabled) {

            // Fallback if set in admin and current account type is business
            if (window.tillit.fallback_to_another_payment === 'yes' && tillitUtilHelper.isCompany(tillitDomHelper.getAccountType())) {
                // Select the first visible payment method
                $tillitPmBlk.parent().find('li:visible').eq(0).find(':radio').click()
            }

        } else {

            // Select the payment method for business accounts
            $tillitPaymentMethod.click()

        }

    },

    /**
     * Toggle Place order button
     */
    toggleActions: function() {

        // Get the account type
        const accountType = tillitDomHelper.getAccountType()

        // Get the payment method
        const paymentMethod = jQuery(':input[name="payment_method"]:checked').val()

        // Get the place order button
        const $placeOrder = jQuery('#place_order')

        // Disable the place order button if order is non-business and payment method is Tillit
        $placeOrder.attr('disabled', !tillitUtilHelper.isCompany(accountType) && paymentMethod === 'woocommerce-gateway-tillit')

    },

    /**
     * Update company name in payment method aggrement section
     */
    updateCompanyNameAgreement: function() {

        if (document.querySelector('#select2-billing_company_display-container') && document.querySelector('#select2-billing_company_display-container').innerText) {
            document.querySelector('.tillit-buyer-name').innerText = document.querySelector('#select2-billing_company_display-container').innerText
            document.querySelector('.tillit-buyer-name').classList.remove('hidden')
            document.querySelector('.tillit-buyer-name-placeholder').classList.add('hidden')
        } else if (document.querySelector('#billing_company') && document.querySelector('#billing_company').value) {
            document.querySelector('.tillit-buyer-name').innerText = document.querySelector('#billing_company').value
            document.querySelector('.tillit-buyer-name').classList.remove('hidden')
            document.querySelector('.tillit-buyer-name-placeholder').classList.add('hidden')
        } else {
            document.querySelector('.tillit-buyer-name').classList.add('hidden')
            document.querySelector('.tillit-buyer-name-placeholder').classList.remove('hidden')
        }

    },

    /**
     * Get company data from current HTML inputs
     */
    getCompanyData: function()
    {

        return {
            'company_name': jQuery('#billing_company').val(),
            'country_prefix': jQuery('#billing_country').val(),
            'organization_number': jQuery('#company_id').val()
        }

    },

    /**
     * Get representative data from current HTML inputs
     */
    getRepresentativeData: function()
    {

        return {
            'email': jQuery('#billing_email').val(),
            'first_name': jQuery('#billing_first_name').val(),
            'last_name': jQuery('#billing_last_name').val(),
            'phone_number': jQuery('#billing_phone').val()
        }

    },

    /**
     * Check if tillit payment is currently selected
     */
    isSelectedPaymentTillit: function() {
        return jQuery('input[name="payment_method"]:checked').val() === 'woocommerce-gateway-tillit'
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
                let val = tillitDomHelper.getPriceRecursively(n)
                if (val) {
                    return val
                }
            }
        }
        if (node.nodeName === '#text') {
            let val = node.textContent
                .replaceAll(window.tillit.price_thousand_separator, '')
                .replaceAll(window.tillit.price_decimal_separator, '.')
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
        return tillitDomHelper.getPriceRecursively(node)
    },

    /**
     * Get HTML for ajax loader icon
     */
    getLoaderHtml: function() {

        let img = document.createElement("IMG")
        img.src = window.tillit.tillit_plugin_url + '/assets/images/loader.svg'
        img.className = 'loader'
        return img

    },

    /**
     * Rearrange descriptions in Tillit payment to make it cleaner
     */
    rearrangeDescription: function() {

        let parent = jQuery('.wc_payment_method.payment_method_woocommerce-gateway-tillit')

        if (parent.length > 0) {
            parent.append(jQuery('label[for="payment_method_woocommerce-gateway-tillit"] .tillit-subtitle'))

            parent.append(jQuery('#abt-tillit-link'))

            if (parent.innerWidth() > 600) {
                jQuery('#abt-tillit-link').css('float', 'left')
                jQuery('#abt-tillit-link').css('margin-left', '28px')
            }
        }

    },

    /**
     * Save checkout inputs
     */
    saveCheckoutInputs: function() {
        let checkoutInputs = []
        let checkoutForm = document.querySelector('form[name="checkout"]')
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
                checkoutInputs.push({
                    'htmlTag': inp.tagName,
                    'id': inp.getAttribute('id'),
                    'parentLabel': inp.parentNode.getAttribute('aria-labelledby'),
                    'html': inp.outerHTML,
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
     * Load checkout inputs
     */
    loadCheckoutInputs: function() {
        let checkoutInputs = sessionStorage.getItem('checkoutInputs')
        if (!checkoutInputs) return
        checkoutInputs = JSON.parse(checkoutInputs)
        for (let inp of checkoutInputs) {
            if (inp.htmlTag === 'INPUT') {
                if (inp.val && ['text', 'tel', 'email', 'hidden'].indexOf(inp.type) >= 0) {
                    if (document.querySelector('#' + inp.id) && !(document.querySelector('#' + inp.id).value)) {
                        document.querySelector('#' + inp.id).value = inp.val
                    }
                } else if (inp.type === 'radio') {
                    if (document.querySelector('#' + inp.id)) {
                        document.querySelector('#' + inp.id).click()
                    }
                } else if (inp.type === 'checkbox') {
                    if (inp.val && document.querySelector('#' + inp.id)) {
                        document.querySelector('#' + inp.id).checked = true
                    }
                }
            } else if (inp.htmlTag === 'SPAN') {
                if (inp.parentLabel && inp.html) {
                    if (document.querySelector('#' + inp.id)) {
                        document.querySelector('#' + inp.id).remove()
                    }
                    let parentNode = document.querySelector('[aria-labelledby="' + inp.parentLabel + '"]')
                    if (parentNode) parentNode.innerHTML = inp.html + parentNode.innerHTML
                }
            } else if (inp.htmlTag === 'SELECT') {
                if (inp.val && inp.optionHtml) {
                    let selectElem = document.querySelector('#' + inp.id)
                    if (selectElem) {
                        if (!selectElem.querySelector('option[value="' + inp.value + '"]')) {
                            selectElem.innerHTML = inp.optionHtml + selectElem.innerHTML
                        }
                        selectElem.value = inp.val
                    }
                }
            }
        }
    }

}

class Tillit {

    static instance = null
    isInitialized = false
    withCompanyNameSearch = false
    isTillitMethodHidden = true
    isTillitApproved = null
    billingPhoneInput = null
    orderIntentCheck = {
        'interval': null,
        'pendingCheck': false,
        'lastCheckOk': false,
        'lastCheckHash': null
    }
    orderIntentLog = {}
    customerCompany = {
        'company_name': null,
        'country_prefix': null,
        'organization_number': null
    }
    customerRepresentative = {
        'email': null,
        'first_name': null,
        'last_name': null,
        'phone_number': null
    }

    constructor()
    {

        if (Tillit.instance) {
            throw 'Tillit is a singleton';
        }
        Tillit.instance = this
        this.withCompanyNameSearch = window.tillit.company_name_search && window.tillit.company_name_search === 'yes'

    }

    /**
     * Initialize Tillit code
     */
    initialize(loadSavedInputs) {
        if (this.isInitialized) {
            return
        }
        const $body = jQuery(document.body)

        // Get the checkout form
        const $checkout = jQuery('.woocommerce-checkout')

        // Stop if not the checkout page
        if ($checkout.length === 0) return

        // Get the billing country field
        const $billingCountry = $checkout.find('#billing_country')

        // Get the billing company field
        const $billingCompanyDisplay = $checkout.find('#billing_company_display')
        const $billingCompany = $checkout.find('#billing_company')

        // Get the company ID field
        const $companyId = $checkout.find('#company_id')

        // If we found the field
        if (jQuery('[name="account_type"]:checked').length > 0) {

            // Get the account type
            const accountType = tillitDomHelper.getAccountType()

            // Toggle the company fields
            tillitDomHelper.toggleCompanyFields(accountType)

            // Move the fields to correct positions
            tillitDomHelper.positionFields()

        }

        if (this.withCompanyNameSearch) {

            // Reinitiate company select on country change
            $billingCountry.on('select2:select', function(e){
                // Clear company inputs
                $billingCompanyDisplay.html('')
                $billingCompanyDisplay.selectWoo(tillitSelectWooHelper.genSelectWooParams())
                tillitSelectWooHelper.fixSelectWooPositionCompanyName()
                jQuery('#company_id').val('')

                // Clear the addresses, in case address get request fails
                jQuery('#billing_address_1').val('')
                jQuery('#billing_city').val('')
                jQuery('#billing_postcode').val('')
            })

            // Focus on search input on country open
            $billingCountry.on('select2:open', function(e){
                setTimeout(function(){
                    if (jQuery('input[aria-owns="select2-billing_country-results"]').get(0)) {
                        jQuery('input[aria-owns="select2-billing_country-results"]').get(0).focus()
                    }
                }, 200)
            })

            // Turn the select input into select2
            setTimeout(function(){
                const $billingCompanySelect = $billingCompanyDisplay.selectWoo(tillitSelectWooHelper.genSelectWooParams())
                $billingCompanySelect.on('select2:select', function(e){

                    // Get the option data
                    const data = e.params.data

                    if (window.tillit.company_id_search && window.tillit.company_id_search === 'yes') {

                        // Set the company ID
                        Tillit.getInstance().customerCompany.organization_number = data.company_id

                        // Set the company ID to HTML DOM
                        $companyId.val(data.company_id)

                        // Set the company name to HTML DOM
                        $billingCompany.val(data.id)

                    }

                    // Set the company name
                    Tillit.getInstance().customerCompany.company_name = data.id

                    // Get the company approval status
                    Tillit.getInstance().getApproval()

                    // Get country
                    let country_prefix = Tillit.getInstance().customerCompany.country_prefix
                    if (!country_prefix || !['GB'].includes(country_prefix)) country_prefix = 'NO'

                    // Clear the addresses, in case address get request fails
                    jQuery('#billing_address_1').val('')
                    jQuery('#billing_city').val('')
                    jQuery('#billing_postcode').val('')

                    // Fetch the company data
                    const addressResponse = jQuery.ajax({
                        dataType: 'json',
                        url: tillitUtilHelper.contructTillitUrl('/v1/' + country_prefix + '/company/' + jQuery('#company_id').val() + '/address')
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

                        }

                    })

                })

                tillitSelectWooHelper.fixSelectWooPositionCompanyName()

                $billingCompanySelect.on('select2:open', function(e){
                    setTimeout(function(){
                        if (jQuery('input[aria-owns="select2-billing_company_display-results"]').get(0)) {
                            jQuery('input[aria-owns="select2-billing_company_display-results"]').get(0).focus()
                        }
                    }, 200)
                })
            }, 800)

        }

        // Disable or enable actions based on the account type
        $body.on('updated_checkout', function() {
            Tillit.getInstance().updateElements() // must be in function
        })

        // Handle the representative inputs blur event
        $body.on('blur', '#billing_first_name, #billing_last_name, #billing_email, #billing_phone', this.onRepresentativeInputBlur)

        // Handle the representative inputs blur event
        $body.on('blur', '#company_id, #billing_company_display', this.onCompanyManualInputBlur)

        // Handle the phone inputs change event
        $body.on('change', '#billing_phone_display', this.onPhoneInputChange)
        $body.on('keyup', '#billing_phone_display', this.onPhoneInputChange)
        setTimeout(function(){
            jQuery('.iti__country-list').on('click', Tillit.getInstance().onPhoneInputChange)
        }, 1000)

        // Handle the company inputs change event
        $body.on('change', '#select2-billing_company_display-container', tillitDomHelper.updateCompanyNameAgreement)
        $body.on('change', '#billing_company', tillitDomHelper.updateCompanyNameAgreement)

        // Handle the country inputs change event
        $body.on('change', '#billing_country', this.onCountryInputChange)

        $body.on('click', '#place_order', function(){
            clearInterval(Tillit.getInstance().orderIntentCheck.interval)
            Tillit.getInstance().orderIntentCheck.interval = null
            Tillit.getInstance().orderIntentCheck.pendingCheck = false
        })

        $body.on('checkout_error', function(){
            clearInterval(Tillit.getInstance().orderIntentCheck.interval)
            Tillit.getInstance().orderIntentCheck.interval = null
            Tillit.getInstance().orderIntentCheck.pendingCheck = false
        })

        // Handle account type change
        $checkout.on('change', '[name="account_type"]', this.onChangeAccountType)

        tillitSelectWooHelper.fixSelectWooHeightUnsupportedCss()

        // If setting is to hide other payment methods, hide when page load by default
        if (window.tillit.display_other_payments !== 'yes') {
            jQuery('#payment .wc_payment_methods > li:not([class*="payment_method_woocommerce-gateway-tillit"])').hide()
        }

        setInterval(function(){
            if (Tillit.getInstance().orderIntentCheck.pendingCheck) Tillit.getInstance().getApproval()
            tillitDomHelper.saveCheckoutInputs()
        }, 3000)

        if (loadSavedInputs) tillitDomHelper.loadCheckoutInputs()
        this.initBillingPhoneDisplay()
        this.customerCompany = tillitDomHelper.getCompanyData()
        this.customerRepresentative = tillitDomHelper.getRepresentativeData()
        this.updateElements()
        this.isInitialized = true
    }

    /**
     * Get singleton instance
     */
    static getInstance() {
        if (!Tillit.instance) Tillit.instance = new Tillit()
        return Tillit.instance
    }


    /**
     * Initialize billing phone display
     */
    initBillingPhoneDisplay() {

        let billingPhoneInputField = document.querySelector("#billing_phone_display")
        this.billingPhoneInput = window.intlTelInput(billingPhoneInputField, {
            utilsScript: "https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/17.0.8/js/utils.js",
            preferredCountries: [window.tillit.shop_base_country],
            separateDialCode: true,
            customPlaceholder: function(selectedCountryPlaceholder, selectedCountryData) {
                if (selectedCountryData.iso2 === 'gb') {
                    return '7700 900077'
                } else if (selectedCountryData.iso2 === 'no') {
                    return '073 70143'
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
        tillitDomHelper.toggleActions()

        // Enable or disable the Tillit method
        tillitDomHelper.toggleMethod(this.isTillitMethodHidden)

        // Enable or disable the Tillit method
        tillitDomHelper.updateCompanyNameAgreement()

        // Rearrange the DOMs in Tillit payment
        tillitDomHelper.rearrangeDescription()

    }

    /**
     * Check if all the required details are collected
     *
     * @returns {boolean}
     */
    isReadyApprovalCheck() {

        if (window.tillit.enable_order_intent !== 'yes') {
            return false
        }

        let can = true
        let values = [].concat(Object.values(this.customerCompany), Object.values(this.customerRepresentative))

        for(let i = 0; i < values.length; i++) {
            const value = values[i]
            if (!value || value.length === 0) {
                can = false
                break
            }
        }

        return can

    }

    /**
     * Check the company approval status by creating an order intent
     */
    getApproval() {

        const isReadyApprovalCheck = this.isReadyApprovalCheck()

        if (!isReadyApprovalCheck) return

        if (this.orderIntentCheck.interval) {
            this.orderIntentCheck.pendingCheck = true
            return
        }

        this.orderIntentCheck.interval = setInterval(function() {
            let gross_amount = tillitDomHelper.getPrice('order-total')
            let tax_amount = tillitDomHelper.getPrice('tax-rate')
            if (!gross_amount) {
                return
            }
            if (!tax_amount) {
                tax_amount = 0
            }

            let jsonBody = JSON.stringify({
                "merchant_short_name": window.tillit.merchant_short_name,
                "gross_amount": "" + gross_amount,
                "invoice_type": window.tillit.product_type,
                "buyer": {
                    "company": Tillit.getInstance().customerCompany,
                    "representative": Tillit.getInstance().customerRepresentative
                },
                "currency": window.tillit.currency,
                "line_items": [{
                    "name": "Cart",
                    "description": "",
                    "gross_amount": gross_amount.toFixed(2),
                    "net_amount": (gross_amount - tax_amount).toFixed(2),
                    "discount_amount": "0",
                    "tax_amount": tax_amount.toFixed(2),
                    "tax_class_name": "VAT " + (100.0 * tax_amount / gross_amount).toFixed(2) + "%",
                    "tax_rate": "" + (1.0 * tax_amount / gross_amount).toFixed(6),
                    "unit_price": (gross_amount - tax_amount).toFixed(2),
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

            let hashedBody = tillitUtilHelper.getUnsecuredHash(jsonBody)
            if (Tillit.getInstance().orderIntentLog[hashedBody]) {
                Tillit.getInstance().orderIntentLog[hashedBody] = Tillit.getInstance().orderIntentLog[hashedBody] + 1
                return
            } else {
                Tillit.getInstance().orderIntentLog[hashedBody] = 1
            }
            Tillit.getInstance().orderIntentCheck['lastCheckHash'] = hashedBody

            clearInterval(Tillit.getInstance().orderIntentCheck.interval)
            Tillit.getInstance().orderIntentCheck.interval = null
            Tillit.getInstance().orderIntentCheck.pendingCheck = false

            let subtitleElem = document.querySelector('.payment_method_woocommerce-gateway-tillit .tillit-subtitle')
            if (subtitleElem) {
                subtitleElem.innerHTML = ''
                subtitleElem.appendChild(tillitDomHelper.getLoaderHtml())
            }

            // Create an order intent
            const approvalResponse = jQuery.ajax({
                url: tillitUtilHelper.contructTillitUrl('/v1/order_intent'),
                contentType: "application/json; charset=utf-8",
                dataType: 'json',
                method: 'POST',
                xhrFields: {withCredentials: true},
                data: jsonBody
            })

            approvalResponse.done(function(response){

                // Store the approved state
                Tillit.getInstance().isTillitApproved = response.approved

                // Toggle the Tillit payment method
                Tillit.getInstance().isTillitMethodHidden = !(Tillit.getInstance().isTillitApproved && tillitUtilHelper.isCompany(tillitDomHelper.getAccountType()))

                // Show or hide the Tillit payment method
                tillitDomHelper.toggleMethod(Tillit.getInstance().isTillitMethodHidden)

                // Select the default payment method
                tillitDomHelper.selectDefaultMethod(Tillit.getInstance().isTillitMethodHidden)

                // Update tracking number
                if (response.tracking_id && document.querySelector('#tracking_id')) {
                    document.querySelector('#tracking_id').value = response.tracking_id
                }

                // Display messages and update order intent logs
                Tillit.getInstance().processOrderIntentResponse(response)

            })

            approvalResponse.fail(function(response){

                // Store the approved state
                Tillit.getInstance().isTillitApproved = false

                // Toggle the Tillit payment method
                Tillit.getInstance().isTillitMethodHidden = true

                // Show or hide the Tillit payment method
                tillitDomHelper.toggleMethod(Tillit.getInstance().isTillitMethodHidden)

                // Select the default payment method
                tillitDomHelper.selectDefaultMethod(Tillit.getInstance().isTillitMethodHidden)

                // Display messages and update order intent logs
                Tillit.getInstance().processOrderIntentResponse(response)

            })
        }, 1000)

    }

    /**
     * Update page after order intent request complete
     */
    processOrderIntentResponse(response)
    {
        if (response.approved) {

            // Update tillit message
            let tillitSubtitleExistCheck = setInterval(function() {
                if (document.querySelector('.tillit-subtitle')) {
                    document.querySelector('.tillit-subtitle').innerText = tillitUtilHelper.getMessage('subtitle_order_intent_ok')
                    clearInterval(tillitSubtitleExistCheck)
               }
            }, 1000)

            // Update order intent log
            if (!this.orderIntentCheck['lastCheckOk']) {
                this.orderIntentCheck['lastCheckOk'] = true
                this.orderIntentLog = {}
                this.orderIntentLog[this.orderIntentCheck['lastCheckHash']] = 1
            }

        } else {

            // Display error messages
            if (response.status >= 400) {
                // @TODO: use code in checkout-api
                let errMsg = (typeof response.responseJSON === 'string' || !('error_details' in response.responseJSON))
                             ? response.responseJSON
                             : response.responseJSON['error_details']

                // Update tillit message
                let tillitSubtitleExistCheck = setInterval(function() {
                    if (document.querySelector('.tillit-subtitle') && jQuery('#payment .blockOverlay').length === 0) {
                        // tillit-subtitle exists and woocommerce's update_checkout is not running
                        let messageId = 'subtitle_order_intent_reject'
                        if (errMsg.startsWith('Minimum Payment using Tillit')) {
                            messageId = 'amount_min'
                        } else if (errMsg.startsWith('Maximum Payment using Tillit')) {
                            messageId = 'amount_max'
                        } else if (errMsg.includes('Invalid phone number')) {
                            messageId = 'invalid_phone'
                            tillitDomHelper.markFieldInvalid('billing_phone_field')
                        }
                        document.querySelector('.tillit-subtitle').innerHTML = tillitUtilHelper.getMessage(messageId)
                        clearInterval(tillitSubtitleExistCheck)
                   }
                }, 1000)
            } else {
                let tillitSubtitleExistCheck = setInterval(function() {
                    if (document.querySelector('.tillit-subtitle') && jQuery('#payment .blockOverlay').length === 0) {
                        // tillit-subtitle exists and woocommerce's update_checkout is not running
                        document.querySelector('.tillit-subtitle').innerHTML = tillitUtilHelper.getMessage('subtitle_order_intent_reject')
                        clearInterval(tillitSubtitleExistCheck)
                   }
                }, 1000)
            }

            // Update order intent log
            if (this.orderIntentCheck['lastCheckOk']) {
                this.orderIntentCheck['lastCheckOk'] = false
                this.orderIntentLog = {}
                this.orderIntentLog[this.orderIntentCheck['lastCheckHash']] = 1
            }

        }

    }

    /**
     * Handle the account type change
     */
    onChangeAccountType() {

        // Get the input
        const $input = jQuery(this)

        // Get the account type
        const accountType = tillitDomHelper.getAccountType()

        // Hide the method for non-business accounts
        if (!tillitUtilHelper.isCompany(accountType)) {
            Tillit.getInstance().isTillitMethodHidden = true
            // Clear method tick
            jQuery('#payment_method_woocommerce-gateway-tillit').prop('checked', false)
        } else if (Tillit.getInstance().isTillitApproved) {
            Tillit.getInstance().isTillitMethodHidden = false
            // Force select tillit payment
            jQuery('#payment_method_woocommerce-gateway-tillit').click()
        }

        // Toggle the company fields
        tillitDomHelper.toggleCompanyFields($input.val())

        // Move the fields to correct positions
        tillitDomHelper.positionFields()

        // Show or hide the payment method
        // tillitDomHelper.toggleMethod(Tillit.getInstance().isTillitMethodHidden)

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
            Tillit.getInstance().customerCompany.organization_number = $input.val()
        } else if (inputName === 'billing_company_display') {
            Tillit.getInstance().customerCompany.company_name = $input.val()
        }

        Tillit.getInstance().getApproval()

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

        Tillit.getInstance().customerRepresentative[inputName] = $input.val()

        Tillit.getInstance().getApproval()

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
            let newVal = Tillit.getInstance().billingPhoneInput.getNumber()
            if (currentVal !== newVal) {
                jQuery('#billing_phone').val(newVal)
                jQuery('#billing_phone').attr('value', newVal)
                Tillit.getInstance().customerRepresentative['phone_number'] = newVal
                Tillit.getInstance().getApproval()
            }
        }, 100)

    }

    /**
     * Handle the country input changes
     *
     * @param event
     */

    onCountryInputChange(event)
    {

        const $input = jQuery(this)

        Tillit.getInstance().customerCompany.country_prefix = $input.val()

        Tillit.getInstance().getApproval()

    }

}


let isSelectedPaymentTillit = null
jQuery(function(){
    if (window.tillit) {

        if (window.tillit.enable_order_intent === 'yes') {
            if (jQuery('#payment_method_woocommerce-gateway-tillit').length > 0) {
                // Run Tillit code if order intent is enabled
                Tillit.getInstance().initialize(true)
            }
        } else {

            // Handle payment method radio select every time order review (right panel) is updated
            jQuery(document.body).on('updated_checkout', function(){

                // Hide and clear unnecessary payment methods
                tillitDomHelper.toggleMethod(Tillit.getInstance().isTillitMethodHidden)
                jQuery('#payment .wc_payment_methods input.input-radio').each(function() {
                    if (jQuery(this).is(":hidden")) {
                        jQuery(this).prop('checked', false)
                    }
                })
                tillitDomHelper.rearrangeDescription()

                // Disable click to return to Klarna if some other payment method is selected
                jQuery('.wc_payment_method:not(.payment_method_woocommerce-gateway-tillit):not(.payment_method_kco)').on('click', function() {
                    sessionStorage.removeItem('privateClickToKlarna')
                })

                // If shop defaults payment method to Tillit, run Tillit code
                if (tillitDomHelper.isSelectedPaymentTillit()) {
                    Tillit.getInstance().initialize(false)
                }

                // Run Tillit code if Tillit payment is selected
                jQuery('#payment_method_woocommerce-gateway-tillit').on('change', function(){
                    Tillit.getInstance().initialize(false)
                })

                // If invoice fee is charged to buyer, order price will change when payment method is changed from/to Tillit
                // Also, run Tillit code if payment method selected is Tillit
                if (window.tillit.invoice_fee_to_buyer === 'yes') {
                    isSelectedPaymentTillit = tillitDomHelper.isSelectedPaymentTillit()
                    if (isSelectedPaymentTillit) {
                        Tillit.getInstance().initialize(false)
                    }

                    // Update right sidebar order review when the payment method changes
                    jQuery('.woocommerce-checkout [name="payment_method"]').on('change', function() {
                        let currentSelectedPaymentTillit = tillitDomHelper.isSelectedPaymentTillit()
                        if (currentSelectedPaymentTillit || isSelectedPaymentTillit) {
                            jQuery(document.body).trigger('update_checkout')
                        }
                        // console.log('selected: ' + isSelectedPaymentTillit + ' -> ' + currentSelectedPaymentTillit)
                        isSelectedPaymentTillit = currentSelectedPaymentTillit
                        if (isSelectedPaymentTillit) {
                            Tillit.getInstance().initialize(false)
                        }
                    })
                }

            })

            // If last selected payment method is Tillit, run Tillit code anyway
            let lastSelectedPayment = tillitDomHelper.getCheckoutInput('INPUT', 'radio', 'payment_method')
            if (lastSelectedPayment && lastSelectedPayment.id === 'payment_method_woocommerce-gateway-tillit') {
                Tillit.getInstance().initialize(true)
            }

            // Otherwise do not run Tillit code
        }

        // Show or hide Tillit payment method on account type change
        jQuery('.woocommerce-checkout [name="account_type"]').on('change', function() {
            tillitDomHelper.toggleMethod(Tillit.getInstance().isTillitMethodHidden)
        })

        // Intitialization of DOMs
        tillitDomHelper.initAccountTypeButtons()

    }
})
