// World: the night railyard "YARD 9". One bomb site, three lanes, cover worth
// playing. Everything here is built from boxes, cylinders and planes — no
// external assets — and every solid object also registers an AABB collider
// the physics, the bots and line-of-sight all share.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const MAP = {
  minX: -22, maxX: 22, minZ: -16, maxZ: 16,
  site: { x: 0, z: -11, half: 3 },          // bomb site A, centre + half-size
  attackerSpawn: [{ x: -3, z: 13 }, { x: 0, z: 13.5 }, { x: 3, z: 13 }],
  defenderSpawn: [{ x: -9, z: -13 }, { x: 0, z: -14 }, { x: 9, z: -13 }, { x: 15, z: -10 }],
};

// Waypoint graph the bots walk. Nodes are {x, z, links:[node indices]}.
export const WAYPOINTS = [
  { x: -3, z: 13, links: [1, 3] },    // 0 attacker spawn west
  { x: 0, z: 13.5, links: [0, 2, 4] },// 1 attacker spawn mid
  { x: 3, z: 13, links: [1, 5] },     // 2 attacker spawn east
  { x: -12, z: 6, links: [0, 6] },    // 3 west lane
  { x: 0, z: 6, links: [1, 7] },      // 4 mid approach
  { x: 12, z: 6, links: [2, 8] },     // 5 east lane
  { x: -12, z: 0, links: [3, 9] },    // 6 west mid
  { x: 0, z: 0, links: [4, 10] },     // 7 yard centre
  { x: 12, z: 0, links: [5, 11] },    // 8 east mid
  { x: -6, z: -7, links: [6, 12] },   // 9 site approach west
  { x: 0, z: -7, links: [7, 12, 13] },// 10 site approach mid
  { x: 6, z: -7, links: [8, 13] },    // 11 site approach east
  { x: -2, z: -11, links: [9, 10, 14] }, // 12 site west
  { x: 2, z: -11, links: [10, 11, 14] }, // 13 site east
  { x: 0, z: -14, links: [12, 13] },  // 14 site back
  { x: -15, z: -4, links: [6, 9] },   // 15 west hold
  { x: 15, z: -4, links: [8, 11] },   // 16 east hold
];

// Solid boxes: [minX, minZ, maxX, maxZ, height, colour, yOffset].
// A height of 0 means "visual only, no collider".
const SOLIDS = [
  [-16, -14, -10, -8, 3.2, PALETTE.rust, 0],       // west boxcar
  [10, -14, 16, -8, 3.2, PALETTE.teal, 0],        // east boxcar
  [-14, -2, -8, 2, 2.6, PALETTE.containerA, 0],   // west container
  [-14, -2, -11, 2, 5.2, PALETTE.containerB, 2.6],// stacked container
  [8, -2, 14, 2, 2.6, PALETTE.containerB, 0],     // east container
  [8, -2, 11, 2, 5.2, PALETTE.containerA, 2.6],   // stacked container
  [-2, 2, 2, 4, 1.2, PALETTE.crate, 0],           // centre crates
  [4, -4, 6, -2, 1.2, PALETTE.crate, 0],          // east crates
  [-6, -6, -4, -4, 1.2, PALETTE.crate, 0],        // west crates
  [-4, -6, 4, -5.4, 1.1, PALETTE.wall, 0],        // low mid wall (crouch cover)
  [-19, -14, -18, 2, 1.4, PALETTE.crate, 0],      // west wall crates
  [18, 2, 19, 14, 1.4, PALETTE.crate, 0],         // east wall crates
];

const LAMPS = [
  [-18, -12], [18, -12], [-18, 12], [18, 12], [0, -14.5],
];

function groundTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#23262b';
  ctx.fillRect(0, 0, 256, 256);
  // asphalt speckle
  for (let i = 0; i < 900; i += 1) {
    const shade = 30 + Math.floor(Math.random() * 26);
    ctx.fillStyle = `rgb(${shade},${shade + 2},${shade + 5})`;
    ctx.fillRect(Math.floor(Math.random() * 256), Math.floor(Math.random() * 256), 2, 2);
  }
  // painted yard lines
  ctx.strokeStyle = 'rgba(120,128,138,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 128);
  ctx.lineTo(256, 128);
  ctx.moveTo(128, 0);
  ctx.lineTo(128, 256);
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(11, 8);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function signTexture(text, sub) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#14161a';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = '#ffb020';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 244, 116);
  ctx.fillStyle = '#ffb020';
  ctx.font = 'bold 64px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, 128, 72);
  ctx.fillStyle = '#e9e6df';
  ctx.font = '20px system-ui, sans-serif';
  ctx.fillText(sub, 128, 106);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createWorld(scene) {
  const colliders = [];   // {minX,maxX,minZ,maxZ,h} — physics + line of sight
  const shootables = [];  // meshes bullets can hit (and stop at)
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);

  // Ground.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP.maxX - MAP.minX + 8, MAP.maxZ - MAP.minZ + 8),
    new THREE.MeshLambertMaterial({ map: groundTexture() }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Perimeter walls.
  const wallMat = new THREE.MeshLambertMaterial({ color: PALETTE.wall });
  const wallDefs = [
    [0, -16.6, 46, 3, 1.2], [0, 16.6, 46, 3, 1.2],
    [-22.6, 0, 1.2, 3, 34], [22.6, 0, 1.2, 3, 34],
  ];
  for (const [x, z, w, h, d] of wallDefs) {
    const wall = new THREE.Mesh(boxGeo, wallMat);
    wall.scale.set(w, h, d);
    wall.position.set(x, h / 2, z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    scene.add(wall);
    shootables.push(wall);
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h });
  }

  // Solid boxes (containers, boxcars, crates, low wall).
  for (const [minX, minZ, maxX, maxZ, h, colour, y0] of SOLIDS) {
    const mat = new THREE.MeshLambertMaterial({ color: colour });
    const mesh = new THREE.Mesh(boxGeo, mat);
    const w = maxX - minX;
    const d = maxZ - minZ;
    mesh.scale.set(w, h, d);
    mesh.position.set((minX + maxX) / 2, y0 + h / 2, (minZ + maxZ) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    shootables.push(mesh);
    if (y0 === 0) colliders.push({ minX, maxX, minZ, maxZ, h });
    // Container ribbing: two thin darker strips on the long face.
    if (h >= 2.6) {
      const ribMat = new THREE.MeshLambertMaterial({ color: 0x000000 });
      for (const s of [-0.3, 0.3]) {
        const rib = new THREE.Mesh(boxGeo, ribMat);
        rib.scale.set(w * 0.96, h * 0.06, 0.06);
        rib.position.set((minX + maxX) / 2, y0 + h * (0.5 + s), maxZ + 0.01);
        scene.add(rib);
      }
    }
  }

  // Bomb site: amber pad outline + sign board.
  const site = MAP.site;
  const padMat = new THREE.MeshBasicMaterial({ color: PALETTE.site });
  for (const [x, z, w, d] of [
    [site.x, site.z - site.half, site.half * 2 + 0.4, 0.3],
    [site.x, site.z + site.half, site.half * 2 + 0.4, 0.3],
    [site.x - site.half, site.z, 0.3, site.half * 2],
    [site.x + site.half, site.z, 0.3, site.half * 2],
  ]) {
    const strip = new THREE.Mesh(boxGeo, padMat);
    strip.scale.set(w, 0.06, d);
    strip.position.set(x, 0.03, z);
    scene.add(strip);
  }
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 2),
    new THREE.MeshBasicMaterial({ map: signTexture('SITE A', 'PLANT THE SPIKE HERE') }),
  );
  sign.position.set(site.x, 2.2, -15.6);
  scene.add(sign);

  // Lamp posts: pole + glowing head + a real light (four of them, the fifth is
  // emissive only so the frame stays cheap).
  const poleMat = new THREE.MeshLambertMaterial({ color: PALETTE.lampPole });
  const headMat = new THREE.MeshBasicMaterial({ color: PALETTE.lamp });
  LAMPS.forEach(([x, z], i) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5, 8), poleMat);
    pole.position.set(x, 2.5, z);
    scene.add(pole);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), headMat);
    head.position.set(x, 5.05, z);
    scene.add(head);
    if (i < 4) {
      const light = new THREE.PointLight(PALETTE.lamp, 26, 22, 1.8);
      light.position.set(x, 4.8, z);
      scene.add(light);
    }
  });

  // Barrels (visual cover, small colliders).
  const barrelMat = new THREE.MeshLambertMaterial({ color: 0x5d3a24 });
  for (const [x, z] of [[-8, 9], [7, 9], [-16, -6], [16, -6], [-2, -3], [3, 3]]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.1, 10), barrelMat);
    barrel.position.set(x, 0.55, z);
    barrel.castShadow = true;
    scene.add(barrel);
    shootables.push(barrel);
    colliders.push({ minX: x - 0.45, maxX: x + 0.45, minZ: z - 0.45, maxZ: z + 0.45, h: 1.1 });
  }

  // Moon + stars.
  const moon = new THREE.Mesh(
    new THREE.CircleGeometry(2.2, 24),
    new THREE.MeshBasicMaterial({ color: PALETTE.moon, fog: false }),
  );
  moon.position.set(-30, 34, -60);
  moon.lookAt(0, 0, 0);
  scene.add(moon);
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(420 * 3);
  for (let i = 0; i < 420; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const e = Math.random() * Math.PI * 0.42 + 0.08;
    const r = 90;
    starPos[i * 3] = Math.cos(a) * Math.cos(e) * r;
    starPos[i * 3 + 1] = Math.sin(e) * r;
    starPos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 0.35, fog: false })));

  return { colliders, shootables, site: MAP.site };
}

