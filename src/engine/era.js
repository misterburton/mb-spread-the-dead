// PS1-era TSL material helpers: vertex jitter (clip-space position snap) and
// affine (non-perspective-correct) texture warping via varying interpolation.
// Verified against three@0.185.1 sources (VaryingNode.setInterpolation(type, sampling)
// → WGSL @interpolate(type, sampling); 'linear' = affine, 'perspective' = default).
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, float, vec2, vec3, vec4,
  positionLocal, cameraProjectionMatrix, cameraViewMatrix,
  modelWorldMatrix, uv, texture, floor, varying,
} from 'three/tsl';
import { CFG } from '../config.js';

export const jitterAmount = uniform(CFG.render.snapVertex);

// Snap a clip-space position to a coarse NDC grid → vertex jitter / wobble.
export const clipSnap = Fn(([clipPos, grid]) => {
  const invW = float(1.0).div(clipPos.w);
  const ndcX = clipPos.x.mul(invW);
  const ndcY = clipPos.y.mul(invW);
  const snappedX = floor(ndcX.div(grid)).add(0.5).mul(grid);
  const snappedY = floor(ndcY.div(grid)).add(0.5).mul(grid);
  return vec4(snappedX.mul(clipPos.w), snappedY.mul(clipPos.w), clipPos.z, clipPos.w);
});

// Era material: Lambert node material with vertex jitter applied as an
// object-space displacement that approximates clip-space snapping.
// (Stable, cheap, works on both WebGPU + WebGL2 node paths.)
export function makeEraMaterial(params = {}) {
  const mat = new THREE.MeshLambertNodeMaterial(params);
  mat.positionNode = jitterPosition();
  return mat;
}

export function jitterPosition() {
  return Fn(() => {
    const world = modelWorldMatrix.mul(vec4(positionLocal, 1.0));
    const view = cameraViewMatrix.mul(world);
    const clip = cameraProjectionMatrix.mul(view);
    const snapped = clipSnap(clip, jitterAmount);
    const delta = snapped.sub(clip);
    // clip delta → approximate view delta (valid for perspective at vertex depth)
    const dxView = delta.x.mul(view.z.mul(-1.0)).div(cameraProjectionMatrix[0][0]);
    const dyView = delta.y.mul(view.z.mul(-1.0)).div(cameraProjectionMatrix[1][1]);
    const viewSnapped = view.add(vec4(dxView, dyView, 0.0, 0.0));
    const worldSnapped = cameraViewMatrix.inverse().mul(viewSnapped);
    return modelWorldMatrix.inverse().mul(worldSnapped).xyz;
  })();
}

// Affine texture warp: interpolate uv*w with LINEAR (affine) interpolation,
// divide by w (also linear) in fragment → classic PS1 swimmy textures.
// `scale` (optional [sx, sy]) bakes a texture repeat into the affine UV —
// needed because texture() with an explicit uv node skips the texture matrix.
export function affineUV(scale = null) {
  const view = cameraViewMatrix.mul(modelWorldMatrix.mul(vec4(positionLocal, 1.0)));
  const w = view.z.negate();
  const baseUV = scale ? uv().mul(vec2(scale[0], scale[1])) : uv();
  return {
    uvw: varying(baseUV.mul(w), 'vAffineUVW').setInterpolation('linear', 'center'),
    w: varying(w, 'vAffineW').setInterpolation('linear', 'center'),
  };
}

export function affineTexture(tex, affine) {
  return texture(tex, affine.uvw.div(affine.w));
}

// Backend probe for gating WebGPU-only TSL paths.
// GLSL noperspective interpolation breaks SwiftShader WebGL2 validation, so
// affine warp must be skipped on the WebGL2 fallback.
export function isWebGL2() {
  return new URLSearchParams(location.search).get('gl') === '1';
}

export function setJitter(v) { jitterAmount.value = v; }
