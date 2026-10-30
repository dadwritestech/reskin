// LLM layer: prompt, sanitizer, gate feedback and deterministic autofix.
import { cssVars } from './style.mjs';
import { parseColor, contrast } from './color.mjs';

export function buildPrompt(style, snap) {
  const vars = Object.entries(cssVars(style)).map(([k, v]) => `${k}: ${v}`).join('\n');
  const sel = snap.outline.selectors.map((s) => `- ${s.selector} (${s.count})${s.sample ? ` "${s.sample}"` : ''}`).join('\n');
  const system = 'You are a senior product designer who writes CSS. You restyle existing web pages without changing their HTML. You answer with one css code block.';
  const user = `Restyle the page "${snap.outline.title}" (${snap.finalUrl || snap.url}) ${style.tokens.title || 'in the style of ' + style.tokens.name}.

## Design system
${style.voice}

The design tokens are CSS variables already defined on :root. Use them for every colour, font, radius, shadow and transition:
${vars}

## Already applied (do not repeat)
A base layer sets body background, ink, font, size and max-width; link colours; h1-h3 sizes; inputs and buttons; focus outlines; reduced motion. The page's original CSS is removed, so you are styling plain HTML that keeps its classes.

## Page structure: most common visible selectors (count) "sample text"
${sel}
Large containers: ${snap.outline.ids.join(', ') || 'none'}

## DOM skeleton (visible elements, repeated siblings shown once with a count)
${snap.outline.skeleton || '(not captured)'}

## Task
Write 20-45 CSS rules that give this page the design system's character: the top bar or header, the main list or article, metadata, tables, nav links, cards or rows. Target the selectors above and respect the skeleton: if one item spans several sibling rows, style them as one unit (no border between them).
Spacing: use --rs-space-1 .. --rs-space-8 for padding, margin and gap. --rs-text-* are font sizes only. Keep the page's density: list rows stay compact (padding at most --rs-space-3), it should not get much taller than the original.
Hard rules:
- Colours only via var(--rs-*). Text uses --rs-ink or --rs-ink-muted on --rs-canvas, --rs-surface or --rs-surface-2; --rs-on-accent only on --rs-accent; links use --rs-link.
- Never hide anything: no display:none, visibility:hidden, opacity, clip, height:0, font-size under 11px.
- No url(), @import, @font-face, images, logos, or generated text in content.
- Do not set outline or position:fixed. No widths over 360px; use max-width and %.
- Transitions only on color, background-color, border-color, box-shadow with var(--rs-quick) var(--rs-ease).
Return one \`\`\`css block and nothing else.`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

export function extractCss(text) {
  const m = text.match(/```(?:css)?\s*\n([\s\S]*?)(?:```|$)/i);
  return (m ? m[1] : text).trim();
}

const DROP = [
  [/^outline/, () => true, 'outline is owned by the focus floor'],
  [/^display$/, (v) => /\bnone\b/.test(v), 'hides content'],
  [/^visibility$/, (v) => /hidden|collapse/.test(v), 'hides content'],
  [/^opacity$/, (v) => parseFloat(v) < 1, 'fades content'],
  [/^(clip|clip-path)$/, () => true, 'clips content'],
  [/^(height|max-height)$/, (v) => /^0(px|em|rem|%)?\b/.test(v.trim()), 'collapses content'],
  [/^font-size$/, (v) => /px/.test(v) && parseFloat(v) < 11, 'text too small'],
  [/^position$/, (v) => /fixed/.test(v), 'fixed elements cover content'],
  [/^text-indent$/, (v) => parseFloat(v) < -100, 'pushes text offscreen'],
  [/^(width|min-width)$/, (v) => /^\d+(\.\d+)?px/.test(v.trim()) && parseFloat(v) > 360, 'fixed width breaks phones'],
  [/^font-family$/, (v) => !v.includes('var(--rs-'), 'fonts come from tokens'],
  [/^content$/, (v) => /["'][^"']{3,}["']/.test(v), 'no injected text'],
];

