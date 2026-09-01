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
 *   practice                 start a duel against a simple bot (solo testing)
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
const duelBot = require('./duelBot');
const { isDuelLegal, defaultDeckForClass } = require('./deck');
const { CLASSES } = require('./classes');
const { equippedItemMods, rollEnemyLoadout } = require('./items');

function createDuelHub(io, { getUserById, wearEquipped = () => {} }) {
  const queue = []; // userIds waiting
  const sockets = new Map(); // userId -> socket
  const duels = new Map(); // duelId -> duel
  const userDuel = new Map(); // userId -> duelId
  const timers = new Map(); // duelId -> timeout handle
  const botDuels = new Map(); // duelId -> bot userId (practice duels)

  const socketOf = (userId) => sockets.get(userId);

  function clearDuelTimer(duel) {
    const h = timers.get(duel.id);
    if (h) clearTimeout(h);
    timers.delete(duel.id);
    duel.deadline = null;
  }

  /** Arm the planning-phase timer; on expiry the server picks for whoever stalled. */
  function armDuelTimer(duel) {
    clearDuelTimer(duel);
    if (duel.phase !== 'planning') return;
    const ms = duelEngine.planningMs(duel);
    duel.deadline = Date.now() + ms;
    timers.set(
      duel.id,
      setTimeout(() => {
        for (const uid of duel.order) duelEngine.autoSubmit(duel, uid);
        resolveAndAdvance(duel, { timedOut: true });
      }, ms),
    );
  }

  function resolveAndAdvance(duel, extra = {}) {
    clearDuelTimer(duel);
    const entry = duelEngine.resolveRound(duel);
    if (duel.phase === 'ended') {
      sendViews(duel, 'round', () => ({ entry, ...extra }));
      sendViews(duel, 'end');
      cleanupDuel(duel);
    } else {
      armDuelTimer(duel); // set the next deadline before broadcasting
      sendViews(duel, 'round', () => ({ entry, ...extra }));
      if (botAct(duel)) sendViews(duel, 'update'); // let the bot pre-submit
    }
  }

  /**
   * If this is a practice duel and the bot still needs to act this planning
   * phase, make it act. Returns whether it did anything.
   */
  function botAct(duel) {
    const botId = botDuels.get(duel.id);
    if (!botId || duel.phase !== 'planning') return false;
    const bot = duel.players[botId];
    if (bot.submitted) return false;

    if (duel.round === 1 && Object.keys(bot.plan).length === 0) {
      duelEngine.submitPlan(duel, botId, duelBot.chooseOpeningPlan(bot));
    } else if (duelEngine.slotToFill(duel) !== null) {
      const cardId = duelBot.chooseCard(duel, bot);
      if (cardId) duelEngine.submitCard(duel, botId, cardId);
      else { duelEngine.markReady(duel, botId); bot.submitted = true; }
    } else {
      duelEngine.markReady(duel, botId);
    }
    if (!bot.submitted) duelEngine.autoSubmit(duel, botId); // failsafe
    return true;
  }

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
        itemMods: equippedItemMods(character),
      });
      const duel = duelEngine.createDuel(id, mk(a), mk(b));
      duels.set(id, duel);
      userDuel.set(aId, id);
      userDuel.set(bId, id);
      wearEquipped(aId);
      wearEquipped(bId);
      armDuelTimer(duel);
      sendViews(duel, 'start');
    }
  }

  function afterSubmit(duel) {
    botAct(duel); // in a practice duel, respond to the human's submission
    if (duelEngine.bothSubmitted(duel)) {
      resolveAndAdvance(duel);
    } else {
      sendViews(duel, 'update');
    }
  }

  function cleanupDuel(duel) {
    clearDuelTimer(duel);
    for (const uid of duel.order) userDuel.delete(uid);
    botDuels.delete(duel.id);
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

  /**
   * Start a duel against a bot. Used by "Practice vs Bot" (no opts -> a random
   * class at the player's own level) and by the world map (opts pin the enemy's
   * class, level and name from the location). Returns { ok } / { ok:false, error }.
   */
  function startBotDuel(userId, opts = {}) {
    if (duelOf(userId)) return { ok: false, error: 'already_in_duel' };
    const c = currentCharacter(userId);
    if (!c) return { ok: false, error: 'no_class' };
    if (!isDuelLegal(c.character.deck, c.character.classId)) {
      return { ok: false, error: 'deck_not_duel_legal' };
    }
    leaveQueue(userId);

    const fallbackClass = CLASSES[Math.floor(Math.random() * CLASSES.length)];
    const botClassId = opts.botClassId || fallbackClass.id;
    const botLevel = opts.level || c.character.level || 1;
    const botName =
      opts.botName ||
      `Training Bot (${(CLASSES.find((k) => k.id === botClassId) || fallbackClass).name})`;

    const human = {
      userId,
      name: c.character.name,
      classId: c.character.classId,
      level: c.character.level || 1,
      deck: [...c.character.deck],
      itemMods: equippedItemMods(c.character),
    };
    const bot = {
      userId: `bot:${crypto.randomUUID()}`,
      name: botName,
      classId: botClassId,
      level: botLevel,
      deck: defaultDeckForClass(botClassId),
      itemMods: rollEnemyLoadout(botClassId, botLevel), // AI enemies wear a full level-scaled kit
    };

    const id = crypto.randomUUID();
    const duel = duelEngine.createDuel(id, human, bot);
    duels.set(id, duel);
    userDuel.set(userId, id);
    botDuels.set(id, bot.userId);
    wearEquipped(userId);
    armDuelTimer(duel);
    sendViews(duel, 'start');
    if (botAct(duel)) sendViews(duel, 'update');
    return { ok: true };
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

    socket.on('duel:practice', () => {
      const r = startBotDuel(userId);
      if (!r.ok) socket.emit('duel:error', { error: r.error });
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

  return { onConnection, onDisconnect, startBotDuel };
}

module.exports = { createDuelHub };
