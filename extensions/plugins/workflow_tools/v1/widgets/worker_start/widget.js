// Settings editor for a workflow worker. The workflow editor renders it with
// {React, value, onChange, role, plugin}; onChange(params, error) reports the new settings
// and a validation message (empty when valid) that blocks saving.
const S = {
  label: { display: 'block', margin: '.5rem 0' },
  name: { display: 'block', fontSize: '.85rem', marginBottom: 2 },
  hint: { display: 'block', fontSize: '.8rem', color: 'var(--text-muted, #a7b6cc)' },
  input: { width: '100%', boxSizing: 'border-box' },
  row: { display: 'flex', gap: '.4rem', alignItems: 'center', marginBottom: '.35rem', flexWrap: 'wrap' },
}
const typing = handler => ({ onInput: handler, onChange: handler })

function field(h, label, control, hint) {
  return h('label', { style: S.label }, h('span', { style: S.name }, label), control, hint && h('span', { style: S.hint }, hint))
}

function text(h, label, value, onValue, hint, extra = {}) {
  return field(h, label, h('input', { 'aria-label': label, style: S.input, value: value ?? '', ...extra,
    ...typing(event => onValue(event.target.value)) }), hint)
}

function parseObject(raw, label) {
  if (!raw.trim()) return { value: {} }
  try {
    const value = JSON.parse(raw)
    if (value && typeof value === 'object' && !Array.isArray(value)) return { value }
  } catch { /* reported below */ }
  return { error: `${label} must be a JSON object` }
}

// JSON object textarea that keeps the typed text while it is invalid.
function JsonObject({ React, label, value, onValue, hint }) {
  const h = React.createElement
  const [draft, setDraft] = React.useState(() => Object.keys(value || {}).length ? JSON.stringify(value, null, 2) : '')
  const edit = event => {
    const raw = event.target.value
    setDraft(raw)
    const parsed = parseObject(raw, label)
    onValue(parsed.error ? value : parsed.value, parsed.error || '')
  }
  return field(h, label, h('textarea', { 'aria-label': label, rows: 4, placeholder: '{ }',
    style: { ...S.input, fontFamily: 'monospace' }, value: draft, onInput: edit, onChange: edit }), hint)
}

const KINDS = ['text', 'number', 'boolean', 'json']
const kindOf = value => typeof value === 'string' ? 'text' : typeof value === 'number' ? 'number'
  : typeof value === 'boolean' ? 'boolean' : 'json'

function rowsToObject(rows, label) {
  const result = {}
  for (const row of rows) {
    const key = row.key.trim()
    if (!key) return { error: `${label}: every field needs a name` }
    if (key.startsWith('$') || key.includes('.')) return { error: `${label}: field names cannot start with $ or contain dots` }
    if (key in result) return { error: `${label}: field ${key} is listed twice` }
    if (row.kind === 'number') {
      if (!/^-?\d+(\.\d+)?$/.test(row.text.trim())) return { error: `${label}: ${key} must be a number` }
      result[key] = Number(row.text)
    } else if (row.kind === 'boolean') {
      result[key] = row.text === 'true'
    } else if (row.kind === 'json') {
      try { result[key] = JSON.parse(row.text) } catch { return { error: `${label}: ${key} must be valid JSON` } }
    } else {
      result[key] = row.text
    }
  }
  return { value: result }
}

// Name/value rows edited as an object of static fields.
function StaticFields({ React, label, value, onValue, hint }) {
  const h = React.createElement
  const [rows, setRows] = React.useState(() => Object.entries(value || {}).map(([key, item]) => ({
    key, kind: kindOf(item), text: typeof item === 'string' ? item : kindOf(item) === 'boolean' ? String(item) : JSON.stringify(item),
  })))
  const update = next => {
    setRows(next)
    const parsed = rowsToObject(next, label)
    onValue(parsed.error ? value : parsed.value, parsed.error || '')
  }
  const change = (index, changes) => update(rows.map((row, i) => i === index ? { ...row, ...changes } : row))
  return h('fieldset', { style: { border: '1px solid #35445e', borderRadius: 8, margin: '.5rem 0', padding: '.5rem' } },
    h('legend', { style: S.name }, label),
    hint && h('span', { style: { ...S.hint, marginBottom: '.4rem' } }, hint),
    rows.map((row, index) => h('div', { key: index, style: S.row },
      h('input', { 'aria-label': `${label} name ${index + 1}`, placeholder: 'name', style: { flex: '1 1 8rem', minWidth: 0 }, value: row.key,
        ...typing(event => change(index, { key: event.target.value })) }),
      h('select', { 'aria-label': `${label} type ${index + 1}`, value: row.kind,
        onChange: event => change(index, { kind: event.target.value, text: event.target.value === 'boolean' ? 'true' : row.text }) },
      KINDS.map(kind => h('option', { key: kind, value: kind }, kind))),
      row.kind === 'boolean'
        ? h('select', { 'aria-label': `${label} value ${index + 1}`, value: row.text, onChange: event => change(index, { text: event.target.value }) },
          h('option', { value: 'true' }, 'true'), h('option', { value: 'false' }, 'false'))
        : h('input', { 'aria-label': `${label} value ${index + 1}`, placeholder: 'value', style: { flex: '2 1 10rem', minWidth: 0 }, value: row.text,
          ...typing(event => change(index, { text: event.target.value })) }),
      h('button', { type: 'button', className: 'secondary', 'aria-label': `Remove ${label} ${index + 1}`, onClick: () => update(rows.filter((_, i) => i !== index)) }, '✕'))),
    h('button', { type: 'button', className: 'secondary', onClick: () => update([...rows, { key: '', kind: 'text', text: '' }]) }, `Add ${label.toLowerCase()}`))
}

const list = raw => raw.split(',').map(item => item.trim()).filter(Boolean)

// Keeps one error per setting so a fixed setting does not hide another problem.
function useSettings(React, value, onChange, validate) {
  const problems = React.useRef({})
  const report = (next, key, problem) => {
    if (key) problems.current[key] = problem || ''
    const first = Object.values(problems.current).find(Boolean) || validate(next) || ''
    onChange(next, first)
  }
  React.useEffect(() => { const problem = validate(value || {}); if (problem) onChange(value || {}, problem) }, [])
  return (key, item, problem) => report({ ...(value || {}), [key]: item }, key, problem)
}

export default function WorkerStartEditor({ React, value, onChange }) {
  const h = React.createElement
  const set = useSettings(React, value, onChange, () => '')
  return h('div', null,
    h('p', { style: S.hint }, 'Fires every time the workflow runs and emits one item with triggered_at plus these fields.'),
    h(StaticFields, { React, label: 'Static field', value: value?.set, onValue: (item, problem) => set('set', item, problem),
      hint: 'Added to the emitted item; a field named triggered_at replaces the timestamp.' }))
}
