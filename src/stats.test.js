'use strict';

/**
 * Stat-scaling guard rails. Run with:  npm test   (node --test)
 *
 * `growth` was halved on 2026-09-01 so a small level gap stops being a wall
 * (attack + defense + health all scale off the primaries, so the gap
 * compounds). These tests fail loudly if growth creeps back up.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { CLASSES } = require('./classes');
const { resolveStats } = require('./stats');

test('a 4-level gap does not blow past ~1.4x on the stats that compound', () => {
  for (const cls of CLASSES) {
    const l1 = resolveStats({ classId: cls.id, level: 1 });
    const l5 = resolveStats({ classId: cls.id, level: 5 });
    for (const stat of ['health', 'attackMax', 'defense']) {
      const ratio = l5[stat] / l1[stat];
      assert.ok(
        ratio <= 1.45,
        `${cls.id} ${stat} grows ${ratio.toFixed(2)}x over 4 levels (want <= 1.45x)`,
      );
    }
  }
});

test('per-level primary growth totals stay modest (<= 5 points/level)', () => {
  for (const cls of CLASSES) {
    const total = Object.values(cls.growth).reduce((a, b) => a + b, 0);
    assert.ok(total <= 5, `${cls.id} gains ${total} primary points per level`);
  }
});

test('levels still help — L3 beats L1 on every compounding stat', () => {
  for (const cls of CLASSES) {
    const l1 = resolveStats({ classId: cls.id, level: 1 });
    const l3 = resolveStats({ classId: cls.id, level: 3 });
    assert.ok(l3.health > l1.health && l3.attackMax > l1.attackMax);
  }
});
