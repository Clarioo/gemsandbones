'use strict';

/**
 * Duel-engine tests. Run with:  npm test   (node --test)
 *
 * Focus: the card-behaviour logic added in feature/card-blocking --
 * blockCard (this round + next round), adjustPriority, heal, lifesteal, dot.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const duel = require('./duel');

// A fixed rng so damage rolls are deterministic (mid-range).
const midRng = () => 0.5;

function mkDuel(a, b) {
  return duel.createDuel('t', {
    userId: 'A',
    name: 'Alice',
    classId: a.classId,
    level: a.level || 1,
    deck: a.deck.slice(),
  }, {
    userId: 'B',
    name: 'Bob',
    classId: b.classId,
    level: b.level || 1,
    deck: b.deck.slice(),
  });
}

/** Pad a plan to 5 cards with free Strikes. */
const plan5 = (...cards) => {
  const out = cards.slice();
  while (out.length < 5) out.push('strike');
  return out;
};

/** deck big enough to draw any plan we throw at it */
const deckWith = (...cards) => [...cards, ...Array(15).fill('strike')];

function openingResolve(d, planA, planB, rng = midRng) {
  assert.equal(duel.submitPlan(d, 'A', planA).ok, true);
  assert.equal(duel.submitPlan(d, 'B', planB).ok, true);
  return duel.resolveRound(d, rng);
}

const lastRoundText = (d) => d.log[d.log.length - 1].entries.join('\n');

// ---------------------------------------------------------------------------

