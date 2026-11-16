// Weapons: the armoury. Two guns plus a frag grenade. Each gun is a data
// table (damage, rate, spread, recoil) plus a small state machine for its
// magazine, reserve and reload — no per-frame allocation.
// Recoil: a FIXED spray table per weapon, the same every time — learnable,
// like Counter-Strike. Each entry is the per-shot kick [pitch, yaw] in
// radians, added to the aim while firing. The rifle climbs straight up for
// the first 9 shots (pull down to counter), sweeps left for shots 10-15,
// whips right for 16-22 and zigzags after that. Tap fire stays accurate.
const RIFLE_SPRAY = [
  [0.011, 0.001], [0.011, -0.001], [0.011, 0.002], [0.011, 0], [0.011, -0.002],
  [0.011, 0.001], [0.011, 0], [0.012, -0.001], [0.012, 0.002],
  [0.008, -0.008], [0.008, -0.008], [0.008, -0.007], [0.008, -0.008], [0.008, -0.007], [0.008, -0.008],
  [0.007, 0.01], [0.007, 0.01], [0.007, 0.009], [0.007, 0.01], [0.007, 0.009], [0.007, 0.01], [0.007, 0.009],
  [0.005, -0.008], [0.005, 0.008], [0.005, -0.008], [0.005, 0.008], [0.005, -0.007], [0.005, 0.007], [0.005, -0.008], [0.005, 0.007],
];
const PISTOL_SPRAY = [
  [0.008, 0.001], [0.008, -0.002], [0.008, 0.002], [0.008, -0.001],
  [0.008, 0.002], [0.008, -0.002], [0.008, 0.001], [0.008, -0.001],
  [0.008, 0.002], [0.008, -0.002], [0.008, 0.001], [0.008, -0.001],
];

// Attachments (PUBG-style), bought in the buy menu. They scale the spray
// table: the compensator tames vertical climb and sway, the vertical grip
// tames climb further, the angled grip tames sway and speeds up ADS.
export const ATTACHMENTS = {
  compensator: { name: 'Compensator', price: 400, vert: 0.75, horiz: 0.85, note: '-25% climb, -15% sway' },
  vgrip: { name: 'Vertical Grip', price: 300, vert: 0.8, horiz: 1, note: '-20% climb' },
  agrip: { name: 'Angled Grip', price: 250, vert: 1, horiz: 0.8, adsFaster: true, note: '-20% sway, faster ADS' },
};

// One shot's spray kick, scaled by owned attachments. Index 0 is the first
// shot of a spray; the table's last entry repeats past its length.
export function sprayKick(def, index, attachments) {
  const table = def.spray;
  const entry = table[Math.min(index, table.length - 1)];
  let vert = 1;
  let horiz = 1;
  for (const key of Object.keys(attachments)) {
    if (attachments[key]) {
      vert *= ATTACHMENTS[key].vert;
      horiz *= ATTACHMENTS[key].horiz;
    }
  }
  return { pitch: entry[0] * vert, yaw: entry[1] * horiz };
}

export const WEAPONS = {
  rifle: {
    name: 'VK-47 Rifle',
    price: 2500,
    damage: 34,
    headDamage: 68,
    interval: 0.1,          // 600 rpm
    auto: true,
    magSize: 30,
    reserveMax: 90,
    reloadTime: 2.1,
    spread: 0.011,          // radians at rest, standing still
    firstShotSpread: 0.003, // tap fire: the first shot is near-perfect
    moveSpread: 0.030,      // added at full run
    crouchSpread: 0.006,
    adsSpread: 0.004,
    recoil: 0.011,
    spray: RIFLE_SPRAY,
    range: 90,
  },
  pistol: {
    name: 'P9 Sidearm',
    price: 0,
    damage: 26,
    headDamage: 52,
    interval: 0.16,
    auto: false,
    magSize: 12,
    reserveMax: 36,
    reloadTime: 1.3,
    spread: 0.014,
    firstShotSpread: 0.004,
    moveSpread: 0.026,
    crouchSpread: 0.008,
    adsSpread: 0.006,
    recoil: 0.008,
    spray: PISTOL_SPRAY,
    range: 60,
  },
  sniper: {
    name: 'Longbow DMR',
    price: 3500,
    damage: 88,
    headDamage: 220,
    interval: 1.1,
    auto: false,
    magSize: 5,
    reserveMax: 15,
    reloadTime: 2.8,
    spread: 0.002,
    firstShotSpread: 0.0005,
    moveSpread: 0.05,
    crouchSpread: 0.001,
    adsSpread: 0.0005,
    recoil: 0.035,
    spray: [[0.05, 0]],
    range: 120,
  },
};

