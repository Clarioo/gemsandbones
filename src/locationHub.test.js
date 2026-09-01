'use strict';

/**
 * locationHub tests: presence is persisted on the character, so a disconnect /
 * reconnect (page reload) keeps the player in the location.
 *
 * Run with:  npm test   (node --test)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { createLocationHub } = require('./locationHub');

/** Minimal fakes for the deps createLocationHub expects. */
function harness() {
  const user = { id: 'u1', character: { classId: 'mage', level: 3, locationId: null } };
  const deps = {
    getUserById: (id) => (id === 'u1' ? user : null),
    setCharacterLocation: (id, locId) => {
      if (id === 'u1') user.character.locationId = locId || null;
    },
    startBotDuel: (id, opts) => {
      harness.lastDuel = { id, opts };
      return { ok: true };
    },
  };
  const hub = createLocationHub({}, deps);

  function connect() {
    const socket = new EventEmitter();
    const out = [];
    socket.emit = (ev, payload) => out.push([ev, payload]);
    hub.onConnection(socket, user);
    const fire = (ev, payload) =>
      socket.listeners(ev).forEach((fn) => fn(payload));
    return { out, fire, disconnect: () => hub.onDisconnect(user.id) };
  }

  return { user, connect };
}

test('entering a location persists it and is echoed as state', () => {
  const { user, connect } = harness();
  const s = connect();
  s.out.length = 0;

  s.fire('location:enter', { locationId: 'whisperwood-fringe' });
  assert.equal(user.character.locationId, 'whisperwood-fringe');
  assert.deepEqual(s.out.at(-1), ['location:state', { locationId: 'whisperwood-fringe' }]);
});

test('a reload (disconnect + reconnect) keeps the player in the location', () => {
  const { connect } = harness();
  const s1 = connect();
  s1.fire('location:enter', { locationId: 'whisperwood-fringe' });
  s1.disconnect();

  const s2 = connect();
  assert.deepEqual(s2.out[0], ['location:state', { locationId: 'whisperwood-fringe' }]);
});

test('leaving clears the persisted location', () => {
  const { user, connect } = harness();
  const s = connect();
  s.fire('location:enter', { locationId: 'whisperwood-fringe' });
  s.fire('location:leave');
  assert.equal(user.character.locationId, null);
  assert.deepEqual(s.out.at(-1), ['location:state', { locationId: null }]);
});

test('enter rejects an unknown location', () => {
  const { user, connect } = harness();
  const s = connect();
  s.fire('location:enter', { locationId: 'atlantis' });
  assert.equal(user.character.locationId, null);
  assert.deepEqual(s.out.at(-1), ['location:error', { error: 'unknown_location' }]);
});

test('seek outside a location errors; inside it starts a bot duel with a rolled enemy', () => {
  const { connect } = harness();
  const s = connect();

  s.fire('location:seek');
  assert.deepEqual(s.out.at(-1), ['location:error', { error: 'not_in_location' }]);

  s.fire('location:enter', { locationId: 'whisperwood-fringe' });
  s.fire('location:seek');
  const { opts } = harness.lastDuel;
  assert.ok(opts.level >= 1 && opts.level <= 5);
  assert.equal(typeof opts.botClassId, 'string');
  assert.match(opts.botName, /Lvl \d+/);
});
