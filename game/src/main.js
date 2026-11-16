// RAILYARD 9 — a round-based tactical FPS. One bomb site, two teams, money
// between rounds. State lives in one object (`game`); the simulation runs at
// a fixed 60 Hz and rendering follows the display. Bots, the bomb and the
// economy are modules; this file wires them together and owns shooting,
// rounds and the buy phase.
//
// ?shot=start|play|end&seed=N stages a deterministic frame for a capture and
// sets window.__shotReady. window.__fps exposes the game for testing.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { createWorld, MAP, WAYPOINTS, losClear, groundHeightAt, findRoute } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import {
  WEAPONS, GRENADE, createLoadout, currentSpread, takeRound, sprayKick,
  startReload, stepLoadout, buyWeapon, buyAmmo,
} from './weapons.js';
import { createBot, stepBot, damageBot, resetBot } from './bots.js';
import { createBomb, resetBomb, stepBomb, inSite, PLANT_TIME, FUSE_TIME, DEFUSE_TIME } from './bomb.js';
import { createEconomy, BUY_ITEMS, WIN_REWARD, LOSS_REWARD, KILL_REWARD, PLANT_REWARD } from './economy.js';
import { createFx } from './fx.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const ROUND_TIME = 100;
const BUY_TIME = 12;
const WIN_ROUNDS = 5;
const MAX_ROUNDS = 9;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed);
// ?lowfx=1 disables shadows and antialiasing: same game, cheaper to render
// — used for headless play-testing on software rendering.
const lowfx = params.get('lowfx') === '1';

// --- Renderer / scene -------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: !lowfx, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = !lowfx;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(PALETTE.sky, PALETTE.fogNear, PALETTE.fogFar);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);
scene.add(new THREE.HemisphereLight(0x8fa3cc, 0x1a1410, 0.7));
const moonLight = new THREE.DirectionalLight(0xbcd0ff, 1.05);
moonLight.position.set(-18, 30, -20);
moonLight.castShadow = true;
moonLight.shadow.mapSize.set(1024, 1024);
moonLight.shadow.camera.left = -30;
moonLight.shadow.camera.right = 30;
moonLight.shadow.camera.top = 30;
moonLight.shadow.camera.bottom = -30;
scene.add(moonLight);

const world = createWorld(scene);
const fx = createFx(scene, camera);
const audio = createAudio();
const hud = createHud();
const input = createInput(renderer.domElement, onLockChange);
const player = createPlayer(world.colliders, MAP.attackerSpawn[1]);
const bomb = createBomb(scene, MAP.site);

// --- State (one place) ------------------------------------------------------
const game = {
  phase: 'menu',           // menu | buy | playing | roundEnd | matchEnd
  round: 1,
  scoreA: 0,               // Vipers (attackers, player team)
  scoreD: 0,               // Jackals (defenders)
  timer: ROUND_TIME,
  buyTimer: BUY_TIME,
  hp: 100,
  dead: false,
  money: createEconomy().money,
  loadout: createLoadout(),
  bots: [],
  events: [],
  noise: null,
  elapsed: 0,
  time: 0,
  ads: false,
  plantHeld: 0,
  roundEndTimer: 0,
  roundWinner: null,
  grenades: [],            // live grenades {pos, vel, fuse}
  kills: 0,
  frozen: false,
};

const DEFENDER_ROUTES = [[24, 26, 25], [25, 26, 24], [15, 22, 24], [16, 20, 25]];
const ATTACKER_ROUTES = [[0, 3, 8, 11, 14, 17, 21, 24], [2, 5, 10, 13, 16, 19, 23, 25]];

function buildBots() {
  for (const bot of game.bots) scene.remove(bot.group);
  game.bots = [];
  MAP.defenderSpawn.forEach((spawn, i) => {
    game.bots.push(createBot(scene, {
      name: `Jackal-${i + 1}`, team: 'defender', spawn,
      route: DEFENDER_ROUTES[i], yaw: Math.PI / 2,
    }));
  });
  MAP.attackerSpawn.forEach((spawn, i) => {
    if (i === 1) return; // the player takes the middle spawn
    game.bots.push(createBot(scene, {
      name: `Viper-${i + 2}`, team: 'attacker', spawn,
      route: ATTACKER_ROUTES[i === 0 ? 0 : 1], yaw: -Math.PI / 2,
    }));
  });
}

function aliveBots(team) {
  return game.bots.filter((b) => b.team === team && b.alive);
}

// --- Bot context (what the bots can sense) ----------------------------------
function enemyList(bot) {
  const list = [];
  if (bot.team === 'defender') {
    if (!game.dead) list.push({ pos: player.state.position, alive: true, isPlayer: true, ref: 'player', crouched: player.state.crouched, speed: player.groundSpeed() });
    for (const mate of game.bots) {
      if (mate.team === 'attacker' && mate.alive) {
        list.push({ pos: mate.group.position, alive: true, isPlayer: false, ref: mate, crouched: false, speed: mate.speed2d });
      }
    }
  } else {
    for (const foe of game.bots) {
      if (foe.team === 'defender' && foe.alive) {
        list.push({ pos: foe.group.position, alive: true, isPlayer: false, ref: foe, crouched: false, speed: foe.speed2d });
      }
    }
  }
  return list;
}

