// w4: character factory — era-authentic low-poly humans (~420-650 tris each)
// Readable at 10m: jaw-tapered 5x4 sphere heads (NOT cubes), 32px procedural
// face textures (nearest-filtered) layered with geometry brow/nose/eyes/mouth,
// per-archetype hair, tapered 5-seg torsos, two-segment arms/legs, necks.
// Contract (consumed by game/*): exports mat/makePlayer/makeResident/
// makePallbearer/applyTurn/setWalkPhase/setDeadPose;
// userData.parts={head,torso,armL,armR,legL,legR,skirt?} where head is a Group
// with userData.{headMesh,faceMesh,eyes,sclera,neck,nose} and each limb pivot
// Group carries userData.{limbMesh,foreMesh,endMesh,elbow|knee};
// userData.bloodable={torso,head,limbs}.
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
function cyl(rt, rb, h, seg, open = false) {
  const k = `c${rt},${rb},${h},${seg},${open}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.CylinderGeometry(rt, rb, h, seg, 1, open));
  return geoCache.get(k);
}
function plane(w, h) {
  const k = `p${w},${h}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.PlaneGeometry(w, h));
  return geoCache.get(k);
}
function sphere(r, ws, hs, ps = 0, pl = Math.PI * 2, ts = 0, tl = Math.PI) {
  const k = `s${r},${ws},${hs},${ps},${pl},${ts},${tl}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.SphereGeometry(r, ws, hs, ps, pl, ts, tl));
  return geoCache.get(k);
}
function cone(r, h, seg) {
  const k = `k${r},${h},${seg}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.ConeGeometry(r, h, seg));
  return geoCache.get(k);
}

