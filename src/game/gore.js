// Gore system: blood spray particles, persistent ground decals, body blood.
// WebGPU makes particles nearly free; decals are a capped pool of dark quads.
import * as THREE from 'three/webgpu';
import { CFG } from '../config.js';

const MAX_DECALS = 400;
const MAX_PARTICLES = 900;

export function createGore(scene) {
  // --- decal pool: dark blood quads on the ground, persist for the run ---
  const decalGeo = new THREE.PlaneGeometry(1, 1);
  const decalMat = new THREE.MeshBasicNodeMaterial({ color: 0x1a0505, transparent: true, opacity: 0.85 });
  const decals = new THREE.InstancedMesh(decalGeo, decalMat, MAX_DECALS);
  decals.count = 0;
  decals.frustumCulled = false;
  const dm = new THREE.Matrix4();
  const dq = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const ds = new THREE.Vector3();
  scene.add(decals);
  let decalCount = 0;

  function addDecal(x, z, scale = 1, stretch = 1, angle = 0) {
    if (decalCount >= MAX_DECALS) return;
    ds.set(scale * stretch, scale, 1);
    const q = dq.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, angle)));
    dm.compose(new THREE.Vector3(x, 0.012 + decalCount * 0.00004, z), q, ds);
    decals.setMatrixAt(decalCount, dm);
    decals.count = ++decalCount;
    decals.instanceMatrix.needsUpdate = true;
  }

  // arterial trail: line of small decals from A to B
  function addTrail(x0, z0, x1, z1, width = 0.35) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(2, Math.floor(len / 0.4));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      addDecal(
        x0 + dx * t + (Math.random() - 0.5) * 0.3,
        z0 + dz * t + (Math.random() - 0.5) * 0.3,
        width * (0.6 + Math.random() * 0.8), 1 + Math.random(), Math.random() * Math.PI
      );
    }
  }

  // --- spray particles: instanced quads, CPU-simmed (cheap at this count) ---
  const pGeo = new THREE.PlaneGeometry(0.09, 0.09);
  const pMat = new THREE.MeshBasicNodeMaterial({ color: 0x4a0a08, transparent: true, opacity: 0.95, side: THREE.DoubleSide });
  const spray = new THREE.InstancedMesh(pGeo, pMat, MAX_PARTICLES);
  spray.count = 0;
  spray.frustumCulled = false;
  scene.add(spray);
  const parts = []; // {x,y,z,vx,vy,vz,life,size}
  const pm = new THREE.Matrix4();
  const pq = new THREE.Quaternion();
  const pv = new THREE.Vector3();

  function burst(x, y, z, dirX, dirZ, n = 26, power = 1) {
    for (let i = 0; i < n && parts.length < MAX_PARTICLES; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = (0.6 + Math.random() * 0.4) * power;
      parts.push({
        x, y: y + Math.random() * 0.3, z,
        vx: (dirX * 2.2 + Math.cos(a) * 1.4) * r,
        vy: (1.6 + Math.random() * 2.2) * power,
        vz: (dirZ * 2.2 + Math.sin(a) * 1.4) * r,
        life: 0.5 + Math.random() * 0.7,
        size: 0.5 + Math.random() * 1.3,
      });
    }
  }

  function update(dt, camera) {
    // gravity + ground splat
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.vy -= 9.8 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.life -= dt;
      if (p.y <= 0.02) {
        addDecal(p.x, p.z, 0.14 * p.size, 1 + Math.random(), Math.random() * 3);
        parts.splice(i, 1);
      } else if (p.life <= 0) parts.splice(i, 1);
    }
    // billboard particles to camera
    spray.count = parts.length;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      pv.set(p.x, p.y, p.z);
      pq.copy(camera.quaternion);
      pm.compose(pv, pq, new THREE.Vector3(p.size, p.size, p.size));
      spray.setMatrixAt(i, pm);
    }
    spray.instanceMatrix.needsUpdate = true;
  }

  // blood on a character model: tint bloodable meshes darker red-brown
  function stainCharacter(group, amount = 0.5) {
    const b = group.userData.bloodable;
    if (!b) return;
    const targets = [b.torso, b.head, ...(b.limbs || [])].filter(Boolean);
    for (const mesh of targets) {
      if (Math.random() > amount) continue;
      const m = mesh.material.clone();
      m.color = new THREE.Color(m.color).lerp(new THREE.Color(0x2a0806), 0.55 + Math.random() * 0.3);
      mesh.material = m;
    }
  }

  return { addDecal, addTrail, burst, update, stainCharacter, get decalCount() { return decalCount; } };
}
