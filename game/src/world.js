// World: the night railyard "YARD 9". Three lanes run west to east from the
// Vipers' gate to Site A, cut by a canal that only the two bridges and the
// south ford cross, with a raised loading deck above the yard centre.
// The structure is the classic three-lane shape (lanes, a river, high
// ground); every name, sign and prop is the yard's own — nothing is copied
// from another game. Everything is built from boxes, cylinders and planes —
// no external assets — and every solid object also registers an AABB
// collider the physics, the bots and line-of-sight all share.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// The river runs north-south at x in [-2.5, 2.5]: five metres of water, too
// wide to jump (a running jump carries ~3.5 m). The only crossings are the
// North Bridge, the Central Bridge and the shallow south ford.
export const RIVER = {
  minX: -2.5, maxX: 2.5,
  crossings: [
    { name: 'NORTH BRIDGE', minZ: -14, maxZ: -10 },
    { name: 'CENTRAL BRIDGE', minZ: -2, maxZ: 2 },
    { name: 'FORD', minZ: 10, maxZ: 14 },
  ],
};

// The loading deck: a raised platform (top 2.4 m) reached by a ramp on its
// south side, facing the Central Line. From the deck a rifle looks straight
// down the Central Line and over the low cover below — high ground that is
// genuinely high.
export const DECK = { minX: 4, maxX: 10, minZ: -8, maxZ: -4, h: 2.4, rampMinZ: -1 };

// Ground height under a point: 0 everywhere except the deck ramp and top.
// Bots stay on the ground floor; the player walks the ramp and the deck.
export function groundHeightAt(x, z) {
  if (x < DECK.minX || x > DECK.maxX) return 0;
  if (z >= DECK.minZ && z <= DECK.maxZ) return DECK.h;
  if (z > DECK.maxZ && z <= DECK.rampMinZ) return DECK.h * ((DECK.rampMinZ - z) / (DECK.rampMinZ - DECK.maxZ));
  return 0;
}

export const MAP = {
  minX: -22, maxX: 22, minZ: -16, maxZ: 16,
  site: { x: 17, z: 0, half: 3 },          // bomb site A, centre + half-size
  attackerSpawn: [{ x: -19, z: -11 }, { x: -19, z: 0 }, { x: -19, z: 11 }],
  defenderSpawn: [{ x: 14, z: -6 }, { x: 19, z: -4 }, { x: 14, z: 6 }, { x: 19, z: 4 }],
};

// Waypoint graph the bots walk. Nodes are {x, z, links:[node indices]}.
// Three lanes west to east; the river is crossed only at nodes 11/12/13
// (North Bridge, Central Bridge, Ford). Pocket nodes 6, 7 and 20 are dense
// flank pockets between the lanes, for quiet flanking on foot.
export const WAYPOINTS = [
  { x: -19, z: -11, links: [3, 6] },    // 0 north spawn
  { x: -19, z: 0, links: [4, 6] },      // 1 central spawn (the player)
  { x: -19, z: 11, links: [5, 7] },     // 2 south spawn
  { x: -12, z: -11, links: [0, 8, 6] }, // 3 north approach
  { x: -12, z: 0, links: [1, 9, 6, 7] },// 4 central approach
  { x: -12, z: 12, links: [2, 10, 7] }, // 5 south approach
  { x: -8, z: -5, links: [0, 3, 4] },   // 6 west flank pocket
  { x: -8, z: 6, links: [4, 5, 10] },   // 7 west pocket, ford side
  { x: -3, z: -12, links: [3, 11] },    // 8 north bridge west
  { x: -3, z: 0, links: [4, 12, 7] },   // 9 central bridge west
  { x: -3, z: 12, links: [5, 13, 7] },  // 10 ford west
  { x: 0, z: -12, links: [8, 14] },     // 11 north bridge
  { x: 0, z: 0, links: [9, 15] },       // 12 central bridge
  { x: 0, z: 12, links: [10, 16] },     // 13 ford
  { x: 3, z: -12, links: [11, 17] },    // 14 north bridge east
  { x: 3, z: 0, links: [12, 18] },      // 15 central bridge east
  { x: 3, z: 12, links: [13, 19, 20] }, // 16 ford east
  { x: 8, z: -11, links: [14, 21] },    // 17 north approach east
  { x: 8, z: 0, links: [15, 22, 20] },  // 18 central approach east
  { x: 8, z: 12, links: [16, 23, 20] }, // 19 south approach east
  { x: 8, z: 6, links: [16, 18, 19, 22, 23] }, // 20 east flank pocket
  { x: 13, z: -8, links: [17, 24] },    // 21 site approach north
  { x: 13, z: 0, links: [18, 24, 25, 20] }, // 22 site approach central
  { x: 13, z: 8, links: [19, 25, 20] }, // 23 site approach south
  { x: 15, z: -2, links: [21, 22, 26] },// 24 site north-west
  { x: 15, z: 2, links: [22, 23, 26] }, // 25 site south-west
  { x: 18, z: 0, links: [24, 25] },     // 26 site east, behind the plant spot
];

