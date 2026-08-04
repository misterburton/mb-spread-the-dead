// Pacing autopilot — loaded only when ?sim is present (see main.js).
// Drives the player through the REAL input/movement path: steers camYaw at the
// current target and holds "W" (move.y = -1), fires interactions.tryInteract()
// in range. Teleports only as an unstick fallback (logged, so pacing numbers
// can be discounted if it ever fires often).
//
// Policy approximates a competent player:
//   hunger < 55  → hunt nearest living man/pallbearer (kill feeds + heals rot)
//   otherwise    → hunt nearest living woman (kiss converts, grows the horde)
// Milestones are logged as '[SIM] {json}' console lines for scripts/sim.mjs.
import { isBlocked } from '../world/town.js';

const LOG_EVERY = 30;        // periodic status line, seconds of game time
const STUCK_SEC = 1.2;       // game-time without progress before a teleport

export function createSimDriver({ player, residents, gameState, interactions, takeDirector, input, town, CFG, steer }) {
  const list = residents.list;
  const isLiving = (r) => r.state === 'idle' || r.state === 'walk' || r.state === 'flee';
  const blockedAt = (x, z) => isBlocked(town.navGrid, town.gridSize, town.origin, town.cellSize, x, z);

  let target = null;
  let stuckT = 0;
  let lastX = player.position.x, lastZ = player.position.z;
  let statusT = LOG_EVERY;
  let teleports = 0;
  let prevStage = -1, prevConverted = 0, prevDead = 0, prevHordePeak = 0;
  let done = false;
  const t0marks = {};

  const log = (what, extra = {}) =>
    console.log('[SIM] ' + JSON.stringify({ what, t: +gameState.state.time.toFixed(1), ...extra }));

  const nearest = (pred) => {
    let best = null, bd2 = Infinity;
    const px = player.position.x, pz = player.position.z;
    for (const r of list) {
      if (!pred(r)) continue;
      const dx = r.group.position.x - px, dz = r.group.position.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd2) { bd2 = d2; best = r; }
    }
    return best;
  };

  // walkable spot within ~1m of the target, for unstick teleports
  const teleportNear = (r) => {
    const tp = r.group.position;
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 0.6 + Math.random() * 0.8;
      const x = tp.x + Math.sin(a) * d, z = tp.z + Math.cos(a) * d;
      if (!blockedAt(x, z)) {
        player.position.x = x; player.position.z = z;
        teleports++;
        log('teleport', { n: teleports });
        return true;
      }
    }
    return false;
  };

  function update(dt) {
    const s = gameState.state;

    // --- milestone edges ---
    if (s.stage !== prevStage) { log('stage', { stage: s.stage }); prevStage = s.stage; }
    if (s.womenConverted > prevConverted) {
      prevConverted = s.womenConverted;
      if (prevConverted === 1) log('firstConvert');
      if (prevConverted === s.womenTotal) log('allWomen');
    }
    let dead = 0;
    for (const r of list) if (r.state === 'dead') dead++;
    if (dead > prevDead) {
      prevDead = dead;
      if (dead === 1) log('firstKill');
    }
    if (s.hordeSize > prevHordePeak) prevHordePeak = s.hordeSize;

    if (s.over && !done) {
      done = true;
      log('result', {
        over: s.over, hunger: +s.hunger.toFixed(1), rot: +s.rot.toFixed(1),
        evidence: s.evidence, horde: s.hordeSize, hordePeak: prevHordePeak,
        women: s.womenConverted + '/' + s.womenTotal, dead, teleports,
      });
      return;
    }
    if (done) return;

    // --- periodic status ---
    statusT -= dt;
    if (statusT <= 0) {
      statusT += LOG_EVERY;
      log('status', {
        hunger: +s.hunger.toFixed(0), rot: +s.rot.toFixed(0), ev: s.evidence,
        stage: s.stage, horde: s.hordeSize, women: s.womenConverted, dead,
      });
    }

    // --- steering ---
    if (takeDirector.busy) { input.move.x = 0; input.move.y = 0; return; }

    if (!target || !isLiving(target)) {
      // re-pick: feed when hungry, otherwise grow the lineage
      target = s.hunger < 55
        ? nearest((r) => isLiving(r) && r.role !== 'woman')
        : nearest((r) => isLiving(r) && r.role === 'woman');
      if (!target) { // no prey of that class left — take anything living
        target = nearest(isLiving);
        if (!target) { input.move.x = 0; input.move.y = 0; return; }
      }
      stuckT = 0;
    }

    const tp = target.group.position;
    const dx = tp.x - player.position.x, dz = tp.z - player.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist <= CFG.player.interactRange * 0.95) {
      input.move.x = 0; input.move.y = 0;
      interactions.tryInteract();
      return;
    }

    // steer the camera yaw at the target and hold W (forward)
    steer(Math.atan2(dx, dz));
    input.move.x = 0;
    input.move.y = -1;
    input.sprint = dist > 10;

    // unstick: no progress for STUCK_SEC of game time while trying to move
    const moved = Math.hypot(player.position.x - lastX, player.position.z - lastZ);
    lastX = player.position.x; lastZ = player.position.z;
    if (moved < 0.1 * CFG.player.speed * dt) { // <10% of the expected step
      stuckT += dt;
      if (stuckT >= STUCK_SEC) { stuckT = 0; teleportNear(target); }
    } else {
      stuckT = 0;
    }
  }

  return { update };
}
