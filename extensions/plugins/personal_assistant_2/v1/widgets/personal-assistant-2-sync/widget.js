import { API } from './core/browser.js'
import { BACK_ONLINE, connectionText, frame, kit, useAction } from './ui/kit.js'

const NAMES = { title: 'title', context: 'work or private', duration: 'duration', deadline: 'deadline', must_do: 'must do',
  status: 'status', parent: 'parent task', text: 'text', deleted: 'deleted', value: 'times', started_at: 'start time',
  finished_at: 'finish time' }

export function valueText(field, value) {
  if (field === 'deleted') return value ? 'Delete it' : 'Keep it'
  if (field === 'value') return `${value.wake}, work ${value.work_start}–${value.work_end}, bed ${value.bedtime}`
  if (value === null || value === undefined || value === '') return 'None'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return field === 'duration' ? `${value} min` : String(value)
}
export function opText(op) {
  return op.fields?.title || op.fields?.text || { schedule: 'Daily schedule', settings: 'Settings' }[op.type]
    || `${op.type === 'task' ? 'Task' : 'Capture'} (${op.action})`
}

export function SyncView({ React, store, state, config, api }) {
  const { h, button, select } = kit(React)
  const { run, note } = useAction(React)
  const [backups, setBackups] = React.useState(null)
  const [chosen, setChosen] = React.useState(null)
  const query = extra => `${API}Backup/?space=${encodeURIComponent(state.space || '')}${extra || ''}`
  const load = async () => setBackups((await api.request(query())).backups)

  async function restore() {
    const body = chosen.file ? { backup: chosen.file } : { id: chosen.id }
    await api.request(`${API}Backup/`, { action: 'restore', space: state.space, ...body })
    setChosen(null)
    await load()
    await store.sync()
  }
  async function download(row) {
    const { backup } = await api.request(query(`&id=${encodeURIComponent(row.id)}`))
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `personal-assistant-backup-${row.made_at.slice(0, 10)}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  }
  async function choose(file) {
    if (!file) return
    let content
    try { content = JSON.parse(await file.text()) } catch { throw new Error('This is not a backup file of this app') }
    setChosen({ file: content, name: file.name })
  }

  return h(React.Fragment, null,
    h('h2', null, config.title || 'Saved and in sync'),
    h('p', { role: 'status' }, connectionText(state)),
    state.status.error && state.online && h('p', { role: 'alert' }, `The last sync did not finish: ${state.status.error}`),
    h('div', { className: 'pa2-actions' }, button('Sync now', () => run(() => store.sync()), { disabled: state.status.syncing })),
    state.spaces.length > 1 && select('Space', state.space, state.spaces.map(space => [space.id, space.name]),
      identifier => run(() => store.useSpace(identifier))),
    note,
    state.conflicts.length > 0 && h('div', null, h('h3', null, 'Changed in two places'),
      h('p', null, 'Both versions are safe. Choose the one you want.'),
      h('ul', null, state.conflicts.map(row => h('li', { key: row.id, className: 'pa2-note' },
        h('div', { className: 'pa2-title' }, `${row.title}: ${NAMES[row.field] || row.field}`),
        h('div', { className: 'pa2-actions' },
          button(`Keep “${valueText(row.field, row.kept)}”`, () => run(() => store.resolveConflict(row, 'kept')), { about: row.title }),
          button(`Use “${valueText(row.field, row.other)}”`, () => run(() => store.resolveConflict(row, 'other')), { about: row.title })))))),
    state.rejected.length > 0 && h('div', null, h('h3', null, 'Could not be saved online'),
      h('ul', null, state.rejected.map(row => h('li', { key: row.op.op_id, className: 'pa2-note' },
        h('div', { className: 'pa2-title' }, opText(row.op)), h('p', null, `${row.message}. It is still on this device.`),
        h('div', { className: 'pa2-actions' },
          button('Try again', () => run(() => store.retryRejected(row.op.op_id)), { about: opText(row.op) }),
          button('Move to inbox', () => run(async () => {
            await store.capture(opText(row.op))
            await store.discardRejected(row.op.op_id)
          }), { about: opText(row.op) }),
          button('Let it go', () => run(() => store.discardRejected(row.op.op_id)), { about: opText(row.op), className: 'danger' })))))),
    h('details', null, h('summary', null, 'Backups'),
      h('p', { className: 'pa2-muted' }, 'A backup is made every day you use the app. Restoring keeps anything newer.'),
      !state.online && h('p', null, `Backups: ${BACK_ONLINE.toLowerCase()}.`),
      h('div', { className: 'pa2-actions' },
        button('Show backups', () => run(load), { disabled: !state.online }),
        button('Back up now', () => run(async () => {
          await api.request(`${API}Backup/`, { action: 'create', space: state.space })
          await load()
        }, 'Backup made'), { disabled: !state.online })),
      backups && (backups.length ? h('ul', { 'aria-label': 'Backups' }, backups.map(row => h('li', { key: row.id, className: 'pa2-note' },
        h('div', null, `${new Date(row.made_at).toLocaleString()} (${row.reason}): ${row.counts.tasks} tasks, ${row.counts.inbox} captures`),
        h('div', { className: 'pa2-actions' },
          button('Download', () => run(() => download(row)), { about: row.made_at, disabled: !state.online }),
          button('Restore', () => setChosen({ id: row.id, name: new Date(row.made_at).toLocaleString() }), { about: row.made_at, disabled: !state.online }))))) :
        h('p', null, 'No backups yet.')),
      h('label', null, 'Restore from a downloaded file', h('input', { type: 'file', accept: 'application/json,.json', disabled: !state.online,
        onChange: event => { const file = event.target.files?.[0]; run(() => choose(file)) } })),
      chosen && h('div', { className: 'pa2-note', role: 'group', 'aria-label': 'Confirm restore' },
        h('p', null, `Restore ${chosen.name}? What you have now is backed up first.`),
        h('div', { className: 'pa2-actions' }, button('Restore it', () => run(restore, 'Restored'), { className: undefined }),
          button('Cancel', () => setChosen(null))))))
}

export default function Sync(props) {
  return frame(props.React, props, 'Saved and in sync', SyncView)
}
