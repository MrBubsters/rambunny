// Ports a single-file HTML build into this project:
//   npm run port -- <path/to/RambunnyX.Y.html>
//
// Regenerates src/game.ts, src/styles.css, src/markup.html and
// src/assets/bunny-model.json from the HTML, keeps the extracted sources in
// legacy/current (and the previous ones in legacy/previous for diffing), then
// type-checks the result.
import { readFileSync, writeFileSync, existsSync, rmSync, renameSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { extractHtml, writeExtract } from './extract.mjs';
import { toTs } from './to-ts.mjs';
import config from './port-config.mjs';

const src = process.argv[2];
if (!src) { console.error('usage: npm run port -- <path/to/RambunnyX.Y.html>'); process.exit(1) }

const parts = extractHtml(readFileSync(src, 'utf8'));
const { code, warnings, counts } = toTs(parts.game, config);

// Keep the last two extractions so `git diff --no-index legacy/previous legacy/current`
// shows exactly what changed between HTML versions.
const cur = 'legacy/current', prev = 'legacy/previous';
const oldHead = existsSync(join(cur, 'head.html')) ? readFileSync(join(cur, 'head.html'), 'utf8') : null;
if (existsSync(cur)) { rmSync(prev, { recursive: true, force: true }); renameSync(cur, prev) }
writeExtract(parts, cur);
writeFileSync(join(cur, 'VERSION.json'), JSON.stringify({ source: basename(src), ported: new Date().toISOString() }, null, 2) + '\n');

mkdirSync('src/assets', { recursive: true });
writeFileSync('src/game.ts', code);
writeFileSync('src/styles.css', parts.css);
writeFileSync('src/markup.html', parts.markup);
writeFileSync('src/assets/bunny-model.json', parts.model);

const ver = basename(src).match(/(\d+)\.(\d+)(?:\.(\d+))?/);
if (ver) {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  pkg.version = `${ver[1]}.${ver[2]}.${ver[3] || 0}`;
  writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
}

console.log(`ported ${basename(src)}: game ${parts.game.split('\n').length - 1} lines, model ${(parts.model.length / 1024).toFixed(0)} KB`);
console.log('transform edits:', Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', '));
if (oldHead !== null && oldHead !== parts.head) {
  warnings.push('the <head> resources changed (title, fonts or CDN scripts). Update index.html by hand. Old vs new:\n' + oldHead + '---\n' + parts.head);
}
for (const w of warnings) console.warn('WARNING:', w);

const git = ['git', 'C:\\Program Files\\Git\\cmd\\git.exe'].find(g => spawnSync(g, ['--version']).status === 0);
if (git && existsSync(prev)) {
  console.log('\nchanges since the previous port:');
  spawnSync(git, ['-c', 'core.autocrlf=false', 'diff', '--no-index', '--stat', '--', prev, cur], { stdio: 'inherit' });
}

console.log('\ntype-checking...');
const tsc = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], { stdio: 'inherit' });
if (tsc.status !== 0) {
  console.error('\nType errors above. Fix them with a type in src/types.ts, an entry in tools/port-config.mjs,');
  console.error('or a new rule in tools/to-ts.mjs, then run the port again. Never edit src/game.ts directly.');
  process.exit(1);
}
console.log('type-check passed. Run `npm run dev` and play a floor to confirm.');
