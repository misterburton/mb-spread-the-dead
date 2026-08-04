import * as THREE from 'three/webgpu';
import { createRenderer } from './engine/renderer.js';
import { createPostPipeline } from './engine/post.js';
import { createInput } from './engine/input.js';
import { generateTown, isBlocked } from './world/town.js';
import { makePlayer, setWalkPhase } from './characters/factory.js';
import { createResidents } from './game/residents.js';
import { createTakeDirector } from './game/takecut.js';
import { createGameState } from './game/state.js';
import { createHUD } from './game/hud.js';
import { createGore } from './game/gore.js';
import { createDismember } from './game/dismember.js';
import { createInteractions } from './game/interactions.js';
import { createAudio } from './game/audio.js';
import { createHorde } from './game/horde.js';
import { createEscalation } from './game/escalation.js';
import { createFlow } from './game/flow.js';
import { createAudioDirector } from './game/director.js';
import { setJitter } from './engine/era.js';
import { CFG } from './config.js';

const canvas = document.getElementById('game');
const renderer = await createRenderer(canvas);

// Era vertex jitter: grid from CFG.render.snapVertex; ?jitter=strong forces a
// coarse 1/60 grid (visual verification), ?jitter=off disables.
const jitterParam = new URLSearchParams(location.search).get('jitter');
setJitter(jitterParam === 'strong' ? 1 / 60 : jitterParam === 'off' ? 0 : CFG.render.snapVertex);

// --- pacing simulation (?sim / ?sim=fast) -------------------------------------
// ?sim=fast scales game dt by 10 and loads the autopilot (src/game/sim.js),
// which drives the player through the real input path and logs '[SIM]' pacing
// milestones. window.__sim exposes hooks for external driving/inspection.
const simParam = new URLSearchParams(location.search).get('sim');
const SIM_DT = simParam === 'fast' ? 10 : simParam !== null ? 1 : 0;

// --- perf harness (?perf=1) ---------------------------------------------------
// Ring buffer of the last 600 frame deltas + per-system ms timings, exposed as
// window.__perf for scripts/perf.mjs. AI think bodies (residents / horde /
// escalation) add into __perf.thinkMs when it exists.
// Disabled: cost is one falsy check per system per frame — no closures, no
// allocs, no timing calls.
const PERF = new URLSearchParams(location.search).has('perf') ? createPerf() : null;
window.__perf = PERF;

function createPerf() {
  const RING = 600;
  const sys = (name) => ({ name, total: 0, count: 0, max: 0, ring: new Float32Array(RING), ri: 0 });
  return {
    frames: new Float32Array(RING),   // frame-time deltas (ms)
    thinks: new Float32Array(RING),   // aggregate AI think ms per frame
    n: 0,                             // frames recorded (post-warmup)
    warmup: 45,                       // discard shader-compile/boot frames
    thinkMs: 0,                       // accumulated by AI modules during a frame
    thinkTotal: 0,
    last: 0, start: 0, sampleStart: 0, done: false,
    systems: {
      update: sys('update'), takeDirector: sys('takeDirector'),
      residents: sys('residents'), horde: sys('horde'),
      escalation: sys('escalation'), gore: sys('gore'), render: sys('render'),
    },
  };
}

function perfRecord(s, d) {
  if (PERF.warmup > 0) return; // aligned: every system records once per frame
  s.total += d; s.count++;
  if (d > s.max) s.max = d;
  s.ring[s.ri] = d; s.ri = (s.ri + 1) % 600;
}

function perfFrameStart() {
  const now = performance.now();
  if (PERF.start === 0) { PERF.start = now; PERF.last = now; return; }
  if (PERF.warmup > 0) {
    PERF.warmup--;
    if (PERF.warmup === 0) PERF.sampleStart = now;
  } else {
    const i = PERF.n % 600;
    PERF.frames[i] = now - PERF.last;
    PERF.thinks[i] = PERF.thinkMs;
    PERF.thinkTotal += PERF.thinkMs;
    PERF.n++;
    if (!PERF.done && now - PERF.sampleStart >= 20000) {
      PERF.done = true;
      console.log('[perf] ' + JSON.stringify(perfSummary()));
    }
  }
  PERF.thinkMs = 0;
  PERF.last = now;
}

function perfPct(arr, p) {
  const s = Array.from(arr).sort((a, b) => a - b);
  return s.length ? +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(3) : 0;
}

