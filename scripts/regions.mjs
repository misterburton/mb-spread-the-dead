// Decode PNG properly and report per-region luma (top/mid/bottom thirds).
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';

export function decode(file) {
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
  return { w, h, bpp, stride, out };
}

if (process.argv[2]) {
  const { w, h, bpp, stride, out } = decode(process.argv[2]);
  const region = (y0, y1) => {
    let s = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = 0; x < stride; x += bpp * 7) { s += out[y * stride + x]; n++; }
    return +(s / n).toFixed(1);
  };
  console.log(JSON.stringify({
    top: region(0, h / 3 | 0), mid: region(h / 3 | 0, 2 * h / 3 | 0), bot: region(2 * h / 3 | 0, h),
  }));
}
