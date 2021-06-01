module.exports = (on, config) => {
  on('task', {
    setOrderId(val) {
      return (orderId = val)
    },
    getOrderId() {
      return orderId
    },
  })
}