import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { parseColor, contrast, blend, isLargeText } from '../lib/color.mjs';
import { runGates, compareLinks } from '../lib/gates.mjs';
import { floorCss } from '../lib/style.mjs';

let browser, dir;
before(async () => { browser = await chromium.launch(); dir = mkdtempSync(join(tmpdir(), 'reskin-gates-')); });
after(async () => { await browser.close(); rmSync(dir, { recursive: true, force: true }); });

let n = 0;
function page(body, css = '') {
  const f = join(dir, `p${n++}.html`);
  writeFileSync(f, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>:root{--rs-focus:#1a56db} body{margin:0;padding:16px;background:#fff;color:#111;font:16px/1.5 sans-serif} ${css}</style></head><body>${body}</body></html>`);
  return f;
}
const gates = (f, links = []) => runGates(browser, f, links);
const FLOOR = floorCss();
const GOOD = '<p>Readable text</p><a href="https://example.com/a">a link</a> <button>Go</button>';

// --- colour math -------------------------------------------------------------
test('contrast math matches WCAG reference values', () => {
  assert.equal(contrast(parseColor('#000'), parseColor('#fff')).toFixed(1), '21.0');
  assert.equal(contrast(parseColor('#777777'), parseColor('#ffffff')).toFixed(2), '4.48');
  assert.equal(contrast(parseColor('rgb(118, 118, 118)'), parseColor('#fff')).toFixed(2), '4.54');
  assert.deepEqual(blend(parseColor('rgba(0, 0, 0, 0.5)'), [255, 255, 255, 1]).map(Math.round), [128, 128, 128, 1]);
  assert.deepEqual(parseColor('color(srgb 1 0 0 / 0.5)'), [255, 0, 0, 0.5]);
  assert.ok(isLargeText(24, 400) && isLargeText(19, 700) && !isLargeText(19, 400));
});

// --- contrast ------------------------------------------------------------------
test('contrast: a clean page passes every gate', async () => {
  const r = await gates(page(GOOD, FLOOR), [{ href: 'https://example.com/a', text: 'a link', visible: true }]);
  assert.equal(r.pass, true, JSON.stringify(r.gates, null, 1));
});

test('contrast: grey-on-white body text fails and names the selector', async () => {
  const r = await gates(page('<p class="faint">Hard to read</p>', FLOOR + '.faint{color:#999}'));
  assert.equal(r.gates.contrast.pass, false);
  assert.equal(r.gates.contrast.failures[0].selector, 'p.faint');
  assert.equal(r.gates.contrast.failures[0].need, 4.5);
});

test('contrast: opacity counts against the text', async () => {
  const r = await gates(page('<p class="ghost">Ghost</p>', FLOOR + '.ghost{color:#000;opacity:.3}'));
  assert.equal(r.gates.contrast.pass, false);
});

test('contrast: large text only needs 3:1', async () => {
  const big = await gates(page('<h1 class="t">Big</h1>', FLOOR + '.t{color:#888;font-size:28px}'));
  const small = await gates(page('<p class="t">Small</p>', FLOOR + '.t{color:#888;font-size:16px}'));
  assert.equal(big.gates.contrast.pass, true);
  assert.equal(small.gates.contrast.pass, false);
});

test('contrast: background is resolved through translucent ancestors', async () => {
  const r = await gates(page('<div class="card"><p>White on dark</p></div>', FLOOR + '.card{background:rgba(0,0,0,.9);color:#fff}'));
  assert.equal(r.gates.contrast.pass, true);
  const bad = await gates(page('<div class="card"><p>Dark on dark</p></div>', FLOOR + '.card{background:#222;color:#444}'));
  assert.equal(bad.gates.contrast.pass, false);
});

// --- focus ---------------------------------------------------------------------
test('focus: outline:none with no replacement fails', async () => {
  const r = await gates(page(GOOD, 'a,button{outline:none!important}'));
  assert.equal(r.gates.focus.pass, false);
  assert.ok(r.gates.focus.failures.length >= 1);
});

test('focus: a low-contrast outline fails, the floor outline passes', async () => {
  const faint = await gates(page(GOOD, ':focus-visible{outline:2px solid #eee}'));
  assert.equal(faint.gates.focus.pass, false);
  const floor = await gates(page(GOOD, FLOOR));
  assert.equal(floor.gates.focus.pass, true);
});

test('focus: a box-shadow ring counts as an indicator', async () => {
  const r = await gates(page(GOOD, ':focus{outline:none} :focus-visible{outline:none;box-shadow:0 0 0 3px #1a56db}'));
  assert.equal(r.gates.focus.pass, true, JSON.stringify(r.gates.focus));
});

// --- phone ---------------------------------------------------------------------
test('phone: a fixed 800px element causes horizontal scroll and is reported', async () => {
  const r = await gates(page('<div class="wide">wide</div>', FLOOR + '.wide{width:800px}'));
  assert.equal(r.gates.phone.pass, false);
  assert.equal(r.gates.phone.failures[0].selector, 'div.wide');
});

test('phone: the same element inside an overflow-x scroller passes', async () => {
  const r = await gates(page('<div class="scroller"><div class="wide">wide</div></div>', FLOOR + '.scroller{overflow-x:auto}.wide{width:800px}'));
  assert.equal(r.gates.phone.pass, true);
});

// --- links ---------------------------------------------------------------------
test('links: compareLinks finds missing and newly hidden links', () => {
  const base = [{ href: 'u1', text: 'one', visible: true }, { href: 'u2', text: 'two', visible: true }, { href: 'u3', text: 'three', visible: false }];
  const ok = compareLinks(base, [{ href: 'u1', text: 'one', visible: true }, { href: 'u2', text: 'two', visible: true }, { href: 'u3', text: 'three', visible: false }]);
  assert.equal(ok.pass, true);
  const bad = compareLinks(base, [{ href: 'u1', text: 'one', visible: false }, { href: 'u3', text: 'three', visible: false }]);
  assert.deepEqual(bad.failures.map((f) => `${f.why}:${f.href}`).sort(), ['hidden:u1', 'hidden:u2', 'missing:u2']);
});

test('links: CSS that hides an originally visible link fails the gate', async () => {
  const base = [{ href: 'https://example.com/a', text: 'a link', visible: true }];
  const r = await gates(page(GOOD, FLOOR + 'a{display:none}'), base);
  assert.equal(r.gates.links.pass, false);
  assert.equal(r.gates.links.failures[0].why, 'hidden');
  const clipped = await gates(page(GOOD, FLOOR + 'a{opacity:0}'), base);
  assert.equal(clipped.gates.links.pass, false);
});

// --- motion ----------------------------------------------------------------------
test('motion: transitions must stop under reduced motion; the floor stops them', async () => {
  const css = 'a{transition:color 300ms ease}';
  assert.equal((await gates(page(GOOD, css))).gates.motion.pass, false);
  assert.equal((await gates(page(GOOD, css + FLOOR))).gates.motion.pass, true);
});
