'use strict';

// Don't connect the socket until we know the player is logged in.
const socket = io({ autoConnect: false });

const loginView = document.getElementById('login-view');
const appView = document.getElementById('app-view');
const profileEl = document.getElementById('profile');
const messagesEl = document.getElementById('messages');
const form = document.getElementById('chat-form');
const input = document.getElementById('chat-input');
const playerCountEl = document.getElementById('player-count');
const logoutBtn = document.getElementById('logout-btn');

async function init() {
  try {
    const res = await fetch('/api/me');
    if (res.ok) {
      const { user } = await res.json();
      showApp(user);
      return;
    }
  } catch (err) {
    console.error(err);
  }
  showLogin();
}

function showLogin() {
  loginView.hidden = false;
  appView.hidden = true;
}

function showApp(user) {
  loginView.hidden = true;
  appView.hidden = false;

  const img = document.createElement('img');
  img.src = user.avatarUrl;
  img.width = 32;
  img.height = 32;
  img.alt = '';
  const name = document.createElement('span');
  name.textContent = user.displayName;
  profileEl.replaceChildren(img, name);

  socket.connect();
}

function addMessage(node, cls) {
  const li = document.createElement('li');
  if (cls) li.className = cls;
  if (typeof node === 'string') li.textContent = node;
  else li.append(...node);
  messagesEl.appendChild(li);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

socket.on('welcome', ({ user }) => {
  addMessage(`Welcome, ${user.displayName}. You're in the lobby.`, 'system');
});

socket.on('system', (text) => addMessage(text, 'system'));

socket.on('chat', ({ from, avatarUrl, text }) => {
  const img = document.createElement('img');
  img.src = avatarUrl;
  img.width = 20;
  img.height = 20;
  img.alt = '';
  const who = document.createElement('strong');
  who.textContent = ` ${from}: `;
  const body = document.createElement('span');
  body.textContent = text;
  addMessage([img, who, body]);
});

socket.on('players', (n) => {
  playerCountEl.textContent = String(n);
});

socket.on('auth_required', () => showLogin());

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value;
  if (text.trim()) socket.emit('chat', text);
  input.value = '';
});

logoutBtn.addEventListener('click', async () => {
  await fetch('/auth/logout', { method: 'POST' });
  socket.disconnect();
  location.reload();
});

init();