// Breadth-first route through the waypoint graph, as a list of node indices
// from the node nearest (fromX, fromZ) to the node nearest (toX, toZ).
// Bots use this when they must reach a far point (bomb carrier, rush order)
// instead of walking straight — a straight line would beach them on the
// canal wall. No allocations in the search itself beyond the returned list.
export function findRoute(fromX, fromZ, toX, toZ) {
  let from = 0;
  let to = 0;
  let bestFrom = Infinity;
  let bestTo = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i += 1) {
    const n = WAYPOINTS[i];
    const dFrom = (n.x - fromX) * (n.x - fromX) + (n.z - fromZ) * (n.z - fromZ);
    const dTo = (n.x - toX) * (n.x - toX) + (n.z - toZ) * (n.z - toZ);
    if (dFrom < bestFrom) { bestFrom = dFrom; from = i; }
    if (dTo < bestTo) { bestTo = dTo; to = i; }
  }
  if (from === to) return [to];
  const prev = new Int16Array(WAYPOINTS.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head];
    head += 1;
    if (cur === to) break;
    for (const next of WAYPOINTS[cur].links) {
      if (prev[next] === -1) {
        prev[next] = cur;
        queue.push(next);
      }
    }
  }
  if (prev[to] === -1) return [to];
  const path = [];
  let cur = to;
  while (cur !== from) {
    path.push(cur);
    cur = prev[cur];
  }
  path.push(from);
  path.reverse();
  return path;
}

// Solid boxes: [minX, minZ, maxX, maxZ, height, colour, yOffset].
// A height of 0 means "visual only, no collider". Cover is laid along the
// three lanes, at the bridge mouths, in the flank pockets and around Site A —
// and never on a waypoint node, so a bot can always reach its node.
const SOLIDS = [
  // West boxcars guard the two outer lanes, hard against the map edges so
  // the spawn-to-lane paths stay open.
  [-16, -15.5, -13, -13.5, 3.2, PALETTE.rust, 0],
  [-16, 13.5, -13, 15.5, 3.2, PALETTE.teal, 0],
  // West-centre stack hill: two containers high, blocks the sightline
  // between the north and central lanes.
  [-6, -7, -3, -4, 2.6, PALETTE.containerA, 0],
  [-6, -7, -3, -4, 5.2, PALETTE.containerB, 2.6],
  // Crates at the west mouths of the north bridge and the ford.
  [-6.5, -10.5, -4.5, -9, 1.2, PALETTE.crate, 0],
  [-6.5, 13.5, -4.5, 15, 1.2, PALETTE.crate, 0],
  // Low wall west-centre: crouch cover between the lanes.
  [-5.5, -4, -4, -2.5, 1.1, PALETTE.wall, 0],
  // West flank pocket: two crate clusters to go quiet in. They sit clear of
  // the pocket diagonals (checked by the playtest geometry validation).
  [-13, -6, -11.5, -4.5, 1.2, PALETTE.crate, 0],
  [-12, -13.5, -10.5, -12, 1.2, PALETTE.crate, 0],
  // East stack hill on the north approach.
  [10, -13.5, 13, -10.5, 2.6, PALETTE.containerB, 0],
  [10, -13.5, 13, -10.5, 5.2, PALETTE.containerA, 2.6],
  // East container on the south approach.
  [9, 13.5, 12, 15.5, 2.6, PALETTE.containerA, 0],
  // Crates on the two site approaches.
  [11, -13.5, 13, -11.5, 1.2, PALETTE.crate, 0],
  [11, 11.5, 13, 13.5, 1.2, PALETTE.crate, 0],
  // Container behind the site, east edge — the plant cover.
  [19, -2, 20.5, 2, 2.6, PALETTE.containerA, 0],
  // East flank pocket: container + crates.
  [10.5, 4.5, 12, 6, 2.6, PALETTE.containerB, 0],
  [5, 5.5, 6.5, 7, 1.2, PALETTE.crate, 0],
];

