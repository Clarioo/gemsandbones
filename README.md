# Gems and Bones

A browser-based multiplayer card game. Players sign in with Discord (no
passwords), then join a real-time lobby. The card table is built on top of this
foundation next.

**Stack:** Node.js + Express, `express-session` cookies, Discord OAuth2,
Socket.IO for real-time, a JSON file for storage (swap for a real DB later).

```
src/
  server.js    Express app, auth routes, Socket.IO lobby
  discord.js   Discord OAuth2 helper calls
  db.js        Tiny JSON-file user store
public/
  index.html   Login screen + lobby
  client.js    Browser logic
  style.css
data/
  db.json      Created on first login (git-ignored)
```

---

## 1. Create the Discord application

1. https://discord.com/developers/applications -> **New Application**.
2. **OAuth2** tab: copy the **Client ID** and **Client Secret**.
3. **OAuth2 -> Redirects**: add both
   - `http://localhost:3000/auth/discord/callback`
   - `https://gemsandbones.online/auth/discord/callback`
4. Save.

## 2. Configure

```bash
cp .env.example .env
```

Fill in `.env`:

- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` from step 1
- `DISCORD_REDIRECT_URI` = the `localhost` URL for now
- `SESSION_SECRET` — generate one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 3. Run locally

```bash
npm install
```

```bash
npm start
```

Open http://localhost:3000, click **Login with Discord**, approve. You should
land back on the lobby with your Discord name and avatar. Open a second browser
(or an incognito window with another Discord account) to see real-time messages
between players.

---

## 4. Deploy to the VPS

On the server (`ssh karol@92.112.181.248`), once Node, nginx and the firewall
are set up (see the setup guide):

```bash
git clone <your repo url> ~/gemsandbones
```

```bash
cd ~/gemsandbones && npm install --omit=dev
```

Create `.env` on the server with **production** values:

```
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_REDIRECT_URI=https://gemsandbones.online/auth/discord/callback
SESSION_SECRET=...          # a fresh random value, not the same as local
PORT=3000
NODE_ENV=production
```

Start it under PM2:

```bash
pm2 start npm --name gemsandbones -- start
```

```bash
pm2 save && pm2 startup
```

The nginx site (`server_name gemsandbones.online`) proxies to
`127.0.0.1:3000` and already forwards the WebSocket upgrade headers Socket.IO
needs. Run `certbot` once DNS resolves, then the game is live at
https://gemsandbones.online.

To deploy an update:

```bash
cd ~/gemsandbones && git pull && npm install --omit=dev && pm2 restart gemsandbones
```

---

## Session store

Set `REDIS_URL=redis://127.0.0.1:6379` in `.env` to keep sessions in Redis
(survives restarts, works across processes). Unset, it uses a simple in-memory
store — fine for local dev. The VPS has Redis installed, so its `.env` sets
`REDIS_URL`.

## Known trade-offs (fix before real traffic)

- **Storage is a JSON file.** Fine for now; move to PostgreSQL or SQLite when
  you add match history / stats / a friends list.
- **No rate limiting** on auth routes or chat. Add `express-rate-limit`.
