'use strict';

/**
 * The world map over Socket.IO: which location each player is currently in, and
 * searching that location for an AI enemy (which hands off to duelHub to start
 * a bot duel).
 *
 * The current location is stored on the character (db.js), so a page reload or
 * a server restart keeps you where you were. Entering a duel does NOT move you
 * out of the location — when the duel ends you are still standing there.
 * (Travel is free and unrestricted for now; level gates / travel costs come
 * later.)
 *
 * Socket events in (all prefixed `location:`):
 *   enter  { locationId }   travel to a location
 *   leave                   return to the lobby
 *   seek                    look for an AI enemy in the current location
 *
 * Socket events out:
 *   state  { locationId }   your current location (null = not in one)
 *   error  { error }        a request was rejected
 */

const { getLocation, rollEnemy } = require('./locations');

function createLocationHub(io, { getUserById, setCharacterLocation, startBotDuel }) {
  const sockets = new Map(); // userId -> socket

  const characterOf = (userId) => {
    const user = getUserById(userId);
    return user && user.character && user.character.classId ? user.character : null;
  };

  const locationIdOf = (userId) => {
    const c = characterOf(userId);
    return c ? c.locationId || null : null;
  };

  const sendState = (userId) => {
    const s = sockets.get(userId);
    if (s) s.emit('location:state', { locationId: locationIdOf(userId) });
  };

  function onConnection(socket, user) {
    const userId = user.id;
    sockets.set(userId, socket);
    sendState(userId); // tell the client where they left off

    socket.on('location:enter', ({ locationId } = {}) => {
      if (!characterOf(userId)) return socket.emit('location:error', { error: 'no_class' });
      const loc = getLocation(locationId);
      if (!loc) return socket.emit('location:error', { error: 'unknown_location' });
      setCharacterLocation(userId, loc.id);
      sendState(userId);
    });

    socket.on('location:leave', () => {
      if (characterOf(userId)) setCharacterLocation(userId, null);
      sendState(userId);
    });

    socket.on('location:seek', () => {
      const loc = getLocation(locationIdOf(userId));
      if (!loc) return socket.emit('location:error', { error: 'not_in_location' });

      const enemy = rollEnemy(loc);
      const r = startBotDuel(userId, {
        level: enemy.level,
        botClassId: enemy.classId,
        botName: enemy.name,
      });
      if (!r.ok) socket.emit('location:error', { error: r.error });
    });
  }

  function onDisconnect(userId) {
    sockets.delete(userId);
    // location is persisted on the character — nothing to clear here
  }

  return { onConnection, onDisconnect };
}

module.exports = { createLocationHub };
