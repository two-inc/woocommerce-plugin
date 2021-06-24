function getBasicAuthString() {
    return 'Basic ' + btoa(Cypress.env('TEST_API_USER') + ':' + Cypress.env('TEST_API_KEY'))
}

function getTillitMerchantId() {
    return Cypress.env('TEST_API_USER')
}


Cypress.Commands.add('tillitGetOrder', (tillitOrderId) => {

    cy.request({
        url: Cypress.env('TEST_CHECKOUT_API_HOST') + '/v1/order/' + tillitOrderId,
        method: 'GET',
        headers: {
            'Authorization': getBasicAuthString(),
            'Tillit-Merchant-Id': getTillitMerchantId()
        }
    }).as('tillitResponse')

})


Cypress.Commands.add('tillitIsState', (state) => {

    cy.get('@tillitResponse').should((response) => {
        expect(response.body).to.have.property('state')
        expect(response.body.state).to.equal(state)
    })

})
