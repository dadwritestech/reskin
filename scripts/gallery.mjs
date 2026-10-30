// Build the before/after gallery: each site x two styles, one at a time (the LLM server is shared).
// node scripts/gallery.mjs [--only <slug-substring>]
import { join, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { reskin, slugFor } from '../lib/reskin.mjs';

export const PAIRS = [
  ['https://news.ycombinator.com/', ['linear', 'win95']],
  ['https://en.wikipedia.org/wiki/Typography?banner=none', ['stripe', 'teenage-engineering']],
  ['https://sfbay.craigslist.org/', ['apple', 'vercel']],
  ['https://www.gov.uk/browse/driving', ['linear', 'apple']],
  ['https://www.usa.gov/', ['vercel', 'win95']],
  ['https://info.cern.ch/hypertext/WWW/TheProject.html', ['stripe', 'linear']],
  ['https://lite.cnn.com/', ['apple', 'teenage-engineering']],
  ['https://text.npr.org/', ['stripe', 'vercel']],
  ['https://www.berkshirehathaway.com/', ['win95', 'linear']],
  ['https://www.w3.org/Provider/Style/URI', ['teenage-engineering', 'stripe']],
];

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const root = resolve('gallery', 'pairs');
const browser = await chromium.launch();
const results = [];
try {
  for (const [url, styles] of PAIRS) for (const style of styles) {
    const slug = `${slugFor(url)}--${style}`;
    if (only && !only.split(',').some((o) => slug.includes(o))) continue;
    console.log(`\n=== ${slug}`);
    const t = Date.now();
    try {
      const r = await reskin({ url, styleId: style, outDir: join(root, slug), browser });
      results.push({ slug, pass: r.pass, s: Math.round((Date.now() - t) / 1000) });
    } catch (e) {
      console.log(`error     ${e.message}`);
      results.push({ slug, pass: false, error: e.message });
      if (/stalled/.test(e.message)) break; // shared server: report, never hammer or restart
    }
  }
} finally {
  await browser.close();
}
console.log('\n' + results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.slug}${r.error ? '  ' + r.error : ''}`).join('\n'));
writeFileSync(join(root, '..', 'run.json'), JSON.stringify(results, null, 1));