// darken a hex toward black
function shade(hex, f) {
  const r = Math.min(255, Math.round(((hex >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((hex >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((hex & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}

// ---------------------------------------------------------------------------
// head shaping: 5x4 sphere, taller than wide, jaw taper below 40% height
const HEAD_R = 0.115, HEAD_SX = 0.95, HEAD_SY = 1.18, HEAD_SZ = 1.0;
const HEAD_CY = 0.135; // head center offset within the head Group (neck base = 0)

function jawTaper(yn) {
  return yn < 0.4 ? 1 - 0.2 * Math.min(1, (0.4 - yn) / 1.4) : 1;
}
function shapeHeadGeo(g) {
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const f = jawTaper(y / HEAD_R);
    pos.setXYZ(i, x * f * HEAD_SX, y * HEAD_SY, z * f * HEAD_SZ);
  }
  g.computeVertexNormals();
  return g;
}
function headGeo() {
  const k = 'head5x4';
  if (!geoCache.has(k)) geoCache.set(k, shapeHeadGeo(new THREE.SphereGeometry(HEAD_R, 5, 4)));
  return geoCache.get(k);
}
// face plate: partial sphere shell over the front of the face, carries the
// 32px face texture. UVs normalize to the patch: canvas top = brow, bottom = chin.
const FACE_TS = 0.2 * Math.PI, FACE_TL = 0.56 * Math.PI;   // theta: 36°..136.8°
const FACE_PS = Math.PI / 2 - 0.68, FACE_PL = 1.36;        // phi: ±39° of +z
function facePlateGeo() {
  const k = 'faceplate';
  if (!geoCache.has(k)) {
    const g = new THREE.SphereGeometry(HEAD_R + 0.0025, 5, 3, FACE_PS, FACE_PL, FACE_TS, FACE_TL);
    geoCache.set(k, shapeHeadGeo(g));
  }
  return geoCache.get(k);
}
// world-space point on the shaped head surface (rel head center); phi 90° = +z front
function headSurface(thetaDeg, phiDeg, out = new THREE.Vector3()) {
  const t = (thetaDeg * Math.PI) / 180, p = (phiDeg * Math.PI) / 180;
  let x = -Math.cos(p) * Math.sin(t) * HEAD_R;
  const y = Math.cos(t) * HEAD_R;
  let z = Math.sin(p) * Math.sin(t) * HEAD_R;
  const f = jawTaper(y / HEAD_R);
  return out.set(x * f * HEAD_SX, y * HEAD_SY, z * f * HEAD_SZ);
}

// ---------------------------------------------------------------------------
// procedural 32px face textures (nearest-filtered, era-correct).
// Drawn near-white: material color = skin hex multiplies through.
// Variants: man, woman, player (pale), turned (dark sockets).
const faceTexCache = new Map();
function faceTexture(variant) {
  if (faceTexCache.has(variant)) return faceTexCache.get(variant);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const c = cv.getContext('2d');
  const base = { man: '#ece5dc', woman: '#f0e8df', player: '#eae6e2', turned: '#dcd8d2' }[variant] ?? '#ece5dc';
  c.fillStyle = base;
  c.fillRect(0, 0, 32, 32);
  const ell = (x, y, rx, ry, col, a) => {
    c.globalAlpha = a; c.fillStyle = col;
    c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 1;
  };
  // cheek shading (era vertex-band substitute: soft darker patches)
  const cheekA = variant === 'turned' ? 0.5 : variant === 'player' ? 0.42 : 0.22;
  ell(5.5, 19, 4, 3.6, '#8a7f76', cheekA);
  ell(26.5, 19, 4, 3.6, '#8a7f76', cheekA);
  // brow band (geometry brow ridge sits over this)
  c.globalAlpha = variant === 'woman' ? 0.16 : variant === 'man' ? 0.3 : 0.36;
  c.fillStyle = '#7a7068';
  c.fillRect(3, 10, 26, 3);
  c.globalAlpha = 1;
  // eyes at canvas (6.6,15.2)/(25.4,15.2) to align with geometry eyes
  if (variant === 'turned') {
    ell(6.6, 15.2, 3.8, 3.2, '#0c0a0a', 0.95);
    ell(25.4, 15.2, 3.8, 3.2, '#0c0a0a', 0.95);
    ell(6.6, 18.5, 1.6, 2.6, '#3a3430', 0.4); // socket tear streaks
    ell(25.4, 18.5, 1.6, 2.6, '#3a3430', 0.4);
  } else {
    const socketA = variant === 'player' ? 0.6 : 0.45;
    ell(6.6, 15.2, 3.2, 2.6, '#4a4038', socketA);
    ell(25.4, 15.2, 3.2, 2.6, '#4a4038', socketA);
    ell(6.6, 15.2, 2.1, 1.6, '#e9e2d8', 0.9);  // sclera hint ring
    ell(25.4, 15.2, 2.1, 1.6, '#e9e2d8', 0.9);
    ell(6.6, 15.4, 0.85, 1.0, '#181210', 0.95); // pupil
    ell(25.4, 15.4, 0.85, 1.0, '#181210', 0.95);
  }
  // nose shadow under the geometry wedge
  ell(16, 19.5, 1.5, 2.4, '#8a7f76', 0.3);
  // mouth line
  const mouthCol = { woman: '#a06a5c', player: '#5e4c52', turned: '#3a3434', man: '#4a3c34' }[variant];
  c.globalAlpha = variant === 'turned' ? 0.55 : 0.7;
  c.fillStyle = mouthCol;
  c.fillRect(12, 22.5, 8, 1.4);
  c.globalAlpha = 1;
  if (variant === 'woman') { // blush
    ell(8, 18, 2.4, 1.6, '#c08a76', 0.16);
    ell(24, 18, 2.4, 1.6, '#c08a76', 0.16);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  faceTexCache.set(variant, tex);
  return tex;
}
// face materials cached per (variant, skin hex) — map multiplies skin color
const faceMatCache = new Map();
function faceMat(variant, skinHex) {
  const k = `${variant}:${skinHex}`;
  if (!faceMatCache.has(k)) {
    faceMatCache.set(k, new THREE.MeshLambertNodeMaterial({ color: skinHex, map: faceTexture(variant) }));
  }
  return faceMatCache.get(k);
}

// ---------------------------------------------------------------------------
// head assembly: tapered sphere + face plate + brow/nose/eyes/mouth + neck
function makeHead(skinHex, faceVariant = 'man') {
  const g = new THREE.Group();
  const skin = mat(skinHex);

  const head = new THREE.Mesh(headGeo(), skin);
  head.position.y = HEAD_CY;
  g.add(head);

  const face = new THREE.Mesh(facePlateGeo(), faceMat(faceVariant, skinHex));
  face.position.y = HEAD_CY;
  g.add(face);

  // neck
  const neck = new THREE.Mesh(cyl(0.042, 0.052, 0.085, 5), skin);
  neck.position.y = 0.005;
  g.add(neck);

  // orient a mesh to face outward along the surface normal at its position
  const norm = new THREE.Vector3();
  const place = (mesh, thetaDeg, phiDeg, lift = 0.004) => {
    const p = headSurface(thetaDeg, phiDeg);
    norm.copy(p).normalize();
    mesh.position.set(p.x + norm.x * lift, HEAD_CY + p.y + norm.y * lift, p.z + norm.z * lift);
    mesh.lookAt(mesh.position.x + norm.x, mesh.position.y + norm.y, mesh.position.z + norm.z);
    g.add(mesh);
    return mesh;
  };

  // brow ridge: thin box spanning both eyes
  const brow = new THREE.Mesh(box(0.15, 0.022, 0.02), mat(shade(skinHex, 0.72)));
  place(brow, 70, 90, 0.002);

  // nose: tiny 4-seg wedge pointing outward
  const nose = new THREE.Mesh(cone(0.014, 0.045, 4), skin);
  const np = headSurface(93, 90);
  norm.copy(np).normalize();
  nose.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), norm);
  nose.position.set(np.x + norm.x * 0.016, HEAD_CY + np.y + norm.y * 0.016, np.z + norm.z * 0.016);
  g.add(nose);

  // eyes: pale sclera quad behind an inset dark sphere (readable at 10m)
  const scleraMat = mat(0xe9e2d8);
  const eyeMat = mat(0x14100e);
  const sclera = [], eyes = [];
  for (const side of [-1, 1]) {
    const q = new THREE.Mesh(plane(0.05, 0.034), scleraMat);
    place(q, 84, 90 + side * 23.5, 0.002);
    sclera.push(q);
    const e = new THREE.Mesh(sphere(0.0135, 4, 3), eyeMat);
    place(e, 84, 90 + side * 23.5, 0.006);
    eyes.push(e);
  }

  // mouth line: thin dark box
  const mouth = new THREE.Mesh(box(0.058, 0.009, 0.012), mat(0x2a1e1a));
  place(mouth, 107, 90, 0.003);

  g.userData.headMesh = head;
  g.userData.faceMesh = face;
  g.userData.neck = neck;
  g.userData.nose = nose;
  g.userData.eyes = eyes;
  g.userData.sclera = sclera;
  return g;
}

// ---------------------------------------------------------------------------
// hair — distinct silhouette per archetype (all parented to the head Group)
function hairShellGeo() { // player: flattened elongated shell over back of head
  const k = 'hairlong';
  if (!geoCache.has(k)) {
    const g = new THREE.SphereGeometry(0.126, 5, 4, 0, Math.PI * 2, 0, Math.PI * 0.62);
    g.scale(1.0, 1.32, 1.06);
    geoCache.set(k, g);
  }
  return geoCache.get(k);
}
function hairCapGeo() { // short crop cap
  const k = 'haircrop';
  if (!geoCache.has(k)) {
    const g = new THREE.SphereGeometry(0.126, 5, 3, 0, Math.PI * 2, 0, Math.PI * 0.52);
    g.scale(0.98, 0.78, 1.04);
    geoCache.set(k, g);
  }
  return geoCache.get(k);
}
const CAP_HEXS = [0x3a3f4a, 0x4a4438, 0x2e2e33, 0x33302a];
export function addHair(headG, style, hairHex, capHex = null) {
  const hm = mat(hairHex);
  const cy = HEAD_CY;
  const add = (mesh) => { headG.add(mesh); return mesh; };
  switch (style) {
    case 'long': { // player: long dark shell + two front strands
      const shell = add(new THREE.Mesh(hairShellGeo(), hm));
      shell.position.set(0, cy + 0.02, -0.03);
      const strandG = box(0.034, 0.26, 0.018);
      const sL = add(new THREE.Mesh(strandG, hm));
      sL.position.set(-0.096, cy - 0.055, 0.055);
      sL.rotation.set(-0.06, 0, 0.07);
      const sR = add(new THREE.Mesh(strandG, hm));
      sR.position.set(0.096, cy - 0.055, 0.055);
      sR.rotation.set(-0.06, 0, -0.07);
      break;
    }
    case 'crop': { // men: short crop
      const cap = add(new THREE.Mesh(hairCapGeo(), hm));
      cap.position.y = cy + 0.052;
      break;
    }
    case 'cap': { // men: worker cap with brim
      const cm = mat(capHex ?? CAP_HEXS[(Math.random() * CAP_HEXS.length) | 0]);
      const crown = add(new THREE.Mesh(cyl(0.112, 0.12, 0.055, 6), cm));
      crown.position.y = cy + 0.128;
      const brim = add(new THREE.Mesh(box(0.13, 0.014, 0.085), cm));
      brim.position.set(0, cy + 0.104, 0.1);
      brim.rotation.x = 0.08;
      break;
    }
    case 'baldHat': { // men: bald + fedora-ish hat (skin crown stays visible)
      const cm = mat(capHex ?? 0x2a2724);
      const brim = add(new THREE.Mesh(cyl(0.185, 0.185, 0.013, 8), cm));
      brim.position.y = cy + 0.092;
      const dome = add(new THREE.Mesh(cyl(0.094, 0.108, 0.085, 6), cm));
      dome.position.y = cy + 0.138;
      break;
    }
    case 'bun': { // women: crop + bun sphere at back-top
      const cap = add(new THREE.Mesh(hairCapGeo(), hm));
      cap.position.y = cy + 0.052;
      const bun = add(new THREE.Mesh(sphere(0.052, 4, 3), hm));
      bun.position.set(0, cy + 0.1, -0.115);
      break;
    }
    case 'ponytail': { // women: crop + tail box angled down the back
      const cap = add(new THREE.Mesh(hairCapGeo(), hm));
      cap.position.y = cy + 0.052;
      const tie = add(new THREE.Mesh(sphere(0.042, 4, 3), hm));
      tie.position.set(0, cy + 0.115, -0.105);
      const tail = add(new THREE.Mesh(box(0.05, 0.2, 0.035), hm));
      tail.position.set(0, cy + 0.01, -0.145);
      tail.rotation.x = -0.22;
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// limbs: two segments meeting at elbow/knee, hand/foot at the end.
// pivot Group userData: {limbMesh, foreMesh, endMesh, elbow|knee}
function makeArm(w, len, sleeveHex, skinHex) {
  const upper = len * 0.52, fore = len * 0.42;
  const pivot = new THREE.Group();
  const up = new THREE.Mesh(box(w, upper, w), mat(sleeveHex));
  up.position.y = -upper / 2;
  pivot.add(up);
  const elbow = new THREE.Group();
  elbow.position.y = -upper;
  elbow.rotation.x = -0.12; // natural slight bend
  pivot.add(elbow);
  const fo = new THREE.Mesh(box(w * 0.85, fore, w * 0.85), mat(sleeveHex));
  fo.position.y = -fore / 2;
  elbow.add(fo);
  const hand = new THREE.Mesh(box(0.065, 0.075, 0.065), mat(skinHex));
  hand.position.y = -fore - 0.028;
  elbow.add(hand);
  pivot.userData = { limbMesh: up, foreMesh: fo, endMesh: hand, elbow };
  return pivot;
}
function makeLeg(w, len, pantsHex) {
  const thigh = len * 0.5, shin = len * 0.44;
  const pivot = new THREE.Group();
  const th = new THREE.Mesh(box(w * 1.15, thigh, w * 1.15), mat(pantsHex));
  th.position.y = -thigh / 2;
  pivot.add(th);
  const knee = new THREE.Group();
  knee.position.y = -thigh;
  pivot.add(knee);
  const sh = new THREE.Mesh(box(w * 0.9, shin, w * 0.9), mat(pantsHex));
  sh.position.y = -shin / 2;
  knee.add(sh);
  const foot = new THREE.Mesh(box(w * 0.95, 0.055, 0.15), mat(0x1a1512)); // shoe, forward box
  foot.position.set(0, -shin - 0.028, 0.045);
  knee.add(foot);
  pivot.userData = { limbMesh: th, foreMesh: sh, endMesh: foot, knee };
  return pivot;
}

// tapered torso: 5-radial-seg cylinder, flat face front (+z), z-squashed for depth
function torsoGeo(topW, botW, depth, h) {
  const k = `t${topW},${botW},${depth},${h}`;
  if (!geoCache.has(k)) {
    const g = new THREE.CylinderGeometry(topW / 2, botW / 2, h, 5, 1);
    g.rotateY(Math.PI / 5); // flat pentagon face to +z
    g.scale(1, 1, depth / Math.max(topW, botW));
    geoCache.set(k, g);
  }
  return geoCache.get(k);
}

// ---------------------------------------------------------------------------
// assemble a humanoid. dims: {height, torsoW, shoulderW, hipW, bulk}
// colors: {shirt, pants, skin, hair}
// opts: {face, hairStyle, capHex, skirt:{hex,len,flare,tatter}, shoulderPads}
function assemble(dims, colors, opts = {}) {
  const H = dims.height;
  const bulk = dims.bulk ?? 1;
  const legLen = H * 0.46;
  const torsoH = H * 0.34;
  const shoulderY = legLen + torsoH - 0.03;
  const headY = legLen + torsoH;
  const group = new THREE.Group();

  // torso
  const torso = new THREE.Mesh(
    torsoGeo(dims.shoulderW * bulk, dims.hipW * bulk, dims.torsoW * bulk, torsoH),
    mat(colors.shirt)
  );
  torso.position.y = legLen + torsoH / 2;
  group.add(torso);

  // hip block (hidden under skirt when present)
  let hip = null;
  if (!opts.skirt) {
    hip = new THREE.Mesh(
      box(dims.hipW * bulk * 0.98, 0.1, dims.torsoW * bulk * 0.62),
      mat(colors.pants)
    );
    hip.position.y = legLen + 0.02;
    group.add(hip);
  }

  // shoulder definition: actual shoulder boxes for every archetype
  const shGeo = box(0.1 * bulk + 0.035, 0.055, 0.09 * bulk + 0.02);
  const shMat = mat(colors.shirt);
  const shL = new THREE.Mesh(shGeo, shMat);
  const shR = new THREE.Mesh(shGeo, shMat);
  shL.position.set(-dims.shoulderW * bulk * 0.42, shoulderY + 0.012, 0);
  shR.position.set(dims.shoulderW * bulk * 0.42, shoulderY + 0.012, 0);
  shL.rotation.z = 0.1;
  shR.rotation.z = -0.1;
  group.add(shL, shR);

  // head + hair
  const headG = makeHead(colors.skin, opts.face ?? 'man');
  headG.position.y = headY;
  group.add(headG);
  if (opts.hairStyle) addHair(headG, opts.hairStyle, colors.hair, opts.capHex);

  // arms (pivot at shoulder)
  const armLen = Math.min(0.5, H * 0.3);
  const armW = 0.09 * bulk;
  const armL = makeArm(armW, armLen, colors.shirt, colors.skin);
  const armR = makeArm(armW, armLen, colors.shirt, colors.skin);
  armL.position.set(-(dims.shoulderW / 2) * bulk - armW / 2, shoulderY, 0);
  armR.position.set((dims.shoulderW / 2) * bulk + armW / 2, shoulderY, 0);
  group.add(armL, armR);

  // legs (pivot at hip)
  const legW = 0.1 * bulk;
  const legL = makeLeg(legW, legLen, colors.pants);
  const legR = makeLeg(legW, legLen, colors.pants);
  legL.position.set(-dims.hipW * bulk * 0.28, legLen, 0);
  legR.position.set(dims.hipW * bulk * 0.28, legLen, 0);
  group.add(legL, legR);

  // skirt (dress/player): flared 5-seg cone, optional tattered hem panels
  let skirt = null;
  if (opts.skirt) {
    const sk = opts.skirt;
    const topR = dims.hipW * bulk * 0.42;
    const botR = dims.hipW * bulk * sk.flare * 0.5;
    skirt = new THREE.Mesh(cyl(topR, botR, sk.len, 5, true), mat(sk.hex));
    skirt.rotation.y = Math.PI / 5;
    skirt.position.y = legLen - sk.len / 2 + 0.06;
    group.add(skirt);
    if (sk.tatter) {
      const notchMat = mat(shade(sk.hex, 0.4));
      const hemR = topR + (botR - topR) * 0.82;
      [0.45, 2.5, 4.35].forEach((a, i) => {
        const notch = new THREE.Mesh(box(0.055, 0.12 + i * 0.02, 0.014), notchMat);
        notch.position.set(
          Math.sin(a) * hemR * 0.99,
          skirt.position.y - sk.len * 0.3,
          Math.cos(a) * hemR * 0.99
        );
        notch.rotation.y = a;
        notch.rotation.x = -0.14; // match cone slope
        group.add(notch);
      });
    }
  }

  // sharp angular shoulder pieces (player; turned get them via applyTurn)
  if (opts.shoulderPads) {
    const padGeo = box(0.17 * bulk, 0.06, 0.14 * bulk);
    const padMat = mat(opts.shoulderPads);
    const padL = new THREE.Mesh(padGeo, padMat);
    const padR = new THREE.Mesh(padGeo, padMat);
    padL.position.set(-(dims.shoulderW / 2) * bulk - 0.045, shoulderY + 0.035, 0);
    padR.position.set((dims.shoulderW / 2) * bulk + 0.045, shoulderY + 0.035, 0);
    padL.rotation.z = 0.5;
    padR.rotation.z = -0.5;
    group.add(padL, padR);
    group.userData.shoulderPads = [padL, padR];
  }

  const parts = { head: headG, torso, armL, armR, legL, legR };
  if (skirt) parts.skirt = skirt;

  group.userData.parts = parts;
  group.userData.baseY = group.position.y;
  group.userData.headBaseY = headY;
  group.userData.bloodable = {
    torso,
    head: headG.userData.headMesh,
    limbs: [
      armL.userData.limbMesh, armL.userData.foreMesh,
      armR.userData.limbMesh, armR.userData.foreMesh,
      legL.userData.limbMesh, legL.userData.foreMesh,
      legR.userData.limbMesh, legR.userData.foreMesh,
    ],
  };
  return group;
}

// ---------------------------------------------------------------------------
// public API

// undead woman — pale skin, near-black clothes, long dark hair,
// sharp angular shoulders, tattered skirt: goth, sharp, 'wrong'.
export function makePlayer() {
  const dims = { height: 1.78, torsoW: 0.3, shoulderW: 0.34, hipW: 0.3, bulk: 0.95 };
  const colors = { shirt: 0x18161a, pants: 0x141216, skin: 0xc9c2bb, hair: 0x14100e };
  const group = assemble(dims, colors, {
    face: 'player',
    hairStyle: 'long',
    skirt: { hex: 0x100e12, len: 0.62, flare: 2.0, tatter: true },
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
const HAIR_M = ['crop', 'cap', 'baldHat'];
const HAIR_F = ['bun', 'ponytail'];

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
  const hairStyle = spec.hair
    ?? (gender === 'f' ? HAIR_F[(Math.random() * HAIR_F.length) | 0]
                       : HAIR_M[(Math.random() * HAIR_M.length) | 0]);
  const group = assemble(dims, colors, {
    face: gender === 'f' ? 'woman' : 'man',
    hairStyle,
    skirt: style === 'dress' ? { hex: colors.shirt, len: height * 0.32, flare: 1.7 } : null,
  });
  group.userData.kind = 'resident';
  group.userData.spec = { gender, build, height, style, hair: hairStyle };
  return group;
}

// black suit man, white shirt quad, black tie thin box
export function makePallbearer() {
  const H = 1.86, bulk = 1.05;
  const group = assemble(
    { height: H, torsoW: 0.32, shoulderW: 0.38, hipW: 0.31, bulk },
    { shirt: 0x131316, pants: 0x131316, skin: 0xb08a6a, hair: 0x1a1512 },
    { face: 'man', hairStyle: 'crop' }
  );
  // chest-front z of the z-squashed 5-seg torso (flat pentagon face, cos(36°))
  const legLen = H * 0.46, torsoH = H * 0.34;
  const topR = (0.38 * bulk) / 2;
  const zScale = (0.32 * bulk) / (0.38 * bulk);
  const chestZ = topR * Math.cos(Math.PI / 5) * zScale;
  const chestY = legLen + torsoH - 0.13;

  const shirtQ = new THREE.Mesh(plane(0.13, 0.17), mat(0xd8d4ce));
  shirtQ.position.set(0, chestY, chestZ + 0.006);
  group.add(shirtQ);

  const tie = new THREE.Mesh(box(0.035, 0.15, 0.012), mat(0x0a0a0c));
  tie.position.set(0, chestY - 0.01, chestZ + 0.012);
  group.add(tie);

  group.userData.kind = 'pallbearer';
  return group;
}

// mutate a resident -> turned: near-black clothing, pale skin, dark sockets,
// sharpened shoulders, head tilt, turned face texture
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
  for (const limb of [parts.armL, parts.armR, parts.legL, parts.legR]) {
    recloth(limb?.userData.limbMesh);
    recloth(limb?.userData.foreMesh);
  }

  // pale skin: head sphere, neck, nose, hands + feet end boxes
  const pale = 0xd8d4ce;
  const skinMat = mat(pale);
  const hd = parts.head?.userData ?? {};
  if (hd.headMesh) hd.headMesh.material = skinMat;
  if (hd.neck) hd.neck.material = skinMat;
  if (hd.nose) hd.nose.material = skinMat;
  if (hd.faceMesh) hd.faceMesh.material = faceMat('turned', pale);
  for (const limb of [parts.armL, parts.armR, parts.legL, parts.legR]) {
    if (limb?.userData.endMesh) limb.userData.endMesh.material = skinMat;
  }

  // dark eye sockets: geometry eyes 1.8x + black, sclera quads darkened
  const socketMat = mat(0x0a0a0a);
  for (const eye of hd.eyes ?? []) {
    eye.scale.setScalar(1.8);
    eye.material = socketMat;
  }
  const deadSclera = mat(0x241f1c);
  for (const q of hd.sclera ?? []) q.material = deadSclera;

  // sharpen shoulders: existing pads 1.25x, or add angular pieces
  if (ud.shoulderPads) {
    for (const p of ud.shoulderPads) p.scale.x *= 1.25;
  } else {
    const padGeo = box(0.2, 0.06, 0.16);
    const padMat = mat(0x1a1a1c);
    const topY = parts.armR.position.y + 0.05;
    const padL = new THREE.Mesh(padGeo, padMat);
    const padR = new THREE.Mesh(padGeo, padMat);
    padL.position.set(parts.armL.position.x, topY, 0);
    padR.position.set(parts.armR.position.x, topY, 0);
    padL.rotation.z = 0.5;
    padR.rotation.z = -0.5;
    group.add(padL, padR);
    ud.shoulderPads = [padL, padR];
  }

  parts.head.rotation.x = 0.12; // head tilt
  ud.turned = true;
  return group;
}

// walk cycle: arms/legs swing opposite at shoulder/hip pivots, elbows/knees
// bend with the stride, slight torso lean + head bob, group bob via baseY
export function setWalkPhase(group, phase, speed = 1) {
  const parts = group.userData.parts;
  if (!parts) return;
  const ud = group.userData;
  if (ud.baseY == null) ud.baseY = group.position.y;
  const f = Math.min(1.4, Math.max(0.15, speed));
  const s = Math.sin(phase) * 0.5 * f;
  parts.armL.rotation.x = s;
  parts.armR.rotation.x = -s;
  parts.legL.rotation.x = -s;
  parts.legR.rotation.x = s;
  if (parts.armL.userData.elbow) parts.armL.userData.elbow.rotation.x = -0.12 - Math.abs(s) * 0.4;
  if (parts.armR.userData.elbow) parts.armR.userData.elbow.rotation.x = -0.12 - Math.abs(s) * 0.4;
  if (parts.legL.userData.knee) parts.legL.userData.knee.rotation.x = Math.max(0, s) * 0.7;
  if (parts.legR.userData.knee) parts.legR.userData.knee.rotation.x = Math.max(0, -s) * 0.7;
  if (parts.torso) parts.torso.rotation.x = 0.045 * f; // slight forward lean
  if (parts.head && ud.headBaseY != null) {
    parts.head.position.y = ud.headBaseY + Math.abs(Math.sin(phase)) * 0.018 * f; // head bob
  }
  group.position.y = ud.baseY + Math.abs(Math.sin(phase)) * 0.035 * f;
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
    if (parts.armL.userData.elbow) parts.armL.userData.elbow.rotation.x = -0.3;
    if (parts.armR.userData.elbow) parts.armR.userData.elbow.rotation.x = -0.25;
    if (parts.head) parts.head.rotation.x = 0.2;
  }
  ud.dead = true;
  return group;
}
