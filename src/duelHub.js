'use strict';

/**
 * Wires the duel engine (duel.js) to Socket.IO: a simple "find duel" queue,
 * live duel rooms, and the per-round message flow.
 *
 * Duels live in memory only. If the server restarts mid-duel the duel is lost
 * (both players drop back to the lobby). Fine for now.
 *
 * Socket events in  (all prefixed `duel:`):
 *   find                     join the matchmaking queue
 *   cancel                   leave the queue
 *   plan   { cards:[5] }      submit the opening 5-round plan
 *   card   { round, cardId }  queue the card for the far slot (rounds 6..15)
 *   ready                     confirm ready for a round that needs no card
 *   leave                    forfeit the current duel
 *
 * Socket events out:
 *   searching                you are in the queue
 *   start   { view }         a duel began
 *   update  { view }         someone's submitted flag changed
 *   round   { view, entry }  a round resolved (entry = this round's log)
 *   end     { view }         the duel ended
 *   error   { error }        something was rejected
 */

const crypto = require('crypto');
const duelEngine = require('./duel');
const { isDuelLegal } = require('./deck');

function createDuelHub(io, { getUserById }) {
  const queue = []; // userIds waiting
  const sockets = new Map(); // userId -> socket
  const duels = new Map(); // duelId -> duel
  const userDuel = new Map(); // userId -> duelId

  const socketOf = (userId) => sockets.get(userId);

  function sendViews(duel, event, perUserExtra = () => ({})) {
    for (const uid of duel.order) {
      const s = socketOf(uid);
      if (s) s.emit(`duel:${event}`, { ...perUserExtra(uid), view: duelEngine.viewFor(duel, uid) });
    }
  }

  function currentCharacter(userId) {
    const user = getUserById(userId);
    const c = user && user.character;
    if (!c || !c.classId) return null;
    return { user, character: c };
  }

  function tryStartMatch() {
    while (queue.length >= 2) {
      const aId = queue.shift();
      const bId = queue.shift();
      const a = currentCharacter(aId);
      const b = currentCharacter(bId);

      // If someone became ineligible while waiting, drop them and continue.
      if (!a || !isDuelLegal(a.character.deck, a.character.classId)) {
        if (socketOf(aId)) socketOf(aId).emit('duel:error', { error: 'deck_not_duel_legal' });
        if (b) queue.unshift(bId);
        continue;
      }
      if (!b || !isDuelLegal(b.character.deck, b.character.classId)) {
        if (socketOf(bId)) socketOf(bId).emit('duel:error', { error: 'deck_not_duel_legal' });
        queue.unshift(aId);
        continue;
      }

      const id = crypto.randomUUID();
      const mk = ({ user, character }) => ({
        userId: user.id,
        name: character.name,
        classId: character.classId,
        level: character.level || 1,
        deck: [...character.deck],
      });
      const duel = duelEngine.createDuel(id, mk(a), mk(b));
      duels.set(id, duel);
      userDuel.set(aId, id);
      userDuel.set(bId, id);
      sendViews(duel, 'start');
    }
  }

  function afterSubmit(duel) {
    if (duelEngine.bothSubmitted(duel)) {
      const entry = duelEngine.resolveRound(duel);
      sendViews(duel, 'round', () => ({ entry }));
      if (duel.phase === 'ended') {
        sendViews(duel, 'end');
        cleanupDuel(duel);
      }
    } else {
      sendViews(duel, 'update');
    }
  }

  function cleanupDuel(duel) {
    for (const uid of duel.order) userDuel.delete(uid);
    duels.delete(duel.id);
  }

  function duelOf(userId) {
    const id = userDuel.get(userId);
    return id ? duels.get(id) : null;
  }

  function leaveQueue(userId) {
    const i = queue.indexOf(userId);
    if (i !== -1) queue.splice(i, 1);
  }

  function handleLeave(userId) {
    const duel = duelOf(userId);
    if (!duel || duel.phase === 'ended') return;
    duelEngine.forfeit(duel, userId);
    sendViews(duel, 'end');
    cleanupDuel(duel);
  }

  // -- per-connection wiring ------------------------------------------------
  function onConnection(socket, user) {
    const userId = user.id;
    sockets.set(userId, socket);

    socket.on('duel:find', () => {
      if (duelOf(userId)) return socket.emit('duel:error', { error: 'already_in_duel' });
      const c = currentCharacter(userId);
      if (!c) return socket.emit('duel:error', { error: 'no_class' });
      if (!isDuelLegal(c.character.deck, c.character.classId)) {
        return socket.emit('duel:error', { error: 'deck_not_duel_legal' });
      }
      if (!queue.includes(userId)) queue.push(userId);
      socket.emit('duel:searching');
      tryStartMatch();
    });

    socket.on('duel:cancel', () => {
      leaveQueue(userId);
    });

    socket.on('duel:plan', ({ cards } = {}) => {
      const duel = duelOf(userId);
      if (!duel) return socket.emit('duel:error', { error: 'not_in_duel' });
      const r = duelEngine.submitPlan(duel, userId, cards);
      if (!r.ok) return socket.emit('duel:error', { error: r.error });
      afterSubmit(duel);
    });

    socket.on('duel:card', ({ round, cardId } = {}) => {
      const duel = duelOf(userId);
      if (!duel) return socket.emit('duel:error', { error: 'not_in_duel' });
      const r = duelEngine.submitCard(duel, userId, cardId);
      if (!r.ok) return socket.emit('duel:error', { error: r.error });
      afterSubmit(duel);
    });

    socket.on('duel:ready', () => {
      const duel = duelOf(userId);
      if (!duel) return;
      const r = duelEngine.markReady(duel, userId);
      if (!r.ok) return socket.emit('duel:error', { error: r.error });
      afterSubmit(duel);
    });

    socket.on('duel:leave', () => handleLeave(userId));
  }

  function onDisconnect(userId) {
    leaveQueue(userId);
    handleLeave(userId);
    if (sockets.get(userId)) sockets.delete(userId);
  }

  return { onConnection, onDisconnect };
}

module.exports = { createDuelHub };
