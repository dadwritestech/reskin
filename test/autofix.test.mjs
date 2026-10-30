import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autofixCss } from '../lib/generate.mjs';
import { loadStyle } from '../lib/style.mjs';

const win95 = loadStyle('win95');
const result = (gates) => ({ gates: { contrast: { failures: [] }, phone: { failures: [] }, links: { failures: [] }, focus: { failures: [] }, ...gates } });

test('focus autofix picks a ring colour that contrasts with the background behind the stop', () => {
  // win95 ink is black; on a navy title bar black fails, so the fix must not reuse it.
  const css = autofixCss(result({ focus: { failures: [{ selector: 'td > a', bg: '#000080' }] } }), win95);
  assert.match(css, /td > a:focus-visible \{ outline-color: (var\(--rs-on-accent\)|#fff)/);
  assert.doesNotMatch(css, /outline-color: var\(--rs-ink\)/);
});

test('contrast autofix gives a selector its own background when it was already patched once', () => {
  const fail = { contrast: { failures: [{ selector: 'p > a', bg: '#008080', need: 4.5 }] } };
  const first = autofixCss(result(fail), win95);
  assert.doesNotMatch(first, /background-color/);
  const second = autofixCss(result(fail), win95, first);
  assert.match(second, /html body p > a \{ color: var\(--rs-ink\) !important; background-color: var\(--rs-canvas\)/);
});

test('autofix rules are de-duplicated', () => {
  const f = { selector: 'span > a', bg: '#ffffff' };
  const css = autofixCss(result({ focus: { failures: [f, f, f] } }), win95);
  assert.equal(css.split('\n').length, 1);
});

test('focus autofix falls back to a two-tone ring when a stop keeps failing across backgrounds', () => {
  const fail = { focus: { failures: [{ selector: 'td > a', bg: '#000080' }] } };
  const first = autofixCss(result(fail), win95);
  const second = autofixCss(result(fail), win95, first);
  assert.match(second, /outline-color: #000 !important; outline-offset: 2px !important; box-shadow: 0 0 0 2px #fff/);
});
