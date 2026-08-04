// Town generator: street grid, buildings, church, graveyard, lamps, navGrid.
import * as THREE from 'three/webgpu';

const matCache = new Map();
export function mat(hex) {
  if (!matCache.has(hex)) matCache.set(hex, new THREE.MeshLambertNodeMaterial({ color: hex }));
  return matCache.get(hex);
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

  // --- ground base ---
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(R * 2, R * 2), mat(0x1b1e1b));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  group.add(ground);

  // --- streets: main cross avenues + two side streets ---
  const ROAD = 0x14161a, WALK = 0x232629;
  const roads = [
    { x: 0, z: 0, w: 8, d: R * 2 },      // N-S avenue
    { x: 0, z: 0, w: R * 2, d: 8 },      // E-W avenue
    { x: BS * 2, z: 0, w: 5, d: R * 2 }, // side street E
    { x: -BS * 2, z: 0, w: 5, d: R * 2 },// side street W
  ];
  for (const r of roads) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.d), mat(ROAD));
    p.rotation.x = -Math.PI / 2;
    p.position.set(r.x, 0.01, r.z);
    group.add(p);
    // sidewalks along both long edges
    const along = r.d > r.w ? 'z' : 'x';
    for (const s of [-1, 1]) {
      const sw = along === 'z' ? 1.5 : r.w;
      const sd = along === 'z' ? r.d : 1.5;
      const sx = along === 'z' ? r.x + s * (r.w / 2 + 0.75) : r.x;
      const sz = along === 'z' ? r.z : r.z + s * (r.d / 2 + 0.75);
      const w2 = new THREE.Mesh(new THREE.BoxGeometry(sw, 0.08, sd), mat(WALK));
      w2.position.set(sx, 0.04, sz);
      group.add(w2);
      // spawn points along sidewalks
      const len = along === 'z' ? r.d : r.w;
      for (let t = -len / 2 + 4; t < len / 2 - 4; t += 6) {
        spawnPoints.push(along === 'z'
          ? { x: sx + (Math.sin(t * 7) * 0.4), z: t }
          : { x: t, z: sz + (Math.sin(t * 5) * 0.4) });
      }
    }
  }

  // --- buildings along avenue edges ---
  const PAL = [0x2a2d2f, 0x33302b, 0x2e3236, 0x3a3630, 0x2b3134];
  const roofM = mat(0x22201d);
  let bCount = 0;
  const slots = [];
  for (const side of [-1, 1]) {
    for (let t = -R + 12; t < R - 12; t += 14) {
      if (Math.abs(t) < 8) continue; // keep crossroads clear
      slots.push({ x: side * 9.5, z: t, rot: side > 0 ? -Math.PI / 2 : Math.PI / 2, along: 'z' });
      slots.push({ x: t, z: side * 9.5, rot: side > 0 ? Math.PI : 0, along: 'x' });
    }
  }
  // side-street slots
  for (const sx of [BS * 2, -BS * 2]) {
    for (const side of [-1, 1]) {
      for (let t = -R + 16; t < R - 12; t += 18) {
        if (Math.abs(t) < 8) continue;
        slots.push({ x: sx + side * 7.5, z: t, rot: side > 0 ? -Math.PI / 2 : Math.PI / 2, along: 'z' });
      }
    }
  }
  const cap = Math.min(slots.length, 32);
  for (let i = 0; i < cap; i++) {
    const s = slots[i];
    const w = 6 + (i * 13 % 5), d = 6 + (i * 7 % 4), h = 3.5 + (i * 11 % 45) / 10;
    const bx = s.x + (s.along === 'z' ? (s.rot < 0 ? 1 : -1) * (w / 2 + 0.5) : 0);
    const bz = s.z + (s.along === 'x' ? (s.rot === 0 ? 1 : -1) * (d / 2 + 0.5) : 0);
    const b = new THREE.Group();
    const body = box(w, h, d, mat(PAL[i % PAL.length]));
    body.position.y = h / 2;
    b.add(body);
    // gable roof: squashed 4-seg cylinder
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, Math.max(w, d) * 0.72, 1.6, 4, 1), roofM);
    roof.position.y = h + 0.8;
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
    b.add(roof);
    // windows: dark inset quads on front face
    const winM = mat(0x11150f);
    for (let wy = 0; wy < Math.floor(h / 2.4); wy++) {
      for (let wx = -1; wx <= 1; wx++) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.0), winM);
        win.position.set(wx * (w / 3.2), 1.6 + wy * 2.2, d / 2 + 0.02);
        b.add(win);
      }
    }
    if (i % 4 === 0) { // porch
      const porch = box(w * 0.5, 0.12, 1.6, mat(0x26221e));
      porch.position.set(0, 0.5, d / 2 + 0.8);
      b.add(porch);
      for (const px of [-w * 0.2, w * 0.2]) {
        const post = box(0.09, 1.1, 0.09, mat(0x26221e));
        post.position.set(px, 0.55, d / 2 + 1.5);
        b.add(post);
      }
    }
    b.position.set(bx, 0, bz);
    b.rotation.y = s.rot;
    group.add(b);
    bCount++;
    blockRect(bx - w / 2 - 0.3, bz - d / 2 - 0.3, bx + w / 2 + 0.3, bz + d / 2 + 0.3);
  }

  // --- church near SW of center ---
  const church = new THREE.Group();
  const cbody = box(9, 7, 14, mat(0x3d3a35));
  cbody.position.y = 3.5;
  church.add(cbody);
  const steeple = box(2, 5, 2, mat(0x3d3a35));
  steeple.position.set(0, 8.5, 5.5);
  church.add(steeple);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(1.4, 3, 4), roofM);
  spire.position.set(0, 12.5, 5.5);
  church.add(spire);
  church.position.set(-BS - 14, 0, BS + 10);
  group.add(church);
  blockRect(-BS - 19, BS + 3, -BS - 9, BS + 17);

  // --- general store ---
  const store = new THREE.Group();
  const sbody = box(12, 5, 8, mat(0x36312a));
  sbody.position.y = 2.5;
  store.add(sbody);
  const sign = box(6, 1, 0.2, mat(0x4a4438));
  sign.position.set(0, 5.6, 4.1);
  store.add(sign);
  store.position.set(BS + 12, 0, -BS - 6);
  group.add(store);
  blockRect(BS + 6, -BS - 10, BS + 18, -BS - 2);

  // --- graveyard NE corner ---
  const gy = { x: R - 22, z: R - 22, s: 15 };
  const fenceM = mat(0x1e2124);
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
  // gate gap at x±3.2 on south side stays walkable
  const stoneM = mat(0x4a4d4b);
  for (let i = 0; i < 18; i++) {
    const gx = gy.x - 5 + (i % 6) * 2, gz = gy.z - 4.5 + Math.floor(i / 6) * 4;
    if (Math.abs(gx - gy.x) < 1.4 && Math.abs(gz - gy.z) < 1.4) continue; // grave spot
    const st = box(0.6, 0.9 + (i % 3) * 0.2, 0.15, stoneM);
    st.position.set(gx, st.geometry.parameters.height / 2, gz);
    st.rotation.y = (i % 5 - 2) * 0.06;
    group.add(st);
  }
  // her open grave
  const hole = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.4), mat(0x050505));
  hole.rotation.x = -Math.PI / 2;
  hole.position.set(gy.x, 0.015, gy.z);
  group.add(hole);
  const mound = box(1.6, 0.5, 1.0, mat(0x2c2318));
  mound.position.set(gy.x + 1.6, 0.25, gy.z);
  group.add(mound);
  const playerSpawn = { x: gy.x, z: gy.z + 1.5 };

  // --- street lamps along avenues ---
  const lampM = mat(0x23262a);
  const lampGlow = new THREE.MeshBasicNodeMaterial({ color: 0xb8b39a });
  for (let t = -R + 8; t < R - 8; t += 14) {
    for (const [lx, lz] of [[4.8, t], [-4.8, t + 7], [t, 4.8], [t + 7, -4.8]]) {
      if (Math.abs(lx) > R - 4 || Math.abs(lz) > R - 4) continue;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.2, 5), lampM);
      pole.position.set(lx, 1.6, lz);
      group.add(pole);
      const head = box(0.5, 0.25, 0.3, lampM);
      head.position.set(lx, 3.25, lz);
      group.add(head);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.12), lampGlow);
      glow.position.set(lx, 3.14, lz);
      glow.rotation.x = Math.PI / 2;
      group.add(glow);
      lampPositions.push({ x: lx, y: 3.2, z: lz });
    }
  }

  // --- bare trees ---
  for (let i = 0; i < 10; i++) {
    const tx = Math.sin(i * 37.7) * (R - 14), tz = Math.cos(i * 51.3) * (R - 14);
    if (Math.abs(tx) < 8 || Math.abs(tz) < 8) continue;
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 2.6, 5), mat(0x241f1a));
    tr.position.set(tx, 1.3, tz);
    group.add(tr);
    for (let b = 0; b < 3; b++) {
      const br = new THREE.Mesh(new THREE.ConeGeometry(0.9 - b * 0.2, 1.6, 4), mat(0x1c211c));
      br.position.set(tx + Math.sin(b * 2.4) * 0.4, 2.6 + b * 0.9, tz + Math.cos(b * 2.4) * 0.4);
      group.add(br);
    }
    blockRect(tx - 0.4, tz - 0.4, tx + 0.4, tz + 0.4);
  }

  scene.add(group);
  return { navGrid, gridSize, cellSize, origin, obstacles, spawnPoints, lampPositions, playerSpawn, group };
}
