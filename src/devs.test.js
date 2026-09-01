'use strict';

/** Dev-account allowlist. Run with:  npm test   (node --test) */

const test = require('node:test');
const assert = require('node:assert/strict');

const { isDevUser } = require('./devs');

test('clarioo is a dev, case-insensitively', () => {
  assert.equal(isDevUser({ username: 'clarioo' }), true);
  assert.equal(isDevUser({ username: 'Clarioo' }), true);
  assert.equal(isDevUser({ username: 'CLARIOO' }), true);
});

test('an ordinary account is not a dev', () => {
  assert.equal(isDevUser({ username: 'someone-else' }), false);
  assert.equal(isDevUser({}), false);
  assert.equal(isDevUser(null), false);
});

test('DEV_USERNAMES env adds more devs without dropping the built-ins', () => {
  const prev = process.env.DEV_USERNAMES;
  process.env.DEV_USERNAMES = 'alice, Bob';
  try {
    assert.equal(isDevUser({ username: 'alice' }), true);
    assert.equal(isDevUser({ username: 'bob' }), true);
    assert.equal(isDevUser({ username: 'clarioo' }), true);
  } finally {
    if (prev === undefined) delete process.env.DEV_USERNAMES;
    else process.env.DEV_USERNAMES = prev;
  }
});
