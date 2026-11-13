// Post-build step: inline the built JS/CSS into a single self-contained HTML file
// so it can be opened directly from disk (file://) in any browser. ES-module
// scripts loaded from file:// are blocked by CORS in browsers, which is why the
// default Vite output shows a blank page when opened that way.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const htmlPath = join(dist, 'index.dev.html');
let html = readFileSync(htmlPath, 'utf8');

const assetDir = join(dist, 'assets');
const assets = readdirSync(assetDir);
const jsFiles = assets.filter((f) => f.endsWith('.js'));
const cssFiles = assets.filter((f) => f.endsWith('.css'));

if (jsFiles.length !== 1) {
  throw new Error(`Expected exactly one JS chunk for inlining, found: ${jsFiles.join(', ')}`);
}

for (const f of jsFiles) {
  let code = readFileSync(join(assetDir, f), 'utf8');
  // Prevent a literal "</script" inside the bundle from terminating the inline tag.
  code = code.replace(/<\/script/gi, '<\\/script');
  const pattern = new RegExp(`<script type="module"[^>]*src="\\./assets/${f}"[^>]*>\\s*</script>`);
  if (!pattern.test(html)) {
    throw new Error(`No script tag found referencing ./assets/${f}`);
  }
  html = html.replace(pattern, () => `<script type="module">\n${code}\n</script>`);
}

for (const f of cssFiles) {
  const css = readFileSync(join(assetDir, f), 'utf8');
  const pattern = new RegExp(`<link rel="stylesheet"[^>]*href="\\./assets/${f}"[^>]*>`);
  if (!pattern.test(html)) {
    throw new Error(`No stylesheet link found referencing ./assets/${f}`);
  }
  html = html.replace(pattern, () => `<style>\n${css}\n</style>`);
}

if (/src="\.\/assets\//.test(html) || /href="\.\/assets\//.test(html)) {
  throw new Error('Unresolved asset references remain after inlining');
}

writeFileSync(join(dist, 'index.html'), html);
writeFileSync(new URL('../index.html', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), html);
console.log(`Standalone index.html written (${(html.length / 1024 / 1024).toFixed(2)} MB, inlined ${jsFiles.length} JS + ${cssFiles.length} CSS)`);
