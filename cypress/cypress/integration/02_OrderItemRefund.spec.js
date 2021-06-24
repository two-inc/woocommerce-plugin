context('Actions', () => {

    beforeEach(() => {
        cy.clearCookies({ domain: null })
    })

    it('Admin refunds order items', () => {

        cy.task('getOrderId').then((orderId) => {

            cy.loginAsAdmin()

            cy.goToOrderList()

            cy.goToOrder(orderId)

            cy.checkTillitOrderStatus('FULFILLED')

            cy.refundOrderItems([1, 1])

            cy.checkTillitOrderStatus('REFUNDED')

            cy.wait(3000)

        })

    });

})
