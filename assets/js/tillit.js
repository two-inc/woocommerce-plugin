const tillitRequiredField = '<abbr class="required" title="required">*</abbr>'
const tillitCheckoutApi = 'https://staging.api.tillit.ai/v1'
const tillitSearchApi = 'https://search-api-demo-j6whfmualq-lz.a.run.app'
const tillitSearchLimit = 50

let tillitWithCompanySearch = null
let tillitSearchCache
let tillitMethodHidden = true
let tillitApproved = null
let tillitCooldown = null

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
        if($checkout.length === 0) return

        // Populate the company and representative fields
        this.populateFields()

        // Get the account type input
        const $accountType = jQuery('[name="account_type"]:checked')

        // Get the billing company field
        const $billingCompany = $checkout.find('#billing_company')

        // Get the company ID field
        const $companyId = $checkout.find('#company_id')

        // If we found the field
        if($accountType.length > 0) {

            // Get the account type
            const accountType = $accountType.val()

            // Toggle the company fields
            Tillit.toggleCompanyFields(accountType)

            // Move the fields
            Tillit.moveFields()

        }

        if(tillitWithCompanySearch) {

            // Turn the select input into select2
            $billingCompany.selectWoo({
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
                ajax: {
                    dataType: 'json',
                    delay: 200,
                    url: function(params){
                        params.page = params.page || 1
                        return tillitSearchApi + '/search?limit=' + tillitSearchLimit + '&offset=' + ((params.page - 1) * tillitSearchLimit) + '&q=' + params.term
                    },
                    data: function()
                    {
                        return {}
                    },
                    processResults: function(response, params)
                    {

                        tillitSearchCache = response

                        return {
                            results: Tillit.extractItems(response),
                            pagination: {
                                more: (params.page * tillitSearchLimit) < response.data.total
                            }
                        }

                    }
                }
            }).on('select2:select', function(e){

                // Get the option data
                const data = e.params.data

                if(window.tillit.company_id_search && window.tillit.company_id_search === 'yes') {

                    // Set the company ID
                    tillitCompany.organization_number = data.company_id;

                    // Set the company ID
                    $companyId.val(data.company_id)

                }

                // Set the company name
                tillitCompany.company_name = data.id

                // Fetch the company data
                const addressResponse = Tillit.checkoutApiRequest('address', jQuery('#company_id').val())

                addressResponse.done(function(response){

                    // If we have the company location
                    if(response.company_location) {

                        // Get the company location object
                        const companyLocation = response.company_location

                        // Populate the street name and house number fields
                        jQuery('#billing_address_1').val(companyLocation.street_address)

                        // Populate the city
                        jQuery('#billing_city').val(companyLocation.municipality_name)

                        // Populate the postal code
                        jQuery('#billing_postcode').val(companyLocation.postal_code)

                    }

                    // Get the company approval status
                    Tillit.getApproval()

                })

            })

        }

        /**
         * Fix the position bug
         * https://github.com/select2/select2/issues/4614
         */

        if(tillitWithCompanySearch) {

            const instance = $billingCompany.data('select2')

            instance.on('open', function(e){
                this.results.clear()
                this.dropdown._positionDropdown()
            })

        }

        // Disable or enable actions based on the account type
        $body.on('updated_checkout', function(){

            // Toggle the action buttons
            context.toggleActions()

            // Enable or disable the Tillit method
            Tillit.toggleMethod()

        })

        // Handle the representative inputs blur event
        $body.on('blur', '#billing_first_name, #billing_last_name, #billing_email, #billing_phone', this.onRepresentativeInputBlur)

        // Handle the company inputs change event
        $body.on('change', '#billing_country', this.onCompanyInputChange)

        $body.on('click', '#place_order', function(){
            tillitCooldown = true
        })

        $body.on('checkout_error', function(){
            setTimeout(function(){
                tillitCooldown = false
            }, 1000)
        })

        // Handle account type change
        $checkout.on('change', '[name="account_type"]', this.changeAccountType)

        // Toggle the actions when the payment method changes
        $checkout.on('change', '[name="payment_method"]', this.toggleActions)

    }

    populateFields()
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
     * Helper for adding a placeholder after an input; used for movinf the fields
     *
     * @param $el
     * @param name
     */

    static addPlaceholder($el, name)
    {

        // Get an existing placeholder
        let $placeholder = jQuery('#tillit-'+ name +'-source')

        // Stop if we already have a placeholder
        if($placeholder.length > 0) return

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
        if(accountType === 'business') {
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

    static toggleRequiredFields($targets, accountType)
    {

        // True if the extra fields are required
        const isRequired =  accountType === 'business'

        // For each input
        $targets.find(':input').each(function(){

            // Get the input
            const $input = jQuery(this)

            // Get the input row
            const $row = $input.parents('.form-row')

            // Toggle the required property
            $input.attr('required', isRequired)

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
        const $targets = jQuery('.woocommerce-company-fields, .woocommerce-representative-fields, #company_id_field, #billing_company_field')

        // Toggle the targets based on the account type
        accountType === 'personal' ? $targets.hide() : $targets.show()

        // Toggle the required fields based on the account type
        Tillit.toggleRequiredFields($targets, accountType)

    }

    /**
     * Hide or show the Tillit payment method
     *
     * @return void
     */

    static toggleMethod()
    {

        // Get the Tillit payment method input
        const $tillitPaymentMethod = jQuery(':input[value="woocommerce-gateway-tillit"]')

        // True if the Tillit payment method is disabled
        const isTillitDisabled = tillitMethodHidden === true

        // Disable the Tillit payment method for personal orders
        $tillitPaymentMethod.attr('disabled', isTillitDisabled)

        // Get the Tillit payment method
        const $tillit = jQuery('li.payment_method_woocommerce-gateway-tillit')

        // If Tillit is disabled
        if(isTillitDisabled) {

            // Get the next or previous target
            const $target = $tillit.prev().length === 0 ? $tillit.next() : $tillit.prev()

            // Activate the next default method
            $target.find(':radio').click()

        } else {

            // Active the Tillit method
            $tillit.find(':radio').click()

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

        if(results.status !== 'success') return []

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

        // Get the account type
        const accountType = Tillit.getAccountType()

        // Get the Tillit payment method input
        const $tillitPaymentMethod = jQuery(':input[value="woocommerce-gateway-tillit"]')

        // Get the Tillit payment block
        const $tillit = jQuery('.payment_method_woocommerce-gateway-tillit')

        // True if the Tillit payment method is disabled
        const isTillitDisabled = tillitMethodHidden === true

        // Disable the Tillit payment method for personal orders
        $tillitPaymentMethod.attr('disabled', isTillitDisabled)

        // If a personal account
        if(isTillitDisabled) {

            // Select the first visible payment method
            $tillit.parent().find('li:visible').eq(0).find(':radio').click()

        } else {

            // Select the payment method for business accounts
            $tillitPaymentMethod.click()

        }

    }

    /**
     * Query the Tillit API
     *
     * @param endpoint
     * @param companyId
     */

    static checkoutApiRequest(endpoint, companyId)
    {
        return jQuery.ajax({
            dataType: 'json',
            url: [tillitCheckoutApi, 'company', companyId, endpoint].join('/')
        })
    }

    /**
     * Check if all the required details are collected
     *
     * @returns {boolean}
     */

    static canGetApproval()
    {

        let can = true
        let values = [].concat(Object.values(tillitCompany), Object.values(tillitRepresentative))

        for(let i = 0; i < values.length; i++) {
            const value = values[i]
            if(!value || value.length === 0) {
                can = false
                break
            }
        }

        return can

    }

    /**
     * Clear woocommerce error messages and display new messages
     *
     * @param errorMsgs
     */

    static clearAndDisplayErrors(errorMsgs) {
        let noticeGroup = document.querySelector('.woocommerce-NoticeGroup');
        if (!noticeGroup) {
            noticeGroup = document.createElement('div');
            noticeGroup.className = 'woocommerce-NoticeGroup woocommerce-NoticeGroup-checkout';
            document.querySelector('form[name="checkout"]').prepend(noticeGroup);
        }
        noticeGroup.innerHTML = '';console.log(errorMsgs);
        for (let errorMsg of errorMsgs) {
            let ul = document.createElement('ul');
            ul.className = 'woocommerce-error';
            ul.setAttribute('role', 'alert');
            let li = document.createElement('li');
            li.append(document.createTextNode(errorMsg));
            ul.append(li);
            noticeGroup.append(ul);
        }
    }

    /**
     * Check the company approval status by creating an order intent
     *
     * @return void
     */

    static getApproval()
    {

        const canGetApproval = Tillit.canGetApproval()

        if(!canGetApproval) return;

        // Create an order intent
        const approvalResponse = jQuery.ajax({
            url: tillitCheckoutApi + '/order_intent',
            contentType: "application/json; charset=utf-8",
            dataType: 'json',
            method: 'POST',
            headers: {
                "Tillit-Merchant-Id": window.tillit.merchant_id
            },
            data: JSON.stringify({
                "amount": parseFloat(window.tillit.amount),
                "buyer": {
                    "company": tillitCompany,
                    "representative": tillitRepresentative
                },
                "currency": window.tillit.currency,
                "line_items": window.tillit.line_items
            })
        })

        approvalResponse.done(function(response){

            // Store the approved state
            tillitApproved = response.approved

            // Toggle the Tillit payment method
            tillitMethodHidden = !tillitApproved

            // Show or hide the Tillit payment method
            Tillit.toggleMethod()

            // Select the default payment method
            Tillit.selectDefaultMethod()

            // Update company name in payment option
            document.querySelector('.tillit-buyer-name').innerText = document.querySelector('#select2-billing_company-container').innerText

            // Clear error messages
            Tillit.clearAndDisplayErrors([]);
        })

        approvalResponse.error(function(response){

            // Store the approved state
            tillitApproved = false

            // Toggle the Tillit payment method
            tillitMethodHidden = !tillitApproved

            // Show or hide the Tillit payment method
            Tillit.toggleMethod()

            // Select the default payment method
            Tillit.selectDefaultMethod()

            // Update company name in payment option
            document.querySelector('.tillit-buyer-name').innerText = ''

            // Display error messages
            if (response.status == 400) {
                Tillit.clearAndDisplayErrors([response.responseJSON,]);
                if (jQuery) jQuery.scroll_to_notices(jQuery('.woocommerce-NoticeGroup'));
            }

        })

    }

    toggleActions()
    {

        // Get the account type
        const accountType = Tillit.getAccountType()

        // Get the payment method
        const paymentMethod = jQuery(':input[name="payment_method"]:checked').val()

        // Get the place order button
        const $placeOrder = jQuery('#place_order')

        // Disable the place order button if personal order and payment method is Tillit
        $placeOrder.attr('disabled', accountType === 'personal' && paymentMethod === 'woocommerce-gateway-tillit')

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

        // Hide the method for personal accounts
        if(accountType === 'personal') tillitMethodHidden = true
        if(accountType === 'business' && tillitApproved) tillitMethodHidden = false

        // Toggle the company fields
        Tillit.toggleCompanyFields($input.val())

        // Move the fields
        Tillit.moveFields()

        // Show or hide the payment method
        Tillit.toggleMethod()

    }

    /**
     * Handle the representative input changes
     *
     * @param event
     */

    onRepresentativeInputBlur(event)
    {

        if(tillitCooldown) return

        const $input = jQuery(this)

        let inputName = $input.attr('name').replace('billing_', '')

        if(inputName === 'phone') inputName += '_number'

        tillitRepresentative[inputName] = $input.val()

        console.log(tillitRepresentative)

        Tillit.getApproval()

    }

    /**
     * Handle the company input changes
     *
     * @param event
     */

    onCompanyInputChange(event)
    {

        if(tillitCooldown) return

        const $input = jQuery(this)

        tillitCompany.country_prefix = $input.val()

        Tillit.getApproval()

    }

}

jQuery(function(){
    if (window.tillit) {
        if (window.tillit.error) {
            setTimeout(function(){
                Tillit.clearAndDisplayErrors(window.tillit.messages)
            }, 3000);
            return
        }
        tillitWithCompanySearch = window.tillit.company_name_search && window.tillit.company_name_search === 'yes'
        new Tillit()
    }
})
