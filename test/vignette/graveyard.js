// The graveyard she climbs out of: real geometry, layered silhouettes, ground fog.
import * as THREE from 'three/webgpu';

const lambert = (c) => new THREE.MeshLambertNodeMaterial({ color: c });

function gravestone(w, h, d, style) {
  const g = new THREE.Group();
  const stoneM = lambert(0x4e5150);
  const darkM = lambert(0x3a3d3c);
  if (style === 'cross') {
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.09, h, d), stoneM);
    v.position.y = h / 2;
    g.add(v);
    const hbar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.09, d), stoneM);
    hbar.position.y = h * 0.68;
    g.add(hbar);
  } else if (style === 'obelisk') {
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, h * 0.8, d * 0.6), stoneM);
    shaft.position.y = h * 0.4;
    g.add(shaft);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(w * 0.42, h * 0.2, 4), darkM);
    tip.position.y = h * 0.9;
    g.add(tip);
    const base = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.12, d), darkM);
    base.position.y = h * 0.06;
    g.add(base);
  } else {
    // slab with rounded top
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stoneM);
    slab.position.y = h / 2;
    g.add(slab);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, d, 8, 1, false, 0, Math.PI), stoneM);
    top.rotation.z = Math.PI / 2;
    top.rotation.y = Math.PI / 2;
    top.position.y = h;
    g.add(top);
    // inscription lines
    for (let i = 0; i < 3; i++) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, 0.015, 0.005), darkM);
      line.position.set(0, h * (0.62 - i * 0.14), d / 2 + 0.003);
      g.add(line);
    }
  }
  // base
  const base = new THREE.Mesh(new THREE.BoxGeometry(w * 1.25, 0.08, d * 1.4), darkM);
  base.position.y = 0.04;
  g.add(base);
  return g;
}

function deadTree() {
  const g = new THREE.Group();
  const barkM = lambert(0x211c17);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.24, 3.2, 6), barkM);
  trunk.position.y = 1.6;
  trunk.rotation.z = 0.08;
  g.add(trunk);
  // angular bare branches
  const branches = [
    [0.6, 2.9, 0, 0.9, 0.5], [-0.5, 3.2, 0.1, -0.8, 0.7], [0.2, 3.5, -0.2, 0.3, 1.0],
    [-0.3, 2.6, 0.15, -1.1, 0.3], [0.8, 3.4, 0.1, 1.2, 0.8],
  ];
  for (const [x, y, z, rz, ry] of branches) {
    const len = 1.1 + Math.abs(x) * 0.5;
    const br = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, len, 5), barkM);
    br.position.set(x, y, z);
    br.rotation.z = rz;
    br.rotation.y = ry;
    g.add(br);
    // twig
    const twig = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.025, len * 0.5, 4), barkM);
    twig.position.set(x + Math.sin(rz) * -len * 0.4, y + Math.cos(rz) * len * 0.4, z);
    twig.rotation.z = rz * 1.6;
    g.add(twig);
  }
  return g;
}

function ironFence(len) {
  const g = new THREE.Group();
  const ironM = lambert(0x1c1e20);
  // rails
  for (const y of [0.35, 0.85]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.04, 0.04), ironM);
    rail.position.y = y;
    g.add(rail);
  }
  // pickets with spear tips
  const n = Math.floor(len / 0.28);
  for (let i = 0; i <= n; i++) {
    const x = -len / 2 + i * 0.28;
    const picket = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.0, 4), ironM);
    picket.position.set(x, 0.5, 0);
    g.add(picket);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 4), ironM);
    tip.position.set(x, 1.05, 0);
    g.add(tip);
  }
  return g;
}

export function makeGraveyard() {
  const g = new THREE.Group();

  // ground: slight unevenness via displaced plane
  const groundGeo = new THREE.PlaneGeometry(40, 40, 20, 20);
  const gp = groundGeo.attributes.position;
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), y = gp.getY(i);
    gp.setZ(i, Math.sin(x * 0.5) * Math.cos(y * 0.4) * 0.15 + Math.sin(x * 1.7 + y * 2.1) * 0.05);
  }
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeo, lambert(0x232a22));
  ground.rotation.x = -Math.PI / 2;
  g.add(ground);

  // her open grave: dark pit + coffin + scattered dirt
  const pit = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 2.3), lambert(0x0a0806));
  pit.position.set(0, -0.3, 0);
  g.add(pit);
  const coffin = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.35, 1.9), lambert(0x2e2118));
  coffin.position.set(0, -0.15, 0);
  g.add(coffin);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 1.9), lambert(0x3a2b1e));
  lid.position.set(0.7, 0.03, 0.3);
  lid.rotation.z = 0.5;
  lid.rotation.y = 0.3;
  g.add(lid);
  // dirt mounds
  for (const [x, z, s] of [[1.2, 0.4, 0.9], [-0.9, -0.7, 0.7], [0.9, -1.1, 0.6]]) {
    const mound = new THREE.Mesh(new THREE.SphereGeometry(s * 0.5, 6, 4), lambert(0x2c2318));
    mound.position.set(x, 0.05, z);
    mound.scale.y = 0.35;
    g.add(mound);
  }

  // gravestones: layered rows, varied styles, some tilted
  const styles = ['slab', 'cross', 'obelisk', 'slab', 'cross'];
  const positions = [
    [-3.2, -2.5, 0.15], [-1.5, -3.0, -0.1], [2.2, -2.8, 0.08], [3.8, -2.2, -0.2],
    [-4.0, -4.5, 0.1], [-2.0, -5.0, 0.25], [0.5, -4.8, -0.15], [3.0, -4.4, 0.05],
    [-3.5, -6.5, -0.1], [-0.8, -6.8, 0.2], [1.8, -6.4, -0.05], [4.2, -6.0, 0.12],
    [-5.0, -8.0, 0.0], [0.0, -8.5, -0.2], [5.0, -7.6, 0.1],
  ];
  positions.forEach(([x, z, tilt], i) => {
    const style = styles[i % styles.length];
    const h = style === 'obelisk' ? 1.6 : 0.7 + (i % 3) * 0.2;
    const st = gravestone(0.5 + (i % 2) * 0.15, h, 0.12, style);
    st.position.set(x, 0, z);
    st.rotation.z = tilt;
    st.rotation.y = Math.sin(i * 7) * 0.2;
    g.add(st);
  });

  // dead tree behind
  const tree = deadTree();
  tree.position.set(-4.5, 0, -7);
  g.add(tree);

  // iron fence run along the back
  const fence = ironFence(14);
  fence.position.set(0, 0, -9.5);
  g.add(fence);

  // ground fog: layered translucent planes (cheap era trick)
  const fogM = new THREE.MeshBasicNodeMaterial({
    color: 0x3a4038, transparent: true, opacity: 0.16, depthWrite: false,
  });
  for (const [y, s, o] of [[0.25, 30, 0.12], [0.55, 26, 0.09], [0.9, 20, 0.06]]) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(s, s), fogM.clone());
    f.material.opacity = o;
    f.rotation.x = -Math.PI / 2;
    f.position.y = y;
    g.add(f);
  }

  return g;
}