test('Nullify cancels the opponent Special this round', () => {
  const d = mkDuel(
    { classId: 'fencer', deck: deckWith('nullify') },
    { classId: 'mage', deck: deckWith('disrupt') },
  );
  openingResolve(d, plan5('nullify'), plan5('disrupt'));

  const text = lastRoundText(d);
  assert.match(text, /cancels Bob's Disrupt/);
  // Disrupt never took effect: Alice is not disrupted next round.
  assert.equal(d.players.A.pendingBlock, null);
});

test('Nullify does not touch a physical attack (type filter)', () => {
  const d = mkDuel(
    { classId: 'fencer', deck: deckWith('nullify') },
    { classId: 'fencer', deck: deckWith('strike') },
  );
  openingResolve(d, plan5('nullify'), plan5('strike'));

  const text = lastRoundText(d);
  assert.match(text, /finds nothing to cancel/);
  assert.ok(d.players.A.hp < d.players.A.maxHp, 'Strike still landed');
});

test('Overload out-prioritises Nullify and dodges the block', () => {
  const d = mkDuel(
    { classId: 'fencer', deck: deckWith('nullify') },
    { classId: 'mage', deck: deckWith('overload') },
  );
  const hpBefore = d.players.A.hp;
  openingResolve(d, plan5('nullify'), plan5('overload'));

  const text = lastRoundText(d);
  assert.match(text, /finds nothing to cancel/);
  assert.ok(d.players.A.hp < hpBefore, 'Overload resolved before the block and dealt damage');
});

test('Disrupt blocks an offensive card next round, mana still spent', () => {
  const d = mkDuel(
    { classId: 'mage', deck: deckWith('disrupt', 'firebolt') },
    { classId: 'mage', deck: deckWith('firebolt') },
  );
  // R1: Alice casts Disrupt at Bob; Bob plays a filler Strike.
  openingResolve(d, plan5('disrupt', 'firebolt'), plan5('strike', 'firebolt'));
  assert.ok(d.players.B.pendingBlock, 'Bob is marked disrupted for round 2');

  const manaBefore = d.players.B.mana;
  const hpBefore = d.players.A.hp;
  duel.resolveRound(d, midRng); // round 2: Bob's queued Firebolt

  const text = lastRoundText(d);
  assert.match(text, /disrupted and fails/);
  assert.equal(d.players.A.hp, hpBefore, 'the disrupted Firebolt dealt no damage');
  assert.ok(d.players.B.mana < manaBefore, 'Firebolt mana was still spent');
  assert.equal(d.players.B.pendingBlock, null, 'the pending block was consumed');
});

test('Disrupt does not block a defensive card', () => {
  const d = mkDuel(
    { classId: 'mage', deck: deckWith('disrupt') },
    { classId: 'protector', deck: deckWith('guard') },
  );
  openingResolve(d, plan5('disrupt'), plan5('strike', 'guard'));
  duel.resolveRound(d, midRng); // round 2: Bob plays Guard

  assert.doesNotMatch(lastRoundText(d), /disrupted/);
});

test('heal restores HP and clamps at max', () => {
  const d = mkDuel(
    { classId: 'fencer', deck: deckWith('mend') },
    { classId: 'fencer', deck: deckWith('strike') },
  );
  d.players.A.hp = d.players.A.maxHp - 5; // only 5 to gain, Mend heals 14
  openingResolve(d, plan5('mend'), plan5('strike'));

  // Bob's Strike also hits, so check the heal happened via the log, and HP never exceeds max.
  assert.match(lastRoundText(d), /Alice heals 5/);
  assert.ok(d.players.A.hp <= d.players.A.maxHp);
});

test('lifesteal heals the attacker', () => {
  const d = mkDuel(
    { classId: 'mage', deck: deckWith('leech') },
    { classId: 'fencer', deck: deckWith('strike') },
  );
  d.players.A.hp = d.players.A.maxHp - 40;
  const hpBefore = d.players.A.hp;
  openingResolve(d, plan5('leech'), plan5('strike'));

  assert.match(lastRoundText(d), /Alice drains \d+ HP/);
  // net HP change = lifesteal - Bob's Strike; lifesteal alone is asserted via the log,
  // but the drain should at least partly offset the hit.
  assert.ok(d.players.A.hp > hpBefore - 20);
});

test('dot ticks for its duration, ignores armour, then expires', () => {
  const d = mkDuel(
    { classId: 'hunter', deck: deckWith('poison-blade') },
    { classId: 'protector', deck: deckWith('strike') }, // high defense, dot should ignore it
  );
  openingResolve(d, plan5('poison-blade'), plan5('strike'));
  assert.equal(d.players.B.dots.length, 1, 'poison applied');

  const tickText = [];
  for (let i = 0; i < 4; i++) {
    duel.resolveRound(d, midRng); // rounds 2,3,4,5
    tickText.push(lastRoundText(d));
  }

  // ticks on rounds 2,3,4 (3 rounds), not round 5
  assert.match(tickText[0], /lingering wound/);
  assert.match(tickText[1], /lingering wound/);
  assert.match(tickText[2], /lingering wound/);
  assert.doesNotMatch(tickText[3], /lingering wound/);
  assert.equal(d.players.B.dots.length, 0, 'poison expired');
});

test('Adrenaline buffs the NEXT round\'s attack, then expires', () => {
  // Play `r1` in round 1, then Strike in rounds 2 and 3. Measure the damage
  // Alice's Strike does to Bob each round.
  const run = (r1) => {
    const d = mkDuel(
      { classId: 'fencer', deck: deckWith('adrenaline') },
      { classId: 'fencer', deck: deckWith('strike') },
    );
    openingResolve(d, plan5(r1), plan5('strike')); // round 1
    const before2 = d.players.B.hp;
    duel.resolveRound(d, midRng); // round 2
    const dmg2 = before2 - d.players.B.hp;
    const before3 = d.players.B.hp;
    duel.resolveRound(d, midRng); // round 3
    const dmg3 = before3 - d.players.B.hp;
    return { dmg2, dmg3 };
  };

  const buffed = run('adrenaline');
  const plain = run('strike');

  assert.ok(buffed.dmg2 > plain.dmg2, 'round 2 Strike hits harder after Adrenaline');
  assert.equal(buffed.dmg3, plain.dmg3, 'the buff is gone by round 3');
});

test('Focus buffs next round\'s elemental attack, not just physical', () => {
  const fireDmgAfter = (r1) => {
    const d = mkDuel(
      { classId: 'mage', deck: deckWith('focus', 'firebolt') },
      { classId: 'fencer', deck: deckWith('strike') },
    );
    openingResolve(d, plan5(r1, 'firebolt'), plan5('strike', 'strike'));
    const before = d.players.B.hp;
    duel.resolveRound(d, midRng); // round 2: the Mage's Firebolt
    return before - d.players.B.hp;
  };
  assert.ok(fireDmgAfter('focus') > fireDmgAfter('strike'), 'Firebolt hits harder the round after Focus');
});

test('adjustPriority pre-pass does not break a plain round', () => {
  const d = mkDuel(
    { classId: 'mage', deck: deckWith('overload') },
    { classId: 'fencer', deck: deckWith('strike') },
  );
  const entry = openingResolve(d, plan5('overload'), plan5('strike'));
  assert.equal(entry.round, 1);
  assert.equal(d.round, 2);
  assert.equal(d.phase, 'planning');
});
