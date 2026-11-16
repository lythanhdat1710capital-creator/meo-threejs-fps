// Player: first-person movement with acceleration, friction, crouching,
// jumping and collision against the world's AABBs. Stopping to aim pays:
// spread grows with speed, crouching shrinks it.
import { resolveCircle } from './world.js';

const EYE_STAND = 1.62;
const EYE_CROUCH = 1.05;
const RADIUS = 0.35;
const RUN_SPEED = 4.6;     // default: fast but LOUD — enemies hear it
const WALK_SPEED = 2.6;    // Shift: slow and SILENT, for flanking
const CROUCH_SPEED = 2.3;  // Ctrl: quietest and most accurate stance
const ADS_SPEED = 2.8;     // aiming down sights slows you down
const ACCEL = 42;
const FRICTION = 11;
const JUMP_SPEED = 5.2;
const GRAVITY = 13.5;

export function createPlayer(colliders, spawn) {
  const state = {
    position: { x: spawn.x, y: 0, z: spawn.z },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    eye: EYE_STAND,
    crouched: false,
    walking: false,
    onGround: true,
    recoilPitch: 0,
    recoilYaw: 0,
    stance: 'run', // run | walk | crouch — drives noise and accuracy
  };

  function look(dx, dy) {
    state.yaw -= dx * 0.0021;
    state.pitch -= dy * 0.0021;
    const limit = Math.PI / 2 - 0.01;
    state.pitch = Math.max(-limit, Math.min(limit, state.pitch));
  }

  function step(dt, keys, ads) {
    const walking = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const crouch = keys.has('ControlLeft') || keys.has('KeyC');
    state.crouched = crouch && state.onGround;
    state.walking = walking && !state.crouched;
    // Stance is read after the velocity update: standing still is 'idle',
    // not 'run' — the noise indicator must not call a still player loud.
    let speed = RUN_SPEED;
    if (state.crouched) speed = CROUCH_SPEED;
    else if (walking) speed = WALK_SPEED;
    else if (ads) speed = ADS_SPEED;

    let ix = 0;
    let iz = 0;
    if (keys.has('KeyW')) iz -= 1;
    if (keys.has('KeyS')) iz += 1;
    if (keys.has('KeyA')) ix -= 1;
    if (keys.has('KeyD')) ix += 1;
    const len = Math.hypot(ix, iz) || 1;
    ix /= len;
    iz /= len;
    const sin = Math.sin(state.yaw);
    const cos = Math.cos(state.yaw);
    const wx = (ix * cos - iz * sin) * speed;
    const wz = (ix * sin + iz * cos) * speed;

    const k = Math.min(1, ACCEL * dt);
    state.velocity.x += (wx - state.velocity.x) * k;
    state.velocity.z += (wz - state.velocity.z) * k;
    // Friction when no input: the body stops instead of gliding.
    if (ix === 0 && iz === 0) {
      const f = Math.max(0, 1 - FRICTION * dt);
      state.velocity.x *= f;
      state.velocity.z *= f;
    }

    if (keys.has('Space') && state.onGround && !state.crouched) {
      state.velocity.y = JUMP_SPEED;
      state.onGround = false;
    }
    state.velocity.y -= GRAVITY * dt;
    state.position.x += state.velocity.x * dt;
    state.position.z += state.velocity.z * dt;
    state.position.y += state.velocity.y * dt;
    if (state.position.y <= 0) {
      state.position.y = 0;
      state.velocity.y = 0;
      state.onGround = true;
    }
    resolveCircle(colliders, state.position, RADIUS);
    const speed2d = Math.hypot(state.velocity.x, state.velocity.z);
    state.stance = !state.onGround ? 'air' : speed2d < 0.8 ? 'idle' : state.crouched ? 'crouch' : walking ? 'walk' : 'run';
    // Recoil recovery is owned by main.js: it decays slowly while spraying
    // (so the spray pattern accumulates) and fast after fire stops.
    const targetEye = state.crouched ? EYE_CROUCH : EYE_STAND;
    state.eye += (targetEye - state.eye) * Math.min(1, 14 * dt);
  }

  function recoil(pitch, yaw) {
    state.recoilPitch += pitch;
    state.recoilYaw += yaw;
  }

  function groundSpeed() {
    return Math.hypot(state.velocity.x, state.velocity.z);
  }

  function teleport(x, z, yaw) {
    state.position.x = x;
    state.position.y = 0;
    state.position.z = z;
    state.velocity.x = 0;
    state.velocity.y = 0;
    state.velocity.z = 0;
    state.yaw = yaw;
    state.pitch = 0;
    state.recoilPitch = 0;
    state.recoilYaw = 0;
  }

  return { state, look, step, recoil, groundSpeed, teleport, EYE_STAND, RADIUS };
}
