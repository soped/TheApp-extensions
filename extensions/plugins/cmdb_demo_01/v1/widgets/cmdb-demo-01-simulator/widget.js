import {
  ENDPOINTS, groupByOwner, impactPath, POLL_MS, selectItem, sharedPoller, statusColor, useLiveStatus,
  useSelectedItem,
} from '../cmdb-demo-01-alerts/live.js'

export const MIN_INTERVAL_SECONDS = POLL_MS / 1000

export function randomInterval(value, fallback = 30) {
  const seconds = Math.round(Number(value))
  return Number.isFinite(seconds) ? Math.max(MIN_INTERVAL_SECONDS, Math.min(3600, seconds)) : fallback
}

function Highlight({ h, report, title }) {
  if (!report) return null
  const groups = [['down', report.down], ['degraded', report.degraded]]
  return h('section', { 'aria-label': title, style: { marginTop: 8, padding: 8, borderRadius: 6,
    border: `2px solid ${statusColor(report.severity === 'outage' ? 'down' : report.severity === 'degraded'
      ? 'degraded' : 'operational')}` } },
  h('strong', null, title), h('p', { style: { margin: '4px 0' } }, report.summary),
  groups.map(([status, entries]) => entries.length ? h('div', { key: status, 'data-status': status },
    h('span', { style: { color: statusColor(status), fontWeight: 700 } }, `${status} (${entries.length})`),
    groupByOwner(entries).map(group => h('div', { key: group.owner, style: { paddingLeft: 10 } },
      h('mark', { style: { background: statusColor(status), color: '#fff', padding: '0 4px', borderRadius: 3 } },
        group.owner), ' ',
      group.items.map((entry, index) => h('span', { key: entry.key }, index ? ', ' : '',
        h('button', { type: 'button', className: 'secondary', style: { padding: '0 5px' },
          onClick: () => selectItem(entry.key) }, entry.key)))))) : null))
}

