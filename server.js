const cbor = require('borc')
const Message = require('./message.js')
const Hypervisor = require('./')
const {ID, FunctionRef} = require('./systemObjects')
const WasmContainer = require('./wasmContainer.js')

const level = require('level-browserify')
const RadixTree = require('dfinity-radix-tree')

const DfinityTx = require('dfinity-tx')

class TestWasmContainer extends WasmContainer {
  getInterface (funcRef) {
    const orginal = super.getInterface(funcRef)
    return Object.assign(orginal, {
      test: {
        print: (dataRef) => {
          console.log('print dataRef', dataRef)
          const buf = this.refs.get(dataRef, 'buf')
          console.log('print buf', buf)
          console.log(buf.toString())
        }
      },
    })
  }
}

const IO_ACTOR_ID = 0

module.exports = class PrimeaServer {
  constructor(opts={}) {
    const defaults = this.constructor.defaults
    this._opts = Object.assign(defaults, opts)

    const db = level(this._opts.dbPath)

    const tree = new RadixTree({
      db
    })

    this.hypervisor = new Hypervisor(tree)
    this.hypervisor.registerContainer(TestWasmContainer)

    console.log('starting primea')
  }

  async ingress (raw) {
    const tx = await DfinityTx.deserialize(raw)
    const funcRef = FunctionRef.deserialize(tx.to)
    funcRef.gas = tx.ticks

    if (funcRef.destId.id === IO_ACTOR_ID) {
      const { id, module } = await this.hypervisor.createActor(TestWasmContainer.typeId, tx.data)

      funcRef.destId = id

      this.hypervisor.send(new Message({
        funcRef,
      }))

      return id.serialize()

    } else {
      this.hypervisor.send(new Message({
        funcRef,
        funcArguments: tx.data
      }))

      return 'ok'
    }
  }

  async getNonce (id) {
    id = this._getId(id)
    const node = await this.hypervisor.tree.get(id.id)
    const res = node.value[1]
    console.log(`getNonce ${id.id.toString('hex')}`, res)
    return cbor.encode(res)
  }

  async getCode (id) {
    id = this._getId(id)
    const node = await this.hypervisor.tree.get(id.id)
    const res = await this.hypervisor.tree.graph.get(node.node, '1')
    console.log(`getCode ${id.id.toString('hex')}`, res)
    return cbor.encode(res)
  }

  async getStorage (id) {
    id = this._getId(id)
    const node = await this.hypervisor.tree.get(id.id)
    const res = await this.hypervisor.tree.graph.get(node.node, '2')
    console.log(`getStorage ${id.id.toString('hex')}`, res.map(r => r.toString('utf-8')))
    return cbor.encode(res)
  }

  async getStateRoot () {
    const res = await this.hypervisor.createStateRoot()
    console.log('getStateRoot', res)
    return cbor.encode(res)
  }

  _getId (encodedId) {
    if (!(encodedId instanceof ID)) {
      return ID.deserialize(encodedId)
    }
    return encodedId
  }

  static get defaults () {
    return {
      dbPath: './testdb',
    }
  }
}
