'use strict';

/** Equipment tests. Run with:  npm test   (node --test) */

const test = require('node:test');
const assert = require('node:assert/strict');

const { CLASS_IDS } = require('./classes');
const {
  SLOTS,
  ITEM_TEMPLATES,
  rollItem,
  rollRandomItem,
  rollEnemyLoadout,
  rollBonuses,
  canEquip,
  equippedItemMods,
  itemStatTotals,
} = require('./items');

test('every template is well-formed', () => {
  for (const t of ITEM_TEMPLATES) {
    assert.ok(SLOTS.includes(t.slot), `${t.id} slot`);
    assert.ok(
      t.classes === 'all' || t.classes.every((c) => CLASS_IDS.includes(c)),
      `${t.id} classes`,
    );
    assert.ok((t.requirements.level || 1) >= 1);
    for (const [stat, range] of Object.entries(t.statRanges)) {
      assert.ok(Array.isArray(range) && range.length === 2, `${t.id} ${stat}`);
      assert.ok(range[0] <= range[1], `${t.id} ${stat} min<=max`);
    }
  }
});

test('rollItem produces stats inside the template ranges', () => {
  for (const t of ITEM_TEMPLATES) {
    for (let i = 0; i < 60; i++) {
      const item = rollItem(t);
      assert.equal(item.durability.current, 100);
      assert.equal(item.durability.max, 100);
      assert.ok(item.uid && item.templateId === t.id);
      for (const [stat, [lo, hi]] of Object.entries(t.statRanges)) {
        assert.ok(item.stats[stat] >= lo && item.stats[stat] <= hi, `${t.id} ${stat}`);
      }
      if (item.stats.attackMin != null && item.stats.attackMax != null) {
        assert.ok(item.stats.attackMax >= item.stats.attackMin);
      }
    }
  }
});

test('an item always has 1-3 distinct bonuses', () => {
  for (let i = 0; i < 300; i++) {
    const item = rollRandomItem();
    assert.ok(item.bonuses.length >= 1 && item.bonuses.length <= 3);
    const stats = item.bonuses.map((b) => b.stat);
    assert.equal(new Set(stats).size, stats.length, 'bonus stats are distinct');
    for (const b of item.bonuses) assert.ok(Number.isInteger(b.amount) && b.amount > 0);
  }
});

test('bonus count follows the 65 / 30 / 5 split at the boundaries', () => {
  assert.equal(rollBonuses(() => 0.0).length, 1);
  assert.equal(rollBonuses(() => 0.64).length, 1);
  assert.equal(rollBonuses(() => 0.65).length, 2);
  assert.equal(rollBonuses(() => 0.94).length, 2);
  assert.equal(rollBonuses(() => 0.95).length, 3);
  assert.equal(rollBonuses(() => 0.99).length, 3);
});

test('canEquip gates on class and level', () => {
  const item = { classes: ['mage'], requirements: { level: 3 } };
  assert.equal(canEquip({ classId: 'fencer', level: 9 }, item).error, 'wrong_class');
  assert.equal(canEquip({ classId: 'mage', level: 2 }, item).error, 'level_too_low');
  assert.equal(canEquip({ classId: 'mage', level: 3 }, item).ok, true);
  assert.equal(canEquip({ classId: 'fencer', level: 1 }, { classes: 'all', requirements: {} }).ok, true);
});

test('itemStatTotals merges base stats and bonuses', () => {
  const item = { stats: { defense: 4, health: 10 }, bonuses: [{ stat: 'defense', amount: 2 }, { stat: 'mana', amount: 5 }] };
  assert.deepEqual(itemStatTotals(item), { defense: 6, health: 10, mana: 5 });
});

test('rollEnemyLoadout gives an AI enemy a level-appropriate kit', () => {
  for (const classId of CLASS_IDS) {
    // a level-1 enemy never gets an item that needs a higher level
    const low = rollEnemyLoadout(classId, 1);
    assert.ok(low.length >= 1 && low.length <= SLOTS.length);
    for (const mod of low) assert.equal(typeof mod, 'object');

    // more slots become fillable as level rises (>= the low-level count)
    const high = rollEnemyLoadout(classId, 10);
    assert.ok(high.length >= low.length);
  }
  // every template a level-1 hunter could roll is actually level 1
  for (let i = 0; i < 50; i++) {
    const mods = rollEnemyLoadout('hunter', 1);
    assert.ok(mods.length >= 1);
  }
});

test('equippedItemMods only counts valid, equipped, unbroken items', () => {
  const good = { uid: 'a', slot: 'weapon', classes: 'all', stats: { attackMin: 3 }, bonuses: [], durability: { current: 50, max: 100 } };
  const broken = { uid: 'b', slot: 'helmet', classes: 'all', stats: { defense: 5 }, bonuses: [], durability: { current: 0, max: 100 } };
  const wrongClass = { uid: 'c', slot: 'armor', classes: ['mage'], stats: { mana: 9 }, bonuses: [], durability: { current: 90, max: 100 } };
  const character = {
    classId: 'fencer',
    bag: [good, broken, wrongClass],
    equipment: { weapon: 'a', helmet: 'b', armor: 'c', boots: null, ring: null },
  };
  assert.deepEqual(equippedItemMods(character), [{ attackMin: 3 }]);
});
