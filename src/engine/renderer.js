// Renderer bootstrap: WebGPURenderer with automatic WebGL2 fallback.
// Force paths with ?gl=1 (WebGL2) or ?webgpu=1.
import * as THREE from 'three/webgpu';
import { CFG } from '../config.js';

export async function createRenderer(canvas) {
  const params = new URLSearchParams(location.search);
  const forceWebGL = params.get('gl') === '1';

  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: false, // era-authentic: hard edges
    forceWebGL,
    powerPreference: 'high-performance',
  });

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(CFG.render.fogColor, 1);

  await renderer.init();

  const isWebGPU = !forceWebGL && renderer.backend.isWebGPUBackend === true;
  const backend = forceWebGL ? 'webgl2(forced)' : (isWebGPU ? 'webgpu' : 'webgl2(fallback)');
  console.info('[renderer]', backend);

  // PS1 internal-res upscale: render 3D into a low-res target, nearest-sample to screen.
  // Applied on both backends; WebGPU gets the native path, WebGL2 the same target.
  const scale = CFG.render.ps1ResolutionScale;
  const makeRT = () => new THREE.RenderTarget(
    Math.max(2, Math.floor(window.innerWidth * scale)),
    Math.max(2, Math.floor(window.innerHeight * scale)),
    { depthBuffer: true }
  );
  const rt = makeRT();
  rt.texture.minFilter = THREE.NearestFilter;
  rt.texture.magFilter = THREE.NearestFilter;
  renderer.__lowresRT = rt; // consumed by post.js

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    rt.setSize(
      Math.max(2, Math.floor(window.innerWidth * scale)),
      Math.max(2, Math.floor(window.innerHeight * scale))
    );
  });

  return renderer;
}
