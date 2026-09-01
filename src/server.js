'use strict';

require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const expressSession = require('express-session');
const { Server } = require('socket.io');

const { getAuthorizeUrl, exchangeCode, fetchDiscordUser } = require('./discord');
const {
  upsertUser,
  getUserById,
  setCharacterClass,
  setCharacterLevel,
  setCharacterLocation,
  setDeck,
  addItemToBag,
  equipItem,
  unequipSlot,
  dropItem,
  wearEquipped,
} = require('./db');
const { CLASSES, isValidClassId, getClass } = require('./classes');
const { STAT_GROUPS, resolveStats } = require('./stats');
const { CARD_TYPES, CARDS, getCard, cardUsableByClass } = require('./cards');
const {
  DECK_MIN,
  DECK_MAX,
  MAX_COPIES,
  validateDeck,
  defaultDeckForClass,
} = require('./deck');
const { createDuelHub } = require('./duelHub');
const { createLocationHub } = require('./locationHub');
const { LOCATIONS, toPublicLocation } = require('./locations');
const { isDevUser } = require('./devs');
const {
  SLOTS,
  BAG_MAX,
  rollRandomItem,
  canEquip,
  equippedItemMods,
} = require('./items');

const DECK_LIMITS = { min: DECK_MIN, max: DECK_MAX, maxCopies: MAX_COPIES };

const MAX_LEVEL = 50;

const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
  console.warn(
    '\n[!] DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET are not set.\n' +
      '    Copy .env.example to .env and fill them in, or login will fail.\n'
  );
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
// Where logged-in sessions are stored:
//   - REDIS_URL set   -> Redis (survives restarts, works with multiple
//                        processes). This is what the VPS uses.
//   - REDIS_URL unset -> in-memory (fine for local dev; forgets everyone on
//                        restart, single process only).
let sessionStore; // undefined => express-session falls back to MemoryStore

if (process.env.REDIS_URL) {
  const { createClient } = require('redis');
  const { RedisStore } = require('connect-redis');

  const redisClient = createClient({ url: process.env.REDIS_URL });
  redisClient.on('error', (err) => console.error('Redis error:', err));
  redisClient.connect().then(
    () => console.log('Session store: Redis'),
    (err) => console.error('Redis connection failed:', err)
  );

  sessionStore = new RedisStore({ client: redisClient, prefix: 'gnb:sess:' });
} else {
  console.warn('Session store: in-memory (set REDIS_URL to use Redis)');
}

const sessionMiddleware = expressSession({
  store: sessionStore,
  name: 'gnb.sid',
  secret: process.env.SESSION_SECRET || 'dev-only-insecure-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd, // requires HTTPS in production (nginx terminates TLS)
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  },
});

app.set('trust proxy', 1); // we sit behind nginx
app.use(express.json());
app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, '..', 'public')));

/** Middleware: require a logged-in user, attach it as req.user. */
function requireAuth(req, res, next) {
  const user = req.session.userId && getUserById(req.session.userId);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  req.user = user;
  next();
}

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------
app.get('/auth/discord', (req, res) => {
  // "state" protects against CSRF: we generate it, stash it in the session,
  // and check it matches when Discord redirects back.
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  res.redirect(getAuthorizeUrl(state));
});

app.get('/auth/discord/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code || !state || state !== req.session.oauthState) {
      return res.status(400).send('Login check failed. <a href="/">Try again</a>.');
    }
    delete req.session.oauthState;

    const token = await exchangeCode(code);
    const profile = await fetchDiscordUser(token.access_token);

    const user = upsertUser({
      discordId: profile.id,
      username: profile.username,
      globalName: profile.global_name,
      avatar: profile.avatar,
    });

    // Log them in: from now on the browser just sends the session cookie.
    req.session.userId = user.id;
    res.redirect('/');
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.status(500).send('Login failed. <a href="/">Back</a>.');
  }
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('gnb.sid');
    res.json({ ok: true });
  });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: toPublicUser(req.user) });
});

// ---------------------------------------------------------------------------
// Character setup
// ---------------------------------------------------------------------------

/** The class list for the picker in the browser. */
app.get('/api/classes', (req, res) => {
  res.json({ classes: CLASSES });
});

