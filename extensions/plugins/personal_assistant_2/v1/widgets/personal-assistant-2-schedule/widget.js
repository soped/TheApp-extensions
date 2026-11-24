import { frame, kit, useAction } from '../personal-assistant-2-sync/ui/kit.js'

const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'],
  ['sat', 'Saturday'], ['sun', 'Sunday']]
const clock = text => Number(text.slice(0, 2)) * 60 + Number(text.slice(3))

// The same checks as the server, so a schedule saved offline is not refused later.
export function problem(value) {
  for (const [name, label] of [['wake', 'Wake'], ['work_start', 'Work starts'], ['work_end', 'Work ends'], ['bedtime', 'Bedtime']]) {
    if (!/^\d\d:\d\d$/.test(value[name])) return `Fill in ${label}`
  }
  const wake = clock(value.wake)
  const late = text => clock(text) < wake ? clock(text) + 1440 : clock(text)
  if (!(wake <= clock(value.work_start) && clock(value.work_start) < clock(value.work_end)
    && clock(value.work_end) <= late(value.bedtime))) return 'Times must run in this order: wake, work start, work end, bedtime'
  const spans = []
  for (const block of value.blocks) {
    if (!block.name.trim() || block.name.trim().length > 80) return 'Give each fixed block a name'
    if (!/^\d\d:\d\d$/.test(block.start) || !/^\d\d:\d\d$/.test(block.end)) return `Fill in the times of ${block.name.trim()}`
    const span = [late(block.start), late(block.end)]
    if (!(span[0] < span[1] && span[1] <= late(value.bedtime))) return `${block.name.trim()} must start before it ends, between wake and bedtime`
    spans.push(span)
  }
  spans.sort((a, b) => a[0] - b[0])
  if (spans.some((span, at) => at && spans[at - 1][1] > span[0])) return 'Fixed blocks must not overlap'
  return ''
}

export function ScheduleView({ React, store, state, config }) {
  const { h, button, input, check } = kit(React)
  const { run, note } = useAction(React)
  const [draft, setDraft] = React.useState(null)
  const value = draft || state.schedule.value
  const set = (name, next) => setDraft({ ...value, [name]: next })
  const block = (at, name, next) => set('blocks', value.blocks.map((row, index) => index === at ? { ...row, [name]: next } : row))

  async function submit(event) {
    event.preventDefault()
    const saved = await run(async () => {
      const message = problem(value)
      if (message) throw new Error(message)
      await store.saveSchedule({ ...value, blocks: value.blocks.map(row => ({ ...row, name: row.name.trim() })),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null })
    }, 'Your day is saved')
    if (saved) setDraft(null)
  }

  return h(React.Fragment, null,
    h('h2', null, config.title || 'Your day'),
    h('p', { className: 'pa2-muted' }, state.schedule.saved ? 'Roughly is fine. Change it any time.'
      : 'These usual times are in use now. Change what does not fit you; roughly is fine.'),
    h('form', { onSubmit: submit, 'aria-label': 'Daily schedule' },
      h('div', { className: 'pa2-row' },
        [['wake', 'Wake'], ['work_start', 'Work starts'], ['work_end', 'Work ends'], ['bedtime', 'Bedtime']].map(([name, label]) =>
          h(React.Fragment, { key: name }, input(label, value[name], next => set(name, next), { type: 'time', required: true })))),
      h('fieldset', null, h('legend', null, 'Work days'), h('div', { className: 'pa2-row' }, DAYS.map(([day, label]) =>
        h(React.Fragment, { key: day }, check(label, value.workdays.includes(day), on =>
          set('workdays', DAYS.map(row => row[0]).filter(row => row === day ? on : value.workdays.includes(row)))))))),
      h('fieldset', null, h('legend', null, 'Fixed blocks (optional)'),
        value.blocks.map((row, at) => h('div', { key: at, className: 'pa2-row' },
          input(`Block ${at + 1} name`, row.name, next => block(at, 'name', next), { maxLength: 80 }),
          input(`Block ${at + 1} starts`, row.start, next => block(at, 'start', next), { type: 'time' }),
          input(`Block ${at + 1} ends`, row.end, next => block(at, 'end', next), { type: 'time' }),
          button('Remove', () => set('blocks', value.blocks.filter((_, index) => index !== at)), { about: row.name || `block ${at + 1}` }))),
        value.blocks.length < 20 && button('Add a fixed block', () => set('blocks', [...value.blocks, { name: '', start: '12:00', end: '12:30' }]))),
      h('div', { className: 'pa2-actions' }, button('Save my day', undefined, { type: 'submit', className: undefined }),
        draft && button('Undo changes', () => setDraft(null)))),
    note)
}

export default function Schedule(props) {
  return frame(props.React, props, 'Your day', ScheduleView)
}
