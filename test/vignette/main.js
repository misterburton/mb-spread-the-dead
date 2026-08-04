// The frame: she stands at the edge of her open grave, dead tree behind,
// iron fence in the murk. One composed shot — the visual bar for the game.
import * as THREE from 'three/webgpu';
import { createRenderer } from '../../src/engine/renderer.js';
import { createPostPipeline } from '../../src/engine/post.js';
import { makeHer } from './her.js';
import { makeGraveyard } from './graveyard.js';
import { CFG } from '../../src/config.js';

const canvas = document.getElementById('game');
const renderer = await createRenderer(canvas);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x2d2d2a, 0.045);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 120);

// key: cold moon from behind-left (rim on her shoulders/hair)
const moon = new THREE.DirectionalLight(0x8a988f, 1.1);
moon.position.set(-5, 7, -4);
scene.add(moon);
// fill: faint green-gray from camera side so her face reads
const fill = new THREE.DirectionalLight(0x4a544c, 0.5);
fill.position.set(3, 2, 6);
scene.add(fill);
// grave glow: pale cold pool at her feet
const graveGlow = new THREE.PointLight(0x9aa89a, 1.6, 8, 1.6);
graveGlow.position.set(0, 0.8, 0.5);
scene.add(graveGlow);
scene.add(new THREE.AmbientLight(0x323a35, 0.85));

const yard = makeGraveyard();
scene.add(yard);

const her = makeHer();
her.position.set(0, 0.35, 1.2); // at the grave's edge, just climbed out
her.rotation.y = 0.15;
scene.add(her);

// camera: low, close, slightly below her eyeline looking up — she towers
camera.position.set(0.6, 1.1, 4.6);
camera.lookAt(0, 1.35, 1.0);

const post = createPostPipeline(renderer, scene, camera);

// subtle idle: she breathes wrong (too slow), hair sways
let t = 0;
renderer.setAnimationLoop(() => {
  t += 1 / 60;
  const p = her.userData.parts;
  p.head.rotation.z = 0.06 + Math.sin(t * 0.4) * 0.02;
  p.head.rotation.x = 0.09 + Math.sin(t * 0.23) * 0.015;
  her.position.y = 0.35 + Math.sin(t * 0.5) * 0.008;
  post.render();
  window.__frames = (window.__frames || 0) + 1;
});
