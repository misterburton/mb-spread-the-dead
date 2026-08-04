// Procedural low-res textures for the PS1 look: 64×64 canvases, nearest-filtered,
// muted near-monochrome. No external assets — everything generated, era-authentic.
import * as THREE from 'three/webgpu';

function canvasTex(size, painter, { srgb = true } = {}) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const cx = cv.getContext('2d');
  painter(cx, size);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// deterministic per-texture rng so reloads look identical
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new Map();
function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

// clapboard / siding: horizontal boards, slight value wobble, dark gaps
export const texSiding = (base = '#3a3d3f', gap = '#1d1f20', seed = 7) =>
  cached(`siding${base}${seed}`, () => canvasTex(64, (cx, s) => {
    const r = rng(seed);
    cx.fillStyle = base; cx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 6) {
      const v = 0.85 + r() * 0.3;
      cx.fillStyle = shade(base, v);
      cx.fillRect(0, y, s, 5);
      cx.fillStyle = gap;
      cx.fillRect(0, y + 5, s, 1);
      // nail/knot specks
      for (let i = 0; i < 3; i++) {
        cx.fillStyle = shade(base, 0.6 + r() * 0.2);
        cx.fillRect((r() * s) | 0, y + 1 + ((r() * 3) | 0), 1, 1);
      }
    }
  }));

// brick: running bond, desaturated brown-gray
export const texBrick = (base = '#413931', mortar = '#26221e', seed = 11) =>
  cached(`brick${base}${seed}`, () => canvasTex(64, (cx, s) => {
    const r = rng(seed);
    cx.fillStyle = mortar; cx.fillRect(0, 0, s, s);
    const bh = 6, bw = 12;
    for (let y = 0, row = 0; y < s; y += bh, row++) {
      const off = row % 2 ? bw / 2 : 0;
      for (let x = -bw; x < s + bw; x += bw) {
        const v = 0.8 + r() * 0.4;
        cx.fillStyle = shade(base, v);
        cx.fillRect(x + off + 1, y + 1, bw - 2, bh - 2);
      }
    }
  }));

// roof shingles: overlapping dark tabs
export const texShingle = (base = '#26241f', seed = 5) =>
  cached(`shingle${base}${seed}`, () => canvasTex(64, (cx, s) => {
    const r = rng(seed);
    cx.fillStyle = '#171612'; cx.fillRect(0, 0, s, s);
    for (let y = 0, row = 0; y < s; y += 8, row++) {
      const off = row % 2 ? 8 : 0;
      for (let x = -16; x < s + 16; x += 16) {
        cx.fillStyle = shade(base, 0.8 + r() * 0.45);
        cx.fillRect(x + off + 1, y + 1, 14, 6);
      }
    }
  }));

// asphalt: dark with aggregate speckle + faint center wear
export const texAsphalt = (seed = 3) =>
  cached(`asphalt${seed}`, () => canvasTex(64, (cx, s) => {
    const r = rng(seed);
    cx.fillStyle = '#16181b'; cx.fillRect(0, 0, s, s);
    for (let i = 0; i < 260; i++) {
      const v = r();
      cx.fillStyle = v > 0.85 ? '#2a2e31' : v > 0.5 ? '#1d2023' : '#121417';
      cx.fillRect((r() * s) | 0, (r() * s) | 0, 1, 1);
    }
    // cracks
    cx.strokeStyle = '#0e1013'; cx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      cx.beginPath();
      let x = r() * s, y = r() * s;
      cx.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 14; y += (r() - 0.5) * 14; cx.lineTo(x, y); }
      cx.stroke();
    }
  }));

// sidewalk concrete: lighter slabs with joints
export const texConcrete = (seed = 9) =>
  cached(`concrete${seed}`, () => canvasTex(64, (cx, s) => {
    const r = rng(seed);
    cx.fillStyle = '#2b2e2c'; cx.fillRect(0, 0, s, s);
    for (let i = 0; i < 200; i++) {
      cx.fillStyle = r() > 0.5 ? '#313432' : '#252827';
      cx.fillRect((r() * s) | 0, (r() * s) | 0, 1, 1);
    }
    cx.fillStyle = '#1d201e';
    for (let y = 0; y < s; y += 16) cx.fillRect(0, y, s, 1);
    for (let x = 0; x < s; x += 16) cx.fillRect(x, 0, 1, s);
  }));

// dirt/grass: dead lawn, brown-green noise
export const texGround = (seed = 13) =>
  cached(`ground${seed}`, () => canvasTex(64, (cx, s) => {
    const r = rng(seed);
    cx.fillStyle = '#20241d'; cx.fillRect(0, 0, s, s);
    for (let i = 0; i < 700; i++) {
      const v = r();
      cx.fillStyle = v > 0.7 ? '#2a2f22' : v > 0.35 ? '#232820' : '#1a1e16';
      cx.fillRect((r() * s) | 0, (r() * s) | 0, 1 + (r() > 0.8 ? 1 : 0), 1);
    }
  }));

// gravestone marble: pale gray with speckle
export const texStone = (seed = 17) =>
  cached(`stone${seed}`, () => canvasTex(64, (cx, s) => {
    const r = rng(seed);
    cx.fillStyle = '#4a4d4b'; cx.fillRect(0, 0, s, s);
    for (let i = 0; i < 240; i++) {
      cx.fillStyle = r() > 0.5 ? '#545755' : '#3f4240';
      cx.fillRect((r() * s) | 0, (r() * s) | 0, 1, 1);
    }
  }));

// wood planks (fences, porches)
export const texWood = (base = '#2c2620', seed = 19) =>
  cached(`wood${base}${seed}`, () => canvasTex(64, (cx, s) => {
    const r = rng(seed);
    cx.fillStyle = base; cx.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 8) {
      cx.fillStyle = shade(base, 0.8 + r() * 0.4);
      cx.fillRect(x, 0, 7, s);
      cx.fillStyle = '#181410';
      cx.fillRect(x + 7, 0, 1, s);
      // grain
      for (let i = 0; i < 6; i++) {
        cx.fillStyle = shade(base, 0.6 + r() * 0.3);
        cx.fillRect(x + 1 + ((r() * 5) | 0), (r() * s) | 0, 1, 3 + ((r() * 8) | 0));
      }
    }
  }));

function clean(c) { return c.length > 7 ? c.slice(0, 7) : c; }

// window: dark glass, muntin cross, faint sick glow variant
export const texWindow = (lit = false, seed = 23) =>
  cached(`window${lit}${seed}`, () => canvasTex(32, (cx, s) => {
    cx.fillStyle = lit ? '#4a4433' : '#0d110d'; cx.fillRect(0, 0, s, s);
    if (lit) {
      const r = rng(seed);
      for (let i = 0; i < 30; i++) {
        cx.fillStyle = r() > 0.5 ? '#57503c' : '#3e392b';
        cx.fillRect((r() * s) | 0, (r() * s) | 0, 2, 2);
      }
    }
    cx.fillStyle = '#15130f';
    cx.fillRect(s / 2 - 1, 0, 2, s);
    cx.fillRect(0, s / 2 - 1, s, 2);
    cx.strokeStyle = '#1d1a15'; cx.lineWidth = 3; cx.strokeRect(0, 0, s, s);
  }));

function shade(hex, mul) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) * mul) | 0;
  const g = Math.min(255, ((n >> 8) & 255) * mul) | 0;
  const b = Math.min(255, (n & 255) * mul) | 0;
  return `rgb(${r},${g},${b})`;
}
