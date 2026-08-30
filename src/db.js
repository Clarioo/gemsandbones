'use strict';

/**
 * Tiny JSON-file "database".
 *
 * This is intentionally the simplest thing that works so you can focus on the
 * game first. It keeps every user in data/db.json. When you outgrow it (a few
 * hundred concurrent players, or you want match history / stats), swap this
 * file for PostgreSQL or SQLite -- the rest of the app only calls the three
 * functions exported at the bottom.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { deckIsLegal, defaultDeckForClass } = require('./deck');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { users: [] };
  }
}

function save(data) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

/**
 * Insert the user if their Discord id is new, otherwise refresh their profile.
 * Returns the stored user record.
 */
function upsertUser({ discordId, username, globalName, avatar }) {
  const data = load();
  const now = new Date().toISOString();
  let user = data.users.find((u) => u.discordId === discordId);

  if (user) {
    user.username = username;
    user.globalName = globalName;
    user.avatar = avatar;
    user.lastLogin = now;
  } else {
    user = {
      id: crypto.randomUUID(),
      discordId,
      username,
      globalName,
      avatar,
      createdAt: now,
      lastLogin: now,
    };
    data.users.push(user);
  }

  save(data);
  return user;
}

function getUserById(id) {
  return load().users.find((u) => u.id === id) || null;
}

/**
 * Make sure the user has a character object, seeding the name from their
 * Discord name the first time. Returns the character (mutates `user`).
 */
function ensureCharacter(user) {
  if (!user.character) {
    user.character = {
      name: user.globalName || user.username,
      classId: null,
      level: 1,
      createdAt: new Date().toISOString(),
    };
  }
  // Backfill for characters created before `level` existed.
  if (typeof user.character.level !== 'number') user.character.level = 1;
  return user.character;
}

/** Set (or change) the character's class. Returns the character, or null. */
function setCharacterClass(userId, classId) {
  const data = load();
  const user = data.users.find((u) => u.id === userId);
  if (!user) return null;

  const character = ensureCharacter(user);
  character.classId = classId;

  // Give a fresh character a starter deck, and reset the deck if a class change
  // left it with cards the new class cannot use.
  if (!Array.isArray(character.deck) || !character.deck.length ||
      !deckIsLegal(character.deck, classId)) {
    character.deck = defaultDeckForClass(classId);
  }

  save(data);
  return character;
}

/** Replace the character's deck. Caller must validate first. Returns character. */
function setDeck(userId, deck) {
  const data = load();
  const user = data.users.find((u) => u.id === userId);
  if (!user) return null;

  const character = ensureCharacter(user);
  character.deck = [...deck];
  save(data);
  return character;
}

/** Rename the character. Returns the character, or null. */
function setCharacterName(userId, name) {
  const data = load();
  const user = data.users.find((u) => u.id === userId);
  if (!user) return null;

  const character = ensureCharacter(user);
  character.name = name;
  save(data);
  return character;
}

/** Set the character's level. Returns the character, or null. */
function setCharacterLevel(userId, level) {
  const data = load();
  const user = data.users.find((u) => u.id === userId);
  if (!user) return null;

  const character = ensureCharacter(user);
  character.level = level;
  save(data);
  return character;
}

module.exports = {
  upsertUser,
  getUserById,
  setCharacterClass,
  setCharacterName,
  setCharacterLevel,
  setDeck,
};