export const GRENADE = { name: 'Frag Grenade', price: 300, fuse: 1.8, radius: 6.5, damage: 110 };

export function createLoadout() {
  return {
    current: 'pistol',
    guns: {
      pistol: { mag: 12, reserve: 36, reloading: 0 },
      rifle: { mag: 0, reserve: 0, reloading: 0, owned: false },
      sniper: { mag: 0, reserve: 0, reloading: 0, owned: false },
    },
    grenades: 0,
    armor: 0,               // absorbs half of incoming damage, up to 50
    attachments: {},        // compensator / vgrip / agrip, bought in the buy menu
    sprayIndex: 0,          // shot count inside the current spray
    sprayIdle: 0,           // time since the last shot; resets the spray
    cooldown: 0,            // time until the next shot may fire
    triggerHeld: false,     // semi-auto edge detection
  };
}

// Current spread in radians: rest < crouch < ADS < moving < sprinting.
// Spread is a separate layer from recoil: it is the random cone, recoil is
// the deterministic kick. The first shot of a spray is near-perfect when
// standing still — tap fire works at long range.
export function currentSpread(def, speed, crouched, ads, airborne, firstShot) {
  let spread = def.spread;
  if (firstShot) spread = def.firstShotSpread;
  if (crouched) spread = Math.min(spread, def.crouchSpread);
  if (ads) spread = Math.min(spread, def.adsSpread);
  const move = Math.min(1, speed / 4.6);
  spread += def.moveSpread * move;
  if (airborne) spread += 0.02;
  return spread;
}

export function takeRound(loadout) {
  const gun = loadout.guns[loadout.current];
  if (gun.reloading > 0 || loadout.cooldown > 0) return false;
  if (gun.mag <= 0) return false;
  gun.mag -= 1;
  loadout.cooldown = WEAPONS[loadout.current].interval;
  return true;
}

export function startReload(loadout) {
  const gun = loadout.guns[loadout.current];
  const def = WEAPONS[loadout.current];
  if (gun.reloading > 0 || gun.mag >= def.magSize || gun.reserve <= 0) return false;
  gun.reloading = def.reloadTime;
  return true;
}

export function stepLoadout(loadout, dt) {
  if (loadout.cooldown > 0) loadout.cooldown -= dt;
  // The spray resets shortly after fire stops — a new spray starts fresh.
  if (loadout.sprayIndex > 0) {
    loadout.sprayIdle += dt;
    if (loadout.sprayIdle > 0.5) loadout.sprayIndex = 0;
  }
  for (const key of Object.keys(loadout.guns)) {
    const gun = loadout.guns[key];
    if (gun.reloading > 0) {
      gun.reloading -= dt;
      if (gun.reloading <= 0) {
        const def = WEAPONS[key];
        const need = def.magSize - gun.mag;
        const take = Math.min(need, gun.reserve);
        gun.mag += take;
        gun.reserve -= take;
        gun.reloading = 0;
      }
    }
  }
}

export function buyWeapon(loadout, key, money) {
  const def = WEAPONS[key];
  if (!def || def.price === 0 || money < def.price) return money;
  const gun = loadout.guns[key];
  if (gun.owned) return money;
  gun.owned = true;
  gun.mag = def.magSize;
  gun.reserve = def.reserveMax;
  loadout.current = key;
  return money - def.price;
}

export function buyAmmo(loadout, money) {
  const gun = loadout.guns[loadout.current];
  const def = WEAPONS[loadout.current];
  const cost = 300;
  if (money < cost || gun.reserve >= def.reserveMax) return money;
  gun.reserve = def.reserveMax;
  return money - cost;
}
