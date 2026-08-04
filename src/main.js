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
import { createInteractions } from './game/interactions.js';
import { createAudio } from './game/audio.js';
import { createHorde } from './game/horde.js';
import { createEscalation } from './game/escalation.js';
import { CFG } from './config.js';

const canvas = document.getElementById('game');
const renderer = await createRenderer(canvas);

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

// systems
const gameState = createGameState();
const gore = createGore(scene);
const takeDirector = createTakeDirector(camera, player);
const residents = createResidents(scene, town, CFG, (r) => {
  // witness hook — escalation wave will use this
});
gameState.state.womenTotal = residents.list.filter((r) => r.role === 'woman').length;

const audio = await createAudio().catch(() => null); // non-fatal if fetch fails
const interactions = createInteractions({
  player, residents, takeDirector, gore, gameState, audio,
});
const horde = createHorde({ residents, town, gameState, CFG });
const escalation = createEscalation({ residents, town, gameState, CFG, gore, player });
if (audio && escalation.onPlayerShot !== undefined) {
  escalation.onPlayerShot = () => audio.play('impact', { gain: 0.9, rate: 1.6 }); // rifle crack placeholder
}

const hud = createHUD(document.getElementById('hud'), gameState);

// input
const input = createInput(canvas, document.getElementById('touch-ui'));

// third-person camera state
let camYaw = Math.PI;
let camPitch = -0.22;
const camTarget = new THREE.Vector3();

const post = createPostPipeline(renderer, scene, camera);

const clock = new THREE.Clock();
let walkPhase = 0;

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);

  gameState.tick(dt);

  if (!takeDirector.busy && !gameState.state.over) {
    // look
    camYaw -= input.look.dx * 0.0032;
    camPitch = THREE.MathUtils.clamp(camPitch - input.look.dy * 0.0028, -0.9, 0.35);

    // move (camera-relative)
    const mv = input.move;
    const spd = CFG.player.speed * (input.sprint ? CFG.player.sprintMul : 1);
    if (mv.x !== 0 || mv.y !== 0) {
      const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
      const dx = (mv.x * cos - mv.y * sin) * spd * dt;
      const dz = (mv.x * sin + mv.y * cos) * spd * dt;
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

  takeDirector.update(dt);
  interactions.update(dt);
  hud.setPrompt(takeDirector.busy ? null : interactions.currentTarget);
  residents.update(dt, player.position);
  horde.update(dt);
  escalation.update(dt);
  gore.update(dt, camera);
  hud.update();

  input.update();
  post.render();
});
