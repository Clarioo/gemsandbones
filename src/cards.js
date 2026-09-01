'use strict';

/**
 * Card catalog + card types.
 *
 * This is the DATA layer only. Playing a card and running its behaviour during
 * a duel lives in the duel engine (duel.js `applyBehaviour`).
 *
 * ---------------------------------------------------------------------------
 * CARD TYPE vs PRIORITY
 * ---------------------------------------------------------------------------
 * A card's TYPE gives it a BASE priority. The actual priority used to order
 * plays within a duel round is computed at duel time and can be pushed up or
 * down by other cards (e.g. a Special that "manages round priority"). So:
 *
 *   card.type            -> fixed, from the list below
 *   type.basePriority    -> fixed starting value
 *   runtime priority     -> basePriority + modifiers (lives in the duel engine,
 *                           not here)
 *
 * Types below are ordered highest priority first. basePriority values are
 * spaced by 10 to leave room for modifiers.
 */
const CARD_TYPES = [
  { id: 'specialBlock', name: 'Special Block', basePriority: 60 },
  { id: 'special', name: 'Special', basePriority: 50 },
  { id: 'bonus', name: 'Bonus', basePriority: 40 },
  { id: 'defensive', name: 'Defensive', basePriority: 30 },
  { id: 'elementalAttack', name: 'Elemental Attack', basePriority: 20 },
  { id: 'physicalAttack', name: 'Physical Attack', basePriority: 10 },
];

const CARD_TYPE_IDS = CARD_TYPES.map((t) => t.id);

/**
 * ---------------------------------------------------------------------------
 * CARD BEHAVIOUR
 * ---------------------------------------------------------------------------
 * `behaviour` is an array of effect descriptors, each with a `kind`. A card can
 * have several; they run in array order when the card resolves. Keep entries
 * data-only (no functions) so cards stay serialisable.
 *
 *   { kind: 'damage', element: 'physical'|'fire'|'water'|'electric',
 *                     scale?: number,        // multiplier on the rolled attack (default 1)
 *                     lifesteal?: number }   // 0..1: heal the actor for this fraction of
 *                                            // the damage actually dealt
 *
 *   { kind: 'heal',   amount: number,
 *                     target?: 'self'|'opponent' }   // default 'self'; clamped to maxHp
 *
 *   { kind: 'dot',    element: 'physical'|'fire'|'water'|'electric',
 *                     damage: number,        // per-round damage
 *                     duration: number,      // number of rounds it ticks
 *                     target?: 'opponent'|'self' }  // default 'opponent'
 *                     // ticks at the START of each of the next `duration` rounds and
 *                     // ignores defense and mitigation (poison/burn bypass armour)
 *
 *   { kind: 'mitigate', percent?: number, flat?: number }   // this round, on the actor
 *
 *   { kind: 'modifyStat', stat: <statId>, amount: number,
 *                         target: 'self'|'opponent',
 *                         duration: 'round'|'nextRound'|'duel' }
 *                     // 'round'     = the round this card resolves in (defensive
 *                     //   buffs -- you can't also attack this round)
 *                     // 'nextRound' = the following round, when your next card
 *                     //   plays (attack buffs like Focus / Adrenaline)
 *                     // 'duel'      = permanent for the match
 *
 *   { kind: 'blockCard', scope: 'thisRound'|'nextRound',
 *                        filter?: { types: <typeId>[] } }  // no filter = matches anything
 *                     // thisRound: cancel the opponent's card resolving this round if it
 *                     //   matches and has NOT resolved yet (a higher-priority card that
 *                     //   already resolved has dodged the block)
 *                     // nextRound: cancel the opponent's matching card next round
 *                     // a cancelled card is burned; its mana was already spent at reveal
 *
 *   { kind: 'adjustPriority', amount: number, target: 'self'|'opponent' }
 *                     // resolved in a pre-pass BEFORE plays are ordered, so it can move a
 *                     // card ahead of (or behind) a would-be blocker
 */

