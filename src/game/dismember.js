// Dismemberment: on kill completion, 1-2 limbs are torn off the victim,
// flung 1-3m in an arc, and left as persistent props for the whole run.
// Clones share geometry/material with the victim's limb (cheap); the
// original limb is stumped at the joint (scale 0.01). Pool-capped at
// MAX_LIMBS — oldest landed prop is recycled when the cap is hit.
// No per-frame allocations: ballistic sim uses module-scope temps.
import * as THREE from 'three/webgpu';

const MAX_LIMBS = 40;
const GRAV = 9.8;
const GROUND_Y = 0.1; // rests half-thickness off the dirt

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3();

export function createDismember(scene, gore) {
  const flying = []; // {g, vx, vy, vz, sx, sz} — in flight only
  const props = [];  // landed, persistent (ring for the cap)

  function severOne(pivot, dirX, dirZ) {
    pivot.updateWorldMatrix(true, false);
    pivot.getWorldPosition(_pos);
    pivot.getWorldQuaternion(_quat);
    pivot.getWorldScale(_scl);

    const clone = pivot.clone(true); // meshes cloned, geo/mat shared
    clone.position.copy(_pos);
    clone.quaternion.copy(_quat);
    clone.scale.copy(_scl);
    scene.add(clone);

    // stump the original at the joint
    pivot.scale.setScalar(0.01);
    pivot.userData.severed = true;

    // ballistic throw: land 1-3m out along dir (jittered), arced
    const dist = 1 + Math.random() * 2;
    const ja = (Math.random() - 0.5) * 1.1;
    const c = Math.cos(ja), s = Math.sin(ja);
    const tx = _pos.x + (dirX * c - dirZ * s) * dist;
    const tz = _pos.z + (dirX * s + dirZ * c) * dist;
    const t = 0.45 + Math.random() * 0.3; // flight time
    flying.push({
      g: clone,
      vx: (tx - _pos.x) / t,
      vy: (GROUND_Y - _pos.y) / t + 0.5 * GRAV * t,
      vz: (tz - _pos.z) / t,
      sx: (Math.random() - 0.5) * 10, // tumble spin rad/s
      sz: (Math.random() - 0.5) * 10,
    });
  }

  // tear 1-2 limbs off a freshly dead victim; returns how many severed
  function sever(victimGroup, dirX = 0, dirZ = 1) {
    const parts = victimGroup.userData.parts;
    if (!parts) return 0;
    const limbs = [parts.armL, parts.armR, parts.legL, parts.legR]
      .filter((l) => l && !l.userData.severed);
    if (!limbs.length) return 0;
    const n = Math.min(limbs.length, 1 + ((Math.random() * 2) | 0));
    for (let i = 0; i < n; i++) {
      const idx = (Math.random() * limbs.length) | 0;
      severOne(limbs.splice(idx, 1)[0], dirX, dirZ);
    }
    return n;
  }

  function update(dt) {
    for (let i = flying.length - 1; i >= 0; i--) {
      const f = flying[i];
      f.vy -= GRAV * dt;
      const g = f.g;
      g.position.x += f.vx * dt;
      g.position.y += f.vy * dt;
      g.position.z += f.vz * dt;
      g.rotation.x += f.sx * dt;
      g.rotation.z += f.sz * dt;
      if (g.position.y <= GROUND_Y) {
        // land: lie flat with random yaw, slight blood decal beneath
        g.position.y = GROUND_Y;
        g.rotation.set(
          -Math.PI / 2 + (Math.random() - 0.5) * 0.5,
          Math.random() * Math.PI * 2, 0, 'YXZ'
        );
        gore.addDecal(
          g.position.x + (Math.random() - 0.5) * 0.2,
          g.position.z + (Math.random() - 0.5) * 0.2,
          0.3 + Math.random() * 0.25, 1.4, Math.random() * Math.PI
        );
        flying.splice(i, 1);
        props.push(g);
        if (props.length > MAX_LIMBS) scene.remove(props.shift());
      }
    }
  }

  return { sever, update, get count() { return props.length + flying.length; } };
}
