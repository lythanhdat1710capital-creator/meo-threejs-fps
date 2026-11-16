// Bots: the other six soldiers on the yard. One module drives both teams:
// defenders hold the site, attackers push it, and every bot shares the same
// senses — sight, hearing, memory — and the same four states:
// patrol (walk a route), alert (move to a sound or a last-known position),
// attack (hold a firing position and shoot in bursts), cover (hurt: fall
// back to a safe node and peek). Bots never allocate in their hot step.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { losClear, resolveCircle, findRoute } from './world.js';

const BOT_RADIUS = 0.36;
const WALK_SPEED = 3.1;
const ALERT_SPEED = 4.3;
const SIGHT_RANGE = 46;
const SIGHT_HALF_FOV = 1.05; // ~60 degrees each side
const BURST_SIZE = 3;
const BURST_GAP = 0.11;

let botCounter = 0;

function makeBody(team) {
  const group = new THREE.Group();
  const trim = team === 'attacker' ? PALETTE.attacker : PALETTE.defender;
  const bodyMat = new THREE.MeshLambertMaterial({ color: PALETTE.body });
  const trimMat = new THREE.MeshLambertMaterial({ color: trim });
  const headMat = new THREE.MeshLambertMaterial({ color: PALETTE.head });
  const visorMat = new THREE.MeshBasicMaterial({ color: PALETTE.visor });

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.95, 10), bodyMat);
  torso.position.y = 0.95;
  torso.castShadow = true;
  group.add(torso);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.12), trimMat);
  vest.position.set(0, 1.05, 0.28);
  group.add(vest);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 12, 10), headMat);
  head.position.y = 1.58;
  head.castShadow = true;
  group.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.06), visorMat);
  visor.position.set(0, 1.6, 0.2);
  group.add(visor);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.72), headMat);
  gun.position.set(0.22, 1.15, 0.35);
  group.add(gun);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.18), headMat);
    leg.position.set(s * 0.14, 0.25, 0);
    group.add(leg);
  }
  // Health bar: a sprite that always faces the camera, tinted by health.
  const bar = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x7dd87d, depthTest: true }));
  bar.scale.set(0.9, 0.09, 1);
  bar.position.y = 1.98;
  group.add(bar);
  return { group, torso, head, bar };
}

export function createBot(scene, opts) {
  const id = botCounter;
  botCounter += 1;
  const parts = makeBody(opts.team);
  parts.group.position.set(opts.spawn.x, 0, opts.spawn.z);
  parts.torso.userData.bot = null;
  parts.head.userData.bot = null;
  parts.torso.userData.part = 'body';
  parts.head.userData.part = 'head';
  scene.add(parts.group);
  const bot = {
    id,
    name: opts.name,
    team: opts.team,
    group: parts.group,
    bar: parts.bar,
    torso: parts.torso,
    head: parts.head,
    hp: 100,
    alive: true,
    yaw: opts.yaw ?? 0,
    state: 'patrol',
    route: opts.route,          // node indices to walk, in order
    routeIndex: 0,
    speed: WALK_SPEED,
    lastKnown: null,            // {x, z, time}
    alertUntil: 0,
    senseTimer: Math.random() * 0.15,
    shootTimer: 1 + Math.random(),
    burstLeft: 0,
    burstTimer: 0,
    strafeDir: 1,
    strafeTimer: 0,
    coverUntil: 0,
    target: null,               // current enemy being engaged
    plantTimer: 0,
    defuseTimer: 0,
    hasBomb: false,
    bombRoute: null,         // waypoint route to the site, via findRoute
    bombRouteIndex: 0,
    rushRoute: null,         // waypoint route for a rush order
    rushRouteIndex: 0,
    speed2d: 0,
    order: null,                // squad order: 'follow' | 'hold' | 'rush' | null
    spotted: false,             // true while the current target is called out
    stepTimer: 0,               // footstep timing (sound the player can hear)
  };
  parts.torso.userData.bot = bot;
  parts.head.userData.bot = bot;
  return bot;
}

