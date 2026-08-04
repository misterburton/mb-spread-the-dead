// Era post stack: scene renders into a low-res RT; we grade (desat, quantize,
// Bayer dither, vignette) and nearest-upscale to screen via a fullscreen quad
// (compatible with WebGPU + WebGL2 backends). TSL throughout.
import * as THREE from 'three/webgpu';
import { texture, Fn, vec3, vec4, screenCoordinate, mix, uniform, fract, floor, dot, uv, float } from 'three/tsl';
import { CFG } from '../config.js';

// ordered dither from pixel position (portable across WGSL/GLSL)
const bayer = Fn(([p]) => {
  const x = p.x.mod(4);
  const y = p.y.mod(4);
  const a = fract(x.mul(0.5).add(y.mul(0.25)));
  const b = fract(x.mul(0.25).add(y.mul(0.5)).add(0.5));
  return fract(a.add(b).mul(0.5).add(x.add(y).mul(0.0625)));
});

const isWebGPU = false; // set inside factory (kept for future backend splits)

export function createPostPipeline(renderer, scene, camera) {
  const rt = renderer.__lowresRT;

  // Fullscreen quad that samples the low-res target (NearestFilter does the upscale)
  const quadScene = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const amount = uniform(CFG.render.ditherAmount);
  const tint = uniform(new THREE.Vector3(...CFG.render.gradeTint));
  const exposure = uniform(CFG.render.exposure ?? 1.0);

  const mat = new THREE.MeshBasicNodeMaterial();
  const src = texture(rt.texture);

  mat.colorNode = Fn(() => {
    const frag = src;
    const luma = dot(frag.rgb, vec3(0.299, 0.587, 0.114));
    let col = mix(vec3(luma), frag.rgb, 0.22).mul(tint).mul(exposure);   // near-monochrome crush + lift
    col = floor(col.mul(31.0)).add(0.5).div(31.0);         // color-depth banding
    const d = bayer(screenCoordinate.xy).sub(0.5).mul(amount.mul(1.0 / 48.0));
    col = col.add(d);                                      // ordered dither
    const vuv = uv().sub(0.5);
    const vig = float(1.0).sub(dot(vuv, vuv).mul(0.85));
    col = col.mul(vig.clamp(0.0, 1.0));                    // vignette
    return vec4(col, 1.0);
  })();

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  quadScene.add(quad);

  return {
    render: () => {
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(quadScene, quadCam);
      // debug: probe center of RT once
      if (!window.__probeDone) {
        window.__probeDone = true;
        renderer.readRenderTargetPixelsAsync(rt, rt.width / 2 | 0, rt.height / 2 | 0, 8, 8, new Uint8Array(4 * 64))
          .then((buf) => {
            let m = 0; for (let i = 0; i < buf.length; i += 4) m += buf[i] + buf[i + 1] + buf[i + 2];
            console.info('[probe] rt-luma', (m / (3 * 64)).toFixed(1));
          })
          .catch((e) => console.info('[probe] rt-luma failed:', e.message));
      }
    },
    setDither: (v) => { amount.value = v; },
    rt,
  };
}