function perfSummary() {
  const count = Math.min(PERF.n, 600);
  const frames = PERF.frames.slice(0, count);
  const thinks = PERF.thinks.slice(0, count);
  let frameSum = 0;
  for (let i = 0; i < count; i++) frameSum += frames[i];
  const systems = {};
  for (const k in PERF.systems) {
    const s = PERF.systems[k];
    systems[k] = {
      avg: +(s.total / Math.max(1, s.count)).toFixed(3),
      p95: perfPct(s.ring.slice(0, Math.min(s.count, 600)), 0.95),
      max: +s.max.toFixed(3),
    };
  }
  return {
    frames: count,
    frameAvg: +(frameSum / Math.max(1, count)).toFixed(3),
    frameP50: perfPct(frames, 0.5),
    frameP95: perfPct(frames, 0.95),
    thinkAvg: +(PERF.thinkTotal / Math.max(1, PERF.n)).toFixed(3),
    thinkP95: perfPct(thinks, 0.95),
    systems,
  };
}

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(CFG.render.fogColor, CFG.render.fogDensity);

const camera = new THREE.PerspectiveCamera(
  CFG.camera.fov, window.innerWidth / window.innerHeight, 0.1, 200
);
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// lighting: cold night town — must READ like a lit night scene, not a void
scene.add(new THREE.AmbientLight(0x6a7470, 5.0));
const moon = new THREE.DirectionalLight(0xaab6aa, 3.6);
moon.position.set(-4, 8, -3);
scene.add(moon);
const fill = new THREE.DirectionalLight(0x5a6458, 1.8);
fill.position.set(5, 3, 6);
scene.add(fill);

// town
const town = generateTown(scene, CFG);

// lamp point lights (few, cheap)
for (const lp of town.lampPositions.slice(0, 16)) {
  const pl = new THREE.PointLight(0xb0a578, 6.0, 13, 1.5);
  pl.position.set(lp.x, lp.y - 0.2, lp.z);
  scene.add(pl);
}

// player
const player = makePlayer();
const startOverride = new URLSearchParams(location.search).get('start');
if (startOverride === 'street') {
  player.position.set(2, 0, 14); // mid main avenue, buildings in view
} else {
  player.position.set(town.playerSpawn.x, 0, town.playerSpawn.z);
}
scene.add(player);

// graveyard key light: pale cold glow over her open grave — the start must read
const graveLight = new THREE.PointLight(0x9aa89a, 3.2, 14, 1.4);
graveLight.position.set(town.playerSpawn.x, 3.4, town.playerSpawn.z);
scene.add(graveLight);

// systems
const gameState = createGameState();
const gore = createGore(scene);
const dismember = createDismember(scene, gore);
const takeDirector = createTakeDirector(camera, player);
const residents = createResidents(scene, town, CFG, (r) => {
  // witness hook — escalation wave will use this
}, gameState);
gameState.state.womenTotal = residents.list.filter((r) => r.role === 'woman').length;

const audio = await createAudio().catch(() => null); // non-fatal if fetch fails
const interactions = createInteractions({
  player, residents, takeDirector, gore, gameState, audio, town, dismember,
});
const horde = createHorde({ residents, town, gameState, CFG });
const escalation = createEscalation({ residents, town, gameState, CFG, gore, player });
if (audio && escalation.onPlayerShot !== undefined) {
  escalation.onPlayerShot = () => audio.play('impact', { gain: 0.9, rate: 1.6 }); // rifle crack placeholder
}
const audioDirector = createAudioDirector({ audio, gameState, player, residents, camera });

const hud = createHUD(document.getElementById('hud'), gameState);
const flow = createFlow(document.getElementById('hud'), gameState);

// input
const input = createInput(canvas, document.getElementById('touch-ui'));

// pacing autopilot + external hooks (only with ?sim)
let simDriver = null;
if (simParam !== null) {
  const { createSimDriver } = await import('./game/sim.js');
  simDriver = createSimDriver({
    player, residents, gameState, interactions, takeDirector, input, town, CFG,
    steer: (yaw) => { camYaw = yaw; },
  });
  window.__sim = {
    player, residents, gameState, interactions, takeDirector, town, camera, CFG,
    state: () => ({ ...gameState.state }),
    teleport: (x, z) => {
      if (isBlocked(town.navGrid, town.gridSize, town.origin, town.cellSize, x, z)) return false;
      player.position.x = x; player.position.z = z; return true;
    },
    interact: () => interactions.tryInteract(),
  };
}

// third-person camera state
let camYaw = Math.PI;
let camPitch = -0.22;
const camTarget = new THREE.Vector3();

const post = createPostPipeline(renderer, scene, camera);

const clock = new THREE.Clock();
let walkPhase = 0;

