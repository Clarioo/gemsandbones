'use strict';

// Don't connect the socket until we know the player is logged in.
const socket = io({ autoConnect: false });

const loginView = document.getElementById('login-view');
const setupView = document.getElementById('setup-view');
const appView = document.getElementById('app-view');
const setupName = document.getElementById('setup-name');
const classGrid = document.getElementById('class-grid');
const profileEl = document.getElementById('profile');
const sheetTitle = document.getElementById('sheet-title');
const levelInput = document.getElementById('level-input');
const statGroupsEl = document.getElementById('stat-groups');
const messagesEl = document.getElementById('messages');
const form = document.getElementById('chat-form');
const input = document.getElementById('chat-input');
const playerCountEl = document.getElementById('player-count');
const logoutBtn = document.getElementById('logout-btn');

let currentUser = null;
let statDefs = null; // { groups: [...] }, fetched once

async function init() {
  try {
    const res = await fetch('/api/me');
    if (res.ok) {
      const { user } = await res.json();
      currentUser = user;
      if (user.character && user.character.classId) showApp(user);
      else showSetup(user);
      return;
    }
  } catch (err) {
    console.error(err);
  }
  showLogin();
}

function showOnly(view) {
  for (const v of [loginView, setupView, appView]) v.hidden = v !== view;
}

function showLogin() {
  showOnly(loginView);
}

async function showSetup(user) {
  showOnly(setupView);
  setupName.textContent = user.displayName;

  const res = await fetch('/api/classes');
  const { classes } = await res.json();

  classGrid.replaceChildren();
  for (const cls of classes) {
    const card = document.createElement('button');
    card.className = 'class-card';
    card.type = 'button';

    const title = document.createElement('h3');
    title.textContent = cls.name;
    const desc = document.createElement('p');
    desc.textContent = cls.blurb;

    card.append(title, desc);
    card.addEventListener('click', () => chooseClass(cls.id));
    classGrid.appendChild(card);
  }
}

async function chooseClass(classId) {
  for (const b of classGrid.querySelectorAll('button')) b.disabled = true;

  try {
    const res = await fetch('/api/character/class', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classId }),
    });
    if (!res.ok) throw new Error('request failed');
    const { character } = await res.json();
    currentUser.character = character;
    showApp(currentUser);
  } catch (err) {
    console.error(err);
    for (const b of classGrid.querySelectorAll('button')) b.disabled = false;
    alert('Could not select that class. Please try again.');
  }
}

async function showApp(user) {
  showOnly(appView);

  const img = document.createElement('img');
  img.src = user.avatarUrl;
  img.width = 32;
  img.height = 32;
  img.alt = '';
  const name = document.createElement('span');
  name.textContent = user.character
    ? `${user.character.name} — ${user.character.className}`
    : user.displayName;
  profileEl.replaceChildren(img, name);

  if (!socket.connected) socket.connect();

  if (user.character) {
    if (!statDefs) statDefs = await fetch('/api/stats/definitions').then((r) => r.json());
    levelInput.value = user.character.level;
    renderSheet(user.character);
  }
}

function renderSheet(character) {
  sheetTitle.textContent = `${character.name} — ${character.className} · Lvl ${character.level}`;

  statGroupsEl.replaceChildren();
  for (const group of statDefs.groups) {
    const box = document.createElement('div');
    box.className = 'stat-group';

    const h = document.createElement('h3');
    h.textContent = group.name;
    box.appendChild(h);

    const dl = document.createElement('dl');
    for (const stat of group.stats) {
      const dt = document.createElement('dt');
      dt.textContent = stat.name;
      const dd = document.createElement('dd');
      dd.textContent = character.stats[stat.id] ?? 0;
      dl.append(dt, dd);
    }
    box.appendChild(dl);
    statGroupsEl.appendChild(box);
  }
}

let levelTimer = null;
levelInput.addEventListener('input', () => {
  clearTimeout(levelTimer);
  levelTimer = setTimeout(applyLevel, 400);
});

async function applyLevel() {
  const level = Number(levelInput.value);
  if (!Number.isInteger(level) || level < 1 || level > 50) return;
  try {
    const res = await fetch('/api/character/level', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level }),
    });
    if (!res.ok) return;
    const { character } = await res.json();
    currentUser.character = character;
    renderSheet(character);
  } catch (err) {
    console.error(err);
  }
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
  const name = user.character ? user.character.name : user.displayName;
  addMessage(`Welcome, ${name}. You're in the lobby.`, 'system');
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
