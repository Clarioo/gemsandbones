'use strict';

/**
 * Equipment: item templates, rolled item instances, and the stat math that
 * feeds resolveStats().
 *
 * ---------------------------------------------------------------------------
 * TEMPLATE vs INSTANCE
 * ---------------------------------------------------------------------------
 * A TEMPLATE (in ITEM_TEMPLATES) is the design of an item: its slot, which
 * classes may wear it, its requirements, and a RANGE for each stat it can
 * grant (e.g. Long Sword: attackMin 3-6, attackMax 6-9).
 *
 * An INSTANCE (what a player owns, made by rollItem) has concrete rolled
 * numbers, 1-3 random bonuses, a uid, and durability. Display-relevant
 * template fields (name, slot, classes, requirements) are copied onto the
 * instance so the client never needs the template catalog.
 *
 *   instance = {
 *     uid, templateId, name, slot, classes, requirements,
 *     stats:   { <statId>: number },        // rolled from the template ranges
 *     bonuses: [ { stat, amount } ],         // 1-3, rolled from BONUS_POOL
 *     durability: { current, max },
 *   }
 *
 * Bonus count: 65% one bonus, 30% two, 5% three.
 *
 * All numbers here are a STARTING POINT -- tune freely.
 */

const crypto = require('crypto');

const SLOTS = ['weapon', 'helmet', 'armor', 'boots', 'ring'];

const DURABILITY_MAX = 100;
const DURABILITY_PER_DUEL = 1;
const BAG_MAX = 30;

// Bonus count probabilities (cumulative): <0.65 -> 1, <0.95 -> 2, else 3.
const BONUS_ONE = 0.65;
const BONUS_TWO = 0.95;

/** Stats a random bonus can roll, with the inclusive amount range for each. */
const BONUS_POOL = [
  { stat: 'attackMin', range: [1, 4] },
  { stat: 'attackMax', range: [1, 5] },
  { stat: 'defense', range: [1, 5] },
  { stat: 'health', range: [4, 14] },
  { stat: 'mana', range: [2, 10] },
  { stat: 'strength', range: [1, 3] },
  { stat: 'vitality', range: [1, 3] },
  { stat: 'intelligence', range: [1, 3] },
  { stat: 'dexterity', range: [1, 3] },
  { stat: 'fireDef', range: [1, 4] },
  { stat: 'waterDef', range: [1, 4] },
  { stat: 'electricDef', range: [1, 4] },
];

