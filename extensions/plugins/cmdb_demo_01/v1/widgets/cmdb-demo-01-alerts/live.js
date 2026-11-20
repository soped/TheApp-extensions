// Shared live-status helpers for the CMDB demo 01 widgets.
// Every widget imports this one module URL, so the page has one poller: it calls
// the changes-since endpoint every 10 seconds (never faster) for all widgets.

export const BASE = '/api/v1/cmdb_demo_01'
export const ENDPOINTS = {
  items: `${BASE}/Items/`,
  relations: `${BASE}/Relations/`,
  impact: `${BASE}/Impact/`,
  simulate: `${BASE}/Simulate/`,
  simulator: `${BASE}/Simulator/`,
  changes: `${BASE}/ChangesSince/`,
  events: `${BASE}/Events/`,
}
export const POLL_MS = 10000
export const SELECT_EVENT = 'cmdb-demo-01:select'
export const ITEM_PARAM = 'cmdbItem'

export const STATUS_COLORS = {
  operational: '#2e9d5b',
  degraded: '#d99a17',
  down: '#d64545',
  maintenance: '#5b7fd6',
}
export const EDGE_STYLES = {
  depends: { stroke: '#7a8699', dash: '', width: 1.6, label: 'depends on' },
  owns: { stroke: '#9b6bd6', dash: '6 4', width: 1.1, label: 'owns' },
  redundant: { stroke: '#e07b28', dash: '2 4', width: 2.2, label: 'redundant pair' },
}

export function statusColor(status) {
  return STATUS_COLORS[status] || '#8a94a6'
}

export function itemPath(key) {
  return `${ENDPOINTS.items}?item=${encodeURIComponent(key)}`
}

export function relationsPath(key) {
  return `${ENDPOINTS.relations}?item=${encodeURIComponent(key)}`
}

export function impactPath(keys) {
  return `${ENDPOINTS.impact}?item=${encodeURIComponent([].concat(keys).join(','))}`
}

export function changesPath(since) {
  return since ? `${ENDPOINTS.changes}?since=${encodeURIComponent(since)}` : ENDPOINTS.changes
}

// ---- shared poller -------------------------------------------------------------------------------

