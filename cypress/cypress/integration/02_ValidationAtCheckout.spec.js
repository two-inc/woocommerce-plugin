context('Actions', () => {

    beforeEach(() => {
        cy.clearCookies({ domain: null })
    })

    it('Admin marks the order as completed', () => {
    	let orderId = 1500
        cy.loginAsAdmin()
        cy.goToOrders()
        cy.contains('a.order-view', '#' + orderId).should('exist')
        cy.contains('a.order-view', '#' + orderId).click()

        cy.get('#select2-order_status-container').should('exist')
        cy.get('#select2-order_status-container').click()

        let status = 'on-hold'
        cy.get('#select2-order_status-results li[id$=' + status + ']').should('exist')
        cy.get('#select2-order_status-results li[id$=' + status + ']').click()

        cy.get('#woocommerce-order-actions button[name="save"]').should('exist')
        cy.get('#woocommerce-order-actions button[name="save"]').click()

        cy.wait(3000)

    });

})
