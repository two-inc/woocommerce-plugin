context('Actions', () => {

    beforeEach(() => {
        cy.clearCookies({ domain: null })
    })

    it('Complete order', () => {
        cy.adminLogin()
        cy.adminGoToOrders()
        cy.getGlobalVars('orderId').then((orderId) => {
            cy.log(orderId)
            cy.contains('a.order-view', '#' + orderId).should('exist')
            cy.contains('a.order-view', '#' + orderId).click()
        })
    });

})