// 2D line of sight in the XZ plane: true when no tall collider stands between
// the two points. Low cover (crates, low wall) does not block sight.
export function losClear(colliders, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  for (const c of colliders) {
    if (c.h < 1.25) continue;
    // Slab test for the segment against the AABB.
    let t0 = 0;
    let t1 = 1;
    let blocked = false;
    for (const [p, d, mn, mx] of [[ax, dx, c.minX, c.maxX], [az, dz, c.minZ, c.maxZ]]) {
      if (Math.abs(d) < 1e-9) {
        if (p < mn || p > mx) { blocked = true; break; }
      } else {
        let u0 = (mn - p) / d;
        let u1 = (mx - p) / d;
        if (u0 > u1) { const t = u0; u0 = u1; u1 = t; }
        t0 = Math.max(t0, u0);
        t1 = Math.min(t1, u1);
        if (t0 > t1) { blocked = true; break; }
      }
    }
    if (!blocked) return false;
  }
  return true;
}

// Circle (XZ) vs AABB colliders: push the circle out. Returns true when a push happened.
export function resolveCircle(colliders, pos, radius) {
  let pushed = false;
  for (const c of colliders) {
    const nx = Math.max(c.minX, Math.min(pos.x, c.maxX));
    const nz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
    const dx = pos.x - nx;
    const dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    pushed = true;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      pos.x = nx + (dx / d) * radius;
      pos.z = nz + (dz / d) * radius;
    } else {
      // Centre inside the box: push out along the smallest penetration axis.
      const left = pos.x - c.minX;
      const right = c.maxX - pos.x;
      const back = pos.z - c.minZ;
      const front = c.maxZ - pos.z;
      const m = Math.min(left, right, back, front);
      if (m === left) pos.x = c.minX - radius;
      else if (m === right) pos.x = c.maxX + radius;
      else if (m === back) pos.z = c.minZ - radius;
      else pos.z = c.maxZ + radius;
    }
  }
  return pushed;
}
