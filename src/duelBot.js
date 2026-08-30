'use strict';

/**
 * A very simple duel opponent, for solo testing.
 *
 * It only sees what a fair player would: its own hand/mana/HP and the
 * opponent's public HP. Strategy (v1):
 *   - opening plan: ~3 attacks, 1 defensive, then whatever
 *   - each round: if below 40% HP and holding a defensive card it can afford,
 *     play it; otherwise play the affordable attack with the best expected
 *     damage; otherwise the cheapest card in hand.
 *
 * Not meant to be good -- meant to be predictable and good enough to exercise
 * the duel loop.
 */

const { getCard } = require('./cards');
const { currentStats } = require('./duel');

const hasDamage = (card) => (card.behaviour || []).some((b) => b.kind === 'damage');
const isDefensive = (card) =>
  card.type === 'defensive' || (card.behaviour || []).some((b) => b.kind === 'mitigate');

function expectedDamage(card, stats) {
  let total = 0;
  for (const b of card.behaviour || []) {
    if (b.kind !== 'damage') continue;
    const el = b.element || 'physical';
    const lo = el === 'physical' ? stats.attackMin : stats[`${el}AtkMin`] || 0;
    const hi = el === 'physical' ? stats.attackMax : stats[`${el}AtkMax`] || 0;
    total += ((lo + hi) / 2) * (typeof b.scale === 'number' ? b.scale : 1);
  }
  return total;
}

/** Pick 5 card ids from the bot's deck for the opening plan. */
function chooseOpeningPlan(bot) {
  const avail = [...bot.deck];
  const plan = [];

  const take = (pred) => {
    const i = avail.findIndex((id) => pred(getCard(id)));
    if (i === -1) return false;
    plan.push(avail[i]);
    avail.splice(i, 1);
    return true;
  };

  for (let i = 0; i < 3; i++) take(hasDamage);
  take(isDefensive);
  while (plan.length < 5 && avail.length) plan.push(avail.shift());
  return plan.slice(0, 5);
}

/** Pick one card id from the bot's remaining deck for the current round. */
function chooseCard(duel, bot) {
  const distinct = [...new Set(bot.deck)];
  if (!distinct.length) return null;

  const stats = currentStats(bot);
  const affordable = distinct.filter((id) => bot.mana >= getCard(id).manaCost);
  const pool = (affordable.length ? affordable : distinct).map(getCard);

  if (bot.hp / bot.maxHp < 0.4) {
    const def = pool.filter(isDefensive);
    if (def.length) return def[0].id;
  }

  const attacks = pool.filter(hasDamage);
  if (attacks.length) {
    attacks.sort((a, b) => expectedDamage(b, stats) - expectedDamage(a, stats));
    return attacks[0].id;
  }

  return [...pool].sort((a, b) => a.manaCost - b.manaCost)[0].id;
}

module.exports = { chooseOpeningPlan, chooseCard };
