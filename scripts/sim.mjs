// Pacing simulation: serve dist/, run the game headless with ?sim=fast (10x
// game-time) + autopilot, capture '[SIM]' milestone lines, print a pacing report.
// Usage: node scripts/sim.mjs [virtualTimeBudgetMs]   (default 200000 ≈ 33 min game time)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const SHOTS = join(ROOT, 'progress', 'shots');
mkdirSync(SHOTS, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function serve(port) {
  const srv = http.createServer(async (req, res) => {
    let p = req.url.split('?')[0];
    if (p === '/') p = '/index.html';
    try {
      const data = await readFile(join(DIST, p));
      res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404); res.end('nf');
    }
  });
  return new Promise((r) => srv.listen(port, () => r(srv)));
}

const budget = process.argv[2] || '200000';
const port = 8942;
const srv = await serve(port);
const url = `http://127.0.0.1:${port}/?gl=1&shot=1&sim=fast`;

const args = [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--window-size=480,270', '--hide-scrollbars',
  '--use-gl=angle', '--use-angle=swiftshader',
  '--enable-unsafe-webgpu', '--enable-features=Vulkan',
  '--enable-unsafe-swiftshader',
  `--screenshot=${join(SHOTS, 'sim-final.png')}`,
  `--virtual-time-budget=${budget}`,
  '--enable-logging=stderr', '--v=0',
  url,
];

const t0 = Date.now();
const p = spawn('google-chrome', args, { stdio: ['ignore', 'pipe', 'pipe'] });
let err = '';
p.stderr.on('data', (d) => { err += d; });
const code = await new Promise((resolve) => {
  p.on('close', resolve);
  setTimeout(() => { p.kill(); resolve(-1); }, 20 * 60 * 1000); // real-time cap
});
srv.close();

const lines = err.split('\n');
const simLines = [];
const errors = [];
for (const l of lines) {
  if (!/CONSOLE/i.test(l)) continue;
  const m = l.match(/CONSOLE[^"]*"?(.*)$/);
  const text = (m ? m[1] : l).replace(/",?\s*source:.*$/, '').trim();
  if (text.includes('[SIM]')) simLines.push(text.slice(text.indexOf('[SIM]')));
  else if (/uncaught|TypeError|ReferenceError/i.test(text)) errors.push(text.slice(0, 160));
}

console.log(`--- sim run (exit ${code}, ${((Date.now() - t0) / 1000).toFixed(0)}s real, budget ${budget}ms virtual)`);
for (const l of simLines) console.log(l);
if (errors.length) {
  console.log('--- page errors:');
  for (const e of errors.slice(0, 8)) console.log('   ', e);
}

// pacing summary
const events = [];
for (const l of simLines) {
  try { events.push(JSON.parse(l.slice(5))); } catch { /* partial line */ }
}
const mark = (what) => events.find((e) => e.what === what);
const result = mark('result');
const stages = events.filter((e) => e.what === 'stage');
console.log('--- pacing summary (game-time)');
for (const w of ['firstKill', 'firstConvert', 'allWomen']) {
  const e = mark(w);
  if (e) console.log(`   ${w.padEnd(13)} ${(e.t / 60).toFixed(1)} min`);
}
for (const s of stages) console.log(`   stage ${s.stage}       ${(s.t / 60).toFixed(1)} min`);
if (result) {
  console.log(`   OUTCOME: ${result.over} at ${(result.t / 60).toFixed(1)} min ` +
    `(horde ${result.horde}, peak ${result.hordePeak}, women ${result.women}, dead ${result.dead}, teleports ${result.teleports})`);
} else {
  const last = events.filter((e) => e.what === 'status').pop();
  console.log(`   no outcome within budget` + (last ? ` — last status at ${(last.t / 60).toFixed(1)} min: ${JSON.stringify(last)}` : ''));
}
process.exit(errors.length ? 1 : 0);
