// Town generator: street grid, textured buildings, church, graveyard, lamps, navGrid.
// PS1 look: 64px nearest-filtered procedural textures, era silhouettes, grounded fog.
import * as THREE from 'three/webgpu';
import {
  texSiding, texBrick, texShingle, texAsphalt, texConcrete,
  texGround, texStone, texWood, texWindow,
} from './textures.js';
import { jitterPosition, affineUV, affineTexture, isWebGL2 } from '../engine/era.js';

// Shared clip-space vertex snap (PS1 wobble) — one node graph, applied to
// every world material below via positionNode.
const eraJitter = jitterPosition();

const matCache = new Map();
export function mat(hex) {
  if (!matCache.has(hex)) {
    const m = new THREE.MeshLambertNodeMaterial({ color: hex });
    m.positionNode = eraJitter;
    matCache.set(hex, m);
  }
  return matCache.get(hex);
}
// affine=true → PS1 non-perspective-correct texture sampling (ground/roads).
// colorNode replaces materialColor there, so the tint is folded into the node
// and `map` stays unset; the repeat is baked into the affine UV varying
// (texture() with an explicit uv node skips the texture matrix).
function tmat(tex, repeat = [1, 1], tint = 0xffffff, affine = false) {
  // Affine warp is WebGPU-only: GLSL `noperspective` on WebGL2 breaks SwiftShader
  // shader validation (see era.js). WebGL2 keeps perspective-correct maps — the
  // dominant era cue (vertex jitter) works on both backends.
  affine = affine && !isWebGL2();
  const key = tex.uuid + repeat + tint + (affine ? ':a' : '');
  if (!matCache.has(key)) {
    const t = tex.clone();
    t.repeat.set(repeat[0], repeat[1]);
    t.needsUpdate = true;
    let m;
    if (affine) {
      m = new THREE.MeshLambertNodeMaterial({ color: tint });
      m.colorNode = affineTexture(t, affineUV(repeat)).mul(new THREE.Color(tint));
    } else {
      m = new THREE.MeshLambertNodeMaterial({ map: t, color: tint });
    }
    m.positionNode = eraJitter;
    matCache.set(key, m);
  }
  return matCache.get(key);
}

const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

export function worldToCell(origin, cellSize, x, z) {
  return [
    Math.floor((x - origin.x) / cellSize),
    Math.floor((z - origin.z) / cellSize),
  ];
}
export function isBlocked(navGrid, gridSize, origin, cellSize, x, z) {
  const [cx, cz] = worldToCell(origin, cellSize, x, z);
  if (cx < 0 || cz < 0 || cx >= gridSize || cz >= gridSize) return true;
  return navGrid[cz * gridSize + cx] === 1;
}

