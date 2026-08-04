// w3: horde — turned women (state==='turned') autonomously hunt the remaining
// living women. On contact (<1.2m) they convert them, silently (no evidence),
// so the horde grows exponentially — that is the design. When no living women
// remain they drift toward the player at 0.6x speed (follow the lineage).
// CPU budget mirrors residents.js: the nearest-woman retarget runs at
// CFG.npc.thinkHz, staggered per member by index; movement itself is a cheap
// per-frame greedy step with axis-separated slide collision vs town.navGrid.
import { applyTurn, setWalkPhase } from '../characters/factory.js';
import { isBlocked } from '../world/town.js';

const CONTACT2 = 1.2 * 1.2;      // convert trigger distance, squared
const FOLLOW_DIST = 2.0;         // stop this far from the player when drifting
const FOLLOW_DIST2 = FOLLOW_DIST * FOLLOW_DIST;
const DRIFT_MUL = 0.6;           // speed multiplier when no women remain
// states a living woman can be converted from (object map, no allocation)
const HUNTABLE = { idle: 1, walk: 1, flee: 1 };

export function createHorde({ residents, town, gameState, CFG }) {
  // accept either the createResidents() return ({list, ...}) or a raw array
  const list = residents.list ?? residents;
  const { navGrid, gridSize, origin, cellSize } = town;
  const thinkInterval = 1 / CFG.npc.thinkHz;
  const convertSpeed = CFG.npc.convertSpeed;
  const walkSpeed = CFG.npc.walkSpeed;

  const blockedAt = (x, z) => isBlocked(navGrid, gridSize, origin, cellSize, x, z);

  // perf harness: set by main.js when ?perf=1 — retarget thinks add into thinkMs
  const perf = (typeof window !== 'undefined' && window.__perf) || null;

  // per-member horde state, created lazily when a resident turns
  const members = new Map(); // resident.id -> { victim, thinkTimer }
  const memberOf = (r) => {
    let m = members.get(r.id);
    if (!m) {
      // stagger first think by index (thinkOffset was set at spawn)
      m = { victim: null, thinkTimer: r.thinkOffset ?? ((r.id / list.length) * thinkInterval) };
      members.set(r.id, m);
    }
    return m;
  };

  // nearest living woman (idle/walk/flee). <=60 candidates — no spatial hash.
  const nearestWoman = (pos) => {
    let best = null;
    let bestD2 = Infinity;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.role !== 'woman' || !HUNTABLE[c.state]) continue;
      const dx = c.group.position.x - pos.x;
      const dz = c.group.position.z - pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; best = c; }
    }
    return best;
  };

  const convert = (victim) => {
    // belt-and-suspenders: never double-convert. A woman mid-kiss ('taken')
    // belongs to interactions.js; a turned/dead woman is out of the pool.
    if (!HUNTABLE[victim.state]) return false;
    applyTurn(victim.group);
    victim.state = 'turned';
    gameState.hordeConvert(); // silent: no evidence, and no hunger cost to her
    return true;
  };

  // playerPos optional (Vector3-like {x,z}); needed only for the no-prey drift
  const update = (dt, playerPos = null) => {
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r.state !== 'turned') continue; // horde owns only the turned
      const m = memberOf(r);
      const pos = r.group.position;

      // staggered retarget: nearest-woman search at most every 1/thinkHz
      m.thinkTimer -= dt;
      if (m.thinkTimer <= 0) {
        m.thinkTimer += thinkInterval;
        if (perf) {
          const a = performance.now();
          m.victim = nearestWoman(pos);
          perf.thinkMs += performance.now() - a;
        } else {
          m.victim = nearestWoman(pos);
        }
      }
      // drop a victim who turned or died since the last think
      if (m.victim && !HUNTABLE[m.victim.state]) m.victim = null;

      // pick goal + speed: hunt the victim, else drift toward the player
      let tx, tz, speed, hunting;
      if (m.victim) {
        tx = m.victim.group.position.x;
        tz = m.victim.group.position.z;
        speed = convertSpeed;
        hunting = true;
      } else if (playerPos) {
        tx = playerPos.x;
        tz = playerPos.z;
        speed = convertSpeed * DRIFT_MUL;
        hunting = false;
      } else {
        continue; // no prey and no lineage reference — hold position
      }

      // greedy move with axis-separated slide (same pattern as residents.js)
      const dx = tx - pos.x;
      const dz = tz - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= 1e-4 && (hunting || dist * dist > FOLLOW_DIST2)) {
        const step = Math.min(speed * dt, dist);
        const mx = (dx / dist) * step;
        const mz = (dz / dist) * step;
        const nx = pos.x + mx;
        const nz = pos.z + mz;
        let moved = false;
        if (!blockedAt(nx, pos.z)) { pos.x = nx; moved = true; }
        if (!blockedAt(pos.x, nz)) { pos.z = nz; moved = true; }
        if (moved) {
          r.group.rotation.y = Math.atan2(dx, dz);
          r.walkPhase += dt * speed * 2.2;
          setWalkPhase(r.group, r.walkPhase, speed / walkSpeed);
        }
      } else if (!hunting) {
        setWalkPhase(r.group, 0, 0); // ring the player without stacking on her
      }

      // contact → convert (checked post-move so touches register promptly)
      if (m.victim) {
        const vpos = m.victim.group.position;
        const cdx = vpos.x - pos.x;
        const cdz = vpos.z - pos.z;
        if (cdx * cdx + cdz * cdz < CONTACT2) {
          convert(m.victim);
          m.victim = null; // retarget next think; the convert joins the horde next frame
        }
      }
    }
  };

  return { update };
}
