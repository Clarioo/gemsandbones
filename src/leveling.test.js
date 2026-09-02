'use strict';

/**
 * Leveling guard rails. Run with:  npm test   (node --test)
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { MAX_LEVEL, xpForNextLevel, xpForEnemyKill, applyXp } = require('./leveling');

test('xpForNextLevel is positive and strictly increasing', () => {
  let prev = 0;
  for (let l = 1; l < MAX_LEVEL; l++) {
    const need = xpForNextLevel(l);
    assert.ok(need > 0, `level ${l} needs ${need}`);
    assert.ok(need > prev, `level ${l} (${need}) should need more than level ${l - 1} (${prev})`);
    prev = need;
  }
});

test('applyXp: partial progress does not level up', () => {
  const need = xpForNextLevel(1);
  const r = applyXp({ level: 1, xp: 0 }, need - 1);
  assert.equal(r.level, 1);
  assert.equal(r.xp, need - 1);
  assert.equal(r.levelsGained, 0);
});

test('applyXp: exact requirement levels up once with no leftover', () => {
  const r = applyXp({ level: 1, xp: 0 }, xpForNextLevel(1));
  assert.equal(r.level, 2);
  assert.equal(r.xp, 0);
  assert.equal(r.levelsGained, 1);
  assert.equal(r.xpForNext, xpForNextLevel(2));
});

test('applyXp: overflow carries the remainder into the new level', () => {
  const r = applyXp({ level: 1, xp: 0 }, xpForNextLevel(1) + 5);
  assert.equal(r.level, 2);
  assert.equal(r.xp, 5);
});

test('applyXp: a big dump can grant several levels at once', () => {
  const lump = xpForNextLevel(1) + xpForNextLevel(2) + xpForNextLevel(3) + 1;
  const r = applyXp({ level: 1, xp: 0 }, lump);
  assert.equal(r.level, 4);
  assert.equal(r.xp, 1);
  assert.equal(r.levelsGained, 3);
});

test('applyXp: caps at MAX_LEVEL and stops accumulating xp', () => {
  const r = applyXp({ level: MAX_LEVEL - 1, xp: 0 }, 10 ** 9);
  assert.equal(r.level, MAX_LEVEL);
  assert.equal(r.xp, 0);
});

test('applyXp: ignores negative or missing amounts', () => {
  assert.deepEqual(applyXp({ level: 2, xp: 10 }, -50).xp, 10);
  assert.equal(applyXp({ level: 2, xp: 10 }).level, 2);
});

test('xpForEnemyKill: fighting up pays more than fighting down', () => {
  const even = xpForEnemyKill(5, 5);
  assert.ok(xpForEnemyKill(8, 5) > even, 'higher enemy should pay more');
  assert.ok(xpForEnemyKill(2, 5) < even, 'lower enemy should pay less');
});

test('xpForEnemyKill: always at least 1, even against a trivial enemy', () => {
  assert.ok(xpForEnemyKill(1, MAX_LEVEL) >= 1);
});
