export function isAdmin(identity) {
  return identity?.properties?.user_type === 'admin'
}

export default function GroupManagement({ React, api, identity }) {
  const h = React.createElement
  const [groups, setGroups] = React.useState([])
  const [members, setMembers] = React.useState([])
  const [selected, setSelected] = React.useState(null)
  const [draft, setDraft] = React.useState({ name: '', description: '', members: [] })
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const admin = isAdmin(identity)

  const load = React.useCallback(async () => {
    const [groupResult, memberResult] = await Promise.all([
      api.request('/api/v1/users/Groups/'), api.request('/account/admin/members/'),
    ])
    setGroups(Array.isArray(groupResult) ? groupResult : [])
    setMembers((memberResult.members || []).map(member => member.username))
  }, [api])

  React.useEffect(() => {
    if (!admin) return undefined
    let active = true
    load().catch(cause => { if (active) setError(cause.message) })
    return () => { active = false }
  }, [admin, load])

  if (!admin) return h('p', { role: 'alert' }, 'Administrator privileges are required to manage groups.')

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
  function edit(group) {
    setSelected(group?._id || null)
    setDraft(group ? { name: group.name, description: group.description || '', members: group.members || [] }
      : { name: '', description: '', members: [] })
  }
  function toggle(username, checked) {
    setDraft(current => ({
      ...current,
      members: checked ? [...new Set([...current.members, username])] : current.members.filter(item => item !== username),
    }))
  }
  function save(event) {
    event.preventDefault()
    const path = selected ? `/api/v1/users/Groups/${encodeURIComponent(selected)}/` : '/api/v1/users/Groups/'
    void act(async () => { await api.request(path, draft); edit(null) }, `Group ${draft.name} saved.`)
  }

  return h('section', { className: 'panel', 'aria-label': 'Group management' },
    h('h2', null, 'Groups'),
    error && h('p', { className: 'error', role: 'alert' }, error),
    notice && h('p', { role: 'status' }, notice),
    h('ul', { className: 'user-list' }, groups.map(group => h('li', { key: group._id },
      h('span', null, `${group.name} (${(group.members || []).length})`),
      h('div', { className: 'actions' },
        h('button', { type: 'button', className: 'secondary', disabled: busy, onClick: () => edit(group) }, 'Edit'),
        h('button', {
          type: 'button', className: 'danger', disabled: busy,
          onClick: () => void act(async () => {
            await api.request(`/api/v1/users/Groups/${encodeURIComponent(group._id)}/delete/`, {})
            if (selected === group._id) edit(null)
          }, `Group ${group.name} deleted.`),
        }, 'Delete'))))),
    !groups.length && h('p', null, 'No groups yet.'),
    h('form', { onSubmit: save },
      h('h3', null, selected ? 'Edit group' : 'New group'),
      h('label', null, 'Name',
        h('input', { value: draft.name, required: true, maxLength: 80, onChange: event => setDraft({ ...draft, name: event.target.value }) })),
      h('label', null, 'Description',
        h('input', { value: draft.description, maxLength: 500, onChange: event => setDraft({ ...draft, description: event.target.value }) })),
      h('fieldset', null, h('legend', null, 'Members'),
        members.map(username => h('label', { key: username },
          h('input', { type: 'checkbox', checked: draft.members.includes(username), onChange: event => toggle(username, event.target.checked) }),
          username))),
      h('button', { disabled: busy }, selected ? 'Save group' : 'Create group'),
      selected && h('button', { type: 'button', className: 'secondary', onClick: () => edit(null) }, 'Cancel')))
}
