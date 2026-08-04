// Game state: hunger, rot, evidence, escalation stage, win/lose.
import { CFG, STAGES } from '../config.js';

export function createGameState() {
  const s = {
    hunger: CFG.hunger.max * 0.7,
    rot: CFG.rot.max,
    evidence: 0,
    stage: 0,             // index into STAGES
    womenTotal: 0,
    womenConverted: 0,
    hordeSize: 0,
    over: null,           // 'win' | 'cordon' | 'dead'
    time: 0,
  };

  const listeners = new Set();
  const emit = (what) => listeners.forEach((f) => f(what, s));

  return {
    state: s,
    onChange: (f) => listeners.add(f),

    tick(dt) {
      if (s.over) return;
      s.time += dt;
      s.hunger = Math.max(0, s.hunger - CFG.hunger.decayPerSec * dt);
      let rotDecay = CFG.rot.decayPerSec;
      if (s.hunger <= 0) rotDecay += CFG.rot.starveAccel;
      s.rot = Math.max(0, s.rot - rotDecay * dt);
      // escalation from evidence
      const th = CFG.escalation.thresholds;
      let st = 0;
      for (let i = 0; i < th.length; i++) if (s.evidence >= th[i]) st = i;
      if (st !== s.stage) { s.stage = st; emit('stage'); }
      // lose conditions
      if (s.rot <= 0) { s.over = 'dead'; emit('over'); }
      if (st >= STAGES.indexOf('cordon')) { s.over = 'cordon'; emit('over'); }
      // win
      if (s.womenTotal > 0 && s.womenConverted >= s.womenTotal) { s.over = 'win'; emit('over'); }
    },

    feedKill() {
      s.hunger = Math.min(CFG.hunger.max, s.hunger + CFG.hunger.killRestore);
      s.rot = Math.min(CFG.rot.max, s.rot + CFG.hunger.rotRestore);
      emit('bars');
    },
    spendConvert() {
      s.hunger = Math.max(0, s.hunger - CFG.hunger.convertCost);
      s.womenConverted++;
      s.hordeSize++;
      emit('bars');
    },
    addEvidence(n) { s.evidence += n; emit('evidence'); },
    hordeLost() { s.hordeSize = Math.max(0, s.hordeSize - 1); emit('bars'); },
  };
}