const LAMPS = [
  [-4, -13], [4, -13], [-4, 13], [4, 13], [18, 0],
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

function waterTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#14303e';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 260; i += 1) {
    const shade = 40 + Math.floor(Math.random() * 40);
    ctx.strokeStyle = `rgba(${shade},${shade + 40},${shade + 60},0.5)`;
    ctx.lineWidth = 1;
    const x = Math.floor(Math.random() * 128);
    const y = Math.floor(Math.random() * 128);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 6 + Math.random() * 10, y);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 8);
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
  const colliders = [];   // {minX,maxX,minZ,maxZ,h,los?} — physics + line of sight
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

  // The canal: animated water over the whole strip, blocked to movement
  // everywhere except the two bridges and the ford. The water is 1 m deep
  // in the collider sense — it stops feet, never sight.
  const waterTex = waterTexture();
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(RIVER.maxX - RIVER.minX, MAP.maxZ - MAP.minZ),
    new THREE.MeshLambertMaterial({ map: waterTex, transparent: true, opacity: 0.9 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set((RIVER.minX + RIVER.maxX) / 2, 0.02, 0);
  water.receiveShadow = true;
  scene.add(water);
  // Blocked stretches between the crossings.
  let cursor = MAP.minZ;
  for (const cross of [...RIVER.crossings].sort((a, b) => a.minZ - b.minZ)) {
    if (cross.minZ > cursor) {
      colliders.push({ minX: RIVER.minX, maxX: RIVER.maxX, minZ: cursor, maxZ: cross.minZ, h: 1.0 });
    }
    cursor = Math.max(cursor, cross.maxZ);
  }
  if (cursor < MAP.maxZ) {
    colliders.push({ minX: RIVER.minX, maxX: RIVER.maxX, minZ: cursor, maxZ: MAP.maxZ, h: 1.0 });
  }

  // Bridges: plank decks over the canal (flush with the ground, so crossing
  // is flat) with low rails; the ford gets stepping stones instead.
  const deckMat = new THREE.MeshLambertMaterial({ color: 0x4a3a26 });
  const railMat = new THREE.MeshLambertMaterial({ color: 0x2e343c });
  const stoneMat = new THREE.MeshLambertMaterial({ color: 0x5a6068 });
  for (const cross of RIVER.crossings) {
    const cz = (cross.minZ + cross.maxZ) / 2;
    const cd = cross.maxZ - cross.minZ;
    if (cross.name === 'FORD') {
      for (let i = 0; i < 4; i += 1) {
        const stone = new THREE.Mesh(boxGeo, stoneMat);
        stone.scale.set(1.1, 0.12, 0.9);
        stone.position.set(-1.8 + i * 1.2, 0.06, cz + (i % 2 === 0 ? -0.5 : 0.5));
        stone.receiveShadow = true;
        scene.add(stone);
      }
    } else {
      const deck = new THREE.Mesh(boxGeo, deckMat);
      deck.scale.set(RIVER.maxX - RIVER.minX + 0.6, 0.12, cd);
      deck.position.set(0, 0.06, cz);
      deck.castShadow = true;
      deck.receiveShadow = true;
      scene.add(deck);
      for (const s of [-1, 1]) {
        const rail = new THREE.Mesh(boxGeo, railMat);
        rail.scale.set(RIVER.maxX - RIVER.minX + 0.6, 0.5, 0.12);
        rail.position.set(0, 0.35, cz + s * (cd / 2 - 0.06));
        scene.add(rail);
        shootables.push(rail);
      }
    }
    // Crossing sign, standing at the west mouth, facing the attackers.
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 1.3),
      new THREE.MeshBasicMaterial({ map: signTexture(cross.name, cross.name === 'FORD' ? 'SHALLOW — WALK ACROSS' : 'ONLY WAY OVER THE CANAL') }),
    );
    sign.position.set(-4.2, 1.6, cz);
    sign.rotation.y = Math.PI / 2;
    scene.add(sign);
  }

  // Loading deck: a raised platform (top 2.4 m) with a ramp on its south
  // side, facing the Central Line. The platform is a solid for anything on
  // the ground floor, but it never blocks 2D line of sight — a soldier
  // standing on it is exposed, and from it you see over the low cover below.
  const deckMesh = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: PALETTE.containerB }));
  deckMesh.scale.set(DECK.maxX - DECK.minX, DECK.h, DECK.maxZ - DECK.minZ);
  deckMesh.position.set((DECK.minX + DECK.maxX) / 2, DECK.h / 2, (DECK.minZ + DECK.maxZ) / 2);
  deckMesh.castShadow = true;
  deckMesh.receiveShadow = true;
  scene.add(deckMesh);
  shootables.push(deckMesh);
  colliders.push({ minX: DECK.minX, maxX: DECK.maxX, minZ: DECK.minZ, maxZ: DECK.maxZ, h: DECK.h, los: false });
  // The ramp: a sloped slab from the ground (south) up to the deck top
  // (north). It is 3 m deep for 2.4 m of rise, so it is a real walkable slope.
  const rampLen = Math.hypot(DECK.rampMinZ - DECK.maxZ, DECK.h);
  const ramp = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x3a3f46 }));
  ramp.scale.set(DECK.maxX - DECK.minX, 0.15, rampLen);
  ramp.position.set((DECK.minX + DECK.maxX) / 2, DECK.h / 2, (DECK.maxZ + DECK.rampMinZ) / 2);
  ramp.rotation.x = Math.atan2(DECK.h, DECK.rampMinZ - DECK.maxZ);
  ramp.castShadow = true;
  ramp.receiveShadow = true;
  scene.add(ramp);
  shootables.push(ramp);
  // Deck edge trim + a "DECK 2" sign on its east face.
  const trimMat = new THREE.MeshLambertMaterial({ color: PALETTE.site });
  const trim = new THREE.Mesh(boxGeo, trimMat);
  trim.scale.set(0.12, 0.18, DECK.maxZ - DECK.minZ);
  trim.position.set(DECK.maxX + 0.01, DECK.h - 0.09, (DECK.minZ + DECK.maxZ) / 2);
  scene.add(trim);
  const deckSign = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 1.3),
    new THREE.MeshBasicMaterial({ map: signTexture('DECK 2', 'HIGH GROUND — DMR LANE') }),
  );
  deckSign.position.set(DECK.maxX + 0.05, 1.6, (DECK.minZ + DECK.maxZ) / 2);
  deckSign.rotation.y = Math.PI / 2;
  scene.add(deckSign);

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

  // Bomb site: amber pad outline + sign board on the east wall.
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
  sign.position.set(21.9, 2.2, site.z);
  sign.rotation.y = -Math.PI / 2;
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
  for (const [x, z] of [[-14, -6], [14, -10], [-14, 6], [14, 10], [-5, 5], [6, -3]]) {
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

  // Visual-only step: scroll the canal water. Called from the render loop,
  // never from the fixed-step simulation.
  function step(dt) {
    waterTex.offset.x += dt * 0.03;
    waterTex.offset.y += dt * 0.011;
  }

  return { colliders, shootables, site: MAP.site, step };
}

// 2D line of sight in the XZ plane: true when no tall collider stands between
// the two points. Low cover (crates, low wall) does not block sight, and
// neither does the loading deck — a soldier on it is exposed by design.
export function losClear(colliders, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  for (const c of colliders) {
    if (c.h < 1.25) continue;
    if (c.los === false) continue;
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
// feetY is the circle's height above the ground floor: a collider whose top
// is at or below the feet (plus a 0.55 m step-up allowance, so a ramp can
// carry you onto the deck) does not push. That is what lets the player walk
// up the ramp and stand on the loading deck while the same box still stops
// everyone on the ground floor.
export function resolveCircle(colliders, pos, radius, feetY = 0) {
  let pushed = false;
  for (const c of colliders) {
    if (feetY + 0.55 >= c.h) continue;
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
