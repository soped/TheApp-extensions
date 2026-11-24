// Sizes are in rem and nothing has a fixed height, so large system text only makes things taller.
export const CSS = `
.pa2 { background: var(--pa2-bg); color: var(--pa2-text); font-size: var(--pa2-size); padding: var(--pa2-pad);
  border-radius: 12px; overflow-wrap: anywhere; min-width: 0; }
.pa2 h2 { margin: 0 0 .5rem; font-size: 1.3em; color: var(--pa2-text); }
.pa2 h3 { margin: 1rem 0 .4rem; font-size: 1.05em; color: var(--pa2-text); }
.pa2 p { margin: .4rem 0; }
.pa2 .pa2-muted { color: var(--pa2-muted); }
.pa2 ol, .pa2 ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--pa2-gap); }
.pa2 .pa2-item { background: var(--pa2-surface); border: 1px solid var(--pa2-border); border-left-width: .4rem;
  border-radius: 10px; padding: var(--pa2-pad); min-width: 0; }
.pa2 .pa2-work { border-left-color: var(--pa2-work); border-left-style: solid; }
.pa2 .pa2-private { border-left-color: var(--pa2-private); border-left-style: double; }
.pa2 .pa2-child { margin-left: 1.25rem; }
.pa2 .pa2-title { font-weight: 600; }
.pa2 .pa2-row, .pa2 .pa2-signs, .pa2 .pa2-actions { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }
.pa2 .pa2-signs { margin: .35rem 0; color: var(--pa2-muted); font-size: .9em; gap: .35rem .9rem; }
.pa2 .pa2-mark { margin-right: .3rem; color: var(--pa2-text); }
.pa2 .pa2-mark-work { color: var(--pa2-work); }
.pa2 .pa2-mark-private { color: var(--pa2-private); }
.pa2 .pa2-mark-urgent { color: var(--pa2-urgent); }
.pa2 .pa2-mark-done { color: var(--pa2-done); }
.pa2 label { margin: .5rem 0; color: var(--pa2-text); font-size: 1em; flex: 1 1 9rem; min-width: 0; }
.pa2 label.pa2-check { flex: 0 1 auto; }
.pa2 fieldset { border: 1px solid var(--pa2-border); border-radius: 10px; padding: .6rem; margin: .6rem 0; min-width: 0; }
.pa2 legend { padding: 0 .3rem; }
.pa2 input:not([type=checkbox]):not([type=file]), .pa2 select, .pa2 textarea { background-color: var(--pa2-surface);
  color: var(--pa2-text); border: 1px solid var(--pa2-border); font-size: 1em; font-family: inherit; }
.pa2 option { background: var(--pa2-surface); color: var(--pa2-text); }
.pa2 button { background: var(--pa2-accent); color: var(--pa2-accent-text); border: 1px solid var(--pa2-accent);
  font-size: 1em; transition: none; }
.pa2 button:hover:not(:disabled) { background: var(--pa2-accent); color: var(--pa2-accent-text); text-decoration: underline; }
.pa2 button.secondary, .pa2 button.danger { background: var(--pa2-surface); color: var(--pa2-text); border-color: var(--pa2-border); }
.pa2 button.secondary:hover:not(:disabled), .pa2 button.danger:hover:not(:disabled) { background: var(--pa2-surface); color: var(--pa2-text); }
.pa2 button:active:not(:disabled) { background: var(--pa2-accent); color: var(--pa2-accent-text); }
.pa2 button.secondary:active:not(:disabled), .pa2 button.danger:active:not(:disabled) { background: var(--pa2-surface); color: var(--pa2-text); }
.pa2 button:disabled { opacity: 1; background: var(--pa2-surface); color: var(--pa2-muted); border-style: dashed; border-color: var(--pa2-border); }
.pa2 a { color: var(--pa2-text); }
.pa2 :focus-visible { outline: 3px solid var(--pa2-focus); outline-offset: 2px; }
.pa2 .pa2-note { border: 1px solid var(--pa2-border); border-radius: 10px; padding: .6rem; background: var(--pa2-surface); }
.pa2 summary { cursor: pointer; padding: .4rem 0; }
.pa2[data-motion=reduce] * { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
@media (prefers-reduced-motion: reduce) {
  .pa2 * { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}
@media (forced-colors: active) {
  .pa2 .pa2-item, .pa2 .pa2-note, .pa2 button { border-color: CanvasText; }
}
`
