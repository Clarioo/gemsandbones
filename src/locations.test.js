'use strict';

/**
 * World-map tests. Run with:  npm test   (node --test)
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { LOCATIONS, getLocation, toPublicLocation, rollEnemy } = require('./locations');
const { isValidClassId } = require('./classes');

test('every location has a valid, self-consistent shape', () => {
  assert.ok(LOCATIONS.length >= 1);
  for (const loc of LOCATIONS) {
    assert.equal(typeof loc.id, 'string');
    assert.ok(loc.enemyLevels.min >= 1);
    assert.ok(loc.enemyLevels.max >= loc.enemyLevels.min);
    assert.ok(loc.enemies.length >= 1);
    for (const e of loc.enemies) assert.ok(isValidClassId(e.classId), e.classId);
  }
});

test('getLocation resolves known ids and rejects unknown ones', () => {
  assert.equal(getLocation('whisperwood-fringe').id, 'whisperwood-fringe');
  assert.equal(getLocation('nope'), null);
});

test('toPublicLocation drops the internal enemy pool', () => {
  const pub = toPublicLocation(getLocation('whisperwood-fringe'));
  assert.equal(pub.enemies, undefined);
  assert.deepEqual(pub.enemyLevels, { min: 1, max: 5 });
});

test('rollEnemy stays within the level range and picks a real class', () => {
  const loc = getLocation('whisperwood-fringe');
  for (let i = 0; i < 200; i++) {
    const e = rollEnemy(loc);
    assert.ok(e.level >= loc.enemyLevels.min && e.level <= loc.enemyLevels.max);
    assert.ok(isValidClassId(e.classId));
    assert.match(e.name, /Lvl \d+/);
  }
});

test('rollEnemy honours a seeded rng at both extremes', () => {
  const loc = getLocation('whisperwood-fringe');
  assert.equal(rollEnemy(loc, () => 0).level, loc.enemyLevels.min);
  assert.equal(rollEnemy(loc, () => 0.999).level, loc.enemyLevels.max);
});
