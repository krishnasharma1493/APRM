// check_contrast.mjs: WCAG contrast of every colour pair in web/css/tokens.css (K-43, warm palette).
// Run: node tests/web/check_contrast.mjs
// Text pairs need 4.5:1, UI pairs (control outlines, focus ring, job and chart colours) need 3:1.
// Stone is allowed only for marks, so it is checked at 3:1 and never as text.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '..', '..', 'web', 'css', 'tokens.css'), 'utf8');

/* The variables declared in the first block whose selector is exactly `selector`. */
function vars(selector) {
  const start = css.indexOf(selector + ' {');
  assert.ok(start >= 0, 'block not found: ' + selector);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start));
  const out = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\b/g)) out[m[1]] = m[2];
  return out;
}

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// Dark is the default set (the bare :root block); warm paper overrides it under data-theme="light".
const dark = vars(':root');
const light = vars(':root[data-theme="light"]');
const modes = { dark: dark, light: { ...dark, ...light } };

const TEXT = [['text', 'bg'], ['text', 'surface'], ['text', 'raised'], ['muted', 'bg'], ['muted', 'surface'], ['muted', 'raised'],
  ['amber-ink', 'bg'], ['amber-ink', 'surface'], ['amber-ink', 'amber-soft'],
  ['on-amber', 'amber'], ['on-amber', 'amber-hover'], ['on-amber', 'amber-pressed'],
  ['text', 'amber-soft'], ['sand', 'surface'], ['sand', 'sand-soft'], ['sage', 'bg'], ['sage', 'surface'], ['sage', 'sage-soft'],
  ['error', 'bg'], ['error', 'surface'], ['error', 'error-soft'], ['text', 'stripe']];
// Non-text (WCAG 1.4.11): control outlines, the focus ring (amber-ink in light, amber in dark), chart marks.
const UI = [['control-border', 'bg'], ['control-border', 'surface'], ['control-border', 'raised'],
  ['amber-ink', 'raised'], ['stone', 'surface']];
for (let i = 0; i < 10; i++) { UI.push(['job-' + i, 'surface']); UI.push(['job-' + i, 'bg']); }
for (let i = 0; i < 6; i++) UI.push(['series-' + i, 'surface']);

let failed = 0, checked = 0;
for (const [mode, v] of Object.entries(modes)) {
  for (const [group, pairs, min] of [['text', TEXT, 4.5], ['ui', UI, 3]]) {
    for (const [fg, bg] of pairs) {
      assert.ok(v[fg] && v[bg], `${mode}: missing variable ${fg} or ${bg}`);
      const r = ratio(v[fg], v[bg]);
      checked++;
      if (r < min) { failed++; console.error(`FAIL ${mode} ${group} ${fg} on ${bg}: ${r.toFixed(2)} < ${min}`); }
    }
  }
}
assert.equal(failed, 0, failed + ' contrast pairs below the minimum');
// The light set may only override names the dark default defines (no light-only variable).
for (const k of Object.keys(light)) assert.ok(k in dark, 'light-only variable: ' + k);
console.log('contrast: ' + checked + ' pairs checked, all pass');
