context('Actions', () => {

    beforeEach(() => {
        cy.clearCookies({ domain: null })
    })

    it('Admin cancels the order', () => {

        cy.task('getOrderId').then((orderId) => {

            cy.loginAsAdmin()

            cy.goToOrderList()

            cy.goToOrder(orderId)

            cy.checkTillitOrderStatus('VERIFIED')

            cy.updateOrderStatus('cancelled')

            cy.checkTillitOrderStatus('CANCELLED')

            cy.wait(1000)

        })

    });

})
