'use strict';

/**
 * Duel engine (rules + state). No sockets here -- duelHub.js drives this and
 * broadcasts. Kept mostly pure so it can be unit-tested.
 *
 * ---------------------------------------------------------------------------
 * RULES (v1)
 * ---------------------------------------------------------------------------
 * - 15 rounds. One card per player per round.
 * - Each player brings a duel-legal deck (>= 15 cards). Cards spent in the duel
 *   move to that player's "burned" pile and do not come back.
 * - Planning: before round 1 each player secretly queues 5 cards (rounds 1-5).
 *   After each of rounds 1..10 resolves, each player queues 1 more card, for
 *   the round 5 ahead (round 6 after round 1, ... round 15 after round 10).
 *   Rounds 11-15 just resolve. So you always plan 5 rounds ahead.
 * - Mana: starts at the character's Mana stat. +MANA_PER_ROUND at the start of
 *   every round. A card costs its manaCost when it resolves; if you cannot pay,
 *   the card is burned with no effect and you lose no mana.
 * - Resolve order within a round: higher runtime priority first. Runtime
 *   priority = card-type base priority + any `adjustPriority` effects in play
 *   this round (computed in a pre-pass, before cards resolve).
 * - `blockCard` cancels an opponent card (this round, if it has not resolved
 *   yet, or a matching card next round). A cancelled card is burned and its
 *   mana is still spent.
 * - `dot` (damage over time) ticks at the START of each of the next N rounds
 *   and ignores defense and mitigation.
 * - Stat changes from cards last only for this duel and never touch the saved
 *   character. Scope is 'round' (the round the card resolves in -- for defensive
 *   buffs), 'nextRound' (the following round, when your next card plays -- for
 *   attack buffs like Focus/Adrenaline, since you can't attack the same round
 *   you buff), or 'duel' (permanent for the match).
 * - Ends when: a player's HP hits 0, a player leaves, or all 15 rounds resolve
 *   (higher HP wins; equal HP is a draw).
 */

const { getCard, basePriorityOf, cardMatchesFilter } = require('./cards');
const { resolveStats } = require('./stats');

const TOTAL_ROUNDS = 15;
const PLAN_AHEAD = 5;
const MANA_PER_ROUND = 1; // may vary by duel type later

// ---------------------------------------------------------------------------

