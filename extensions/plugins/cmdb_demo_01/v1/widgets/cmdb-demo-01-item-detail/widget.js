import {
  itemPath, relationsPath, selectItem, statusBadge, useLiveStatus, useSelectedItem,
} from '../cmdb-demo-01-alerts/live.js'

function RelationList({ h, title, relations, side }) {
  return h('div', { 'data-direction': side, style: { flex: '1 1 220px' } },
    h('h4', { style: { margin: '8px 0 4px' } }, `${title} (${relations.length})`),
    relations.length ? h('ul', { style: { margin: 0, paddingLeft: 18 } }, relations.map(relation => {
      const key = side === 'outgoing' ? relation.target : relation.source
      const kind = side === 'outgoing' ? relation.target_kind : relation.source_kind
      return h('li', { key: relation.id },
        `${relation.type}${relation.group ? ` (redundant group ${relation.group})` : ''}: `,
        kind === 'item'
          ? h('button', { type: 'button', className: 'secondary', onClick: () => selectItem(key),
            style: { padding: '0 6px' } }, key)
          : h('span', null, side === 'outgoing' ? relation.target_name : relation.source_name),
        relation.label && relation.label !== relation.type ? ` — ${relation.label}` : '')
    })) : h('p', { style: { margin: 0, opacity: 0.75 } }, 'None'))
}

export default function CmdbDemoItemDetail({ React, api, config }) {
  const h = React.createElement
  const selected = useSelectedItem(React, config?.item || '')
  const live = useLiveStatus(React, api)
  const [detail, setDetail] = React.useState(null)
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    if (!selected) return undefined
    let active = true
    Promise.all([api.request(itemPath(selected)), api.request(relationsPath(selected))]).then(([item, relations]) => {
      if (!item?.item || !Array.isArray(relations?.incoming)) throw new Error('CMDB API returned an unexpected response')
      if (active) { setDetail({ item: item.item, relations }); setError('') }
    }).catch(cause => { if (active) setError(`Could not load ${selected}: ${cause.message}`) })
    return () => { active = false }
  }, [api, selected, live.version])

  if (!selected) return h('p', null, 'Select an item in the inventory, graph or alert to see its details.')
  if (error) return h('p', { role: 'alert' }, error)
  if (!detail || detail.item.key !== selected) return h('p', null, `Loading ${selected}…`)
  const { item, relations } = detail
  const fields = [
    ['Type', item.subtype ? `${item.type} (${item.subtype})` : item.type],
    ['Owner', `${item.owner_name} (${item.owner})`],
    ['Environment', item.environment],
    ['Status', statusBadge(h, item.status)],
    ['Own status', item.base_status !== item.status ? item.base_status : null],
    ['Impact', item.impact ? `${item.impact} because ${item.impacted_by.join(', ')} is down` : null],
    ['IP address', item.ip || null],
    ['Notes', item.notes || '—'],
  ].filter(([, value]) => value !== null)
  return h('article', { className: 'cmdb-demo-01-item-detail' },
    h('h3', { style: { margin: '0 0 8px' } }, item.name),
    h('dl', { style: { display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 12px', margin: 0 } },
      fields.flatMap(([label, value]) => [h('dt', { key: `${label}-t`, style: { fontWeight: 600 } }, label),
        h('dd', { key: `${label}-d`, style: { margin: 0 } }, value)])),
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 8 } },
      h(RelationList, { h, title: 'Incoming (this item depends on / is owned by)', relations: relations.incoming, side: 'incoming' }),
      h(RelationList, { h, title: 'Outgoing (depend on this item)', relations: relations.outgoing, side: 'outgoing' })))
}
