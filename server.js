const cbor = require('borc')
const Hypervisor = require('./')
const EgressDriver = require('./egressDriver')
const { ID, Message, decoder: objectDecoder } = require('primea-objects')
const WasmContainer = require('primea-wasm-container')

const level = require('level-browserify')
const RadixTree = require('dfinity-radix-tree')
const RemoteDataStore = require('dfinity-radix-tree/remoteDatastore')

const DfinityTx = require('dfinity-tx')

class TestWasmContainer extends WasmContainer {
  constructor (actor) {
    super(actor)
    this._storage = new Map()
    const self = this
    const inter = {
      test: {
        check: (a, b) => {
          tester.equals(a, b)
        },
        printStr: (dataRef) => {
          let buf = self.refs.get(dataRef, 'data')
          console.log('test.printStr:', buf.toString())
        },
        printBuf: (dataRef) => {
          let buf = self.refs.get(dataRef, 'data')
          console.log('test.printBuf:', buf)
        },
        printRaw: (val) => {
          console.log('test.printRaw:', val)
        }
      },
      env: {
        abort: () => {
          console.log('abort!')
        }
      }
    }
    this.interface = Object.assign(this.interface, inter)
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
      treeOpts.dag = new RemoteDataStore(db, { uri: this._opts.remoteURI })
      console.log('new RemoteDataStore @', this._opts.remoteURI)
    } else {
      treeOpts.db = db
    }

    const tree = new RadixTree(treeOpts)

    this.logger = new EgressDriver()

    this.hypervisor = new Hypervisor({
      tree,
      modules: this._opts.modules,
      defaultDriver: this.logger,
      onGenerateId: this._opts.onGenerateId
    })
  }

  resetDatastore() {
    return this.setStateRoot(RadixTree.emptyTreeState)
  }

  async ingress (raw) {
    const [ tx, pk, sig ] = decoder.decodeFirst(raw)
    const args = tx.args.map(arg => {
      if (arg.constructor.name === 'Tagged') {
        return decoder.decodeFirst(cbor.encode(arg))
      }
      return arg
    })

    let id, actor, funcRef
    if (typeof tx.funcName == 'object' && tx.funcName.constructor && tx.funcName.constructor.name == 'FunctionRef') {
      funcRef = tx.funcName

    } else if (Buffer.isBuffer(tx.actorId) && IO_ACTOR_ID.equals(tx.actorId)) {
      actor = await this.hypervisor.newActor(this._opts.modules[0], args.shift())
      funcRef = actor.getFuncRef(tx.funcName)

    } else if (typeof tx.funcName == 'string') {
      id = this._getId(tx.actorId)
      const _actor = await this.hypervisor.loadActor(id)
      actor = _actor.container.actorSelf
      funcRef = actor.getFuncRef(tx.funcName)
    }
    funcRef.gas = tx.ticks

    if (tx.funcName) {
      this.hypervisor.send(new Message({
        funcRef,
        funcArguments: args
      }))
    }

    return cbor.encode(actor)
  }

  async getActor (id) {
    id = this._getId(id)
    const actor = await this.hypervisor.loadActor(id)
    const actorRef = actor.container.actorSelf
    return cbor.encode(actorRef)
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
    const module = await this.hypervisor.tree.graph.get(node.node, '1')
    await this.hypervisor.tree.graph.get(module[1], '')
    return cbor.encode(module[1]['/'])
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

  _getId (id) {
    if (typeof id == 'object' && id.constructor && id.constructor.name === 'ID') {
      return id
    }
    try {
      return decoder.decodeFirst(id)
    } catch (e) {
      return new ID(id)
    }
  }

  static get defaults () {
    return {
      dbPath: './testdb',
      rootHash: 0,
      modules: [TestWasmContainer]
    }
  }
}
