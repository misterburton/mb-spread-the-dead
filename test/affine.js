// Minimal affine-material repro: one textured plane with affine colorNode +
// jitter positionNode on WebGL2 fallback. Dumps program diagnostics + GLSL
// for any program that fails validation.
import * as THREE from 'three/webgpu';
import { jitterPosition, affineUV, affineTexture } from '/src/engine/era.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, forceWebGL: true });
renderer.setSize(640, 360);
renderer.setClearColor(0x203040, 1);
await renderer.init();
console.info('[repro] backend', renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2');

const scene = new THREE.Scene();
scene.add(new THREE.AmbientLight(0xffffff, 2.0));
const camera = new THREE.PerspectiveCamera(55, 640 / 360, 0.1, 100);
camera.position.set(0, 2, 6);
camera.lookAt(0, 0, 0);

// 64px checker canvas texture, nearest
const cv = document.createElement('canvas');
cv.width = cv.height = 64;
const cx = cv.getContext('2d');
for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
  cx.fillStyle = (x + y) % 2 ? '#c03030' : '#30c030';
  cx.fillRect(x * 8, y * 8, 8, 8);
}
const tex = new THREE.CanvasTexture(cv);
tex.colorSpace = THREE.SRGBColorSpace;
tex.minFilter = tex.magFilter = THREE.NearestFilter;
tex.generateMipmaps = false;
tex.wrapS = tex.wrapT = THREE.RepeatWrapping;

const mode = new URLSearchParams(location.search).get('mode') || 'affine';

let m;
if (mode === 'affine') {
  m = new THREE.MeshLambertNodeMaterial({ color: 0xffffff });
  m.colorNode = affineTexture(tex, affineUV([4, 4])).mul(new THREE.Color(0xffffff));
} else {
  m = new THREE.MeshLambertNodeMaterial({ map: tex, color: 0xffffff });
}
m.positionNode = jitterPosition();

const plane = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), m);
plane.rotation.x = -Math.PI / 3;
scene.add(plane);

renderer.render(scene, camera);
console.info('[repro] first frame done');

// dump the exact GLSL three generated for this renderable
try {
  const shaders = await renderer.debug.getShaderAsync(scene, camera, plane);
  console.info('[repro] === VERTEX ===\n' + shaders.vertexShader);
  console.info('[repro] === FRAGMENT ===\n' + shaders.fragmentShader);
} catch (e) {
  console.info('[repro] getShaderAsync failed:', e.message);
}
window.__reproDone = true;
