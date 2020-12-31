const tillitRequiredField = '<abbr class="required" title="required">*</abbr>'

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
 * Enable or disable the action button and the payment method based on the account type
 *
 * @return void
 */

function tillitToggleActions()
{

    // Get the account type
    const accountType = jQuery(':input[name="account_type"]:checked').val()

    // Get the payment method
    const paymentMethod = jQuery(':input[name="payment_method"]:checked').val()

    // Get the Tillit payment method
    const $tillitPaymentMethod = jQuery(':input[value="woocommerce-gateway-tillit"]')

    // Get the place order button
    const $placeOrder = jQuery('#place_order')

    // Disable the Tillit payment method for personal orders
    $tillitPaymentMethod.attr('disabled', accountType === 'personal')

    // Disable the place order button if personal order and payment method is Tillit
    $placeOrder.attr('disabled', accountType === 'personal' && paymentMethod === 'woocommerce-gateway-tillit')

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

}

jQuery(function(){

    const $body = jQuery(document.body)

    // Get the checkout form
    const $checkout = jQuery('.woocommerce-checkout')

    // Stop if not the checkout page
    if($checkout.length === 0) return

    // Get the account type input
    const $accountType = jQuery('[name="account_type"]:checked')

    // If we found the field
    if($accountType.length > 0) {

        // Get the account type
        const accountType = $accountType.val()

        // Toggle the company fields
        tillitToggleCompanyFields(accountType)

    }

    // Disable or enable actions based on the account type
    $body.on('updated_checkout', tillitToggleActions)

    // Handle account type change
    $checkout.on('change', '[name="account_type"]', tillitChangeAccountType)

    // Toggle the actions when the payment method changes
    $checkout.on('change', '[name="payment_method"]', tillitToggleActions)

})
