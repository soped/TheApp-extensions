// Deployed apps overview (default frontend package). Data comes only from the API:
// GET /api/v1/builder_activity/Apps/ lists the organization's apps; administrators
// request deletion with POST .../Apps/State/ {state: "deleted"}; the app server's
// deployer does the cleanup and the app disappears once it reports "deleted".
const APPS = '/api/v1/builder_activity/Apps/'
const DOMAIN = 'arcanist.dk'

export function status(app) {
  if (app.desired_state === 'deleted') return app.error ? 'delete failed' : 'deleting'
  if (app.error) return 'failed'
  if (!app.release) return 'not built yet'
  if (app.observed_state !== app.desired_state) return `${app.observed_state || 'pending'} → ${app.desired_state}`
  return app.observed_state
}

export function shortImage(image) {
  const digest = (image || '').split('@sha256:')[1]
  return digest ? `sha256:${digest.slice(0, 12)}` : '—'
}

export default function AppOverview({ React, api, identity, config = {} }) {
  const h = React.createElement
  const { useCallback, useEffect, useState } = React
  const [apps, setApps] = useState(null)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  const admin = identity?.properties?.user_type === 'admin'

  const load = useCallback(async () => {
    try {
      const result = await api.request(APPS)
      setApps(result.apps || [])
      setError('')
    } catch (cause) {
      const message = cause?.message || String(cause)
      setApps([])
      setError(/404|not found/i.test(message) ? 'This app has no deployment registry.' : message)
    }
  }, [api])

  useEffect(() => {
    load()
    const timer = setInterval(load, Math.max(5, Number(config.pollSeconds) || 15) * 1000)
    return () => clearInterval(timer)
  }, [load, config.pollSeconds])

  async function remove() {
    const app = apps.find(item => item.app === confirm.app)
    setBusy(true)
    try {
      await api.request(`${APPS}State/`, { app: app.app, state: 'deleted', revision: app.revision })
      setConfirm(null)
      await load()
    } catch (cause) {
      setError(cause?.message || String(cause))
    } finally { setBusy(false) }
  }

  const rows = (apps || []).map(app => {
    const url = `https://${app.app}.${DOMAIN}/`
    return h('tr', { key: app.app },
      h('td', null, h('a', { href: url, target: '_blank', rel: 'noopener' }, app.app)),
      h('td', null, (app.release?.version || '—').slice(0, 12)),
      h('td', { title: app.release?.image || '' }, shortImage(app.release?.image)),
      h('td', null, app.database || 'shared-api'),
      h('td', { role: 'status' }, status(app), app.error ? h('div', { className: 'error' }, app.error) : null),
      admin ? h('td', null, app.desired_state === 'deleted' ? null
        : h('button', { type: 'button', onClick: () => setConfirm({ app: app.app, typed: '' }) }, 'Delete')) : null)
  })

  return h('section', { className: 'app-overview' },
    h('h2', null, config.title || 'Deployed apps'),
    error ? h('p', { role: 'alert' }, error) : null,
    apps === null ? h('p', null, 'Loading…')
      : apps.length === 0 && !error ? h('p', null, 'No apps are deployed yet.')
        : h('table', null,
          h('thead', null, h('tr', null, ...['App', 'Version', 'Image', 'Database', 'Status']
            .map(label => h('th', { key: label }, label)), admin ? h('th', null, '') : null)),
          h('tbody', null, ...rows)),
    confirm ? h('div', { role: 'dialog', 'aria-label': `Delete ${confirm.app}` },
      h('p', null, `Delete ${confirm.app}? Its containers, database and data, images, address and certificate `
        + 'are removed from the app server. This cannot be undone.'),
      h('label', null, `Type ${confirm.app} to confirm `,
        h('input', { value: confirm.typed, onChange: event => setConfirm({ ...confirm, typed: event.target.value }) })),
      h('button', { type: 'button', disabled: busy || confirm.typed !== confirm.app, onClick: remove }, 'Delete app'),
      h('button', { type: 'button', onClick: () => setConfirm(null) }, 'Cancel')) : null)
}
