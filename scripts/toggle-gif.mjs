// docs/toggle.gif: click the in-page toggle on shipped reskins and record the flip.
// node scripts/toggle-gif.mjs [pairDir ...]
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const dirs = process.argv.slice(2).length ? process.argv.slice(2)
  : ['gallery/pairs/news.ycombinator.com--linear', 'gallery/pairs/en.wikipedia.org-wiki-Typography-banner-none--stripe'];
const tmp = resolve('docs', '.frames');
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
const browser = await chromium.launch();
const list = [];
let n = 0;
const shot = async (page, hold) => {
  const f = join(tmp, `f${String(n++).padStart(3, '0')}.png`);
  await page.screenshot({ path: f });
  list.push(`file '${f.replace(/\\/g, '/')}'`, `duration ${hold}`);
};
try {
  for (const dir of dirs) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(pathToFileURL(resolve(dir, 'index.html')).href);
    await page.waitForTimeout(600);
    const btn = page.locator('#rs-toggle-host').locator('button');
    await page.evaluate(() => window.__reskin(false)); // start on the original
    await page.waitForTimeout(300);
    await shot(page, 1.4);
    await btn.hover();
    await shot(page, 0.4);
    await btn.click();
    await page.waitForTimeout(300);
    await shot(page, 2.2);
    await btn.click();
    await page.waitForTimeout(300);
    await shot(page, 0.9);
    await btn.click();
    await page.waitForTimeout(300);
    await shot(page, 1.8);
    await page.close();
  }
} finally {
  await browser.close();
}
list.push(list.at(-2)); // concat demuxer needs the last file repeated for its duration to count
writeFileSync(join(tmp, 'list.txt'), list.join('\n') + '\n');
const out = resolve('docs', 'toggle.gif');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(tmp, 'list.txt'),
  '-vf', 'fps=10,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
  out], { stdio: 'inherit' });
rmSync(tmp, { recursive: true, force: true });
console.log(`wrote ${out} (${n} frames)`);
