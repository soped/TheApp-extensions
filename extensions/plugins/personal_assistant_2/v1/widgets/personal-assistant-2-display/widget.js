import { frame, kit, useAction } from '../personal-assistant-2-sync/ui/kit.js'
import { SIGNS } from '../personal-assistant-2-sync/theme/signs.js'

const MODES = [['default', 'Standard (works for common colour blindness)'], ['protanopia', 'Tuned for protanopia (red)'],
  ['deuteranopia', 'Tuned for deuteranopia (green)'], ['tritanopia', 'Tuned for tritanopia (blue)']]
const ENERGY = [['low', 'Low: fewer things, more space'], ['normal', 'Normal'], ['high', 'High: everything, closer together']]
const MOTION = [['system', 'Follow this device'], ['reduce', 'Reduce motion']]

export function DisplayView({ React, store, state, look, config }) {
  const { h, select } = kit(React)
  const { run, note } = useAction(React)
  const save = name => value => run(() => store.saveSettings({ [name]: value }), 'Saved')
  return h(React.Fragment, null,
    h('h2', null, config.title || 'Display'),
    select('Colours', state.settings.colour_mode, MODES, save('colour_mode')),
    select('Energy right now', state.settings.energy, ENERGY, save('energy')),
    select('Motion', state.settings.motion, MOTION, save('motion')),
    note,
    h('p', { className: 'pa2-muted' }, `Colours follow your day (now: ${look.phase}). Text size follows your device or browser.`),
    h('h3', null, 'What the signs mean'),
    h('ul', null, Object.entries(SIGNS).map(([kind, sign]) => h('li', { key: kind },
      h('span', { className: `pa2-mark pa2-mark-${kind}`, 'aria-hidden': 'true' }, sign.symbol), sign.label))))
}

export default function Display(props) {
  return frame(props.React, props, 'Display', DisplayView)
}
