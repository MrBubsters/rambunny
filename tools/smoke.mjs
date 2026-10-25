// Headless smoke test: loads a build in Chrome/Edge, starts a run, skips the
// tutorial, then moves, jumps, dashes and fires for a few seconds. Fails if the
// page throws. Works on the original HTML too, for side-by-side comparison.
//   node tools/smoke.mjs [file-or-url] [--shot out.png] [--seconds 12]
// Default target: dist/index.html (run `npm run build` first).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null };
const shot = opt('--shot'), secs = +(opt('--seconds') || 12), target = args[0] || 'dist/index.html';
const url = /^https?:/.test(target) ? target : pathToFileURL(resolve(target)).href;

const browsers = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'
];
const exe = process.env.CHROME || browsers.find(existsSync);
if (!exe) { console.error('no Chrome/Edge found; set CHROME=<path>'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'rb-smoke-')), port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });

let ws, id = 0; const pending = new Map(), errors = [], logs = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) });
const evaluate = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;

async function key(code, keyName, vk, ms = 60) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: keyName, windowsVirtualKeyCode: vk });
  await sleep(ms);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: keyName, windowsVirtualKeyCode: vk });
}

try {
  let tabs;
  for (let t = 0; t < 50 && !tabs; t++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json() } catch { await sleep(200) } }
  if (!tabs) throw new Error('browser did not start');
  ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result) }
    else if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; errors.push(`${d.exception?.description || d.text} @${d.url || ''}:${d.lineNumber}`) }
    else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' '));
  });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url });
  await sleep(5000);

  const loaded = await evaluate("!!document.querySelector('canvas') && !!document.getElementById('ov')");
  if (!loaded) throw new Error('game did not render a canvas and menu');
  await evaluate("document.getElementById('ov').click()");
  await sleep(1500);
  await key('KeyN', 'n', 78);                                   // skip the tutorial: floor 1 with enemies
  await sleep(1500);

  const t0 = Date.now();
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
  while (Date.now() - t0 < secs * 1000) {
    await key('Space', ' ', 32);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 800, y: 450, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 800, y: 450, button: 'left', clickCount: 1 });
    if (Math.random() < .3) await key('ShiftLeft', 'Shift', 16);
    if (Math.random() < .2) await key('KeyD', 'd', 68, 300);
    await sleep(350);
  }
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });

  const hud = await evaluate("({ floor: document.getElementById('fl').textContent, hp: document.getElementById('hpn').textContent, score: document.getElementById('sc').textContent, hostiles: document.getElementById('en').textContent, msg: document.getElementById('msg').textContent, fps: document.getElementById('fps').textContent, ammo: document.getElementById('am').textContent })");
  console.log('HUD after play:', JSON.stringify(hud));
  if (shot) { const img = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(shot, Buffer.from(img.data, 'base64')); console.log('screenshot:', shot) }
} catch (e) { errors.push('harness: ' + e.message) }
finally { try { ws && ws.close() } catch { } chrome.kill(); await sleep(500); try { rmSync(profile, { recursive: true, force: true }) } catch { } }

for (const l of logs) console.log(l);
if (errors.length) { console.error(`FAILED: ${errors.length} error(s)`); for (const e of errors) console.error('  ' + e); process.exit(1) }
console.log('PASSED: no runtime errors');
