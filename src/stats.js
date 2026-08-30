'use strict';

/**
 * Stat system (derived model).
 *
 * The four GENERAL BASIC stats are "primary" -- a class sets them at level 1
 * and they grow per level (numbers in classes.js).
 *
 *   Strength      physical attack, a little health
 *   Vitality      health, defense, elemental defense
 *   Intelligence  mana, elemental attack
 *   Dexterity     attack finesse, defense
 *
 * Everything else (Duel Basic + Elemental) is DERIVED from the primaries by
 * the formulas below, plus per-class flat tuning (class.statMods) and a
 * per-class elemental affinity multiplier (class.elementalAffinity).
 *
 * Final resolve order:
 *   primaries (class + level)
 *     + primary modifiers from items/cards      e.g. { strength: 2 }
 *   -> derive Duel + Elemental stats
 *     + non-primary modifiers from items/cards  e.g. { attackMax: 5, fireDef: -2 }
 *   -> round, clamp >= 0, keep max >= min
 *
 * A modifier is just a partial stat object. Items and cards are not built yet;
 * resolveStats() already accepts their modifiers so the shape is fixed.
 *
 * !!! The formula weights and class numbers are a STARTING POINT. Tune freely.
 */

const { getClass } = require('./classes');

const STAT_GROUPS = [
  {
    id: 'general',
    name: 'General Basic',
    primary: true,
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

const STAT_IDS = STAT_GROUPS.flatMap((g) => g.stats.map((s) => s.id));
const PRIMARY_IDS = ['strength', 'vitality', 'intelligence', 'dexterity'];

// ---------------------------------------------------------------------------
// Formula weights: derived = flat + Σ(primary * weight)
// ---------------------------------------------------------------------------
const DERIVED_FORMULAS = {
  health: { flat: 40, vitality: 6, strength: 1 },
  mana: { flat: 10, intelligence: 4, vitality: 0.5 },
  defense: { flat: 2, vitality: 0.6, dexterity: 0.4 },
  attackMin: { flat: 2, strength: 0.7, dexterity: 0.3 },
  attackMax: { flat: 4, strength: 1.1, dexterity: 0.6 },
};

// Elemental attack per element, then multiplied by the class's affinity.
const ELEMENTAL_ATTACK = {
  min: { intelligence: 0.6 },
  max: { intelligence: 1.0 },
};
const ELEMENTAL_DEFENSE = { flat: 1, vitality: 0.2 };

// ---------------------------------------------------------------------------

function zeroStats() {
  return Object.fromEntries(STAT_IDS.map((id) => [id, 0]));
}

function weightedSum(primaries, weights) {
  let v = weights.flat || 0;
  for (const p of PRIMARY_IDS) v += (primaries[p] || 0) * (weights[p] || 0);
  return v;
}

/** The four primary stats for a class at a given level. */
function primaryStatsForClass(classId, level) {
  const cls = getClass(classId);
  const lvl = Math.max(1, Math.floor(level || 1));
  const out = {};
  for (const p of PRIMARY_IDS) {
    const base = (cls && cls.base && cls.base[p]) || 0;
    const growth = (cls && cls.growth && cls.growth[p]) || 0;
    out[p] = base + growth * (lvl - 1);
  }
  return out;
}

/** Derive Duel + Elemental stats from primaries (pre-rounding). */
function deriveStats(primaries, cls) {
  const affinity =
    cls && typeof cls.elementalAffinity === 'number' ? cls.elementalAffinity : 0;
  const mods = (cls && cls.statMods) || {};

  const out = zeroStats();

  for (const [statId, weights] of Object.entries(DERIVED_FORMULAS)) {
    out[statId] = weightedSum(primaries, weights);
  }

  const eAtkMin = weightedSum(primaries, ELEMENTAL_ATTACK.min) * affinity;
  const eAtkMax = weightedSum(primaries, ELEMENTAL_ATTACK.max) * affinity;
  out.fireAtkMin = out.waterAtkMin = out.electricAtkMin = eAtkMin;
  out.fireAtkMax = out.waterAtkMax = out.electricAtkMax = eAtkMax;

  const eDef = weightedSum(primaries, ELEMENTAL_DEFENSE);
  out.fireDef = out.waterDef = out.electricDef = eDef;

  for (const id of STAT_IDS) out[id] += mods[id] || 0;
  return out;
}

/** Round, clamp to >= 0, and keep every "max" >= its "min". */
function finalize(stats) {
  const out = {};
  for (const id of STAT_IDS) out[id] = Math.max(0, Math.round(stats[id] || 0));

  if (out.attackMax < out.attackMin) out.attackMax = out.attackMin;
  for (const el of ['fire', 'water', 'electric']) {
    if (out[`${el}AtkMax`] < out[`${el}AtkMin`]) {
      out[`${el}AtkMax`] = out[`${el}AtkMin`];
    }
  }
  return out;
}

/**
 * The character's resolved stats.
 *   { classId, level, itemMods?: partialStats[], cardMods?: partialStats[] }
 */
function resolveStats({ classId, level, itemMods = [], cardMods = [] }) {
  const cls = getClass(classId);
  const mods = [...itemMods, ...cardMods];

  // primaries + primary-affecting modifiers
  const primaries = primaryStatsForClass(classId, level);
  for (const m of mods) {
    for (const p of PRIMARY_IDS) primaries[p] += m[p] || 0;
  }

  // derive, then assemble (primaries win over the 0s in derived)
  const derived = deriveStats(primaries, cls);
  const total = { ...zeroStats(), ...derived };
  for (const p of PRIMARY_IDS) total[p] = primaries[p];

  // non-primary modifiers
  for (const m of mods) {
    for (const id of STAT_IDS) {
      if (PRIMARY_IDS.includes(id)) continue;
      total[id] += m[id] || 0;
    }
  }

  return finalize(total);
}

module.exports = {
  STAT_GROUPS,
  STAT_IDS,
  PRIMARY_IDS,
  zeroStats,
  primaryStatsForClass,
  resolveStats,
};
