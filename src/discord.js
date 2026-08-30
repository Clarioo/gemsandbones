'use strict';

/**
 * Discord OAuth2 helpers (Authorization Code flow).
 * Docs: https://discord.com/developers/docs/topics/oauth2
 */

const AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const TOKEN_URL = 'https://discord.com/api/oauth2/token';
const USER_URL = 'https://discord.com/api/users/@me';

// We only ask for "identify": Discord id, username and avatar. That is enough
// to create an account. Add "email" here (and re-consent) if you ever need it.
const SCOPE = 'identify';

/** Step 1: the URL we send the player to so they can approve the login. */
function getAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/** Step 4: trade the one-time ?code=... for an access token. */
async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    client_secret: process.env.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    throw new Error(`Discord token exchange failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/** Step 5: use the access token to read the player's Discord profile. */
async function fetchDiscordUser(accessToken) {
  const res = await fetch(USER_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Discord user fetch failed: ${res.status}`);
  }
  return res.json();
}

module.exports = { getAuthorizeUrl, exchangeCode, fetchDiscordUser };
