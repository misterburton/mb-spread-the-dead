// Game audio: variant pools, event triggers, proximity mix. Web Audio API,
// unlocked on first user gesture. Close, wet, over-loud register per spec.
import { CFG } from '../config.js';

export async function createAudio() {
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = 1.0;
  master.connect(ctx.destination);

  const manifest = await (await fetch('/assets/audio/manifest.json')).json();
  const pools = {}; // event -> AudioBuffer[]
  await Promise.all(Object.entries(manifest).map(async ([event, files]) => {
    pools[event] = await Promise.all(files.map(async (f) => {
      const res = await fetch(`/assets/audio/${event}/${f}`);
      return ctx.decodeAudioData(await res.arrayBuffer());
    }));
  }));

  const pick = (event) => pools[event]?.[Math.floor(Math.random() * pools[event].length)];

  function play(event, { gain = 1, rate = 1, detune = 0 } = {}) {
    const buf = pick(event);
    if (!buf) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (0.94 + Math.random() * 0.12); // variant pitch
    if (detune) src.detune.value = detune;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(master);
    src.start();
    return src;
  }

  // ambience bed: night town loop + drone, quiet
  let bedStarted = false;
  function startBed() {
    if (bedStarted) return;
    bedStarted = true;
    const amb = pick('ambience');
    if (amb) {
      const src = ctx.createBufferSource();
      src.buffer = amb;
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = 0.35;
      src.connect(g).connect(master);
      src.start();
    }
  }

  // unlock on first gesture (browser autoplay policy)
  const unlock = () => { ctx.resume(); startBed(); window.removeEventListener('pointerdown', unlock); };
  window.addEventListener('pointerdown', unlock);

  return {
    ctx,
    pools,
    play,
    startBed,
    // composite events — layered per Fight Club register
    kill() {
      play('impact', { gain: 1.0 });
      setTimeout(() => play('wet', { gain: 0.9 }), 90 + Math.random() * 80);
      setTimeout(() => play('breath', { gain: 0.55 }), 350);
      setTimeout(() => play('tail', { gain: 0.4 }), 900);
    },
    convert() {
      play('convert', { gain: 0.7 });
      setTimeout(() => play('breath', { gain: 0.35, rate: 0.9 }), 500);
    },
    feed() { play('breath', { gain: 0.6, rate: 0.85 }); },
  };
}
