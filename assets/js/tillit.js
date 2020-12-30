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
    const $targets = jQuery('.woocommerce-company-fields, .woocommerce-representative-fields, #company_id_field, #company_name_field')

    // Toggle the targets based on the account type
    accountType === 'personal' ? $targets.hide() : $targets.show()

    // Toggle the required fields based on the account type
    tillitToggleRequiredFields($targets, accountType)

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

}

jQuery(function(){

    // Get the checkout form
    const $checkout = jQuery('.woocommerce-checkout')

    // Stop if not the checkout page
    if($checkout.length === 0) return

    // Get the account type input
    const $accountType = jQuery('[name="account_type"]:checked')

    // If we found the field
    if($accountType.length > 0) {

        // Toggle the company fields
        tillitToggleCompanyFields($accountType.val())

    }

    // Handle account type change
    $checkout.on('change', '[name="account_type"]', tillitChangeAccountType)

})
