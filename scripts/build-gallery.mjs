// gallery/pairs/*/report.json -> gallery/index.html (static, no scripts beyond a slider).
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve('gallery');
const pairsDir = join(root, 'pairs');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const reports = readdirSync(pairsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('.') && existsSync(join(pairsDir, d.name, 'report.json')))
  .map((d) => ({ dir: d.name, ...JSON.parse(readFileSync(join(pairsDir, d.name, 'report.json'), 'utf8')) }));
const ORDER = ['news.ycombinator', 'wikipedia', 'craigslist', 'gov.uk', 'usa.gov', 'cern', 'cnn', 'npr', 'berkshire', 'w3.org'];
const rank = (r) => { const i = ORDER.findIndex((o) => r.dir.includes(o)); return i < 0 ? 99 : i; };
const shipped = reports.filter((r) => r.pass).sort((a, b) => rank(a) - rank(b));
const rejected = reports.filter((r) => !r.pass);

const badge = (name, g) => {
  const detail = {
    contrast: () => `${g.checked} text els`, focus: () => `${g.checked} stops`, phone: () => `${g.scrollWidth}/${g.viewport}px`,
    links: () => `${g.present}/${g.original}`, motion: () => 'reduced',
  }[name];
  return `<li class="${g.pass ? 'ok' : 'bad'}">${g.pass ? '✓' : '✗'} ${name} <span>${esc(detail ? detail() : '')}</span></li>`;
};
const card = (r) => {
  const host = new URL(r.url).hostname.replace(/^www\./, '');
  const how = r.history.find((h) => h.pass)?.step || r.history.at(-1).step;
  return `<article>
  <header><h2>${esc(host)} <em>${esc(r.styleTitle)}</em></h2>
  <a href="pairs/${r.dir}/index.html">open reskin</a> · <a href="${esc(r.url)}">original</a></header>
  <div class="pair">
    <figure><img loading="lazy" src="pairs/${r.dir}/before.jpg" alt="${esc(host)} as published"><figcaption>before</figcaption></figure>
    <figure><img loading="lazy" src="pairs/${r.dir}/after.jpg" alt="${esc(host)} reskinned ${esc(r.styleTitle)}"><figcaption>after</figcaption></figure>
  </div>
  <ul class="gates">${Object.entries(r.gates).map(([k, g]) => badge(k, g)).join('')}
  <li class="meta">passed at ${esc(how)}${r.autofixRules ? `, ${r.autofixRules} autofix rules` : ''}${r.density ? ` · height ×${r.density}` : ''}</li></ul>
</article>`;
};

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>reskin gallery</title>
<style>
:root { --bg:#fafaf9; --ink:#1c1917; --muted:#57534e; --line:#e7e5e4; --ok:#166534; --bad:#991b1b; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.55 system-ui, -apple-system, 'Segoe UI', sans-serif; }
main { max-width:1240px; margin:0 auto; padding:40px 24px 80px; }
h1 { font-size:40px; letter-spacing:-0.03em; margin:0 0 4px; }
.lede { color:var(--muted); max-width:70ch; margin:0 0 8px; }
.stats { font:13px ui-monospace, Consolas, monospace; color:var(--muted); margin:0 0 32px; }
article { border-top:1px solid var(--line); padding:28px 0; }
article header { display:flex; flex-wrap:wrap; align-items:baseline; gap:4px 12px; margin-bottom:12px; }
h2 { font-size:18px; margin:0; flex:1 1 auto; } h2 em { font-weight:400; color:var(--muted); font-style:normal; }
a { color:#1d4ed8; } a:focus-visible { outline:2px solid #1d4ed8; outline-offset:2px; }
.pair { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
figure { margin:0; } img { width:100%; height:auto; display:block; border:1px solid var(--line); border-radius:6px; background:#fff; }
figcaption { font:12px ui-monospace, Consolas, monospace; color:var(--muted); margin-top:4px; }
.gates { list-style:none; padding:0; margin:12px 0 0; display:flex; flex-wrap:wrap; gap:6px; font:12px ui-monospace, Consolas, monospace; }
.gates li { border:1px solid var(--line); border-radius:999px; padding:2px 10px; background:#fff; }
.gates .ok { color:var(--ok); } .gates .bad { color:var(--bad); } .gates span { color:var(--muted); } .gates .meta { border:0; color:var(--muted); background:none; }
.note { color:var(--muted); font-size:13px; border-top:1px solid var(--line); padding-top:20px; max-width:80ch; }
@media (max-width:720px) { .pair { grid-template-columns:1fr; } h1 { font-size:30px; } }
</style></head>
<body><main>
<h1>reskin</h1>
<p class="lede">Real public pages, content and links untouched, restyled by a local 12B model from a design-token markdown file.
Every "after" passed five lint gates before it was written: text contrast (WCAG AA), visible keyboard focus,
375px phone layout with no horizontal scroll, every original link still present, and reduced motion.</p>
<p class="stats">${shipped.length} shipped · ${rejected.length} rejected by the gates · model ${esc(reports[0]?.model || '')} · ${new Date().toISOString().slice(0, 10)}</p>
${shipped.map(card).join('\n')}
<div class="note">
${rejected.length ? `<p><strong>Rejected</strong> (gates still failing after 2 LLM attempts + 2 autofix rounds, so no output was written):
${rejected.map((r) => `${esc(new URL(r.url).hostname)} / ${esc(r.style)} (${Object.entries(r.gates).filter(([, g]) => !g.pass).map(([k]) => k).join(', ')})`).join('; ')}.</p>` : ''}
<p>"In the style of" means a reading of a public design language, not the brand itself: no logos, no brand assets, no affiliation with
or endorsement by any company named here or any site shown. Screenshots are of public pages, logged out, taken ${esc(reports[0]?.generatedAt?.slice(0, 10) || '')}.</p>
<p>Design reference text: <a href="https://github.com/VoltAgent/awesome-design-md">VoltAgent/awesome-design-md</a>; motion values from awesome-motion-md;
gate set after hallmark's accessibility floor.</p>
</div>
</main></body></html>
`;
writeFileSync(join(root, 'index.html'), html);
console.log(`gallery/index.html: ${shipped.length} shipped, ${rejected.length} rejected`);