export function generateTown(scene, CFG) {
  const R = CFG.town.worldRadius;
  const BS = CFG.town.blockSize;
  const cellSize = 1;
  const gridSize = R * 2;
  const origin = { x: -R, z: -R };
  const navGrid = new Uint8Array(gridSize * gridSize);
  const obstacles = [];
  const spawnPoints = [];
  const lampPositions = [];

  const blockRect = (minX, minZ, maxX, maxZ) => {
    obstacles.push({ minX, minZ, maxX, maxZ });
    const x0 = Math.max(0, Math.floor(minX - origin.x));
    const x1 = Math.min(gridSize - 1, Math.ceil(maxX - origin.x));
    const z0 = Math.max(0, Math.floor(minZ - origin.z));
    const z1 = Math.min(gridSize - 1, Math.ceil(maxZ - origin.z));
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++)
        navGrid[z * gridSize + x] = 1;
  };

  const group = new THREE.Group();

  // --- ground: dead-lawn dirt/grass ---
  const groundTex = texGround();
  groundTex.repeat.set(R / 2, R / 2);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(R * 2, R * 2),
    tmat(groundTex, [1, 1], 0x9aa098, true) // affine warp: big flat surface, most visible swim
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  group.add(ground);

  // --- streets ---
  const asphalt = texAsphalt();
  const concrete = texConcrete();
  const roads = [
    { x: 0, z: 0, w: 8, d: R * 2 },
    { x: 0, z: 0, w: R * 2, d: 8 },
    { x: BS * 2, z: 0, w: 5, d: R * 2 },
    { x: -BS * 2, z: 0, w: 5, d: R * 2 },
  ];
  for (const r of roads) {
    const rt = asphalt.clone();
    rt.repeat.set(r.w / 8, r.d / 8);
    rt.needsUpdate = true;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.d), tmat(rt, [1, 1], 0xffffff, true)); // road: affine warp
    p.rotation.x = -Math.PI / 2;
    p.position.set(r.x, 0.01, r.z);
    group.add(p);
    const along = r.d > r.w ? 'z' : 'x';
    for (const s of [-1, 1]) {
      const sw = along === 'z' ? 1.5 : r.w;
      const sd = along === 'z' ? r.d : 1.5;
      const sx = along === 'z' ? r.x + s * (r.w / 2 + 0.75) : r.x;
      const sz = along === 'z' ? r.z : r.z + s * (r.d / 2 + 0.75);
      const wt = concrete.clone();
      wt.repeat.set(sw / 3, sd / 3);
      wt.needsUpdate = true;
      const w2 = new THREE.Mesh(new THREE.BoxGeometry(sw, 0.08, sd), tmat(wt, [1, 1], 0xb0b4ae, true)); // sidewalk: affine warp
      w2.position.set(sx, 0.04, sz);
      group.add(w2);
      const len = along === 'z' ? r.d : r.w;
      for (let t = -len / 2 + 4; t < len / 2 - 4; t += 6) {
        spawnPoints.push(along === 'z'
          ? { x: sx + (Math.sin(t * 7) * 0.4), z: t }
          : { x: t, z: sz + (Math.sin(t * 5) * 0.4) });
      }
    }
  }

  // --- buildings: textured, porches, shutters, lit windows ---
  const wallTexes = [texSiding('#3a3d3f', '#1d1f20', 7), texSiding('#3f3a33', '#201c17', 8), texBrick('#413931', '#26221e', 11), texSiding('#34383b', '#1a1c1e', 9), texBrick('#453b30', '#282019', 12)];
  const roofTex = texShingle();
  const winDark = texWindow(false);
  const winLit = texWindow(true);
  const woodTex = texWood();

  const slots = [];
  for (const side of [-1, 1]) {
    for (let t = -R + 12; t < R - 12; t += 14) {
      if (Math.abs(t) < 8) continue;
      slots.push({ x: side * 9.5, z: t, rot: side > 0 ? -Math.PI / 2 : Math.PI / 2, along: 'z' });
      slots.push({ x: t, z: side * 9.5, rot: side > 0 ? Math.PI : 0, along: 'x' });
    }
  }
  for (const sx of [BS * 2, -BS * 2]) {
    for (const side of [-1, 1]) {
      for (let t = -R + 16; t < R - 12; t += 18) {
        if (Math.abs(t) < 8) continue;
        slots.push({ x: sx + side * 7.5, z: t, rot: side > 0 ? -Math.PI / 2 : Math.PI / 2, along: 'z' });
      }
    }
  }
  const cap = Math.min(slots.length, 30);
  let litBudget = 14; // a few sick lit windows across town
  for (let i = 0; i < cap; i++) {
    const s = slots[i];
    const w = 6 + (i * 13 % 5), d = 6 + (i * 7 % 4), h = 4 + (i * 11 % 40) / 10;
    const bx = s.x + (s.along === 'z' ? (s.rot < 0 ? 1 : -1) * (w / 2 + 0.5) : 0);
    const bz = s.z + (s.along === 'x' ? (s.rot === 0 ? 1 : -1) * (d / 2 + 0.5) : 0);
    const b = new THREE.Group();
    const wallTex = wallTexes[i % wallTexes.length].clone();
    wallTex.repeat.set(w / 4, h / 3);
    wallTex.needsUpdate = true;
    const body = box(w, h, d, tmat(wallTex));
    body.position.y = h / 2;
    b.add(body);
    // roof: prism via 45°-rotated squashed 4-seg cone, shingled
    const rt2 = roofTex.clone();
    rt2.repeat.set(w / 3, d / 3);
    rt2.needsUpdate = true;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.74, 1.7, 4, 1), tmat(rt2));
    roof.position.y = h + 0.85;
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
    b.add(roof);
    // door
    const door = box(1.0, 2.0, 0.08, tmat(woodTex, [1, 1], 0x8a8078));
    door.position.set(0, 1.0, d / 2 + 0.05);
    b.add(door);
    // windows with shutters; a few lit
    const winMatDark = new THREE.MeshLambertNodeMaterial({ map: winDark });
    winMatDark.positionNode = eraJitter;
    const winMatLit = new THREE.MeshLambertNodeMaterial({ map: winLit, emissive: 0x6a6040, emissiveIntensity: 0.55 });
    winMatLit.positionNode = eraJitter;
    const rows = Math.max(1, Math.floor(h / 2.6));
    for (let wy = 0; wy < rows; wy++) {
      for (let wx = -1; wx <= 1; wx++) {
        if (wx === 0 && wy === 0) continue; // door slot
        const lit = litBudget > 0 && ((i * 7 + wy * 3 + wx + 2) % 9 === 0);
        if (lit) litBudget--;
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 1.05), lit ? winMatLit : winMatDark);
        win.position.set(wx * (w / 3.1), 1.7 + wy * 2.3, d / 2 + 0.03);
        b.add(win);
        // shutters
        const shM = tmat(woodTex, [0.3, 1], 0x5a5650);
        for (const sh of [-0.55, 0.55]) {
          const shut = box(0.22, 1.05, 0.04, shM);
          shut.position.set(wx * (w / 3.1) + sh, 1.7 + wy * 2.3, d / 2 + 0.03);
          b.add(shut);
        }
      }
    }
    if (i % 3 === 0) { // porch with roof overhang
      const porch = box(w * 0.55, 0.14, 1.7, tmat(woodTex, [2, 0.5], 0x7a7268));
      porch.position.set(0, 0.5, d / 2 + 0.85);
      b.add(porch);
      const proof = box(w * 0.55, 0.06, 1.9, tmat(roofTex));
      proof.position.set(0, 2.35, d / 2 + 0.9);
      b.add(proof);
      for (const px of [-w * 0.22, w * 0.22]) {
        const post = box(0.1, 1.85, 0.1, tmat(woodTex, [0.4, 1], 0x6a6258));
        post.position.set(px, 1.42, d / 2 + 1.65);
        b.add(post);
      }
    }
    b.position.set(bx, 0, bz);
    b.rotation.y = s.rot;
    group.add(b);
    blockRect(bx - w / 2 - 0.3, bz - d / 2 - 0.3, bx + w / 2 + 0.3, bz + d / 2 + 0.3);
  }

  // --- church ---
  const church = new THREE.Group();
  const churchWall = texStone();
  const cbody = box(9, 7.5, 14, tmat(churchWall.clone(), [3, 2], 0xb8bab2));
  cbody.position.y = 3.75;
  church.add(cbody);
  const croof = new THREE.Mesh(new THREE.ConeGeometry(10.4, 2.6, 4, 1), tmat(roofTex));
  croof.position.y = 8.8;
  croof.rotation.y = Math.PI / 4;
  croof.scale.set(1, 1, 14 / 9);
  church.add(croof);
  const steeple = box(2.2, 5, 2.2, tmat(churchWall.clone(), [1, 2], 0xb8bab2));
  steeple.position.set(0, 9, 5.5);
  church.add(steeple);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(1.55, 3.4, 4), tmat(roofTex));
  spire.position.set(0, 13.2, 5.5);
  church.add(spire);
  // arched windows (tall dark planes)
  for (const wx of [-2.6, 0, 2.6]) {
    const cwMat = new THREE.MeshLambertNodeMaterial({ map: winDark });
    cwMat.positionNode = eraJitter;
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.6), cwMat);
    win.position.set(wx, 3.4, 7.02);
    church.add(win);
  }
  const cdoor = box(1.6, 2.6, 0.1, tmat(woodTex, [1, 1.4], 0x6a6058));
  cdoor.position.set(0, 1.3, 7.05);
  church.add(cdoor);
  church.position.set(-BS - 14, 0, BS + 10);
  group.add(church);
  blockRect(-BS - 19, BS + 3, -BS - 9, BS + 17);

  // --- general store ---
  const store = new THREE.Group();
  const storeWall = texBrick('#453b30', '#282019', 12);
  const sbody = box(12, 5.5, 8, tmat(storeWall, [3, 1.5], 0xb0aca2));
  sbody.position.y = 2.75;
  store.add(sbody);
  const awning = box(12.4, 0.08, 2.2, mat(0x2e2a24));
  awning.position.set(0, 3.4, 4.6);
  store.add(awning);
  const sign = box(7, 1.1, 0.15, tmat(woodTex, [3, 0.5], 0x9a8a68));
  sign.position.set(0, 5.9, 4.15);
  store.add(sign);
  const sfMat = new THREE.MeshLambertNodeMaterial({ map: winDark });
  sfMat.positionNode = eraJitter;
  const storefront = new THREE.Mesh(new THREE.PlaneGeometry(8, 2.2), sfMat);
  storefront.position.set(0, 1.7, 4.02);
  store.add(storefront);
  store.position.set(BS + 12, 0, -BS - 6);
  group.add(store);
  blockRect(BS + 6, -BS - 10, BS + 18, -BS - 2);

  // --- graveyard NE corner ---
  const gy = { x: R - 22, z: R - 22, s: 15 };
  const fenceM = tmat(woodTex, [4, 0.4], 0x4a4a4c);
  for (const [fx, fz, fw, fd] of [
    [gy.x, gy.z - gy.s / 2, gy.s, 0.15], [gy.x, gy.z + gy.s / 2, gy.s, 0.15],
    [gy.x - gy.s / 2, gy.z, 0.15, gy.s], [gy.x + gy.s / 2, gy.z, 0.15, gy.s],
  ]) {
    const f = box(fw, 1.0, fd, fenceM);
    f.position.set(fx, 0.5, fz);
    group.add(f);
  }
  blockRect(gy.x - gy.s / 2 - 0.2, gy.z - gy.s / 2 - 0.2, gy.x - 3.2, gy.z + gy.s / 2 + 0.2);
  blockRect(gy.x + 3.2, gy.z - gy.s / 2 - 0.2, gy.x + gy.s / 2 + 0.2, gy.z + gy.s / 2 + 0.2);
  const stoneM = tmat(texStone(), [0.5, 0.7], 0xc0c2bc);
  for (let i = 0; i < 18; i++) {
    const gx = gy.x - 5 + (i % 6) * 2, gz = gy.z - 4.5 + Math.floor(i / 6) * 4;
    if (Math.abs(gx - gy.x) < 1.4 && Math.abs(gz - gy.z) < 1.4) continue;
    const hh = 0.9 + (i % 3) * 0.2;
    const st = box(0.6, hh, 0.15, stoneM);
    st.position.set(gx, hh / 2, gz);
    st.rotation.y = (i % 5 - 2) * 0.06;
    group.add(st);
  }
  const hole = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.4), mat(0x050505));
  hole.rotation.x = -Math.PI / 2;
  hole.position.set(gy.x, 0.015, gy.z);
  group.add(hole);
  const mound = box(1.6, 0.5, 1.0, tmat(texGround(), [0.6, 0.4], 0x6a5a48));
  mound.position.set(gy.x + 1.6, 0.25, gy.z);
  group.add(mound);
  const playerSpawn = { x: gy.x, z: gy.z + 1.5 };

  // --- street lamps ---
  const lampM = mat(0x23262a);
  const lampGlow = new THREE.MeshBasicNodeMaterial({ color: 0xb8b39a });
  lampGlow.positionNode = eraJitter;
  for (let t = -R + 8; t < R - 8; t += 14) {
    for (const [lx, lz] of [[4.8, t], [-4.8, t + 7], [t, 4.8], [t + 7, -4.8]]) {
      if (Math.abs(lx) > R - 4 || Math.abs(lz) > R - 4) continue;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.2, 5), lampM);
      pole.position.set(lx, 1.6, lz);
      group.add(pole);
      const arm = box(0.5, 0.06, 0.06, lampM);
      arm.position.set(lx + 0.2, 3.15, lz);
      group.add(arm);
      const head = box(0.32, 0.16, 0.22, lampM);
      head.position.set(lx + 0.4, 3.1, lz);
      group.add(head);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.14), lampGlow);
      glow.position.set(lx + 0.4, 3.0, lz);
      glow.rotation.x = Math.PI / 2;
      group.add(glow);
      lampPositions.push({ x: lx + 0.4, y: 3.0, z: lz });
    }
  }

  // --- bare trees: trunks with angular branch cones ---
  const barkM = tmat(woodTex, [0.4, 1.5], 0x3a332c);
  for (let i = 0; i < 10; i++) {
    const tx = Math.sin(i * 37.7) * (R - 14), tz = Math.cos(i * 51.3) * (R - 14);
    if (Math.abs(tx) < 8 || Math.abs(tz) < 8) continue;
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 2.6, 5), barkM);
    tr.position.set(tx, 1.3, tz);
    group.add(tr);
    for (let b = 0; b < 3; b++) {
      const br = new THREE.Mesh(new THREE.ConeGeometry(0.5 - b * 0.1, 1.8, 4), mat(0x181c18));
      br.position.set(tx + Math.sin(b * 2.4) * 0.5, 2.6 + b * 0.8, tz + Math.cos(b * 2.4) * 0.5);
      br.rotation.z = 0.5 + b * 0.35;
      br.rotation.y = b * 2.1;
      group.add(br);
    }
    blockRect(tx - 0.4, tz - 0.4, tx + 0.4, tz + 0.4);
  }

  scene.add(group);
  return { navGrid, gridSize, cellSize, origin, obstacles, spawnPoints, lampPositions, playerSpawn, group };
}
