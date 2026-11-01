// build.mjs: builds the website into one file that opens from file:// with no network (K-49, D77).
//
// Idea: browsers refuse to load ES modules and to fetch files from a page opened with file://, so
// the demo copy must carry everything inside itself. This script reads web/index.html and writes
// web/dist/index.html with every stylesheet and every local script copied inline, in the same order,
// plus the chart library from node_modules just before compare.js. Nothing is rewritten or minified:
// the built page runs exactly the source code. No eval; Node standard library only.
//
// Usage: node build.mjs (or `make web`). Needs web/vendor/aprm.js (`make wasm`) and `npm ci`.
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, 'dist');

/* Text that is safe inside an inline <script> or <style>. A literal "</script" or "</style" would end
 * the element early: it becomes "<\/script", which means the same characters inside JavaScript strings
 * and regular expressions. "<!--" can switch the HTML parser into a different mode, and no safe rewrite
 * exists for every place it could appear, so the build refuses such a file instead of guessing. */
function inlineSafe(text, name) {
  if (text.includes('<!--')) { throw new Error(name + ' contains "<!--", which is not safe to inline'); }
  return text.replace(/<\/(script|style)/gi, '<\\/$1');
}

/* The contents of a file under web/, or a clear error naming what to run. */
function readWeb(rel, hint) {
  const path = resolve(here, rel);
  if (!path.startsWith(here + sep)) { throw new Error('refusing a path outside web/: ' + rel); }
  if (!existsSync(path) || statSync(path).size === 0) { throw new Error('missing ' + rel + (hint ? ' (' + hint + ')' : '')); }
  return readFileSync(path, 'utf8');
}

/* Build the single-file page from index.html. Returns the HTML text. O(size of all inputs). */
export function build() {
  let html = readWeb('index.html');
  const chart = readWeb(join('node_modules', 'chart.js', 'dist', 'chart.umd.min.js'), 'run npm ci in web/');
  let scripts = 0, styles = 0;

  html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, href) => {
    styles++;
    return '<style>\n' + inlineSafe(readWeb(href), href) + '\n</style>';
  });

  html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
    if (/^https?:/.test(src)) { throw new Error('external script in index.html: ' + src); }
    scripts++;
    const hint = src === 'vendor/aprm.js' ? 'run make wasm' : '';
    let out = '<script>\n' + inlineSafe(readWeb(src, hint), src) + '\n</script>';
    if (src === 'js/compare.js') {
      // The chart library goes first, so compare.js finds window.Chart and never asks the network.
      out = '<script>\n' + inlineSafe(chart, 'chart.umd.min.js') + '\n</script>\n  ' + out;
    }
    return out;
  });

  if (/<script\s[^>]*src=/.test(html) || /<link\s[^>]*rel="stylesheet"/.test(html)) {
    throw new Error('a script or stylesheet was left as a reference; the build would need the network or other files');
  }
  return { html, scripts, styles };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { html, scripts, styles } = build();
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, 'index.html'), html);
    console.log('built web/dist/index.html (' + scripts + ' scripts, ' + styles + ' stylesheets, chart library bundled, ' + Math.round(html.length / 1024) + ' KB)');
  } catch (e) {
    console.error('web build failed: ' + e.message);
    process.exit(1);
  }
}
