'use strict';

/**
 * Stat system.
 *
 * A character's final stats are built in layers:
 *
 *   base (class starting values + per-level growth)
 *     + item modifiers      (equipment; can be negative)
 *     + card modifiers       (only during a duel; increases)
 *     = resolved stats
 *
 * This file owns the list of stats and the math. Class starting values and
 * growth live in classes.js. Items and cards are not built yet, but
 * resolveStats() already accepts their modifiers so the shape is fixed:
 * a modifier is just a partial stat object, e.g. { attackMax: 5, fireDef: -2 }.
 */

const { getClass } = require('./classes');

// The four categories shown on the character sheet, in display order.
const STAT_GROUPS = [
  {
    id: 'general',
    name: 'General Basic',
    stats: [
      { id: 'strength', name: 'Strength' },
      { id: 'vitality', name: 'Vitality' },
      { id: 'intelligence', name: 'Intelligence' },
      { id: 'dexterity', name: 'Dexterity' },
    ],
  },
  {
    id: 'duel',
    name: 'Duel Basic',
    stats: [
      { id: 'attackMin', name: 'Attack Min' },
      { id: 'attackMax', name: 'Attack Max' },
      { id: 'defense', name: 'Defense' },
      { id: 'health', name: 'Health' },
      { id: 'mana', name: 'Mana' },
    ],
  },
  {
    id: 'elementalAttack',
    name: 'Elemental Attack',
    stats: [
      { id: 'fireAtkMin', name: 'Fire Attack Min' },
      { id: 'fireAtkMax', name: 'Fire Attack Max' },
      { id: 'waterAtkMin', name: 'Water Attack Min' },
      { id: 'waterAtkMax', name: 'Water Attack Max' },
      { id: 'electricAtkMin', name: 'Electric Attack Min' },
      { id: 'electricAtkMax', name: 'Electric Attack Max' },
    ],
  },
  {
    id: 'elementalDefense',
    name: 'Elemental Defense',
    stats: [
      { id: 'fireDef', name: 'Fire Defense' },
      { id: 'waterDef', name: 'Water Defense' },
      { id: 'electricDef', name: 'Electric Defense' },
    ],
  },
];

// Flat list of every stat id, e.g. ['strength', 'vitality', ...].
const STAT_IDS = STAT_GROUPS.flatMap((g) => g.stats.map((s) => s.id));

/** A stat object with every stat set to 0. */
function zeroStats() {
  return Object.fromEntries(STAT_IDS.map((id) => [id, 0]));
}

/** a + b, per stat. Missing keys count as 0. Does not mutate the inputs. */
function addStats(a, b) {
  const out = zeroStats();
  for (const id of STAT_IDS) out[id] = (a[id] || 0) + (b[id] || 0);
  return out;
}

/** Multiply every stat by n (used for per-level growth). */
function scaleStats(a, n) {
  const out = zeroStats();
  for (const id of STAT_IDS) out[id] = (a[id] || 0) * n;
  return out;
}

/**
 * A class's base stats at a given level:
 *   value = classBase + classGrowth * (level - 1)
 */
function baseStatsForClass(classId, level) {
  const cls = getClass(classId);
  if (!cls) return zeroStats();
  const lvl = Math.max(1, Math.floor(level || 1));
  return addStats(cls.base || {}, scaleStats(cls.growth || {}, lvl - 1));
}

/**
 * The character's resolved stats.
 *   { classId, level, itemMods?: partialStats[], cardMods?: partialStats[] }
 * Negative results are clamped to 0.
 */
function resolveStats({ classId, level, itemMods = [], cardMods = [] }) {
  let total = baseStatsForClass(classId, level);
  for (const mod of [...itemMods, ...cardMods]) total = addStats(total, mod);
  for (const id of STAT_IDS) if (total[id] < 0) total[id] = 0;
  return total;
}

module.exports = {
  STAT_GROUPS,
  STAT_IDS,
  zeroStats,
  addStats,
  scaleStats,
  baseStatsForClass,
  resolveStats,
};
