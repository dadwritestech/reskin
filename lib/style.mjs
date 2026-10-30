// Style files: a small YAML-subset frontmatter of design tokens plus a prose "voice".
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STYLES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'styles');

const unquote = (v) => v.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');

// Two levels deep is all the format needs: `key: value` and `group:` + indented `key: value`.
export function parseStyle(text, id = 'style') {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error(`${id}: missing --- frontmatter`);
  const tokens = {};
  let group = null;
  for (const raw of m[1].split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const kv = raw.match(/^(\s*)([\w-]+):\s*(.*)$/);
    if (!kv) throw new Error(`${id}: cannot parse line: ${raw}`);
    const [, indent, key, value] = kv;
    if (!indent && value === '') { group = tokens[key] = {}; continue; }
    if (!indent) { tokens[key] = unquote(value); group = null; continue; }
    if (!group) throw new Error(`${id}: indented key without group: ${raw}`);
    group[key] = unquote(value);
  }
  for (const g of ['colors', 'type', 'space', 'radius', 'shadow', 'motion'])
    if (!tokens[g]) throw new Error(`${id}: missing "${g}" group`);
  for (const c of ['canvas', 'surface', 'surface-2', 'ink', 'ink-muted', 'accent', 'on-accent', 'link', 'link-visited', 'hairline', 'focus'])
    if (!tokens.colors[c]) throw new Error(`${id}: missing colors.${c}`);
  return { id, tokens, voice: m[2].trim() };
}

export function listStyles() {
  return readdirSync(STYLES_DIR).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
}

export function loadStyle(id) {
  const path = id.endsWith('.md') ? id : join(STYLES_DIR, `${id}.md`);
  const sid = id.replace(/\\/g, '/').split('/').pop().replace(/\.md$/, '');
  return parseStyle(readFileSync(path, 'utf8'), sid);
}

// CSS custom properties every generated rule may use. The LLM is told this exact list.
export function cssVars(style) {
  const t = style.tokens;
  const v = {};
  for (const [k, val] of Object.entries(t.colors)) v[`--rs-${k}`] = val;
  v['--rs-font'] = t.type.family;
  v['--rs-display'] = t.type.display || t.type.family;
  v['--rs-mono'] = t.type.mono;
  v['--rs-size'] = t.type.size;
  v['--rs-leading'] = t.type.leading;
  v['--rs-heading-weight'] = t.type['heading-weight'];
  v['--rs-heading-tracking'] = t.type['heading-tracking'];
  const scale = Number(t.type.scale) || 1.25;
  // Font sizes only. Spacing has its own scale below, so the two are never confused.
  for (let i = 1; i <= 4; i++) v[`--rs-text-${i}`] = `calc(var(--rs-size) * ${Math.pow(scale, i).toFixed(3)})`;
  v['--rs-text-small'] = `calc(var(--rs-size) / ${scale})`;
  v['--rs-unit'] = t.space.unit;
  for (const k of [1, 2, 3, 4, 6, 8]) v[`--rs-space-${k}`] = `calc(${t.space.unit} * ${k})`;
  v['--rs-gutter'] = t.space.gutter;
  v['--rs-measure'] = t.space.measure;
  for (const [k, val] of Object.entries(t.radius)) v[`--rs-radius-${k}`] = val;
  v['--rs-shadow-card'] = t.shadow.card;
  v['--rs-quick'] = t.motion.quick;
  v['--rs-ease'] = t.motion.easing;
  return v;
}

// Deterministic floor: applied before the LLM layer, so the LLM only adds brand character.
export function baseCss(style) {
  const vars = Object.entries(cssVars(style)).map(([k, v]) => `  ${k}: ${v};`).join('\n');
  const dark = style.tokens.mode === 'dark';
  return `/* reskin base: ${style.tokens.title || style.id} */
:root {
${vars}
  color-scheme: ${dark ? 'dark' : 'light'};
}
html { background: var(--rs-canvas); color: var(--rs-ink); }
body {
  margin: 0 auto; max-width: var(--rs-measure); padding: var(--rs-gutter);
  background: var(--rs-canvas); color: var(--rs-ink);
  font-family: var(--rs-font); font-size: var(--rs-size); line-height: var(--rs-leading);
  overflow-wrap: anywhere; -webkit-font-smoothing: antialiased;
}
body * { font-family: inherit; }
table { font-size: inherit; line-height: inherit; border-collapse: collapse; max-width: 100%; }
:is(pre, code, kbd, samp, tt) { font-family: var(--rs-mono); font-size: 0.92em; }
font[color], td, th { color: inherit; }
[bgcolor], [background] { background: transparent; }
a { color: var(--rs-link); text-decoration-thickness: 1px; text-underline-offset: 0.2em; }
a:visited { color: var(--rs-link-visited); }
:is(h1, h2, h3, h4, h5, h6) {
  font-family: var(--rs-display); font-weight: var(--rs-heading-weight);
  letter-spacing: var(--rs-heading-tracking); line-height: 1.2; color: var(--rs-ink);
}
h1 { font-size: var(--rs-text-3); } h2 { font-size: var(--rs-text-2); } h3 { font-size: var(--rs-text-1); }
hr { border: 0; border-top: 1px solid var(--rs-hairline); }
img, video { max-width: 100%; height: auto; }
iframe, canvas, svg { max-width: 100%; }
pre { overflow-x: auto; background: var(--rs-surface); color: var(--rs-ink); padding: calc(var(--rs-unit) * 3); border-radius: var(--rs-radius-md); }
blockquote { margin-left: 0; padding-left: 1em; border-left: 3px solid var(--rs-hairline); }
:is(input, select, textarea) {
  font: inherit; color: var(--rs-ink); background: var(--rs-surface);
  border: 1px solid var(--rs-hairline); border-radius: var(--rs-radius-sm); padding: 0.3em 0.6em; max-width: 100%;
}
:is(button, input[type=submit], input[type=button], input[type=reset]) {
  font: inherit; color: var(--rs-on-accent); background: var(--rs-accent); border: 1px solid var(--rs-accent);
  border-radius: var(--rs-radius-pill); padding: 0.35em 0.9em; cursor: pointer;
}
:is(button, input, [role=button])[data-rs-bare] { background-color: transparent; border-color: transparent; padding: 0; min-width: 0; color: inherit; }
::selection { background: var(--rs-accent); color: var(--rs-on-accent); }
[data-rs-hide] { display: none !important; }
[data-rs-sr]:not(:focus):not(:focus-within) {
  position: absolute !important; width: 1px !important; height: 1px !important; overflow: hidden !important;
  clip: rect(0 0 0 0) !important; clip-path: inset(50%) !important; white-space: nowrap !important;
}
@media (max-width: 640px) {
  body { padding: calc(var(--rs-gutter) / 2); }
  table { display: block; overflow-x: auto; width: auto !important; }
  :is(td, th) { white-space: normal; }
  [width] { max-width: 100%; }
  pre { white-space: pre; }
}
`;
}

// Always last: hallmark-style floor that the LLM layer cannot override.
export function floorCss() {
  return `/* reskin floor (always last) */
:focus-visible { outline: 2px solid var(--rs-focus) !important; outline-offset: 2px !important; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important; scroll-behavior: auto !important; }
}
`;
}
