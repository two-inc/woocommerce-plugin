context('Actions', () => {

  beforeEach(() => {
    cy.clearCookies({ domain: null })
  })

  it('Checkout OK', () => {

    // Login
    // cy.fixture('buyers').then((buyers) => {
    //     cy.customerLogin(buyers[0].username, buyers[0].password)
    // })

    // Add to cart
    for (let i = 0; i < 2; i++) {
        cy.addToCart(i)
    }

    // Checkout
    cy.goToCheckout()
    cy.fixture('buyers').then((buyers) => {
        cy.fillCheckout(buyers[0])
    })
    cy.placeOrder()

    // Verification
    cy.verifySms('1234')

    // Order verified
    cy.get('.woocommerce-order-overview__order strong').should('exist')
    cy.get('.woocommerce-order-overview__order strong').then((orderId) => {
        cy.setGlobalVars('orderId', orderId)
    })

  })

})
