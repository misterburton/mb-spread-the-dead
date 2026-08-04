// CPU perf harness: serve dist/, run the built game for 20s wall-clock in
// headless Chrome (SwiftShader WebGL2, 1280x720 desktop viewport), collect the
// window.__perf summary the page logs (?perf=1), report frame p50/p95 and
// per-system ms/frame against the CPU budgets:
//   - total update (excl. render) p95 < 8ms   (60fps with headroom)
//   - AI thinks aggregate avg    < 2ms/frame
//
// Usage: node scripts/perf.mjs [url]
//
// NOTE: real time, NOT --virtual-time-budget — virtual time virtualizes
// performance.now(), which would zero out the CPU timings being measured.
// Exit 0 when within budget, 1 when over or on failure.
import { spawn } from 'node:child_process';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const BUDGET = { updateP95: 8, thinkAvg: 2 }; // ms
const SAMPLE_SEC = 20;
const TIMEOUT_MS = 120000;

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

function run(url) {
  const args = [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--window-size=1280,720', '--hide-scrollbars',
    '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-webgpu', '--enable-features=Vulkan',
    '--enable-unsafe-swiftshader',
    '--enable-logging=stderr', '--v=0',
    url,
  ];
  return new Promise((resolve) => {
    const p = spawn('google-chrome', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    let summary = null;
    p.stderr.on('data', (d) => {
      err += d;
      // console lines look like: [..:INFO:CONSOLE(123)] "[perf] {...}", source: ..
      for (const line of d.toString().split('\n')) {
        if (!/CONSOLE/.test(line) || !line.includes('[perf]')) continue;
        const s = line.indexOf('{');
        const e = line.lastIndexOf('}');
        if (s >= 0 && e > s) {
          try { summary = JSON.parse(line.slice(s, e + 1)); } catch { /* partial line */ }
        }
      }
      if (summary) { p.kill(); resolve({ summary, err }); }
    });
    p.on('close', () => resolve({ summary, err }));
    setTimeout(() => { p.kill(); resolve({ summary, err, timedOut: true }); }, TIMEOUT_MS);
  });
}

const port = 8937;
const srv = await serve(port);
const target = process.argv[2] || `http://127.0.0.1:${port}/?gl=1&shot=1&start=street&perf=1`;

console.log(`[perf] loading ${target}`);
console.log(`[perf] sampling ${SAMPLE_SEC}s wall-clock @ 1280x720 (SwiftShader WebGL2)...`);
const { summary, err, timedOut } = await run(target);
srv.close();

if (!summary) {
  console.error('[perf] FAIL: no summary received' + (timedOut ? ' (timeout)' : ''));
  const logs = err.split('\n').filter((l) => /CONSOLE/i.test(l)).slice(0, 12);
  for (const l of logs) console.error('   ', l.slice(0, 160));
  process.exit(1);
}

const ms = (v) => v.toFixed(2).padStart(7);
console.log(`\n[perf] frames sampled: ${summary.frames} (post-warmup, ring of last 600)`);
console.log(`[perf] frame time  p50 ${ms(summary.frameP50)}ms  p95 ${ms(summary.frameP95)}ms  avg ${ms(summary.frameAvg)}ms`);
console.log(`[perf] AI thinks   avg ${ms(summary.thinkAvg)}ms/frame  p95 ${ms(summary.thinkP95)}ms  (budget avg < ${BUDGET.thinkAvg}ms)`);
console.log('\nsystem          avg(ms)   p95(ms)   max(ms)');
console.log('---------------------------------------------');
for (const k of ['update', 'takeDirector', 'residents', 'horde', 'escalation', 'gore', 'render']) {
  const s = summary.systems[k];
  if (!s) continue;
  console.log(`${k.padEnd(14)} ${ms(s.avg)}  ${ms(s.p95)}  ${ms(s.max)}`);
}

const up = summary.systems.update;
const passUpdate = up.p95 < BUDGET.updateP95;
const passThink = summary.thinkAvg < BUDGET.thinkAvg;
console.log('\nbudgets:');
console.log(`  update p95  ${up.p95.toFixed(2)}ms < ${BUDGET.updateP95}ms  ${passUpdate ? 'PASS' : 'FAIL'}`);
console.log(`  think avg   ${summary.thinkAvg.toFixed(2)}ms < ${BUDGET.thinkAvg}ms  ${passThink ? 'PASS' : 'FAIL'}`);
console.log(`\n[perf] ${passUpdate && passThink ? 'PASS' : 'FAIL'}`);
process.exit(passUpdate && passThink ? 0 : 1);