function botContext() {
  return {
    time: game.time,
    colliders: world.colliders,
    waypoints: WAYPOINTS,
    site: MAP.site,
    bombPlanted: bomb.state === 'planted',
    noise: game.noise,
    events: game.events,
    enemies: (bot) => enemyList(bot),
    coverNode: (bot) => {
      // The waypoint farthest from the nearest visible enemy, on the same
      // side of the canal as the bot (crossing nodes count for either side),
      // so a hurt bot never has to cross a bridge while falling back.
      const side = bot.group.position.x < 0 ? -1 : 1;
      let bestNode = 0;
      let bestDist = -1;
      for (let i = 0; i < WAYPOINTS.length; i += 1) {
        const nodeSide = WAYPOINTS[i].x === 0 ? side : (WAYPOINTS[i].x < 0 ? -1 : 1);
        if (nodeSide !== side) continue;
        let d = Infinity;
        for (const e of enemyList(bot)) {
          d = Math.min(d, Math.hypot(WAYPOINTS[i].x - e.pos.x, WAYPOINTS[i].z - e.pos.z));
        }
        if (d > bestDist) { bestDist = d; bestNode = i; }
      }
      return bestNode;
    },
  };
}

// --- Shooting ----------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const shootDir = new THREE.Vector3();
const muzzlePos = new THREE.Vector3();
const hitPoint = new THREE.Vector3();
let lastShotTime = 0;

function playerShoot() {
  const loadout = game.loadout;
  const def = WEAPONS[loadout.current];
  if (!takeRound(loadout)) {
    if (loadout.guns[loadout.current].mag === 0) {
      audio.dryFire();
      startReload(loadout);
    }
    return;
  }
  const spread = currentSpread(def, player.groundSpeed(), player.state.crouched, game.ads, !player.state.onGround, loadout.sprayIndex === 0);
  camera.getWorldDirection(shootDir);
  shootDir.x += (random() * 2 - 1) * spread;
  shootDir.y += (random() * 2 - 1) * spread;
  shootDir.z += (random() * 2 - 1) * spread;
  shootDir.normalize();
  raycaster.set(camera.position, shootDir);
  raycaster.far = def.range;
  scene.updateMatrixWorld(true);
  const targets = [];
  for (const bot of game.bots) {
    if (bot.team === 'defender' && bot.alive) targets.push(bot.torso, bot.head);
  }
  const hits = raycaster.intersectObjects(world.shootables.concat(targets), false);
  const muzzle = muzzlePos.copy(camera.position).addScaledVector(shootDir, 0.6);
  muzzle.y -= 0.12;
  let end = hitPoint.copy(camera.position).addScaledVector(shootDir, def.range);
  if (hits.length > 0) {
    const hit = hits[0];
    end = hit.point;
    if (hit.object.userData.bot) {
      const bot = hit.object.userData.bot;
      const isHead = hit.object.userData.part === 'head';
      const dmg = isHead ? def.headDamage : def.damage;
      const killed = damageBot(bot, dmg, { events: game.events, time: game.time, lastShooter: player.state.position });
      hud.hitMarker(killed);
      audio.hit();
      if (killed) {
        audio.kill();
        game.kills += 1;
        game.money += KILL_REWARD;
        hud.feed(`You ▸ ${bot.name}${isHead ? ' (headshot)' : ''}  +$${KILL_REWARD}`, true);
        hud.setMoney(game.money);
      }
    } else {
      fx.impact(hit.point, hit.face ? hit.face.normal : { x: 0, y: 1, z: 0 });
    }
  }
  fx.fireTracer(muzzle, end);
  fx.muzzle();
  audio.shot(loadout.current === 'pistol' ? false : true);
  // Deterministic spray: the next entry of the weapon's fixed table kicks
  // the aim (attachments scale it). Same weapon, same pattern, every time.
  const kick = sprayKick(def, loadout.sprayIndex, loadout.attachments);
  player.recoil(kick.pitch, kick.yaw);
  loadout.sprayIndex += 1;
  loadout.sprayIdle = 0;
  game.noise = { x: player.state.position.x, z: player.state.position.z, time: game.time, radius: 30, kind: 'shot' };
  lastShotTime = game.time;
  hud.setAmmo(loadout.guns[loadout.current].mag, loadout.guns[loadout.current].reserve, false);
  if (loadout.guns[loadout.current].mag === 0) startReload(loadout);
}

function resolveBotShot(event) {
  const { bot, target, dist } = event;
  const from = bot.group.position;
  const muzzle = { x: from.x, y: from.y + 1.25, z: from.z };
  // Hit chance: close and still targets die; far, fast and crouched targets live.
  let chance = 0.58 - dist * 0.011;
  if (target.crouched) chance -= 0.12;
  if (target.speed > 3) chance -= 0.14;
  if (bot.speed2d > 1) chance -= 0.1;
  const hit = random() < Math.max(0.08, chance);
  const head = hit && random() < 0.08;
  let end;
  if (hit) {
    end = { x: target.pos.x, y: target.pos.y + (head ? 1.55 : 1.0), z: target.pos.z };
    const dmg = (head ? 44 : 22) * (0.85 + random() * 0.3);
    if (target.isPlayer) damagePlayer(dmg, bot);
    else damageBot(target.ref, dmg, { events: game.events, time: game.time, lastShooter: from });
  } else {
    end = {
      x: target.pos.x + (random() * 2 - 1) * 2.2,
      y: target.pos.y + 0.6 + random() * 1.4,
      z: target.pos.z + (random() * 2 - 1) * 2.2,
    };
  }
  fx.fireTracer(muzzle, end);
  if (Math.hypot(from.x - player.state.position.x, from.z - player.state.position.z) < 30) audio.enemyShot();
}

