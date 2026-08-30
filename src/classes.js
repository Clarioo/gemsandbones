'use strict';

/**
 * The playable classes. Single source of truth for both the server and the
 * class-picker / character sheet in the browser.
 *
 * Each class has:
 *   base   - stat values at level 1
 *   growth - amount added to each stat per level after level 1
 *            (resolved value = base + growth * (level - 1); see stats.js)
 *
 * Only non-zero stats need to be listed; everything else defaults to 0.
 *
 * !!! These numbers are a STARTING POINT for balancing. Tune them freely --
 * nothing else in the code hard-codes class values.
 */
const CLASSES = [
  {
    id: 'fencer',
    name: 'Fencer',
    blurb: 'Fast and precise. Trades blows up close and punishes any opening.',
    base: {
      strength: 12, vitality: 8, intelligence: 5, dexterity: 14,
      attackMin: 8, attackMax: 12, defense: 6, health: 90, mana: 20,
      fireDef: 2, waterDef: 2, electricDef: 2,
    },
    growth: {
      strength: 2, vitality: 1, intelligence: 1, dexterity: 3,
      attackMin: 2, attackMax: 3, defense: 1, health: 12, mana: 3,
      fireDef: 1, waterDef: 1, electricDef: 1,
    },
  },
  {
    id: 'protector',
    name: 'Protector',
    blurb: 'Stands at the front. Soaks damage and keeps the line from breaking.',
    base: {
      strength: 10, vitality: 15, intelligence: 4, dexterity: 6,
      attackMin: 5, attackMax: 8, defense: 14, health: 130, mana: 15,
      fireDef: 8, waterDef: 8, electricDef: 8,
    },
    growth: {
      strength: 2, vitality: 3, intelligence: 1, dexterity: 1,
      attackMin: 1, attackMax: 2, defense: 3, health: 20, mana: 2,
      fireDef: 2, waterDef: 2, electricDef: 2,
    },
  },
  {
    id: 'mage',
    name: 'Mage',
    blurb: 'Bends the rules with spells. High impact, but fragile.',
    base: {
      strength: 4, vitality: 6, intelligence: 16, dexterity: 8,
      attackMin: 3, attackMax: 6, defense: 4, health: 70, mana: 60,
      fireAtkMin: 6, fireAtkMax: 10,
      waterAtkMin: 6, waterAtkMax: 10,
      electricAtkMin: 6, electricAtkMax: 10,
      fireDef: 3, waterDef: 3, electricDef: 3,
    },
    growth: {
      strength: 1, vitality: 1, intelligence: 3, dexterity: 1,
      attackMin: 1, attackMax: 1, defense: 1, health: 8, mana: 10,
      fireAtkMin: 2, fireAtkMax: 3,
      waterAtkMin: 2, waterAtkMax: 3,
      electricAtkMin: 2, electricAtkMax: 3,
      fireDef: 1, waterDef: 1, electricDef: 1,
    },
  },
  {
    id: 'hunter',
    name: 'Hunter',
    blurb: 'Strikes from range and controls the field with traps and beasts.',
    base: {
      strength: 9, vitality: 8, intelligence: 7, dexterity: 13,
      attackMin: 7, attackMax: 11, defense: 6, health: 95, mana: 30,
      fireAtkMin: 2, fireAtkMax: 4,
      waterAtkMin: 2, waterAtkMax: 4,
      electricAtkMin: 2, electricAtkMax: 4,
      fireDef: 4, waterDef: 4, electricDef: 4,
    },
    growth: {
      strength: 2, vitality: 2, intelligence: 1, dexterity: 3,
      attackMin: 2, attackMax: 2, defense: 1, health: 13, mana: 5,
      fireAtkMin: 1, fireAtkMax: 1,
      waterAtkMin: 1, waterAtkMax: 1,
      electricAtkMin: 1, electricAtkMax: 1,
      fireDef: 1, waterDef: 1, electricDef: 1,
    },
  },
];

const CLASS_IDS = CLASSES.map((c) => c.id);

function isValidClassId(id) {
  return CLASS_IDS.includes(id);
}

function getClass(id) {
  return CLASSES.find((c) => c.id === id) || null;
}

module.exports = { CLASSES, CLASS_IDS, isValidClassId, getClass };
