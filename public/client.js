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

const tabsNav = document.querySelector('.tabs');
const tabPanels = {
  character: document.getElementById('tab-character'),
  deck: document.getElementById('tab-deck'),
  lobby: document.getElementById('tab-lobby'),
};
const deckCountEl = document.getElementById('deck-count');
const deckHintEl = document.getElementById('deck-hint');
const deckListEl = document.getElementById('deck-list');
const poolListEl = document.getElementById('pool-list');
const deckResetBtn = document.getElementById('deck-reset');

let currentUser = null;
let statDefs = null; // { groups: [...] }, fetched once

// deck state
let cardCatalog = null; // Map<id, card + {usable}>
let cardTypes = null;   // [{ id, name, basePriority }] highest first
let deckLimits = null;  // { min, max, maxCopies }
let deck = [];           // array of card ids (repeats = copies)

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
    loadDeck().catch((err) => console.error(err));
  }
}

// ---- Tabs -----------------------------------------------------------------
tabsNav.addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (btn) selectTab(btn.dataset.tab);
});

function selectTab(name) {
  for (const b of tabsNav.querySelectorAll('.tab')) {
    b.classList.toggle('is-active', b.dataset.tab === name);
  }
  for (const [key, panel] of Object.entries(tabPanels)) panel.hidden = key !== name;
}

// ---- Deck ---------------------------------------------------------------
async function loadDeck() {
  const [cat, types, dj] = await Promise.all([
    fetch('/api/cards').then((r) => r.json()),
    fetch('/api/cards/types').then((r) => r.json()),
    fetch('/api/deck').then((r) => (r.ok ? r.json() : { deck: [] })),
  ]);
  cardCatalog = new Map(cat.cards.map((c) => [c.id, c]));
  cardTypes = types.types;
  deckLimits = cat.limits;
  deck = dj.deck || [];
  renderDeck();
}

function tally(arr) {
  const m = new Map();
  for (const x of arr) m.set(x, (m.get(x) || 0) + 1);
  return m;
}

function priorityOf(card) {
  const t = cardTypes.find((x) => x.id === card.type);
  return t ? t.basePriority : 0;
}

function renderDeck() {
  const counts = tally(deck);
  const total = deck.length;

  deckCountEl.textContent = `${total} / ${deckLimits.max}`;
  deckCountEl.classList.toggle('warn', total > deckLimits.max || total < deckLimits.min);
  deckHintEl.textContent =
    total < deckLimits.min
      ? `At least ${deckLimits.min} cards needed to duel (${deckLimits.min - total} more). Up to ${deckLimits.maxCopies} copies of a card.`
      : `Up to ${deckLimits.max} cards, ${deckLimits.maxCopies} copies of a card.`;

  // In the deck: distinct cards, grouped by type in priority order
  deckListEl.replaceChildren();
  const distinct = [...new Set(deck)];
  for (const type of cardTypes) {
    for (const id of distinct) {
      const card = cardCatalog.get(id);
      if (card && card.type === type.id) {
        deckListEl.appendChild(cardTile(card, counts.get(id), 'deck'));
      }
    }
  }
  if (!total) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Your deck is empty.';
    deckListEl.appendChild(p);
  }

  // Card pool: everything this class can use
  poolListEl.replaceChildren();
  const pool = [...cardCatalog.values()].filter((c) => c.usable);
  pool.sort((a, b) => priorityOf(b) - priorityOf(a) || a.name.localeCompare(b.name));
  for (const card of pool) {
    poolListEl.appendChild(cardTile(card, counts.get(card.id) || 0, 'pool'));
  }
}

function miniButton(label, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mini-btn';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function cardTile(card, count, context) {
  const el = document.createElement('div');
  el.className = 'card-tile';
  el.dataset.type = card.type;

  const type = cardTypes.find((t) => t.id === card.type);

  const head = document.createElement('div');
  head.className = 'card-head';
  const badge = document.createElement('span');
  badge.className = 'type-badge';
  badge.dataset.type = card.type;
  badge.textContent = type ? `${type.name} · P${type.basePriority}` : card.type;
  const mana = document.createElement('span');
  mana.className = 'mana';
  mana.textContent = card.manaCost ? `${card.manaCost} MP` : 'Free';
  head.append(badge, mana);

  const name = document.createElement('div');
  name.className = 'card-name';
  name.textContent = card.name;

  const desc = document.createElement('p');
  desc.className = 'card-desc';
  desc.textContent = card.description;

  const foot = document.createElement('div');
  foot.className = 'card-foot';
  const classes = document.createElement('span');
  classes.className = 'card-classes';
  classes.textContent = card.classes === 'all' ? 'Any class' : card.classes.join(', ');
  foot.appendChild(classes);

  const controls = document.createElement('div');
  controls.className = 'card-controls';
  const atMax = deck.length >= deckLimits.max;

  if (context === 'deck') {
    controls.append(
      miniButton('−', () => setCardCount(card.id, count - 1)),
    );
    const c = document.createElement('span');
    c.className = 'count';
    c.textContent = `×${count}`;
    controls.append(c);
    const plus = miniButton('+', () => setCardCount(card.id, count + 1));
    plus.disabled = count >= deckLimits.maxCopies || atMax;
    controls.append(plus);
  } else {
    if (count) {
      const c = document.createElement('span');
      c.className = 'count';
      c.textContent = `in deck ×${count}`;
      controls.append(c);
    }
    const add = miniButton('Add', () => setCardCount(card.id, count + 1));
    add.disabled = count >= deckLimits.maxCopies || atMax;
    controls.append(add);
  }
  foot.appendChild(controls);

  el.append(head, name, desc, foot);
  return el;
}

async function setCardCount(id, target) {
  target = Math.max(0, Math.min(deckLimits.maxCopies, target));
  const next = deck.filter((x) => x !== id);
  for (let i = 0; i < target; i++) next.push(id);
  if (next.length > deckLimits.max) return;
  await saveDeck(next);
}

async function saveDeck(next) {
  try {
    const res = await fetch('/api/deck', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deck: next }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      deckHintEl.textContent = `Could not save deck: ${e.error || res.status}`;
      return;
    }
    deck = (await res.json()).deck;
    if (currentUser.character) currentUser.character.deckSize = deck.length;
    renderDeck();
  } catch (err) {
    console.error(err);
  }
}

deckResetBtn.addEventListener('click', async () => {
  if (!confirm('Replace your current deck with the starter deck for your class?')) return;
  const res = await fetch('/api/deck/reset', { method: 'POST' });
  if (res.ok) {
    deck = (await res.json()).deck;
    renderDeck();
  }
});

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
