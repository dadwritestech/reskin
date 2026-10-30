// Hallmark-style "floor" gates. Nothing ships unless every gate passes.
//   contrast  WCAG AA on every visible text element (4.5:1, 3:1 for large text)
//   focus     each Tab stop shows a >=2px outline at >=3:1, or a changed box-shadow, and is visible
//   phone     375px viewport, no horizontal page scroll
//   links     every original link is still present, and every originally visible one is still visible
//   motion    nothing animates under prefers-reduced-motion: reduce
import { pathToFileURL } from 'node:url';
import { COLOR_SRC } from './color.mjs';

const PAGE_HELPERS = `
${COLOR_SRC}
const __cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
function toRGBA(s) {
  const p = parseColor(s);
  if (p) return p;
  __cv.clearRect(0, 0, 1, 1); __cv.fillStyle = '#000'; __cv.fillStyle = s; __cv.fillRect(0, 0, 1, 1);
  const d = __cv.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2], d[3] / 255];
}
const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const up = (e) => e.parentElement || (e.getRootNode && e.getRootNode().host) || null;
function sig(el) {
  const parts = [];
  let e = el;
  for (let i = 0; i < 3 && e && e.nodeType === 1 && e !== document.body && e !== document.documentElement; i++) {
    if (e.id && /^[A-Za-z][\\w-]*$/.test(e.id)) { parts.unshift('#' + e.id); break; }
    const cls = [...e.classList].filter((c) => /^[A-Za-z_][\\w-]*$/.test(c)).slice(0, 2);
    parts.unshift(e.localName + (cls.length ? '.' + cls.join('.') : ''));
    e = e.parentElement;
  }
  return parts.join(' > ') || el.localName;
}
function effectiveBg(el) {
  const layers = [];
  for (let e = el; e; e = up(e)) {
    const cs = getComputedStyle(e);
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return { unknown: true };
    const c = toRGBA(cs.backgroundColor);
    if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
  }
  let bg = [255, 255, 255, 1];
  for (let i = layers.length - 1; i >= 0; i--) bg = blend(layers[i], bg);
  return { color: bg };
}
function opacityOf(el) {
  let o = 1;
  for (let e = el; e; e = up(e)) o *= parseFloat(getComputedStyle(e).opacity);
  return o;
}
function allElements(root = document) {
  const out = [];
  const walk = (r) => r.querySelectorAll('*').forEach((e) => { out.push(e); if (e.shadowRoot) walk(e.shadowRoot); });
  walk(root);
  return out;
}
function isShown(el) {
  let r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) {
    // Inline links split across lines/columns can report a 0-width box; measure their text instead.
    const range = document.createRange();
    range.selectNodeContents(el);
    r = [...range.getClientRects()].find((x) => x.width >= 2 && x.height >= 2) || r;
  }
  if (r.width < 2 || r.height < 2) return false;
  const cs = getComputedStyle(el);
  if (cs.visibility !== 'visible') return false;
  if (opacityOf(el) < 0.1) return false;
  for (let e = el; e; e = up(e)) {
    const c = getComputedStyle(e);
    if (c.clipPath && c.clipPath.startsWith('inset(50%')) return false;
  }
  return true;
}
`;

async function openPage(browser, file, opts = {}) {
  const context = await browser.newContext({
    viewport: opts.viewport || { width: 1280, height: 800 },
    isMobile: !!opts.mobile, hasTouch: !!opts.mobile, deviceScaleFactor: 1,
    reducedMotion: opts.reducedMotion || 'no-preference',
  });
  const page = await context.newPage();
  const url = file.startsWith('http') || file.startsWith('file:') ? file : pathToFileURL(file).href;
  try { await page.goto(url, { waitUntil: 'load', timeout: 45000 }); } catch { /* slow remote images: gate what loaded */ }
  await page.waitForTimeout(300);
  await page.addScriptTag({ content: PAGE_HELPERS });
  return { context, page };
}

