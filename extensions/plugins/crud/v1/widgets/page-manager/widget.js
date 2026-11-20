export function isAdmin(identity) {
  return identity?.properties?.user_type === 'admin'
}

export function slugify(title) {
  return String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}

export function moveItem(list, index, offset) {
  const other = index + offset
  if (other < 0 || other >= list.length) return list
  const next = [...list]
  ;[next[index], next[other]] = [next[other], next[index]]
  return next
}

export function buildBody(draft) {
  if (draft.type === 'link') return { title: draft.title, slug: draft.slug, type: 'link', url: draft.url, widgets: [] }
  const widgets = draft.widgets.map(({ id, widget, width, configText }) => {
    const config = JSON.parse(configText)
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('Widget configuration must be a JSON object')
    }
    return { id, widget, width, config }
  })
  return { title: draft.title, slug: draft.slug, type: 'widgets', url: '', widgets }
}

function toDraft(page) {
  return {
    _id: page?._id, title: page?.title || '', slug: page?.slug || '',
    type: page?.type === 'link' ? 'link' : 'widgets', url: page?.url || '',
    widgets: (page?.widgets || []).map(widget => ({ ...widget, configText: JSON.stringify(widget.config, null, 2) })),
  }
}

let counter = 0
function instanceId() {
  counter += 1
  return `w-${Date.now().toString(36)}-${counter}`
}

