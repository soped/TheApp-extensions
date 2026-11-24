// The local cache and the sync queue, shared by every widget. No React and no DOM: storage,
// transport, clock and locks come in from outside (see browser.js for the web app).
//
// Rules: a change is stored on the device before anything else happens; it leaves the device only
// when the server has answered for it; a change the server cannot accept stays visible for the user.

import { EMPTY, applyAll, dayView, validState } from './apply.js'

const BATCH = 50
export const BACK_ONLINE = 'Back when you’re online'
const TEXT_LIMIT = 10000

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replaceAll('-', '')
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

// A dictation longer than the server accepts becomes several captures instead of losing its end.
export function splitText(text, limit = TEXT_LIMIT) {
  const line = String(text).replace(/\s+/g, ' ').trim()
  const parts = []
  let rest = line
  while (rest.length > limit) {
    let cut = rest.lastIndexOf(' ', limit)
    if (cut < 1) cut = limit
    if (cut === limit && /[\uD800-\uDBFF]/.test(rest[cut - 1])) cut -= 1
    parts.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) parts.push(rest)
  return parts
}

export function createStore({
  storage, send, now = () => new Date(), timezone = null, online = () => true,
  exclusively = work => work(), broadcast = () => {}, id = newId,
}) {
  let base = EMPTY
  let ops = []
  let rejected = []
  let device = null
  let view = EMPTY
  let space = null
  const status = { ready: false, cached: false, connected: null, syncing: false, lastSync: null, error: null,
    storageError: null }
  const listeners = new Set()
  let snapshot = null
  let running = null
  let queued = null
  let writing = Promise.resolve()

  function publish() {
    view = applyAll(base, ops)
    snapshot = null
    for (const listener of [...listeners]) listener()
  }
  const isOnline = () => online() && status.connected !== false

  // Device reads and writes happen one after the other, so a slow read never hides a newer change.
  function serial(work) {
    const result = writing.then(work)
    writing = result.catch(() => {})
    return result
  }

  // Re-read from the device: another tab may have added or synced changes.
  function refresh() { return serial(reload) }
  async function reload() {
    const loaded = await storage.load()
    if (loaded.meta.state && validState(loaded.meta.state)) {
      base = loaded.meta.state
      status.cached = true
    }
    ops = loaded.ops
    rejected = loaded.rejected
    device = loaded.meta.device || device
    space = loaded.meta.space ?? null
    publish()
  }

  async function open() {
    await refresh()
    if (!device) {
      device = id()
      await storage.setMeta('device', device)
    }
    status.ready = true
    publish()
  }

  // Writes are kept in order, so a task is always stored before the edits made to it.
  function enqueue(entries) {
    const list = entries.map(entry => ({ op_id: id(), at: now().toISOString(), ...entry }))
    const result = serial(async () => {
      for (const op of list) {
        try {
          await storage.add(op)
        } catch (error) {
          status.storageError = error.message || 'Saving on this device failed'
          publish()
          throw error
        }
        ops = [...ops, op]
        status.storageError = null
      }
      publish()
      broadcast()
      return list
    })
    result.then(() => { sync() }, () => {})
    return result
  }

  const find = (list, identifier) => view[list].find(row => row.id === identifier)
  // Changes to something made on this device and not synced yet have no server revision to compare.
  const revision = record => record && !record.isNew ? record.rev : null

  function change(type, list, identifier, fields) {
    return enqueue([{ type, action: 'update', id: identifier, fields, base_rev: revision(find(list, identifier)) }])
  }
  function setStatus(identifier, value) {
    const task = find('tasks', identifier)
    const children = value === 'done'
      ? view.tasks.filter(child => child.parent === identifier && child.status !== 'done') : []
    return enqueue([...children, task].filter(Boolean).map(record => ({
      type: 'task', action: 'update', id: record.id, fields: { status: value }, base_rev: revision(record) })))
  }

  const actions = {
    capture(text, source = 'text') {
      const parts = splitText(text)
      if (!parts.length) return Promise.reject(new Error('There is nothing to save yet'))
      return enqueue(parts.map(part => ({ type: 'inbox', action: 'create', id: id(),
        fields: { text: part, source, captured_at: now().toISOString() } })))
    },
    createTask(fields) {
      return enqueue([{ type: 'task', action: 'create', id: id(), fields }])
    },
    updateTask(identifier, fields) { return change('task', 'tasks', identifier, fields) },
    startTask(identifier) { return setStatus(identifier, 'started') },
    finishTask(identifier) { return setStatus(identifier, 'done') },
    reopenTask(identifier) { return setStatus(identifier, 'open') },
    deleteTask(identifier) {
      const children = view.tasks.filter(child => child.parent === identifier)
      return enqueue([...children, find('tasks', identifier)].filter(Boolean).map(record => ({
        type: 'task', action: 'delete', id: record.id, base_rev: revision(record) })))
    },
    // One queue entry after the other: the task is stored before the capture is marked sorted.
    captureToTask(identifier, fields) {
      const capture = find('inbox', identifier)
      return enqueue([
        { type: 'task', action: 'create', id: id(), fields },
        { type: 'inbox', action: 'update', id: identifier, fields: { status: 'sorted' }, base_rev: revision(capture) },
      ])
    },
    deleteCapture(identifier) {
      return enqueue([{ type: 'inbox', action: 'delete', id: identifier, base_rev: revision(find('inbox', identifier)) }])
    },
    saveSchedule(value) {
      return enqueue([{ type: 'schedule', action: 'update', id: 'schedule', fields: { value }, base_rev: view.schedule.rev }])
    },
    saveSettings(fields) {
      return enqueue([{ type: 'settings', action: 'update', id: 'settings', fields, base_rev: view.settings.rev }])
    },
    resolveConflict(conflict, choice) {
      return enqueue([{ type: conflict.type, action: 'resolve', id: conflict.record,
        fields: { conflict: conflict.id, choice } }])
    },
    reportError({ message, where = '', stack = '', agent = '' }) {
      return enqueue([{ type: 'error', action: 'create', id: null,
        fields: { message: String(message || 'Unknown error').slice(0, 1000), where: String(where).slice(0, 200),
          stack: String(stack || '').slice(0, 6000), agent: String(agent || '').slice(0, 300) } }])
    },
    // A change the server refused: try it again as a new change, or let it go on purpose.
    async retryRejected(identifier, fields) {
      const row = rejected.find(item => item.op.op_id === identifier)
      if (!row) return
      const { op_id: _id, at: _at, ...op } = row.op
      await enqueue([{ ...op, fields: fields ? { ...op.fields, ...fields } : op.fields }])
      await actions.discardRejected(identifier)
    },
    async discardRejected(identifier) {
      await storage.dropRejected(identifier)
      rejected = rejected.filter(item => item.op.op_id !== identifier)
      publish()
      broadcast()
    },
  }

  async function post(batch) {
    const result = await send('Sync/', { device, ops: batch, ...(timezone ? { tz: timezone } : {}),
      ...(space ? { space } : {}) })
    if (!result || !Array.isArray(result.results) || !validState(result.state)) {
      throw new Error('The server answer was incomplete')
    }
    return result
  }

  async function settle(batch, result) {
    const sent = new Map(batch.map(op => [op.op_id, op]))
    const done = []
    const refused = []
    for (const answer of result.results) {
      const op = sent.get(answer.op_id)
      if (!op) continue
      if (answer.status === 'rejected') refused.push({ op, message: answer.message || 'Not accepted', at: now().toISOString() })
      else if (['applied', 'merged', 'conflict'].includes(answer.status)) done.push(op.op_id)
      // 'retry' or no answer: it stays in the queue
    }
    await storage.settle({ state: result.state, done, rejected: refused })
    await refresh()
    return done.length + refused.length
  }

  async function run() {
    await refresh()
    let batch = ops.slice(0, BATCH)
    do {
      let settled
      try {
        settled = await settle(batch, await post(batch))
      } catch (error) {
        if (batch.length < 2 || error.offline) throw error
        // One operation may be what the server cannot handle: send them one by one, so a single
        // bad one never holds back a capture behind it.
        settled = 0
        let failure = null
        for (const op of batch) {
          try { settled += await settle([op], await post([op])) } catch (cause) { failure = cause }
        }
        if (!settled) throw failure || error
        if (failure) { status.error = failure.message; break }
      }
      status.connected = true
      if (!settled) break
      batch = ops.slice(0, BATCH)
    } while (batch.length)
  }

  function attempt() {
    return exclusively(run).then(() => {
      status.connected = true
      status.lastSync = now().toISOString()
      broadcast()
      return true
    }, async error => {
      if (space && error.message === 'Space not found') {
        // No longer a member: what is waiting goes to the user's own space instead of getting stuck.
        await storage.setMeta('space', null)
        space = null
        return attempt()
      }
      status.connected = error.offline === false
      status.error = error.message
      return false
    })
  }

  // Called during a sync, it resolves after one more: the caller's own changes are included.
  function sync() {
    if (running) {
      if (!queued) queued = running.then(() => { queued = null; return sync() })
      return queued
    }
    if (!online()) {
      status.connected = false
      publish()
      return Promise.resolve(false)
    }
    status.syncing = true
    status.error = null
    publish()
    running = attempt().finally(() => {
      running = null
      status.syncing = false
      publish()
    })
    return running
  }

  // Replanning is an assistant feature: it needs the server, so offline it says so and does nothing.
  async function replan() {
    if (!isOnline()) return { done: false, message: BACK_ONLINE }
    if (!await sync()) return { done: false, message: BACK_ONLINE }
    try {
      await send('Plan/', { ...(timezone ? { tz: timezone } : {}), ...(space ? { space } : {}) })
      await sync()
      return { done: true, message: 'Your day is replanned' }
    } catch (error) {
      if (error.offline === false) return { done: false, message: error.message }
      status.connected = false
      publish()
      return { done: false, message: BACK_ONLINE }
    }
  }

  function today() {
    const local = localDay(now(), view.schedule.value)
    return dayView(view, local)
  }

  return {
    open, sync, replan, refresh, today, ...actions,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    connection(value) { status.connected = value; publish() },
    get device() { return device },
    snapshot() {
      if (!snapshot || snapshot.day.date !== localDay(now(), view.schedule.value)) {
        const visible = ops.filter(op => op.type !== 'error')
        snapshot = { ...view, waiting: visible.length, rejected, status: { ...status }, online: isOnline(),
          day: today(), durable: storage.durable }
      }
      return snapshot
    },
    async useSpace(identifier) {
      // Waiting changes belong to the current space, so they are delivered before switching.
      if (!await sync() || ops.length) throw new Error(`Switching space: ${BACK_ONLINE.toLowerCase()}`)
      await storage.setMeta('space', identifier)
      space = identifier
      return sync()
    },
  }
}

const clock = text => Number(text.slice(0, 2)) * 60 + Number(text.slice(3))

// The date of the user's own day: after midnight and before a late bedtime it is still yesterday.
export function localDay(moment, schedule) {
  const date = new Date(moment.getFullYear(), moment.getMonth(), moment.getDate())
  const minute = moment.getHours() * 60 + moment.getMinutes()
  const wake = clock(schedule.wake)
  let bed = clock(schedule.bedtime)
  if (bed < wake) bed += 1440
  if (minute < wake && minute + 1440 < bed) date.setDate(date.getDate() - 1)
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
