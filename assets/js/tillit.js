const tillitRequiredField = '<abbr class="required" title="required">*</abbr>'
const tillitCheckoutApi = 'https://tillit-checkout-api-j6whfmualq-lz.a.run.app'
const tillitSearchApi = 'https://search-api-demo-j6whfmualq-lz.a.run.app'
const tillitSearchLimit = 50

let tillitSearchCache
let tillitMethodHidden = true

/**
 * Return the account type
 *
 * @returns {*|jQuery}
 */

function tillitGetAccountType()
{
    return jQuery(':input[name="account_type"]:checked').val()
}

/**
 * Add a placeholder after an input
 *
 * @param $el
 * @param name
 */

function tillitAddPlaceholder($el, name)
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

function tillitMoveField(selector, name)
{

    // Get the element
    const $el = jQuery('#' + selector)

    // Add a placeholder
    tillitAddPlaceholder($el, name)

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

function tillitRevertField(selector, name)
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

function tillitMoveFields()
{

    // Get the account type
    const accountType = tillitGetAccountType()

    // If business account
    if(accountType === 'business') {
        tillitMoveField('billing_first_name_field', 'fn')
        tillitMoveField('billing_last_name_field', 'ln')
        tillitMoveField('billing_phone_field', 'ph')
        tillitMoveField('billing_email_field', 'em')
    } else {
        tillitRevertField('billing_first_name_field', 'fn')
        tillitRevertField('billing_last_name_field', 'ln')
        tillitRevertField('billing_phone_field', 'ph')
        tillitRevertField('billing_email_field', 'em')
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

function tillitToggleRequiredFields($targets, accountType)
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

function tillitToggleCompanyFields(accountType)
{

    // Get the targets
    const $targets = jQuery('.woocommerce-company-fields, .woocommerce-representative-fields, #company_id_field, #billing_company_field')

    // Toggle the targets based on the account type
    accountType === 'personal' ? $targets.hide() : $targets.show()

    // Toggle the required fields based on the account type
    tillitToggleRequiredFields($targets, accountType)

}

/**
 * Hide or show the Tillit payment method
 *
 * @return void
 */

function tillitToggleMethod()
{

    // Get the account type
    const accountType = tillitGetAccountType()

    // Get the Tillit payment method input
    const $tillitPaymentMethod = jQuery(':input[value="woocommerce-gateway-tillit"]')

    // True if the Tillit payment method is disabled
    const isTillitDisabled = tillitMethodHidden === true || accountType === 'personal'

    // Disable the Tillit payment method for personal orders
    $tillitPaymentMethod.attr('disabled', isTillitDisabled)

    // If Tillit is disabled
    if(isTillitDisabled) {

        // Get the Tillit payment method
        const $tillit = jQuery('li.payment_method_woocommerce-gateway-tillit')

        // Get the next or previous target
        const $target = $tillit.prev().length === 0 ? $tillit.next() : $tillit.prev()

        // Activate the next default method
        $target.find('label').click()

    }

}

/**
 * Enable or disable the action button and the payment method based on the account type
 *
 * @return void
 */

function tillitToggleActions()
{

    // Get the account type
    const accountType = tillitGetAccountType()

    // Get the payment method
    const paymentMethod = jQuery(':input[name="payment_method"]:checked').val()

    // Get the place order button
    const $placeOrder = jQuery('#place_order')

    // Disable the place order button if personal order and payment method is Tillit
    $placeOrder.attr('disabled', accountType === 'personal' && paymentMethod === 'woocommerce-gateway-tillit')

    // Enable or disable the Tillit method
    tillitToggleMethod()

    // Select the default method
    tillitSelectDefaultMethod()

}

/**
 * Handle the account type change
 *
 * @return void
 */

function tillitChangeAccountType()
{

    // Get the input
    const $input = jQuery(this)

    // Toggle the company fields
    tillitToggleCompanyFields($input.val())

    // Toggle the actions
    tillitToggleActions()

    // Move the fields
    tillitMoveFields()

    // Show or hide the payment method
    tillitToggleMethod()

}

/**
 * Extract and format the dropdown options
 *
 * @param results
 *
 * @returns {[]|*[]}
 */

function tillitExtractItems(results)
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

function tillitSelectDefaultMethod()
{

    // Get the account type
    const accountType = tillitGetAccountType()

    // Get the Tillit payment method input
    const $tillitPaymentMethod = jQuery(':input[value="woocommerce-gateway-tillit"]')

    // Get the Tillit payment block
    const $tillit = jQuery('.payment_method_woocommerce-gateway-tillit')

    // True if the Tillit payment method is disabled
    const isTillitDisabled = tillitMethodHidden === true || accountType === 'personal'

    // Disable the Tillit payment method for personal orders
    $tillitPaymentMethod.attr('disabled', isTillitDisabled)

    // If a personal account
    if(isTillitDisabled) {

        // Select the first visible payment method
        $tillit.parent().find('li:visible').eq(0).find('label').click()

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

const tillitCheckoutApiRequest = function(endpoint, companyId)
{
    return jQuery.ajax({
        dataType: 'json',
        url: [tillitCheckoutApi, 'company', companyId, endpoint].join('/')
    })
}

/**
 * Fetch the company approval status and the address
 *
 * @param companyId
 */

function tillitGetApproval(companyId)
{

    // Check the company approval
    const approvalResponse = tillitCheckoutApiRequest('approve', companyId)

    approvalResponse.done(function(response){

        // Toggle the Tillit payment method
        tillitMethodHidden = !response.approved

        // Show or hide the Tillit payment method
        tillitToggleMethod()

        // Select the default payment method
        tillitSelectDefaultMethod()

        // Fetch the company data
        const addressResponse = tillitCheckoutApiRequest('address', companyId)

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

        })

    })

}

jQuery(function(){

    const $body = jQuery(document.body)

    // Get the checkout form
    const $checkout = jQuery('.woocommerce-checkout')

    // Stop if not the checkout page
    if($checkout.length === 0) return

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
        tillitToggleCompanyFields(accountType)

        // Move the fields
        tillitMoveFields()

    }

    // Disable or enable actions based on the account type
    $body.on('updated_checkout', tillitToggleActions)

    // Handle account type change
    $checkout.on('change', '[name="account_type"]', tillitChangeAccountType)

    // Toggle the actions when the payment method changes
    // $checkout.on('change', '[name="payment_method"]', tillitToggleActions)

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
                    results: tillitExtractItems(response),
                    pagination: {
                        more: (params.page * tillitSearchLimit) < response.data.total
                    }
                }

            }
        }
    }).on('select2:select', function(e){

        // Get the option data
        const data = e.params.data

        // Set the company ID
        $companyId.val(data.company_id)

        // Get the company approval status
        tillitGetApproval(data.company_id)

    })

    /**
     * Fix the position bug
     * https://github.com/select2/select2/issues/4614
     */

    const instance = $billingCompany.data('select2')

    instance.on('open', function(e){
        this.results.clear()
        this.dropdown._positionDropdown()
    })

})