/**
 * Pick the player's class. Everyone gets one first pick (character setup);
 * changing it afterwards is a dev-only tool.
 */
app.post('/api/character/class', requireAuth, (req, res) => {
  const { classId } = req.body || {};
  if (!isValidClassId(classId)) {
    return res.status(400).json({ error: 'invalid_class' });
  }
  const alreadyPicked = req.user.character && req.user.character.classId;
  if (alreadyPicked && !isDevUser(req.user)) {
    return res.status(403).json({ error: 'class_locked' });
  }
  const character = setCharacterClass(req.user.id, classId);
  res.json({ character: toPublicCharacter(character) });
});

/** The world map: places a player can travel to and fight in. */
app.get('/api/locations', (req, res) => {
  res.json({ locations: LOCATIONS.map(toPublicLocation) });
});

/** The stat categories + labels, for rendering the character sheet. */
app.get('/api/stats/definitions', (req, res) => {
  res.json({ groups: STAT_GROUPS });
});

/**
 * Set the character's level directly. Dev-only tool for previewing stat
 * scaling until XP-based leveling exists.
 */
app.post('/api/character/level', requireAuth, (req, res) => {
  if (!isDevUser(req.user)) return res.status(403).json({ error: 'not_dev' });
  const level = Math.floor(Number(req.body && req.body.level));
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) {
    return res.status(400).json({ error: 'invalid_level', min: 1, max: MAX_LEVEL });
  }
  const character = setCharacterLevel(req.user.id, level);
  res.json({ character: toPublicCharacter(character) });
});

// ---------------------------------------------------------------------------
// Cards & deck
// ---------------------------------------------------------------------------

/** Card types in priority order (highest first). */
app.get('/api/cards/types', (req, res) => {
  res.json({ types: CARD_TYPES });
});

/** The whole card catalog, flagged with whether this player's class can use each. */
app.get('/api/cards', requireAuth, (req, res) => {
  const classId = req.user.character && req.user.character.classId;
  res.json({
    cards: CARDS.map((c) => ({ ...c, usable: classId ? cardUsableByClass(c, classId) : false })),
    limits: DECK_LIMITS,
  });
});

/** This player's deck, as full card objects (in stored order). */
app.get('/api/deck', requireAuth, (req, res) => {
  const ch = req.user.character;
  if (!ch || !ch.classId) return res.status(409).json({ error: 'no_class' });
  const deck = Array.isArray(ch.deck) ? ch.deck : [];
  res.json({
    deck,
    cards: deck.map(getCard).filter(Boolean),
    limits: DECK_LIMITS,
  });
});

/** Replace this player's deck. Body: { deck: cardId[] }. */
app.put('/api/deck', requireAuth, (req, res) => {
  const ch = req.user.character;
  if (!ch || !ch.classId) return res.status(409).json({ error: 'no_class' });

  const result = validateDeck(req.body && req.body.deck, ch.classId);
  if (!result.ok) return res.status(400).json({ error: result.error, limits: DECK_LIMITS });

  const character = setDeck(req.user.id, result.deck);
  res.json({ deck: character.deck });
});

/** Replace the deck with the starter deck for the player's class. */
app.post('/api/deck/reset', requireAuth, (req, res) => {
  const ch = req.user.character;
  if (!ch || !ch.classId) return res.status(409).json({ error: 'no_class' });
  const character = setDeck(req.user.id, defaultDeckForClass(ch.classId));
  res.json({ deck: character.deck });
});

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------

/** DEV ONLY: roll a random item and drop it in the bag. */
app.post('/api/items/generate', requireAuth, (req, res) => {
  if (!isDevUser(req.user)) return res.status(403).json({ error: 'not_dev' });
  const ch = req.user.character;
  if (!ch || !ch.classId) return res.status(409).json({ error: 'no_class' });

  const item = rollRandomItem();
  const result = addItemToBag(req.user.id, item);
  if (result.error) {
    return res.status(400).json({ error: result.error, bagMax: BAG_MAX });
  }
  res.json({ item, character: toPublicCharacter(result.character) });
});

