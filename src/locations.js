'use strict';

/**
 * The world map: places a player can travel to and fight in.
 *
 * For now there is a single low-level location with no entry requirements.
 * A player can enter and leave at any time; while inside, they can search for
 * an AI enemy, which starts a bot duel (see locationHub.js + duelHub.js).
 *
 * Each location:
 *   id            stable key used by the client and the socket events
 *   name / blurb  display text
 *   enemyLevels   { min, max } inclusive — the level an AI enemy here rolls at
 *   enemies       themed opponent pool: { name, classId }; one is picked per
 *                 search and given a rolled level
 *   requirements  reserved for later (level gates, quest flags, …); always []
 *
 * All numbers and flavour here are a STARTING POINT — tune freely, nothing
 * else in the code hard-codes location values.
 */

const { isValidClassId } = require('./classes');

const LOCATIONS = [
  {
    id: 'whisperwood-fringe',
    name: 'Whisperwood Fringe',
    blurb:
      'A thin belt of forest at the edge of the valley. Only stragglers and ' +
      'small-time raiders wander this far out — a safe place to test a deck.',
    enemyLevels: { min: 1, max: 5 },
    requirements: [],
    enemies: [
      { name: 'Bandit Scout', classId: 'fencer' },
      { name: 'Roadside Bruiser', classId: 'protector' },
      { name: 'Hedge Conjurer', classId: 'mage' },
      { name: 'Snare Trapper', classId: 'hunter' },
      { name: 'Lost Sellsword', classId: 'fencer' },
    ],
  },
];

const LOCATIONS_BY_ID = new Map(LOCATIONS.map((l) => [l.id, l]));

function getLocation(id) {
  return LOCATIONS_BY_ID.get(id) || null;
}

/** Public shape for the client (drops the internal enemy pool). */
function toPublicLocation(loc) {
  return {
    id: loc.id,
    name: loc.name,
    blurb: loc.blurb,
    enemyLevels: { ...loc.enemyLevels },
    requirements: [...loc.requirements],
  };
}

function randInt(lo, hi, rng = Math.random) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/**
 * Roll a concrete AI enemy for a location: a random opponent from its pool at
 * a random level within the location's range. Returns { classId, level, name }.
 */
function rollEnemy(loc, rng = Math.random) {
  const pool = loc.enemies.filter((e) => isValidClassId(e.classId));
  const pick = pool[Math.floor(rng() * pool.length)];
  const { min, max } = loc.enemyLevels;
  const level = randInt(min, max, rng);
  return { classId: pick.classId, level, name: `${pick.name} (Lvl ${level})` };
}

module.exports = { LOCATIONS, getLocation, toPublicLocation, rollEnemy };
