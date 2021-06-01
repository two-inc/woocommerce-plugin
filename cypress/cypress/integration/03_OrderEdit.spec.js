context('Actions', () => {

    beforeEach(() => {
        cy.clearCookies({ domain: null })
    })

    it('Customer creates an order', () => {

        cy.customerCreateOrderFlow(2, 0, '1234')

        // Get order id
        cy.get('.woocommerce-order-overview__order strong').should('exist')
        cy.get('.woocommerce-order-overview__order strong').invoke('text').then(createdOrderId => {
            cy.task('setOrderId', createdOrderId)
        })

    })

    it('Admin edits the order', () => {

        cy.task('getOrderId').then((orderId) => {

            cy.loginAsAdmin()

            cy.goToOrderList()

            cy.goToOrder(orderId)

            cy.checkTillitOrderStatus('VERIFIED')

            //@TODO: cy.editOrder()

            //@TODO: cy.checkUpdated()

            cy.wait(1000)

        })

    });

})