// `classes: 'all'` = every class may use it. Otherwise an array of class ids.
const CARDS = [
  // ---- Physical Attack --------------------------------------------------
  {
    id: 'strike',
    name: 'Strike',
    type: 'physicalAttack',
    manaCost: 0,
    classes: 'all',
    graphic: '/cards/strike.png',
    description: 'A basic melee hit. Deals physical damage scaled by your attack.',
    behaviour: [{ kind: 'damage', element: 'physical', scale: 1 }],
  },
  {
    id: 'heavy-blow',
    name: 'Heavy Blow',
    type: 'physicalAttack',
    manaCost: 6,
    classes: ['fencer', 'protector'],
    graphic: '/cards/heavy-blow.png',
    description: 'A committed swing for heavy physical damage.',
    behaviour: [{ kind: 'damage', element: 'physical', scale: 1.5 }],
  },
  {
    id: 'poison-blade',
    name: 'Poison Blade',
    type: 'physicalAttack',
    manaCost: 7,
    classes: ['fencer', 'hunter'],
    graphic: '/cards/poison-blade.png',
    description: 'A coated edge. A light cut now, then poison gnaws for 3 rounds (ignores armour).',
    behaviour: [
      { kind: 'damage', element: 'physical', scale: 0.6 },
      { kind: 'dot', element: 'physical', damage: 3, duration: 3 },
    ],
  },

  // ---- Elemental Attack ------------------------------------------------
  {
    id: 'firebolt',
    name: 'Firebolt',
    type: 'elementalAttack',
    manaCost: 8,
    classes: ['mage', 'hunter'],
    graphic: '/cards/firebolt.png',
    description: 'Hurls a bolt of fire. Damage scales with fire attack.',
    behaviour: [{ kind: 'damage', element: 'fire', scale: 1 }],
  },
  {
    id: 'spark',
    name: 'Spark',
    type: 'elementalAttack',
    manaCost: 6,
    classes: ['mage'],
    graphic: '/cards/spark.png',
    description: 'A quick jolt of electric damage.',
    behaviour: [{ kind: 'damage', element: 'electric', scale: 1 }],
  },
  {
    id: 'ignite',
    name: 'Ignite',
    type: 'elementalAttack',
    manaCost: 9,
    classes: ['mage', 'hunter'],
    graphic: '/cards/ignite.png',
    description: 'Sets the target alight: a small burst now, then fire damage each round for 3 rounds.',
    behaviour: [
      { kind: 'damage', element: 'fire', scale: 0.5 },
      { kind: 'dot', element: 'fire', damage: 4, duration: 3 },
    ],
  },
  {
    id: 'leech',
    name: 'Leech',
    type: 'elementalAttack',
    manaCost: 8,
    classes: ['mage'],
    graphic: '/cards/leech.png',
    description: 'Siphon life with water magic, healing yourself for half the damage dealt.',
    behaviour: [{ kind: 'damage', element: 'water', scale: 0.9, lifesteal: 0.5 }],
  },

  // ---- Defensive ------------------------------------------------------
  {
    id: 'guard',
    name: 'Guard',
    type: 'defensive',
    manaCost: 4,
    classes: 'all',
    graphic: '/cards/guard.png',
    description: 'Brace for impact. Reduces incoming damage this round.',
    behaviour: [{ kind: 'mitigate', flat: 8 }],
  },
  {
    id: 'mend',
    name: 'Mend',
    type: 'defensive',
    manaCost: 6,
    classes: 'all',
    graphic: '/cards/mend.png',
    description: 'Patch your wounds, restoring a chunk of health.',
    behaviour: [{ kind: 'heal', amount: 14 }],
  },
  {
    id: 'bulwark',
    name: 'Bulwark',
    type: 'defensive',
    manaCost: 10,
    classes: ['protector'],
    graphic: '/cards/bulwark.png',
    description: 'Halve incoming damage and raise defense for the round.',
    behaviour: [
      { kind: 'mitigate', percent: 50 },
      { kind: 'modifyStat', stat: 'defense', amount: 10, target: 'self', duration: 'round' },
    ],
  },

  // ---- Bonus --------------------------------------------------------
  {
    id: 'focus',
    name: 'Focus',
    type: 'bonus',
    manaCost: 4,
    classes: 'all',
    graphic: '/cards/focus.png',
    description: 'Sharpen your aim — raises your max attack, physical and elemental, next round.',
    behaviour: [
      { kind: 'modifyStat', stat: 'attackMax', amount: 6, target: 'self', duration: 'nextRound' },
      { kind: 'modifyStat', stat: 'fireAtkMax', amount: 6, target: 'self', duration: 'nextRound' },
      { kind: 'modifyStat', stat: 'waterAtkMax', amount: 6, target: 'self', duration: 'nextRound' },
      { kind: 'modifyStat', stat: 'electricAtkMax', amount: 6, target: 'self', duration: 'nextRound' },
    ],
  },
  {
    id: 'adrenaline',
    name: 'Adrenaline',
    type: 'bonus',
    manaCost: 6,
    classes: ['fencer', 'hunter'],
    graphic: '/cards/adrenaline.png',
    description: 'A rush of energy — raises your min and max attack next round.',
    behaviour: [
      { kind: 'modifyStat', stat: 'attackMin', amount: 4, target: 'self', duration: 'nextRound' },
      { kind: 'modifyStat', stat: 'attackMax', amount: 4, target: 'self', duration: 'nextRound' },
    ],
  },

  // ---- Special ------------------------------------------------------
  {
    id: 'disrupt',
    name: 'Disrupt',
    type: 'special',
    manaCost: 12,
    classes: ['mage'],
    graphic: '/cards/disrupt.png',
    description: "Scramble your opponent's aim: cancels their attack card next round (physical or elemental).",
    behaviour: [
      { kind: 'blockCard', scope: 'nextRound', filter: { types: ['physicalAttack', 'elementalAttack'] } },
    ],
  },
  {
    id: 'overload',
    name: 'Overload',
    type: 'special',
    manaCost: 14,
    classes: ['mage', 'hunter'],
    graphic: '/cards/overload.png',
    description: 'Surge ahead in priority this round, then unleash electric damage.',
    behaviour: [
      { kind: 'adjustPriority', amount: 15, target: 'self' },
      { kind: 'damage', element: 'electric', scale: 0.8 },
    ],
  },

  // ---- Special Block ------------------------------------------------
  {
    id: 'nullify',
    name: 'Nullify',
    type: 'specialBlock',
    manaCost: 16,
    classes: 'all',
    graphic: '/cards/nullify.png',
    description: "Cancel the opponent's Special card this round.",
    behaviour: [{ kind: 'blockCard', scope: 'thisRound', filter: { types: ['special'] } }],
  },
  {
    id: 'aegis',
    name: 'Aegis',
    type: 'specialBlock',
    manaCost: 12,
    classes: ['protector', 'mage'],
    graphic: '/cards/aegis.png',
    description: "Block the opponent's Special Block and negate all damage this round.",
    behaviour: [
      { kind: 'blockCard', scope: 'thisRound', filter: { types: ['specialBlock'] } },
      { kind: 'mitigate', percent: 100 },
    ],
  },
];