// `classes: 'all'` = every class may wear it, else an array of class ids.
const ITEM_TEMPLATES = [
  // ---- Weapons ----
  { id: 'long-sword', name: 'Long Sword', slot: 'weapon', classes: ['fencer', 'protector'],
    requirements: { level: 1 }, statRanges: { attackMin: [3, 6], attackMax: [6, 9] } },
  { id: 'iron-dagger', name: 'Iron Dagger', slot: 'weapon', classes: ['fencer', 'hunter'],
    requirements: { level: 1 }, statRanges: { attackMin: [2, 4], attackMax: [4, 7], dexterity: [1, 2] } },
  { id: 'oak-staff', name: 'Oak Staff', slot: 'weapon', classes: ['mage'],
    requirements: { level: 1 }, statRanges: { fireAtkMin: [2, 5], fireAtkMax: [5, 9], mana: [4, 10] } },
  { id: 'hunting-bow', name: 'Hunting Bow', slot: 'weapon', classes: ['hunter'],
    requirements: { level: 1 }, statRanges: { attackMin: [3, 5], attackMax: [7, 11] } },
  { id: 'war-maul', name: 'War Maul', slot: 'weapon', classes: ['protector'],
    requirements: { level: 3 }, statRanges: { attackMin: [5, 8], attackMax: [9, 14] } },

  // ---- Helmets ----
  { id: 'leather-cap', name: 'Leather Cap', slot: 'helmet', classes: 'all',
    requirements: { level: 1 }, statRanges: { defense: [1, 3], health: [3, 8] } },
  { id: 'iron-helm', name: 'Iron Helm', slot: 'helmet', classes: ['fencer', 'protector', 'hunter'],
    requirements: { level: 2 }, statRanges: { defense: [2, 5], health: [5, 12] } },
  { id: 'circlet-of-focus', name: 'Circlet of Focus', slot: 'helmet', classes: ['mage'],
    requirements: { level: 1 }, statRanges: { mana: [6, 14], intelligence: [1, 3] } },

  // ---- Armor ----
  { id: 'padded-vest', name: 'Padded Vest', slot: 'armor', classes: 'all',
    requirements: { level: 1 }, statRanges: { defense: [2, 5], health: [6, 14] } },
  { id: 'plate-mail', name: 'Plate Mail', slot: 'armor', classes: ['protector'],
    requirements: { level: 3 }, statRanges: { defense: [5, 10], health: [12, 24] } },
  { id: 'silk-robe', name: 'Silk Robe', slot: 'armor', classes: ['mage'],
    requirements: { level: 1 }, statRanges: { mana: [8, 18], fireDef: [1, 3], waterDef: [1, 3], electricDef: [1, 3] } },
  { id: 'ranger-leathers', name: 'Ranger Leathers', slot: 'armor', classes: ['fencer', 'hunter'],
    requirements: { level: 2 }, statRanges: { defense: [3, 6], dexterity: [1, 3], health: [6, 12] } },

  // ---- Boots ----
  { id: 'worn-boots', name: 'Worn Boots', slot: 'boots', classes: 'all',
    requirements: { level: 1 }, statRanges: { defense: [1, 2], dexterity: [1, 2] } },
  { id: 'swift-treads', name: 'Swift Treads', slot: 'boots', classes: ['fencer', 'hunter', 'mage'],
    requirements: { level: 2 }, statRanges: { dexterity: [2, 4], defense: [1, 3] } },
  { id: 'iron-greaves', name: 'Iron Greaves', slot: 'boots', classes: ['protector', 'fencer'],
    requirements: { level: 2 }, statRanges: { defense: [3, 6], health: [4, 10] } },

  // ---- Rings ----
  { id: 'copper-ring', name: 'Copper Ring', slot: 'ring', classes: 'all',
    requirements: { level: 1 }, statRanges: { health: [4, 10] } },
  { id: 'ring-of-embers', name: 'Ring of Embers', slot: 'ring', classes: 'all',
    requirements: { level: 2 }, statRanges: { fireAtkMin: [1, 3], fireAtkMax: [2, 5], fireDef: [1, 3] } },
  { id: 'signet-of-vigor', name: 'Signet of Vigor', slot: 'ring', classes: 'all',
    requirements: { level: 3 }, statRanges: { strength: [1, 2], vitality: [1, 2] } },
];

const TEMPLATE_BY_ID = new Map(ITEM_TEMPLATES.map((t) => [t.id, t]));
const getTemplate = (id) => TEMPLATE_BY_ID.get(id) || null;

function rollInt(lo, hi, rng) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** Keep every "max" stat >= its "min" partner after independent rolls. */
function keepMinMaxOrder(stats) {
  const pairs = [['attackMin', 'attackMax'], ['fireAtkMin', 'fireAtkMax'],
    ['waterAtkMin', 'waterAtkMax'], ['electricAtkMin', 'electricAtkMax']];
  for (const [mn, mx] of pairs) {
    if (stats[mn] != null && stats[mx] != null && stats[mx] < stats[mn]) {
      stats[mx] = stats[mn];
    }
  }
  return stats;
}

/** Roll 1-3 distinct bonuses from BONUS_POOL. */
function rollBonuses(rng = Math.random) {
  const r = rng();
  const count = r < BONUS_ONE ? 1 : r < BONUS_TWO ? 2 : 3;
  const pool = BONUS_POOL.slice();
  const out = [];
  for (let i = 0; i < count && pool.length; i++) {
    const [entry] = pool.splice(Math.floor(rng() * pool.length), 1);
    out.push({ stat: entry.stat, amount: rollInt(entry.range[0], entry.range[1], rng) });
  }
  return out;
}

