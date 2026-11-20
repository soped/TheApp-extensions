import {
  blastRadius, EDGE_STYLES, ENDPOINTS, layoutGraph, NODE, selectItem, STATUS_COLORS, statusColor, useLiveStatus,
  useSelectedItem,
} from '../cmdb-demo-01-alerts/live.js'

const RADIUS_STROKE = { failed: '#ff4d4d', down: '#ff4d4d', degraded: '#ffc233' }

function Legend({ h }) {
  const swatch = color => ({ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: color,
    marginRight: 4 })
  return h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: '0.8em', marginBottom: 6 } },
    Object.entries(STATUS_COLORS).map(([status, color]) => h('span', { key: status }, h('span', { style: swatch(color) }), status)),
    Object.entries(EDGE_STYLES).map(([type, style]) => h('span', { key: type },
      h('svg', { width: 28, height: 8, 'aria-hidden': true },
        h('line', { x1: 0, y1: 4, x2: 28, y2: 4, stroke: style.stroke, strokeWidth: style.width + 0.4,
          strokeDasharray: style.dash || undefined })), ` ${style.label}`)),
    h('span', null, h('span', { style: { ...swatch('transparent'), outline: '2px solid #ff4d4d' } }), 'blast radius'))
}

export default function CmdbDemoGraph({ React, api, config }) {
  const h = React.createElement
  const live = useLiveStatus(React, api)
  const selected = useSelectedItem(React)
  const [data, setData] = React.useState(null)
  const [error, setError] = React.useState('')
  const [showOwnership, setShowOwnership] = React.useState(config?.showOwnership !== false)

  React.useEffect(() => {
    let active = true
    Promise.all([api.request(ENDPOINTS.items), api.request(ENDPOINTS.relations)]).then(([items, relations]) => {
      if (!Array.isArray(items?.items) || !Array.isArray(relations?.relations)) {
        throw new Error('CMDB API returned an unexpected response')
      }
      if (active) { setData({ items: items.items, teams: items.teams, relations: relations.relations }); setError('') }
    }).catch(cause => { if (active) setError(`Could not load the graph: ${cause.message}`) })
    return () => { active = false }
  }, [api, live.version])

  if (error && !data) return h('p', { role: 'alert' }, error)
  if (!data) return h('p', null, 'Loading dependency graph…')
  const graph = layoutGraph(data.items, data.relations, data.teams, { showOwnership })
  const radius = blastRadius(live.alert)
  const byKey = Object.fromEntries(graph.nodes.map(node => [node.key, node]))
  const hot = edge => radius[edge.source] && radius[edge.target] && edge.type === 'depends'

  return h('div', { className: 'cmdb-demo-01-graph' },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
      h(Legend, { h }),
      h('label', { style: { fontSize: '0.85em' } },
        h('input', { type: 'checkbox', checked: showOwnership, onChange: event => setShowOwnership(event.target.checked) }),
        ' Show ownership')),
    live.alert ? h('p', { role: 'status', style: { margin: '0 0 6px', fontWeight: 600 } },
      `Blast radius: ${live.alert.summary}`) : null,
    error ? h('p', { role: 'alert' }, error) : null,
    h('div', { style: { overflowX: 'auto' } },
      h('svg', { viewBox: `0 0 ${graph.width} ${graph.height}`, width: '100%', role: 'img',
        style: { minWidth: Math.min(graph.width, 640), maxHeight: 640 },
        'aria-label': `Dependency graph of ${data.items.length} items and ${graph.edges.length} relations` },
      h('defs', null, h('marker', { id: 'cmdb-demo-01-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5,
        markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' },
      h('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#7a8699' }))),
      graph.edges.map(edge => {
        const style = EDGE_STYLES[edge.type] || EDGE_STYLES.depends
        return h('path', { key: edge.id, d: edge.path, fill: 'none', 'data-type': edge.type,
          stroke: hot(edge) ? RADIUS_STROKE[radius[edge.target]] : style.stroke,
          strokeWidth: hot(edge) ? style.width + 1.4 : style.width, strokeDasharray: style.dash || undefined,
          opacity: edge.type === 'owns' ? 0.45 : 0.9,
          markerEnd: edge.type === 'depends' ? 'url(#cmdb-demo-01-arrow)' : undefined },
        h('title', null, `${edge.source} → ${edge.target}: ${edge.label || edge.type}`))
      }),
      graph.nodes.map(node => {
        const isTeam = node.kind === 'team'
        const ring = radius[node.key]
        return h('g', { key: node.key, 'data-key': node.key, 'data-status': node.status, 'data-radius': ring || '',
          transform: `translate(${node.x} ${node.y})`, style: { cursor: isTeam ? 'default' : 'pointer' },
          onClick: isTeam ? undefined : () => selectItem(node.key) },
        h('rect', { width: NODE.width, height: NODE.height, rx: isTeam ? 15 : 5,
          fill: isTeam ? '#4b3a6b' : statusColor(node.status),
          stroke: ring ? RADIUS_STROKE[ring] : node.key === selected ? '#ffffff' : 'rgba(0,0,0,0.35)',
          strokeWidth: ring ? 4 : node.key === selected ? 3 : 1, strokeDasharray: ring === 'degraded' ? '5 3' : undefined }),
        h('text', { x: NODE.width / 2, y: NODE.height / 2 + 4, textAnchor: 'middle', fill: '#fff',
          fontSize: 11, fontWeight: 600 }, isTeam ? node.name : node.key),
        h('title', null, isTeam ? node.name : `${node.key}: ${node.status} (${node.environment}, ${node.owner_name})`))
      }))),
    selected && byKey[selected] ? h('p', { style: { fontSize: '0.85em', margin: '4px 0 0' } }, `Selected: ${selected}`) : null)
}
