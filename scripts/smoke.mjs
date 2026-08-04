// Headless smoke test: serve dist/, load in Chrome, capture console + screenshots.
// Usage: node scripts/smoke.mjs [url]
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

async function shot(url, name, width, height) {
  const args = [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    `--window-size=${width},${height}`, '--hide-scrollbars',
    '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-webgpu', '--enable-features=Vulkan',
    '--enable-unsafe-swiftshader',
    `--screenshot=${join(SHOTS, name)}`,
    '--virtual-time-budget=8000',
    '--enable-logging=stderr', '--v=0',
    url,
  ];
  return new Promise((resolve) => {
    const p = spawn('google-chrome', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => {
      const logs = err.split('\n').filter(l => /CONSOLE/i.test(l));
      resolve({ code, logs });
    });
    setTimeout(() => { p.kill(); resolve({ code: -1, logs: ['TIMEOUT'] }); }, 40000);
  });
}

const port = 8931;
const srv = await serve(port);
const target = process.argv[2] || `http://127.0.0.1:${port}/`;

const runs = [
  ['desktop-webgl.png', 1280, 720, target + '?gl=1&start=street'],
  ['tablet-webgl.png', 1024, 768, target + '?gl=1&start=street'],
  ['graveyard-webgl.png', 1280, 720, target + '?gl=1'],
];

let fail = 0;
for (const [name, w, h, url] of runs) {
  const { code, logs } = await shot(url, name, w, h);
  console.log(`--- ${name} (exit ${code})`);
  for (const l of logs.slice(0, 6)) console.log('   ', l.replace(/^.*CONSOLE[^"]*"?/, '').slice(0, 140));
  const errors = logs.filter(l => /uncaught|TypeError|ReferenceError/i.test(l));
  if (errors.length) fail++;
}
srv.close();
process.exit(fail ? 1 : 0);
