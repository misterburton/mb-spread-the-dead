// Take-cut director: hard cut to first-person for each take (kiss or kill),
// hold, snap back out. The signature shot of the game.
import * as THREE from 'three/webgpu';
import { CFG } from '../config.js';

// States: 'third' | 'cutIn' | 'hold' | 'cutOut'
export function createTakeDirector(camera, player) {
  let state = 'third';
  let t = 0;
  let target = null;      // resident being taken
  let mode = null;        // 'kiss' | 'kill'
  let onComplete = null;
  let savedPos = new THREE.Vector3();
  let savedQuat = new THREE.Quaternion();
  const fpPos = new THREE.Vector3();
  const fpLook = new THREE.Vector3();
  let shakeSeed = 0;

  function start(resident, takeMode, doneCb) {
    if (state !== 'third') return false;
    target = resident;
    mode = takeMode;
    onComplete = doneCb || null;
    state = 'cutIn';
    t = 0;
    savedPos.copy(camera.position);
    savedQuat.copy(camera.quaternion);
    shakeSeed = Math.random() * 100;
    return true;
  }

  // first-person framing: her eyes, target's face/chest filling frame
  function frameFirstPerson() {
    const tp = target.group.position;
    const py = player.position.y + CFG.camera.firstHeight;
    // stand close — uncomfortable close
    fpPos.set(
      player.position.x,
      py,
      player.position.z
    );
    // look at target's upper chest/face
    const faceY = mode === 'kiss' ? 1.5 : 1.25;
    fpLook.set(tp.x, tp.y + faceY, tp.z);
    camera.position.copy(fpPos);
    camera.lookAt(fpLook);
  }

  function update(dt) {
    if (state === 'third') return null;
    t += dt;

    if (state === 'cutIn') {
      // hard cut: single-frame blend with a tiny lurch forward
      const k = Math.min(t / CFG.take.cutInSec, 1);
      frameFirstPerson();
      // lurch: push camera toward target in first 100ms
      const lurch = Math.sin(k * Math.PI) * 0.18;
      camera.position.lerp(fpLook, lurch * 0.12);
      if (k >= 1) { state = 'hold'; t = 0; }
    } else if (state === 'hold') {
      frameFirstPerson();
      // handheld shake, stronger for kill
      const amp = CFG.take.shakeAmp * (mode === 'kill' ? 1.6 : 0.7);
      const s = t * 31 + shakeSeed;
      camera.position.x += Math.sin(s * 1.7) * amp * 0.4;
      camera.position.y += Math.sin(s * 2.3 + 1) * amp * 0.3;
      camera.rotation.z += Math.sin(s * 1.3) * amp * 0.12;
      const holdLen = mode === 'kill' ? CFG.take.holdSec : CFG.take.holdSec * 0.6;
      if (t >= holdLen) { state = 'cutOut'; t = 0; }
    } else if (state === 'cutOut') {
      const k = Math.min(t / CFG.take.cutOutSec, 1);
      // snap back: blend to saved third-person transform
      camera.position.lerpVectors(camera.position, savedPos, k * 0.5);
      camera.quaternion.slerp(savedQuat, k * 0.5);
      if (k >= 1) {
        state = 'third';
        const cb = onComplete;
        target = null; mode = null; onComplete = null;
        if (cb) cb();
        return 'done';
      }
    }
    return state;
  }

  return {
    start,
    update,
    get state() { return state; },
    get mode() { return mode; },
    get target() { return target; },
    get busy() { return state !== 'third'; },
  };
}
