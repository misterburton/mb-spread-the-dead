// w1: residents — ~60 NPC townsfolk wandering the town navGrid.
// CPU budget: AI "thinks" are staggered (CFG.npc.thinkHz, offset by index);
// movement itself is a cheap per-frame greedy step with axis-separated slide
// (same collision pattern as the player in main.js). No per-frame allocations.
import { makeResident, makePallbearer, setWalkPhase } from '../characters/factory.js';
import { isBlocked } from '../world/town.js';

const MEN_STYLES = ['flannel', 'work', 'suit', 'sweater'];
const WOMEN_STYLES = ['dress', 'sweater', 'dress', 'flannel', 'work'];
const BUILDS = ['thin', 'avg', 'avg', 'heavy'];

// church placement (matches town.js) — pallbearers cluster near it
const CHURCH = { x: -32, z: 28 };

const FLEE_RADIUS = 6;         // player proximity that triggers flight
const FLEE_RADIUS2 = FLEE_RADIUS * FLEE_RADIUS;
const FLEE_SEC = 3;
const ARRIVE = 0.35;
const WANDER_MAX = 12;         // meters

export function createResidents(scene, town, CFG, onSeePlayer = null) {
  const { navGrid, gridSize, origin, cellSize } = town;
  const N = CFG.town.residents;
  const N_PAL = CFG.town.pallbearers;
  const N_MEN = 30;
  const N_WOMEN = N - N_PAL - N_MEN; // 24
  const thinkInterval = 1 / CFG.npc.thinkHz;
  const walkSpeed = CFG.npc.walkSpeed;
  const fleeSpeed = CFG.npc.fleeSpeed;

  const blockedAt = (x, z) => isBlocked(navGrid, gridSize, origin, cellSize, x, z);

  // --- spawn spots -----------------------------------------------------------
  // valid sidewalk spawn points (not inside an obstacle), shuffled once
  const valid = town.spawnPoints.filter((p) => !blockedAt(p.x, p.z));
  for (let i = valid.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const t = valid[i]; valid[i] = valid[j]; valid[j] = t;
  }

  // pallbearer spots: valid points nearest the church
  const nearChurch = valid
    .map((p) => ({ p, d: (p.x - CHURCH.x) ** 2 + (p.z - CHURCH.z) ** 2 }))
    .sort((a, b) => a.d - b.d)
    .slice(0, N_PAL)
    .map((e) => e.p);

  let spawnIdx = 0;
  const jitterSpot = (base, out) => {
    const jx = base.x + (Math.random() - 0.5) * 1.6;
    const jz = base.z + (Math.random() - 0.5) * 1.6;
    if (!blockedAt(jx, jz)) { out.x = jx; out.z = jz; }
    else { out.x = base.x; out.z = base.z; }
    return out;
  };
  const spot = { x: 0, z: 0 }; // init-time scratch
  const nextSpawn = () => jitterSpot(valid[spawnIdx++ % valid.length], spot);
  const churchSpawn = (k) => {
    if (k < nearChurch.length) return jitterSpot(nearChurch[k], spot);
    // fallback: ring south of the church, first walkable candidate
    for (let t = 0; t < 8; t++) {
      const a = Math.PI * 0.25 + t * (Math.PI / 8); // southern arc
      const cx = CHURCH.x + Math.cos(a) * 10;
      const cz = CHURCH.z - Math.sin(a) * 10;
      if (!blockedAt(cx, cz)) { spot.x = cx; spot.z = cz; return spot; }
    }
    spot.x = CHURCH.x; spot.z = CHURCH.z - 10;
    return spot;
  };

  // --- roster ----------------------------------------------------------------
  const list = [];
  const byId = new Map();

  const addResident = (group, gender, role, at) => {
    const i = list.length;
    group.position.set(at.x, 0, at.z);
    group.rotation.y = Math.random() * Math.PI * 2;
    scene.add(group);
    const thinkOffset = (i / N) * thinkInterval;
    const r = {
      id: i,
      group,
      gender,
      role,                       // 'man' | 'woman' | 'pallbearer'
      state: 'idle',              // idle|walk|flee|dead|turned
      target: { x: at.x, z: at.z },
      speed: walkSpeed,
      thinkOffset,
      thinkTimer: thinkOffset,    // staggered first think
      idleTimer: 0.5 + Math.random() * 3, // desync initial wander
      fleeTimer: 0,
      walkPhase: Math.random() * Math.PI * 2,
      lastDist: Infinity,
      stuckTicks: 0,
    };
    list.push(r);
    byId.set(r.id, r);
    return r;
  };

  for (let i = 0; i < N_MEN; i++) {
    const g = makeResident({
      gender: 'm',
      build: BUILDS[i % BUILDS.length],
      height: 1.62 + (((i * 37) % 100) / 100) * 0.32,
      style: MEN_STYLES[i % MEN_STYLES.length],
    });
    addResident(g, 'm', 'man', nextSpawn());
  }
  for (let i = 0; i < N_WOMEN; i++) {
    const g = makeResident({
      gender: 'f',
      build: BUILDS[(i + 1) % BUILDS.length],
      height: 1.55 + (((i * 53) % 100) / 100) * 0.28,
      style: WOMEN_STYLES[i % WOMEN_STYLES.length],
    });
    addResident(g, 'f', 'woman', nextSpawn());
  }
  for (let k = 0; k < N_PAL; k++) {
    addResident(makePallbearer(), 'm', 'pallbearer', churchSpawn(k));
  }

  // --- behaviors (run at thinkHz, staggered) ---------------------------------
  const enterIdle = (r) => {
    r.state = 'idle';
    r.speed = walkSpeed;
    r.idleTimer = 2 + Math.random() * 4; // 2-6s
    setWalkPhase(r.group, 0, 0);         // reset pose once, not per-frame
  };

  const pickWanderTarget = (r) => {
    const pos = r.group.position;
    for (let tries = 0; tries < 6; tries++) {
      const a = Math.random() * Math.PI * 2;
      const d = 3 + Math.random() * (WANDER_MAX - 3);
      const tx = pos.x + Math.sin(a) * d;
      const tz = pos.z + Math.cos(a) * d;
      if (!blockedAt(tx, tz)) {
        r.target.x = tx; r.target.z = tz;
        r.state = 'walk';
        r.speed = walkSpeed;
        r.stuckTicks = 0;
        r.lastDist = Infinity;
        return;
      }
    }
    r.idleTimer = 1 + Math.random() * 2; // hemmed in — retry shortly
  };

  const pickFleeTarget = (r, awayX, awayZ) => {
    const pos = r.group.position;
    const len = Math.hypot(awayX, awayZ) || 1;
    // jitter heading so crowds fan out and walls don't pin them
    const j = (Math.random() - 0.5) * 1.2;
    const c = Math.cos(j), s = Math.sin(j);
    const dx = (awayX / len) * c - (awayZ / len) * s;
    const dz = (awayX / len) * s + (awayZ / len) * c;
    r.target.x = pos.x + dx * 10;
    r.target.z = pos.z + dz * 10;
    r.stuckTicks = 0;
    r.lastDist = Infinity;
  };

  // true when the resident has made <5cm progress for several think ticks
  const stuckCheck = (r, d) => {
    if (d > r.lastDist - 0.05) r.stuckTicks++;
    else r.stuckTicks = 0;
    r.lastDist = d;
    return r.stuckTicks >= 4;
  };

  const think = (r, playerPos) => {
    const pos = r.group.position;

    // spot the player → flee (witness/escalation hooks arrive in a later wave)
    if (playerPos && (r.state === 'idle' || r.state === 'walk')) {
      const pdx = pos.x - playerPos.x;
      const pdz = pos.z - playerPos.z;
      if (pdx * pdx + pdz * pdz < FLEE_RADIUS2) {
        r.state = 'flee';
        r.speed = fleeSpeed;
        r.fleeTimer = FLEE_SEC;
        pickFleeTarget(r, pdx, pdz);
        if (onSeePlayer) onSeePlayer(r);
        return;
      }
    }

    if (r.state === 'idle') {
      r.idleTimer -= thinkInterval;
      if (r.idleTimer <= 0) pickWanderTarget(r);
    } else if (r.state === 'walk') {
      const dx = r.target.x - pos.x;
      const dz = r.target.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d < ARRIVE || stuckCheck(r, d)) enterIdle(r);
    } else if (r.state === 'flee') {
      r.fleeTimer -= thinkInterval;
      if (r.fleeTimer <= 0) {
        enterIdle(r);
      } else if (playerPos) {
        // keep heading away from the player, re-jittered each think
        pickFleeTarget(r, pos.x - playerPos.x, pos.z - playerPos.z);
      }
    }
  };

  // --- per-frame advance -------------------------------------------------------
  const update = (dt, playerPos) => {
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r.state === 'dead' || r.state === 'turned') continue; // later waves own these

      r.thinkTimer -= dt;
      if (r.thinkTimer <= 0) {
        r.thinkTimer += thinkInterval;
        think(r, playerPos);
      }

      if (r.state !== 'walk' && r.state !== 'flee') continue;

      // greedy move with axis-separated slide (same pattern as player)
      const pos = r.group.position;
      const dx = r.target.x - pos.x;
      const dz = r.target.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1e-4) continue;
      const step = Math.min(r.speed * dt, dist);
      const mx = (dx / dist) * step;
      const mz = (dz / dist) * step;
      const nx = pos.x + mx;
      const nz = pos.z + mz;
      let moved = false;
      if (!blockedAt(nx, pos.z)) { pos.x = nx; moved = true; }
      if (!blockedAt(pos.x, nz)) { pos.z = nz; moved = true; }
      if (moved) {
        r.group.rotation.y = Math.atan2(dx, dz);
        r.walkPhase += dt * r.speed * 2.2;
        setWalkPhase(r.group, r.walkPhase, r.speed / walkSpeed);
      }
    }
  };

  return { list, update, byId };
}
