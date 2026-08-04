// w1: character factory — low-poly PS1-horror humanoids (~300-700 tris each)
// All parts are THREE.Mesh in a THREE.Group; materials are flat-color
// MeshLambertNodeMaterial from a shared cache keyed by hex.
import * as THREE from 'three/webgpu';

// ---------------------------------------------------------------------------
// shared material cache (flat colors, keyed by hex)
const matCache = new Map();
export function mat(hex) {
  if (!matCache.has(hex)) {
    matCache.set(hex, new THREE.MeshLambertNodeMaterial({ color: hex }));
  }
  return matCache.get(hex);
}

// shared geometry cache (avoid re-tesselation across characters)
const geoCache = new Map();
function box(w, h, d) {
  const k = `b${w},${h},${d}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.BoxGeometry(w, h, d));
  return geoCache.get(k);
}
function cyl(rt, rb, h, seg) {
  const k = `c${rt},${rb},${h},${seg}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.CylinderGeometry(rt, rb, h, seg, 1));
  return geoCache.get(k);
}
function plane(w, h) {
  const k = `p${w},${h}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.PlaneGeometry(w, h));
  return geoCache.get(k);
}
function hairCapGeo() {
  const k = 'haircap';
  if (!geoCache.has(k)) {
    const g = new THREE.SphereGeometry(0.13, 5, 3, 0, Math.PI * 2, 0, Math.PI * 0.55);
    g.scale(1, 0.72, 1.06);
    geoCache.set(k, g);
  }
  return geoCache.get(k);
}

// ---------------------------------------------------------------------------
// part builders

// head with 2 dark eye inset quads + darker brow strip
function makeHead(skinHex, hairHex, opts = {}) {
  const g = new THREE.Group();
  const head = new THREE.Mesh(box(0.22, 0.26, 0.24), mat(skinHex));
  head.position.y = 0.13;
  g.add(head);

  // brow shading: slightly darker thin box across upper face
  const browHex = shade(skinHex, 0.78);
  const brow = new THREE.Mesh(box(0.19, 0.028, 0.012), mat(browHex));
  brow.position.set(0, 0.185, 0.122);
  g.add(brow);

  // eyes: small dark plane quads inset on the face (+z)
  const eyeMat = mat(opts.eyeHex ?? 0x14100e);
  const eyeL = new THREE.Mesh(plane(0.03, 0.03), eyeMat);
  const eyeR = new THREE.Mesh(plane(0.03, 0.03), eyeMat);
  eyeL.position.set(-0.048, 0.145, 0.121);
  eyeR.position.set(0.048, 0.145, 0.121);
  g.add(eyeL, eyeR);

  if (hairHex != null) {
    const hair = new THREE.Mesh(hairCapGeo(), mat(hairHex));
    hair.position.y = 0.245;
    g.add(hair);
  }

  g.userData.eyes = [eyeL, eyeR];
  g.userData.headMesh = head;
  return g;
}

// limb pivoted at its top (shoulder/hip): wrapper Group at pivot, mesh offset
function makeLimb(w, len, d, hex, endHex, endSize = 0.07) {
  const pivot = new THREE.Group();
  const limb = new THREE.Mesh(box(w, len, d), mat(hex));
  limb.position.y = -len / 2;
  pivot.add(limb);
  if (endHex != null) {
    const end = new THREE.Mesh(box(endSize, endSize, endSize), mat(endHex));
    end.position.y = -len - endSize * 0.3;
    pivot.add(end);
    pivot.userData.endMesh = end;
  }
  pivot.userData.limbMesh = limb;
  return pivot;
}

// darken a hex toward black
function shade(hex, f) {
  const r = Math.min(255, Math.round(((hex >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((hex >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((hex & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}

// tapered torso: 4-radial-seg cylinder reads angular/PS1, not voxel
function makeTorso(topW, botW, depth, h, hex) {
  const g = cyl(topW / 2, botW / 2, h, 4);
  const m = new THREE.Mesh(g, mat(hex));
  m.rotation.y = Math.PI / 4; // square-ish silhouette
  m.scale.z = depth / Math.max(topW, botW);
  return m;
}

// assemble a humanoid rig. dims: {height, torsoW, shoulderW, hipW, bulk}
function assemble(dims, colors, opts = {}) {
  const H = dims.height;
  const bulk = dims.bulk ?? 1;
  const legLen = H * 0.46;
  const torsoH = H * 0.34;
  const headY = legLen + torsoH; // head pivot baseline
  const group = new THREE.Group();

  // torso
  const torso = makeTorso(dims.shoulderW * bulk, dims.hipW * bulk, dims.torsoW * bulk, torsoH, colors.shirt);
  torso.position.y = legLen + torsoH / 2;
  group.add(torso);

  // head
  const headG = makeHead(colors.skin, colors.hair, opts.head ?? {});
  headG.position.y = headY;
  group.add(headG);

  // arms (pivot at shoulder)
  const armLen = Math.min(0.5, H * 0.3);
  const armW = 0.09 * bulk;
  const armL = makeLimb(armW, armLen, armW, colors.shirt, colors.skin);
  const armR = makeLimb(armW, armLen, armW, colors.shirt, colors.skin);
  armL.position.set(-(dims.shoulderW / 2) * bulk - armW / 2, legLen + torsoH - 0.03, 0);
  armR.position.set((dims.shoulderW / 2) * bulk + armW / 2, legLen + torsoH - 0.03, 0);
  group.add(armL, armR);

  // legs (pivot at hip)
  const legW = 0.1 * bulk;
  const legL = makeLimb(legW, legLen, legW, colors.pants, 0x1a1512, 0.08);
  const legR = makeLimb(legW, legLen, legW, colors.pants, 0x1a1512, 0.08);
  legL.position.set(-dims.hipW * bulk * 0.28, legLen, 0);
  legR.position.set(dims.hipW * bulk * 0.28, legLen, 0);
  group.add(legL, legR);

  // skirt (dress/player)
  let skirt = null;
  if (opts.skirt) {
    skirt = new THREE.Mesh(
      cyl(dims.hipW * bulk * 0.42, dims.hipW * bulk * opts.skirt.flare * 0.5, opts.skirt.len, 4),
      mat(opts.skirt.hex)
    );
    skirt.rotation.y = Math.PI / 4;
    skirt.position.y = legLen - opts.skirt.len / 2 + 0.06;
    group.add(skirt);
  }

  // shoulder pads (angular undead silhouette)
  if (opts.shoulderPads) {
    const padGeo = box(0.16 * bulk, 0.07, 0.14 * bulk);
    const padMat = mat(opts.shoulderPads);
    const padL = new THREE.Mesh(padGeo, padMat);
    const padR = new THREE.Mesh(padGeo, padMat);
    padL.position.set(-(dims.shoulderW / 2) * bulk - 0.04, legLen + torsoH + 0.005, 0);
    padR.position.set((dims.shoulderW / 2) * bulk + 0.04, legLen + torsoH + 0.005, 0);
    padL.rotation.z = 0.35;
    padR.rotation.z = -0.35;
    group.add(padL, padR);
    group.userData.shoulderPads = [padL, padR];
  }

  const parts = { head: headG, torso, armL, armR, legL, legR };
  if (skirt) parts.skirt = skirt;

  group.userData.parts = parts;
  group.userData.baseY = group.position.y;
  group.userData.bloodable = {
    torso,
    head: headG.userData.headMesh,
    limbs: [armL.userData.limbMesh, armR.userData.limbMesh, legL.userData.limbMesh, legR.userData.limbMesh],
  };
  return group;
}

// ---------------------------------------------------------------------------
// public API

// undead woman — angular charcoal, long dark skirt, pale skin, dark hair
export function makePlayer() {
  const dims = { height: 1.78, torsoW: 0.3, shoulderW: 0.34, hipW: 0.3, bulk: 0.95 };
  const colors = { shirt: 0x18161a, pants: 0x141216, skin: 0xc9c2bb, hair: 0x14100e };
  const group = assemble(dims, colors, {
    skirt: { hex: 0x100e12, len: 0.62, flare: 2.0 },
    shoulderPads: 0x1e1b20,
  });
  group.userData.parts.head.rotation.x = 0.1; // slight forward head tilt
  group.userData.idleTilt = true;
  group.userData.kind = 'player';
  return group;
}

const RESIDENT_PALETTES = {
  flannel: { shirt: 0x5a3a32, pants: 0x3a3f4a },
  work:    { shirt: 0x4a4a42, pants: 0x33302a },
  suit:    { shirt: 0x2e2e33, pants: 0x26262b },
  sweater: { shirt: 0x54503f, pants: 0x3b3a36 },
  dress:   { shirt: 0x4f4653, pants: 0x4f4653 },
};
const SKINS = [0xc9a68a, 0xb08a6a, 0x8a6248, 0xd8b59a];
const HAIRS = [0x2a2018, 0x3a2c1c, 0x4a443c, 0x1a1512, 0x5a544c];
const BUILDS = { thin: 0.85, avg: 1.0, heavy: 1.22 };

export function makeResident(spec = {}) {
  const {
    gender = 'm',
    build = 'avg',
    height = 1.6 + Math.random() * 0.35,
    style = 'flannel',
  } = spec;
  const pal = spec.palette ?? {};
  const base = RESIDENT_PALETTES[style] ?? RESIDENT_PALETTES.flannel;
  const colors = {
    shirt: pal.shirt ?? base.shirt,
    pants: pal.pants ?? base.pants,
    skin: pal.skin ?? SKINS[(Math.random() * SKINS.length) | 0],
    hair: pal.hair ?? HAIRS[(Math.random() * HAIRS.length) | 0],
  };
  const bulk = BUILDS[build] ?? 1.0;
  const dims = {
    height,
    torsoW: 0.3,
    shoulderW: gender === 'f' ? 0.3 : 0.36,
    hipW: gender === 'f' ? 0.32 : 0.3,
    bulk,
  };
  const group = assemble(dims, colors, {
    skirt: style === 'dress' ? { hex: colors.shirt, len: height * 0.32, flare: 1.7 } : null,
  });
  group.userData.kind = 'resident';
  group.userData.spec = { gender, build, height, style };
  return group;
}

// black suit man, white shirt quad, black tie thin box
export function makePallbearer() {
  const group = assemble(
    { height: 1.86, torsoW: 0.32, shoulderW: 0.38, hipW: 0.31, bulk: 1.05 },
    { shirt: 0x131316, pants: 0x131316, skin: 0xb08a6a, hair: 0x1a1512 }
  );
  const parts = group.userData.parts;
  const torsoTopY = parts.torso.position.y + 0.29 / 2;

  // white shirt quad on the chest (+z)
  const shirtQ = new THREE.Mesh(plane(0.13, 0.17), mat(0xd8d4ce));
  shirtQ.position.set(0, torsoTopY + 0.05, 0.155);
  group.add(shirtQ);

  // black tie thin box over the shirt
  const tie = new THREE.Mesh(box(0.035, 0.15, 0.012), mat(0x0a0a0c));
  tie.position.set(0, torsoTopY + 0.04, 0.16);
  group.add(tie);

  group.userData.kind = 'pallbearer';
  return group;
}

// mutate a (woman) resident -> turned
export function applyTurn(group) {
  const ud = group.userData;
  if (ud.turned) return group;
  const parts = ud.parts;

  // near-black clothing (0x121214..0x1a1a1c range)
  const clothDark = [0x121214, 0x161618, 0x1a1a1c];
  const pick = () => clothDark[(Math.random() * clothDark.length) | 0];
  const recloth = (mesh) => { if (mesh) mesh.material = mat(pick()); };
  recloth(parts.torso);
  recloth(parts.skirt);
  recloth(parts.armL?.userData.limbMesh);
  recloth(parts.armR?.userData.limbMesh);
  recloth(parts.legL?.userData.limbMesh);
  recloth(parts.legR?.userData.limbMesh);

  // pale skin (head + hand/foot end boxes)
  const skinMat = mat(0xd8d4ce);
  if (parts.head?.userData.headMesh) parts.head.userData.headMesh.material = skinMat;
  for (const limb of [parts.armL, parts.armR, parts.legL, parts.legR]) {
    if (limb?.userData.endMesh) limb.userData.endMesh.material = skinMat;
  }

  // dark eye sockets: scale eye quads 1.8x, color 0x0a0a0a
  const socketMat = mat(0x0a0a0a);
  for (const eye of parts.head?.userData.eyes ?? []) {
    eye.scale.setScalar(1.8);
    eye.material = socketMat;
  }

  // sharpen shoulders: existing pads 1.25x, or add them
  if (ud.shoulderPads) {
    for (const p of ud.shoulderPads) p.scale.x *= 1.25;
  } else {
    const padGeo = box(0.2, 0.07, 0.16);
    const padMat = mat(0x1a1a1c);
    const topY = parts.torso.position.y + 0.17;
    const padL = new THREE.Mesh(padGeo, padMat);
    const padR = new THREE.Mesh(padGeo, padMat);
    padL.position.set(parts.armL.position.x, topY, 0);
    padR.position.set(parts.armR.position.x, topY, 0);
    padL.rotation.z = 0.35;
    padR.rotation.z = -0.35;
    group.add(padL, padR);
    ud.shoulderPads = [padL, padR];
  }

  parts.head.rotation.x = 0.12; // head tilt
  ud.turned = true;
  return group;
}

// walk cycle: arms/legs swing opposite, slight bob via userData.baseY
export function setWalkPhase(group, phase, speed = 1) {
  const parts = group.userData.parts;
  if (!parts) return;
  const ud = group.userData;
  if (ud.baseY == null) ud.baseY = group.position.y;
  const speedFactor = Math.min(1.4, Math.max(0.15, speed));
  const s = Math.sin(phase) * 0.5 * speedFactor;
  parts.armL.rotation.x = s;
  parts.armR.rotation.x = -s;
  parts.legL.rotation.x = -s;
  parts.legR.rotation.x = s;
  group.position.y = ud.baseY + Math.abs(Math.sin(phase)) * 0.035 * speedFactor;
}

// lying-down dead pose, arms splayed
export function setDeadPose(group) {
  const ud = group.userData;
  if (ud.dead) return group;
  const parts = ud.parts;
  group.rotation.z = -Math.PI / 2;
  group.position.y = (ud.baseY ?? 0) + 0.15;
  if (parts) {
    parts.armL.rotation.z = 0.6;
    parts.armR.rotation.z = -0.6;
    parts.armL.rotation.x = 0;
    parts.armR.rotation.x = 0;
    parts.legL.rotation.x = 0.12;
    parts.legR.rotation.x = -0.08;
    parts.legL.rotation.z = 0.1;
    parts.legR.rotation.z = -0.1;
    if (parts.head) parts.head.rotation.x = 0.2;
  }
  ud.dead = true;
  return group;
}
