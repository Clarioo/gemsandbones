'use strict';

/**
 * The world map over Socket.IO: which location each player is currently in, and
 * searching that location for an AI enemy (which hands off to duelHub to start
 * a bot duel).
 *
 * "In a location" is transient presence, like being in the lobby: it lives in
 * memory only and is dropped on disconnect. Entering a duel does NOT remove you
 * from the location — when the duel ends you are still standing there.
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

function createLocationHub(io, { getUserById, startBotDuel }) {
  const sockets = new Map(); // userId -> socket
  const inLocation = new Map(); // userId -> locationId

  const sendState = (userId) => {
    const s = sockets.get(userId);
    if (s) s.emit('location:state', { locationId: inLocation.get(userId) || null });
  };

  function hasCharacter(userId) {
    const user = getUserById(userId);
    return !!(user && user.character && user.character.classId);
  }

  function onConnection(socket, user) {
    const userId = user.id;
    sockets.set(userId, socket);
    sendState(userId); // in case of a reconnect while still placed

    socket.on('location:enter', ({ locationId } = {}) => {
      if (!hasCharacter(userId)) return socket.emit('location:error', { error: 'no_class' });
      const loc = getLocation(locationId);
      if (!loc) return socket.emit('location:error', { error: 'unknown_location' });
      inLocation.set(userId, loc.id);
      sendState(userId);
    });

    socket.on('location:leave', () => {
      inLocation.delete(userId);
      sendState(userId);
    });

    socket.on('location:seek', () => {
      const locId = inLocation.get(userId);
      const loc = locId && getLocation(locId);
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
    inLocation.delete(userId);
    sockets.delete(userId);
  }

  return { onConnection, onDisconnect };
}

module.exports = { createLocationHub };
