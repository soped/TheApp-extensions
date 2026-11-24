// What all widgets share: the store hook, the themed frame, crash reporting and small controls.

import { getStore } from '../core/browser.js'
import { BACK_ONLINE } from '../core/store.js'
import { theme, variables } from '../theme/tokens.js'
import { minutesText, signsOf } from '../theme/signs.js'
import { CSS } from './css.js'

export { BACK_ONLINE, minutesText }

export function useApp(React, { api, identity }) {
  const [app, setApp] = React.useState(null)
  const [error, setError] = React.useState('')
  const [, tick] = React.useState(0)
  React.useEffect(() => {
    let active = true
    let leave = () => {}
    const redraw = () => { if (active) tick(count => count + 1) }
    getStore(api, identity).then(store => {
      if (!active) return
      leave = store.subscribe(redraw)
      setApp(store)
    }, cause => { if (active) setError(cause.message) })
    const timer = setInterval(redraw, 60000) // the time of day moves on by itself
    return () => { active = false; leave(); clearInterval(timer) }
  }, [api, identity?.organization_id, identity?.username])
  return { store: app, state: app?.snapshot() || null, error }
}

const boundaries = new WeakMap()
function boundary(React) {
  if (!boundaries.has(React)) {
    boundaries.set(React, class extends React.Component {
      constructor(props) { super(props); this.state = { failed: false } }
      static getDerivedStateFromError() { return { failed: true } }
      componentDidCatch(error) {
        this.props.store?.reportError({ message: error.message, stack: error.stack, where: this.props.where,
          agent: globalThis.navigator?.userAgent }).catch(() => {})
      }
      render() {
        if (!this.state.failed) return this.props.children
        const h = React.createElement
        return h('div', { role: 'alert' }, h('p', null, 'This part stopped working. Your saved work is safe, and the problem is reported.'),
          h('button', { type: 'button', onClick: () => this.setState({ failed: false }) }, 'Try again'))
      }
    })
  }
  return boundaries.get(React)
}

export function minuteOfDay(moment = new Date()) {
  return moment.getHours() * 60 + moment.getMinutes()
}

// The themed frame of a widget. View is a component, so its hooks and crashes stay inside the boundary.
export function frame(React, props, where, View) {
  const h = React.createElement
  const app = useApp(React, props)
  if (app.error) return h('p', { role: 'alert' }, app.error)
  if (!app.state) return h('p', { role: 'status' }, 'Opening…')
  const look = theme({ minute: minuteOfDay(), schedule: app.state.schedule.value, settings: app.state.settings })
  return h('section', { className: 'pa2', 'data-phase': look.phase, 'data-mode': look.mode, 'data-energy': look.energy,
    'data-motion': look.motion, style: variables(look), 'aria-label': props.config?.title || where },
  h('style', null, CSS),
  h(boundary(React), { store: app.store, where },
    h(View, { React, store: app.store, state: app.state, look, api: props.api, config: props.config || {} })))
}

// Runs an action; a failure to save on the device is shown, never swallowed.
export function useAction(React) {
  const [message, setMessage] = React.useState('')
  const [failed, setFailed] = React.useState(false)
  const run = async (work, success = '') => {
    try {
      const result = await work()
      setFailed(false)
      setMessage(typeof result?.message === 'string' ? result.message : success)
      return true
    } catch (cause) {
      setFailed(true)
      setMessage(cause.message || 'That did not work')
      return false
    }
  }
  const note = React.createElement('p', { role: failed ? 'alert' : 'status', className: 'pa2-muted' }, message)
  return { run, note, message }
}

export function kit(React) {
  const h = React.createElement
  return {
    h,
    // label is what is shown; name adds what it acts on, for people who hear it out of context.
    button(label, onClick, { about, className = 'secondary', disabled = false, type = 'button' } = {}) {
      return h('button', { key: label, type, className, disabled, onClick, 'aria-label': about ? `${label}: ${about}` : undefined }, label)
    },
    field(label, control) { return h('label', null, label, control) },
    input(label, value, onChange, props = {}) {
      return h('label', null, label, h('input', { value, onChange: event => onChange(event.target.value), ...props }))
    },
    check(label, checked, onChange) {
      return h('label', { className: 'pa2-check' },
        h('input', { type: 'checkbox', checked, onChange: event => onChange(event.target.checked) }), label)
    },
    select(label, value, options, onChange) {
      return h('label', null, label, h('select', { value, onChange: event => onChange(event.target.value) },
        options.map(([key, text]) => h('option', { key, value: key }, text))))
    },
    signs(item) {
      return h('div', { className: 'pa2-signs' }, signsOf(item).map(sign => h('span', { key: sign.kind },
        h('span', { className: `pa2-mark pa2-mark-${sign.kind}`, 'aria-hidden': 'true' }, sign.symbol), sign.label)),
      item.duration && h('span', { key: 'duration' }, minutesText(item.duration)))
    },
    taskButtons(store, run, item, identifier) {
      const button = (label, work) => h('button', { key: label, type: 'button', className: label === 'Done' ? undefined : 'secondary',
        'aria-label': `${label}: ${item.title}`, onClick: () => run(work) }, label)
      return [
        item.status === 'open' && button('Start', () => store.startTask(identifier)),
        item.status !== 'done' && button('Done', () => store.finishTask(identifier)),
        item.status === 'done' && button('Not done yet', () => store.reopenTask(identifier)),
      ].filter(Boolean)
    },
  }
}

export function connectionText(state) {
  if (!state.durable) return 'This browser does not let the app save on this device. Changes are only safe once synced.'
  if (state.status.storageError) return `Saving on this device failed: ${state.status.storageError}`
  const waiting = state.waiting ? `${state.waiting} ${state.waiting === 1 ? 'change' : 'changes'} saved on this device` : ''
  if (!state.online) return waiting ? `Offline. ${waiting}, sent when you’re online.` : 'Offline. You can keep working.'
  if (state.waiting) return `${waiting}, sending now.`
  return state.status.lastSync ? 'All saved.' : 'Connecting…'
}
