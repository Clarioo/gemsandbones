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

module.exports = { upsertUser, getUserById };
