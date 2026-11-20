const BASE = '/api/v1/workflows/'
const WORKFLOWS = `${BASE}Workflows/`
const PLUGINS = `${BASE}WorkflowPlugins/`
const RUN_NOW = `${BASE}WorkflowRunNow/`
const RUNS = `${BASE}WorkflowRuns/`
const MAX_STEPS = 20
const LEGACY_WORKERS = {
  'database.Query': 'database.WorkerMongoQuery',
  'database.Insert': 'database.WorkerMongoInsert',
  'database.Update': 'database.WorkerMongoUpdate',
  'parsers.TransformJson': 'parsers.WorkerTransformJson',
  'events.EnrichEvent': 'events.WorkerEnrichEvent',
}

export function upgradeLegacyStep(step, workers, role) {
  const replacement = LEGACY_WORKERS[step.plugin]
  if (!workers.some(worker => worker.plugin === replacement && worker.roles.includes(role))) return step
  const params = JSON.parse(JSON.stringify(step.params ?? {}))
  if (replacement === 'database.WorkerMongoQuery' &&
      (params.limit == null || params.limit === 0 || (typeof params.limit === 'number' && params.limit > 1000))) {
    params.limit = 1000
  }
  return { ...step, plugin: replacement, params, error: '' }
}

let uidCounter = 0
const nextUid = () => `s${++uidCounter}`
const clone = value => JSON.parse(JSON.stringify(value ?? {}))

// Worker settings are edited by the plugin's own `worker_<name>` widget, found in the widget catalog.
let widgetCatalog = null
export async function loadWorkerEditor(worker) {
  if (!widgetCatalog) {
    widgetCatalog = fetch('/extensions/widgets.json', { cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('Unable to load the widget catalog')
      return response.json()
    })
    widgetCatalog.catch(() => { widgetCatalog = null })
  }
  const manifest = (await widgetCatalog).find(widget => widget.id === worker.editor && widget.package === worker.package)
  if (!manifest?.entry) throw new Error(`Editor widget ${worker.editor} is not installed`)
  const module = await import(/* @vite-ignore */ manifest.entry)
  if (typeof module.default !== 'function') throw new Error(`Editor widget ${worker.editor} has no default export`)
  return module.default
}

const boundaries = new WeakMap()
function boundaryFor(React) {
  if (!boundaries.has(React)) {
    boundaries.set(React, class EditorBoundary extends React.Component {
      constructor(props) { super(props); this.state = { error: null } }
      static getDerivedStateFromError(error) { return { error: error.message } }
      render() { return this.state.error ? this.props.fallback(this.state.error) : this.props.children }
    })
  }
  return boundaries.get(React)
}

function JsonSettings({ React, value, onChange, label, reason }) {
  const h = React.createElement
  const [draft, setDraft] = React.useState(() => JSON.stringify(value ?? {}, null, 2))
  const [invalid, setInvalid] = React.useState('')
  const edit = event => {
    const next = event.target.value
    setDraft(next)
    let parsed
    try { parsed = JSON.parse(next) } catch { parsed = undefined }
    const problem = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? '' : 'Settings must be a JSON object'
    setInvalid(problem)
    onChange(problem ? value : parsed, problem)
  }
  return h('div', null,
    reason && h('p', { role: 'alert', style: { fontSize: '.85rem' } }, `${reason}. Edit the settings as JSON instead.`),
    h('textarea', { 'aria-label': `${label} settings JSON`, rows: 8, style: { width: '100%', fontFamily: 'monospace' }, value: draft, onInput: edit, onChange: edit }),
    invalid && h('p', { role: 'alert', style: { fontSize: '.85rem' } }, invalid))
}

