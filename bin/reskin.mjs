#!/usr/bin/env node
// reskin <url> --style <brand> [--out dir] [--refetch]
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { listStyles } from '../lib/style.mjs';
import { reskin, slugFor } from '../lib/reskin.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const bool = (name) => { const i = args.indexOf(name); return i >= 0 ? (args.splice(i, 1), true) : false; };

const style = flag('--style');
const out = flag('--out');
const refetch = bool('--refetch');
const url = args[0];
if (!url || !style || bool('--help')) {
  console.log(`usage: reskin <url> --style <brand> [--out dir] [--refetch]\nstyles: ${listStyles().join(', ')}`);
  process.exit(url || style ? 1 : 0);
}
if (!listStyles().includes(style) && !style.endsWith('.md')) {
  console.error(`unknown style "${style}". styles: ${listStyles().join(', ')}`);
  process.exit(1);
}

const outDir = resolve(out || join('out', `${slugFor(url)}--${style}`));
const browser = await chromium.launch();
try {
  const report = await reskin({ url, styleId: style, outDir, browser, refetch });
  process.exitCode = report.pass ? 0 : 2;
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
