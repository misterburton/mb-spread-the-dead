// Era-effects test scene: jitter ON vs OFF comparison + affine warp quad.
import * as THREE from 'three/webgpu';
import { createRenderer } from '../src/engine/renderer.js';
import { createPostPipeline } from '../src/engine/post.js';
import { makeEraMaterial, affineUV, affineTexture, setJitter } from '../src/engine/era.js';
import { CFG } from '../src/config.js';

const params = new URLSearchParams(location.search);
const jitter = params.get('jitter') !== '0';
setJitter(jitter ? CFG.render.snapVertex : 0.0000001);

const canvas = document.getElementById('game');
const renderer = await createRenderer(canvas);
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(CFG.render.fogColor, CFG.render.fogDensity);
const camera = new THREE.PerspectiveCamera(CFG.camera.fov, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 2.2, 6);
camera.lookAt(0, 1, 0);

scene.add(new THREE.AmbientLight(0x556055, 2.4));
const key = new THREE.DirectionalLight(0x889988, 2.0);
key.position.set(3, 6, 2);
scene.add(key);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(120, 120),
  makeEraMaterial({ color: 0x1a1e20 })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// checkered slab to show affine warp (procedural checker texture)
const cv = document.createElement('canvas'); cv.width = cv.height = 64;
const cx = cv.getContext('2d');
for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
  cx.fillStyle = (x + y) % 2 ? '#2e3436' : '#454e48';
  cx.fillRect(x * 8, y * 8, 8, 8);
}
const checker = new THREE.CanvasTexture(cv);
checker.colorSpace = THREE.SRGBColorSpace;

const slabMat = makeEraMaterial({});
const aff = affineUV();
slabMat.colorNode = affineTexture(checker, aff);
const slab = new THREE.Mesh(new THREE.BoxGeometry(6, 0.3, 4), slabMat);
slab.position.set(0, 0.15, -2);
slab.rotation.y = 0.5;
scene.add(slab);

// figure silhouettes with jitter
const figMat = makeEraMaterial({ color: 0x3a3f45 });
for (let i = -2; i <= 2; i++) {
  const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.0, 3, 8), figMat);
  f.position.set(i * 1.4, 0.85, 0);
  scene.add(f);
}

const post = createPostPipeline(renderer, scene, camera);

let t = 0;
renderer.setAnimationLoop(() => {
  t += 1 / 60;
  // slow camera drift makes jitter visible as wobble in animation
  camera.position.x = Math.sin(t * 0.3) * 1.2;
  camera.lookAt(0, 1, 0);
  post.render();
  if (window.__frames !== undefined) window.__frames++;
});
