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
const BURST_15_AT = 0.15;         // fraction of kill hold: second spurt
const SECOND_BURST_AT = 0.4;      // fraction of kill hold for the third burst
const BURST_70_AT = 0.7;          // fraction of kill hold: late arterial emptying
const DRIP_EVERY = 0.4;           // slow blood drip pooling under the victim

export function createInteractions({ player, residents, takeDirector, gore, gameState, audio = null, town = null, dismember = null }) {
  const range2 = CFG.player.interactRange * CFG.player.interactRange;
  const sightRange2 = CFG.npc.sightRange * CFG.npc.sightRange;
  // rough witness cone from the NPC field of view (dot threshold, no raycast)
  const witnessDot = Math.cos((CFG.npc.sightFovDeg * 0.5 * Math.PI) / 180);

  let currentTarget = null;
  // kill-hold choreography scratch:
  // { target, phase:'pre'|'hold', holdT, burst15, burst40, burst70, dripT }
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

  // initial arterial burst: biased along the player's facing axis so the fan
  // hoses back at/past the viewer — not a random direction
  function burstChestAlongFacing(target, n, power) {
    const tp = target.group.position;
    const fx = -Math.sin(player.rotation.y), fz = -Math.cos(player.rotation.y);
    gore.burst(tp.x, tp.y + CHEST_Y, tp.z, fx, fz, n, power);
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
    const started = takeDirector.start(target, 'kiss', () => {
      applyTurn(target.group);
      target.state = 'turned';
      target.playerConverted = true; // audio director: skip positional (we play our own)
      gameState.spendConvert();
      audio?.convert(); // quiet, unsettling — not silent to the player
    });
    if (!started) target.state = 'idle'; // director busy — don't strand her mid-state
  }

  // --- kill: feed, gore, evidence -------------------------------------------
  function startKill(target) {
    target.state = 'taken';
    kill = { target, phase: 'pre', holdT: 0, burst15: false, burst40: false, burst70: false, dripT: 0 };
    audio?.kill(); // impact+wet+breath+tail layers, fired at cut
    const started = takeDirector.start(target, 'kill', () => {
      finishKill(target);
      kill = null;
    });
    if (!started) { target.state = 'idle'; kill = null; } // don't strand him or the choreography
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

    // dismemberment: tear 1-2 limbs off the corpse, flung out along the
    // trail direction; originals are stumped at the joint
    if (dismember) {
      const severed = dismember.sever(target.group, ox, oz);
      if (severed > 0) audio?.play('wet', { gain: 0.8 });
    }

    // arterial spray on a nearby building face (within 2m)
    if (town) gore.wallSpray(tp.x, tp.z, town.obstacles);

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
        burstChestAlongFacing(kill.target, 26, 1); // hold start: first spurt, at the viewer
      } else if (kill.phase === 'hold') {
        kill.holdT += dt;
        if (!kill.burst15 && kill.holdT >= BURST_15_AT * CFG.take.holdSec) {
          kill.burst15 = true;
          burstChestTowardPlayer(kill.target, 22, 0.9); // 15%: second spurt
        }
        if (!kill.burst40 && kill.holdT >= SECOND_BURST_AT * CFG.take.holdSec) {
          kill.burst40 = true;
          burstChestTowardPlayer(kill.target, 30, 1.2); // 40%: third burst
          gore.stainCharacter(player.group ?? player, 0.7); // blood on her
        }
        if (!kill.burst70 && kill.holdT >= BURST_70_AT * CFG.take.holdSec) {
          kill.burst70 = true;
          burstChestTowardPlayer(kill.target, 34, 1.35); // 70%: late arterial emptying
          gore.stainCharacter(kill.target.group, 0.9); // soak the victim
        }
        // slow drip pooling under the victim, every 0.4s of the hold
        kill.dripT += dt;
        if (kill.dripT >= DRIP_EVERY) {
          kill.dripT -= DRIP_EVERY;
          const tp = kill.target.group.position;
          gore.addDecal(
            tp.x + (Math.random() - 0.5) * 0.3,
            tp.z + (Math.random() - 0.5) * 0.3,
            0.16 + Math.random() * 0.14, 1.1, Math.random() * Math.PI
          );
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
