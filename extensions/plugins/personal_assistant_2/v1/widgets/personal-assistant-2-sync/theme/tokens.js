// Theme tokens: time-of-day phase x colour mode, and density by energy.
//
// Colour is never the only signal (see signs.js), and every palette here is checked by
// tests/theme.test.js: WCAG AA text contrast, 3:1 for marks, and marks that stay apart from each
// other under simulated protanopia, deuteranopia and tritanopia.

export const PHASES = ['morning', 'day', 'evening', 'night']
export const MODES = ['default', 'protanopia', 'deuteranopia', 'tritanopia']
export const ENERGY = ['low', 'normal', 'high']

// The time of day sets the surfaces and text. It is the same shift in every colour mode.
const SURFACES = {
  morning: { scheme: 'light', bg: '#fbf6ea', surface: '#fffdf7', text: '#1f2328', muted: '#4d545d', border: '#7c7566' },
  day: { scheme: 'light', bg: '#f2f6fa', surface: '#ffffff', text: '#16202b', muted: '#465361', border: '#6b7a8a' },
  evening: { scheme: 'dark', bg: '#231f2b', surface: '#2d2836', text: '#f4eff8', muted: '#cbc2d3', border: '#978ca3' },
  night: { scheme: 'dark', bg: '#0e131b', surface: '#161d28', text: '#e6ebf2', muted: '#b0bccb', border: '#7d8b9d' },
}

// Marks: work against private, must-do, and done. Separated by lightness as well as hue.
const MARKS = {
  light: {
    default: { work: '#0b4f9e', private: '#b35c00', urgent: '#7a0f3d', done: '#6d7781', accent: '#0b4f9e' },
    protanopia: { work: '#003f8f', private: '#a87300', urgent: '#5c1a5e', done: '#6d7781', accent: '#003f8f' },
    deuteranopia: { work: '#00468f', private: '#b06a00', urgent: '#4d1763', done: '#6d7781', accent: '#00468f' },
    tritanopia: { work: '#00595c', private: '#d1303c', urgent: '#5e0a1f', done: '#6b7076', accent: '#00595c' },
  },
  dark: {
    default: { work: '#6db3ff', private: '#e59a1f', urgent: '#ffd9ea', done: '#8f9aa6', accent: '#6db3ff' },
    protanopia: { work: '#5ea2ff', private: '#d9ad2b', urgent: '#f6e6ff', done: '#8b96a3', accent: '#5ea2ff' },
    deuteranopia: { work: '#62a8ff', private: '#e6a62e', urgent: '#f3e4ff', done: '#8b96a3', accent: '#62a8ff' },
    tritanopia: { work: '#2fc4c9', private: '#ff6b74', urgent: '#ffe1e1', done: '#8f9399', accent: '#2fc4c9' },
  },
}

export const DENSITY = {
  low: { gap: '1.1rem', pad: '1.1rem', size: '1.1rem', visible: 3 },
  normal: { gap: '.75rem', pad: '.85rem', size: '1rem', visible: 8 },
  high: { gap: '.4rem', pad: '.55rem', size: '.95rem', visible: 100 },
}

export function palette(phase, mode = 'default') {
  const surfaces = SURFACES[phase] || SURFACES.day
  const marks = MARKS[surfaces.scheme][mode] || MARKS[surfaces.scheme].default
  return { ...surfaces, ...marks, accentText: surfaces.scheme === 'light' ? '#ffffff' : '#0e131b', focus: surfaces.text }
}

const clock = text => Number(text.slice(0, 2)) * 60 + Number(text.slice(3))

// The phase follows the user's own day, not the sun.
export function phaseAt(minute, schedule) {
  const wake = clock(schedule.wake)
  let bed = clock(schedule.bedtime)
  if (bed < wake) bed += 1440
  const now = minute < wake ? minute + 1440 : minute
  if (now >= bed - 60) return 'night'
  if (now < Math.max(clock(schedule.work_start), wake + 60)) return 'morning'
  if (now < clock(schedule.work_end)) return 'day'
  return 'evening'
}

export function theme({ minute, schedule, settings }) {
  const phase = phaseAt(minute, schedule)
  const mode = MODES.includes(settings.colour_mode) ? settings.colour_mode : 'default'
  const energy = ENERGY.includes(settings.energy) ? settings.energy : 'normal'
  return { phase, mode, energy, colours: palette(phase, mode), density: DENSITY[energy], motion: settings.motion }
}

export function variables({ colours, density }) {
  return {
    colorScheme: colours.scheme,
    '--pa2-bg': colours.bg, '--pa2-surface': colours.surface, '--pa2-text': colours.text,
    '--pa2-muted': colours.muted, '--pa2-border': colours.border, '--pa2-work': colours.work,
    '--pa2-private': colours.private, '--pa2-urgent': colours.urgent, '--pa2-done': colours.done,
    '--pa2-accent': colours.accent, '--pa2-accent-text': colours.accentText, '--pa2-focus': colours.focus,
    '--pa2-gap': density.gap, '--pa2-pad': density.pad, '--pa2-size': density.size,
  }
}
