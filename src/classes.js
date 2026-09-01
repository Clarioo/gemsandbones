'use strict';

/**
 * The playable classes. Single source of truth for both the server and the
 * class-picker / character sheet in the browser.
 *
 * Stats use the DERIVED model (see stats.js):
 *   base / growth       - the four PRIMARY stats (strength, vitality,
 *                         intelligence, dexterity) at level 1, and per level.
 *   elementalAffinity   - multiplier on derived elemental attack
 *                         (0 = no elemental attack at all).
 *   statMods            - flat per-class tuning added to any derived stat,
 *                         e.g. give the Protector extra defense / elemental def.
 *
 * !!! All of these numbers are a STARTING POINT for balancing. Tune freely --
 * nothing else in the code hard-codes class values.
 *
 * `growth` was halved on 2026-09-01: because attack, defense AND health all
 * scale off the primaries, a level gap compounded hard -- a level 1 had ~2%
 * odds against a level 3. Levels still matter, just not as a wall.
 */
const CLASSES = [
  {
    id: 'fencer',
    name: 'Fencer',
    blurb: 'Fast and precise. Trades blows up close and punishes any opening.',
    base: { strength: 14, vitality: 10, intelligence: 6, dexterity: 16 },
    growth: { strength: 1.5, vitality: 1, intelligence: 0.5, dexterity: 1.5 },
    elementalAffinity: 0,
    statMods: { attackMin: 2, attackMax: 4 },
  },
  {
    id: 'protector',
    name: 'Protector',
    blurb: 'Stands at the front. Soaks damage and keeps the line from breaking.',
    base: { strength: 12, vitality: 18, intelligence: 5, dexterity: 8 },
    growth: { strength: 1, vitality: 2, intelligence: 0.5, dexterity: 0.5 },
    elementalAffinity: 0,
    statMods: {
      defense: 8, health: 30,
      fireDef: 6, waterDef: 6, electricDef: 6,
    },
  },
  {
    id: 'mage',
    name: 'Mage',
    blurb: 'Bends the rules with spells. High impact, but fragile.',
    base: { strength: 6, vitality: 9, intelligence: 20, dexterity: 9 },
    growth: { strength: 0.5, vitality: 1, intelligence: 2, dexterity: 0.5 },
    elementalAffinity: 1.0,
    statMods: { mana: 20 },
  },
  {
    id: 'hunter',
    name: 'Hunter',
    blurb: 'Strikes from range and controls the field with traps and beasts.',
    base: { strength: 11, vitality: 11, intelligence: 9, dexterity: 15 },
    growth: { strength: 1, vitality: 1, intelligence: 1, dexterity: 1.5 },
    elementalAffinity: 0.4,
    statMods: {
      attackMax: 3,
      fireDef: 2, waterDef: 2, electricDef: 2,
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