export function createPoller(api, { intervalMs = POLL_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const interval = Math.max(POLL_MS, Number(intervalMs) || POLL_MS)
  const listeners = new Set()
  let cursor = null
  let timer = null
  let running = false
  let inFlight = null
  const poller = { latest: null, interval }

  async function poll() {
    if (inFlight) return inFlight
    inFlight = (async () => {
      let update
      try {
        const result = await api.request(changesPath(cursor))
        if (!result || !Array.isArray(result.events)) throw new Error('Changes API did not return events')
        cursor = result.cursor || cursor
        update = { events: result.events, alert: result.alert || null, now: result.now, error: null }
      } catch (cause) {
        update = { events: [], alert: poller.latest?.alert ?? null, now: null, error: cause.message }
      }
      poller.latest = update
      for (const listener of [...listeners]) listener(update)
      return update
    })()
    try { return await inFlight } finally {
      inFlight = null
      if (running) timer = setTimer(poll, interval)
    }
  }

  poller.subscribe = listener => {
    listeners.add(listener)
    if (poller.latest) listener({ ...poller.latest, events: [] })
    if (!running) {
      running = true
      poll()
    }
    return () => {
      listeners.delete(listener)
      if (!listeners.size) {
        running = false
        if (timer !== null) clearTimer(timer)
        timer = null
      }
    }
  }
  // Fetch immediately (after a local change) without shortening the 10-second cadence afterwards.
  poller.refresh = () => {
    if (timer !== null) clearTimer(timer)
    timer = null
    return poll()
  }
  poller.listenerCount = () => listeners.size
  return poller
}

const pollers = new WeakMap()
export function sharedPoller(api) {
  if (!pollers.has(api)) pollers.set(api, createPoller(api))
  return pollers.get(api)
}

// React hook: latest alert plus a counter that increments whenever events arrive.
export function useLiveStatus(React, api) {
  const [live, setLive] = React.useState(() => ({ alert: sharedPoller(api).latest?.alert ?? null, events: [],
    version: 0, error: null }))
  React.useEffect(() => sharedPoller(api).subscribe(update => {
    setLive(current => ({
      alert: update.alert,
      events: update.events.length ? update.events : current.events,
      version: current.version + (update.events.length ? 1 : 0),
      error: update.error,
    }))
  }), [api])
  return live
}

// ---- selection shared between widgets -------------------------------------------------------------

function browser() {
  return typeof window === 'undefined' ? null : window
}

export function selectedFromUrl() {
  const win = browser()
  if (!win?.location) return ''
  return new URLSearchParams(win.location.search).get(ITEM_PARAM) || ''
}

export function selectItem(key) {
  const win = browser()
  if (!win || !key) return
  if (win.history?.replaceState && win.location) {
    const params = new URLSearchParams(win.location.search)
    params.set(ITEM_PARAM, key)
    win.history.replaceState(null, '', `${win.location.pathname}?${params}${win.location.hash || ''}`)
  }
  const Event = win.CustomEvent || globalThis.CustomEvent
  win.dispatchEvent(new Event(SELECT_EVENT, { detail: { key } }))
}

export function onSelect(listener) {
  const win = browser()
  if (!win) return () => {}
  const handler = event => { if (event?.detail?.key) listener(event.detail.key) }
  win.addEventListener(SELECT_EVENT, handler)
  return () => win.removeEventListener(SELECT_EVENT, handler)
}

export function useSelectedItem(React, fallback = '') {
  const [selected, setSelected] = React.useState(() => selectedFromUrl() || fallback || '')
  React.useEffect(() => onSelect(setSelected), [])
  return selected
}

// ---- formatting and grouping ---------------------------------------------------------------------

export function formatDuration(milliseconds) {
  const total = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

export function formatTime(iso) {
  if (!iso) return ''
  const moment = new Date(iso)
  return Number.isNaN(moment.getTime()) ? '' : moment.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
}

export function bannerText(alert) {
  if (!alert) return 'All systems operational'
  return alert.summary
}

export function severityLabel(alert) {
  if (!alert) return 'operational'
  if (alert.severity === 'outage') return 'Outage'
  if (alert.severity === 'degraded') return alert.failover ? 'Degraded — failover active' : 'Degraded'
  return 'Failure, no dependents affected'
}

export function groupByOwner(entries) {
  const groups = new Map()
  for (const entry of entries || []) {
    const name = entry.owner_name || entry.owner || 'Unowned'
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name).push(entry)
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([owner, items]) => ({ owner, items }))
}

// Keys in the blast radius of the alert: {key: 'failed' | 'down' | 'degraded'}.
export function blastRadius(alert) {
  const radius = {}
  if (!alert) return radius
  for (const entry of alert.degraded || []) radius[entry.key] = 'degraded'
  for (const entry of alert.down || []) radius[entry.key] = 'down'
  for (const entry of alert.failed || []) radius[entry.key] = 'failed'
  return radius
}

export function filterItems(items, filters = {}) {
  const query = (filters.q || '').trim().toLowerCase()
  return (items || []).filter(item =>
    ['type', 'owner', 'status', 'environment'].every(name => !filters[name] || item[name] === filters[name])
    && (!query || [item.key, item.name, item.notes, item.ip].join(' ').toLowerCase().includes(query)))
}

// ---- graph layout --------------------------------------------------------------------------------

export const NODE = { width: 124, height: 30, column: 168, row: 44, margin: 24 }

// Columns by longest depends path (cycle safe); owner teams in the first column.
export function layoutGraph(items, relations, teams = [], { showOwnership = true } = {}) {
  const keys = new Set(items.map(item => item.key))
  const depends = relations.filter(rel => rel.type === 'depends' && keys.has(rel.source) && keys.has(rel.target))
  const level = Object.fromEntries(items.map(item => [item.key, 0]))
  for (let round = 0; round < items.length; round++) {
    let changed = false
    for (const rel of depends) {
      if (level[rel.target] < level[rel.source] + 1 && level[rel.source] + 1 < items.length) {
        level[rel.target] = level[rel.source] + 1
        changed = true
      }
    }
    if (!changed) break
  }
  const offset = showOwnership && teams.length ? 1 : 0
  const columns = new Map()
  const order = (a, b) => (a.environment === b.environment ? 0 : a.environment === 'prod' ? -1 : 1)
    || a.key.localeCompare(b.key)
  for (const item of [...items].sort(order)) {
    const column = level[item.key] + offset
    if (!columns.has(column)) columns.set(column, [])
    columns.get(column).push({ kind: 'item', ...item })
  }
  if (offset) columns.set(0, teams.map(team => ({ kind: 'team', ...team })))
  const nodes = []
  let rows = 0
  for (const [column, members] of columns) {
    rows = Math.max(rows, members.length)
    members.forEach((member, row) => nodes.push({
      ...member, column, row,
      x: NODE.margin + column * NODE.column, y: NODE.margin + row * NODE.row,
    }))
  }
  const position = Object.fromEntries(nodes.map(node => [node.key, node]))
  const edges = relations
    .filter(rel => position[rel.source] && position[rel.target] && (showOwnership || rel.type !== 'owns'))
    .map(rel => ({ ...rel, path: edgePath(position[rel.source], position[rel.target], rel.type) }))
  const width = NODE.margin * 2 + (Math.max(0, ...columns.keys()) * NODE.column) + NODE.width
  const height = NODE.margin * 2 + Math.max(0, rows - 1) * NODE.row + NODE.height
  return { nodes, edges, width, height }
}

export function edgePath(source, target, type) {
  if (type === 'redundant' || source.column === target.column) {
    const x = source.x - 4
    const y1 = source.y + NODE.height / 2
    const y2 = target.y + NODE.height / 2
    const bend = 18 + Math.abs(y2 - y1) / 6
    return `M ${x} ${y1} C ${x - bend} ${y1}, ${x - bend} ${y2}, ${x} ${y2}`
  }
  const x1 = source.x + NODE.width
  const y1 = source.y + NODE.height / 2
  const x2 = target.x
  const y2 = target.y + NODE.height / 2
  const mid = (x1 + x2) / 2
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`
}

// Small shared UI pieces ---------------------------------------------------------------------------

export function statusBadge(h, status) {
  return h('span', {
    style: {
      display: 'inline-block', padding: '1px 8px', borderRadius: 10, fontSize: '0.8em', fontWeight: 600,
      color: '#fff', background: statusColor(status),
    },
  }, status || 'unknown')
}