// Enforces the hard rules no matter what the model wrote. Returns the clean CSS and what was dropped.
export function sanitizeCss(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<\/?style[^>]*>/gi, '');
  const dropped = [];
  let out = '', buf = '', depth = 0, skip = 0;
  const decl = (d) => {
    d = d.trim();
    if (!d) return;
    const m = d.match(/^(--[\w-]+|[a-zA-Z-]+)\s*:\s*([\s\S]+)$/);
    if (!m) { dropped.push({ decl: d, why: 'unparseable' }); return; }
    const prop = m[1].toLowerCase(), val = m[2].trim();
    if (/url\s*\(|expression\s*\(|@import/i.test(val)) { dropped.push({ decl: d, why: 'no external resources' }); return; }
    if (prop.startsWith('--rs-')) { dropped.push({ decl: d, why: 'tokens are fixed' }); return; }
    for (const [re, test, why] of DROP) if (re.test(prop) && test(val.toLowerCase())) { dropped.push({ decl: d, why }); return; }
    out += `${'  '.repeat(depth)}${prop}: ${val};\n`;
  };
  for (const c of css) {
    if (c === '{') {
      const pre = buf.trim(); buf = '';
      if (skip) { skip++; continue; }
      if (/^@(font-face|import|namespace|charset|property)/i.test(pre)) { skip = 1; dropped.push({ decl: pre, why: 'at-rule not allowed' }); continue; }
      out += `${'  '.repeat(depth)}${pre} {\n`; depth++;
    } else if (c === '}') {
      if (skip) { skip--; buf = ''; continue; }
      decl(buf); buf = '';
      if (depth > 0) { depth--; out += `${'  '.repeat(depth)}}\n`; }
    } else if (c === ';') {
      if (skip) { buf = ''; continue; }
      if (depth === 0) { if (buf.trim()) dropped.push({ decl: buf.trim(), why: 'top-level statement' }); buf = ''; continue; }
      decl(buf); buf = '';
    } else buf += c;
  }
  if (!skip && depth > 0) decl(buf);
  while (depth-- > 0) out += '}\n';
  return { css: out.trim(), dropped };
}

export function gateFeedback(result) {
  const g = result.gates, lines = [];
  for (const f of g.contrast.failures.slice(0, 12)) lines.push(`- contrast: \`${f.selector}\` text ${f.fg} on ${f.bg} is ${f.ratio}:1, needs ${f.need}:1 (e.g. "${f.sample}")`);
  for (const f of g.phone.failures.slice(0, 6)) lines.push(`- phone 375px: \`${f.selector}\` is ${f.width}px wide and overflows to x=${f.right}`);
  for (const f of g.links.failures.slice(0, 6)) lines.push(`- links: "${f.text}" (${f.href}) is ${f.why}`);
  for (const f of g.focus.failures.slice(0, 4)) lines.push(`- focus: \`${f.selector}\` has no visible focus indicator`);
  return `The lint gates rejected that CSS:\n${lines.join('\n')}\nFix every issue (use the token pairs from the rules) and return the complete corrected CSS in one \`\`\`css block.`;
}

// Deterministic last resort. Each patch is narrow and recorded in the report.
export function autofixCss(result, style, prior = '') {
  const t = style.tokens.colors, g = result.gates, rules = [];
  const cand = [['var(--rs-ink-muted)', t['ink-muted']], ['var(--rs-ink)', t.ink], ['var(--rs-on-accent)', t['on-accent']], ['#000', '#000000'], ['#fff', '#ffffff']];
  for (const f of g.contrast.failures) {
    const bg = parseColor(f.bg);
    const pick = cand.find(([, hex]) => contrast(parseColor(hex), bg) >= f.need);
    // Already patched once: the selector spans several backgrounds, so give it its own.
    const again = prior.includes(`html body ${f.selector} {`);
    rules.push(pick && !again ? `html body ${f.selector} { color: ${pick[0]} !important; opacity: 1 !important; }`
      : `html body ${f.selector} { color: var(--rs-ink) !important; background-color: var(--rs-canvas) !important; opacity: 1 !important; }`);
  }
  for (const f of g.phone.failures)
    rules.push(`html body ${f.selector} { max-width: 100% !important; min-width: 0 !important; box-sizing: border-box !important; overflow-x: auto !important; white-space: normal !important; }`);
  for (const f of g.links.failures) {
    const href = f.href.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    rules.push(`html body a[href="${href}"] { visibility: visible !important; opacity: 1 !important; }`);
  }
  for (const f of g.focus.failures) {
    const bg = parseColor(f.bg || '#ffffff');
    const pick = cand.find(([, hex]) => contrast(parseColor(hex), bg) >= 3) || cand[4];
    // Seen before: the stop sits on several backgrounds. A two-tone ring (dark outline over a light
    // halo) reads on any of them.
    rules.push(prior.includes(`html body ${f.selector}:focus-visible {`)
      ? `html body ${f.selector}:focus-visible { outline-color: #000 !important; outline-offset: 2px !important; box-shadow: 0 0 0 2px #fff !important; }`
      : `html body ${f.selector}:focus-visible { outline-color: ${pick[0]} !important; }`);
  }
  return [...new Set(rules)].join('\n');
}

// The page's own CSS-background icons, re-applied verbatim (they're site content, not brand assets).
export function iconCss(icons = []) {
  const groups = new Map();
  icons.forEach((ic, i) => {
    const decl = `display: ${ic.display} !important; width: ${ic.w}px !important; height: ${ic.h}px !important; padding: 0 !important; box-sizing: border-box !important; background-image: ${ic.image} !important; background-size: ${ic.size} !important; background-position: ${ic.position} !important; background-repeat: ${ic.repeat} !important; vertical-align: middle;`;
    groups.set(decl, [...(groups.get(decl) || []), i]);
  });
  return [...groups].map(([decl, ids]) => `${ids.map((i) => `[data-rs-icon="${i}"]`).join(', ')} { ${decl} }`).join('\n');
}

const esc = (s) => String(s).replace(/[&<>"`$\\]/g, (c) => '&#' + c.charCodeAt(0) + ';');

// The toggle lives in a shadow root so neither the original CSS nor the skin can touch it.
function toggleScript(style) {
  const label = esc(style.tokens.title || `in the style of ${style.tokens.name}`);
  return `<script data-rs-toggle>
(() => {
  const html = document.documentElement;
  const set = (on) => {
    html.dataset.reskin = on ? 'on' : 'off';
    document.querySelectorAll('[data-rs-skin]').forEach((s) => (s.media = on ? 'all' : 'not all'));
    document.querySelectorAll('[data-rs-orig]').forEach((s) => (s.media = on ? 'not all' : s.dataset.rsMedia || 'all'));
    document.querySelectorAll('[data-rs-style]').forEach((e) => (on ? e.removeAttribute('style') : e.setAttribute('style', e.dataset.rsStyle)));
    btn.textContent = on ? 'Show original' : 'Show reskin';
    btn.setAttribute('aria-pressed', String(on));
  };
  const host = document.createElement('div');
  host.id = 'rs-toggle-host';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = \`<style>
    :host { all: initial; position: fixed; right: 12px; bottom: 12px; z-index: 2147483647; max-width: calc(100vw - 24px); }
    .pill { display: flex; gap: 10px; align-items: center; padding: 6px 6px 6px 14px; border-radius: 999px;
      background: #111; color: #f2f2f2; font: 500 12px/1.2 system-ui, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,.3); }
    button { font: inherit; color: #111; background: #f2f2f2; border: 0; border-radius: 999px; padding: 6px 12px; cursor: pointer; }
    button:focus-visible { outline: 2px solid #f2f2f2; outline-offset: 2px; }
    @media (max-width: 420px) { .label { display: none; } }
  </style><div class="pill"><span class="label">reskin · ${label} · not affiliated</span><button type="button"></button></div>\`;
  const btn = root.querySelector('button');
  btn.addEventListener('click', () => set(html.dataset.reskin !== 'on'));
  addEventListener('keydown', (e) => { if (e.altKey && e.shiftKey && e.code === 'KeyR') set(html.dataset.reskin !== 'on'); });
  document.body.appendChild(host);
  window.__reskin = set;
  set(html.dataset.reskin !== 'off');
})();
</script>`;
}

export function assemble(snapHtml, style, layers) {
  const css = `${layers.base}\n/* --- LLM layer --- */\n${layers.llm}\n/* --- autofix --- */\n${layers.fix || ''}\n${layers.floor}`;
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="reskin 0.1 · ${esc(style.tokens.title || style.id)}">
<style data-rs-skin id="rs-skin">\n${css.replace(/<\/style/gi, '<\\/style')}\n</style>`;
  let html = snapHtml.replace(/<html\b/i, '<html data-reskin="on"');
  html = /<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i, (m) => `${m}\n${head}\n`) : html.replace(/<html\b[^>]*>/i, (m) => `${m}<head>${head}</head>`);
  const i = html.toLowerCase().lastIndexOf('</body>');
  const tog = toggleScript(style);
  return i >= 0 ? html.slice(0, i) + tog + html.slice(i) : html + tog;
}
