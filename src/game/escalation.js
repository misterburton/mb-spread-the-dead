// w3: escalation — stage-driven town behavior (the ladder's teeth).
// Reacts to gameState.state.stage (0 oblivious .. 4 cordon) via
// gameState.onChange((what) => ...) plus continuous, think-staggered
// behaviors (same cadence pattern as residents.js / horde.js):
//
//   1 suspicious : residents cluster — idle/walk residents drift toward the
//                  nearest other living resident within 10m (safety in
//                  numbers); walk speed +20%.
//   2 armed      : 1 in 4 men get a visible rifle (thin dark box on the armR
//                  pivot). Armed men within CFG.npc.sightRange of the player
//                  AIM (face her, raise the rifle arm); if the player stays
//                  within 8m for >2.5s cumulative they FIRE — rot damage 25,
//                  muzzle flash quad, onPlayerShot() hook for the audio layer.
//                  Aiming men stay in 'idle' state on purpose, so the player
//                  can still kill them (interactions.js targets idle/walk/flee).
//   3 screening  : living residents within 6m of a turned woman flee from HER;
//                  pallbearers hunt the nearest turned woman and destroy her
//                  on contact (state='dead', setDeadPose, hordeLost(), decal).
//   4 cordon     : striped roadblocks spawn at the 4 avenue endpoints and a
//                  90s countdown starts; at timeout the run ends as 'cordon'.
//
// Perf: per-frame work is O(N) timer decrements + O(armed) aim checks; every
// neighbor scan happens inside a staggered think — no per-frame all-pairs.
import * as THREE from 'three/webgpu';
import { mat, setWalkPhase, setDeadPose } from '../characters/factory.js';

const CLUSTER_R2 = 10 * 10;      // stage1: neighbor search radius (m, squared)
const CLUSTER_STOP = 1.5;        // stage1: close enough — stop drifting
const CLUSTER_SPEED_MUL = 1.2;   // stage1: walk speed bonus
const FIRE_R2 = 8 * 8;           // stage2: cumulative linger radius (squared)
const FIRE_SEC = 2.5;            // stage2: cumulative aim time before a shot
const SHOT_ROT_DAMAGE = 25;      // stage2: rot damage per hit
const AIM_ARM_X = -1.35;         // stage2: armR pitch when aiming (rad)
const SCREEN_R2 = 6 * 6;         // stage3: flee turned women within this (sq)
const PAL_CONTACT2 = 0.9 * 0.9;  // stage3: pallbearer destroy radius (sq)
const PAL_SPEED_MUL = 1.15;      // stage3: pallbearer hunt speed bonus
const CORDON_SEC = 90;           // stage4: grace period before the town falls
const FLASH_SEC = 0.07;          // muzzle flash lifetime
const MUZZLE_Y = 1.35;           // flash height (~shoulder)

