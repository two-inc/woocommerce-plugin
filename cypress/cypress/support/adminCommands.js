Cypress.Commands.add('loginAsAdmin', () => {
    cy.visit(Cypress.env('TEST_WP_HOST_NAME') + Cypress.env('TEST_WP_LOGIN_PATH'))
    cy.get('#user_login').should('exist')
    cy.get("#user_login").type(Cypress.env('TEST_WP_ADMIN_USERNAME'))
    cy.get('#user_pass').should('exist')
    cy.get("#user_pass").type(Cypress.env('TEST_WP_ADMIN_PASSWORD'))
    cy.get('#wp-submit').should('exist')
    cy.get("#wp-submit").click()
    cy.get('#adminmenumain').should('exist')
})


Cypress.Commands.add('goToOrders', () => {
    cy.visit(Cypress.env('TEST_WP_HOST_NAME') + Cypress.env('TEST_WP_ADM_ORDERS_PATH'))
    cy.get('#order_number').should('exist')
})
