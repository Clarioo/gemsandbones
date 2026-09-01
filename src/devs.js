'use strict';

/**
 * Dev accounts: allowed to use tools ordinary players can't, currently
 * "set my level by hand" and "re-pick my class after setup".
 *
 * Add a Discord username below, or set DEV_USERNAMES="name1,name2" in the
 * environment (comma-separated, case-insensitive). Nothing else in the app
 * hard-codes who is a dev.
 */

const BUILT_IN = ['clarioo'];

function devUsernames() {
  const extra = (process.env.DEV_USERNAMES || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...BUILT_IN, ...extra]);
}

/** Is this stored user record a dev account? */
function isDevUser(user) {
  if (!user || !user.username) return false;
  return devUsernames().has(user.username.toLowerCase());
}

module.exports = { isDevUser };
