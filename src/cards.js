'use strict';

/**
 * Card catalog + card types.
 *
 * This is the DATA layer only. Playing a card and running its behaviour during
 * a duel (the "Card Behaviour" logic) is not built yet -- see the notes on the
 * `behaviour` field below.
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
 * CARD BEHAVIOUR (placeholder shape)
 * ---------------------------------------------------------------------------
 * `behaviour` is an array of effect descriptors, each with a `kind`. A card can
 * have several. The duel engine will read these; nothing executes them yet.
 * Intended kinds (to be finalised later):
 *
 *   { kind: 'damage',      element: 'physical'|'fire'|'water'|'electric', scale: <number> }
 *   { kind: 'mitigate',    percent?: number, flat?: number }
 *   { kind: 'modifyStat',  stat: <statId>, amount: number,
 *                          target: 'self'|'opponent', duration: 'round'|'duel' }
 *   { kind: 'blockCard',   scope: 'thisRound'|'nextRound', filter?: { type?: <typeId> } }
 *   { kind: 'adjustPriority', amount: number, target: 'self'|'opponent' }
 *
 * Keep entries data-only (no functions) so cards stay serialisable.
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
    description: 'Sharpen your aim. Raises max attack for the round.',
    behaviour: [{ kind: 'modifyStat', stat: 'attackMax', amount: 6, target: 'self', duration: 'round' }],
  },
  {
    id: 'adrenaline',
    name: 'Adrenaline',
    type: 'bonus',
    manaCost: 6,
    classes: ['fencer', 'hunter'],
    graphic: '/cards/adrenaline.png',
    description: 'A rush of energy. Raises min and max attack for the round.',
    behaviour: [
      { kind: 'modifyStat', stat: 'attackMin', amount: 4, target: 'self', duration: 'round' },
      { kind: 'modifyStat', stat: 'attackMax', amount: 4, target: 'self', duration: 'round' },
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
    description: "Scramble your opponent's next play, blocking their card next round.",
    behaviour: [{ kind: 'blockCard', scope: 'nextRound' }],
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
    behaviour: [{ kind: 'blockCard', scope: 'thisRound', filter: { type: 'special' } }],
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
      { kind: 'blockCard', scope: 'thisRound', filter: { type: 'specialBlock' } },
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

module.exports = {
  CARD_TYPES,
  CARD_TYPE_IDS,
  CARDS,
  getCard,
  isValidCardId,
  cardUsableByClass,
  cardsForClass,
  basePriorityOf,
};
