// Shared PNG luma analyzer with proper unfiltering. Usage: node scripts/luma.mjs <file.png>
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';

export function analyze(file) {
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
  const hist = new Array(256).fill(0);
  for (let p = 0; p < stride * h; p += bpp) hist[out[p]]++;
  const tot = w * h;
  const mean = hist.reduce((s, c, v) => s + c * v, 0) / tot;
  let cum = 0, p95 = 255;
  for (let v = 0; v < 256; v++) { cum += hist[v]; if (cum > tot * 0.95) { p95 = v; break; } }
  const max = 255 - hist.slice().reverse().findIndex((c) => c > 0);
  const pct60 = (hist.slice(61).reduce((a, b) => a + b, 0) / tot) * 100;
  return { w, h, mean: +mean.toFixed(1), p95, max, pct60: +pct60.toFixed(2) };
}

if (process.argv[2]) console.log(JSON.stringify(analyze(process.argv[2])));
