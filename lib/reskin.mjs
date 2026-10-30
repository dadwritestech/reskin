// Orchestration: snapshot -> LLM CSS -> gates -> (feedback | autofix) -> output only if every gate passes.
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadStyle, baseCss, floorCss } from './style.mjs';
import { snapshot } from './snapshot.mjs';
import { chat, MODEL } from './llm.mjs';
import { buildPrompt, extractCss, sanitizeCss, gateFeedback, autofixCss, assemble, iconCss } from './generate.mjs';
import { runGates, summarize } from './gates.mjs';

export const slugFor = (url) => {
  const u = new URL(url);
  return (u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/+$/, '') + (u.search ? '-' + u.search.slice(1) : ''))
    .replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').slice(0, 80);
};

const issueCount = (r) => Object.values(r.gates).reduce((n, g) => n + (g.failures ? g.failures.length : 0) + (g.pass ? 0 : 1), 0);

export async function reskin({ url, styleId, outDir, browser, refetch = false, attempts = 2, fixRounds = 2, log = console.log }) {
  const style = loadStyle(styleId);
  mkdirSync(outDir, { recursive: true });
  const cacheDir = join(outDir, '..', '.llm-cache');
  // One snapshot per site, shared by every style.
  const snapDir = join(outDir, '..', '.snapshots');
  mkdirSync(snapDir, { recursive: true });
  const snapFile = join(snapDir, `${slugFor(url)}.json`), beforeFile = join(snapDir, `${slugFor(url)}.jpg`);
  let snap;
  if (!refetch && existsSync(snapFile)) {
    snap = JSON.parse(readFileSync(snapFile, 'utf8'));
    log(`snapshot  cached (${snap.links.length} links)`);
  } else {
    log(`fetch     ${url} (logged out, fresh context)`);
    snap = await snapshot(browser, url, { beforeShot: beforeFile });
    writeFileSync(snapFile, JSON.stringify(snap));
    log(`snapshot  ${snap.links.length} links, ${snap.outline.selectors.length} selectors, ${(snap.html.length / 1024).toFixed(0)} KB`);
  }

  copyFileSync(beforeFile, join(outDir, 'before.jpg'));
  const base = `${baseCss(style)}
/* site icons, kept from the original */
${iconCss(snap.icons)}`, floor = floorCss();
  const candidate = join(outDir, '.candidate.html');
  const shots = { after: join(outDir, 'after.jpg'), phone: join(outDir, 'phone.jpg') };
  const history = [];
  const messages = buildPrompt(style, snap);
  let best = null;

  for (let a = 1; a <= attempts; a++) {
    const res = await chat(messages, { cacheDir });
    const raw = extractCss(res.content);
    const { css, dropped } = sanitizeCss(raw);
    writeFileSync(join(outDir, `llm-${a}.css`), css);
    writeFileSync(candidate, assemble(snap.html, style, { base, llm: css, floor }));
    const g = await runGates(browser, candidate, snap.links, shots);
    log(`llm #${a}    ${res.cached ? 'cached' : `${(res.ms / 1000).toFixed(0)}s, ${res.usage?.completion_tokens} tok`}, ${dropped.length} decl dropped by sanitizer`);
    log(summarize(g).replace(/^/gm, '          '));
    history.push({ step: `llm-${a}`, pass: g.pass, issues: issueCount(g), dropped, ms: res.ms, cached: !!res.cached, finish: res.finish, gates: g.gates });
    if (!best || issueCount(g) < issueCount(best.g)) best = { g, css };
    if (g.pass) break;
    if (a < attempts) messages.push({ role: 'assistant', content: res.content }, { role: 'user', content: gateFeedback(g) });
  }

  let fix = '';
  for (let r = 1; !best.g.pass && r <= fixRounds; r++) {
    fix += `\n${autofixCss(best.g, style, fix)}`;
    writeFileSync(candidate, assemble(snap.html, style, { base, llm: best.css, floor, fix }));
    best.g = await runGates(browser, candidate, snap.links, shots);
    log(`autofix ${r} ${fix.trim().split('\n').length} rules`);
    log(summarize(best.g).replace(/^/gm, '          '));
    history.push({ step: `autofix-${r}`, pass: best.g.pass, issues: issueCount(best.g), gates: best.g.gates });
  }
  if (!best.g.pass) {
    // Rebuild the best candidate (autofix may have been the last thing written).
    writeFileSync(candidate, assemble(snap.html, style, { base, llm: best.css, floor, fix }));
  }
  writeFileSync(join(outDir, 'autofix.css'), fix.trim());

  const report = {
    url, finalUrl: snap.finalUrl, title: snap.outline.title, style: style.id, styleTitle: style.tokens.title,
    model: MODEL, pass: best.g.pass, generatedAt: new Date().toISOString(),
    density: snap.height ? +(best.g.height / snap.height).toFixed(2) : null,
    autofixRules: fix.trim() ? fix.trim().split('\n').length : 0,
    links: { original: snap.links.length, visible: snap.links.filter((l) => l.visible).length },
    gates: best.g.gates, history,
  };
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 1));
  const final = join(outDir, 'index.html'), rejected = join(outDir, 'rejected.html');
  rmSync(final, { force: true }); rmSync(rejected, { force: true });
  if (best.g.pass) {
    renameSync(candidate, final);
    log(`ok        ${final}`);
  } else {
    renameSync(candidate, rejected);
    for (const f of Object.values(shots)) rmSync(f, { force: true });
    log(`REJECTED  gates still failing; nothing shipped (debug copy: ${rejected})`);
  }
  return report;
}