function rollInt(lo, hi, rng) {
  lo = Math.round(lo);
  hi = Math.round(hi);
  if (hi < lo) hi = lo;
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** Build a player's duel state from their character + chosen deck. */
function makePlayerState({ userId, name, classId, level, deck }) {
  const base = resolveStats({ classId, level });
  return {
    userId,
    name,
    classId,
    level,
    baseStats: base,
    maxHp: base.health,
    hp: base.health,
    mana: base.mana,
    deck: [...deck], // not-yet-queued cards
    plan: {}, // round number -> cardId (committed, hidden from opponent)
    burned: [],
    effects: [], // { stat, amount, scope: 'round'|'duel', untilRound }
    dots: [], // { element, damage, roundsLeft, source } -- ticks at start of round
    pendingBlock: null, // { filter, forRound } set by an opponent's nextRound blockCard
    submitted: false, // has acted for the upcoming round?
    connected: true,
  };
}

/**
 * Create a duel. `a` and `b` are makePlayerState inputs.
 * Throws if a deck is not the right size (caller should pre-check).
 */
function createDuel(id, a, b) {
  return {
    id,
    createdAt: Date.now(),
    round: 1,
    phase: 'planning', // 'planning' | 'ended'
    players: {
      [a.userId]: makePlayerState(a),
      [b.userId]: makePlayerState(b),
    },
    order: [a.userId, b.userId],
    log: [], // [{ round, entries: string[] }]
    winner: undefined, // userId | 'draw' | undefined
    endReason: undefined, // 'hp' | 'left' | 'rounds'
    deadline: null, // epoch ms for the current planning phase (set by duelHub)
  };
}

// Planning time limits (ms). Opening 5-card plan gets longer.
const PLAN_MS_OPENING = 3 * 60 * 1000;
const PLAN_MS_ROUND = 1 * 60 * 1000;

function planningMs(duel) {
  return duel.round === 1 ? PLAN_MS_OPENING : PLAN_MS_ROUND;
}

const opponentId = (duel, userId) => duel.order.find((x) => x !== userId);
const playersOf = (duel) => duel.order.map((id) => duel.players[id]);

/** Which round is the "far" slot each player must fill before `duel.round`? */
function slotToFill(duel) {
  const r = duel.round + PLAN_AHEAD - 1;
  return r <= TOTAL_ROUNDS ? r : null;
}

/** Effective stats right now: base + active effects (never mutates base). */
function currentStats(player) {
  const s = { ...player.baseStats };
  for (const e of player.effects) s[e.stat] = (s[e.stat] || 0) + e.amount;
  return s;
}

function countInDeck(player, cardId) {
  return player.deck.filter((x) => x === cardId).length;
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/**
 * Submit the opening 5-card plan (round 1 only, once per player).
 * cards: cardId[] of length PLAN_AHEAD, each present in the player's deck.
 */
function submitPlan(duel, userId, cards) {
  if (duel.phase !== 'planning' || duel.round !== 1) return { ok: false, error: 'not_planning' };
  const p = duel.players[userId];
  if (!p) return { ok: false, error: 'not_in_duel' };
  if (Object.keys(p.plan).length) return { ok: false, error: 'already_planned' };
  if (!Array.isArray(cards) || cards.length !== PLAN_AHEAD) {
    return { ok: false, error: 'need_exactly_5' };
  }

  // every card must exist and be available in the deck (respecting copies)
  const need = new Map();
  for (const id of cards) {
    if (!getCard(id)) return { ok: false, error: `unknown_card:${id}` };
    need.set(id, (need.get(id) || 0) + 1);
  }
  for (const [id, n] of need) {
    if (countInDeck(p, id) < n) return { ok: false, error: `not_in_deck:${id}` };
  }

  cards.forEach((id, i) => {
    p.plan[i + 1] = id;
    p.deck.splice(p.deck.indexOf(id), 1);
  });
  p.submitted = true;
  return { ok: true };
}

/** Queue one card for the far slot (rounds 6..15). */
function submitCard(duel, userId, cardId) {
  if (duel.phase !== 'planning') return { ok: false, error: 'not_planning' };
  const slot = slotToFill(duel);
  if (slot === null) return { ok: false, error: 'no_slot' };
  const p = duel.players[userId];
  if (!p) return { ok: false, error: 'not_in_duel' };
  if (p.plan[slot]) return { ok: false, error: 'slot_filled' };
  if (!getCard(cardId)) return { ok: false, error: 'unknown_card' };
  if (countInDeck(p, cardId) < 1) return { ok: false, error: 'not_in_deck' };

  p.plan[slot] = cardId;
  p.deck.splice(p.deck.indexOf(cardId), 1);
  p.submitted = true;
  return { ok: true };
}

/** Rounds 11-15 need no card; the player just confirms they're ready. */
function markReady(duel, userId) {
  const p = duel.players[userId];
  if (!p || duel.phase !== 'planning') return { ok: false, error: 'not_planning' };
  if (slotToFill(duel) !== null && !p.plan[slotToFill(duel)]) {
    return { ok: false, error: 'must_submit_card' };
  }
  p.submitted = true;
  return { ok: true };
}

function bothSubmitted(duel) {
  return playersOf(duel).every((p) => p.submitted);
}

/**
 * Called when a player's planning timer runs out: the server picks for them.
 * Opening plan -> the first 5 cards of their deck. Otherwise -> the first card
 * of their deck for the far slot, or just mark ready if there is nothing to do.
 */
function autoSubmit(duel, userId) {
  const p = duel.players[userId];
  if (!p || p.submitted || duel.phase !== 'planning') return;

  if (duel.round === 1 && Object.keys(p.plan).length === 0) {
    const cards = p.deck.slice(0, PLAN_AHEAD);
    if (cards.length === PLAN_AHEAD && submitPlan(duel, userId, cards).ok) return;
    p.submitted = true;
    return;
  }

  const slot = slotToFill(duel);
  if (slot !== null && !p.plan[slot] && p.deck.length) {
    if (submitCard(duel, userId, p.deck[0]).ok) return;
  }
  markReady(duel, userId);
  p.submitted = true; // force, even if there was no legal card to play
}

// ---------------------------------------------------------------------------
// Round resolution
// ---------------------------------------------------------------------------

/**
 * Run one behaviour of a card that is resolving now.
 *   play = { actor, opponent, card, resolved, blocked }
 *   ctx  = { plays, round, log, rng }
 */
function applyBehaviour(beh, play, ctx) {
  const { plays, round, log, rng } = ctx;
  const actor = play.actor;
  const target = play.opponent;

  switch (beh.kind) {
    case 'damage': {
      const a = currentStats(actor);
      const d = currentStats(target);
      const el = beh.element || 'physical';
      const lo = el === 'physical' ? a.attackMin : a[`${el}AtkMin`] || 0;
      const hi = el === 'physical' ? a.attackMax : a[`${el}AtkMax`] || 0;
      const raw = rollInt(lo, hi, rng) * (typeof beh.scale === 'number' ? beh.scale : 1);
      const defense = el === 'physical' ? d.defense : d[`${el}Def`] || 0;
      const flat = target._mitigateFlat || 0;
      const pct = target._mitigatePct || 0;
      let dmg = Math.max(0, Math.round(raw) - defense - flat);
      dmg = Math.round(dmg * (1 - pct / 100));
      target.hp -= dmg;
      log.push(`${actor.name}'s attack hits ${target.name} for ${dmg} ${el} damage (HP ${Math.max(0, target.hp)})`);
      if (beh.lifesteal && dmg > 0) {
        const healed = Math.min(Math.round(dmg * beh.lifesteal), actor.maxHp - actor.hp);
        if (healed > 0) {
          actor.hp += healed;
          log.push(`${actor.name} drains ${healed} HP (HP ${actor.hp})`);
        }
      }
      break;
    }
    case 'heal': {
      const who = beh.target === 'opponent' ? target : actor;
      const amount = Math.max(0, Math.round(beh.amount || 0));
      const healed = Math.min(amount, who.maxHp - who.hp);
      who.hp += healed;
      log.push(`${who.name} heals ${healed} (HP ${who.hp})`);
      break;
    }
    case 'dot': {
      const who = beh.target === 'self' ? actor : target;
      who.dots.push({
        element: beh.element || 'physical',
        damage: Math.max(0, Math.round(beh.damage || 0)),
        roundsLeft: Math.max(1, Math.round(beh.duration || 1)),
        source: actor.name,
      });
      log.push(
        `${who.name} is afflicted: ${Math.max(0, Math.round(beh.damage || 0))} ${beh.element || 'physical'} damage/round for ${Math.max(1, Math.round(beh.duration || 1))} rounds`,
      );
      break;
    }
    case 'mitigate': {
      if (beh.flat) actor._mitigateFlat = (actor._mitigateFlat || 0) + beh.flat;
      if (beh.percent) actor._mitigatePct = Math.min(90, (actor._mitigatePct || 0) + beh.percent);
      log.push(`${actor.name} braces (damage reduced this round)`);
      break;
    }
    case 'modifyStat': {
      const who = beh.target === 'opponent' ? target : actor;
      // 'round'     -> only the round this card resolves in (defensive buffs:
      //                you can't also play an attack this round, so an
      //                attack buff here would do nothing -- use 'nextRound').
      // 'nextRound' -> the following round, when your next card actually plays.
      // 'duel'      -> the rest of the duel.
      const untilRound =
        beh.duration === 'duel' ? Infinity
        : beh.duration === 'nextRound' ? round + 1
        : round;
      who.effects.push({
        stat: beh.stat,
        amount: beh.amount,
        scope: beh.duration === 'duel' ? 'duel' : 'round',
        untilRound,
      });
      const sign = beh.amount >= 0 ? '+' : '';
      const when =
        beh.duration === 'duel' ? 'this duel'
        : beh.duration === 'nextRound' ? 'next round'
        : 'this round';
      log.push(`${who.name}: ${sign}${beh.amount} ${beh.stat} (${when})`);
      break;
    }
    case 'blockCard': {
      if (beh.scope === 'nextRound') {
        target.pendingBlock = { filter: beh.filter || null, forRound: round + 1 };
        log.push(`${actor.name} disrupts ${target.name}'s next move`);
        break;
      }
      // thisRound: cancel the opponent's card if it is still waiting to resolve
      const victim = plays.find((pl) => pl.actor === target && !pl.resolved && !pl.blocked);
      if (victim && cardMatchesFilter(victim.card, beh.filter)) {
        victim.blocked = true;
        victim.blockedBy = play.card.name;
        log.push(`${actor.name}'s ${play.card.name} cancels ${target.name}'s ${victim.card.name}`);
      } else {
        log.push(`${actor.name}'s ${play.card.name} finds nothing to cancel`);
      }
      break;
    }
    case 'adjustPriority':
      // resolved in the pre-pass in resolveRound(); nothing to do at execution time
      break;
    default:
      log.push(`(unknown behaviour: ${beh.kind})`);
  }
}

/**
 * Runtime priority for a play: base priority of its card type, plus every
 * `adjustPriority` effect in the round that targets it. A card's own
 * `adjustPriority` with target 'self' speeds it up; an opponent card's
 * `adjustPriority` with target 'opponent' lands on this play.
 */
function runtimePriority(play, plays) {
  let p = basePriorityOf(play.card);
  for (const other of plays) {
    for (const beh of other.card.behaviour || []) {
      if (beh.kind !== 'adjustPriority') continue;
      const amount = beh.amount || 0;
      if (beh.target === 'opponent') {
        if (other !== play) p += amount;
      } else if (other === play) {
        p += amount;
      }
    }
  }
  return p;
}

/**
 * Resolve the current round. Assumes bothSubmitted(duel) is true.
 * Returns the log entry for this round.
 */
function resolveRound(duel, rng = Math.random) {
  if (duel.phase === 'ended') return null;
  const round = duel.round;
  const entries = [];
  const ps = playersOf(duel);

  // 1. mana income + reset per-round mitigation
  for (const p of ps) {
    p.mana += MANA_PER_ROUND;
    p._mitigateFlat = 0;
    p._mitigatePct = 0;
  }

  // 1b. damage-over-time ticks (start of round, before any card resolves).
  //     Ignores defense and mitigation.
  for (const p of ps) {
    for (const d of p.dots) {
      p.hp -= d.damage;
      d.roundsLeft -= 1;
      entries.push(
        `${p.name} suffers ${d.damage} ${d.element} damage from a lingering wound (HP ${Math.max(0, p.hp)})`,
      );
    }
    p.dots = p.dots.filter((d) => d.roundsLeft > 0);
  }

  // 2. reveal + mana check + "disrupted next round" check
  const plays = [];
  for (const p of ps) {
    const cardId = p.plan[round];
    delete p.plan[round];
    const card = cardId ? getCard(cardId) : null;

    // consume a pending block aimed at this round, whatever the card turns out to be
    const pb = p.pendingBlock;
    if (pb && pb.forRound <= round) p.pendingBlock = null;

    if (!card) {
      entries.push(`${p.name} played no card`);
      continue;
    }
    if (p.hp <= 0) {
      p.burned.push(card.id);
      entries.push(`${p.name} is down and cannot act`);
      continue;
    }
    if (pb && pb.forRound === round && cardMatchesFilter(card, pb.filter)) {
      if (p.mana >= card.manaCost) p.mana -= card.manaCost; // mana is still spent
      p.burned.push(card.id);
      entries.push(`${p.name}'s ${card.name} is disrupted and fails`);
      continue;
    }
    if (p.mana < card.manaCost) {
      p.burned.push(card.id);
      entries.push(`${p.name}'s ${card.name} burned — not enough mana (${p.mana}/${card.manaCost})`);
      continue;
    }
    p.mana -= card.manaCost;
    plays.push({
      actor: p,
      card,
      opponent: duel.players[opponentId(duel, p.userId)],
      resolved: false,
      blocked: false,
    });
    entries.push(`${p.name} plays ${card.name} (${card.type})`);
  }

  // 3. order by runtime priority (base + adjustPriority effects), highest first.
  //    Priority tie -> higher Dexterity acts first; still tied -> coin flip.
  const priority = new Map(plays.map((pl) => [pl, runtimePriority(pl, plays)]));
  plays.sort((x, y) => {
    const byPriority = priority.get(y) - priority.get(x);
    if (byPriority !== 0) return byPriority;
    const dx = currentStats(x.actor).dexterity;
    const dy = currentStats(y.actor).dexterity;
    if (dx !== dy) return dy - dx;
    return rng() < 0.5 ? -1 : 1;
  });

  const ctx = { plays, round, log: entries, rng };
  for (const play of plays) {
    if (play.blocked) {
      entries.push(`${play.actor.name}'s ${play.card.name} was cancelled`);
      play.actor.burned.push(play.card.id);
      continue;
    }
    for (const beh of play.card.behaviour || []) {
      applyBehaviour(beh, play, ctx);
    }
    play.resolved = true;
    play.actor.burned.push(play.card.id);
  }

  // 4. expire round-scoped effects
  for (const p of ps) {
    p.effects = p.effects.filter((e) => e.scope === 'duel' || e.untilRound > round);
  }

  const logEntry = { round, entries };
  duel.log.push(logEntry);

  // 5. end checks
  const dead = ps.filter((p) => p.hp <= 0);
  if (dead.length) {
    endDuel(duel, 'hp');
  } else if (round >= TOTAL_ROUNDS) {
    endDuel(duel, 'rounds');
  } else {
    duel.round += 1;
    for (const p of ps) p.submitted = false;
    // rounds with no card to submit: mark ready-needed handled by client
  }

  return logEntry;
}

function endDuel(duel, reason) {
  duel.phase = 'ended';
  duel.endReason = reason;
  const [p1, p2] = playersOf(duel);
  if (p1.hp === p2.hp) duel.winner = 'draw';
  else duel.winner = (p1.hp > p2.hp ? p1 : p2).userId;
}

/** A player left / disconnected -> the other wins. */
function forfeit(duel, userId) {
  if (duel.phase === 'ended') return;
  duel.phase = 'ended';
  duel.endReason = 'left';
  duel.winner = opponentId(duel, userId);
}

// ---------------------------------------------------------------------------
// Views (what each side is allowed to see)
// ---------------------------------------------------------------------------

function publicPlayer(p) {
  return {
    userId: p.userId,
    name: p.name,
    classId: p.classId,
    level: p.level,
    hp: Math.max(0, p.hp),
    maxHp: p.maxHp,
    mana: p.mana,
    deckCount: p.deck.length,
    burnedCount: p.burned.length,
    plannedCount: Object.keys(p.plan).length,
    dots: p.dots.map((d) => ({ element: d.element, damage: d.damage, roundsLeft: d.roundsLeft })),
  };
}

/** State from one player's point of view (their plan visible, opponent's not). */
function viewFor(duel, userId) {
  const me = duel.players[userId];
  const opp = duel.players[opponentId(duel, userId)];
  return {
    id: duel.id,
    round: duel.round,
    totalRounds: TOTAL_ROUNDS,
    phase: duel.phase,
    winner: duel.winner,
    endReason: duel.endReason,
    slotToFill: slotToFill(duel),
    deadline: duel.deadline || null,
    manaPerRound: MANA_PER_ROUND,
    you: {
      ...publicPlayer(me),
      hand: [...me.deck],
      plan: { ...me.plan },
      stats: currentStats(me),
      baseStats: { ...me.baseStats },
      submitted: me.submitted,
      disruptedNextRound: !!(me.pendingBlock && me.pendingBlock.forRound === duel.round + 1),
    },
    opponent: { ...publicPlayer(opp), submitted: opp.submitted, baseStats: { ...opp.baseStats } },
    log: duel.log,
  };
}

module.exports = {
  TOTAL_ROUNDS,
  PLAN_AHEAD,
  MANA_PER_ROUND,
  PLAN_MS_OPENING,
  PLAN_MS_ROUND,
  planningMs,
  createDuel,
  submitPlan,
  submitCard,
  markReady,
  autoSubmit,
  bothSubmitted,
  resolveRound,
  forfeit,
  endDuel,
  slotToFill,
  currentStats,
  viewFor,
  opponentId,
};