export default function CmdbDemoSimulator({ React, api, config }) {
  const h = React.createElement
  const live = useLiveStatus(React, api)
  const selectedElsewhere = useSelectedItem(React, config?.item || 'sw-core-01')
  const [items, setItems] = React.useState([])
  const [state, setState] = React.useState(null)
  const [item, setItem] = React.useState(selectedElsewhere)
  const [duration, setDuration] = React.useState(Number(config?.durationSeconds) || 60)
  const [preview, setPreview] = React.useState(null)
  const [message, setMessage] = React.useState('')
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [randomOn, setRandomOn] = React.useState(false)
  const [interval, setIntervalSeconds] = React.useState(randomInterval(config?.intervalSeconds))
  const [randomDuration, setRandomDuration] = React.useState(Number(config?.randomDurationSeconds) || 20)
  const mounted = React.useRef(true)

  React.useEffect(() => { setItem(selectedElsewhere) }, [selectedElsewhere])
  React.useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  React.useEffect(() => {
    let active = true
    Promise.all([api.request(ENDPOINTS.items), api.request(ENDPOINTS.simulator)]).then(([list, simulator]) => {
      if (!Array.isArray(list?.items) || !simulator?.state) throw new Error('Simulator API returned an unexpected response')
      if (active) { setItems(list.items); setState(simulator.state); setError('') }
    }).catch(cause => { if (active) setError(`Could not load the simulator: ${cause.message}`) })
    return () => { active = false }
  }, [api, live.version])

  async function run(action, done) {
    setBusy(true)
    setError('')
    try {
      const result = await action()
      if (!mounted.current) return
      if (result?.state) setState(result.state)
      if (done) setMessage(done(result))
      sharedPoller(api).refresh()
    } catch (cause) {
      if (mounted.current) setError(cause.message)
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const fail = body => run(() => api.request(ENDPOINTS.simulate, body),
    result => `Failed ${result.failed.join(' + ')}: ${result.impact?.summary || ''}`)
  const previewImpact = () => run(async () => {
    const report = await api.request(impactPath(item))
    if (mounted.current) setPreview(report)
    return null
  })
  const recoverAll = () => run(() => api.request(ENDPOINTS.simulator, { action: 'recover' }),
    result => result.events.length ? `Recovered ${result.events.map(event => event.item).join(', ')}` : 'Nothing to recover')

  // Random mode: call the simulate endpoint on an interval (never faster than the 10-second polling).
  React.useEffect(() => {
    if (!randomOn) return undefined
    const tick = () => api.request(ENDPOINTS.simulate, { duration: randomDuration })
      .then(result => {
        if (!mounted.current) return
        setMessage(`Random failure: ${result.failed.join(', ')} for ${randomDuration}s`)
        sharedPoller(api).refresh()
      })
      .catch(cause => { if (mounted.current) setError(`Random failure skipped: ${cause.message}`) })
    tick()
    const timer = setInterval(tick, randomInterval(interval) * 1000)
    return () => clearInterval(timer)
  }, [api, randomOn, interval, randomDuration])

  const field = { display: 'flex', flexDirection: 'column', fontSize: '0.85em' }
  const failures = state?.failures || []
  return h('div', { className: 'cmdb-demo-01-simulator' },
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' } },
      h('label', { style: field }, 'Item',
        h('select', { value: item, onChange: event => { setItem(event.target.value); setPreview(null) } },
          items.map(entry => h('option', { key: entry.key, value: entry.key },
            `${entry.key} (${entry.environment}, ${entry.status})`)))),
      h('label', { style: field }, 'Down for (s, 0 = until recovered)',
        h('input', { type: 'number', min: 0, max: 3600, value: duration,
          onChange: event => setDuration(Math.max(0, Math.min(3600, Number(event.target.value) || 0))) })),
      h('button', { type: 'button', className: 'secondary', disabled: busy || !item, onClick: previewImpact }, 'Preview impact'),
      h('button', { type: 'button', className: 'danger', disabled: busy || !item,
        onClick: () => fail({ item, duration }) }, 'Simulate down'),
      h('button', { type: 'button', className: 'secondary', disabled: busy || !failures.length, onClick: recoverAll },
        'Recover all')),
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 } },
      (state?.scenarios || []).map(scenario => h('button', { key: scenario.id, type: 'button', disabled: busy,
        title: scenario.items.join(' + '), onClick: () => fail({ scenario: scenario.id, duration }) }, scenario.title))),
    h('fieldset', { style: { marginTop: 10, border: '1px solid rgba(128,128,128,0.4)', borderRadius: 6 } },
      h('legend', null, 'Random mode'),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' } },
        h('label', { style: field }, `Every (s, min ${MIN_INTERVAL_SECONDS})`,
          h('input', { type: 'number', min: MIN_INTERVAL_SECONDS, max: 3600, value: interval, disabled: randomOn,
            onChange: event => setIntervalSeconds(event.target.value),
            onBlur: () => setIntervalSeconds(randomInterval(interval)) })),
        h('label', { style: field }, 'Failure lasts (s)',
          h('input', { type: 'number', min: 5, max: 3600, value: randomDuration, disabled: randomOn,
            onChange: event => setRandomDuration(Math.max(5, Math.min(3600, Number(event.target.value) || 5))) })),
        h('button', { type: 'button', className: randomOn ? 'danger' : undefined, 'aria-pressed': randomOn,
          onClick: () => { setIntervalSeconds(randomInterval(interval)); setRandomOn(value => !value) } },
        randomOn ? 'Stop random failures' : 'Start random failures')),
      h('p', { style: { margin: '4px 0 0', fontSize: '0.8em', opacity: 0.8 } }, randomOn
        ? `Running: a random item fails every ${randomInterval(interval)} s; changes appear via the live status polling.`
        : 'Stopped.')),
    message ? h('p', { role: 'status', style: { margin: '6px 0' } }, message) : null,
    error ? h('p', { role: 'alert', style: { margin: '6px 0' } }, error) : null,
    failures.length ? h('p', { style: { margin: '6px 0', fontSize: '0.85em' } }, 'Active failures: ',
      failures.map(failure => `${failure.item}${failure.recover_at ? ` (until ${failure.recover_at.slice(11, 19)} UTC)` : ''}`)
        .join(', ')) : null,
    h(Highlight, { h, report: live.alert, title: 'Live blast radius' }),
    preview ? h(Highlight, { h, report: preview, title: `What if ${preview.items.join(' + ')} goes down` }) : null)
}