export default function PageManager({ React, api, identity }) {
  const h = React.createElement
  const admin = isAdmin(identity)
  const [pages, setPages] = React.useState([])
  const [catalog, setCatalog] = React.useState([])
  const [draft, setDraft] = React.useState(null)
  const [choice, setChoice] = React.useState('')
  const [confirm, setConfirm] = React.useState(false)
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const load = React.useCallback(async () => {
    const all = []
    for (let skip = 0; ; skip += 100) {
      const batch = await api.read('pages', { skip, limit: 100 })
      if (!Array.isArray(batch)) throw new Error('Pages response must be an array')
      all.push(...batch)
      if (batch.length < 100) break
    }
    setPages(all)
    const response = await fetch('/extensions/widgets.json', { cache: 'no-store' })
    const widgets = await response.json()
    if (!response.ok || !Array.isArray(widgets)) throw new Error('Unable to load the widget catalog')
    const addable = widgets.filter(widget => widget.role !== 'login' && widget.role !== 'worker')
    setCatalog(addable)
    setChoice(current => current || addable[0]?.id || '')
  }, [api])

  React.useEffect(() => {
    if (!admin) return undefined
    let active = true
    load().catch(cause => { if (active) setError(cause.message) })
    return () => { active = false }
  }, [admin, load])

  if (!admin) return h('p', { role: 'alert' }, 'Administrator privileges are required to manage pages.')

  async function act(work, message) {
    setBusy(true); setError(''); setNotice('')
    try {
      await work()
      await load()
      setNotice(message)
    } catch (cause) {
      setError(cause.message)
    } finally {
      setBusy(false)
    }
  }

  const edit = fields => setDraft(current => ({ ...current, ...fields }))
  const editWidget = (id, fields) => setDraft(current => ({
    ...current, widgets: current.widgets.map(item => item.id === id ? { ...item, ...fields } : item),
  }))

  function save(event) {
    event.preventDefault()
    void act(async () => {
      const body = buildBody(draft)
      if (draft._id) await api.update('pages', draft._id, body)
      else await api.create('pages', body)
      setDraft(null)
    }, 'Page saved.')
  }

  function remove() {
    void act(async () => {
      await api.delete('pages', draft._id)
      setDraft(null); setConfirm(false)
    }, 'Page deleted. Widget data was not deleted.')
  }

  const list = h('ul', null, pages.map(page => h('li', { key: page._id },
    `${page.title} (/${page.slug})${page.type === 'link' ? ' — link' : ''} `,
    h('button', { type: 'button', disabled: busy, onClick: () => { setDraft(toDraft(page)); setConfirm(false) } }, 'Edit'))))

  const form = draft && h('form', { onSubmit: save, 'aria-label': 'Page editor' },
    h('h3', null, draft._id ? 'Edit page' : 'New page'),
    h('label', null, 'Page title',
      h('input', {
        value: draft.title, required: true, maxLength: 120,
        onChange: event => edit({ title: event.target.value, ...(draft._id || draft.slugTouched ? {} : { slug: slugify(event.target.value) }) }),
      })),
    h('label', null, 'Slug',
      h('input', {
        value: draft.slug, required: true, maxLength: 80, pattern: '[a-z0-9]+(-[a-z0-9]+)*',
        onChange: event => edit({ slug: event.target.value, slugTouched: true }),
      })),
    h('label', null, 'Type',
      h('select', { value: draft.type, disabled: Boolean(draft._id), onChange: event => edit({ type: event.target.value }) },
        h('option', { value: 'widgets' }, 'Widget page'), h('option', { value: 'link' }, 'Link (opens in new tab)'))),
    draft.type === 'link'
      ? h('label', null, 'URL (http or https)',
        h('input', { type: 'url', value: draft.url, required: true, maxLength: 2048, onChange: event => edit({ url: event.target.value }) }))
      : h('div', null,
        draft.widgets.map((instance, index) => h('div', { key: instance.id, className: 'panel' },
          h('h4', null, catalog.find(widget => widget.id === instance.widget)?.title || `Missing: ${instance.widget}`),
          h('button', { type: 'button', disabled: index === 0, onClick: () => edit({ widgets: moveItem(draft.widgets, index, -1) }) }, 'Up'),
          h('button', { type: 'button', disabled: index === draft.widgets.length - 1, onClick: () => edit({ widgets: moveItem(draft.widgets, index, 1) }) }, 'Down'),
          h('button', { type: 'button', onClick: () => edit({ widgets: draft.widgets.filter(item => item.id !== instance.id) }) }, 'Remove'),
          h('label', null, 'Width',
            h('select', { value: instance.width, onChange: event => editWidget(instance.id, { width: Number(event.target.value) }) },
              h('option', { value: 1 }, '1 column'), h('option', { value: 2 }, '2 columns'), h('option', { value: 3 }, 'Full width'))),
          h('label', null, 'Configuration (JSON)',
            h('textarea', { value: instance.configText, rows: 5, onChange: event => editWidget(instance.id, { configText: event.target.value }) })))),
        h('label', null, 'Available widget',
          h('select', { value: choice, onChange: event => setChoice(event.target.value) },
            !catalog.length && h('option', { value: '' }, 'No widgets installed'),
            catalog.map(widget => h('option', { key: widget.id, value: widget.id }, widget.title)))),
        h('button', {
          type: 'button', disabled: !choice || draft.widgets.length >= 50,
          onClick: () => {
            const manifest = catalog.find(widget => widget.id === choice)
            edit({ widgets: [...draft.widgets, {
              id: instanceId(), widget: choice, width: 1, config: {},
              configText: JSON.stringify(manifest?.defaultConfig || {}, null, 2),
            }] })
          },
        }, 'Add widget')),
    h('button', { disabled: busy }, busy ? 'Saving…' : 'Save page'),
    h('button', { type: 'button', disabled: busy, onClick: () => setDraft(null) }, 'Cancel'),
    draft._id && h('div', null,
      h('label', null, h('input', { type: 'checkbox', checked: confirm, onChange: event => setConfirm(event.target.checked) }),
        'Confirm deletion of this page (widget data is not deleted)'),
      h('button', { type: 'button', disabled: !confirm || busy, onClick: remove }, 'Delete page')))

  return h('section', { className: 'panel', 'aria-label': 'Page manager' },
    h('h2', null, 'Pages'),
    error && h('p', { className: 'error', role: 'alert' }, error),
    notice && h('p', { role: 'status' }, notice),
    list,
    !draft && h('button', { type: 'button', disabled: busy, onClick: () => { setDraft(toDraft(null)); setConfirm(false) } }, 'New page'),
    form)
}
