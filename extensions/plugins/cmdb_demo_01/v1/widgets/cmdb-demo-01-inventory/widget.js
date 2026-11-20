import {
  blastRadius, ENDPOINTS, filterItems, selectItem, statusBadge, useLiveStatus, useSelectedItem,
} from '../cmdb-demo-01-alerts/live.js'

const FILTERS = [
  { name: 'type', label: 'Type', options: data => data.filters.types.map(value => [value, value]) },
  { name: 'owner', label: 'Owner', options: data => data.filters.owners.map(owner => [owner.key, owner.name]) },
  { name: 'status', label: 'Status', options: data => data.filters.statuses.map(value => [value, value]) },
  { name: 'environment', label: 'Environment', options: data => data.filters.environments.map(value => [value, value]) },
]

export default function CmdbDemoInventory({ React, api, config }) {
  const h = React.createElement
  const [data, setData] = React.useState(null)
  const [error, setError] = React.useState('')
  const [filters, setFilters] = React.useState(() => ({ type: '', owner: '', status: '', environment: '', q: '',
    ...(config?.filters || {}) }))
  const live = useLiveStatus(React, api)
  const selected = useSelectedItem(React)

  // Reload whenever the shared poller delivers new status events.
  React.useEffect(() => {
    let active = true
    api.request(ENDPOINTS.items).then(result => {
      if (!Array.isArray(result?.items)) throw new Error('Items API did not return items')
      if (active) { setData(result); setError('') }
    }).catch(cause => { if (active) setError(`Could not load items: ${cause.message}`) })
    return () => { active = false }
  }, [api, live.version])

  if (error && !data) return h('p', { role: 'alert' }, error)
  if (!data) return h('p', null, 'Loading CMDB items…')
  const rows = filterItems(data.items, filters)
  const radius = blastRadius(live.alert)
  const set = (name, value) => setFilters(current => ({ ...current, [name]: value }))
  const cell = { padding: '4px 8px', borderBottom: '1px solid rgba(128,128,128,0.25)', textAlign: 'left' }

  return h('div', { className: 'cmdb-demo-01-inventory' },
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 } },
      FILTERS.map(filter => h('label', { key: filter.name, style: { display: 'flex', flexDirection: 'column', fontSize: '0.85em' } },
        filter.label,
        h('select', { value: filters[filter.name], 'aria-label': `Filter by ${filter.label.toLowerCase()}`,
          onChange: event => set(filter.name, event.target.value) },
        h('option', { value: '' }, 'All'),
        filter.options(data).map(([value, label]) => h('option', { key: value, value }, label))))),
      h('label', { style: { display: 'flex', flexDirection: 'column', fontSize: '0.85em' } }, 'Search',
        h('input', { type: 'search', value: filters.q, placeholder: 'key, notes or IP',
          onChange: event => set('q', event.target.value) })),
      h('button', { type: 'button', className: 'secondary', style: { alignSelf: 'flex-end' },
        onClick: () => setFilters({ type: '', owner: '', status: '', environment: '', q: '' }) }, 'Clear')),
    error ? h('p', { role: 'alert' }, error) : null,
    h('p', { style: { margin: '0 0 6px', fontSize: '0.85em', opacity: 0.8 } },
      `${rows.length} of ${data.total} items — click a row to open its details`),
    h('div', { style: { overflowX: 'auto' } },
      h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
        h('thead', null, h('tr', null, ['Item', 'Type', 'Owner', 'Environment', 'Status', 'Notes']
          .map(title => h('th', { key: title, style: cell }, title)))),
        h('tbody', null, rows.map(item => h('tr', {
          key: item.key, 'data-key': item.key, tabIndex: 0, 'aria-selected': item.key === selected,
          onClick: () => selectItem(item.key),
          onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') selectItem(item.key) },
          style: { cursor: 'pointer', background: item.key === selected ? 'rgba(91,127,214,0.22)'
            : radius[item.key] ? 'rgba(214,69,69,0.12)' : undefined },
        },
        h('td', { style: cell }, h('strong', null, item.key), radius[item.key] ? ` ⚠ ${radius[item.key]}` : ''),
        h('td', { style: cell }, item.subtype ? `${item.type} (${item.subtype})` : item.type),
        h('td', { style: cell }, item.owner_name),
        h('td', { style: cell }, item.environment),
        h('td', { style: cell }, statusBadge(h, item.status)),
        h('td', { style: cell }, item.notes)))))))
}
