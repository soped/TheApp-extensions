import { frame, kit, useAction } from '../personal-assistant-2-sync/ui/kit.js'

const EMPTY = { title: '', context: 'private', duration: '30', date: '', time: '', must_do: false, started: '', finished: '' }
const two = value => String(value).padStart(2, '0')

// Stored times are UTC; the form shows and accepts the user's local time.
export function localInput(value) {
  if (!value) return ''
  const at = new Date(value)
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}T${two(at.getHours())}:${two(at.getMinutes())}`
}
export function formOf(task) {
  return { title: task.title, context: task.context, duration: String(task.duration), date: (task.deadline || '').slice(0, 10),
    time: (task.deadline || '').slice(11), must_do: task.must_do, started: localInput(task.started_at), finished: localInput(task.finished_at) }
}
// Checked before it is queued, so the server has no reason to refuse it later.
export function fieldsOf(form) {
  const title = form.title.replace(/\s+/g, ' ').trim()
  if (!title) throw new Error('Give the task a title')
  if (title.length > 500) throw new Error('A title can be at most 500 characters')
  const duration = Number(form.duration)
  if (!Number.isInteger(duration) || duration < 1 || duration > 1440) throw new Error('Duration must be 1 to 1440 minutes')
  return { title, context: form.context, duration, must_do: form.must_do,
    deadline: form.date ? form.date + (form.time ? `T${form.time}` : '') : null }
}
// Only what the user changed is sent, so edits on two devices merge.
export function changesOf(task, form) {
  const next = fieldsOf(form)
  const before = formOf(task)
  if (form.started !== before.started) next.started_at = form.started ? new Date(form.started).toISOString() : null
  if (form.finished !== before.finished) next.finished_at = form.finished ? new Date(form.finished).toISOString() : null
  return Object.fromEntries(Object.entries(next).filter(([name, value]) => value !== task[name]))
}

export function TasksView({ React, store, state, config }) {
  const { h, button, input, check, select, signs, taskButtons } = kit(React)
  const { run, note } = useAction(React)
  const [form, setForm] = React.useState(EMPTY)
  const [editing, setEditing] = React.useState(null)
  const [parent, setParent] = React.useState(null)
  const set = name => value => setForm(current => ({ ...current, [name]: value }))
  const close = () => { setForm(EMPTY); setEditing(null); setParent(null) }
  const edited = state.tasks.find(task => task.id === editing)
  const owner = state.tasks.find(task => task.id === parent)

  async function submit(event) {
    event.preventDefault()
    const saved = await run(async () => {
      if (edited) {
        const changes = changesOf(edited, form)
        if (Object.keys(changes).length) await store.updateTask(edited.id, changes)
      } else {
        await store.createTask({ ...fieldsOf(form), ...(owner ? { parent: owner.id } : {}) })
      }
    }, edited ? 'Changes saved' : 'Task saved')
    if (saved) close()
  }

  const tops = state.tasks.filter(task => !task.parent || !state.tasks.some(row => row.id === task.parent))
  const open = tops.filter(task => task.status !== 'done')
  const done = tops.filter(task => task.status === 'done')
  function row(task, child = false) {
    const children = state.tasks.filter(item => item.parent === task.id)
    return h('li', { key: task.id, className: child ? 'pa2-child' : undefined },
      h('div', { className: `pa2-item pa2-${task.context}` },
        h('div', { className: 'pa2-title' }, task.title),
        signs(task),
        h('div', { className: 'pa2-actions' },
          taskButtons(store, run, task, task.id),
          button('Edit', () => { setEditing(task.id); setParent(null); setForm(formOf(task)) }, { about: task.title }),
          !child && task.status !== 'done' && button('Add sub-task', () => {
            setParent(task.id); setEditing(null); setForm({ ...EMPTY, context: task.context })
          }, { about: task.title }),
          button('Delete', () => run(() => store.deleteTask(task.id), 'Deleted'), {
            about: children.length ? `${task.title} and its sub-tasks` : task.title, className: 'danger' }))),
      children.length > 0 && h('ul', { 'aria-label': `Sub-tasks of ${task.title}` }, children.map(item => row(item, true))))
  }

  return h(React.Fragment, null,
    h('h2', null, config.title || 'Tasks'),
    h('form', { onSubmit: submit, 'aria-label': edited ? `Edit ${edited.title}` : owner ? `Sub-task of ${owner.title}` : 'New task' },
      owner && h('p', null, `Sub-task of ${owner.title}`),
      input(edited ? 'Title' : 'New task', form.title, set('title'), { autoComplete: 'off' }),
      h('div', { className: 'pa2-row' },
        select('Work or private', form.context, [['private', 'Private'], ['work', 'Work']], set('context')),
        input('Minutes', form.duration, set('duration'), { type: 'number', min: 1, max: 1440 }),
        input('Deadline (optional)', form.date, set('date'), { type: 'date' }),
        form.date && input('Deadline time (optional)', form.time, set('time'), { type: 'time' }),
        check('Must do', form.must_do, set('must_do')),
        edited && input('Started', form.started, set('started'), { type: 'datetime-local' }),
        edited && input('Finished', form.finished, set('finished'), { type: 'datetime-local' })),
      h('div', { className: 'pa2-actions' },
        button(edited ? 'Save changes' : owner ? 'Add sub-task' : 'Add task', undefined, { type: 'submit', className: undefined }),
        (edited || owner) && button('Cancel', close))),
    note,
    open.length ? h('ul', { 'aria-label': 'Tasks' }, open.map(task => row(task))) : h('p', { className: 'pa2-muted' }, 'No open tasks.'),
    done.length > 0 && h('details', null, h('summary', null, `Done lately (${done.length})`), h('ul', null, done.map(task => row(task)))))
}

export default function Tasks(props) {
  return frame(props.React, props, 'Tasks', TasksView)
}