function damagePlayer(amount, fromBot) {
  if (game.dead) return;
  let rest = amount;
  if (game.loadout.armor > 0) {
    const absorbed = Math.min(game.loadout.armor, amount * 0.5);
    game.loadout.armor -= absorbed;
    rest -= absorbed;
  }
  game.hp -= rest;
  hud.damageFlash();
  audio.hurt();
  hud.setHealth(game.hp, game.loadout.armor);
  if (game.hp <= 0) {
    game.hp = 0;
    game.dead = true;
    hud.feed(`${fromBot ? fromBot.name : 'Jackal'} ▸ You`);
    if (bomb.carrier === 'player' && bomb.state === 'carried') {
      bomb.state = 'dropped';
      bomb.pos.x = player.state.position.x;
      bomb.pos.z = player.state.position.z;
      bomb.group.position.set(bomb.pos.x, 0.05, bomb.pos.z);
      bomb.group.visible = true;
      hud.setBomb('SPIKE DROPPED — pick it up', 0);
    }
    input.releaseLock();
    hud.showOverlay('down', 'You are down', 'Your team fights on. Wait for the round to end.', 'Wait');
  }
}

// --- Grenades -----------------------------------------------------------------
const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
const grenadeMat = new THREE.MeshLambertMaterial({ color: 0x2e4a2a });
const grenadeMeshes = [];

function throwGrenade() {
  if (game.loadout.grenades <= 0 || game.phase !== 'playing' || game.dead) return;
  game.loadout.grenades -= 1;
  camera.getWorldDirection(shootDir);
  const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
  mesh.position.copy(camera.position).addScaledVector(shootDir, 0.5);
  scene.add(mesh);
  grenadeMeshes.push(mesh);
  game.grenades.push({
    mesh,
    pos: mesh.position,
    vel: new THREE.Vector3(shootDir.x * 15, shootDir.y * 15 + 3, shootDir.z * 15),
    fuse: GRENADE.fuse,
  });
  game.noise = { x: player.state.position.x, z: player.state.position.z, time: game.time, radius: 10, kind: 'step' };
}

function stepGrenades(dt) {
  for (let i = game.grenades.length - 1; i >= 0; i -= 1) {
    const g = game.grenades[i];
    g.vel.y -= 9.8 * dt;
    g.pos.addScaledVector(g.vel, dt);
    // The floor under a grenade: the yard, the deck ramp or the deck top.
    const floor = groundHeightAt(g.pos.x, g.pos.z) + 0.1;
    if (g.pos.y < floor) {
      g.pos.y = floor;
      g.vel.y = Math.abs(g.vel.y) * 0.45;
      g.vel.x *= 0.7;
      g.vel.z *= 0.7;
    }
    // Cheap AABB bounce: push out and reflect the dominant axis.
    for (const c of world.colliders) {
      if (g.pos.x > c.minX && g.pos.x < c.maxX && g.pos.z > c.minZ && g.pos.z < c.maxZ && g.pos.y < c.h) {
        const dxl = g.pos.x - c.minX;
        const dxr = c.maxX - g.pos.x;
        const dzl = g.pos.z - c.minZ;
        const dzr = c.maxZ - g.pos.z;
        const m = Math.min(dxl, dxr, dzl, dzr);
        if (m === dxl) { g.pos.x = c.minX - 0.1; g.vel.x = -Math.abs(g.vel.x) * 0.4; }
        else if (m === dxr) { g.pos.x = c.maxX + 0.1; g.vel.x = Math.abs(g.vel.x) * 0.4; }
        else if (m === dzl) { g.pos.z = c.minZ - 0.1; g.vel.z = -Math.abs(g.vel.z) * 0.4; }
        else { g.pos.z = c.maxZ + 0.1; g.vel.z = Math.abs(g.vel.z) * 0.4; }
      }
    }
    g.fuse -= dt;
    if (g.fuse <= 0) {
      fx.explosion(g.pos);
      audio.explosion();
      game.noise = { x: g.pos.x, z: g.pos.z, time: game.time, radius: 34, kind: 'shot' };
      for (const bot of game.bots) {
        if (!bot.alive) continue;
        const d = Math.hypot(bot.group.position.x - g.pos.x, bot.group.position.z - g.pos.z);
        if (d < GRENADE.radius) {
          const dmg = GRENADE.damage * (1 - d / GRENADE.radius);
          damageBot(bot, dmg, { events: game.events, time: game.time, lastShooter: player.state.position });
        }
      }
      const pd = Math.hypot(player.state.position.x - g.pos.x, player.state.position.z - g.pos.z);
      if (pd < GRENADE.radius && !game.dead) damagePlayer(GRENADE.damage * (1 - pd / GRENADE.radius) * 0.6, null);
      scene.remove(g.mesh);
      grenadeMeshes.splice(grenadeMeshes.indexOf(g.mesh), 1);
      game.grenades.splice(i, 1);
    }
  }
}

// --- Squad commands -----------------------------------------------------------
const COMMANDS = {
  follow: { label: 'Follow me', ack: 'Copy, on you.' },
  hold: { label: 'Hold position', ack: 'Holding.' },
  rush: { label: 'Rush Site A', ack: 'Rushing Site A!' },
};