function WorkerSettings({ React, api, worker, role, value, onChange, label, loader }) {
  const h = React.createElement
  const [loaded, setLoaded] = React.useState(null)
  const key = worker ? `${worker.package}/${worker.editor}` : ''
  React.useEffect(() => {
    let active = true
    if (!worker) return () => { active = false }
    loader(worker).then(component => { if (active) setLoaded({ key, component }) },
      cause => { if (active) setLoaded({ key, error: cause.message || String(cause) }) })
    return () => { active = false }
  }, [key, worker, loader])
  if (!worker) return h(JsonSettings, { React, value, onChange, label, reason: 'This plugin is not an installed worker' })
  if (loaded?.key !== key) return h('p', { role: 'status', style: { fontSize: '.85rem' } }, `Loading ${worker.title} editor...`)
  if (loaded.error) return h(JsonSettings, { React, value, onChange, label, reason: `Could not load ${worker.editor}: ${loaded.error}` })
  const Boundary = boundaryFor(React)
  return h(Boundary, { key, fallback: error => h(JsonSettings, { React, value, onChange, label, reason: `${worker.editor} failed: ${error}` }) },
    h(loaded.component, { React, api, value: value ?? {}, onChange: (params, error) => onChange(params, error || ''), role, plugin: worker.plugin }))
}

// Text controls listen to both events; the handlers only store the current value.
const typing = handler => ({ onInput: handler, onChange: handler })

const when = value => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

const text = value => value === undefined || value === null ? '' :
  typeof value === 'string' ? value : JSON.stringify(value)

const schedule = (seconds, cron, zone) => cron ? `Cron ${cron} (${zone || 'UTC'})` : !seconds ? 'Manual' : seconds % 3600 === 0 ? `Every ${seconds / 3600} h`
  : seconds % 60 === 0 ? `Every ${seconds / 60} min` : `Every ${seconds} s`

