// Character lineup test: player, 3 men (cap/crop/bald+hat), 2 women (bun/ponytail),
// 1 turned woman, pallbearer — rendered through the repo renderer + post chain.
// Camera sits ~10m out: faces/silhouettes must read at gameplay distance.
// Labels float over each figure with live triangle counts.
import * as THREE from 'three/webgpu';
import { createRenderer } from '../src/engine/renderer.js';
import { createPostPipeline } from '../src/engine/post.js';
import { makeEraMaterial } from '../src/engine/era.js';
import {
  makePlayer, makeResident, makePallbearer, applyTurn, setWalkPhase, setDeadPose,
} from '../src/characters/factory.js';
import { CFG } from '../src/config.js';

const canvas = document.getElementById('game');
const renderer = await createRenderer(canvas);
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(CFG.render.fogColor, CFG.render.fogDensity);
const camera = new THREE.PerspectiveCamera(CFG.camera.fov, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 1.7, 10.2);
camera.lookAt(0, 1.0, 0);

scene.add(new THREE.AmbientLight(0x8a9088, 3.0));
const key = new THREE.DirectionalLight(0xa8ac9a, 2.6);
key.position.set(3, 6, 4);
scene.add(key);
const rim = new THREE.DirectionalLight(0x5a6a76, 1.6);
rim.position.set(-4, 3, -5);
scene.add(rim);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), makeEraMaterial({ color: 0x2e3436 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
// light backdrop wall so dark silhouettes read against something
const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(60, 12), makeEraMaterial({ color: 0x3a4145 }));
backdrop.position.set(0, 5, -6);
scene.add(backdrop);

// --- lineup ---------------------------------------------------------------
const turnedWoman = makeResident({ gender: 'f', style: 'dress', hair: 'bun', build: 'avg' });
applyTurn(turnedWoman);

const entries = [
  { g: makePlayer(), label: 'PLAYER', walk: 0.9 },
  { g: makeResident({ gender: 'm', style: 'flannel', hair: 'cap', build: 'avg' }), label: 'MAN/CAP', walk: 1.0 },
  { g: makeResident({ gender: 'm', style: 'work', hair: 'crop', build: 'heavy' }), label: 'MAN/CROP' },
  { g: makeResident({ gender: 'm', style: 'sweater', hair: 'baldHat', build: 'thin' }), label: 'MAN/HAT', walk: 0.8 },
  { g: makeResident({ gender: 'f', style: 'dress', hair: 'bun', build: 'avg' }), label: 'WOMAN/BUN', walk: 1.0 },
  { g: makeResident({ gender: 'f', style: 'flannel', hair: 'ponytail', build: 'thin' }), label: 'WOMAN/PONY' },
  { g: turnedWoman, label: 'TURNED' },
  { g: makePallbearer(), label: 'PALLBEARER' },
];

// triangle counter: unique geometry tris per character (geos are cached/shared)
function triCount(root) {
  let tris = 0;
  root.traverse((o) => {
    if (o.isMesh) {
      const g = o.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
  });
  return Math.round(tris);
}

const labelRoot = document.getElementById('labels');
const spacing = 1.35;
entries.forEach((e, i) => {
  e.g.position.x = (i - (entries.length - 1) / 2) * spacing;
  scene.add(e.g);
  const div = document.createElement('div');
  div.textContent = `${e.label}\n${triCount(e.g)} tri`;
  labelRoot.appendChild(div);
  e.div = div;
});

// one dead turned resident off to the side for pose verification
const dead = makeResident({ gender: 'f', style: 'dress', hair: 'ponytail' });
applyTurn(dead);
setDeadPose(dead);
dead.position.set((entries.length / 2) * spacing + 1.2, 0, -1.5);
scene.add(dead);

const post = createPostPipeline(renderer, scene, camera);
window.__scene = scene; window.__entries = entries; window.__THREE = THREE; window.__camera = camera; window.__renderer = renderer;
const nopost = new URLSearchParams(location.search).get('nopost') === '1';

const v = new THREE.Vector3();
let t = 0;
renderer.setAnimationLoop(() => {
  t += 1 / 60;
  for (const e of entries) {
    if (e.walk) setWalkPhase(e.g, t * 5 * e.walk, e.walk);
    // project label above head
    v.set(e.g.position.x, 2.05, e.g.position.z).project(camera);
    e.div.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
    e.div.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
  }
  // slow dolly sway so silhouettes can be judged in motion
  camera.position.x = Math.sin(t * 0.25) * 0.8;
  camera.lookAt(0, 1.0, 0);
  if (nopost) renderer.render(scene, camera); else post.render();
  if (window.__frames !== undefined) window.__frames++;
});
