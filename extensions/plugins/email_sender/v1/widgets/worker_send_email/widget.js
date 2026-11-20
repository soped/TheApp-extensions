// Settings editor for the WorkerSendEmail workflow step. The host passes the step's params as
// `value` and expects onChange(params, error); a non-empty error blocks saving.
const VAULT = '/api/v1/vault/entries/'
const SECURITY = [['starttls', 'STARTTLS (usually port 587)'], ['ssl', 'SSL/TLS (usually port 465)'], ['none', 'None (unencrypted)']]
const ADDRESS = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/
const SECRET = /^[a-z][a-z0-9_-]{0,79}$/

const S = {
  label: { display: 'block', margin: '.5rem 0' },
  name: { display: 'block', fontSize: '.85rem', marginBottom: 2 },
  hint: { display: 'block', fontSize: '.8rem', color: 'var(--text-muted, #a7b6cc)' },
  input: { width: '100%', boxSizing: 'border-box' },
  group: { border: '1px solid #35445e', borderRadius: 8, margin: '.5rem 0', padding: '.5rem' },
  row: { display: 'flex', gap: '.4rem', alignItems: 'center', marginBottom: '.35rem' },
}
const typing = handler => ({ onInput: handler, onChange: handler })

function field(h, label, control, hint) {
  return h('label', { style: S.label }, h('span', { style: S.name }, label), control, hint && h('span', { style: S.hint }, hint))
}

function validate(value) {
  const v = value || {}
  const smtp = v.smtp || {}
  if (v.include_last_result !== undefined && typeof v.include_last_result !== 'boolean') return 'Include last result must be a boolean'
  if (!String(smtp.host || '').trim()) return 'SMTP host is required'
  if (!Number.isInteger(smtp.port) || smtp.port < 1 || smtp.port > 65535) return 'SMTP port must be a whole number between 1 and 65535'
  if (!SECURITY.some(([key]) => key === smtp.security)) return 'Choose a security mode'
  if (!String(v.username || '').trim()) return 'Username is required'
  const sender = String(v.sender || '').trim()
  if (sender && !ADDRESS.test(sender)) return 'Sender must be an email address'
  if (!SECRET.test(String(v.secret || '').trim())) return 'Select a vault secret'
  const recipients = v.recipients || []
  if (!recipients.length) return 'Add at least one recipient'
  if (recipients.length > 50) return 'At most 50 recipients are allowed'
  if (recipients.some(item => !ADDRESS.test(String(item).trim()))) return 'Every recipient must be an email address'
  if (/[\r\n]/.test(String(v.subject || ''))) return 'Subject must be a single line'
  return ''
}

export default function WorkerSendEmailEditor({ React, api, value, onChange }) {
  const h = React.createElement
  const current = value || {}
  const smtp = current.smtp || {}
  const recipients = current.recipients || []
  const [secrets, setSecrets] = React.useState(null)
  const [secretError, setSecretError] = React.useState('')
  const [portText, setPortText] = React.useState(() => smtp.port == null ? '' : String(smtp.port))

  React.useEffect(() => {
    let active = true
    Promise.resolve(api?.request?.(VAULT)).then(result => { if (active) setSecrets((result?.entries || []).map(entry => entry.name)) })
      .catch(error => { if (active) { setSecrets([]); setSecretError(error?.message || 'Vault secrets could not be loaded') } })
    return () => { active = false }
  }, [])
  React.useEffect(() => { const problem = validate(current); if (problem) onChange(current, problem) }, [])

  const emit = next => onChange(next, validate(next))
  const set = (key, item) => emit({ ...current, [key]: item })
  const setSmtp = (key, item) => emit({ ...current, smtp: { ...smtp, [key]: item } })
  const changePort = raw => {
    setPortText(raw)
    const text = raw.trim()
    if (/^\d+$/.test(text)) return setSmtp('port', Number(text))
    onChange({ ...current, smtp: { ...smtp, port: null } }, 'SMTP port must be a whole number between 1 and 65535')
  }
  const setRecipient = (index, item) => set('recipients', recipients.map((entry, i) => i === index ? item : entry))
  const options = secrets ? [...new Set([...(current.secret ? [current.secret] : []), ...secrets])] : [current.secret].filter(Boolean)

  return h('div', null,
    h('fieldset', { style: S.group },
      h('legend', { style: S.name }, 'SMTP server'),
      field(h, 'SMTP host', h('input', { 'aria-label': 'SMTP host', style: S.input, value: smtp.host ?? '',
        ...typing(event => setSmtp('host', event.target.value)) })),
      field(h, 'SMTP port', h('input', { 'aria-label': 'SMTP port', inputMode: 'numeric', style: S.input, value: portText,
        ...typing(event => changePort(event.target.value)) })),
      field(h, 'Security', h('select', { 'aria-label': 'Security', style: S.input, value: smtp.security ?? 'starttls',
        onChange: event => setSmtp('security', event.target.value) },
      SECURITY.map(([key, title]) => h('option', { key, value: key }, title))))),
    field(h, 'Username', h('input', { 'aria-label': 'Username', style: S.input, value: current.username ?? '',
      ...typing(event => set('username', event.target.value)) }), 'Account used to log in to the SMTP server.'),
    field(h, 'Sender', h('input', { 'aria-label': 'Sender', style: S.input, value: current.sender ?? '',
      ...typing(event => set('sender', event.target.value)) }), 'From address; leave empty to use the username.'),
    field(h, 'Vault secret', h('select', { 'aria-label': 'Vault secret', style: S.input, value: current.secret ?? '',
      onChange: event => set('secret', event.target.value) },
    h('option', { value: '' }, secrets ? 'Select a secret…' : 'Loading…'),
    options.map(name => h('option', { key: name, value: name }, name))),
    secretError || 'Stores only the secret name; the password is read from the vault when the email is sent.'),
    h('fieldset', { style: S.group },
      h('legend', { style: S.name }, 'Recipients'),
      recipients.map((address, index) => h('div', { key: index, style: S.row },
        h('input', { 'aria-label': `Recipient ${index + 1}`, style: { flex: 1, minWidth: 0 }, value: address,
          ...typing(event => setRecipient(index, event.target.value)) }),
        h('button', { type: 'button', className: 'secondary', 'aria-label': `Remove recipient ${index + 1}`,
          onClick: () => set('recipients', recipients.filter((_, i) => i !== index)) }, '✕'))),
      h('button', { type: 'button', className: 'secondary', onClick: () => set('recipients', [...recipients, '']) }, 'Add recipient')),
    field(h, 'Subject', h('input', { 'aria-label': 'Subject', style: S.input, value: current.subject ?? '',
      ...typing(event => set('subject', event.target.value)) }), 'Use ${field} to insert a value from the previous result.'),
    field(h, 'Message', h('textarea', { 'aria-label': 'Message', rows: 6, style: S.input, value: current.message ?? '',
      ...typing(event => set('message', event.target.value)) })),
    field(h, 'Include last result', h('input', { type: 'checkbox', 'aria-label': 'Include last result',
      checked: current.include_last_result === true,
      onChange: event => set('include_last_result', event.target.checked) }),
    'Append the full previous step result as formatted JSON, including all build records. Only enable for data these recipients may receive.'),
    h('p', { style: S.hint }, 'Templates use the first result: ${title}, ${phase}, ${job_id}, ${board}, ${planet}, ${task}. Nested fields use ${build.status}; fields must exist in the previous result.'))
}
