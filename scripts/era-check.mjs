// Era effects check: serve dist/, shoot the street vantage twice —
// default jitter (CFG.render.snapVertex) vs ?jitter=strong (1/60 grid) —
// then pixel-diff the two PNGs to prove geometry visibly moves.
// Usage: node scripts/era-check.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import zlib from 'node:zlib';

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

function shot(url, name, width, height) {
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
      const logs = err.split('\n').filter((l) => /CONSOLE/i.test(l));
      resolve({ code, logs });
    });
    setTimeout(() => { p.kill(); resolve({ code: -1, logs: ['TIMEOUT'] }); }, 40000);
  });
}

// --- minimal PNG decoder (RGB/RGBA, 8-bit, unfiltered scanlines) ---
function decodePng(file) {
  const d = readFileSync(file);
  const w = d.readUInt32BE(16), h = d.readUInt32BE(20);
  const ct = d[25];
  const bpp = ct === 2 ? 3 : 4;
  let idat = Buffer.alloc(0);
  let i = 8;
  while (i < d.length) {
    const ln = d.readUInt32BE(i);
    if (d.toString('ascii', i + 4, i + 8) === 'IDAT') idat = Buffer.concat([idat, d.subarray(i + 8, i + 8 + ln)]);
    i += 12 + ln;
  }
  const raw = zlib.inflateSync(idat);
  const stride = w * bpp;
  const out = Buffer.alloc(stride * h);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    if (f === 1) for (let x = bpp; x < stride; x++) line[x] = (line[x] + line[x - bpp]) & 255;
    else if (f === 2) for (let x = 0; x < stride; x++) line[x] = (line[x] + prev[x]) & 255;
    else if (f === 3) for (let x = 0; x < stride; x++) { const a = x >= bpp ? line[x - bpp] : 0; line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255; }
    else if (f === 4) for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
    }
    line.copy(out, y * stride);
    prev = line;
  }
  return { w, h, bpp, px: out };
}

function diffPng(a, b, threshold = 24) {
  if (a.w !== b.w || a.h !== b.h) return { error: `size mismatch ${a.w}x${a.h} vs ${b.w}x${b.h}` };
  let changed = 0, maxDelta = 0, sumDelta = 0;
  for (let p = 0; p < a.px.length; p += a.bpp) {
    const d = Math.abs(a.px[p] - b.px[p]) + Math.abs(a.px[p + 1] - b.px[p + 1]) + Math.abs(a.px[p + 2] - b.px[p + 2]);
    sumDelta += d;
    if (d > maxDelta) maxDelta = d;
    if (d > threshold) changed++;
  }
  const total = a.w * a.h;
  return {
    totalPx: total,
    changedPx: changed,
    changedPct: +((changed / total) * 100).toFixed(2),
    meanDelta: +(sumDelta / total).toFixed(2),
    maxDelta,
    threshold,
  };
}

const port = 8937;
const srv = await serve(port);
const base = `http://127.0.0.1:${port}/`;
const W = 1280, H = 720;

const runs = [
  ['era-check-normal.png', `${base}?gl=1&start=street`],
  ['era-check-strong.png', `${base}?gl=1&start=street&jitter=strong`],
];

let fail = 0;
for (const [name, url] of runs) {
  const { code, logs } = await shot(url, name, W, H);
  console.log(`--- ${name} (exit ${code})`);
  for (const l of logs.slice(0, 8)) console.log('   ', l.replace(/^.*CONSOLE[^"]*"?/, '').slice(0, 140));
  const errors = logs.filter((l) => /uncaught|TypeError|ReferenceError|WebGL.*error|Shader Error|THREE\./i.test(l));
  if (errors.length) { fail++; console.log('    ERRORS:', errors.slice(0, 3).join(' | ').slice(0, 300)); }
}

const a = decodePng(join(SHOTS, 'era-check-normal.png'));
const b = decodePng(join(SHOTS, 'era-check-strong.png'));
console.log('DIFF', JSON.stringify(diffPng(a, b)));

srv.close();
process.exit(fail ? 1 : 0);