const TONES = {
  ok: ['#173d36', '#76ddcc'], completed: ['#173d36', '#76ddcc'], enabled: ['#173d36', '#76ddcc'],
  failed: ['#482736', '#ffc0c0'], running: ['#2d2a52', '#c9bfff'], queued: ['#2d2a52', '#c9bfff'],
}
const S = {
  row: { display: 'flex', flexWrap: 'wrap', gap: '.5rem', alignItems: 'center' },
  input: { minHeight: 38, padding: '.4rem .6rem', borderRadius: 8, border: '1px solid var(--control-border, #4c5f7e)', background: '#101827', color: 'inherit', minWidth: 0 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '.9rem' },
  cell: { padding: '.5rem', borderBottom: '1px solid #35445e', textAlign: 'left', verticalAlign: 'middle' },
  muted: { color: 'var(--text-muted, #a7b6cc)', fontSize: '.85rem' },
  small: { minHeight: 32, padding: '.3rem .65rem', whiteSpace: 'nowrap' },
  overlay: { position: 'fixed', inset: 0, background: '#0009', zIndex: 1000 },
  panel: { position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(100%, max(50vw, 420px))', zIndex: 1001, background: '#162137', borderLeft: '1px solid #35445e', display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 24px #0008' },
  panelHead: { display: 'flex', alignItems: 'center', gap: '.5rem', padding: '1rem', borderBottom: '1px solid #35445e' },
  panelBody: { flex: 1, overflowY: 'auto', padding: '1rem' },
  tabs: { display: 'flex', borderBottom: '1px solid #35445e', padding: '0 1rem' },
  card: { border: '1px solid #35445e', borderRadius: 10, background: '#1a263c', marginBottom: '.6rem' },
  cardHead: { display: 'flex', alignItems: 'center', gap: '.4rem', padding: '.5rem .75rem' },
  modal: { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 1003, width: 'min(92vw, 420px)', padding: '1.25rem', borderRadius: 12, background: '#1a263c', border: '1px solid #4c5f7e' },
}

const badge = (h, label, tone, props = {}) => {
  const [background, color] = TONES[tone] || ['#26364f', '#bdcbe0']
  return h(props.onClick ? 'button' : 'span', {
    ...props, type: props.onClick ? 'button' : undefined,
    style: { display: 'inline-block', minHeight: 0, padding: '.15rem .6rem', borderRadius: 999, fontSize: '.78rem', fontWeight: 600, background, color, border: 'none', cursor: props.onClick ? 'pointer' : 'default' },
  }, label)
}

export default function WorkflowEditor({ React, api, config, loadEditor = loadWorkerEditor }) {
  const h = React.createElement
  const [catalog, setCatalog] = React.useState(null)
  const [workflows, setWorkflows] = React.useState([])
  const [runs, setRuns] = React.useState([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [quick, setQuick] = React.useState({ name: '', group: '' })
  const [form, setForm] = React.useState(null)
  const [tab, setTab] = React.useState('settings')
  const [open, setOpen] = React.useState({})
  const [adding, setAdding] = React.useState(false)
  const [panelError, setPanelError] = React.useState('')
  const [upgradeNotice, setUpgradeNotice] = React.useState('')
  const [history, setHistory] = React.useState(null)
  const [confirm, setConfirm] = React.useState(null)
  const [single, setSingle] = React.useState({ plugin: '', params: {}, error: '' })
  const alive = React.useRef(true)

  React.useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const load = React.useCallback(async () => {
    try {
      const [plugins, list, recent] = await Promise.all([
        api.request(PLUGINS), api.request(WORKFLOWS), api.request(`${RUNS}?limit=200`),
      ])
      if (!alive.current) return
      setCatalog(plugins)
      setWorkflows(list.workflows || [])
      setRuns(recent.runs || [])
      setError('')
    } catch (cause) {
      if (alive.current) setError(cause.message)
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [api])

  React.useEffect(() => { load() }, [load])

  const usable = catalog?.plugins || []
  const byName = name => usable.find(p => p.plugin === name)
  const ofRole = role => usable.filter(p => p.roles.includes(role))

  const act = async (work, success, onError = setError) => {
    setBusy(true); setNotice(''); setError(''); setPanelError('')
    try {
      await work()
      if (alive.current && success) setNotice(success)
      return true
    } catch (cause) {
      if (alive.current) onError(cause.message)
      return false
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const lastRun = id => runs.find(run => String(run.workflow_id) === id)
  const toStep = item => ({
    uid: nextUid(), plugin: item.plugin || '', params: clone(item.params ?? byName(item.plugin)?.defaults), error: '',
    require_last_result: item.require_last_result !== false, always_run: item.always_run === true,
  })

  const startEdit = (workflow, preset = {}) => {
    setForm(workflow ? {
      id: workflow.id, name: workflow.name || '', group: workflow.group || '', active: Boolean(workflow.active),
      mode: workflow.cron ? 'cron' : workflow.interval_seconds ? 'interval' : 'manual',
      interval_seconds: String(workflow.interval_seconds || 60),
      cron: workflow.cron || '', timezone: workflow.timezone || 'UTC',
      worker_node: workflow.worker_node || '', trigger: toStep(workflow.trigger || {}),
      steps: (workflow.workflow || []).map(toStep),
    } : {
      id: null, name: preset.name || '', group: preset.group || '', active: false, mode: 'manual', cron: '', timezone: 'UTC',
      interval_seconds: '60', worker_node: (catalog?.nodes || [])[0] || '',
      trigger: toStep({ plugin: ofRole('trigger')[0]?.plugin }), steps: [],
    })
    setTab('settings'); setOpen({}); setAdding(false)
    setError(''); setNotice(''); setPanelError('')
    setUpgradeNotice('')
  }

  const upgradeWorkers = () => {
    setForm(current => ({
      ...current,
      trigger: upgradeLegacyStep(current.trigger, catalog.plugins || [], 'trigger'),
      steps: current.steps.map(step => upgradeLegacyStep(step, catalog.plugins || [], 'step')),
    }))
    setPanelError('')
    setUpgradeNotice('Replacements applied in this editor only. Review the trigger and every step before saving. Organization-safe workers cannot access other organizations or protected collections; queries are capped at 1000 records.')
  }

  const save = () => act(async () => {
    const serialize = (item, label, flags) => {
      if (!item.plugin) throw new Error(`Choose a plugin for the ${label}`)
      if (!byName(item.plugin)) throw new Error(`${label}: ${item.plugin} is a legacy or unavailable plugin. Upgrade available legacy workers, or replace it in the Trigger/Steps tab before saving.`)
      if (item.error) throw new Error(`${label} (${item.plugin}): ${item.error}`)
      const step = { plugin: item.plugin, params: clone(item.params) }
      if (flags && !item.require_last_result) step.require_last_result = false
      if (flags && item.always_run) step.always_run = true
      return step
    }
    if (!form.name.trim()) throw new Error('Give the workflow a name')
    if (!form.steps.length) throw new Error('Add at least one step')
    const interval = form.mode === 'interval' ? Number(form.interval_seconds) : 0
    if (!Number.isInteger(interval) || (form.mode === 'interval' && (interval < 10 || interval > 86400))) {
      throw new Error('Interval must be a whole number from 10 to 86400 seconds')
    }
    if (form.mode === 'cron' && !form.cron.trim()) throw new Error('Enter a cron expression such as 0 8 * * 1-5')
    const body = {
      name: form.name.trim(), group: form.group.trim(), active: form.active, interval_seconds: interval,
      cron: form.mode === 'cron' ? form.cron.trim() : '', timezone: form.mode === 'cron' ? (form.timezone.trim() || 'UTC') : '',
      worker_node: form.worker_node, trigger: serialize(form.trigger, 'trigger', false),
      workflow: form.steps.map((item, i) => serialize(item, `step ${i + 1}`, true)),
    }
    if (form.id) await api.request(`${WORKFLOWS}${form.id}/update`, body)
    else await api.request(WORKFLOWS, body)
    await load()
    if (alive.current) { setForm(null); setQuick({ name: '', group: '' }) }
  }, 'Workflow saved', setPanelError)

  const setStep = (index, changes) => setForm(current => ({
    ...current, steps: current.steps.map((item, i) => i === index ? { ...item, ...changes } : item),
  }))
  const move = (index, delta) => {
    setForm(current => {
      const target = index + delta
      if (target < 0 || target >= current.steps.length) return current
      const steps = [...current.steps];
      [steps[index], steps[target]] = [steps[target], steps[index]]
      return { ...current, steps }
    })
    setOpen({})
  }
  const addStep = name => {
    setForm(current => ({ ...current, steps: [...current.steps, toStep({ plugin: name })] }))
    setOpen(current => ({ ...current, [form.steps.length]: true }))
    setAdding(false)
  }

  const settingsFor = (item, role, label, update) => h(WorkerSettings, {
    key: `${item.uid}:${item.plugin}`, React, api, worker: byName(item.plugin), role, label, loader: loadEditor,
    value: item.params, onChange: (params, problem) => update({ params, error: problem }),
  })

  const pluginCards = (role, selected, onPick, label) => {
    const options = ofRole(role)
    if (!options.length) return h('p', { style: S.muted }, 'No worker plugins with an editor are installed for this role.')
    return h('div', { role: 'listbox', 'aria-label': label },
      options.map(p => h('button', {
        key: p.plugin, type: 'button', role: 'option', 'aria-selected': p.plugin === selected,
        className: 'secondary', onClick: () => onPick(p.plugin),
        style: { display: 'block', width: '100%', textAlign: 'left', marginBottom: '.4rem', borderColor: p.plugin === selected ? 'var(--accent)' : undefined },
      }, h('strong', { style: { display: 'block' } }, p.title || p.plugin), h('code', { style: { ...S.muted, display: 'block' } }, p.plugin),
        p.description && h('span', { style: S.muted }, p.description))))
  }

  const showHistory = workflow => act(async () => {
    const result = await api.request(`${RUNS}?workflow_id=${encodeURIComponent(workflow.id)}&limit=50`)
    if (alive.current) setHistory({ workflow, runs: result.runs || [] })
  })

  const runWorkflow = workflow => act(async () => {
    await api.request(RUN_NOW, { workflow_id: workflow.id })
    await load()
  }, `Queued a run of ${workflow.name}`)

  const runSingle = () => act(async () => {
    if (!byName(single.plugin)) throw new Error('Choose a plugin to run')
    if (single.error) throw new Error(`${single.plugin}: ${single.error}`)
    await api.request(RUN_NOW, { plugin: single.plugin, params: clone(single.params) })
    await load()
  }, 'Queued a single plugin run')

  const remove = workflow => act(async () => {
    await api.request(`${WORKFLOWS}${workflow.id}/delete`, {})
    setConfirm(null)
    await load()
  }, 'Workflow deleted')

  const toggle = workflow => act(async () => {
    await api.request(`${WORKFLOWS}${workflow.id}/${workflow.active ? 'disable' : 'enable'}`, {})
    await load()
  })

  const title = h('h2', null, config?.title || 'Workflows')
  const messages = [
    error && h('p', { key: 'e', role: 'alert' }, error),
    notice && h('p', { key: 'n', role: 'status' }, notice),
  ]
  if (loading) return h('section', null, title, h('p', { role: 'status' }, 'Loading workflows...'))
  if (!catalog) return h('section', null, title, messages)

  const sidePanel = (label, actions, body, below) => [
    h('div', { key: 'overlay', style: S.overlay, onClick: () => { setForm(null); setHistory(null) } }),
    h('aside', { key: 'panel', role: 'dialog', 'aria-label': label, style: S.panel },
      h('div', { style: S.panelHead },
        h('h3', { style: { margin: 0, flex: 1, overflowWrap: 'anywhere' } }, label), actions,
        h('button', { type: 'button', className: 'secondary', 'aria-label': 'Close panel', style: S.small, onClick: () => { setForm(null); setHistory(null) } }, '✕')),
      below, h('div', { style: S.panelBody }, body)),
  ]

  const editor = () => {
    const triggerPlugin = byName(form.trigger.plugin)
    const unavailable = [form.trigger, ...form.steps].filter(item => item.plugin && !byName(item.plugin))
    const canUpgrade = upgradeLegacyStep(form.trigger, catalog.plugins || [], 'trigger') !== form.trigger ||
      form.steps.some(step => upgradeLegacyStep(step, catalog.plugins || [], 'step') !== step)
    const tabButton = (id, label) => h('button', {
      key: id, type: 'button', role: 'tab', 'aria-selected': tab === id, onClick: () => setTab(id),
      style: { background: 'transparent', color: tab === id ? 'var(--accent)' : 'inherit', borderRadius: 0, borderBottom: `2px solid ${tab === id ? 'var(--accent)' : 'transparent'}`, boxShadow: 'none' },
    }, label)
    const settings = h('div', null,
      h('label', { style: { display: 'block', marginBottom: '.75rem' } }, 'Name',
        h('input', { 'aria-label': 'Workflow name', style: { ...S.input, width: '100%' }, value: form.name, ...typing(e => setForm({ ...form, name: e.target.value })) })),
      h('label', { style: { display: 'block', marginBottom: '.75rem' } }, 'Group',
        h('input', { 'aria-label': 'Workflow group', style: { ...S.input, width: '100%' }, value: form.group, placeholder: 'Optional', ...typing(e => setForm({ ...form, group: e.target.value })) })),
      h('label', { style: { display: 'block', marginBottom: '.75rem' } }, 'Schedule',
        h('div', { style: S.row },
          h('select', { 'aria-label': 'Schedule', style: S.input, value: form.mode, onChange: e => setForm({ ...form, mode: e.target.value }) },
            h('option', { value: 'manual' }, 'Manual (Run once only)'), h('option', { value: 'interval' }, 'Repeat every'), h('option', { value: 'cron' }, 'Cron schedule')),
          form.mode === 'interval' && h('input', { 'aria-label': 'Interval seconds', type: 'number', min: 10, max: 86400, style: { ...S.input, width: '8rem' }, value: form.interval_seconds, ...typing(e => setForm({ ...form, interval_seconds: e.target.value })) }),
          form.mode === 'interval' && h('span', { style: S.muted }, 'seconds (10 - 86400)'),
          form.mode === 'cron' && h('input', { 'aria-label': 'Cron expression', style: { ...S.input, width: '10rem' }, value: form.cron, placeholder: '0 8 * * 1-5', ...typing(e => setForm({ ...form, cron: e.target.value })) }),
          form.mode === 'cron' && h('input', { 'aria-label': 'Cron timezone', style: { ...S.input, width: '12rem' }, value: form.timezone, placeholder: 'UTC', ...typing(e => setForm({ ...form, timezone: e.target.value })) }),
          form.mode === 'cron' && h('span', { style: S.muted }, 'minute hour day month weekday; IANA timezone'))),
      h('label', { style: { display: 'block', marginBottom: '.75rem' } }, 'Worker node',
        h('select', { 'aria-label': 'Worker node', style: { ...S.input, width: '100%' }, value: form.worker_node, onChange: e => setForm({ ...form, worker_node: e.target.value }) },
          h('option', { value: '' }, 'Choose node'), (catalog.nodes || []).map(n => h('option', { key: n, value: n }, n)))),
      h('label', { style: S.row }, h('input', { 'aria-label': 'Enabled', type: 'checkbox', checked: form.active, onChange: e => setForm({ ...form, active: e.target.checked }) }),
        'Enabled', h('span', { style: S.muted }, form.mode === 'manual' ? '(manual workflows only run with Run once)' : '(runs on its schedule)')))
    const trigger = h('div', null,
      h('p', { style: S.muted }, 'The trigger runs first; when it returns nothing the run is skipped, otherwise its result is passed to step 1.'),
      pluginCards('trigger', form.trigger.plugin, name => setForm(c => ({ ...c, trigger: toStep({ plugin: name }) })), 'Trigger plugin'),
      triggerPlugin && h('div', { style: { ...S.card, padding: '.75rem' } },
        h('strong', null, `${triggerPlugin.title || triggerPlugin.plugin} settings`),
        settingsFor(form.trigger, 'trigger', 'Trigger', changes => setForm(c => ({ ...c, trigger: { ...c.trigger, ...changes } })))),
      !triggerPlugin && form.trigger.plugin && h('div', { style: { ...S.card, padding: '.75rem' } },
        settingsFor(form.trigger, 'trigger', 'Trigger', changes => setForm(c => ({ ...c, trigger: { ...c.trigger, ...changes } })))))
    const steps = h('div', null,
      form.steps.length === 0 && h('p', { style: S.muted }, 'No steps yet. Each step receives the previous result.'),
      form.steps.map((item, index) => {
        const plugin = byName(item.plugin)
        const label = `Step ${index + 1}`
        const expanded = open[index]
        return h('div', { key: item.uid, style: S.card },
          h('div', { style: S.cardHead },
            h('button', { type: 'button', className: 'secondary', 'aria-expanded': Boolean(expanded), 'aria-label': `${expanded ? 'Collapse' : 'Expand'} step ${index + 1}`, style: { ...S.small, flex: 1, minWidth: 0, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis' }, onClick: () => setOpen(c => ({ ...c, [index]: !c[index] })) },
              `${expanded ? '▾' : '▸'} ${index + 1}. ${item.plugin}`),
            item.always_run && badge(h, 'always', 'running'),
            !item.require_last_result && badge(h, 'no input needed', 'queued'),
            h('button', { type: 'button', className: 'secondary', style: S.small, 'aria-label': `Move step ${index + 1} up`, disabled: index === 0, onClick: () => move(index, -1) }, '↑'),
            h('button', { type: 'button', className: 'secondary', style: S.small, 'aria-label': `Move step ${index + 1} down`, disabled: index === form.steps.length - 1, onClick: () => move(index, 1) }, '↓'),
            h('button', { type: 'button', className: 'danger', style: S.small, 'aria-label': `Remove step ${index + 1}`, onClick: () => { setForm(c => ({ ...c, steps: c.steps.filter((_, i) => i !== index) })); setOpen({}) } }, '✕')),
          expanded && h('div', { style: { padding: '0 .75rem .75rem' } },
            plugin?.description && h('p', { style: S.muted }, plugin.description),
            settingsFor(item, 'step', label, changes => setStep(index, changes)),
            h('label', { style: { ...S.row, marginTop: '.5rem' } },
              h('input', { type: 'checkbox', 'aria-label': `${label} require last result`, checked: item.require_last_result, onChange: e => setStep(index, { require_last_result: e.target.checked }) }),
              'Require last result', h('span', { style: S.muted }, 'skip when the previous step returned nothing')),
            h('label', { style: S.row },
              h('input', { type: 'checkbox', 'aria-label': `${label} always run`, checked: item.always_run, onChange: e => setStep(index, { always_run: e.target.checked }) }),
              'Always run', h('span', { style: S.muted }, 'run even after an earlier step failed or stopped'))))
      }),
      adding
        ? h('div', { style: { ...S.card, padding: '.75rem' } },
          h('div', { style: { ...S.row, marginBottom: '.5rem' } }, h('strong', { style: { flex: 1 } }, 'Choose a step plugin'),
            h('button', { type: 'button', className: 'secondary', style: S.small, onClick: () => setAdding(false) }, 'Cancel')),
          pluginCards('step', null, addStep, 'Step plugin'))
        : h('button', { type: 'button', disabled: form.steps.length >= MAX_STEPS || !ofRole('step').length, onClick: () => setAdding(true) }, 'Add step'))
    return sidePanel(form.id ? `Edit ${form.name || 'workflow'}` : 'New workflow',
      h('button', { type: 'button', disabled: busy, onClick: save }, 'Save workflow'),
      { settings, trigger, steps }[tab],
      [h('div', { key: 'tabs', role: 'tablist', style: S.tabs },
        tabButton('settings', 'Settings'), tabButton('trigger', 'Trigger'), tabButton('steps', `Steps (${form.steps.length})`)),
      unavailable.length > 0 && h('div', { key: 'legacy', role: 'alert', style: { margin: '.75rem 1rem 0' } },
        h('p', null, `Legacy or unavailable plugins: ${[...new Set(unavailable.map(item => item.plugin))].join(', ')}. These cannot be saved or run as workers.`),
        canUpgrade && h('div', null,
          h('p', { style: S.muted }, 'Upgrade known replacements without discarding settings. Queries will be limited to 1000 records and all database access will be organization-scoped. Review settings before saving.'),
          h('button', { type: 'button', className: 'secondary', onClick: upgradeWorkers }, 'Upgrade legacy workers')),
        h('p', { style: S.muted }, 'For plugins without an available replacement, choose another trigger or remove the old step and add a supported worker.')),
      upgradeNotice && h('p', { key: 'upgrade', role: 'status', style: { margin: '.75rem 1rem 0' } }, upgradeNotice),
      panelError && h('p', { key: 'error', role: 'alert', style: { margin: '.75rem 1rem 0', color: '#ffc0c0' } }, panelError)])
  }

  const historyPanel = () => sidePanel(`Run history: ${history.workflow.name}`,
    h('button', { type: 'button', className: 'secondary', style: S.small, disabled: busy, onClick: () => showHistory(history.workflow) }, 'Refresh'),
    history.runs.length === 0 ? h('p', null, 'No runs yet') : history.runs.map(run => {
      const stepLine = (step, i, prefix) => h('li', { key: i, style: { margin: '.25rem 0' } },
        `${prefix || step.plugin || `Step ${i + 1}`} `, badge(h, step.status || 'pending', step.status),
        step.reason && h('span', { style: S.muted }, ` ${step.reason}`),
        step.result !== undefined && step.result !== null && h('pre', { style: { margin: '.25rem 0', padding: '.4rem', background: '#101827', borderRadius: 6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '.78rem', maxHeight: 160, overflow: 'auto' } }, text(step.result)),
        step.error && h('div', { role: 'alert', style: { color: '#ffc0c0' } }, `Error: ${text(step.error)}`))
      return h('div', { key: run.id, style: { ...S.card, padding: '.75rem' } },
        h('div', { style: S.row }, badge(h, run.status || 'unknown', run.status),
          h('span', null, when(run.start || run.requested_at)),
          h('span', { style: S.muted }, run.trigger === 'schedule' ? 'scheduled' : 'run once')),
        run.error && h('p', { role: 'alert', style: { color: '#ffc0c0' } }, `Error: ${text(run.error)}`),
        run.trigger_result && h('ul', { style: { listStyle: 'none', paddingLeft: 0, margin: '.5rem 0 0' } },
          stepLine(run.trigger_result, 'trigger', `Trigger ${run.trigger_result.plugin}`)),
        Array.isArray(run.steps) && h('ol', { style: { paddingLeft: '1.25rem', margin: '.25rem 0 0' } },
          run.steps.map((step, i) => stepLine(step, i))))
    }))

  const deleteModal = () => [
    h('div', { key: 'overlay', style: { ...S.overlay, zIndex: 1002 }, onClick: () => setConfirm(null) }),
    h('div', { key: 'modal', role: 'alertdialog', 'aria-label': 'Confirm delete', style: S.modal },
      h('h3', { style: { marginTop: 0 } }, 'Delete workflow?'),
      h('p', null, `"${confirm.name}" and its schedule will be removed. Run history is kept.`),
      h('div', { style: { ...S.row, justifyContent: 'flex-end' } },
        h('button', { type: 'button', className: 'secondary', onClick: () => setConfirm(null) }, 'Cancel'),
        h('button', { type: 'button', className: 'danger', disabled: busy, onClick: () => remove(confirm) }, 'Delete workflow'))),
  ]

  const cell = (content, extra) => h('td', { style: { ...S.cell, ...extra } }, content)
  return h('section', null, title, messages,
    h('form', { style: { ...S.row, marginBottom: '1rem' }, onSubmit: e => { e.preventDefault(); startEdit(null, quick) } },
      h('input', { 'aria-label': 'New workflow name', placeholder: 'Name', style: { ...S.input, flex: '2 1 10rem' }, value: quick.name, ...typing(e => setQuick({ ...quick, name: e.target.value })) }),
      h('input', { 'aria-label': 'New workflow group', placeholder: 'Group', style: { ...S.input, flex: '1 1 7rem' }, value: quick.group, ...typing(e => setQuick({ ...quick, group: e.target.value })) }),
      h('button', { type: 'submit' }, 'New workflow')),
    workflows.length === 0 ? h('p', null, 'No workflows yet') : h('div', { style: { overflowX: 'auto' } }, h('table', { style: S.table },
      h('thead', null, h('tr', null, ['Name', 'Group', 'Trigger', 'Steps', 'Schedule', 'Status', 'Last run', 'Actions'].map(c => h('th', { key: c, style: { ...S.cell, ...S.muted } }, c)))),
      h('tbody', null, workflows.map(workflow => {
        const last = lastRun(workflow.id)
        return h('tr', { key: workflow.id },
          cell(h('strong', null, workflow.name)),
          cell(workflow.group || '-', S.muted),
          cell(h('code', { style: { fontSize: '.8rem' } }, workflow.trigger?.plugin || '')),
          cell(String((workflow.workflow || []).length)),
          cell(schedule(workflow.interval_seconds, workflow.cron, workflow.timezone), { whiteSpace: 'nowrap' }),
          cell(badge(h, workflow.active ? 'Enabled' : 'Disabled', workflow.active ? 'enabled' : 'disabled', {
            disabled: busy, 'aria-label': `${workflow.active ? 'Disable' : 'Enable'} ${workflow.name}`, onClick: () => toggle(workflow),
          })),
          cell(last ? h('span', null, badge(h, last.status || 'unknown', last.status), ` ${when(last.end || last.start || last.requested_at)}`) : 'Never run'),
          cell(h('div', { style: { ...S.row, flexWrap: 'nowrap' } },
            h('button', { type: 'button', className: 'secondary', style: S.small, 'aria-label': `Edit ${workflow.name}`, onClick: () => startEdit(workflow) }, 'Edit'),
            h('button', { type: 'button', style: S.small, disabled: busy, 'aria-label': `Run ${workflow.name} once`, onClick: () => runWorkflow(workflow) }, 'Run once'),
            h('button', { type: 'button', className: 'secondary', style: S.small, 'aria-label': `History of ${workflow.name}`, onClick: () => showHistory(workflow) }, 'History'),
            h('button', { type: 'button', className: 'danger', style: S.small, disabled: busy, 'aria-label': `Delete ${workflow.name}`, onClick: () => setConfirm(workflow) }, 'Delete'))))
      })))),
    h('details', { style: { marginTop: '1rem' } },
      h('summary', { style: { cursor: 'pointer' } }, 'Run a single plugin once'),
      h('div', { style: { ...S.card, padding: '.75rem', marginTop: '.5rem' } },
        h('select', { 'aria-label': 'Single plugin', style: S.input, value: single.plugin, onChange: e => setSingle({ uid: nextUid(), plugin: e.target.value, params: clone(byName(e.target.value)?.defaults), error: '' }) },
          h('option', { value: '' }, 'Choose plugin'), usable.map(p => h('option', { key: p.plugin, value: p.plugin }, `${p.title} (${p.plugin})`))),
        single.plugin && settingsFor(single, byName(single.plugin)?.roles[0] || 'step', 'Single', changes => setSingle(c => ({ ...c, ...changes }))),
        h('button', { type: 'button', disabled: busy || !single.plugin, onClick: runSingle }, 'Run plugin once'))),
    (catalog.unavailable || []).length > 0 && h('details', { style: { marginTop: '1rem' } },
      h('summary', { style: { cursor: 'pointer' } }, `Workers that cannot be used (${catalog.unavailable.length})`),
      h('ul', null, catalog.unavailable.map(item => h('li', { key: item.plugin, style: S.muted }, h('code', null, item.plugin), ` - ${item.reason}`)))),
    h('p', { style: S.muted }, 'Run once queues a run; the service runner executes it within seconds. Use History to see results.'),
    form && editor(), history && historyPanel(), confirm && deleteModal())
}
