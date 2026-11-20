export function isAdmin(identity) {
  return identity?.properties?.user_type === 'admin'
}

export default function UserManagement({ React, api, identity }) {
  const h = React.createElement
  const [members, setMembers] = React.useState([])
  const [requests, setRequests] = React.useState([])
  const [username, setUsername] = React.useState('')
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const admin = isAdmin(identity)

  const load = React.useCallback(async () => {
    const [memberResult, requestResult] = await Promise.all([
      api.request('/account/admin/members/'), api.request('/account/admin/requests/'),
    ])
    setMembers(memberResult.members || [])
    setRequests(requestResult.requests || [])
  }, [api])

  React.useEffect(() => {
    if (!admin) return undefined
    let active = true
    load().catch(cause => { if (active) setError(cause.message) })
    return () => { active = false }
  }, [admin, load])

  if (!admin) return h('p', { role: 'alert' }, 'Administrator privileges are required to manage users.')

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
  const self = member => member.username === identity.username

  return h('section', { className: 'panel', 'aria-label': 'User management' },
    h('h2', null, 'Users'),
    error && h('p', { className: 'error', role: 'alert' }, error),
    notice && h('p', { role: 'status' }, notice),
    h('form', {
      onSubmit: event => {
        event.preventDefault()
        const target = username.trim()
        void act(() => api.request('/account/admin/invite/', { username: target }).then(() => setUsername('')),
          `Invitation sent to ${target}.`)
      },
    },
      h('label', null, 'Invite existing account by username',
        h('input', { value: username, required: true, maxLength: 120, onChange: event => setUsername(event.target.value) })),
      h('button', { disabled: busy }, 'Send invitation')),
    h('h3', null, 'Members'),
    h('ul', { className: 'user-list' }, members.map(member => h('li', { key: member.username },
      h('span', null, member.username + (member.disabled ? ' (disabled)' : '')),
      h('div', { className: 'actions' },
        h('label', null, 'Role',
          h('select', {
            value: member.role, disabled: busy || self(member),
            onChange: event => void act(() => api.request('/account/admin/member/', {
              username: member.username, role: event.target.value,
            }), `Role updated for ${member.username}.`),
          }, h('option', { value: 'user' }, 'User'), h('option', { value: 'admin' }, 'Administrator'))),
        h('button', {
          type: 'button', className: 'danger', disabled: busy || self(member),
          onClick: () => void act(() => api.request('/account/admin/member/', {
            username: member.username, role: 'remove',
          }), `${member.username} removed from this organization.`),
        }, 'Remove'))))),
    !members.length && h('p', null, 'No active members were returned.'),
    h('h3', null, 'Join requests'),
    h('ul', { className: 'user-list' }, requests.map(request => h('li', { key: request.username },
      h('span', null, request.username),
      h('div', { className: 'actions' },
        ['approve', 'reject'].map(decision => h('button', {
          key: decision, type: 'button', className: decision === 'reject' ? 'secondary' : undefined, disabled: busy,
          onClick: () => void act(() => api.request('/account/admin/request-decision/', {
            username: request.username, decision,
          }), `${request.username} ${decision === 'approve' ? 'approved' : 'declined'}.`),
        }, decision === 'approve' ? 'Approve' : 'Reject')))))),
    !requests.length && h('p', null, 'No pending join requests.'))
}
