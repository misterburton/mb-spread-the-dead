// Headless smoke test: serve dist/, load in Chrome, capture console + screenshots.
// Usage: node scripts/smoke.mjs [url]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
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

async function shot(url, name, width, height, extraFlags = []) {
  const args = [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    `--window-size=${width},${height}`, '--hide-scrollbars',
    '--enable-unsafe-webgpu', '--enable-features=Vulkan',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    `--screenshot=${join(SHOTS, name)}`,
    '--virtual-time-budget=6000',
    '--enable-logging=stderr', '--v=0',
    ...extraFlags, url,
  ];
  return new Promise((resolve) => {
    const p = spawn('google-chrome', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => {
      const logs = err.split('\n').filter(l => /CONSOLE|ERROR|error/i.test(l)).slice(0, 30);
      resolve({ code, logs });
    });
    setTimeout(() => { p.kill(); resolve({ code: -1, logs: ['TIMEOUT'] }); }, 30000);
  });
}

const port = 8931;
const srv = await serve(port);
const target = process.argv[2] || `http://127.0.0.1:${port}/`;

const runs = [
  ['desktop-webgpu.png', 1280, 720, target],
  ['desktop-webgl.png', 1280, 720, target + '?gl=1'],
  ['tablet-webgpu.png', 1024, 768, target],
];

let fail = 0;
for (const [name, w, h, url] of runs) {
  const { code, logs } = await shot(url, name, w, h);
  const rendererLine = logs.find(l => l.includes('[renderer]'));
  console.log(`--- ${name} (exit ${code})`);
  if (rendererLine) console.log('   ', rendererLine.trim());
  const errors = logs.filter(l => /uncaught|failed|error/i.test(l) && !/dbus|GPU stall|NameHasOwner/i.test(l));
  if (errors.length) { console.log('   ERRORS:'); errors.slice(0, 8).forEach(e => console.log('   ', e.trim())); fail++; }
}
srv.close();
process.exit(fail ? 1 : 0);
