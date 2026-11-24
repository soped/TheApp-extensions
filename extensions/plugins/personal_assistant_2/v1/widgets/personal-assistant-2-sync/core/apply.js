// What the user sees: the last state from the server plus the changes still waiting on this device.
// Pure functions, no browser APIs, so the phone and desktop apps can use this file unchanged.

const STATUS_TIMES = {
  open: () => ({ started_at: null, finished_at: null }),
  started: (record, at) => ({ started_at: record.started_at || at, finished_at: null }),
  done: (record, at) => ({ finished_at: record.finished_at || at }),
}

export const EMPTY = Object.freeze({
  space: null, spaces: [], server_time: null, today: null, tasks: [], inbox: [], conflicts: [], plans: {},
  schedule: {
    value: { wake: '07:00', work_start: '09:00', work_end: '17:00', bedtime: '23:00',
      workdays: ['mon', 'tue', 'wed', 'thu', 'fri'], blocks: [], timezone: null },
    saved: false, rev: 0,
  },
  settings: { colour_mode: 'default', energy: 'normal', motion: 'system', rev: 0 },
})

// A server answer is only cached when it is complete; anything else keeps the last good state.
export function validState(state) {
  return Boolean(state && typeof state === 'object' && typeof state.space === 'string'
    && Array.isArray(state.tasks) && Array.isArray(state.inbox) && Array.isArray(state.conflicts)
    && Array.isArray(state.spaces) && typeof state.today === 'string'
    && state.schedule?.value && state.settings && state.plans && typeof state.plans === 'object')
}

const LISTS = { task: 'tasks', inbox: 'inbox' }
const NEW = {
  task: { context: 'private', duration: 30, deadline: null, must_do: false, status: 'open',
    started_at: null, finished_at: null, parent: null },
  inbox: { source: 'text', status: 'inbox' },
}

function changed(record, op) {
  const next = { ...record, ...op.fields, waiting: true }
  if (op.type === 'task' && op.fields.status && op.fields.status !== record.status) {
    Object.assign(next, STATUS_TIMES[op.fields.status]({ ...record, ...op.fields }, op.at))
  }
  return next
}

export function applyOp(state, op) {
  if (op.type === 'schedule' && op.action === 'update') {
    return { ...state, schedule: { ...state.schedule, value: op.fields.value, saved: true } }
  }
  if (op.type === 'settings' && op.action === 'update') {
    return { ...state, settings: { ...state.settings, ...op.fields } }
  }
  if (op.action === 'resolve') {
    return { ...state, conflicts: state.conflicts.filter(row => row.id !== op.fields.conflict) }
  }
  const list = LISTS[op.type]
  if (!list) return state
  const rows = state[list]
  if (op.action === 'create') {
    if (rows.some(row => row.id === op.id)) return state
    const record = changed({ ...NEW[op.type], id: op.id, rev: 0, conflicts: [], created_at: op.at, isNew: true }, op)
    if (op.type === 'inbox') record.captured_at = op.fields.captured_at || op.at
    return { ...state, [list]: op.type === 'inbox' ? [record, ...rows] : [...rows, record] }
  }
  if (op.action === 'delete') return { ...state, [list]: rows.filter(row => row.id !== op.id) }
  if (op.action === 'update') {
    const next = rows.map(row => row.id === op.id ? changed(row, op) : row)
    return { ...state, [list]: op.type === 'inbox' ? next.filter(row => row.status === 'inbox') : next }
  }
  return state
}

export function applyAll(state, ops) {
  return ops.reduce(applyOp, state)
}

// The cached plan with the newest task states. Placement rules stay on the server: a task the plan
// does not know yet is listed as waiting for a place, never given a guessed time.
export function dayView(state, date) {
  const plan = state.plans[date] || null
  const tasks = new Map(state.tasks.map(task => [task.id, task]))
  const refresh = item => {
    const task = tasks.get(item.task)
    return task ? { ...item, title: task.title, context: task.context, status: task.status,
      duration: task.duration, deadline: task.deadline || item.deadline, waiting: task.waiting } : null
  }
  // A finished task older than the cache window is no longer in tasks; it keeps its planned state.
  const items = (plan?.items || []).map(item => refresh(item) || (item.status === 'done' ? item : null)).filter(Boolean)
  const unplanned = (plan?.unplanned || []).map(refresh).filter(Boolean)
  const known = new Set([...items, ...unplanned].map(item => item.task))
  const split = new Set(state.tasks.filter(task => task.parent && task.status !== 'done').map(task => task.parent))
  const unplaced = state.tasks
    .filter(task => !known.has(task.id) && task.status !== 'done' && !split.has(task.id))
    .map(task => ({ task: task.id, title: task.title, context: task.context, status: task.status,
      duration: task.duration, must_do: task.must_do, deadline: task.deadline, waiting: task.waiting,
      parent_title: tasks.get(task.parent)?.title || null, reason: 'new',
      reason_text: 'Gets a place when you are online' }))
  return {
    date, planned: Boolean(plan), frames: plan?.frames || [], blocks: plan?.blocks || [],
    items: items.filter(item => item.status === 'done' || !split.has(item.task)),
    unplanned: [...unplanned.filter(item => item.status !== 'done' && !split.has(item.task)), ...unplaced],
  }
}
