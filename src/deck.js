'use strict';

/**
 * Deck rules and the starter deck.
 *
 * A deck is a plain array of card ids; repeats mean multiple copies.
 * Limits are starting values -- tune freely.
 */

const { CARDS, getCard, cardUsableByClass, cardsForClass } = require('./cards');

const DECK_MIN = 10; // advisory (client hint) -- not rejected by the server yet
const DECK_MAX = 20; // hard limit
const MAX_COPIES = 3; // per distinct card

/**
 * Validate a proposed deck for a class.
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

/** Is every card in this deck still legal for the class? */
function deckIsLegal(deck, classId) {
  return Array.isArray(deck) && validateDeck(deck, classId).ok;
}

/**
 * A reasonable starting deck for a class: two copies of every card the class
 * can use, capped at DECK_MAX.
 */
function defaultDeckForClass(classId) {
  const usable = cardsForClass(classId);
  const deck = [];
  for (let copy = 0; copy < 2; copy++) {
    for (const card of usable) {
      if (deck.length >= DECK_MAX) return deck;
      deck.push(card.id);
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
  defaultDeckForClass,
};