const CARD_BY_ID = new Map(CARDS.map((c) => [c.id, c]));

function getCard(id) {
  return CARD_BY_ID.get(id) || null;
}

function isValidCardId(id) {
  return CARD_BY_ID.has(id);
}

function cardUsableByClass(card, classId) {
  if (!card) return false;
  return card.classes === 'all' || card.classes.includes(classId);
}

function cardsForClass(classId) {
  return CARDS.filter((c) => cardUsableByClass(c, classId));
}

function basePriorityOf(cardOrTypeId) {
  const typeId = typeof cardOrTypeId === 'string' ? cardOrTypeId : cardOrTypeId.type;
  const t = CARD_TYPES.find((x) => x.id === typeId);
  return t ? t.basePriority : 0;
}

/**
 * Does `card` match a blockCard `filter`? A missing filter matches everything.
 * `filter.types` is an array of card-type ids; `filter.type` (single id) is also
 * accepted for convenience.
 */
function cardMatchesFilter(card, filter) {
  if (!filter) return true;
  const types = filter.types || (filter.type ? [filter.type] : null);
  if (types && !types.includes(card.type)) return false;
  return true;
}

module.exports = {
  CARD_TYPES,
  CARD_TYPE_IDS,
  CARDS,
  getCard,
  isValidCardId,
  cardUsableByClass,
  cardsForClass,
  basePriorityOf,
  cardMatchesFilter,
};
