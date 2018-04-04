const TreeDAG = require('dfinity-radix-tree/datastore.js')
const cbor = require('borc')
const fetch = typeof window != 'undefined' ? window.fetch : require('node-fetch')

module.exports = class RemoteTreeDAG extends TreeDAG {
  constructor (dag, remoteURI, decoder) {
    super(dag, decoder)
    this.remoteURI = remoteURI
  }

  async get (link) {
    let res
    try {
      res = await super.get(link)
    } catch (e) {
      // console.warn(e.message)
    }
    if (res) {
      return res
    } else if (this.remoteURI) {
      await this.fetchRemote(link)
      return super.get(link)
    }
  }

  fetchRemote (key) {
    if (!Buffer.isBuffer(key)) {
      key = Buffer.from(key.buffer)
    }

    return fetch(`${this.remoteURI}/getLink/${key.toString('hex')}`)
      .then(res => res.text())
      .then(text => {
        const encoded = Buffer.from(text, 'base64')
        return new Promise((resolve, reject) => {
          this._dag.put(key, encoded.toString('hex'), () => {
            resolve(key)
          })
        })
      })
      .catch(err => {
        console.warn('error fetching remote:', err.message)
      })
  }
}
