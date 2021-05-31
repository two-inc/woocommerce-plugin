Cypress.Commands.add('customerCreateOrderFlow', (numberOfLineItems, buyerIdx, otp) => {

        // Add to cart
        for (let i = 0; i < numberOfLineItems; i++) {
            cy.addToCart(i)
        }

        // Checkout
        cy.goToCheckout()
        cy.fixture('buyers').then((buyers) => {
            cy.fillCheckout(buyers[buyerIdx])
        })
        cy.placeOrder()

        // Verify
        cy.verifySms(otp)

})