// Find the nearest visible enemy of this bot. Returns {enemy, dist} or null.
function nearestVisible(bot, enemies, colliders, now) {
  let best = null;
  let bestDist = Infinity;
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    const dx = enemy.pos.x - bot.group.position.x;
    const dz = enemy.pos.z - bot.group.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > SIGHT_RANGE || dist >= bestDist) continue;
    const angle = Math.atan2(-dx, -dz);
    let diff = angle - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) > SIGHT_HALF_FOV && dist > 6) continue;
    if (!losClear(colliders, bot.group.position.x, bot.group.position.z, enemy.pos.x, enemy.pos.z)) continue;
    best = enemy;
    bestDist = dist;
  }
  return best ? { enemy: best, dist: bestDist } : null;
}

function moveToward(bot, colliders, tx, tz, dt, speed) {
  const px = bot.group.position.x;
  const pz = bot.group.position.z;
  const dx = tx - px;
  const dz = tz - pz;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.4) return true;
  const vx = (dx / dist) * speed;
  const vz = (dz / dist) * speed;
  bot.group.position.x += vx * dt;
  bot.group.position.z += vz * dt;
  bot.yaw = Math.atan2(-vx, -vz);
  bot.speed2d = speed;
  resolveCircle(colliders, bot.group.position, BOT_RADIUS);
  return false;
}

// Walk one node of a waypoint route; returns true when the route is done.
function followRoute(bot, ctx, route, indexKey, dt, speed) {
  const node = ctx.waypoints[route[bot[indexKey]]];
  const arrived = moveToward(bot, ctx.colliders, node.x, node.z, dt, speed);
  if (arrived) bot[indexKey] += 1;
  return bot[indexKey] >= route.length;
}