const frame = (render = true) => {
  let dt = Math.min(clock.getDelta(), 0.05);
  if (SIM_DT > 1) dt *= SIM_DT; // ?sim=fast: 10x game-time for pacing runs
  if (PERF) perfFrameStart();

  let _t = PERF ? performance.now() : 0; // update-total start (excludes render)

  gameState.tick(dt);
  // autopilot runs before the movement block: it writes input.move/sprint and
  // camYaw, which the block below consumes this frame (input.update() at frame
  // end would otherwise clear them first)
  if (simDriver) simDriver.update(dt);

  if (!takeDirector.busy && !gameState.state.over && flow.started) {
    // look
    camYaw -= input.look.dx * 0.0032;
    camPitch = THREE.MathUtils.clamp(camPitch - input.look.dy * 0.0028, -0.9, 0.35);

    // move (camera-relative). Basis: forward = (sin,cos), right = (cos,-sin);
    // world = right*mv.x + forward*(-mv.y) — mv.y = -1 is "W" / stick-up.
    // (dz previously had both signs flipped: W walked backward at camYaw=0
    //  and strafe was mirrored — movement was wrong at every diagonal.)
    const mv = input.move;
    const spd = CFG.player.speed * (input.sprint ? CFG.player.sprintMul : 1);
    if (mv.x !== 0 || mv.y !== 0) {
      const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
      const dx = (mv.x * cos - mv.y * sin) * spd * dt;
      const dz = (-mv.x * sin - mv.y * cos) * spd * dt;
      const nx = player.position.x + dx;
      const nz = player.position.z + dz;
      if (!isBlocked(town.navGrid, town.gridSize, town.origin, town.cellSize, nx, player.position.z)) player.position.x = nx;
      if (!isBlocked(town.navGrid, town.gridSize, town.origin, town.cellSize, player.position.x, nz)) player.position.z = nz;
      player.rotation.y = Math.atan2(dx, dz);
      walkPhase += dt * spd * 2.2;
      setWalkPhase(player, walkPhase, spd / CFG.player.speed);
    } else {
      setWalkPhase(player, 0, 0);
    }

    // interact
    if (input.interact) interactions.tryInteract();

    // camera collision: keep the eye out of buildings
    const camClear = (x, z) => !isBlocked(town.navGrid, town.gridSize, town.origin, town.cellSize, x, z);

    // third-person camera follow (shorten boom if a building blocks it)
    let cd = CFG.camera.thirdDist;
    const ch = CFG.camera.thirdHeight;
    let cx = 0, cz = 0, cy = 0;
    for (let k = 1; k >= 0.3; k -= 0.15) {
      const d = cd * k;
      cx = player.position.x - Math.sin(camYaw) * d * Math.cos(camPitch);
      cz = player.position.z - Math.cos(camYaw) * d * Math.cos(camPitch);
      if (camClear(cx, cz)) { cd = d; break; }
      cd = d;
    }
    cy = player.position.y + ch - Math.sin(camPitch) * cd;
    camera.position.set(cx, cy, cz);
    camTarget.set(
      player.position.x + Math.sin(camYaw) * 2,
      player.position.y + 1.4,
      player.position.z + Math.cos(camYaw) * 2
    );
    camera.lookAt(camTarget);
  }

  if (PERF) { const a = performance.now(); takeDirector.update(dt); perfRecord(PERF.systems.takeDirector, performance.now() - a); }
  else takeDirector.update(dt);
  interactions.update(dt);
  hud.setPrompt(takeDirector.busy ? null : interactions.currentTarget);
  if (PERF) { const a = performance.now(); residents.update(dt, player.position); perfRecord(PERF.systems.residents, performance.now() - a); }
  else residents.update(dt, player.position);
  if (PERF) { const a = performance.now(); horde.update(dt, player.position); perfRecord(PERF.systems.horde, performance.now() - a); }
  else horde.update(dt, player.position);
  if (PERF) { const a = performance.now(); escalation.update(dt); perfRecord(PERF.systems.escalation, performance.now() - a); }
  else escalation.update(dt);
  audioDirector.update(dt);
  if (PERF) { const a = performance.now(); gore.update(dt, camera); perfRecord(PERF.systems.gore, performance.now() - a); }
  else gore.update(dt, camera);
  dismember.update(dt);
  hud.update();

  input.update();
  if (PERF) perfRecord(PERF.systems.update, performance.now() - _t);

  if (!render) return; // sim fast-forward: most ticks skip pixels entirely
  if (PERF) { const a = performance.now(); post.render(); perfRecord(PERF.systems.render, performance.now() - a); }
  else post.render();
};

if (simParam !== null) {
  // pacing sim: rAF does NOT advance under --virtual-time-budget in new
  // headless Chrome, but setTimeout chains fast-forward perfectly. Drive the
  // loop with 16ms timers; render 1 tick in 30 (pacing needs state, not pixels).
  let n = 0;
  const step = () => { frame(++n % 30 === 0); setTimeout(step, 16); };
  step();
} else {
  renderer.setAnimationLoop(() => frame(true));
}
