const cbor = require('borc')
const Hypervisor = require('./')
const EgressDriver = require('./egressDriver')
const { ID, Message, decoder: objectDecoder } = require('primea-objects')
const WasmContainer = require('primea-wasm-container')

const level = require('level-browserify')
const RadixTree = require('dfinity-radix-tree')
const RemoteDataStore = require('./remoteDatastore')

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
          let buf = this.refs.get(dataRef, 'data')
          console.log(buf.toString())
        }
      }
    })
  }
}

const decoder = new cbor.Decoder({
  tags: Object.assign(objectDecoder._knownTags, DfinityTx.getDecoder()._knownTags)
})

const IO_ACTOR_ID = Buffer.from([])

module.exports = class PrimeaServer {
  constructor(opts={}) {
    const defaults = this.constructor.defaults
    this._opts = Object.assign(defaults, opts)

    const db = level(this._opts.dbPath)
    const rootHash = this._opts.rootHash

    const treeOpts = {
      root: rootHash
    }

    if (this._opts.remoteURI) {
      treeOpts.dag = new RemoteDataStore(db, this._opts.remoteURI)
      console.log('new primea with RemoteDataStore @', this._opts.remoteURI)
    } else {
      treeOpts.db = db
    }

    const tree = new RadixTree(treeOpts)

    this.egress = new EgressDriver()

    this.hypervisor = new Hypervisor({
      tree,
      containers: this._opts.containers,
      drivers: [this.egress]
    })
  }

  async ingress (raw) {
    const [ tx, pk, sig ] = decoder.decodeFirst(raw)
    const args = tx.args.map(arg => {
      if (arg.constructor.name === 'Tagged') {
        return decoder.decodeFirst(cbor.encode(arg))
      }
      return arg
    })

    let id, module, funcRef
    if (tx.actorId.equals(IO_ACTOR_ID)) {
      const actor = await this.hypervisor.createActor(this._opts.containers[0].typeId, args.shift())
      id = actor.id
      module = actor.module
      funcRef = module.getFuncRef(tx.funcName)
    } else {
      funcRef = tx.funcName
    }
    funcRef.gas = tx.ticks

    if (tx.funcName) {
      this.hypervisor.send(new Message({
        funcRef,
        funcArguments: args
      }).on('execution:error', e => this.egress.emit('error', e)))
    }

    return cbor.encode(module)
  }

  async getLink (link) {
    const res = await this.hypervisor.tree.graph._dag.get(link)
    return cbor.encode(res)
  }

  async getNonce (id) {
    id = this._getId(id)
    const node = await this.hypervisor.tree.get(id.id)
    const res = node.value[1]
    return cbor.encode(res)
  }

  async getCode (id) {
    id = this._getId(id)
    const node = await this.hypervisor.tree.get(id.id)
    const res = await this.hypervisor.tree.graph.get(node.node, '1')
    return cbor.encode(res)
  }

  async getStorage (id) {
    id = this._getId(id)
    const node = await this.hypervisor.tree.get(id.id)
    const res = await this.hypervisor.tree.graph.get(node.node, '2')
    return cbor.encode(res)
  }

  async getStateRoot () {
    const res = await this.hypervisor.createStateRoot()
    return res
  }

  setStateRoot (root) {
    return this.hypervisor.setStateRoot(root)
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
      containers: [TestWasmContainer]
    }
  }
}
