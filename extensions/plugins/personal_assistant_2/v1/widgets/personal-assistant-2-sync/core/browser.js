// The web app's side of the core: one store per signed-in user, IndexedDB, retries, error reporting.

import { createStore } from './store.js'
import { indexedDbStorage, memoryStorage } from './storage.js'

export const API = '/api/v1/personal_assistant_2/'
const RETRY_MS = 20000
const stores = new Map()

// The host client turns every failure into an Error. Network trouble means "offline, try again";
// anything else is an answer from the server.
const UNREACHABLE = /fetch|network|load failed|API is unavailable|non-JSON|timed out|sign in|Session changed/i
export function transport(getApi) {
  return async (path, body) => {
    try {
      return await getApi().request(API + path, body)
    } catch (cause) {
      const error = new Error(cause?.message || 'Request failed')
      error.offline = cause instanceof TypeError || UNREACHABLE.test(error.message)
      throw error
    }
  }
}

export function databaseName(identity) {
  return ['personal-assistant-2', identity?.organization_id || 'organization', identity?.username || 'user'].join(':')
}

async function openStorage(name, win) {
  try {
    return await indexedDbStorage(name, win.indexedDB)
  } catch {
    // Private windows can refuse storage. The app still works; the sync widget says it is not saved.
    return memoryStorage()
  }
}

function timezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || null
}

export function getStore(api, identity, win = globalThis) {
  const name = databaseName(identity)
  const existing = stores.get(name)
  if (existing) {
    existing.api = api
    return existing.ready
  }
  const entry = { api, ready: null }
  stores.set(name, entry)
  entry.ready = start(entry, name, win).catch(error => { stores.delete(name); throw error })
  return entry.ready
}

async function start(entry, name, win) {
  const storage = await openStorage(name, win)
  const channel = win.BroadcastChannel ? new win.BroadcastChannel(name) : null
  const locks = win.navigator?.locks
  const store = createStore({
    storage, send: transport(() => entry.api), timezone: timezone(),
    online: () => win.navigator?.onLine !== false,
    exclusively: work => locks ? locks.request(name, work) : work(),
    broadcast: () => channel?.postMessage('changed'),
  })
  await store.open()
  if (channel) channel.onmessage = () => { if (storage.durable) store.refresh().catch(() => {}) }
  win.navigator?.storage?.persist?.().catch?.(() => {})
  win.addEventListener?.('online', () => { store.connection(null); store.sync() })
  win.addEventListener?.('offline', () => store.connection(false))
  win.document?.addEventListener('visibilitychange', () => {
    if (win.document.visibilityState === 'visible') store.sync()
  })
  win.setInterval?.(() => {
    const state = store.snapshot()
    if (state.waiting || !state.online) { if (win.navigator?.onLine !== false) store.sync() }
  }, RETRY_MS)
  watchErrors(store, win)
  store.sync()
  warmUp(win)
  return store
}

// Reports go through the same queue, so a crash while offline is still reported later.
export function watchErrors(store, win) {
  const seen = new Set()
  const report = (message, stack, where) => {
    const text = `${message}`
    if (!/personal-assistant-2/.test(`${stack || ''}${where || ''}`) || seen.has(text) || seen.size > 20) return
    seen.add(text)
    store.reportError({ message: text, stack, where, agent: win.navigator?.userAgent }).catch(() => {})
  }
  win.addEventListener?.('error', event => report(event.message, event.error?.stack, event.filename))
  win.addEventListener?.('unhandledrejection', event =>
    report(event.reason?.message || event.reason, event.reason?.stack, 'promise'))
}

// Load the app's other widgets while online, so moving between pages works after the connection drops.
export async function warmUp(win, load = entry => import(entry)) {
  if (!win.document || !win.fetch) return 0
  try {
    const response = await win.fetch('/extensions/widgets.json')
    if (!response.ok) return 0
    const own = (await response.json()).filter(widget => widget.package === 'personal_assistant_2')
    return (await Promise.allSettled(own.map(widget => load(widget.entry)))).filter(row => row.status === 'fulfilled').length
  } catch {
    return 0 // offline already: the widgets that are loaded keep working
  }
}
