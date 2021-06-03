const basicAuthString = 'Basic dGlsbGl0OnNlY3JldF9wcm9kX2VQTGM0eXpSdzJ3LXNVekpUdFVBQlBNdlRmbkkwV3JhekoxYW90algyQnc='
const tillitMerchantId = 'tillit'


Cypress.Commands.add('tillitGetOrder', (tillitOrderId) => {

    cy.request({
        url: Cypress.env('TEST_CHECKOUT_API_HOST') + '/v1/order/' + tillitOrderId,
        method: 'GET',
        headers: {
            'Authorization': basicAuthString,
            'Tillit-Merchant-Id': tillitMerchantId
        }
    }).as('tillitResponse')

})


Cypress.Commands.add('tillitIsState', (state) => {

    cy.get('@tillitResponse').should((response) => {
        expect(response.body).to.have.property('state')
        expect(response.body.state).to.equal(state)
    })

})
