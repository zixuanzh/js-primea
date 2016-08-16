const Environment = require('./environment.js')

module.exports = class TestEnvironment extends Environment {
  constructor (data) {
    super()
  
    if (typeof data === 'string') {
      data = JSON.parse(data)
    }

    let self = this

    if (data.accounts) {
      data.accounts.forEach((account) => {
        self.state.set(new Uint8Array(account[0]).toString(), account[1])
      })
    }

    if (data.address) {
      self.address = new Uint8Array(data.address)
    }

    if (data.origin) {
      self.origin = new Uint8Array(data.origin)
    }

    if (data.caller) {
      self.caller = new Uint8Array(data.caller)
    }

    if (data.callValue) {
      self.callValue = new Uint8Array(data.callValue)
    }

    if (data.callData) {
      self.callData = hexStr2arrayBuf(data.callData)
    }
  }
}

function hexStr2arrayBuf (string) {
  const ab = new ArrayBuffer(string.length / 2)
  const view = new Uint8Array(ab)
  string = [...string]
  let temp = ''
  string.forEach((el, i) => {
    temp += el
    if (i % 2) {
      view[(i + 1) / 2 - 1] = parseInt(temp, 16)
      temp = ''
    }
  })
  return ab
}
