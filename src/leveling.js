'use strict';

/**
 * Player experience & leveling.
 *
 * XP is earned ONLY by beating AI enemies on the world map (see locationHub +
 * duelHub). Practice-bot fights and PvP duels award nothing.
 *
 * `xp` on the character is progress toward the CURRENT level's requirement;
 * the remainder carries over on level-up. `xpForNextLevel(level)` is the bar's
 * denominator for that level.
 *
 * !!! Every weight here is a STARTING POINT for balancing. Tune freely --
 * nothing else in the code hard-codes these numbers.
 */

const MAX_LEVEL = 50;

// XP needed to go from `level` to `level + 1`. Smooth super-linear curve:
//   L1->2   80      L5->6   ~1030      L10->11  ~2800
//   L2->3   ~235    L6->7   ~1330      L20->21  ~8200
//   L3->4   ~440    L7->8   ~1660      L49->50  ~34600
function xpForNextLevel(level) {
  const L = Math.max(1, Math.floor(level || 1));
  return Math.round(80 * Math.pow(L, 1.55));
}

/**
 * XP awarded for beating a world-map enemy of `enemyLevel`, given the winner's
 * level. Fighting up is worth more; heavily out-levelling an enemy tapers the
 * reward toward a small floor so grinding trivial enemies stops paying.
 */
function xpForEnemyKill(enemyLevel, playerLevel) {
  const eLvl = Math.max(1, Math.floor(enemyLevel || 1));
  const pLvl = Math.max(1, Math.floor(playerLevel || 1));
  const base = 18 + 14 * eLvl;
  const mult = Math.min(2, Math.max(0.15, 1 + 0.12 * (eLvl - pLvl)));
  return Math.max(1, Math.round(base * mult));
}

/**
 * Apply `amount` XP to a { level, xp } pair. Pure.
 * Returns { level, xp, levelsGained, xpForNext } where `xp` is the leftover
 * progress toward `level`'s next-level requirement.
 */
function applyXp({ level = 1, xp = 0 } = {}, amount = 0) {
  let lvl = Math.min(MAX_LEVEL, Math.max(1, Math.floor(level || 1)));
  let progress = Math.max(0, xp) + Math.max(0, Math.round(amount || 0));
  let levelsGained = 0;

  while (lvl < MAX_LEVEL && progress >= xpForNextLevel(lvl)) {
    progress -= xpForNextLevel(lvl);
    lvl += 1;
    levelsGained += 1;
  }
  if (lvl >= MAX_LEVEL) progress = 0; // nothing left to earn

  return { level: lvl, xp: progress, levelsGained, xpForNext: xpForNextLevel(lvl) };
}

module.exports = { MAX_LEVEL, xpForNextLevel, xpForEnemyKill, applyXp };
