const tillitRequiredField = '<abbr class="required" title="required">*</abbr>'
const tillitSearchLimit = 50

let tillitWithCompanySearch = null
let tillitMethodHidden = true
let tillitApproved = null
let tillitOrderIntentLog = {}

const tillitOrderIntentCheck = {
    "interval": null,
    "pendingCheck": false,
    "lastCheckOk": false,
    "lastCheckHash": null
}

const tillitCompany = {
    "company_name": null,
    "country_prefix": null,
    "organization_number": null
}
const tillitRepresentative = {
    "email": null,
    "first_name": null,
    "last_name": null,
    "phone_number": null
}

class Tillit {

    constructor()
    {

        const $body = jQuery(document.body)
        const context = this

        // Get the checkout form
        const $checkout = jQuery('.woocommerce-checkout')

        // Stop if not the checkout page
        if ($checkout.length === 0) return

        // Get the account type input
        const $accountType = jQuery('[name="account_type"]:checked')

        // Get the billing company field
        const $billingCompany = $checkout.find('#billing_company')

        // Get the billing country field
        const $billingCountry = $checkout.find('#billing_country')

        // Get the company ID field
        const $companyId = $checkout.find('#company_id')

        // If we found the field
        if ($accountType.length > 0) {

            // Get the account type
            const accountType = $accountType.val()

            // Toggle the company fields
            Tillit.toggleCompanyFields(accountType)

            // Move the fields
            Tillit.moveFields()

        }

        if (tillitWithCompanySearch) {

            // Reinitiate company select on country change
            $billingCountry.on('select2:select', function(e){
                // Clear company inputs
                $billingCompany.html('')
                $billingCompany.selectWoo(selectWooParams())
                jQuery('#company_id').val('')

                // Clear the addresses, in case address get request fails
                jQuery('#billing_address_1').val('')
                jQuery('#billing_city').val('')
                jQuery('#billing_postcode').val('')
            })

            $billingCountry.on('select2:open', function(e){
                setTimeout(function(){
                    if (jQuery('input[aria-owns="select2-billing_country-results"]').get(0)) {
                        jQuery('input[aria-owns="select2-billing_country-results"]').get(0).focus()
                    }
                }, 200)
            })

            // Turn the select input into select2
            setTimeout(function(){
                const $billingCompanySelect = $billingCompany.selectWoo(selectWooParams())
                $billingCompanySelect.on('select2:select', function(e){

                    // Get the option data
                    const data = e.params.data

                    if (window.tillit.company_id_search && window.tillit.company_id_search === 'yes') {

                        // Set the company ID
                        tillitCompany.organization_number = data.company_id

                        // Set the company ID
                        $companyId.val(data.company_id)

                    }

                    // Set the company name
                    tillitCompany.company_name = data.id

                    // Get the company approval status
                    Tillit.getApproval()

                    // Get country
                    let country_prefix = tillitCompany.country_prefix
                    if (!country_prefix || !['GB'].includes(country_prefix)) country_prefix = 'NO'

                    // Clear the addresses, in case address get request fails
                    jQuery('#billing_address_1').val('')
                    jQuery('#billing_city').val('')
                    jQuery('#billing_postcode').val('')

                    // Fetch the company data
                    const addressResponse = jQuery.ajax({
                        dataType: 'json',
                        url: Tillit.contructTillitUrl('/v1/' + country_prefix + '/company/' + jQuery('#company_id').val() + '/address')
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

                $billingCompanySelect.on('select2:open', function(e){
                    setTimeout(function(){
                        if (jQuery('input[aria-owns="select2-billing_company-results"]').get(0)) {
                            jQuery('input[aria-owns="select2-billing_company-results"]').get(0).focus()
                        }
                    }, 200)
                })
            }, 800)

        }

        /**
         * Fix the position bug
         * https://github.com/select2/select2/issues/4614
         */

        if (tillitWithCompanySearch) {

            const instance = $billingCompany.data('select2')

            if (instance) {
                instance.on('open', function(e){
                    this.results.clear()
                    this.dropdown._positionDropdown()
                })
            }

        }

        // Disable or enable actions based on the account type
        $body.on('updated_checkout', function(){

            // Check approval again
            Tillit.getApproval()

            // Toggle the action buttons
            Tillit.toggleActions()

            // Enable or disable the Tillit method
            Tillit.toggleMethod()

            // Enable or disable the Tillit method
            Tillit.updateCompanyNameAgreement()

            document.querySelector('label[for="payment_method_woocommerce-gateway-tillit"] .tillit-subtitle').parentElement.appendChild(
                document.querySelector('label[for="payment_method_woocommerce-gateway-tillit"] .tillit-subtitle'))

        })

        // Handle the representative inputs blur event
        $body.on('blur', '#billing_first_name, #billing_last_name, #billing_email, #billing_phone', this.onRepresentativeInputBlur)

        // Handle the representative inputs blur event
        $body.on('blur', '#company_id, #billing_company', this.onCompanyManualInputBlur)

        // Handle the phone inputs change event
        $body.on('change', '#billing_phone_display', this.onPhoneInputChange)
        setTimeout(function(){
            jQuery('.iti__country-list').on('click', context.onPhoneInputChange)
        }, 1000)

        // Handle the company inputs change event
        $body.on('change', '#select2-billing_company-container', Tillit.updateCompanyNameAgreement)
        $body.on('change', '#billing_company', Tillit.updateCompanyNameAgreement)

        // Handle the country inputs change event
        $body.on('change', '#billing_country', this.onCountryInputChange)

        $body.on('click', '#place_order', function(){
            clearInterval(tillitOrderIntentCheck.interval)
            tillitOrderIntentCheck.interval = null
            tillitOrderIntentCheck.pendingCheck = false
        })

        $body.on('checkout_error', function(){
            clearInterval(tillitOrderIntentCheck.interval)
            tillitOrderIntentCheck.interval = null
            tillitOrderIntentCheck.pendingCheck = false
        })

        // Handle account type change
        $checkout.on('change', '[name="account_type"]', this.changeAccountType)

        // Update right sidebar order review when the payment method changes
        $checkout.on('change', '[name="payment_method"]', function() {
            if (Tillit.isCompany(Tillit.getAccountType())) {
                $body.trigger('update_checkout')
            }
        })

        // If setting is to hide other payment methods, hide when page load by default
        if (window.tillit.display_other_payments !== 'yes') {
            jQuery('#payment .wc_payment_methods > li:not([class*="payment_method_woocommerce-gateway-tillit"])').hide()
        }

        setInterval(function(){
            if (tillitOrderIntentCheck.pendingCheck) Tillit.getApproval()
            Tillit.saveCheckoutInputs()
        }, 3000)

    }

    static populateFields()
    {
        tillitCompany.company_name = jQuery('#billing_company').val()
        tillitCompany.country_prefix = jQuery('#billing_country').val()
        tillitCompany.organization_number = jQuery('#company_id').val()
        tillitRepresentative.email = jQuery('#billing_email').val()
        tillitRepresentative.first_name = jQuery('#billing_first_name').val()
        tillitRepresentative.last_name = jQuery('#billing_last_name').val()
        tillitRepresentative.phone_number = jQuery('#billing_phone').val()
    }

    /**
     * Return the account type
     *
     * @returns {*|jQuery}
     */

    static getAccountType()
    {
        return jQuery(':input[name="account_type"]:checked').val()
    }

    /**
     * Helper for adding a placeholder after an input, used for moving the fields
     *
     * @param $el
     * @param name
     */

    static addPlaceholder($el, name)
    {

        // Get an existing placeholder
        let $placeholder = jQuery('#tillit-'+ name +'-source')

        // Stop if we already have a placeholder
        if ($placeholder.length > 0) return

        // Create a placeholder
        $placeholder = jQuery('<div id="tillit-'+ name +'-source"></div>')

        // Add placeholder after element
        $placeholder.insertAfter($el)

    }

    /**
     * Move a field around and leave a placeholder
     *
     * @param selector
     * @param name
     */

    static moveField(selector, name)
    {

        // Get the element
        const $el = jQuery('#' + selector)

        // Add a placeholder
        Tillit.addPlaceholder($el, name)

        // Get the target
        const $target = jQuery('#tillit-' + name + '-target')

        // Move the input
        $el.insertAfter($target)

    }

    /**
     * Move a field to its original position
     *
     * @param selector
     * @param name
     */

    static revertField(selector, name)
    {

        // Get the element
        const $el = jQuery('#' + selector)

        // Get the target
        const $target = jQuery('#tillit-' + name + '-source')

        // Move the input
        $el.insertAfter($target)

    }

    /**
     * Move the first name, last name, and phone based on the account type
     *
     * @return void
     */

    static moveFields()
    {

        // Get the account type
        const accountType = Tillit.getAccountType()

        // If business account
        if (accountType === 'business') {
            Tillit.moveField('billing_first_name_field', 'fn')
            Tillit.moveField('billing_last_name_field', 'ln')
            Tillit.moveField('billing_phone_field', 'ph')
            Tillit.moveField('billing_email_field', 'em')
        } else {
            Tillit.revertField('billing_first_name_field', 'fn')
            Tillit.revertField('billing_last_name_field', 'ln')
            Tillit.revertField('billing_phone_field', 'ph')
            Tillit.revertField('billing_email_field', 'em')
        }

    }

    /**
     * Toggle the required property for company fields
     *
     * @param $targets
     * @param accountType
     *
     * @return void
     */

    static toggleRequiredFields($targets, is_required)
    {

        // For each input
        $targets.find(':input').each(function(){

            // Get the input
            const $input = jQuery(this)

            // Get the input row
            const $row = $input.parents('.form-row')

            // Toggle the required property
            $input.attr('required', is_required)

            // Replace the optional visual cue with the required one
            $row.find('label .optional').replaceWith(tillitRequiredField)

        })

    }

    /**
     * Toggle the company fields
     *
     * @param accountType
     */

    static toggleCompanyFields(accountType)
    {

        // Get the targets
        let $requiredCompanyTargets = jQuery('#billing_phone_display_field')
        if (window.tillit.mark_tillit_fields_required === 'yes') {
            $requiredCompanyTargets = jQuery('.woocommerce-company-fields, .woocommerce-representative-fields, #company_id_field, #billing_company_field, #billing_phone_display_field')
        }
        const $visibleCompanyTargets = jQuery('.woocommerce-company-fields, .woocommerce-representative-fields, #company_id_field, #billing_company_field, #billing_phone_display_field, #department_field, #project_field')
        const $visibleNoncompanyTargets = jQuery('#billing_phone_field')

        // Toggle the targets based on the account type
        const is_tillit_visible = jQuery('#payment_method_woocommerce-gateway-tillit').length !== 0
        if (is_tillit_visible) {
            jQuery('#account_type_field').removeClass('hidden')
        } else {
            jQuery('#account_type_field').addClass('hidden')
        }
        const is_tillit_available = is_tillit_visible && Tillit.isCompany(accountType)
        if (is_tillit_available) {
            $visibleCompanyTargets.removeClass('hidden')
            $visibleNoncompanyTargets.addClass('hidden')
        } else {
            $visibleCompanyTargets.addClass('hidden')
            $visibleNoncompanyTargets.removeClass('hidden')
        }

        // Toggle the required fields based on the account type
        Tillit.toggleRequiredFields($requiredCompanyTargets, is_tillit_available)

    }

    /**
     * Check if selected account type is business
     *
     * @param accountType
     */

    static isCompany(accountType)
    {

        return accountType === 'business'

    }

    /**
     * Hide or show the Tillit payment method
     *
     * @return void
     */

    static toggleMethod()
    {

        // Get the Tillit payment method section
        const $tillitSection = jQuery('#payment .wc_payment_methods > li.payment_method_woocommerce-gateway-tillit')
        const $otherPaymentSections = jQuery('#payment .wc_payment_methods > li:not([class*="payment_method_woocommerce-gateway-tillit"])')

        // Get the Tillit payment method input
        const $tillitBox = jQuery(':input[value="woocommerce-gateway-tillit"]')

        // True if the Tillit payment method is disabled
        const isTillitDisabled = window.tillit.enable_order_intent === 'yes' && tillitMethodHidden === true

        // If Tillit is disabled
        if (isTillitDisabled) {

            $tillitBox.prop('checked', false)

        }

        // Disable the Tillit payment method for non-business orders
        $tillitBox.attr('disabled', isTillitDisabled)

        if (Tillit.isCompany(Tillit.getAccountType())) {

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

    }

    /**
     * Extract and format the dropdown options
     *
     * @param results
     *
     * @returns {[]|*[]}
     */

    static extractItems(results)
    {

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

    /**
     * Select the default payment method
     *
     * @return void
     */

    static selectDefaultMethod()
    {

        // Get the Tillit payment method input
        const $tillitPaymentMethod = jQuery(':input[value="woocommerce-gateway-tillit"]')

        // Get the Tillit payment block
        const $tillit = jQuery('.payment_method_woocommerce-gateway-tillit')

        // True if the Tillit payment method is disabled
        const isTillitDisabled = window.tillit.enable_order_intent === 'yes' && tillitMethodHidden === true

        // Disable the Tillit payment method for non-business orders
        $tillitPaymentMethod.attr('disabled', isTillitDisabled)

        // If tillit method cannot be used
        if (isTillitDisabled) {

            // Fallback if set in admin and current account type is business
            if (window.tillit.fallback_to_another_payment === 'yes' && Tillit.isCompany(Tillit.getAccountType())) {
                // Select the first visible payment method
                $tillit.parent().find('li:visible').eq(0).find(':radio').click()
            }

        } else {

            // Select the payment method for business accounts
            $tillitPaymentMethod.click()

        }

    }

    /**
     * Check if all the required details are collected
     *
     * @returns {boolean}
     */

    static canGetApproval()
    {

        if (window.tillit.enable_order_intent !== 'yes') {
            return false
        }

        let can = true
        let values = [].concat(Object.values(tillitCompany), Object.values(tillitRepresentative))

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
     *
     * @return void
     */

    static getApproval()
    {

        const canGetApproval = Tillit.canGetApproval()

        if (!canGetApproval) return

        if (tillitOrderIntentCheck.interval) {
            tillitOrderIntentCheck.pendingCheck = true
            return
        }

        tillitOrderIntentCheck.interval = setInterval(function() {
            let gross_amount = Tillit.getPrice('order-total')
            let tax_amount = Tillit.getPrice('tax-rate')
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
                    "company": tillitCompany,
                    "representative": tillitRepresentative
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

            let hashedBody = Tillit.getUnsecuredHash(jsonBody)
            if (tillitOrderIntentLog[hashedBody]) {
                tillitOrderIntentLog[hashedBody] = tillitOrderIntentLog[hashedBody] + 1
                return
            } else {
                tillitOrderIntentLog[hashedBody] = 1
            }
            tillitOrderIntentCheck['lastCheckHash'] = hashedBody

            clearInterval(tillitOrderIntentCheck.interval)
            tillitOrderIntentCheck.interval = null
            tillitOrderIntentCheck.pendingCheck = false

            let subtitleElem = document.querySelector('.payment_method_woocommerce-gateway-tillit .tillit-subtitle')
            if (subtitleElem) {
                subtitleElem.innerHTML = ''
                subtitleElem.appendChild(Tillit.getLoaderHtml())
            }

            // Create an order intent
            const approvalResponse = jQuery.ajax({
                url: Tillit.contructTillitUrl('/v1/order_intent'),
                contentType: "application/json; charset=utf-8",
                dataType: 'json',
                method: 'POST',
                xhrFields: {withCredentials: true},
                data: jsonBody
            })

            approvalResponse.done(function(response){

                // Store the approved state
                tillitApproved = response.approved

                // Toggle the Tillit payment method
                tillitMethodHidden = !(tillitApproved && Tillit.isCompany(Tillit.getAccountType()))

                // Show or hide the Tillit payment method
                Tillit.toggleMethod()

                // Select the default payment method
                Tillit.selectDefaultMethod()

                // Update tracking number
                if (response.tracking_id && document.querySelector('#tracking_id')) {
                    document.querySelector('#tracking_id').value = response.tracking_id
                }

                // Display messages and update order intent logs
                Tillit.processOrderIntentResponse(response)

            })

            approvalResponse.fail(function(response){

                // Store the approved state
                tillitApproved = false

                // Toggle the Tillit payment method
                tillitMethodHidden = true

                // Show or hide the Tillit payment method
                Tillit.toggleMethod()

                // Select the default payment method
                Tillit.selectDefaultMethod()

                // Display messages and update order intent logs
                Tillit.processOrderIntentResponse(response)

            })
        }, 1000)

    }

    static processOrderIntentResponse(response)
    {
        if (response.approved) {

            // Update tillit message
            let tillitSubtitleExistCheck = setInterval(function() {
                if (document.querySelector('.tillit-subtitle')) {
                    document.querySelector('.tillit-subtitle').innerText = Tillit.getMessage('subtitle_order_intent_ok')
                    clearInterval(tillitSubtitleExistCheck)
               }
            }, 1000)

            // Update order intent log
            if (!tillitOrderIntentCheck['lastCheckOk']) {
                tillitOrderIntentCheck['lastCheckOk'] = true
                tillitOrderIntentLog = {}
                tillitOrderIntentLog[tillitOrderIntentCheck['lastCheckHash']] = 1
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
                    if (document.querySelector('.tillit-subtitle')) {
                        let messageId = 'subtitle_order_intent_reject'
                        if (errMsg.startsWith('Minimum Payment using Tillit')) {
                            messageId = 'amount_min'
                        } else if (errMsg.startsWith('Maximum Payment using Tillit')) {
                            messageId = 'amount_max'
                        } else if (errMsg.includes('Invalid phone number')) {
                            messageId = 'invalid_phone'
                            Tillit.markFieldInvalid('billing_phone_field')
                        }
                        document.querySelector('.tillit-subtitle').innerHTML = Tillit.getMessage(messageId)
                        clearInterval(tillitSubtitleExistCheck)
                   }
                }, 1000)
            } else {
                let tillitSubtitleExistCheck = setInterval(function() {
                    if (document.querySelector('.tillit-subtitle')) {
                        document.querySelector('.tillit-subtitle').innerHTML = Tillit.getMessage('subtitle_order_intent_reject')
                        clearInterval(tillitSubtitleExistCheck)
                   }
                }, 1000)
            }

            // Update order intent log
            if (tillitOrderIntentCheck['lastCheckOk']) {
                tillitOrderIntentCheck['lastCheckOk'] = false
                tillitOrderIntentLog = {}
                tillitOrderIntentLog[tillitOrderIntentCheck['lastCheckHash']] = 1
            }

        }

    }

    static getLoaderHtml()
    {

        let img = document.createElement("IMG")
        img.src = window.tillit.tillit_plugin_url + '/assets/images/loader.svg'
        img.className = 'loader'
        return img

    }

    static getMessage(key)
    {

        if (key && key in window.tillit.messages) {
            return [window.tillit.messages[key],]
        }
        return []

    }

    static getUnsecuredHash(inp, seed = 0) {
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

    static markFieldInvalid(fieldWrapperId)
    {

        const fieldWrapper = document.querySelector('#' + fieldWrapperId)

        if (fieldWrapper && fieldWrapper.classList) {
            fieldWrapper.classList.remove('woocommerce-validated')
            fieldWrapper.classList.add('woocommerce-invalid')
        }

    }

    static toggleActions()
    {

        // Get the account type
        const accountType = Tillit.getAccountType()

        // Get the payment method
        const paymentMethod = jQuery(':input[name="payment_method"]:checked').val()

        // Get the place order button
        const $placeOrder = jQuery('#place_order')

        // Disable the place order button if order is non-business and payment method is Tillit
        $placeOrder.attr('disabled', !Tillit.isCompany(accountType) && paymentMethod === 'woocommerce-gateway-tillit')

    }

    /**
     * Handle the account type change
     */

    changeAccountType()
    {

        // Get the input
        const $input = jQuery(this)

        // Get the account type
        const accountType = Tillit.getAccountType()

        // Hide the method for non-business accounts
        if (!Tillit.isCompany(accountType)) tillitMethodHidden = true
        else if (tillitApproved) tillitMethodHidden = false

        // Toggle the company fields
        Tillit.toggleCompanyFields($input.val())

        // Move the fields
        Tillit.moveFields()

        // Show or hide the payment method
        Tillit.toggleMethod()

    }

    /**
     * Handle the company manual input changes
     *
     * @param event
     */

    onCompanyManualInputBlur(event)
    {

        const $input = jQuery(this)

        let inputName = $input.attr('name')

        if (inputName === 'company_id') {
            tillitCompany.organization_number = $input.val()
        } else if (inputName === 'billing_company') {
            tillitCompany.company_name = $input.val()
        }

        Tillit.getApproval()

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

        tillitRepresentative[inputName] = $input.val()

        Tillit.getApproval()

    }

    /**
     * Handle the phone number input changes
     *
     * @param event
     */

    onPhoneInputChange(event)
    {

        setTimeout(function(){
            jQuery('#billing_phone').val(billingPhoneInput.getNumber())
            tillitRepresentative['phone_number'] = jQuery('#billing_phone').val()
            Tillit.getApproval()
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

        tillitCompany.country_prefix = $input.val()

        Tillit.getApproval()

    }

    /**
     * Update company name in payment method aggrement section
     */

    static updateCompanyNameAgreement()
    {
        if (document.querySelector('#select2-billing_company-container') && document.querySelector('#select2-billing_company-container').innerText) {
            document.querySelector('.tillit-buyer-name').innerText = document.querySelector('#select2-billing_company-container').innerText
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
    }

    /**
     * Get price from DOM
     */

    static getPrice(priceName)
    {
        let node = document.querySelector('.' + priceName + ' .woocommerce-Price-amount bdi')
                   || document.querySelector('.' + priceName + ' .woocommerce-Price-amount')
        return Tillit.getPriceRecursively(node)
    }

    /**
     * Get price recursively from a DOM node
     */

    static getPriceRecursively(node)
    {
        if (!node) return
        if (node.classList && node.classList.contains('woocommerce-Price-currencySymbol')) return
        if (node.childNodes) {
            for (let n of node.childNodes) {
                let val = Tillit.getPriceRecursively(n)
                if (val) {
                    return val
                }
            }
        }
        if (node.nodeName === '#text') {
            let val = node.textContent
                .replace(window.tillit.price_thousand_separator, '')
                .replace(window.tillit.price_decimal_separator, '.')
            if (!isNaN(val) && !isNaN(parseFloat(val))) {
                return parseFloat(val)
            }
        }
    }

    /**
     * Save checkout inputs
     */

    static saveCheckoutInputs()
    {
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
    }

    /**
     * Construct url to Tillit checkout api
     */

    static contructTillitUrl(path, params = {})
    {
        params['client'] = window.tillit.client_name
        params['client_v'] = window.tillit.client_version
        return window.tillit.tillit_checkout_host + path + '?' + (new URLSearchParams(params)).toString()
    }

    /**
     * Load checkout inputs
     */

    static loadCheckoutInputs()
    {
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

function selectWooParams() {
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
                    return wc_country_select_params.i18n_ajax_error
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
                        results: Tillit.extractItems(response),
                        pagination: {
                            more: (params.page * tillitSearchLimit) < response.data.total
                        }
                    }

                }
            }
        }
    } else {
        jQuery('input[aria-owns="select2-billing_company-results"]').css('display: none;')
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
}

jQuery(function(){
    if (window.tillit) {
        tillitWithCompanySearch = window.tillit.company_name_search && window.tillit.company_name_search === 'yes'
        new Tillit()
        Tillit.loadCheckoutInputs()
        Tillit.populateFields()
        Tillit.getApproval()
    }
})
