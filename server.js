const cbor = require('borc')
const Message = require('./message.js')
const Hypervisor = require('./')
const {ID, decoder} = require('./systemObjects')
const WasmContainer = require('./wasmContainer.js')

const level = require('level-browserify')
const RadixTree = require('dfinity-radix-tree')

const DfinityTx = require('dfinity-tx')

class TestWasmContainer extends WasmContainer {
  constructor (actor) {
    super(actor)
    this._storage = new Map()
  }
  getInterface (funcRef) {
    const orginal = super.getInterface(funcRef)
    return Object.assign(orginal, {
      test: {
        check: (a, b) => {
        },
        print: (dataRef) => {
          let buf = this.refs.get(dataRef, 'buf')
          console.log(buf.toString())
        }
      }
    })
  }
}


const IO_ACTOR_ID = 0

module.exports = class PrimeaServer {
  constructor(opts={}) {
    const defaults = this.constructor.defaults
    this._opts = Object.assign(defaults, opts)

    const db = level(this._opts.dbPath)
    const rootHash = this._opts.rootHash

    const tree = new RadixTree({
      db: db,
      root: rootHash
    })

    this.hypervisor = new Hypervisor(tree, [TestWasmContainer])

    console.log('primea: started')
  }

  async ingress (raw) {
    const tx = await DfinityTx.deserialize(raw)
    const args = tx.args

    let id, module
    if (tx.actorId === IO_ACTOR_ID) {
      const actor = await this.hypervisor.createActor(TestWasmContainer.typeId, args.shift())
      id = actor.id
      module = actor.module

    } else {
      id = new ID(tx.actorId)
      module = await this.hypervisor.loadActor(id.id)
    }

    const funcRef = module.getFuncRef(tx.funcname)
    funcRef.gas = tx.ticks

    this.hypervisor.send(new Message({
      funcRef,
      funcArguments: args
    }).on('execution:error', e => console.log(e)))
    return cbor.encode(id)
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
    return res['/']
  }

  setStateRoot (root) {
    console.log('setStateRoot', root)
    this.hypervisor.tree.root['/'] = root
  }

  _getId (encodedId) {
    if (!(encodedId instanceof ID)) {
      return decoder.decodeFirst(encodedId)
    }
    return encodedId
  }

  static get defaults () {
    return {
      dbPath: './testdb',
      rootHash: 0,
    }
  }
}