export function stepBot(bot, dt, ctx) {
  if (!bot.alive) return;
  const now = ctx.time;
  const pos = bot.group.position;
  bot.speed2d = 0;

  // Senses run on a staggered timer, not every frame.
  bot.senseTimer -= dt;
  if (bot.senseTimer <= 0) {
    bot.senseTimer = 0.15;
    const seen = nearestVisible(bot, ctx.enemies(bot), ctx.colliders, now);
    if (seen) {
      bot.lastKnown = { x: seen.enemy.pos.x, z: seen.enemy.pos.z, time: now };
      bot.target = seen.enemy;
      bot.alertUntil = now + 4;
      if (bot.state !== 'cover') {
        // First sight of this target: call it out to the squad.
        if (!bot.spotted) {
          bot.spotted = true;
          ctx.events.push({ type: 'botSpotted', bot, enemy: seen.enemy });
        }
        bot.state = 'attack';
      }
    } else if (bot.target && now > bot.alertUntil) {
      bot.target = null;
      bot.spotted = false;
      if (bot.state === 'attack') bot.state = 'alert';
    }
  }

  // Hearing: a noise nearby pulls the bot toward it. Gunshots carry far;
  // running footsteps carry less; walking and crouching barely carry at all.
  // Each noise carries its own radius, so silent movement really is silent.
  if (ctx.noise && now - ctx.noise.time < 0.6) {
    const d = Math.hypot(ctx.noise.x - pos.x, ctx.noise.z - pos.z);
    if (d < (ctx.noise.radius ?? 26) && bot.state === 'patrol') {
      bot.lastKnown = { x: ctx.noise.x, z: ctx.noise.z, time: now };
      bot.alertUntil = now + 3;
      bot.state = 'alert';
    }
  }

  // A squad ping (the player spotted an enemy): focus on that spot.
  if (ctx.ping && now - ctx.ping.time < 6 && bot.team === 'attacker') {
    bot.lastKnown = { x: ctx.ping.x, z: ctx.ping.z, time: now };
    bot.alertUntil = now + 5;
    if (bot.state === 'patrol') bot.state = 'alert';
  }

  // Hurt: fall back to cover.
  if (bot.hp < 35 && bot.state !== 'cover' && bot.coverUntil < now) {
    bot.state = 'cover';
    bot.coverUntil = now + 6;
    const cover = ctx.coverNode(bot);
    bot.coverNodeIndex = cover;
  }

  const waypoints = ctx.waypoints;
  if (bot.state === 'cover') {
    const node = waypoints[bot.coverNodeIndex];
    moveToward(bot, ctx.colliders, node.x, node.z, dt, ALERT_SPEED);
    if (now > bot.coverUntil) bot.state = 'alert';
  } else if (bot.state === 'attack' && bot.target && bot.target.alive) {
    const tp = bot.target.pos;
    const dist = Math.hypot(tp.x - pos.x, tp.z - pos.z);
    // Face the target.
    bot.yaw = Math.atan2(-(tp.x - pos.x), -(tp.z - pos.z));
    // Strafe while shooting; close in from mid range (a bot that only strafes
    // at 15 m stalls in a standoff — attackers must push across the bridges,
    // not hold an angle across the canal), back off when too close.
    // The bomb carrier — and a rushing attacker — pushes through a fight
    // instead of holding a strafing range: otherwise the carrier reaches
    // the bridge mouth, sees a defender, and strafes there forever without
    // ever crossing the canal. Defenders never push (they hold).
    const pushing = bot.team === 'attacker' && (bot.hasBomb || bot.order === 'rush');
    const closeIn = pushing ? 4 : 12;
    bot.strafeTimer -= dt;
    if (bot.strafeTimer <= 0) {
      bot.strafeTimer = 0.9 + Math.random() * 1.1;
      bot.strafeDir = Math.random() < 0.5 ? -1 : 1;
    }
    let mx = 0;
    let mz = 0;
    if (dist > closeIn) {
      mx = tp.x - pos.x;
      mz = tp.z - pos.z;
    } else if (dist < 7) {
      mx = pos.x - tp.x;
      mz = pos.z - tp.z;
    }
    const sx = Math.cos(bot.yaw) * bot.strafeDir;
    const sz = -Math.sin(bot.yaw) * bot.strafeDir;
    const len = Math.hypot(mx + sx, mz + sz) || 1;
    pos.x += ((mx + sx) / len) * WALK_SPEED * 0.7 * dt;
    pos.z += ((mz + sz) / len) * WALK_SPEED * 0.7 * dt;
    bot.speed2d = WALK_SPEED * 0.7;
    resolveCircle(ctx.colliders, pos, BOT_RADIUS);
    // Fire in bursts.
    bot.shootTimer -= dt;
    if (bot.shootTimer <= 0 && bot.burstLeft === 0) {
      bot.burstLeft = BURST_SIZE;
      bot.burstTimer = 0;
      bot.shootTimer = 0.9 + Math.random() * 0.6;
    }
    if (bot.burstLeft > 0) {
      bot.burstTimer -= dt;
      if (bot.burstTimer <= 0) {
        bot.burstTimer = BURST_GAP;
        bot.burstLeft -= 1;
        ctx.events.push({ type: 'botShot', bot, target: bot.target, dist });
      }
    }
  } else if (bot.state === 'alert' && bot.lastKnown) {
    const arrived = moveToward(bot, ctx.colliders, bot.lastKnown.x, bot.lastKnown.z, dt, ALERT_SPEED);
    if (arrived || now - bot.lastKnown.time > 5) {
      bot.state = 'patrol';
      bot.lastKnown = null;
    }
  } else {
    // Squad orders override the patrol route.
    if (bot.order === 'hold') {
      // Hold position: stand, watch, shoot anything that comes.
    } else if (bot.order === 'follow' && ctx.followPos) {
      const fp = ctx.followPos;
      const d = Math.hypot(fp.x - pos.x, fp.z - pos.z);
      if (d > 3.5) moveToward(bot, ctx.colliders, fp.x, fp.z, dt, ALERT_SPEED);
    } else if (bot.order === 'rush') {
      // Rush the site via the waypoint graph — a straight line would beach
      // the bot on the canal wall.
      if (!bot.rushRoute) {
        bot.rushRoute = findRoute(pos.x, pos.z, ctx.site.x, ctx.site.z);
        bot.rushRouteIndex = 0;
      }
      followRoute(bot, ctx, bot.rushRoute, 'rushRouteIndex', dt, ALERT_SPEED);
    } else {
      // Patrol: walk the route, pausing briefly at each node.
      const node = waypoints[bot.route[bot.routeIndex % bot.route.length]];
      const arrived = moveToward(bot, ctx.colliders, node.x, node.z, dt, WALK_SPEED);
      if (arrived) bot.routeIndex += 1;
    }
  }

  // Footsteps: a moving bot makes a sound the player can hear nearby.
  if (bot.speed2d > 0.5) {
    bot.stepTimer -= dt;
    if (bot.stepTimer <= 0) {
      bot.stepTimer = 0.45;
      ctx.events.push({ type: 'botStep', bot });
    }
  }

  // Bomb carrier bot: walk the waypoint route to the site and plant.
  // The route crosses the canal on a bridge (or the ford), never straight
  // through the water — a straight line would beach the carrier on the wall.
  if (bot.hasBomb && bot.team === 'attacker' && bot.state !== 'attack') {
    const site = ctx.site;
    const d = Math.hypot(site.x - pos.x, site.z - pos.z);
    if (d > site.half) {
      if (!bot.bombRoute) {
        bot.bombRoute = findRoute(pos.x, pos.z, site.x, site.z);
        bot.bombRouteIndex = 0;
      }
      followRoute(bot, ctx, bot.bombRoute, 'bombRouteIndex', dt, ALERT_SPEED);
    } else {
      bot.plantTimer += dt;
      ctx.events.push({ type: 'botPlanting', bot, progress: bot.plantTimer });
      if (bot.plantTimer >= 3.5) ctx.events.push({ type: 'botPlanted', bot });
    }
  }

  // Defuse: a defender standing on a planted site works the spike.
  if (ctx.bombPlanted && bot.team === 'defender') {
    const site = ctx.site;
    const d = Math.hypot(site.x - pos.x, site.z - pos.z);
    if (d <= site.half + 0.5) {
      bot.defuseTimer += dt;
      ctx.events.push({ type: 'botDefusing', bot, progress: bot.defuseTimer });
      if (bot.defuseTimer >= 5) ctx.events.push({ type: 'botDefused', bot });
    } else if (bot.state !== 'attack') {
      moveToward(bot, ctx.colliders, site.x, site.z, dt, ALERT_SPEED);
    }
  }

  bot.group.rotation.y = bot.yaw;
  // Health bar colour + width follow health.
  const frac = Math.max(0, bot.hp / 100);
  bot.bar.material.color.setHSL(0.33 * frac, 0.7, 0.5);
  bot.bar.scale.x = 0.9 * frac;
}