export async function contrastGate(page) {
  return page.evaluate(() => {
    const groups = new Map();
    let checked = 0, unknown = 0;
    const SKIP = new Set(['script', 'style', 'noscript', 'template', 'option', 'title']);
    for (const el of allElements()) {
      if (SKIP.has(el.localName) || el.closest('svg')) continue;
      const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      const isBtn = el.localName === 'input' && /^(submit|button|reset)$/.test(el.type) && el.value.trim();
      if (!ownText && !isBtn) continue;
      if (!isShown(el)) continue;
      const bg = effectiveBg(el);
      if (bg.unknown) { unknown++; continue; }
      const cs = getComputedStyle(el);
      const fg0 = blend(toRGBA(cs.color), bg.color);
      const op = opacityOf(el);
      const fg = blend([fg0[0], fg0[1], fg0[2], op], bg.color);
      const ratio = contrast(fg, bg.color);
      const need = isLargeText(parseFloat(cs.fontSize), cs.fontWeight) ? 3 : 4.5;
      checked++;
      if (ratio + 0.005 >= need) continue;
      const key = sig(el);
      const g = groups.get(key) || { selector: key, fg: hex(fg), bg: hex(bg.color), ratio: +ratio.toFixed(2), need, count: 0,
        sample: (el.textContent || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 50) };
      g.count++;
      g.ratio = Math.min(g.ratio, +ratio.toFixed(2));
      groups.set(key, g);
    }
    const failures = [...groups.values()].sort((a, b) => b.count - a.count);
    return { pass: failures.length === 0, checked, unknown, failures };
  });
}

export async function focusGate(page, maxStops = 30) {
  await page.evaluate(() => {
    window.__rsShadow = new WeakMap();
    for (const el of allElements()) window.__rsShadow.set(el, getComputedStyle(el).boxShadow);
  });
  const stops = [];
  await page.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); window.scrollTo(0, 0); });
  for (let i = 0; i < maxStops; i++) {
    await page.keyboard.press('Tab');
    const s = await page.evaluate(() => {
      let a = document.activeElement;
      while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
      if (!a || a === document.body || a === document.documentElement) return null;
      const cs = getComputedStyle(a);
      const r = a.getBoundingClientRect();
      const behind = effectiveBg(up(a) || a);
      const bg = behind.unknown ? [255, 255, 255, 1] : behind.color;
      const oc = toRGBA(cs.outlineColor);
      const ow = parseFloat(cs.outlineWidth) || 0;
      const outlineRatio = oc ? contrast(blend(oc, bg), bg) : 0;
      const outlineOk = cs.outlineStyle !== 'none' && ow >= 2 && outlineRatio >= 3;
      const shadowOk = cs.boxShadow !== 'none' && cs.boxShadow !== window.__rsShadow.get(a);
      const visible = r.width >= 1 && r.height >= 1 && cs.visibility === 'visible';
      return { selector: sig(a), bg: hex(bg), outline: `${cs.outlineStyle} ${cs.outlineWidth} ${hex(oc || [0, 0, 0])}`,
        outlineRatio: +outlineRatio.toFixed(2), shadowOk, visible, ok: (outlineOk || shadowOk) && visible };
    });
    if (!s) break;
    stops.push(s);
  }
  const failures = stops.filter((s) => !s.ok);
  return { pass: stops.length > 0 && failures.length === 0, checked: stops.length, failures,
    note: stops.length === 0 ? 'no focusable elements reached' : undefined };
}

export async function phoneGate(page, width = 375) {
  return page.evaluate((width) => {
    const sw = document.scrollingElement.scrollWidth;
    const offenders = [];
    if (sw > width + 1) {
      const scrollsX = (e) => /^(auto|scroll|hidden|clip)$/.test(getComputedStyle(e).overflowX);
      for (const el of document.body.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.right <= width + 1 || r.width === 0) continue;
        let contained = false;
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (scrollsX(p)) { contained = true; break; }
        if (contained) continue;
        const parentR = el.parentElement.getBoundingClientRect();
        if (parentR.right > width + 1 && el.parentElement !== document.body) continue; // report the outermost
        offenders.push({ selector: sig(el), right: Math.round(r.right), width: Math.round(r.width) });
      }
      offenders.sort((a, b) => b.right - a.right);
    }
    return { pass: sw <= width + 1, scrollWidth: sw, viewport: width, failures: offenders.slice(0, 8) };
  }, width);
}

