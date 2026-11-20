import {
  bannerText, formatDuration, formatTime, groupByOwner, selectItem, severityLabel, statusColor, useLiveStatus,
} from './live.js'

const BANNER = {
  outage: { background: '#5c1a1a', border: '#d64545' },
  degraded: { background: '#5a4210', border: '#d99a17' },
  none: { background: '#2a3550', border: '#5b7fd6' },
  ok: { background: '#173d2a', border: '#2e9d5b' },
}

function AffectedGroup({ h, title, entries, status }) {
  if (!entries.length) return h('p', { style: { margin: '4px 0', opacity: 0.8 } }, `${title}: none`)
  return h('div', { 'data-group': status },
    h('h4', { style: { margin: '8px 0 4px', color: statusColor(status) } }, `${title} (${entries.length})`),
    groupByOwner(entries).map(group => h('div', { key: group.owner, style: { marginBottom: 6 } },
      h('strong', null, group.owner), ': ',
      group.items.map((entry, index) => h('span', { key: entry.key },
        index ? ', ' : '',
        h('button', { type: 'button', className: 'secondary', onClick: () => selectItem(entry.key),
          style: { padding: '0 6px', margin: '2px 0' } }, entry.key),
        ` (${entry.environment})`)))))
}

export function DetailPanel({ React, alert, now }) {
  const h = React.createElement
  const started = alert.started_at ? Date.parse(alert.started_at) : null
  const outage = alert.severity === 'outage'
  return h('section', { 'aria-label': 'Alert details', style: { marginTop: 10, padding: 10, borderRadius: 6,
    background: 'rgba(0,0,0,0.25)' } },
  h('dl', { style: { display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 12px', margin: 0 } },
    h('dt', null, 'Failed'), h('dd', { style: { margin: 0 } },
      alert.failed.map(entry => `${entry.key} (${entry.owner_name}, ${entry.environment}, ${entry.source || 'simulator'})`)
        .join('; ')),
    h('dt', null, 'Started'), h('dd', { style: { margin: 0 } }, started ? formatTime(alert.started_at) : 'unknown'),
    h('dt', null, 'Duration so far'), h('dd', { style: { margin: 0 } },
      started ? formatDuration(now - started) : 'unknown'),
    h('dt', null, 'Impact'), h('dd', { style: { margin: 0 } }, outage
      ? `Real outage: ${alert.counts.down} item${alert.counts.down === 1 ? '' : 's'} down`
      : alert.failover ? 'Degraded — redundancy covering, no outage' : alert.counts.degraded ? 'Degraded'
        : 'No dependents affected'),
    h('dt', null, 'Environment'), h('dd', { style: { margin: 0 } },
      `${alert.environments.join(', ') || 'none'}${alert.prod_hit ? ' — production is hit' : ' — production not affected'}`)),
  alert.covering.length ? h('ul', { style: { margin: '8px 0', paddingLeft: 18 } },
    alert.covering.map(cover => h('li', { key: `${cover.item}-${cover.group}` },
      `${cover.item}: redundant group "${cover.group}" covered by ${cover.up.join(', ')} (down: ${cover.down.join(', ')})`)))
    : null,
  h(AffectedGroup, { h, title: 'Down', entries: alert.down, status: 'down' }),
  h(AffectedGroup, { h, title: 'Degraded', entries: alert.degraded, status: 'degraded' }))
}

export default function CmdbDemoAlerts({ React, api, config }) {
  const h = React.createElement
  const live = useLiveStatus(React, api)
  const [open, setOpen] = React.useState(Boolean(config?.expanded))
  const [now, setNow] = React.useState(() => Date.now())
  const alert = live.alert
  React.useEffect(() => {
    if (!alert) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [alert])
  React.useEffect(() => { if (!alert) setOpen(Boolean(config?.expanded)) }, [alert, config])
  const tone = !alert ? BANNER.ok : BANNER[alert.severity] || BANNER.none
  return h('div', { className: 'cmdb-demo-01-alerts' },
    h('button', {
      type: 'button', role: 'status', 'aria-live': 'polite', 'aria-expanded': alert ? open : undefined,
      disabled: !alert, onClick: () => setOpen(value => !value),
      style: { width: '100%', textAlign: 'left', padding: '10px 14px', borderRadius: 6, cursor: alert ? 'pointer' : 'default',
        color: '#fff', background: tone.background, border: `2px solid ${tone.border}`, fontWeight: 600 },
    }, h('span', { style: { opacity: 0.85, marginRight: 8 } }, alert ? severityLabel(alert) + ':' : '●'),
    bannerText(alert), alert ? h('span', { style: { float: 'right', opacity: 0.8 } }, open ? 'Hide details' : 'Details') : null),
    live.error ? h('p', { role: 'alert', style: { margin: '6px 0' } }, `Live status unavailable: ${live.error}`) : null,
    alert && open ? h(DetailPanel, { React, alert, now }) : null,
    config?.showEvents === false || !live.events.length ? null : h('details', { style: { marginTop: 8 } },
      h('summary', null, `Latest changes (${live.events.length})`),
      h('ul', { style: { margin: '6px 0', paddingLeft: 18 } }, [...live.events].reverse().slice(0, 8).map(event =>
        h('li', { key: event.id }, `${formatTime(event.created_at)} — ${event.summary}`)))))
}
