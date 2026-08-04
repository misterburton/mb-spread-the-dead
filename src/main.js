import * as THREE from 'three/webgpu';
import { createRenderer } from './engine/renderer.js';
import { createPostPipeline } from './engine/post.js';
import { CFG } from './config.js';

const canvas = document.getElementById('game');
const renderer = await createRenderer(canvas);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(CFG.render.fogColor, CFG.render.fogDensity);

const camera = new THREE.PerspectiveCamera(
  CFG.camera.fov, window.innerWidth / window.innerHeight, 0.1, 200
);
camera.position.set(0, CFG.camera.thirdHeight, CFG.camera.thirdDist);
camera.lookAt(0, 1, 0);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// --- placeholder test scene (piece 1 smoke test) ---
scene.add(new THREE.AmbientLight(0x334033, 2.2));
const key = new THREE.DirectionalLight(0x778877, 1.6);
key.position.set(3, 6, 2);
scene.add(key);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshLambertNodeMaterial({ color: 0x15181a })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// rough street blocks for silhouette reading
const boxMat = new THREE.MeshLambertNodeMaterial({ color: 0x23282b });
for (let x = -3; x <= 3; x++) {
  for (let z = -3; z <= 3; z++) {
    if (x === 0 && z === 0) continue;
    const h = 3 + ((x * 7 + z * 13 + 100) % 5);
    const b = new THREE.Mesh(new THREE.BoxGeometry(6, h, 6), boxMat);
    b.position.set(x * CFG.town.blockSize, h / 2, z * CFG.town.blockSize);
    scene.add(b);
  }
}

// player placeholder — a single figure
const figure = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.3, 1.0, 3, 8),
  new THREE.MeshLambertNodeMaterial({ color: 0x3a3f45 })
);
figure.position.y = 0.85;
scene.add(figure);

const post = createPostPipeline(renderer, scene, camera);

let __frame = 0;
renderer.setAnimationLoop(() => {
  post.render();
  if (++__frame === 30) {
    // pixel probe: detect black frames on any backend
    const gl = renderer.getContext?.();
    try {
      let mean = -1;
      if (gl && gl.readPixels) {
        const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
        const px = new Uint8Array(4 * 64);
        gl.readPixels((w / 2) | 0, (h / 2) | 0, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, px);
        mean = 0;
        for (let i = 0; i < px.length; i += 4) mean += px[i] + px[i + 1] + px[i + 2];
        mean /= 3 * 64;
      }
      console.info('[probe] canvas-luma', mean.toFixed(1));
    } catch (e) {
      console.info('[probe] canvas-luma unavailable:', e.message);
    }
  }
});
