#!/usr/bin/env node
// Fills desktop/site with the web build the app runs: the game (golf.js,
// golf.wasm, golf.data), the in-app installer (install-worker.js, unshield,
// 7-Zip, Bink) and index.html, but none of the game's own files: those come
// from the player's disc image and no-CD golf.exe on first run, as on the web.
//
//   node scripts/prepare-site.mjs                  build/pages/site if it exists, else upstream
//   node scripts/prepare-site.mjs --from <dir>     a Pages build (tools/pages/build.sh)
//   node scripts/prepare-site.mjs --upstream       the published build (RichardAtCT/simgolf-web gh-pages)
//
// Google Fonts are swapped for bundled copies (@fontsource) so the app works
// offline.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(desktop, '..');
const out = path.join(desktop, 'site');
const UPSTREAM = 'https://github.com/RichardAtCT/simgolf-web';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

let from = value('--from');
let source;
if (!from && !flag('--upstream') && fs.existsSync(path.join(repo, 'build/pages/site/index.html'))) {
  from = path.join(repo, 'build/pages/site');
}
if (from) {
  from = path.resolve(from);
  source = `local build (${path.relative(repo, from) || from})`;
} else {
  from = fs.mkdtempSync(path.join(os.tmpdir(), 'simgolf-site-'));
  console.log(`Fetching the published web build from ${UPSTREAM} (gh-pages)…`);
  execFileSync('git', ['clone', '-q', '--depth', '1', '-b', 'gh-pages', UPSTREAM, from], {
    stdio: 'inherit', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  source = `${UPSTREAM} gh-pages ${execFileSync('git', ['-C', from, 'rev-parse', '--short', 'HEAD']).toString().trim()}`;
}

// The files tools/pages/build.sh puts in the site. Anything else is ignored.
const FILES = ['index.html', 'golf.js', 'golf.wasm', 'golf.data', 'autosave.js', 'report.js',
  'install-worker.js', 'jgld-nops.json', 'unshield.js', 'unshield.wasm', '7zz.umd.js', '7zz.wasm',
  'bink.js', 'bink.wasm', 'webm-muxer.js', 'og.png'];
const missing = FILES.filter((f) => !fs.existsSync(path.join(from, f)));
if (missing.length) throw new Error(`${from} is not a Pages build: missing ${missing.join(', ')}`);

// Never package game data. The Pages build preloads only the fonts into
// golf.data; a development build (build/web) also preloads the decompiled
// module images, which must not end up in the app.
const golfJs = fs.readFileSync(path.join(from, 'golf.js'), 'utf8');
const packaged = [...golfJs.matchAll(/"filename":\s*"([^"]+)"/g)].map((m) => m[1]);
const notFonts = packaged.filter((f) => !f.startsWith('/fonts/'));
if (!packaged.length) throw new Error("can't read golf.data's file list from golf.js");
if (notFonts.length) throw new Error(`golf.data holds more than fonts (${notFonts.slice(0, 5).join(', ')}): use a Pages build (tools/pages/build.sh), not build/web`);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
for (const f of FILES) {
  if (f !== 'index.html') fs.copyFileSync(path.join(from, f), path.join(out, f));
}

// Bundled fonts: the families, weights and subsets index.html asks Google for.
const FONTS = { 'baloo-2': [500, 700, 800], nunito: [500, 700, 800] };
let css = '/* Bundled from @fontsource (SIL Open Font License) by scripts/prepare-site.mjs */\n';
for (const [pkg, weights] of Object.entries(FONTS)) {
  const dir = path.join(desktop, 'node_modules/@fontsource', pkg);
  if (!fs.existsSync(dir)) throw new Error(`@fontsource/${pkg} is missing: run npm install first`);
  for (const w of weights) {
    for (const subset of ['latin-ext', 'latin']) {
      let block = fs.readFileSync(path.join(dir, `${subset}-${w}.css`), 'utf8');
      block = block.replace(/,\s*url\([^)]*\.woff\) format\('woff'\)/g, '');
      for (const [, file] of block.matchAll(/url\(\.\/files\/([^)]+\.woff2)\)/g)) {
        fs.copyFileSync(path.join(dir, 'files', file), path.join(out, 'fonts', file));
      }
      css += block.replace(/url\(\.\/files\//g, 'url(') + '\n';
    }
  }
  fs.copyFileSync(path.join(dir, 'LICENSE'), path.join(out, 'fonts', `LICENSE-${pkg}.txt`));
}
fs.writeFileSync(path.join(out, 'fonts/fonts.css'), css);

let html = fs.readFileSync(path.join(from, 'index.html'), 'utf8');
const googleFonts = /<link [^>]*(fonts\.googleapis\.com|fonts\.gstatic\.com)[^>]*>\s*/g;
if (!googleFonts.test(html)) console.warn('warning: index.html no longer links Google Fonts; check the fonts');
html = html.replace(googleFonts, '').replace('</title>', '</title>\n<link rel="stylesheet" href="fonts/fonts.css">');
html = html.replace(/<title>[^<]*<\/title>/, '<title>SimGolf</title>');
fs.writeFileSync(path.join(out, 'index.html'), html);

const build = (html.match(/data-build="([^"]*)"/) || [])[1] || 'unknown';
fs.writeFileSync(path.join(out, 'desktop-site.json'), JSON.stringify({ source, build, prepared: new Date().toISOString() }, null, 2) + '\n');
const size = fs.readdirSync(out).reduce((n, f) => n + (fs.statSync(path.join(out, f)).isFile() ? fs.statSync(path.join(out, f)).size : 0), 0);
console.log(`site ready: ${source}, build ${build}, ${(size / 1048576).toFixed(1)} MB in ${path.relative(repo, out)}`);
