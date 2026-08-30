'use strict';

/**
 * Deck rules and the starter deck.
 *
 * A deck is a plain array of card ids; repeats mean multiple copies.
 * Limits are starting values -- tune freely.
 *
 * A duel plays 15 cards, one per round, with no reshuffle, so a deck must hold
 * at least DECK_MIN cards to be duel-legal. Deckbuilding still lets you save a
 * smaller deck (validateDeck) -- you just cannot queue for a duel with it.
 */

const { getCard, cardUsableByClass, cardsForClass } = require('./cards');

const DECK_MIN = 15; // needed to start a duel
const DECK_MAX = 25; // hard cap
const MAX_COPIES = 3; // per distinct card

/**
 * Validate a proposed deck for a class (deckbuilding rules -- no minimum).
 * Returns { ok: true, deck } or { ok: false, error }.
 */
function validateDeck(deck, classId) {
  if (!Array.isArray(deck)) return { ok: false, error: 'deck_must_be_array' };
  if (deck.length > DECK_MAX) return { ok: false, error: 'deck_too_large' };

  const counts = new Map();
  for (const id of deck) {
    const card = getCard(id);
    if (!card) return { ok: false, error: `unknown_card:${id}` };
    if (!cardUsableByClass(card, classId)) {
      return { ok: false, error: `class_cannot_use:${id}` };
    }
    counts.set(id, (counts.get(id) || 0) + 1);
    if (counts.get(id) > MAX_COPIES) {
      return { ok: false, error: `too_many_copies:${id}` };
    }
  }
  return { ok: true, deck: [...deck] };
}

/** Deckbuilding-legal (used to decide whether a class change resets the deck). */
function deckIsLegal(deck, classId) {
  return Array.isArray(deck) && validateDeck(deck, classId).ok;
}

/** Deckbuilding-legal AND big enough to start a duel. */
function isDuelLegal(deck, classId) {
  return deckIsLegal(deck, classId) && deck.length >= DECK_MIN;
}

/**
 * A reasonable starting deck for a class: cycle through every card the class
 * can use, adding copies (up to MAX_COPIES) until we reach DECK_MIN.
 */
function defaultDeckForClass(classId) {
  const usable = cardsForClass(classId);
  if (!usable.length) return [];

  const deck = [];
  const counts = new Map();
  let progressed = true;
  while (deck.length < DECK_MIN && progressed) {
    progressed = false;
    for (const card of usable) {
      if (deck.length >= DECK_MIN) break;
      const n = counts.get(card.id) || 0;
      if (n < MAX_COPIES) {
        counts.set(card.id, n + 1);
        deck.push(card.id);
        progressed = true;
      }
    }
  }
  return deck;
}

module.exports = {
  DECK_MIN,
  DECK_MAX,
  MAX_COPIES,
  validateDeck,
  deckIsLegal,
  isDuelLegal,
  defaultDeckForClass,
};