export function createEscalation({ residents, town, gameState, CFG, gore, player }) {
  // accept either the createResidents() return ({list, ...}) or a raw array
  const list = residents.list ?? residents;
  const thinkInterval = 1 / CFG.npc.thinkHz;
  const walkSpeed = CFG.npc.walkSpeed;
  const fleeSpeed = CFG.npc.fleeSpeed;
  const sightRange2 = CFG.npc.sightRange * CFG.npc.sightRange;
  const R = CFG.town.worldRadius;

  // perf harness: set by main.js when ?perf=1 — escThink bodies add into thinkMs
  const perf = (typeof window !== 'undefined' && window.__perf) || null;

  // staggered escalation thinks (offset by index, like residents.js)
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    r.escTimer = (i / list.length) * thinkInterval;
    r.armed = false;
    r.aiming = false;
  }

  const isLiving = (r) => r.state === 'idle' || r.state === 'walk' || r.state === 'flee';

  // nearest resident matching pred within sqrt(r2); O(N) — think-time only
  const nearest = (pos, r2, pred) => {
    let best = null, bd2 = r2;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!pred(o)) continue;
      const dx = o.group.position.x - pos.x;
      const dz = o.group.position.z - pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd2) { bd2 = d2; best = o; }
    }
    return best ? { r: best, d: Math.sqrt(bd2) } : null;
  };

  // jittered heading directly away from (wx, wz), 10m out (mirrors residents.js)
  const fleeFrom = (r, wx, wz) => {
    const pos = r.group.position;
    const dx = pos.x - wx, dz = pos.z - wz;
    const len = Math.hypot(dx, dz) || 1;
    const j = (Math.random() - 0.5) * 1.2;
    const c = Math.cos(j), s = Math.sin(j);
    r.target.x = pos.x + ((dx / len) * c - (dz / len) * s) * 10;
    r.target.z = pos.z + ((dx / len) * s + (dz / len) * c) * 10;
    r.state = 'flee';
    r.speed = fleeSpeed;
    r.fleeTimer = 3;
    r.stuckTicks = 0;
    r.lastDist = Infinity;
  };

  // --- stage 2: rifles -------------------------------------------------------
  const rifleGeo = new THREE.BoxGeometry(0.06, 0.06, 0.9);
  const rifleMat = mat(0x141009);
  const armed = []; // { r, aimTime }

  const attachRifle = (r) => {
    const armR = r.group.userData.parts?.armR;
    if (!armR) return;
    const rifle = new THREE.Mesh(rifleGeo, rifleMat);
    // lies along the hanging arm; points forward when the arm is raised
    rifle.rotation.x = Math.PI / 2;
    rifle.position.set(0, -0.42, 0.06);
    armR.add(rifle); // directly on the armR pivot group — swings with the arm
    r.rifle = rifle;
  };

  let armedDone = false;
  const armMen = () => {
    if (armedDone) return;
    armedDone = true;
    let mi = 0;
    for (const r of list) {
      if (r.role !== 'man') continue;
      if (mi++ % 4 !== 0) continue; // 1 in 4
      if (!isLiving(r)) continue;   // don't arm a corpse / mid-take
      attachRifle(r);
      r.armed = true;
      armed.push({ r, aimTime: 0 });
    }
  };

  // --- muzzle flash pool (4 quads, reused) -----------------------------------
  const flashMat = new THREE.MeshBasicNodeMaterial({
    color: 0xffe9a8, transparent: true, opacity: 1, side: THREE.DoubleSide,
  });
  const flashes = [];
  for (let i = 0; i < 4; i++) {
    const q = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), flashMat);
    q.visible = false;
    town.group.add(q);
    flashes.push({ mesh: q, t: 0 });
  }
  const flashAt = (x, y, z, yaw) => {
    for (const f of flashes) {
      if (f.t > 0) continue;
      f.t = FLASH_SEC;
      f.mesh.position.set(x, y, z);
      f.mesh.rotation.set(0, yaw, Math.random() * Math.PI);
      f.mesh.visible = true;
      return;
    }
  };

  const api = { update, onPlayerShot: null };

  const fire = (m, dist) => {
    m.aimTime = 0; // cumulative clock resets after each shot
    const r = m.r;
    const pos = r.group.position;
    const yaw = r.group.rotation.y;
    const mx = pos.x + Math.sin(yaw) * 0.75;
    const mz = pos.z + Math.cos(yaw) * 0.75;
    flashAt(mx, MUZZLE_Y, mz, yaw);
    gameState.state.rot = Math.max(0, gameState.state.rot - SHOT_ROT_DAMAGE);
    if (api.onPlayerShot) {
      api.onPlayerShot({ x: mx, y: MUZZLE_Y, z: mz, distance: dist, shooter: r });
    }
  };

  // per-frame armed behavior — small list (≤8), no scans
  const updateArmed = (dt) => {
    for (let i = 0; i < armed.length; i++) {
      const m = armed[i];
      const r = m.r;
      if (r.state === 'dead' || r.state === 'taken') { r.aiming = false; continue; }
      const pos = r.group.position;
      const dx = player.position.x - pos.x;
      const dz = player.position.z - pos.z;
      const d2 = dx * dx + dz * dz;
      const canAim = r.state === 'idle' || r.state === 'walk';
      if (canAim && d2 <= sightRange2) {
        // AIM: stand, face her, raise the rifle arm. Stays 'idle' so the
        // player can still close in and kill him (threat is removable).
        r.aiming = true;
        if (r.state === 'walk') r.state = 'idle';
        r.idleTimer = Math.max(r.idleTimer, 0.5); // pin: don't wander off
        r.group.rotation.y = Math.atan2(dx, dz);
        setWalkPhase(r.group, 0, 0);
        r.group.userData.parts.armR.rotation.x = AIM_ARM_X;
        if (d2 <= FIRE_R2) {
          m.aimTime += dt; // cumulative — survives her stepping out of range
          if (m.aimTime >= FIRE_SEC) fire(m, Math.sqrt(d2));
        }
      } else if (r.aiming) {
        // lost sight (or he's fleeing) — lower the rifle
        r.aiming = false;
        if (r.group.userData.parts?.armR) r.group.userData.parts.armR.rotation.x = 0;
      }
    }
  };

  // --- stage 4: roadblocks ----------------------------------------------------
  let barriersSpawned = false;
  let cordonT = CORDON_SEC;

  const makeBarrier = () => {
    const g = new THREE.Group();
    const frame = mat(0x23262a);
    const stripeMat = new THREE.MeshLambertNodeMaterial({
      color: 0x6a1410, emissive: 0xff2a1a, emissiveIntensity: 1.4,
    });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(7, 0.3, 0.16), frame);
    beam.position.y = 0.9;
    g.add(beam);
    for (let i = -2; i <= 2; i++) { // emissive hazard stripes across the beam
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.32, 0.17), stripeMat);
      s.position.set(i * 1.35, 0.9, 0);
      g.add(s);
    }
    for (const sx of [-3.1, 3.1]) { // legs
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.9, 0.6), frame);
      leg.position.set(sx, 0.45, 0);
      g.add(leg);
    }
    return g;
  };

  const spawnRoadblocks = () => {
    if (barriersSpawned) return;
    barriersSpawned = true;
    const pts = [ // the 4 avenue endpoints, just inside the world edge
      { x: 0, z: -(R - 4), rot: 0 },           // N-S avenue, south
      { x: 0, z: R - 4, rot: 0 },              // N-S avenue, north
      { x: -(R - 4), z: 0, rot: Math.PI / 2 }, // E-W avenue, west
      { x: R - 4, z: 0, rot: Math.PI / 2 },    // E-W avenue, east
    ];
    for (const p of pts) {
      const b = makeBarrier();
      b.position.set(p.x, 0, p.z);
      b.rotation.y = p.rot;
      town.group.add(b);
    }
  };

  // state.js owns run-end via endRun() (emits 'over' so flow.js shows the
  // overlay) — direct state.over mutation would leave the overlay hidden.
  const endCordon = () => {
    gameState.endRun('cordon');
  };

  // --- stage transitions (one-time setups; thresholds can jump) --------------
  const applyStage = (st) => {
    if (st >= 2) armMen();
    if (st >= 4) { spawnRoadblocks(); cordonT = CORDON_SEC; }
  };
  gameState.onChange((what) => { if (what === 'stage') applyStage(gameState.state.stage); });
  applyStage(gameState.state.stage); // defensive: stage may be non-zero at init

  // --- staggered per-resident think -------------------------------------------
  const escThink = (r) => {
    const s = gameState.state;
    if (s.over || s.stage < 1) return;
    if (!isLiving(r)) return; // dead / taken / turned are owned elsewhere
    const pos = r.group.position;

    // stage 3+: pallbearers hunt the nearest turned woman
    if (s.stage >= 3 && r.role === 'pallbearer') {
      const t = nearest(pos, Infinity, (o) => o.state === 'turned');
      if (t) {
        if (t.d * t.d <= PAL_CONTACT2) {
          // contact: the turned woman is destroyed
          const tp = t.r.group.position;
          t.r.state = 'dead';
          setDeadPose(t.r.group);
          gameState.hordeLost();
          gore.addDecal(tp.x, tp.z, 0.7, 1.3, Math.random() * Math.PI);
        } else {
          r.target.x = t.r.group.position.x;
          r.target.z = t.r.group.position.z;
          r.state = 'walk';
          r.speed = walkSpeed * PAL_SPEED_MUL;
          r.stuckTicks = 0;
          r.lastDist = Infinity;
        }
        return;
      }
    }

    if (r.armed && r.aiming) return; // the per-frame aim owns this man

    // stage 3+: living residents flee turned women within 6m
    if (s.stage >= 3) {
      const t = nearest(pos, SCREEN_R2, (o) => o.state === 'turned');
      if (t) {
        fleeFrom(r, t.r.group.position.x, t.r.group.position.z);
        return;
      }
    }

    // stage 1+: cluster toward the nearest other living resident (<10m)
    if (s.stage >= 1 && r.state !== 'flee') {
      const t = nearest(pos, CLUSTER_R2, (o) => o !== r && isLiving(o) && !(o.armed && o.aiming));
      r.speed = walkSpeed * CLUSTER_SPEED_MUL; // +20% walk speed
      if (t && t.d > CLUSTER_STOP) {
        r.target.x = t.r.group.position.x + (Math.random() - 0.5) * 1.4;
        r.target.z = t.r.group.position.z + (Math.random() - 0.5) * 1.4;
        r.state = 'walk';
        r.stuckTicks = 0;
        r.lastDist = Infinity;
      }
    }
  };

  // --- per-frame advance -------------------------------------------------------
  function update(dt) {
    const s = gameState.state;
    if (s.over) return;

    if (s.stage >= 1) {
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        r.escTimer -= dt;
        if (r.escTimer <= 0) {
          r.escTimer += thinkInterval;
          if (perf) {
            const a = performance.now();
            escThink(r);
            perf.thinkMs += performance.now() - a;
          } else {
            escThink(r);
          }
        }
      }
    }

    if (s.stage >= 2) updateArmed(dt);

    // muzzle flashes
    for (let i = 0; i < flashes.length; i++) {
      const f = flashes[i];
      if (f.t <= 0) continue;
      f.t -= dt;
      if (f.t <= 0) f.mesh.visible = false;
    }

    // stage 4: cordon countdown — the run ends unless the women are all turned
    if (s.stage >= 4) {
      cordonT -= dt;
      s.cordonDeadline = cordonT; // HUD reads this for the visible countdown
      if (cordonT <= 0) endCordon();
    } else {
      s.cordonDeadline = 0;
    }
  }

  return api;
}
