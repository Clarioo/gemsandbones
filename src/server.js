'use strict';

require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const expressSession = require('express-session');
const { Server } = require('socket.io');

const { getAuthorizeUrl, exchangeCode, fetchDiscordUser } = require('./discord');
const { upsertUser, getUserById, setCharacterClass } = require('./db');
const { CLASSES, isValidClassId, getClass } = require('./classes');

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

/** Choose (or, for now, change) the player's class. */
app.post('/api/character/class', requireAuth, (req, res) => {
  const { classId } = req.body || {};
  if (!isValidClassId(classId)) {
    return res.status(400).json({ error: 'invalid_class' });
  }
  const character = setCharacterClass(req.user.id, classId);
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
    character: toPublicCharacter(u.character),
  };
}

/** null until the player has picked a class. */
function toPublicCharacter(c) {
  if (!c || !c.classId) return null;
  const cls = getClass(c.classId);
  return {
    name: c.name,
    classId: c.classId,
    className: cls ? cls.name : c.classId,
  };
}

// ---------------------------------------------------------------------------
// Real-time lobby (Socket.IO), authenticated with the same session cookie
// ---------------------------------------------------------------------------
io.engine.use(sessionMiddleware);

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
