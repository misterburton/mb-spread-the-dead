// w2: interactions — kiss/kill take system.
// Wires player + residents + takeDirector + gore + gameState together.
//
// main.js integration (already wired):
//   if (input.interact) interactions.tryInteract();  // on the interact edge
//   takeDirector.update(dt);        // main loop advances the director
//   interactions.update(dt);        // observes director state, recomputes target
//   gore.update(dt, camera);        // main loop feeds gore (NOT interactions)
//   interactions.currentTarget      // resident record | null — HUD prompt
//     (role 'woman' => KISS prompt, 'man'/'pallbearer' => KILL prompt)
import { CFG } from '../config.js';
import { applyTurn, setDeadPose } from '../characters/factory.js';

const FACE_DOT = 0.3;             // "in facing direction" preference threshold
const CHEST_Y = 1.2;              // burst origin height on the victim
const SECOND_BURST_AT = 0.4;      // fraction of kill hold for the second burst

export function createInteractions({ player, residents, takeDirector, gore, gameState, audio = null }) {
  const range2 = CFG.player.interactRange * CFG.player.interactRange;
  const sightRange2 = CFG.npc.sightRange * CFG.npc.sightRange;
  // rough witness cone from the NPC field of view (dot threshold, no raycast)
  const witnessDot = Math.cos((CFG.npc.sightFovDeg * 0.5 * Math.PI) / 180);

  let currentTarget = null;
  // kill-hold choreography scratch: { target, phase:'pre'|'hold', holdT, burst40 }
  let kill = null;

  // targetable = alive and not already taken/turned/dead
  const isLiving = (r) => r.state === 'idle' || r.state === 'walk' || r.state === 'flee';

  // nearest living resident in range; prefer one in the player's facing cone
  function pickTarget() {
    const px = player.position.x, pz = player.position.z;
    const fx = Math.sin(player.rotation.y), fz = Math.cos(player.rotation.y);
    let bestAny = null, bestAnyD2 = range2;
    let bestFace = null, bestFaceD2 = range2;
    const list = residents.list;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (!isLiving(r)) continue;
      const dx = r.group.position.x - px;
      const dz = r.group.position.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= range2) continue;
      if (d2 < bestAnyD2) { bestAnyD2 = d2; bestAny = r; }
      const d = Math.sqrt(d2) || 1e-4;
      if ((dx / d) * fx + (dz / d) * fz > FACE_DOT && d2 < bestFaceD2) {
        bestFaceD2 = d2; bestFace = r;
      }
    }
    return bestFace ?? bestAny;
  }

  function burstChestTowardPlayer(target, n, power) {
    const tp = target.group.position;
    let dx = player.position.x - tp.x;
    let dz = player.position.z - tp.z;
    const d = Math.hypot(dx, dz) || 1e-4;
    gore.burst(tp.x, tp.y + CHEST_Y, tp.z, dx / d, dz / d, n, power);
  }

  // any other living resident with the kill inside their rough sight cone?
  function wasWitnessed(tp) {
    const list = residents.list;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (!isLiving(r)) continue;
      const rp = r.group.position;
      const dx = tp.x - rp.x, dz = tp.z - rp.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > sightRange2 || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      const fx = Math.sin(r.group.rotation.y), fz = Math.cos(r.group.rotation.y);
      if ((dx / d) * fx + (dz / d) * fz > witnessDot) return true;
    }
    return false;
  }

  // --- kiss: silent convert, no evidence, no body ---------------------------
  function startKiss(target) {
    target.state = 'taken'; // freezes them out of the wander/flee sim
    takeDirector.start(target, 'kiss', () => {
      applyTurn(target.group);
      target.state = 'turned';
      gameState.spendConvert();
      audio?.convert(); // quiet, unsettling — not silent to the player
    });
  }

  // --- kill: feed, gore, evidence -------------------------------------------
  function startKill(target) {
    target.state = 'taken';
    kill = { target, phase: 'pre', holdT: 0, burst40: false };
    audio?.kill(); // impact+wet+breath+tail layers, fired at cut
    takeDirector.start(target, 'kill', () => {
      finishKill(target);
      kill = null;
    });
  }

  function finishKill(target) {
    const tp = target.group.position;
    setDeadPose(target.group);
    target.state = 'dead';

    // arterial trail leading away from the body, 2-3m, slightly jittered
    let dx = tp.x - player.position.x;
    let dz = tp.z - player.position.z;
    const d = Math.hypot(dx, dz) || 1e-4;
    const j = (Math.random() - 0.5) * 0.9;
    const c = Math.cos(j), s = Math.sin(j);
    const ox = (dx / d) * c - (dz / d) * s;
    const oz = (dx / d) * s + (dz / d) * c;
    const len = 2 + Math.random(); // 2-3m
    gore.addTrail(tp.x, tp.z, tp.x + ox * len, tp.z + oz * len, 0.4);

    // blood pool under the body: 2-3 large decals
    const pools = 2 + ((Math.random() * 2) | 0);
    for (let i = 0; i < pools; i++) {
      gore.addDecal(
        tp.x + (Math.random() - 0.5) * 0.7,
        tp.z + (Math.random() - 0.5) * 0.7,
        1.1 + Math.random() * 0.7, 1 + Math.random() * 0.8, Math.random() * Math.PI
      );
    }

    gameState.feedKill();

    // a witness upgrades the evidence to witnessedKill (applied once)
    if (wasWitnessed(tp)) gameState.addEvidence(CFG.escalation.witnessedKill);
    else gameState.addEvidence(CFG.escalation.bodyEvidence);
  }

  // --- public ----------------------------------------------------------------
  function tryInteract() {
    if (takeDirector.busy) return;
    const target = pickTarget(); // fresh, not frame-stale
    currentTarget = target;
    if (!target) return;
    if (target.role === 'woman') startKiss(target);
    else startKill(target); // man / pallbearer
  }

  function update(dt) {
    // kill-hold gore choreography, keyed off the director's state getter
    // (main.js advances takeDirector.update itself — do NOT double-call it,
    //  and do NOT call gore.update here; the main loop feeds gore separately)
    if (kill) {
      const st = takeDirector.state;
      if (st === 'hold' && kill.phase === 'pre') {
        kill.phase = 'hold';
        kill.holdT = 0;
        burstChestTowardPlayer(kill.target, 26, 1); // hold start: first spurt
      } else if (kill.phase === 'hold') {
        kill.holdT += dt;
        if (!kill.burst40 && kill.holdT >= SECOND_BURST_AT * CFG.take.holdSec) {
          kill.burst40 = true;
          burstChestTowardPlayer(kill.target, 30, 1.2); // 40%: second burst
          gore.stainCharacter(player.group ?? player, 0.7); // blood on her
        }
      }
    }

    currentTarget = pickTarget();
  }

  return {
    update,
    tryInteract,
    get currentTarget() { return currentTarget; },
  };
}
