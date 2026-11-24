import { BACK_ONLINE, connectionText, frame, kit, useAction } from '../personal-assistant-2-sync/ui/kit.js'

const clock = text => Number(text.slice(0, 2)) * 60 + Number(text.slice(3))

// One list per time frame, in time order, with fixed blocks between the tasks.
export function timeline(day, visible) {
  const wake = day.frames.length ? clock(day.frames[0].start) : 0
  const at = text => clock(text) < wake ? clock(text) + 1440 : clock(text)
  let shown = 0
  return day.frames.map((frame, index) => {
    const start = at(frame.start)
    const end = index + 1 < day.frames.length ? at(day.frames[index + 1].start) : Infinity
    const rows = [
      ...day.items.filter(item => item.frame === frame.name).map(item => ({ kind: 'task', minute: item.start_minute, item })),
      ...day.blocks.filter(block => at(block.start) >= start && at(block.start) < end)
        .map(block => ({ kind: 'block', minute: at(block.start), block })),
    ].sort((a, b) => a.minute - b.minute)
    for (const row of rows) {
      if (row.kind === 'task' && row.item.status !== 'done') shown += 1
      row.later = row.kind === 'task' && row.item.status !== 'done' && shown > visible
    }
    return { frame, now: rows.filter(row => !row.later), later: rows.filter(row => row.later) }
  })
}

export function TodayView({ React, store, state, look, config }) {
  const { h, signs, taskButtons } = kit(React)
  const { run, note } = useAction(React)
  const day = state.day
  const parts = timeline(day, look.density.visible)

  function row(entry) {
    if (entry.kind === 'block') {
      return h('li', { key: `block-${entry.block.start}`, className: 'pa2-note' }, `${entry.block.start}–${entry.block.end} ${entry.block.name}`)
    }
    return task(entry.item, `${entry.item.start}–${entry.item.end}`)
  }
  function task(item, time) {
    return h('li', { key: item.task, className: `pa2-item pa2-${item.context}` },
      time && h('div', null, time),
      h('div', { className: 'pa2-title' }, item.title),
      item.parent_title && h('div', { className: 'pa2-muted' }, `Part of ${item.parent_title}`),
      signs(item),
      item.reason_text && h('div', { className: 'pa2-muted' }, item.reason_text),
      h('div', { className: 'pa2-actions' }, taskButtons(store, run, item, item.task)))
  }

  return h(React.Fragment, null,
    h('h2', null, config.title || 'Today'),
    h('p', { role: 'status', className: 'pa2-muted' }, connectionText(state)),
    h('div', { className: 'pa2-actions' },
      h('button', { type: 'button', className: 'secondary', disabled: !state.online, onClick: () => run(() => store.replan()) }, 'Replan my day'),
      !state.online && h('span', null, `Replanning, AI breakdown and chat: ${BACK_ONLINE.toLowerCase()}.`)),
    note,
    !day.planned && h('p', null, state.online ? 'Making your plan…' : 'Today’s plan is made when you’re online. Your tasks are here until then.'),
    day.planned && !day.items.length && h('p', null, 'Nothing is planned today.'),
    parts.map(({ frame: block, now, later }) => h('div', { key: block.name },
      h('h3', null, `${block.label} ${block.start}–${block.end}`),
      now.length ? h('ol', null, now.map(row)) : !later.length && h('p', { className: 'pa2-muted' }, 'Free'),
      later.length > 0 && h('details', null, h('summary', null, `${later.length} more later`), h('ol', null, later.map(row))))),
    day.unplanned.length > 0 && h('div', null,
      h('h3', null, day.planned ? 'Not placed today' : 'Your tasks'),
      day.planned && h('p', { className: 'pa2-muted' }, 'These are kept, and get a place on a day with room.'),
      h('ul', null, day.unplanned.map(item => task(item, null)))))
}

export default function Today(props) {
  return frame(props.React, props, 'Today', TodayView)
}
