// On-device storage. Every adapter has the same five methods, so the phone and desktop apps can
// bring their own (SQLite, files) and reuse store.js unchanged:
//
//   load()                 -> { meta, ops, rejected }   meta: { state, device }
//   add(op)                resolves only when the operation is safely on the device
//   settle({ state, done, rejected, stamp })   one transaction: cache the state, remove answered operations
//   dropRejected(op_id)
//   setMeta(name, value)

export function memoryStorage(seed = {}) {
  const data = { meta: { ...seed.meta }, ops: [...(seed.ops || [])], rejected: [...(seed.rejected || [])] }
  const copy = value => structuredClone(value)
  return {
    durable: false,
    data,
    async load() { return copy(data) },
    async add(op) { data.ops.push(copy(op)) },
    async settle({ state, done = [], rejected = [] }) {
      const gone = new Set([...done, ...rejected.map(row => row.op.op_id)])
      data.ops = data.ops.filter(op => !gone.has(op.op_id))
      data.rejected.push(...copy(rejected))
      if (state) data.meta.state = copy(state)
    },
    async dropRejected(id) { data.rejected = data.rejected.filter(row => row.op.op_id !== id) },
    async setMeta(name, value) { data.meta[name] = copy(value) },
  }
}

const VERSION = 1

export async function indexedDbStorage(name, factory = globalThis.indexedDB) {
  if (!factory) throw new Error('This browser cannot store data on the device')
  const db = await new Promise((resolve, reject) => {
    const request = factory.open(name, VERSION)
    request.onupgradeneeded = () => {
      const created = request.result
      created.createObjectStore('meta')
      created.createObjectStore('ops', { keyPath: 'seq', autoIncrement: true })
      created.createObjectStore('rejected', { autoIncrement: true })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Another tab is blocking on-device storage'))
  })
  db.onversionchange = () => db.close()

  // Resolves on transaction completion, not on request success: only then is the data really stored.
  function write(stores, work) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(stores, 'readwrite', { durability: 'strict' })
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error || new Error('Saving on this device failed'))
      transaction.onerror = () => {}
      work(transaction)
    })
  }
  function entries(store, visit) {
    const request = store.openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      visit(cursor)
      cursor.continue()
    }
  }

  return {
    durable: true,
    load() {
      return new Promise((resolve, reject) => {
        const result = { meta: {}, ops: [], rejected: [] }
        const transaction = db.transaction(['meta', 'ops', 'rejected'], 'readonly')
        entries(transaction.objectStore('meta'), cursor => { result.meta[cursor.key] = cursor.value })
        entries(transaction.objectStore('ops'), cursor => { result.ops.push(cursor.value.op) })
        entries(transaction.objectStore('rejected'), cursor => { result.rejected.push(cursor.value) })
        transaction.oncomplete = () => resolve(result)
        transaction.onabort = () => reject(transaction.error || new Error('Reading from this device failed'))
      })
    },
    add(op) { return write(['ops'], transaction => { transaction.objectStore('ops').add({ op }) }) },
    settle({ state, done = [], rejected = [] }) {
      const gone = new Set([...done, ...rejected.map(row => row.op.op_id)])
      return write(['meta', 'ops', 'rejected'], transaction => {
        entries(transaction.objectStore('ops'), cursor => { if (gone.has(cursor.value.op.op_id)) cursor.delete() })
        for (const row of rejected) transaction.objectStore('rejected').add(row)
        if (state) transaction.objectStore('meta').put(state, 'state')
      })
    },
    dropRejected(id) {
      return write(['rejected'], transaction => {
        entries(transaction.objectStore('rejected'), cursor => { if (cursor.value.op.op_id === id) cursor.delete() })
      })
    },
    setMeta(key, value) { return write(['meta'], transaction => { transaction.objectStore('meta').put(value, key) }) },
    close() { db.close() },
  }
}
