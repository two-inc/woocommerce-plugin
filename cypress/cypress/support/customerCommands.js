function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min
}


Cypress.Commands.add('loginAsCustomer', (username, password) => {
    cy.visit(Cypress.env('TEST_WP_HOST_NAME') + Cypress.env('TEST_WP_LOGIN_PATH'))
    cy.get('#user_login').should('exist')
    cy.get("#user_login").type(username)
    cy.get('#user_pass').should('exist')
    cy.get("#user_pass").type(password)
    cy.get('#wp-submit').should('exist')
    cy.get("#wp-submit").click()
    cy.get('.woocommerce-MyAccount-navigation-link').should('exist')
})


Cypress.Commands.add('addToCart', (idx) => {
    cy.visit(Cypress.env('TEST_WP_HOST_NAME') + Cypress.env('TEST_WP_PRODUCTS_PATH'))
    cy.get('a.woocommerce-LoopProduct-link').should('exist')
    cy.get('a.woocommerce-LoopProduct-link').eq(idx).should('exist')
    cy.get('a.woocommerce-LoopProduct-link').eq(idx).click()
    cy.get('form.cart .quantity input').should('exist')
    cy.get('form.cart .quantity input').clear().type(getRandomInt(3,8))
    cy.get('button.single_add_to_cart_button').should('exist')
    cy.get('button.single_add_to_cart_button').click()
})


Cypress.Commands.add('goToCheckout', () => {
    cy.visit(Cypress.env('TEST_WP_HOST_NAME') + Cypress.env('TEST_WP_CHECKOUT_PATH'))
    cy.get('#payment_method_woocommerce-gateway-tillit').should('exist')
    cy.get('#payment_method_woocommerce-gateway-tillit').should('not.be.checked')
    cy.contains('Enter company name to pay on invoice').should('exist')
    cy.contains('Receive the invoice via EHF and email').should('not.exist')
    cy.get('#billing_address_1').should('have.value', '')
    cy.get('#billing_postcode').should('have.value', '')
    cy.get('#billing_city').should('have.value', '')
})


Cypress.Commands.add('fillCheckout', (b) => {
    cy.get('#billing_first_name').should('exist')
    cy.get('#billing_first_name').clear().type(b.firstName)
    cy.get('#billing_last_name').should('exist')
    cy.get('#billing_last_name').clear().type(b.lastName)
    cy.get('#billing_phone').should('exist')
    cy.get('#billing_phone').clear().type(b.phone)
    cy.get('#billing_email').should('exist')
    cy.get('#billing_email').clear().type(b.email)

    cy.get('#select2-billing_country-container').should('exist')
    cy.get('#select2-billing_country-container').click()
    cy.get('input[aria-owns="select2-billing_country-results"]').should('exist')
    cy.get('input[aria-owns="select2-billing_country-results"]').clear().type(b.country)
    cy.get('#select2-billing_country-results .select2-results__option').contains(b.country).should('exist')
    cy.get('#select2-billing_country-results .select2-results__option').contains(b.country).click()

    let companyIdRegex = new RegExp('\\\(' + b.companyId + '\\)')
    cy.get('#select2-billing_company-container').should('exist')
    cy.get('#select2-billing_company-container').click()
    cy.get('input[aria-owns="select2-billing_company-results"]').should('exist')
    cy.get('input[aria-owns="select2-billing_company-results"]').clear().type(b.companyName)
    cy.contains('#select2-billing_company-results .select2-results__option', companyIdRegex).should('exist')
    cy.contains('#select2-billing_company-results .select2-results__option', companyIdRegex).click()

    cy.get('#department').should('exist')
    cy.get('#department').clear().type(b.department)
    cy.get('#project').should('exist')
    cy.get('#project').clear().type(b.project)

    cy.get('#billing_postcode').should('have.value', b.postcode)
    cy.get('#billing_city').should('have.value', b.city)
    cy.get('#billing_address_1').should('not.have.value', '') // no exact comparison due to encoding issue
})


Cypress.Commands.add('placeOrder', (b) => {
    cy.contains('Receive the invoice via EHF and email').should('exist')
    cy.get('#payment_method_woocommerce-gateway-tillit').should('be.checked')

    cy.get('#place_order').should('exist')
    cy.get('#place_order').click()
})


Cypress.Commands.add('verifySms', (otp) => {
    cy.get('input[type="number"]').eq(0).should('exist')
    cy.get('input[type="number"]').eq(0).clear().type(otp)
    cy.contains('button', 'Submit').should('exist')
    cy.contains('button', 'Submit').click()
})