export async function collectLinks(page) {
  return page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => ({
    href: a.href, text: (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120), visible: isShown(a),
  })));
}

export function compareLinks(baseline, current) {
  const key = (l) => l.href + '\u0000' + l.text;
  const count = (list, pred = () => true) => {
    const m = new Map();
    for (const l of list) if (pred(l)) m.set(key(l), (m.get(key(l)) || 0) + 1);
    return m;
  };
  const before = count(baseline), after = count(current);
  const beforeVis = count(baseline, (l) => l.visible), afterVis = count(current, (l) => l.visible);
  const missing = [], hidden = [];
  for (const [k, n] of before) if ((after.get(k) || 0) < n) missing.push({ href: k.split('\u0000')[0], text: k.split('\u0000')[1], lost: n - (after.get(k) || 0) });
  for (const [k, n] of beforeVis) if ((afterVis.get(k) || 0) < n) hidden.push({ href: k.split('\u0000')[0], text: k.split('\u0000')[1], lost: n - (afterVis.get(k) || 0) });
  return { pass: missing.length === 0 && hidden.length === 0, original: baseline.length, present: current.length,
    originallyVisible: baseline.filter((l) => l.visible).length, failures: [...missing.map((m) => ({ ...m, why: 'missing' })), ...hidden.map((h) => ({ ...h, why: 'hidden' }))] };
}

export async function linksGate(page, baseline) {
  const current = await collectLinks(page);
  return compareLinks(baseline, current);
}

export async function motionGate(page) {
  return page.evaluate(() => {
    const secs = (v) => Math.max(0, ...v.split(',').map((x) => (x.trim().endsWith('ms') ? parseFloat(x) / 1000 : parseFloat(x)) || 0));
    const groups = new Map();
    for (const el of allElements()) {
      const cs = getComputedStyle(el);
      const t = secs(cs.transitionDuration), a = cs.animationName !== 'none' ? secs(cs.animationDuration) : 0;
      if (t > 0.01 || a > 0.01) groups.set(sig(el), { selector: sig(el), transition: t, animation: a });
    }
    const failures = [...groups.values()];
    return { pass: failures.length === 0, failures: failures.slice(0, 10) };
  });
}

// Run every gate against a reskinned HTML file. `shots` optionally captures after screenshots.
export async function runGates(browser, file, baselineLinks, shots = {}) {
  const gates = {};
  {
    const { context, page } = await openPage(browser, file);
    if (shots.after) await page.screenshot({ path: shots.after, type: 'jpeg', quality: 82 });
    var height = await page.evaluate(() => document.documentElement.scrollHeight);
    gates.contrast = await contrastGate(page);
    gates.links = await linksGate(page, baselineLinks);
    gates.focus = await focusGate(page);
    await context.close();
  }
  {
    const { context, page } = await openPage(browser, file, { viewport: { width: 375, height: 812 }, mobile: true });
    gates.phone = await phoneGate(page);
    if (shots.phone) await page.screenshot({ path: shots.phone, type: 'jpeg', quality: 82 });
    await context.close();
  }
  {
    const { context, page } = await openPage(browser, file, { reducedMotion: 'reduce' });
    gates.motion = await motionGate(page);
    await context.close();
  }
  const pass = Object.values(gates).every((g) => g.pass);
  return { pass, gates, height };
}

export function summarize(result) {
  return Object.entries(result.gates).map(([name, g]) => {
    const n = g.failures ? g.failures.length : 0;
    const detail = name === 'contrast' ? `${g.checked} text els` : name === 'focus' ? `${g.checked} tab stops`
      : name === 'phone' ? `scrollWidth ${g.scrollWidth}/${g.viewport}` : name === 'links' ? `${g.present}/${g.original} links` : '';
    return `${g.pass ? 'PASS' : 'FAIL'}  ${name.padEnd(8)} ${detail}${n ? `  (${n} issue${n > 1 ? 's' : ''})` : ''}`;
  }).join('\n');
}
