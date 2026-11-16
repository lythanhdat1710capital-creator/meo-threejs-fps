// Economy: money earned each round, spent in the buy menu between rounds.
// Prices mirror the stakes: a rifle costs most of a round win, a grenade is
// a rounding error, armour is the sensible middle buy.
import { WEAPONS, GRENADE, ATTACHMENTS } from './weapons.js';

export const START_MONEY = 1000;
export const WIN_REWARD = 3000;
export const LOSS_REWARD = 1600;
export const KILL_REWARD = 300;
export const PLANT_REWARD = 300;

export const BUY_ITEMS = [
  { key: '1', id: 'rifle', label: 'VK-47 Rifle', price: WEAPONS.rifle.price, note: '30-round auto rifle' },
  { key: '2', id: 'sniper', label: 'Longbow DMR', price: WEAPONS.sniper.price, note: 'High damage, 5-round mag' },
  { key: '3', id: 'grenade', label: 'Frag Grenade', price: GRENADE.price, note: 'Throw with G' },
  { key: '4', id: 'armor', label: 'Body Armour', price: 500, note: 'Absorbs half of damage' },
  { key: '5', id: 'ammo', label: 'Refill Ammo', price: 300, note: 'Full reserve for current gun' },
  { key: '6', id: 'compensator', label: 'Compensator', price: ATTACHMENTS.compensator.price, note: ATTACHMENTS.compensator.note },
  { key: '7', id: 'vgrip', label: 'Vertical Grip', price: ATTACHMENTS.vgrip.price, note: ATTACHMENTS.vgrip.note },
  { key: '8', id: 'agrip', label: 'Angled Grip', price: ATTACHMENTS.agrip.price, note: ATTACHMENTS.agrip.note },
];

export function createEconomy() {
  return { money: START_MONEY };
}
