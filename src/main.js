import * as THREE from 'three/webgpu';
import { createRenderer } from './engine/renderer.js';
import { createPostPipeline } from './engine/post.js';
import { createInput } from './engine/input.js';
import { generateTown, isBlocked } from './world/town.js';
import { makePlayer, setWalkPhase } from './characters/factory.js';
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

// lighting: cold night town — readable silhouettes, not pitch black
scene.add(new THREE.AmbientLight(0x39423e, 2.6));
const moon = new THREE.DirectionalLight(0x6a7668, 1.5);
moon.position.set(-4, 8, -3);
scene.add(moon);

// town
const town = generateTown(scene, CFG);

// lamp point lights (few, cheap)
for (const lp of town.lampPositions.slice(0, 16)) {
  const pl = new THREE.PointLight(0x9a9070, 3.4, 11, 1.6);
  pl.position.set(lp.x, lp.y - 0.2, lp.z);
  scene.add(pl);
}

// player
const player = makePlayer();
player.position.set(town.playerSpawn.x, 0, town.playerSpawn.z);
scene.add(player);

// input
const input = createInput(canvas, document.getElementById('touch-ui'));

// third-person camera state
let camYaw = Math.PI;       // facing out of the graveyard
let camPitch = -0.22;
const camTarget = new THREE.Vector3();

const post = createPostPipeline(renderer, scene, camera);

const clock = new THREE.Clock();
let walkPhase = 0;

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);

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

  // third-person camera follow
  const cd = CFG.camera.thirdDist, ch = CFG.camera.thirdHeight;
  const cx = player.position.x - Math.sin(camYaw) * cd * Math.cos(camPitch);
  const cz = player.position.z - Math.cos(camYaw) * cd * Math.cos(camPitch);
  const cy = player.position.y + ch - Math.sin(camPitch) * cd;
  camera.position.set(cx, cy, cz);
  camTarget.set(
    player.position.x + Math.sin(camYaw) * 2,
    player.position.y + 1.4,
    player.position.z + Math.cos(camYaw) * 2
  );
  camera.lookAt(camTarget);

  input.update();
  post.render();
});