/** Make a concrete item instance from a template. */
function rollItem(template, rng = Math.random) {
  const stats = {};
  for (const [stat, [lo, hi]] of Object.entries(template.statRanges)) {
    stats[stat] = rollInt(lo, hi, rng);
  }
  keepMinMaxOrder(stats);
  return {
    uid: crypto.randomUUID(),
    templateId: template.id,
    name: template.name,
    slot: template.slot,
    classes: template.classes,
    requirements: { ...template.requirements },
    stats,
    bonuses: rollBonuses(rng),
    durability: { current: DURABILITY_MAX, max: DURABILITY_MAX },
  };
}

/** Roll a random item from any template (used by the dev "Generate item"). */
function rollRandomItem(rng = Math.random) {
  return rollItem(ITEM_TEMPLATES[Math.floor(rng() * ITEM_TEMPLATES.length)], rng);
}

/**
 * A full, level-appropriate equipped set for an AI enemy: one random item per
 * slot the class can use and the level allows. Returns the itemMods array for
 * resolveStats() -- bots are throwaway, so no bag / durability / uid tracking.
 */
function rollEnemyLoadout(classId, level, rng = Math.random) {
  const mods = [];
  for (const slot of SLOTS) {
    const options = ITEM_TEMPLATES.filter(
      (t) =>
        t.slot === slot &&
        itemUsableByClass(t, classId) &&
        ((t.requirements && t.requirements.level) || 1) <= (level || 1),
    );
    if (!options.length) continue;
    const template = options[Math.floor(rng() * options.length)];
    mods.push(itemStatTotals(rollItem(template, rng)));
  }
  return mods;
}

function itemUsableByClass(item, classId) {
  if (!item) return false;
  return item.classes === 'all' || (Array.isArray(item.classes) && item.classes.includes(classId));
}

/** Can this character equip this item right now? { ok } / { ok:false, error }. */
function canEquip(character, item) {
  if (!item) return { ok: false, error: 'no_item' };
  if (!character || !character.classId) return { ok: false, error: 'no_class' };
  if (!itemUsableByClass(item, character.classId)) return { ok: false, error: 'wrong_class' };
  const needLevel = (item.requirements && item.requirements.level) || 1;
  if ((character.level || 1) < needLevel) return { ok: false, error: 'level_too_low' };
  return { ok: true };
}

const isBroken = (item) =>
  !!(item && item.durability && item.durability.current <= 0);

/** Base stats + bonuses merged into one partial-stat object. */
function itemStatTotals(item) {
  const out = { ...((item && item.stats) || {}) };
  for (const b of (item && item.bonuses) || []) {
    out[b.stat] = (out[b.stat] || 0) + b.amount;
  }
  return out;
}

/**
 * The itemMods array to hand resolveStats(): one partial-stat object per
 * equipped item that is still valid for the class and not broken.
 */
function equippedItemMods(character) {
  if (!character) return [];
  const bag = Array.isArray(character.bag) ? character.bag : [];
  const equipment = (character.equipment && typeof character.equipment === 'object')
    ? character.equipment : {};
  const mods = [];
  for (const slot of SLOTS) {
    const uid = equipment[slot];
    if (!uid) continue;
    const item = bag.find((i) => i.uid === uid);
    if (!item || isBroken(item)) continue;
    if (!itemUsableByClass(item, character.classId)) continue; // stale after a class change
    mods.push(itemStatTotals(item));
  }
  return mods;
}

module.exports = {
  SLOTS,
  BAG_MAX,
  DURABILITY_MAX,
  DURABILITY_PER_DUEL,
  BONUS_POOL,
  ITEM_TEMPLATES,
  getTemplate,
  rollItem,
  rollRandomItem,
  rollEnemyLoadout,
  rollBonuses,
  itemUsableByClass,
  canEquip,
  isBroken,
  itemStatTotals,
  equippedItemMods,
};
