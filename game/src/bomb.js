// Bomb (the spike): one site, one state machine. States:
//   carried — the player (or a bot) holds it
//   dropped — on the ground where its carrier died
//   planting — held still inside the site, progress 0..3.5s
//   planted — fuse running (35s); defenders must defuse (5s)
//   defused / detonated — terminal, the round ends
// The bomb is also a visible object: a small case with a blinking light.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const PLANT_TIME = 3.5;
export const FUSE_TIME = 35;
export const DEFUSE_TIME = 5;

export function createBomb(scene, site) {
  const group = new THREE.Group();
  const caseMat = new THREE.MeshLambertMaterial({ color: 0x1c1f24 });
  const caseMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.34), caseMat);
  caseMesh.position.y = 0.11;
  group.add(caseMesh);
  const light = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 8, 6),
    new THREE.MeshBasicMaterial({ color: PALETTE.danger }),
  );
  light.position.set(0.18, 0.26, 0);
  group.add(light);
  group.visible = false;
  scene.add(group);
  return {
    group,
    light,
    state: 'carried',
    carrier: 'player',
    pos: { x: site.x, z: site.z },
    plantProgress: 0,
    defuseProgress: 0,
    fuse: 0,
    blink: 0,
  };
}

export function resetBomb(bomb, site) {
  bomb.state = 'carried';
  bomb.carrier = 'player';
  bomb.pos.x = site.x;
  bomb.pos.z = site.z;
  bomb.plantProgress = 0;
  bomb.defuseProgress = 0;
  bomb.fuse = 0;
  bomb.group.visible = false;
}

// Step the fuse / blink. Planting and defusing progress is driven by the
// caller (player hold, or bot events); this only ticks the planted fuse.
export function stepBomb(bomb, dt, events) {
  if (bomb.state === 'planted') {
    bomb.fuse -= dt;
    bomb.blink += dt;
    const on = Math.floor(bomb.blink * 2.4) % 2 === 0;
    bomb.light.material.color.setHex(on ? PALETTE.danger : 0x330000);
    if (bomb.fuse <= 0) {
      bomb.state = 'detonated';
      events.push({ type: 'bombDetonated' });
    }
  }
}

export function inSite(site, x, z) {
  return Math.abs(x - site.x) <= site.half && Math.abs(z - site.z) <= site.half;
}