// Ping marker: a floating diamond + ground ring at the called-out spot.
const pingGroup = new THREE.Group();
const pingSprite = new THREE.Sprite(new THREE.SpriteMaterial({ color: PALETTE.accent, depthTest: false }));
pingSprite.scale.set(0.6, 0.6, 1);
pingSprite.position.y = 1.6;
const pingRing = new THREE.Mesh(
  new THREE.RingGeometry(0.5, 0.7, 24),
  new THREE.MeshBasicMaterial({ color: PALETTE.accent, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
);
pingRing.rotation.x = -Math.PI / 2;
pingRing.position.y = 0.06;
pingGroup.add(pingSprite);
pingGroup.add(pingRing);
pingGroup.visible = false;
scene.add(pingGroup);
let pingUntil = 0;

function showPing(x, z, seconds) {
  pingGroup.position.set(x, 0, z);
  pingGroup.visible = true;
  pingUntil = game.time + seconds;
}

function issueCommand(cmd) {
  if (game.phase !== 'playing') return;
  const mates = game.bots.filter((b) => b.team === 'attacker' && b.alive);
  if (cmd === 'spot') {
    // Ping the crosshair point (or the nearest visible enemy).
    camera.getWorldDirection(shootDir);
    raycaster.set(camera.position, shootDir);
    raycaster.far = 80;
    const targets = game.bots.filter((b) => b.team === 'defender' && b.alive).flatMap((b) => [b.torso, b.head]);
    const hits = raycaster.intersectObjects(world.shootables.concat(targets), false);
    const point = hits.length > 0 ? hits[0].point : camera.position.clone().addScaledVector(shootDir, 20);
    game.ping = { x: point.x, z: point.z, time: game.time };
    showPing(point.x, point.z, 4);
    audio.ping();
    hud.feed('You: Enemy spotted — marked', true);
    const mate = mates[0];
    if (mate) hud.squadLine(`${mate.name}: Copy, moving to mark.`);
    return;
  }
  for (const mate of mates) { mate.order = cmd; mate.rushRoute = null; mate.rushRouteIndex = 0; }
  audio.ack();
  hud.feed(`You: ${COMMANDS[cmd].label}`);
  const mate = mates[0];
  if (mate) hud.squadLine(`${mate.name}: ${COMMANDS[cmd].ack}`);
}

function compassDir(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (Math.abs(dz) > Math.abs(dx)) return dz < 0 ? 'north' : 'south';
  return dx > 0 ? 'east' : 'west';
}

// --- Rounds -------------------------------------------------------------------
function startMatch() {
  game.scoreA = 0;
  game.scoreD = 0;
  game.round = 1;
  game.money = 1000;
  game.loadout = createLoadout();
  game.kills = 0;
  startRound();
}

function startRound() {
  buildBots();
  game.phase = 'buy';
  game.buyTimer = BUY_TIME;
  game.timer = ROUND_TIME;
  game.dead = false;
  game.hp = 100;
  game.plantHeld = 0;
  game.grenades = [];
  for (const mesh of grenadeMeshes) scene.remove(mesh);
  grenadeMeshes.length = 0;
  resetBomb(bomb, MAP.site);
  player.teleport(MAP.attackerSpawn[1].x, MAP.attackerSpawn[1].z, -Math.PI / 2);
  const loadout = game.loadout;
  for (const key of Object.keys(loadout.guns)) {
    const gun = loadout.guns[key];
    if (key === 'pistol' || gun.owned) {
      gun.mag = WEAPONS[key].magSize;
      gun.reserve = WEAPONS[key].reserveMax;
      gun.reloading = 0;
    }
  }
  game.ping = null;
  pingGroup.visible = false;
  syncCamera();
  hud.setHealth(game.hp, loadout.armor);
  hud.setAmmo(loadout.guns[loadout.current].mag, loadout.guns[loadout.current].reserve, false);
  hud.setMoney(game.money);
  hud.setRound(game.round, game.scoreA, game.scoreD);
  hud.setTimer(game.timer);
  hud.setTeam(aliveBots('attacker').length + 1, aliveBots('defender').length);
  hud.setBomb('SPIKE — plant it at Site A', 0);
  hud.hideOverlay();
  hud.showBuy(game.money, BUY_ITEMS);
  input.releaseLock();
}

function deploy() {
  if (game.phase !== 'buy') return;
  game.phase = 'playing';
  hud.hideBuy();
  hud.banner(`ROUND ${game.round} — plant the spike at Site A`);
  audio.unlock();
  input.requestLock();
}

function endRound(winner) {
  if (game.phase !== 'playing') return;
  game.phase = 'roundEnd';
  game.roundWinner = winner;
  game.roundEndTimer = 4;
  if (winner === 'attacker') {
    game.scoreA += 1;
    game.money += WIN_REWARD;
    audio.roundWin();
    hud.banner('ROUND WON — Vipers take it');
    hud.feed(`Round ${game.round}: Vipers win  +$${WIN_REWARD}`, true);
  } else {
    game.scoreD += 1;
    game.money += LOSS_REWARD;
    audio.roundLose();
    hud.banner('ROUND LOST — Jackals hold the yard');
    hud.feed(`Round ${game.round}: Jackals win  +$${LOSS_REWARD}`);
  }
  hud.setMoney(game.money);
  hud.setRound(game.round, game.scoreA, game.scoreD);
  input.releaseLock();
}

function buyItem(id) {
  const loadout = game.loadout;
  if (id === 'rifle' || id === 'sniper') {
    const before = game.money;
    game.money = buyWeapon(loadout, id, game.money);
    if (game.money !== before) {
      audio.buy();
      hud.setAmmo(loadout.guns[loadout.current].mag, loadout.guns[loadout.current].reserve, false);
    }
  } else if (id === 'grenade') {
    if (game.money >= GRENADE.price && loadout.grenades < 2) {
      game.money -= GRENADE.price;
      loadout.grenades += 1;
      audio.buy();
    }
  } else if (id === 'armor') {
    if (game.money >= 500 && loadout.armor < 50) {
      game.money -= 500;
      loadout.armor = 50;
      audio.buy();
      hud.setHealth(game.hp, loadout.armor);
    }
  } else if (id === 'ammo') {
    const before = game.money;
    game.money = buyAmmo(loadout, game.money);
    if (game.money !== before) {
      audio.buy();
      hud.setAmmo(loadout.guns[loadout.current].mag, loadout.guns[loadout.current].reserve, false);
    }
  } else if (id === 'compensator' || id === 'vgrip' || id === 'agrip') {
    const def = { compensator: 400, vgrip: 300, agrip: 250 }[id];
    if (game.money >= def && !loadout.attachments[id]) {
      game.money -= def;
      loadout.attachments[id] = true;
      audio.buy();
      hud.feed(`Bought attachment — your spray just got tighter`, true);
    }
  }
  hud.setMoney(game.money);
  hud.showBuy(game.money, BUY_ITEMS);
}

// --- Events from bots -----------------------------------------------------------
function processEvents() {
  for (const event of game.events) {
    if (event.type === 'botShot') resolveBotShot(event);
    else if (event.type === 'botDied') {
      const bot = event.bot;
      hud.feed(`${bot.team === 'defender' ? 'You' : 'Jackal'} ▸ ${bot.name}`);
      if (bot.team === 'defender' && bot.hasBomb) {
        bot.hasBomb = false;
        bomb.state = 'dropped';
        bomb.pos.x = bot.group.position.x;
        bomb.pos.z = bot.group.position.z;
        bomb.group.position.set(bomb.pos.x, 0.05, bomb.pos.z);
        bomb.group.visible = true;
      }
      hud.setTeam(aliveBots('attacker').length + (game.dead ? 0 : 1), aliveBots('defender').length);
    } else if (event.type === 'botSpotted') {
      if (event.bot.team === 'attacker') {
        const dir = compassDir(player.state.position, event.enemy.pos);
        hud.feed(`${event.bot.name}: Contact — ${dir}!`, true);
        showPing(event.enemy.pos.x, event.enemy.pos.z, 3);
        audio.ping();
      }
    } else if (event.type === 'botPlanting') {
      hud.setBomb(`SPIKE BEING PLANTED — ${Math.ceil(3.5 - event.progress)}s`, event.progress / 3.5);
    } else if (event.type === 'botPlanted') {
      bomb.state = 'planted';
      bomb.carrier = event.bot.name;
      bomb.fuse = FUSE_TIME;
      bomb.group.position.set(MAP.site.x, 0.05, MAP.site.z);
      bomb.group.visible = true;
      hud.feed(`${event.bot.name} planted the spike!`, true);
      audio.plant();
    } else if (event.type === 'botDefusing') {
      hud.setBomb(`JACKAL DEFUSING — ${Math.ceil(5 - event.progress)}s`, event.progress / 5);
    } else if (event.type === 'botDefused') {
      bomb.state = 'defused';
      endRound('defender');
    } else if (event.type === 'bombDetonated') {
      fx.explosion(new THREE.Vector3(MAP.site.x, 0.5, MAP.site.z));
      audio.explosion();
      endRound('attacker');
    } else if (event.type === 'botStep') {
      const d = Math.hypot(event.bot.group.position.x - player.state.position.x, event.bot.group.position.z - player.state.position.z);
      if (d < 14 && !game.dead) audio.step(false);
    }
  }
  game.events.length = 0;
}

// --- Camera / HUD sync ----------------------------------------------------------
let fovCurrent = 74;
let leanCurrent = 0;
let swayTime = 0;

function syncCamera() {
  const s = player.state;
  // ADS: zoom the field of view toward 55 (50 with the sniper), with sway
  // unless the player holds Shift to steady the aim.
  const def = WEAPONS[game.loadout.current];
  const adsTarget = game.ads ? (game.loadout.current === 'sniper' ? 48 : 55) : 74;
  const adsSpeed = game.loadout.attachments.agrip ? 10 : 6;
  fovCurrent += (adsTarget - fovCurrent) * Math.min(1, adsSpeed * 0.016);
  if (Math.abs(camera.fov - fovCurrent) > 0.05) {
    camera.fov = fovCurrent;
    camera.updateProjectionMatrix();
  }
  swayTime += 0.016;
  const steady = game.ads && (input.state.keys.has('ShiftLeft') || input.state.keys.has('ShiftRight'));
  const swayScale = game.ads ? (steady ? 0.15 : 1) : 0;
  const swayP = Math.sin(swayTime * 1.3) * 0.0016 * swayScale;
  const swayY = Math.cos(swayTime * 1.1) * 0.0016 * swayScale;
  // Lean: Q/E roll the camera and shift it sideways a little.
  const leanTarget = input.state.keys.has('KeyQ') ? 0.42 : input.state.keys.has('KeyE') ? -0.42 : 0;
  leanCurrent += (leanTarget - leanCurrent) * 0.18;
  const leanShift = -leanCurrent * 0.55;
  const sin = Math.sin(s.yaw);
  const cos = Math.cos(s.yaw);
  camera.position.set(
    s.position.x + cos * leanShift,
    s.position.y + s.eye,
    s.position.z - sin * leanShift,
  );
  camera.rotation.set(s.pitch + s.recoilPitch + swayP, s.yaw + s.recoilYaw + swayY, leanCurrent, 'YXZ');
}

// --- Simulation step ------------------------------------------------------------
let stepTimer = 0; // player footstep timing

function step(dt) {
  game.elapsed += dt;
  game.time += dt;
  const keys = input.state.keys;
  const loadout = game.loadout;

  // Recoil recovery: slow while spraying (the pattern accumulates), fast
  // once fire stops — so the spray is learnable and tap fire stays true.
  const sinceShot = game.time - lastShotTime;
  const decay = sinceShot > 0.3 ? 6 : 1.2;
  player.state.recoilPitch *= Math.max(0, 1 - decay * dt);
  player.state.recoilYaw *= Math.max(0, 1 - decay * dt);

  if (game.phase === 'playing' && !game.dead) {
    player.step(dt, keys, game.ads);
    // Footsteps: running is loud (bots hear it from 20 m), walking is quiet
    // (6 m), crouching quieter still (2.5 m). The HUD shows the tradeoff.
    const speed = player.groundSpeed();
    if (speed > 0.8 && player.state.onGround) {
      stepTimer -= dt * speed;
      if (stepTimer <= 0) {
        stepTimer = 2.1;
        const stance = player.state.stance;
        const loud = stance === 'run';
        audio.step(loud);
        const radius = stance === 'run' ? 20 : stance === 'walk' ? 6 : 2.5;
        game.noise = { x: player.state.position.x, z: player.state.position.z, time: game.time, radius, kind: 'step' };
      }
    }
    hud.setNoise(player.state.stance);
  }

  stepLoadout(loadout, dt);
  fx.step(dt);
  stepBomb(bomb, dt, game.events);

  if (game.phase === 'playing') {
    // Round timer.
    game.timer -= dt;
    hud.setTimer(game.timer);

    // Bomb pickup (dropped spike).
    if (bomb.state === 'dropped') {
      const pd = Math.hypot(player.state.position.x - bomb.pos.x, player.state.position.z - bomb.pos.z);
      if (!game.dead && pd < 1.5) {
        bomb.state = 'carried';
        bomb.carrier = 'player';
        bomb.group.visible = false;
        hud.feed('Spike picked up', true);
        hud.setBomb('SPIKE — plant it at Site A', 0);
      } else {
        for (const mate of game.bots) {
          if (mate.team === 'attacker' && mate.alive) {
            const md = Math.hypot(mate.group.position.x - bomb.pos.x, mate.group.position.z - bomb.pos.z);
            if (md < 1.5) {
              bomb.state = 'carried';
              bomb.carrier = mate.name;
              bomb.group.visible = false;
              mate.hasBomb = true;
              hud.feed(`${mate.name} picked up the spike`, true);
              break;
            }
          }
        }
      }
    }

    // Planting: hold F inside the site while carrying the spike.
    if (!game.dead && bomb.state === 'carried' && bomb.carrier === 'player'
      && inSite(MAP.site, player.state.position.x, player.state.position.z)) {
      if (keys.has('KeyF')) {
        game.plantHeld += dt;
        hud.showProgress('PLANTING SPIKE', game.plantHeld / PLANT_TIME);
        if (game.plantHeld >= PLANT_TIME) {
          bomb.state = 'planted';
          bomb.fuse = FUSE_TIME;
          bomb.group.position.set(MAP.site.x, 0.05, MAP.site.z);
          bomb.group.visible = true;
          game.plantHeld = 0;
          game.money += PLANT_REWARD;
          hud.hideProgress();
          hud.feed(`Spike planted!  +$${PLANT_REWARD}`, true);
          hud.setMoney(game.money);
          audio.plant();
        }
      } else {
        game.plantHeld = 0;
        hud.hideProgress();
      }
    } else {
      game.plantHeld = 0;
      hud.hideProgress();
    }

    // Bomb status line.
    if (bomb.state === 'planted') {
      hud.setBomb(`SPIKE PLANTED — ${Math.ceil(bomb.fuse)}s to detonation`, bomb.fuse / FUSE_TIME);
    } else if (bomb.state === 'carried' && bomb.carrier === 'player') {
      hud.setBomb('SPIKE — plant it at Site A', 0);
    } else if (bomb.state === 'dropped') {
      hud.setBomb('SPIKE DROPPED — pick it up', 0);
    } else if (bomb.state === 'carried') {
      hud.setBomb(`${bomb.carrier} has the spike`, 0);
    }

    // Bots.
    const ctx = botContext();
    ctx.followPos = player.state.position;
    for (const bot of game.bots) stepBot(bot, dt, ctx);
    stepGrenades(dt);
    processEvents();

    // Ping marker fades.
    if (pingGroup.visible && game.time > pingUntil) pingGroup.visible = false;

    // Round end conditions.
    const defAlive = aliveBots('defender').length;
    const atkAlive = aliveBots('attacker').length + (game.dead ? 0 : 1);
    if (defAlive === 0) endRound('attacker');
    else if (atkAlive === 0 && bomb.state !== 'planted') endRound('defender');
    else if (game.timer <= 0 && bomb.state !== 'planted') endRound('defender');
  }

  if (game.phase === 'buy') {
    game.buyTimer -= dt;
    if (game.buyTimer <= 0) deploy();
  }

  if (game.phase === 'roundEnd') {
    game.roundEndTimer -= dt;
    if (game.roundEndTimer <= 0) {
      if (game.scoreA >= WIN_ROUNDS || game.scoreD >= WIN_ROUNDS || game.round >= MAX_ROUNDS) {
        game.phase = 'matchEnd';
        const won = game.scoreA > game.scoreD;
        hud.showOverlay('match', won ? 'VIPERS WIN THE MATCH' : 'JACKALS WIN THE MATCH',
          `Final score — Vipers ${game.scoreA} · ${game.scoreD} Jackals. ${game.kills} eliminations.`, 'Play again');
      } else {
        game.round += 1;
        startRound();
      }
    }
  }
}

// --- Frame loop -------------------------------------------------------------------
let accumulator = 0;
let lastTime = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!game.frozen) {
    const look = input.takeLook();
    if (input.state.locked) player.look(look.x, look.y);
    const pressedCodes = input.takePressed();
    const pressed = (code) => pressedCodes.has(code);

    const keys = input.state.keys;
    // Weapon switching (playing only).
    if (game.phase === 'playing' && !game.dead) {
      if (pressed('Digit1')) switchWeapon('pistol');
      if (pressed('Digit2') && game.loadout.guns.rifle.owned) switchWeapon('rifle');
      if (pressed('Digit3') && game.loadout.guns.sniper.owned) switchWeapon('sniper');
      if (pressed('KeyR')) startReload(game.loadout) && audio.reload();
      if (pressed('KeyG')) throwGrenade();
      if (pressed('KeyZ')) issueCommand('follow');
      if (pressed('KeyX')) issueCommand('hold');
      if (pressed('KeyC')) issueCommand('rush');
      if (pressed('KeyV')) issueCommand('spot');
    }
    // Buy menu keys.
    if (game.phase === 'buy') {
      for (const item of BUY_ITEMS) {
        if (pressed(`Digit${item.key}`)) buyItem(item.id);
      }
      if (pressed('Enter')) deploy();
    }
    if (pressed('KeyB') && game.phase === 'buy') deploy();

    // Firing: auto weapons hold, semi-auto fires on the edge. testFire lets
    // the debug hook shoot without a pointer lock (headless testing).
    const def = WEAPONS[game.loadout.current];
    const firing = (input.state.firing && input.state.locked || game.testFire) && game.phase === 'playing' && !game.dead;
    const wantFire = def.auto ? firing : firing && !game.loadout.triggerHeld;
    if (wantFire) playerShoot();
    game.loadout.triggerHeld = firing;

    accumulator += dt;
    let steps = 0;
    // Up to 12 fixed steps per frame: a slow machine (or a headless
    // renderer) still keeps simulation time close to real time instead of
    // falling further behind every frame.
    while (accumulator >= FIXED_STEP && steps < 12) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 12) accumulator = 0;

    // Crosshair gap follows the current spread.
    if (game.phase === 'playing') {
      const spread = currentSpread(def, player.groundSpeed(), player.state.crouched, game.ads, !player.state.onGround, game.loadout.sprayIndex === 0);
      hud.setCrosshairSpread(4 + spread * 700);
    }
    syncCamera();
    world.step(dt);
  }
  renderer.render(scene, camera);
}

