// Fetch a live page logged out and freeze it into a script-free, self-describing HTML snapshot.
import { COLOR_SRC } from './color.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';

// Runs inside the live page. Marks what the original CSS hid, absolutises URLs, records
// links + a selector outline for the LLM, then strips scripts and parks the original CSS.
function freeze() {
  const isShown = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width >= 2 && r.height >= 2 && cs.visibility === 'visible' && parseFloat(cs.opacity) > 0.05;
  };
  const height = document.documentElement.scrollHeight;
  // 1. Visibility as the original CSS decided it, so dropping that CSS hides the same things.
  for (const el of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') { el.setAttribute('data-rs-hide', ''); continue; }
    const r = el.getBoundingClientRect();
    const tiny = r.width <= 2 && r.height <= 2 && cs.position === 'absolute' && el.textContent.trim();
    const offscreen = r.right < -500 || r.left < -2000 || r.top < -2000;
    if (tiny || (offscreen && cs.position !== 'static')) el.setAttribute('data-rs-sr', '');
  }
  // 1b. Text-less icons drawn by CSS backgrounds (HN's vote arrows, sprites). Dropping the original
  //     CSS would make the links around them vanish, so keep the site's own icon image and box.
  const icons = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (el.hasAttribute('data-rs-hide') || el.closest('[data-rs-hide]') || el.textContent.trim()) continue;
    const cs = getComputedStyle(el);
    if (!/url\(/.test(cs.backgroundImage)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.width > 96 || r.height > 96) continue;
    el.setAttribute('data-rs-icon', String(icons.length));
    icons.push({ w: Math.round(r.width), h: Math.round(r.height), image: cs.backgroundImage, size: cs.backgroundSize,
      position: cs.backgroundPosition, repeat: cs.backgroundRepeat, display: cs.display === 'inline' ? 'inline-block' : cs.display });
  }
  // 1c. Images sized by the original CSS keep that size (else a wordmark balloons to full width).
  for (const img of document.body.querySelectorAll('img, svg')) {
    if (img.closest('[data-rs-hide]') || img.parentElement?.closest('svg')) continue;
    const r = img.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    img.setAttribute('width', String(Math.round(r.width)));
    img.setAttribute('height', String(Math.round(r.height)));
  }
  // 1d. Buttons whose label the original CSS hid (icon-only): don't paint them as accent pills.
  for (const b of document.body.querySelectorAll('button, [role=button], input[type=button], input[type=submit]')) {
    const label = b.localName === 'input' ? b.value : b.innerText;
    if (!b.closest('[data-rs-hide]') && !(label || '').trim()) b.setAttribute('data-rs-bare', '');
  }
  // 2. Links, as a user sees them at this viewport.
  //    Visibility is read now (original CSS); href/text are read after stripping, so the baseline
  //    matches what the snapshot really contains (noscript text gone, javascript: hrefs neutered).
  const shownAtFetch = new Map([...document.querySelectorAll('a[href]')].map((a) => [a, !a.closest('[data-rs-hide],[data-rs-sr]') && isShown(a)]));
  //    A visible link whose own text was CSS-hidden (drawn by ::before instead, e.g. Wikipedia's ↑
  //    backlinks) would go blank without that CSS: keep its real text showing.
  for (const [a, shown] of shownAtFetch) {
    if (!shown || !a.textContent.trim()) continue;
    const textShown = [...a.querySelectorAll('*')].some((e) => !e.closest('[data-rs-hide]') && e.textContent.trim())
      || [...a.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!textShown) a.querySelectorAll('[data-rs-hide]').forEach((e) => e.removeAttribute('data-rs-hide'));
  }
  // 3. Outline for the LLM: the most common visible selectors with a text sample.
  const counts = new Map();
  for (const el of document.body.querySelectorAll('*')) {
    if (el.closest('[data-rs-hide]') || /^(script|style|svg|path|g|br|wbr|noscript)$/.test(el.localName) || el.closest('svg')) continue;
    const cls = [...el.classList].filter((c) => /^[A-Za-z_][\w-]*$/.test(c)).slice(0, 2);
    const key = el.localName + (cls.length ? '.' + cls.join('.') : '');
    const e = counts.get(key) || { selector: key, count: 0, sample: '' };
    e.count++;
    if (!e.sample) {
      const t = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').trim().replace(/\s+/g, ' ');
      if (t) e.sample = t.slice(0, 40);
    }
    counts.set(key, e);
  }
  const ids = [...document.body.querySelectorAll('[id]')]
    .filter((el) => !el.closest('[data-rs-hide]') && /^[A-Za-z][\w-]*$/.test(el.id))
    .map((el) => ({ id: el.id, tag: el.localName, area: el.getBoundingClientRect().width * el.getBoundingClientRect().height }))
    .filter((x) => x.area > 20000).sort((a, b) => b.area - a.area).slice(0, 12).map((x) => `${x.tag}#${x.id}`);
  // Compact skeleton: visible tags/classes, repeated siblings folded, so the LLM sees structure.
  const SKIP_TAG = /^(script|style|svg|br|wbr|noscript|link|meta|img|path|option|b|i|em|strong|font|span)$/;
  const label = (el) => {
    const cls = [...el.classList].filter((c) => /^[A-Za-z_][\w-]*$/.test(c)).slice(0, 2);
    return el.localName + (el.id && /^[A-Za-z][\w-]*$/.test(el.id) && el.id.length < 24 ? '#' + el.id : '') + (cls.length ? '.' + cls.join('.') : '');
  };
  const skel = [];
  const walk = (el, depth) => {
    if (skel.length > 90 || depth > 14) return;
    const kids = [...el.children].filter((c) => !c.hasAttribute('data-rs-hide') && !(SKIP_TAG.test(c.localName) && !c.classList.length));
    const seen = new Map(); // repeated siblings (any period, e.g. HN's row triples) print once with a count
    for (const k of kids) {
      const bare = (e) => label(e).replace(/#[\w-]*\d[\w-]*/, ''); // fold generated ids (up_50296470), keep #bigbox
      const lab = bare(k) + '|' + [...k.children].slice(0, 6).map(bare).join(',');
      if (seen.has(lab)) { seen.get(lab).count++; continue; }
      if (skel.length > 90) { skel.push('  '.repeat(depth) + '...'); break; }
      seen.set(lab, { idx: skel.length, count: 1 });
      skel.push('  '.repeat(depth) + label(k));
      walk(k, depth + 1);
    }
    for (const { idx, count } of seen.values()) if (count > 1) skel[idx] += `  (x${count})`;
  };
  walk(document.body, 0);
  const outline = { title: document.title, compatMode: document.compatMode, ids, skeleton: skel.join('\n'),
    selectors: [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 45) };
  // 4. Absolute URLs everywhere, so the snapshot works from file://.
  for (const a of document.querySelectorAll('a[href], area[href]')) a.setAttribute('href', a.href);
  for (const el of document.querySelectorAll('img[src], source[src], video[src], audio[src], iframe[src], input[src]')) el.setAttribute('src', el.src);
  for (const f of document.querySelectorAll('form[action]')) f.setAttribute('action', f.action);
  for (const el of document.querySelectorAll('[srcset]')) {
    el.setAttribute('srcset', el.getAttribute('srcset').split(',').map((part) => {
      const [u, ...d] = part.trim().split(/\s+/);
      try { return [new URL(u, document.baseURI).href, ...d].join(' '); } catch { return part; }
    }).join(', '));
  }
  for (const l of document.querySelectorAll('link[href]')) l.setAttribute('href', l.href);
  for (const img of document.querySelectorAll('img[loading=lazy]')) img.removeAttribute('loading');
  // 5. Strip behaviour; keep content. Park the original CSS so the toggle can bring it back.
  document.querySelectorAll('script, noscript, base, meta[http-equiv], link[rel=preload], link[rel=modulepreload], link[rel=prefetch]').forEach((e) => e.remove());
  for (const el of document.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
  }
  // Absolute, so the link resolves to the same href from file:// as the baseline recorded.
  const here = location.href.split('#')[0] + '#';
  for (const a of document.querySelectorAll('a[href^="javascript:"]')) a.setAttribute('href', here);
  const links = [...document.querySelectorAll('a[href]')].map((a) => ({
    href: a.href, text: (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120), visible: !!shownAtFetch.get(a),
  }));
  for (const s of document.querySelectorAll('link[rel~=stylesheet], style')) {
    s.setAttribute('data-rs-orig', '');
    s.setAttribute('data-rs-media', s.getAttribute('media') || 'all');
    s.setAttribute('media', 'not all');
  }
  for (const el of document.querySelectorAll('[style]')) {
    el.setAttribute('data-rs-style', el.getAttribute('style'));
    el.removeAttribute('style');
  }
  document.querySelectorAll('meta[charset], meta[name=viewport]').forEach((m) => m.remove());
  const doctype = document.compatMode === 'CSS1Compat' ? '<!DOCTYPE html>\n' : '';
  return { html: doctype + document.documentElement.outerHTML, links, outline, icons, height };
}

export async function snapshot(browser, url, { beforeShot } = {}) {
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 800 }, locale: 'en-US', deviceScaleFactor: 1 });
  const page = await context.newPage();
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (!resp || resp.status() >= 400) throw new Error(`fetch ${url}: HTTP ${resp ? resp.status() : 'no response'}`);
    await page.waitForLoadState('load', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);
    // Nudge lazy content into existence, then come back up for the "before" shot.
    await page.evaluate(async () => { for (let y = 0; y < Math.min(document.body.scrollHeight, 6000); y += 800) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } scrollTo(0, 0); });
    await page.waitForTimeout(300);
    if (beforeShot) await page.screenshot({ path: beforeShot, type: 'jpeg', quality: 82 });
    const finalUrl = page.url();
    const out = await page.evaluate(freeze);
    return { ...out, url, finalUrl };
  } finally {
    await context.close();
  }
}

export { COLOR_SRC };