/** Equip an owned item into its slot. Body: { uid }. */
app.post('/api/equipment/equip', requireAuth, (req, res) => {
  const ch = req.user.character;
  if (!ch || !ch.classId) return res.status(409).json({ error: 'no_class' });

  const item = (ch.bag || []).find((i) => i.uid === (req.body && req.body.uid));
  if (!item) return res.status(404).json({ error: 'not_in_bag' });

  const check = canEquip(ch, item);
  if (!check.ok) return res.status(400).json({ error: check.error });

  const character = equipItem(req.user.id, item.uid);
  res.json({ character: toPublicCharacter(character) });
});

/** Clear a slot. Body: { slot }. */
app.post('/api/equipment/unequip', requireAuth, (req, res) => {
  const slot = req.body && req.body.slot;
  if (!SLOTS.includes(slot)) return res.status(400).json({ error: 'bad_slot' });
  const character = unequipSlot(req.user.id, slot);
  res.json({ character: toPublicCharacter(character) });
});

/** Remove an item from the bag entirely. Body: { uid }. */
app.post('/api/items/drop', requireAuth, (req, res) => {
  const uid = req.body && req.body.uid;
  if (!uid) return res.status(400).json({ error: 'missing_uid' });
  const character = dropItem(req.user.id, uid);
  res.json({ character: toPublicCharacter(character) });
});

/** Only expose safe, display-oriented fields to the browser. */
function toPublicUser(u) {
  const avatarUrl = u.avatar
    ? `https://cdn.discordapp.com/avatars/${u.discordId}/${u.avatar}.png?size=64`
    : 'https://cdn.discordapp.com/embed/avatars/0.png';
  return {
    id: u.id,
    username: u.username,
    displayName: u.globalName || u.username,
    avatarUrl,
    isDev: isDevUser(u),
    character: toPublicCharacter(u.character),
  };
}

/** null until the player has picked a class. */
function toPublicCharacter(c) {
  if (!c || !c.classId) return null;
  const cls = getClass(c.classId);
  const level = c.level || 1;
  return {
    name: c.name,
    classId: c.classId,
    className: cls ? cls.name : c.classId,
    level,
    locationId: c.locationId || null,
    deckSize: Array.isArray(c.deck) ? c.deck.length : 0,
    stats: resolveStats({ classId: c.classId, level, itemMods: equippedItemMods(c) }),
    baseStats: resolveStats({ classId: c.classId, level }),
    bag: Array.isArray(c.bag) ? c.bag : [],
    bagMax: BAG_MAX,
    equipment: SLOTS.reduce(
      (o, s) => ({ ...o, [s]: (c.equipment && c.equipment[s]) || null }),
      {},
    ),
  };
}

// ---------------------------------------------------------------------------
// Real-time lobby (Socket.IO), authenticated with the same session cookie
// ---------------------------------------------------------------------------
io.engine.use(sessionMiddleware);

const duelHub = createDuelHub(io, { getUserById, wearEquipped });
const locationHub = createLocationHub(io, {
  getUserById,
  setCharacterLocation,
  startBotDuel: duelHub.startBotDuel,
});

io.on('connection', (socket) => {
  const session = socket.request.session;
  const user = session && session.userId && getUserById(session.userId);

  if (!user) {
    socket.emit('auth_required');
    socket.disconnect(true);
    return;
  }

  const me = toPublicUser(user);
  const shownName = me.character ? me.character.name : me.displayName;
  socket.data.user = me;

  socket.emit('welcome', { user: me });
  socket.broadcast.emit('system', `${shownName} joined the lobby`);
  broadcastPlayerCount();

  duelHub.onConnection(socket, user);
  locationHub.onConnection(socket, user);

  socket.on('chat', (text) => {
    if (typeof text !== 'string') return;
    const clean = text.trim().slice(0, 500);
    if (!clean) return;
    io.emit('chat', {
      from: shownName,
      avatarUrl: me.avatarUrl,
      text: clean,
      at: Date.now(),
    });
  });

  socket.on('disconnect', () => {
    duelHub.onDisconnect(user.id);
    locationHub.onDisconnect(user.id);
    socket.broadcast.emit('system', `${shownName} left the lobby`);
    broadcastPlayerCount();
  });
});

function broadcastPlayerCount() {
  io.emit('players', io.of('/').sockets.size);
}

server.listen(PORT, () => {
  console.log(`Gems and Bones -> http://localhost:${PORT}`);
});
