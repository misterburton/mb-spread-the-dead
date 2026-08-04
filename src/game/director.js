// Audio director: positional horde audio, dread drone by stage, heartbeat,
// escalation stings, distant unease. Accumulates dt; no per-frame allocation.
import { CFG } from '../config.js';

export function createAudioDirector({ audio, gameState, player, residents, camera }) {
  if (!audio) return { update: () => {} };

  let droneGain = null;
  let droneStarted = false;
  let uneaseT = 15 + Math.random() * 20;
  let heartT = 0;
  let prevHorde = 0;
  let prevStage = -1;
  const turnedSeen = new Set();

  function startDrone() {
    if (droneStarted) return;
    droneStarted = true;
    const pools = audio.pools || {};
    const amb = pools.ambience || [];
    const buf = amb[amb.length - 1]; // dread drone is the last ambience file
    if (!buf) return;
    const src = audio.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    droneGain = audio.ctx.createGain();
    droneGain.gain.value = 0;
    src.connect(droneGain).connect(audio.ctx.destination ?? audio.ctx);
    // route through master if exposed
    src.start();
  }

  gameState.onChange((what, s) => {
    if (what === 'stage') {
      audio.play('impact', { gain: 0.5, rate: 0.5 }); // low boom
      audio.play('tail', { gain: 0.45 });
    }
  });

  function update(dt) {
    const s = gameState.state;
    if (!audio.ctx || audio.ctx.state !== 'running') return;
    startDrone();

    // dread drone scales with stage: 0 at 0-1, 0.5 at stage 4
    if (droneGain) {
      const target = Math.max(0, Math.min(0.5, (s.stage - 1) * 0.17));
      droneGain.gain.value += (target - droneGain.gain.value) * Math.min(1, dt * 2);
    }

    // distant unease: random far-off sound every 20-45s
    uneaseT -= dt;
    if (uneaseT <= 0) {
      uneaseT = 20 + Math.random() * 25;
      const ev = Math.random() > 0.5 ? 'breath' : 'impact';
      audio.play(ev, { gain: 0.04 + Math.random() * 0.04, rate: 0.85 });
    }

    // heartbeat when starving or rotting out
    const low = Math.min(s.hunger, s.rot);
    if (low < 25) {
      heartT -= dt;
      if (heartT <= 0) {
        heartT = 0.5 + 0.4 * (low / 25);
        audio.play('impact', { gain: 0.25, rate: 0.6 });
      }
    }

    // positional: horde converts away from the player
    for (const r of residents.list) {
      if (r.state === 'turned' && !turnedSeen.has(r.id)) {
        turnedSeen.add(r.id);
        const dx = r.group.position.x - player.position.x;
        const dz = r.group.position.z - player.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 4) {
          const gain = Math.max(0.05, Math.min(0.5, 1 / d));
          audio.play('convert', { gain, detune: (Math.random() - 0.5) * 300 });
        }
      }
    }

    // horde losses (pallbearer kills): distant impact
    if (s.hordeSize < prevHorde) {
      audio.play('impact', { gain: 0.12, rate: 0.8 });
    }
    prevHorde = s.hordeSize;
  }

  return { update };
}
