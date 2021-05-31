context('Actions', () => {

    beforeEach(() => {
        cy.clearCookies({ domain: null })
    })

    let orderId = null

    it('Customer creates an order', () => {

        cy.customerCreateOrderFlow(2, 0, '1234')

        // Get order id
        cy.get('.woocommerce-order-overview__order strong').should('exist')
        cy.get('.woocommerce-order-overview__order strong').invoke('text').then(createdOrderId => {
            orderId = createdOrderId
        })

    })

    it('Admin marks the order as completed', () => {

        cy.loginAsAdmin()
        cy.goToOrders()
        cy.contains('a.order-view', '#' + orderId).should('exist')
        cy.contains('a.order-view', '#' + orderId).click()

    });

})