export function damageBot(bot, amount, ctx) {
  if (!bot.alive) return false;
  bot.hp -= amount;
  if (bot.hp <= 0) {
    bot.hp = 0;
    bot.alive = false;
    bot.group.rotation.x = -Math.PI / 2;
    bot.group.position.y = 0.25;
    bot.bar.visible = false;
    ctx.events.push({ type: 'botDied', bot });
    return true;
  }
  // Being shot snaps attention to the shooter.
  if (ctx.lastShooter) {
    bot.lastKnown = { x: ctx.lastShooter.x, z: ctx.lastShooter.z, time: ctx.time };
    bot.alertUntil = ctx.time + 4;
    if (bot.state === 'patrol') bot.state = 'alert';
  }
  return false;
}

export function resetBot(bot, spawn, route) {
  bot.hp = 100;
  bot.alive = true;
  bot.group.position.set(spawn.x, 0, spawn.z);
  bot.group.rotation.set(0, 0, 0);
  bot.yaw = 0;
  bot.state = 'patrol';
  bot.route = route;
  bot.routeIndex = 0;
  bot.lastKnown = null;
  bot.target = null;
  bot.plantTimer = 0;
  bot.defuseTimer = 0;
  bot.hasBomb = false;
  bot.bombRoute = null;
  bot.bombRouteIndex = 0;
  bot.rushRoute = null;
  bot.rushRouteIndex = 0;
  bot.order = null;
  bot.spotted = false;
  bot.bar.visible = true;
  bot.bar.scale.x = 0.9;
}
