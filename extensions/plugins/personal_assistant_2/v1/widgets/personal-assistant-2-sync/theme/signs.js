// What colour means, also said in words and shapes. Symbols are hidden from screen readers; the
// label next to them is what gets read.
export const SIGNS = {
  work: { symbol: '■', label: 'Work' },
  private: { symbol: '●', label: 'Private' },
  open: { symbol: '○', label: 'Open' },
  started: { symbol: '▶', label: 'Started' },
  done: { symbol: '✓', label: 'Done' },
  urgent: { symbol: '▲', label: 'Must do' },
  deadline: { symbol: '◆', label: 'Deadline' },
  carried: { symbol: '↪', label: 'From an earlier day' },
  waiting: { symbol: '⧖', label: 'Saved on this device' },
}

// Everything that is true about a task, in reading order.
export function signsOf(item) {
  return [
    { ...SIGNS[item.context], kind: item.context },
    { ...SIGNS[item.status], kind: item.status },
    item.must_do && { ...SIGNS.urgent, kind: 'urgent' },
    item.deadline && { ...SIGNS.deadline, kind: 'deadline', label: `Deadline ${item.deadline.replace('T', ' ')}` },
    item.carried_from && { ...SIGNS.carried, kind: 'carried' },
    item.waiting && { ...SIGNS.waiting, kind: 'waiting' },
  ].filter(Boolean)
}

export function minutesText(total) {
  const hours = Math.floor(total / 60)
  const rest = total % 60
  return [hours && `${hours} h`, (rest || !hours) && `${rest} min`].filter(Boolean).join(' ')
}
