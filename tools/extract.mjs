// Splits a single-file Rambunny build (RambunnyX.Y.html) into the pieces the
// TypeScript project is made of. Used by port.mjs, and runnable on its own:
//   node tools/extract.mjs <file.html> <outDir>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const lf = s => s.replace(/\r\n?/g, '\n');

// Drop the blank first/last lines around a block but keep its indentation, so
// the extracted text lines up with the HTML source line for line.
const trimBlock = s => s.replace(/^[ \t]*\n/, '').replace(/\n[ \t]*$/, '');

export function extractHtml(raw) {
  const html = lf(raw);

  // Every <style> block, in order. The 1.3 export has two: the host page's base
  // styles and the game's own stylesheet.
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => trimBlock(m[1]));
  if (!styles.length) throw new Error('no <style> blocks found');

  // The embedded character model.
  const mm = html.match(/<script[^>]*\bid=["']?mdata["']?[^>]*>([\s\S]*?)<\/script>/);
  if (!mm) throw new Error('no <script id="mdata"> model block found');
  const model = mm[1].trim();

  // The game code is the largest attribute-less <script>.
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (!scripts.length) throw new Error('no inline <script> found');
  const game = trimBlock(scripts.reduce((a, b) => (b.length > a.length ? b : a)));

  // Markup: from the innermost <body> to the first <script> after it.
  const bodies = [...html.matchAll(/<body[^>]*>/g)];
  if (!bodies.length) throw new Error('no <body> found');
  const b = bodies[bodies.length - 1], start = b.index + b[0].length, end = html.indexOf('<script', start);
  if (end < 0) throw new Error('no <script> after <body>');
  const markup = trimBlock(html.slice(start, end));

  // Head resources the page depends on (title, fonts, CDN scripts). Not merged
  // automatically: port.mjs only reports when these change.
  const heads = [...html.matchAll(/<head>([\s\S]*?)<\/head>/g)], head = heads.length ? heads[heads.length - 1][1] : '';
  const headLines = [
    ...[...head.matchAll(/<title>[\s\S]*?<\/title>/g)].map(m => m[0]),
    ...[...head.matchAll(/<link[^>]*>/g)].map(m => m[0]),
    ...[...html.matchAll(/<script[^>]*\bsrc=[^>]*><\/script>/g)].map(m => m[0])
  ];

  const css = styles.map((s, i) => `/* ==== style block ${i + 1} ==== */\n${s}`).join('\n\n');
  return { game: game + '\n', css: css + '\n', markup: markup + '\n', model, head: headLines.join('\n') + '\n' };
}

export function writeExtract(parts, dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'game.js'), parts.game);
  writeFileSync(join(dir, 'styles.css'), parts.css);
  writeFileSync(join(dir, 'markup.html'), parts.markup);
  writeFileSync(join(dir, 'head.html'), parts.head);
  writeFileSync(join(dir, 'model.json'), parts.model);
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const [src, out] = process.argv.slice(2);
  if (!src || !out) { console.error('usage: node tools/extract.mjs <file.html> <outDir>'); process.exit(1) }
  const parts = extractHtml(readFileSync(src, 'utf8'));
  writeExtract(parts, out);
  console.log(`extracted ${src} -> ${out} (game ${parts.game.split('\n').length} lines, model ${(parts.model.length / 1024).toFixed(0)} KB)`);
}
