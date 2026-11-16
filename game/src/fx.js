// FX: tracers, muzzle flash, impact sparks and the bomb explosion.
// Everything is pooled: a fixed set of line tracers and a fixed set of spark
// points, reused instead of allocating every shot.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACER_COUNT = 10;
const SPARK_COUNT = 8;

export function createFx(scene, camera) {
  const tracers = [];
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: PALETTE.tracer, transparent: true, opacity: 0,
    }));
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  const sparks = [];
  for (let i = 0; i < SPARK_COUNT; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xffcf7a, size: 0.14, transparent: true, opacity: 0,
    }));
    points.frustumCulled = false;
    scene.add(points);
    sparks.push({ points, life: 0, vel: new Float32Array(18) });
  }
  // Muzzle flash: a small plane on the camera + a brief point light.
  const flashMat = new THREE.MeshBasicMaterial({
    color: PALETTE.muzzle, transparent: true, opacity: 0, depthTest: false,
  });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), flashMat);
  flash.position.set(0.22, -0.18, -0.55);
  camera.add(flash);
  const flashLight = new THREE.PointLight(0xffc46b, 0, 9, 1.6);
  flashLight.position.set(0.2, -0.1, -0.4);
  camera.add(flashLight);
  let flashLife = 0;
  // Explosion: an expanding shell + light, reused for the bomb.
  const boomMat = new THREE.MeshBasicMaterial({
    color: 0xff8c2e, transparent: true, opacity: 0, depthWrite: false,
  });
  const boom = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), boomMat);
  scene.add(boom);
  const boomLight = new THREE.PointLight(0xff7a2e, 0, 30, 1.4);
  scene.add(boomLight);
  let boomLife = 0;
  let tracerIndex = 0;
  let sparkIndex = 0;

  return {
    fireTracer(from, to) {
      const t = tracers[tracerIndex];
      tracerIndex = (tracerIndex + 1) % TRACER_COUNT;
      const attr = t.line.geometry.getAttribute('position');
      attr.setXYZ(0, from.x, from.y, from.z);
      attr.setXYZ(1, to.x, to.y, to.z);
      attr.needsUpdate = true;
      t.line.material.opacity = 0.9;
      t.life = 0.07;
    },
    impact(point, normal) {
      const s = sparks[sparkIndex];
      sparkIndex = (sparkIndex + 1) % SPARK_COUNT;
      const attr = s.points.geometry.getAttribute('position');
      for (let i = 0; i < 6; i += 1) {
        attr.setXYZ(i, point.x, point.y, point.z);
        s.vel[i * 3] = normal.x * 2 + (Math.random() - 0.5) * 4;
        s.vel[i * 3 + 1] = Math.abs(normal.y) * 2 + Math.random() * 3;
        s.vel[i * 3 + 2] = normal.z * 2 + (Math.random() - 0.5) * 4;
      }
      attr.needsUpdate = true;
      s.points.material.opacity = 1;
      s.life = 0.35;
    },
    muzzle() {
      flashLife = 0.05;
      flashMat.opacity = 0.95;
      flashLight.intensity = 14;
    },
    explosion(point) {
      boom.position.copy(point);
      boomLife = 0.7;
      boomMat.opacity = 0.85;
      boomLight.position.copy(point);
      boomLight.position.y += 1;
      boomLight.intensity = 60;
    },
    step(dt) {
      for (const t of tracers) {
        if (t.life > 0) {
          t.life -= dt;
          t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.9;
        }
      }
      for (const s of sparks) {
        if (s.life > 0) {
          s.life -= dt;
          const attr = s.points.geometry.getAttribute('position');
          for (let i = 0; i < 6; i += 1) {
            attr.setXYZ(i,
              attr.getX(i) + s.vel[i * 3] * dt,
              Math.max(0, attr.getY(i) + s.vel[i * 3 + 1] * dt),
              attr.getZ(i) + s.vel[i * 3 + 2] * dt);
            s.vel[i * 3 + 1] -= 9 * dt;
          }
          attr.needsUpdate = true;
          s.points.material.opacity = Math.max(0, s.life / 0.35);
        }
      }
      if (flashLife > 0) {
        flashLife -= dt;
        flashMat.opacity = Math.max(0, flashLife / 0.05) * 0.95;
        flashLight.intensity = Math.max(0, flashLife / 0.05) * 14;
      }
      if (boomLife > 0) {
        boomLife -= dt;
        const f = Math.max(0, boomLife / 0.7);
        const r = (1 - f) * 9 + 0.5;
        boom.scale.setScalar(r);
        boomMat.opacity = f * 0.85;
        boomLight.intensity = f * 60;
      }
    },
  };
}