function switchWeapon(key) {
  const loadout = game.loadout;
  if (loadout.current === key) return;
  loadout.current = key;
  loadout.sprayIndex = 0;
  const gun = loadout.guns[key];
  hud.setAmmo(gun.mag, gun.reserve, gun.reloading > 0);
  audio.reload();
}

// --- Pointer lock / overlays --------------------------------------------------------
function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    if (game.phase === 'playing') hud.hideOverlay();
  } else if (game.phase === 'playing' && !game.dead) {
    hud.showOverlay('paused', 'Paused', 'Click to resume. Your squad holds the yard.', 'Resume');
  }
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (game.phase === 'menu' || game.phase === 'matchEnd') {
    startMatch();
    return;
  }
  if (game.phase === 'roundEnd') return;
  if (game.phase === 'buy') {
    deploy();
    return;
  }
  input.requestLock();
});
hud.onBuy((id) => buyItem(id));
document.getElementById('deploy').addEventListener('click', deploy);

// ADS on the right mouse button; Shift while ADS steadies the aim.
document.addEventListener('mousedown', (event) => {
  if (event.button === 2) game.ads = true;
});
document.addEventListener('mouseup', (event) => {
  if (event.button === 2) game.ads = false;
});
document.addEventListener('contextmenu', (event) => event.preventDefault());

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Shot mode ----------------------------------------------------------------------
function aimAt(point) {
  const s = player.state;
  const dx = point.x - s.position.x;
  const dy = point.y - (s.position.y + s.eye);
  const dz = point.z - s.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  s.yaw = Math.atan2(-dx, -dz);
  s.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      game.frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  game.phase = 'playing';
  buildBots();
  hud.hideOverlay();
  hud.hideBuy();
  player.state.pitch = 0;
  player.state.yaw = 0;
  if (name === 'start') {
    player.teleport(-19, 0, -Math.PI / 2);
    const bot = game.bots[0];
    bot.group.position.set(-8, 0, 0);
    bot.yaw = Math.PI / 2;
    bot.group.rotation.y = Math.PI / 2;
    settle(20);
    aimAt(new THREE.Vector3(0, 1.4, 0));
    hud.showOverlay('start', 'RAILYARD 9', 'Night shift on the freight yard. Plant the spike at Site A — or wipe the Jackals out. Win the round, earn cash, buy better steel.', 'Click to play');
  } else if (name === 'play') {
    // Give the player the rifle and stage a mid-combat frame: one kill, one
    // teammate in view, one enemy holding the lane ahead.
    game.loadout.guns.rifle.owned = true;
    game.loadout.guns.rifle.mag = 30;
    game.loadout.guns.rifle.reserve = 90;
    game.loadout.current = 'rifle';
    game.money = 3400;
    player.teleport(-4, 0, -Math.PI / 2);
    const enemy = game.bots[0];
    enemy.hp = 34; // one rifle headshot (68) drops them — a clean staged kill
    enemy.group.position.set(2, 0, 0);
    enemy.yaw = Math.PI / 2;
    enemy.group.rotation.y = Math.PI / 2;
    enemy.order = 'hold';
    const mate = game.bots.find((b) => b.team === 'attacker');
    mate.group.position.set(-6, 0, -3);
    mate.yaw = -0.9;
    mate.group.rotation.y = -0.9;
    const defender2 = game.bots[1];
    defender2.group.position.set(6, 0, -9.5);
    defender2.yaw = 2.33;
    defender2.group.rotation.y = 2.33;
    settle(10);
    // Fire until the first enemy drops (spread 0 in shot mode via aimAt).
    for (let i = 0; i < 5 && enemy.alive; i += 1) {
      aimAt(new THREE.Vector3(enemy.group.position.x, 1.5, enemy.group.position.z));
      // Zero-spread shot: aim straight at the head.
      const def = WEAPONS.rifle;
      if (!takeRound(game.loadout)) break;
      camera.getWorldDirection(shootDir);
      raycaster.set(camera.position, shootDir);
      raycaster.far = def.range;
      scene.updateMatrixWorld(true);
      const hits = raycaster.intersectObjects([enemy.torso, enemy.head], false);
      if (hits.length > 0) {
        const hit = hits[0];
        const isHead = hit.object.userData.part === 'head';
        const killed = damageBot(enemy, isHead ? def.headDamage : def.damage, { events: game.events, time: game.time, lastShooter: player.state.position });
        hud.hitMarker(killed);
        if (killed) game.money += KILL_REWARD;
      }
      settle(6);
    }
    processEvents();
    // Aim at the second enemy so the frame reads as mid-combat.
    aimAt(new THREE.Vector3(defender2.group.position.x, 1.4, defender2.group.position.z));
    hud.setAmmo(game.loadout.guns.rifle.mag, game.loadout.guns.rifle.reserve, false);
    hud.setMoney(game.money);
    hud.setHealth(82, 0);
    hud.setTimer(74);
    hud.setRound(1, 0, 0);
    hud.setTeam(3, 3);
    settle(4);
  } else {
    // end: round won at the site, spike planted, overlay up. Keep the
    // defenders far from the site and holding, so none starts a defuse
    // during staging and contradicts the win.
    game.scoreA = 1;
    for (const bot of game.bots) {
      if (bot.team === 'defender') {
        bot.group.position.set(-12, 0, 10);
        bot.order = 'hold';
      }
    }
    player.teleport(13, -4, Math.PI);
    bomb.state = 'planted';
    bomb.fuse = 18;
    bomb.group.position.set(MAP.site.x, 0.05, MAP.site.z);
    bomb.group.visible = true;
    settle(10);
    hud.setBomb('SPIKE DETONATED — Site A secured', 1);
    aimAt(new THREE.Vector3(MAP.site.x, 0.4, MAP.site.z));
    hud.setRound(1, 1, 0);
    hud.setTimer(0);
    hud.setMoney(4000);
    hud.setHealth(64, 25);
    hud.showOverlay('end', 'ROUND WON', 'Spike detonated — Site A is ours. Vipers 1 · 0 Jackals. Buy up and go again.', 'Next round');
  }
  hud.setRound(game.round, game.scoreA, game.scoreD);
  syncCamera();
  paintTwiceThenReady();
}

// --- Debug hook (play-testing only) ---------------------------------------------------
window.__fps = {
  game,
  player,
  bomb,
  waypoints: WAYPOINTS,
  colliders: world.colliders,
  findRoute,
  setLook(yaw, pitch) {
    player.state.yaw = yaw;
    player.state.pitch = pitch;
    syncCamera();
  },
  fire(ms = 300) {
    game.testFire = true;
    input.setFiring(true);
    setTimeout(() => { game.testFire = false; input.setFiring(false); }, ms);
  },
  reload() { startReload(game.loadout); },
  throwGrenade,
  issueCommand,
  teleport(x, z, yaw = 0) { player.teleport(x, z, yaw); },
  deploy,
  startRound,
};

// --- Boot -------------------------------------------------------------------------------
buildBots();
hud.setAmmo(game.loadout.guns.pistol.mag, game.loadout.guns.pistol.reserve, false);
hud.setHealth(100, 0);
hud.setMoney(game.money);
hud.setRound(1, 0, 0);
hud.setTeam(3, 4);
syncCamera();
if (shot) {
  runShot(shot);
} else {
  requestAnimationFrame(frame);
}
