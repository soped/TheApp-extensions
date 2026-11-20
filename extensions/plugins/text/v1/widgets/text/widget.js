export default function TextWidget({ React, config }) {
  return React.createElement('section', null,
    React.createElement('h2', null, config.heading || 'Text'),
    React.createElement('p', { style: { whiteSpace: 'pre-wrap' } }, config.text || ''),
  )
}
