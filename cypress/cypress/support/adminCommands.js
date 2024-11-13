Cypress.Commands.add("loginAsAdmin", () => {
  cy.visit(Cypress.env("TEST_WP_HOST_NAME") + Cypress.env("TEST_WP_LOGIN_PATH"));
  cy.wait(1000);
  cy.get("#user_login").should("exist");
  cy.get("#user_login").type(Cypress.env("TEST_WP_ADMIN_USERNAME"));
  cy.get("#user_pass").should("exist");
  cy.get("#user_pass").type(Cypress.env("TEST_WP_ADMIN_PASSWORD"));
  cy.get("#wp-submit").should("exist");
  cy.get("#wp-submit").click();
  cy.get("#adminmenumain").should("exist");
});

Cypress.Commands.add("goToOrderList", () => {
  cy.visit(Cypress.env("TEST_WP_HOST_NAME") + Cypress.env("TEST_WP_ADM_ORDERS_PATH"));
  cy.get("#order_number").should("exist");
});

Cypress.Commands.add("goToOrder", (orderId) => {
  cy.contains("a.order-view", "#" + orderId).should("exist");
  cy.contains("a.order-view", "#" + orderId).click();
});

Cypress.Commands.add("checkTillitOrderStatus", (state) => {
  cy.get('#the-list input[value="tillit_order_id"]').should("exist");
  cy.get('#the-list input[value="tillit_order_id"]')
    .invoke("attr", "id")
    .then((metaKey) => {
      let valueFieldId = metaKey.slice(0, -3) + "value";
      cy.get("#" + valueFieldId).should("exist");
      cy.get("#" + valueFieldId)
        .invoke("val")
        .then((tillitOrderId) => {
          cy.log(tillitOrderId);
          cy.tillitGetOrder(tillitOrderId);
          cy.tillitIsState(state);
        });
    });
});

Cypress.Commands.add("updateOrderStatus", (status) => {
  cy.get("#select2-order_status-container").should("exist");
  cy.get("#select2-order_status-container").click();

  cy.get("#select2-order_status-results li[id$=" + status + "]").should("exist");
  cy.get("#select2-order_status-results li[id$=" + status + "]").click();

  cy.get('#woocommerce-order-actions button[name="save"]').should("exist");
  cy.get('#woocommerce-order-actions button[name="save"]').click();

  cy.get(".updated.notice-success").should("exist");
});

Cypress.Commands.add("refundOrderItems", (quantities) => {
  cy.get("button.refund-items").should("exist");
  cy.get("button.refund-items").click();

  for (let idx in quantities) {
    cy.get(".refund_order_item_qty").should("exist");
    cy.get(".refund_order_item_qty").eq(idx).should("exist");
    cy.get(".refund_order_item_qty").eq(idx).clear().type(quantities[idx]);
  }

  cy.get("#order_refunds .refund").should("have.length", 0);

  cy.get("button.do-api-refund").should("exist");
  cy.get("button.do-api-refund").click();

  cy.on("window:confirm", () => true);

  cy.get("#order_refunds .refund").should("have.length", 1);
});
