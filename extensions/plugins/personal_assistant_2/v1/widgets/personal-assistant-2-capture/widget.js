import { frame, kit, useAction } from '../personal-assistant-2-sync/ui/kit.js'

export function speechRecognition(win = globalThis) {
  return win.SpeechRecognition || win.webkitSpeechRecognition || null
}

export function CaptureView({ React, store, state, config }) {
  const { h, button, input } = kit(React)
  const { run, note } = useAction(React)
  const [text, setText] = React.useState('')
  const [listening, setListening] = React.useState(false)
  const recognition = React.useRef(null)
  React.useEffect(() => () => recognition.current?.stop(), [])
  const Speech = speechRecognition()

  // The field is emptied only after the text is stored on the device.
  async function save(value, source) {
    const saved = await run(() => store.capture(value, source), 'Saved to your inbox')
    if (saved) setText(current => current === value ? '' : current)
    else if (source === 'voice') setText(current => [current, value].filter(Boolean).join(' '))
    return saved
  }
  function dictate() {
    if (recognition.current) { recognition.current.stop(); return }
    const speech = new Speech()
    speech.continuous = false
    speech.interimResults = false
    speech.lang = globalThis.navigator?.language || ''
    speech.onresult = event => {
      for (let at = event.resultIndex || 0; at < event.results.length; at++) save(event.results[at][0].transcript, 'voice')
    }
    speech.onerror = event => run(() => Promise.reject(new Error(
      event.error === 'network' ? 'Dictation is back when you’re online. Typing works now.' :
        event.error === 'not-allowed' ? 'Allow the microphone to dictate. Typing works now.' : 'Nothing was heard. Try again, or type it.')))
    speech.onend = () => { recognition.current = null; setListening(false) }
    recognition.current = speech
    setListening(true)
    speech.start()
  }

  return h(React.Fragment, null,
    h('h2', null, config.title || 'Inbox'),
    h('form', { onSubmit: event => { event.preventDefault(); if (text.trim()) save(text, 'text') } },
      input('What’s on your mind?', text, setText, { autoComplete: 'off', enterKeyHint: 'done' }),
      h('div', { className: 'pa2-actions' },
        button('Save', undefined, { type: 'submit', className: undefined, disabled: !text.trim() }),
        Speech && button(listening ? 'Stop dictation' : 'Dictate', dictate))),
    note,
    !state.inbox.length ? h('p', { className: 'pa2-muted' }, 'Your inbox is empty.') :
      h('ul', { 'aria-label': 'Inbox' }, state.inbox.map(item => h('li', { key: item.id, className: 'pa2-item' },
        h('div', { className: 'pa2-title' }, item.text),
        h('div', { className: 'pa2-signs' },
          h('span', null, item.source === 'voice' ? 'By voice' : 'Typed'),
          h('span', null, new Date(item.captured_at).toLocaleString()),
          item.waiting && h('span', null, 'Saved on this device')),
        h('div', { className: 'pa2-actions' },
          // A task title is shorter than a capture can be; long text stays in the inbox to be split.
          item.text.length <= 500 && [['work', 'Make work task'], ['private', 'Make private task']].map(([context, label]) =>
            button(label, () => run(() => store.captureToTask(item.id, { title: item.text, context }), 'Made into a task'), { about: item.text })),
          button('Delete', () => run(() => store.deleteCapture(item.id), 'Deleted'), { about: item.text, className: 'danger' }))))))
}

export default function Capture(props) {
  return frame(props.React, props, 'Inbox', CaptureView)
}
