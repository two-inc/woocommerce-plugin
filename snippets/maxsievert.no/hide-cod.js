function onAccountTypeChange() {
    // Hide the method for non-business accounts
    if (twoincUtilHelper.isCompany(twoincDomHelper.getAccountType())) {
        if (jQuery('#payment_method_cod').prop('checked')) {
            sessionStorage.setItem('codSelected', 'y')
        }
        twoincDomHelper.deselectPaymentMethod(jQuery('#payment_method_cod'))
        jQuery('li.wc_payment_method.payment_method_cod').hide()
    } else {
        jQuery('li.wc_payment_method.payment_method_cod').show()
        if (sessionStorage.getItem('codSelected') === 'y') {
            setTimeout(function() {jQuery('#payment_method_cod').click()}, 100)
        }
    }
}

if (window.twoinc) {

    // Show/Hide COD on account type change
    jQuery('.woocommerce-checkout [name="account_type"]').on('change', onAccountTypeChange)

    // Clear sessionStorage codSelected on payment method change
    jQuery('.woocommerce-checkout [name="payment_method"]').on('change', function() {
        setTimeout(function() {
            if (!twoincUtilHelper.isCompany(twoincDomHelper.getAccountType())) {
                if (jQuery('#payment_method_cod').prop('checked')) {
                    sessionStorage.setItem('codSelected', 'y')
                } else {
                    sessionStorage.removeItem('codSelected')
                }
            }
        }, 1000)
    })

    jQuery(function(){
        setTimeout(function() {
            onAccountTypeChange()
            if (jQuery('#payment_method_cod').prop('checked')) {
                sessionStorage.setItem('codSelected', 'y')
            }
        }, 2000)
    })

}
