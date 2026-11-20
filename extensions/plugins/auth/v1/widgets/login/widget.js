export default function LoginWidget({ React, config, auth }) {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  async function submit(event) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      await auth.login(fields.get('username'), fields.get('password'))
    } catch (cause) {
      setError(cause.message)
    } finally {
      setBusy(false)
    }
  }
  const h = React.createElement
  return h('form', { className: 'panel', onSubmit: submit },
    h('p', { className: 'eyebrow' }, config.brand),
    h('h1', null, config.title),
    h('p', null, config.description),
    h('label', null, 'Username', h('input', { name: 'username', autoComplete: 'username', required: true })),
    h('label', null, 'Password', h('input', { name: 'password', type: 'password', autoComplete: 'current-password', required: true })),
    error && h('p', { role: 'alert', className: 'error' }, error),
    h('button', { disabled: busy }, busy ? 'Signing in...' : 'Sign in'),
  )
}
