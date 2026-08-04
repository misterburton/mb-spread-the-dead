// The visual target: HER, in the graveyard, one frame. Real modeled detail.
// No game logic — this is the bar the rest of the game must hit.
import * as THREE from 'three/webgpu';

const SKIN = 0xcfc8bd;       // pale, dead
const SKIN_DARK = 0xb8b0a4;
const DRESS = 0x161416;      // near-black
const DRESS_HI = 0x232026;
const HAIR = 0x100d0c;
const MOUTH = 0x2a1512;
const EYE = 0x0a0a0a;

function lambert(color) {
  return new THREE.MeshLambertNodeMaterial({ color });
}

// low-poly sphere head with jaw taper, brow, nose, lips, deep eyes
function makeHead() {
  const g = new THREE.Group();
  const skull = new THREE.Mesh(
    new THREE.SphereGeometry(0.115, 7, 6),
    lambert(SKIN)
  );
  skull.scale.set(0.92, 1.12, 0.98);
  // jaw taper: pull lower verts inward
  const pos = skull.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < -0.02) {
      const k = 1 - Math.min(1, (-y - 0.02) / 0.09) * 0.38;
      pos.setX(i, pos.getX(i) * k);
      pos.setZ(i, pos.getZ(i) * (k * 0.96));
    }
  }
  skull.geometry.computeVertexNormals();
  g.add(skull);

  // brow ridge
  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.018, 0.03), lambert(SKIN_DARK));
  brow.position.set(0, 0.045, 0.1);
  brow.rotation.x = -0.15;
  g.add(brow);

  // nose: small wedge
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.045, 4), lambert(SKIN_DARK));
  nose.position.set(0, 0.005, 0.115);
  nose.rotation.x = Math.PI / 2.3;
  g.add(nose);

  // lips: thin dark line + slight lower lip
  const lips = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.008, 0.012), lambert(MOUTH));
  lips.position.set(0, -0.045, 0.104);
  g.add(lips);

  // eyes: deep-set dark sockets with faint wet glint
  for (const sx of [-1, 1]) {
    const socket = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 5), lambert(EYE));
    socket.position.set(sx * 0.042, 0.022, 0.095);
    socket.scale.set(1, 0.8, 0.5);
    g.add(socket);
    const glint = new THREE.Mesh(
      new THREE.PlaneGeometry(0.006, 0.006),
      new THREE.MeshBasicNodeMaterial({ color: 0x8a948e })
    );
    glint.position.set(sx * 0.038, 0.028, 0.117);
    g.add(glint);
    // sunken shadow above eye
    const shadow = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.012, 0.02), lambert(SKIN_DARK));
    shadow.position.set(sx * 0.042, 0.055, 0.098);
    g.add(shadow);
  }

  // cheek hollows
  for (const sx of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.02), lambert(SKIN_DARK));
    cheek.position.set(sx * 0.075, -0.02, 0.075);
    cheek.rotation.y = sx * 0.5;
    g.add(cheek);
  }

  // hair: heavy dark shell + long back fall + front strands
  const hairM = lambert(HAIR);
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.125, 7, 5, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM);
  shell.position.set(0, 0.02, -0.015);
  shell.scale.set(1, 1.1, 1.05);
  g.add(shell);
  const back = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.045, 0.42, 6), hairM);
  back.position.set(0, -0.19, -0.085);
  back.rotation.x = 0.12;
  g.add(back);
  for (const sx of [-1, 1]) {
    const strand = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.22, 0.02), hairM);
    strand.position.set(sx * 0.1, -0.08, 0.06);
    strand.rotation.z = sx * 0.12;
    g.add(strand);
  }
  return g;
}

function makeArm(side, dressM, skinM) {
  // shoulder pivot group → upper arm (sleeve) → elbow group → forearm (bare) → hand
  const shoulder = new THREE.Group();
  const upper = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.24, 0.075), dressM);
  upper.position.y = -0.12;
  shoulder.add(upper);
  const elbow = new THREE.Group();
  elbow.position.y = -0.24;
  shoulder.add(elbow);
  const fore = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.06), skinM);
  fore.position.y = -0.11;
  elbow.add(fore);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.09, 0.03), skinM);
  hand.position.y = -0.26;
  elbow.add(hand);
  // fingers hint
  for (let f = -1; f <= 1; f++) {
    const finger = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.05, 0.012), skinM);
    finger.position.set(f * 0.018, -0.315, 0.005);
    elbow.add(finger);
  }
  return { shoulder, elbow };
}

function makeLeg(side, skinM) {
  const hip = new THREE.Group();
  const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.3, 0.09), skinM);
  thigh.position.y = -0.15;
  hip.add(thigh);
  const knee = new THREE.Group();
  knee.position.y = -0.3;
  hip.add(knee);
  const shin = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.3, 0.075), skinM);
  shin.position.y = -0.15;
  knee.add(shin);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.16), skinM);
  foot.position.set(0, -0.31, 0.04);
  knee.add(foot);
  return { hip, knee };
}

export function makeHer() {
  const g = new THREE.Group();
  const dressM = lambert(DRESS);
  const dressHiM = lambert(DRESS_HI);
  const skinM = lambert(SKIN);

  // neck
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.08, 6), skinM);
  neck.position.y = 1.52;
  g.add(neck);

  // head
  const head = makeHead();
  head.position.y = 1.63;
  head.rotation.x = 0.09; // slight forward tilt — the 'wrong' posture
  head.rotation.z = 0.06;
  g.add(head);

  // sharp angular shoulders (goth silhouette)
  for (const sx of [-1, 1]) {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.1), dressM);
    pad.position.set(sx * 0.19, 1.47, 0);
    pad.rotation.z = sx * -0.35;
    g.add(pad);
  }

  // bodice: tapered
  const bodice = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.42, 6), dressM);
  bodice.position.y = 1.26;
  g.add(bodice);
  // waist cinch
  const waist = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.125, 0.08, 6), dressHiM);
  waist.position.y = 1.03;
  g.add(waist);

  // tattered skirt: flared cone + notch panels
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.34, 0.78, 7, 1, true), dressM);
  skirt.position.y = 0.62;
  g.add(skirt);
  // tatters: darker jagged strips hanging below hem
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const len = 0.1 + ((i * 37) % 10) / 60;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.07, len, 0.015), dressHiM);
    strip.position.set(Math.sin(a) * 0.31, 0.2 - len / 2, Math.cos(a) * 0.31);
    strip.rotation.y = a;
    strip.rotation.z = Math.sin(i * 3) * 0.1;
    g.add(strip);
  }

  // arms — held slightly too still, hanging forward a touch
  const armL = makeArm(-1, dressM, skinM);
  armL.shoulder.position.set(-0.22, 1.44, 0);
  armL.shoulder.rotation.z = 0.12;
  armL.shoulder.rotation.x = 0.14;
  g.add(armL.shoulder);
  const armR = makeArm(1, dressM, skinM);
  armR.shoulder.position.set(0.22, 1.44, 0);
  armR.shoulder.rotation.z = -0.12;
  armR.shoulder.rotation.x = 0.14;
  g.add(armR.shoulder);

  // legs (visible below tattered hem)
  const legL = makeLeg(-1, skinM);
  legL.hip.position.set(-0.09, 0.62, 0);
  g.add(legL.hip);
  const legR = makeLeg(1, skinM);
  legR.hip.position.set(0.09, 0.62, 0);
  g.add(legR.hip);

  g.userData.parts = { head, armL: armL.shoulder, armR: armR.shoulder, legL: legL.hip, legR: legR.hip, skirt, bodice };
  return g;
}
