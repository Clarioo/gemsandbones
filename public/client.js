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

const findDuelBtn = document.getElementById('find-duel');
const practiceDuelBtn = document.getElementById('practice-duel');
const duelSearchEl = document.getElementById('duel-search');
const cancelSearchBtn = document.getElementById('cancel-search');
const duelCtaNote = document.getElementById('duel-cta-note');
const duelView = document.getElementById('duel-view');
const duelRoundEl = document.getElementById('duel-round');
const duelTimerEl = document.getElementById('duel-timer');
const duelLeaveBtn = document.getElementById('duel-leave');
const duelOppoEl = document.getElementById('duel-oppo');
const duelYouEl = document.getElementById('duel-you');
const duelLogEl = document.getElementById('duel-log');
const duelActionEl = document.getElementById('duel-action');

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
  for (const v of [loginView, setupView, appView, duelView]) v.hidden = v !== view;
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
async function ensureCatalog() {
  if (cardCatalog) return;
  const [cat, types] = await Promise.all([
    fetch('/api/cards').then((r) => r.json()),
    fetch('/api/cards/types').then((r) => r.json()),
  ]);
  cardCatalog = new Map(cat.cards.map((c) => [c.id, c]));
  cardTypes = types.types;
  deckLimits = cat.limits;
}

async function loadDeck() {
  await ensureCatalog();
  const dj = await fetch('/api/deck').then((r) => (r.ok ? r.json() : { deck: [] }));
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

// ---- Icons (sprite lives in index.html; recoloured via currentColor) ------
const SVGNS = 'http://www.w3.org/2000/svg';
function icon(name, size = 16, cls) {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', cls ? `ico ${cls}` : 'ico');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVGNS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.appendChild(use);
  return svg;
}

const ELEMENTS_WITH_ICON = ['fire', 'water', 'electric'];

/** The element a card mainly deals in (first damage/dot behaviour), or null. */
function cardElement(card) {
  for (const b of card.behaviour || []) {
    if ((b.kind === 'damage' || b.kind === 'dot') && b.element) return b.element;
  }
  return null;
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
        deckListEl.appendChild(gameCard(card, { controls: 'deck', count: counts.get(id) }));
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
    poolListEl.appendChild(gameCard(card, { controls: 'pool', count: counts.get(card.id) || 0 }));
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

/**
 * The shared portrait card. Used by the deck editor, the card pool, and the
 * duel hand. `opts`:
 *   controls  'deck' | 'pool'   -> render +/- copy controls (deck editor)
 *   count     number            -> current copies in deck (with controls)
 *   onClick   fn                -> makes it a <button>
 *   disabled  bool              -> button disabled
 *   sub       string            -> footer text on the right (duel hand)
 *   selected  bool              -> outline it
 */
function gameCard(cardOrId, opts = {}) {
  const card = typeof cardOrId === 'string' ? cardCatalog.get(cardOrId) : cardOrId;
  const id = card ? card.id : cardOrId;
  const type = card && cardTypes.find((t) => t.id === card.type);

  const el = document.createElement(opts.onClick ? 'button' : 'div');
  el.className = 'gcard';
  if (card) el.dataset.type = card.type;
  if (opts.selected) el.classList.add('is-selected');
  if (opts.onClick) {
    el.type = 'button';
    el.disabled = !!opts.disabled;
    el.addEventListener('click', opts.onClick);
  }

  const strip = document.createElement('div');
  strip.className = 'gcard__strip';

  const cost = card ? card.manaCost : 0;
  const mana = document.createElement('div');
  mana.className = cost ? 'gcard__mana' : 'gcard__mana free';
  mana.textContent = cost ? String(cost) : 'Free';

  const body = document.createElement('div');
  body.className = 'gcard__body';

  const typeRow = document.createElement('div');
  typeRow.className = 'gcard__type';
  if (card) {
    typeRow.append(icon(card.type, 12), document.createTextNode(type ? type.name : card.type));
  }

  const art = document.createElement('div');
  art.className = 'gcard__art';
  const elx = card && cardElement(card);
  art.append(icon(ELEMENTS_WITH_ICON.includes(elx) ? elx : (card ? card.type : 'special'), 28));

  const name = document.createElement('div');
  name.className = 'gcard__name';
  name.textContent = card ? card.name : id;

  const meta = document.createElement('div');
  meta.className = 'gcard__meta';
  if (card) meta.textContent = card.classes === 'all' ? 'Any class' : card.classes.map(cap).join(' · ');

  const rule = document.createElement('p');
  rule.className = 'gcard__rule';
  if (card) {
    if (elx && !ELEMENTS_WITH_ICON.includes(elx)) {
      rule.textContent = card.description;
    } else if (elx) {
      const tag = document.createElement('span');
      tag.className = 'eltag';
      tag.style.setProperty('--e', `var(--el-${elx})`);
      tag.append(icon(elx, 11), document.createTextNode(' ' + cap(elx)));
      rule.append(tag, document.createTextNode(' · ' + card.description));
    } else {
      rule.textContent = card.description;
    }
  }

  body.append(typeRow, art, name, meta, rule);

  const foot = document.createElement('div');
  foot.className = 'gcard__foot';
  if (opts.controls === 'deck' || opts.controls === 'pool') {
    const left = document.createElement('span');
    left.textContent = type ? `P${type.basePriority}` : '';
    const ctr = document.createElement('div');
    ctr.className = 'gcard__controls';
    const n = opts.count || 0;
    const atMax = deck.length >= deckLimits.max;
    if (opts.controls === 'deck') {
      ctr.append(miniButton('−', () => setCardCount(id, n - 1)));
      const c = document.createElement('span');
      c.className = 'count';
      c.textContent = `×${n}`;
      ctr.append(c);
      const plus = miniButton('+', () => setCardCount(id, n + 1));
      plus.disabled = n >= deckLimits.maxCopies || atMax;
      ctr.append(plus);
    } else {
      if (n) {
        const c = document.createElement('span');
        c.className = 'count';
        c.textContent = `×${n}`;
        ctr.append(c);
      }
      const add = miniButton('Add', () => setCardCount(id, n + 1));
      add.disabled = n >= deckLimits.maxCopies || atMax;
      ctr.append(add);
    }
    foot.append(left, ctr);
  } else {
    const left = document.createElement('span');
    left.textContent = type ? `Priority ${type.basePriority}` : '';
    const right = document.createElement('span');
    right.textContent = opts.sub || '';
    foot.append(left, right);
  }

  el.append(strip, mana, body, foot);
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

const PRIMARY_STATS = ['strength', 'vitality', 'intelligence', 'dexterity'];
function elementOfStat(id) {
  if (id.startsWith('fire')) return 'fire';
  if (id.startsWith('water')) return 'water';
  if (id.startsWith('electric')) return 'electric';
  return null;
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
      const primary = PRIMARY_STATS.includes(stat.id);
      const elm = elementOfStat(stat.id);
      if (primary) {
        dt.dataset.stat = stat.id;
        dt.append(icon(stat.id, 14), document.createTextNode(' ' + stat.name));
      } else if (elm) {
        dt.dataset.el = elm;
        dt.append(icon(elm, 14), document.createTextNode(' ' + stat.name));
      } else {
        dt.textContent = stat.name;
      }
      const dd = document.createElement('dd');
      if (elm) dd.dataset.el = elm;
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

// ---- Duel ---------------------------------------------------------------
let duelState = null;
let planSlots = [null, null, null, null, null];

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const typeName = (id) => {
  const t = cardTypes && cardTypes.find((x) => x.id === id);
  return t ? t.name : id;
};
const handOrder = (ids) =>
  [...new Set(ids)].sort((a, b) => {
    const ca = cardCatalog.get(a);
    const cb = cardCatalog.get(b);
    return priorityOf(cb) - priorityOf(ca) || ca.name.localeCompare(cb.name);
  });

function duelErrorText(error) {
  const map = {
    deck_not_duel_legal: `Your deck needs at least ${deckLimits ? deckLimits.min : 15} cards to duel. Edit it on the Deck tab.`,
    no_class: 'Pick a class first.',
    already_in_duel: 'You are already in a duel.',
  };
  return map[error] || `Duel error: ${error}`;
}

findDuelBtn.addEventListener('click', () => {
  ensureCatalog().catch(() => {});
  duelCtaNote.textContent = '';
  socket.emit('duel:find');
});

practiceDuelBtn.addEventListener('click', () => {
  ensureCatalog().catch(() => {});
  duelCtaNote.textContent = '';
  socket.emit('duel:practice');
});

cancelSearchBtn.addEventListener('click', () => {
  socket.emit('duel:cancel');
  duelSearchEl.hidden = true;
  findDuelBtn.hidden = false;
});

duelLeaveBtn.addEventListener('click', () => {
  if (duelState && duelState.phase !== 'ended' &&
      !confirm('Leave the duel? It counts as a loss.')) return;
  socket.emit('duel:leave');
  backToLobby();
});

function backToLobby() {
  duelState = null;
  showOnly(appView);
  selectTab('lobby');
}

function tickDuelTimer() {
  if (!duelState || duelView.hidden || duelState.phase === 'ended' || !duelState.deadline) {
    duelTimerEl.hidden = true;
    return;
  }
  const ms = duelState.deadline - Date.now();
  duelTimerEl.hidden = false;
  if (ms <= 0) {
    duelTimerEl.textContent = "Time's up…";
    duelTimerEl.classList.add('warn');
    return;
  }
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  duelTimerEl.textContent = `${m}:${s}`;
  duelTimerEl.classList.toggle('warn', ms < 15000);
}
setInterval(tickDuelTimer, 500);

socket.on('duel:searching', () => {
  findDuelBtn.hidden = true;
  duelSearchEl.hidden = false;
  duelCtaNote.textContent = '';
});

socket.on('duel:start', async ({ view }) => {
  await ensureCatalog();
  duelState = view;
  planSlots = [null, null, null, null, null];
  duelSearchEl.hidden = true;
  findDuelBtn.hidden = false;
  showOnly(duelView);
  renderDuel();
});

socket.on('duel:update', ({ view }) => {
  duelState = view;
  renderDuel();
});
socket.on('duel:round', ({ view }) => {
  duelState = view;
  renderDuel();
});
socket.on('duel:end', ({ view }) => {
  duelState = view;
  renderDuel();
});
socket.on('duel:error', ({ error }) => {
  duelSearchEl.hidden = true;
  findDuelBtn.hidden = false;
  duelCtaNote.textContent = duelErrorText(error);
});

function hpTrack(hp, max) {
  const wrap = document.createElement('div');
  wrap.className = 'dp-bar';

  const bl = document.createElement('div');
  bl.className = 'bl';
  const label = document.createElement('span');
  label.textContent = 'HP';
  const val = document.createElement('span');
  val.className = 'v hp';
  val.append(icon('heart', 12), document.createTextNode(` ${Math.max(0, hp)} / ${max}`));
  bl.append(label, val);

  const pct = Math.max(0, Math.min(100, (hp / max) * 100));
  const track = document.createElement('div');
  track.className = 'track';
  const fill = document.createElement('div');
  fill.className = 'fill hp' + (pct <= 30 ? ' critical' : pct < 60 ? ' wounded' : '');
  fill.style.width = `${pct}%`;
  track.append(fill);

  wrap.append(bl, track);
  return wrap;
}

function manaLine(mana) {
  const wrap = document.createElement('div');
  wrap.className = 'dp-bar';
  const bl = document.createElement('div');
  bl.className = 'bl';
  const label = document.createElement('span');
  label.textContent = 'Mana';
  const val = document.createElement('span');
  val.className = 'v mana';
  val.append(icon('mana', 12), document.createTextNode(` ${mana}`));
  bl.append(label, val);
  wrap.append(bl);
  return wrap;
}

function seg(cls, iconName, text) {
  const s = document.createElement('span');
  s.className = cls ? `s ${cls}` : 's';
  if (iconName) s.append(icon(iconName, 11), document.createTextNode(' ' + text));
  else s.append(document.createTextNode(text));
  return s;
}

function statusChip(colorKey, iconName, text) {
  const c = document.createElement('span');
  c.className = 'chip';
  if (colorKey) c.style.setProperty('--e', `var(--el-${colorKey})`);
  if (iconName) c.append(icon(iconName, 11));
  c.append(document.createTextNode((iconName ? ' ' : '') + text));
  return c;
}

function renderPlayerPanel(el, p, isYou, stats) {
  el.replaceChildren();

  const head = document.createElement('div');
  head.className = 'dp-head';
  head.textContent = `${p.name} — ${cap(p.classId)} · Lvl ${p.level}`;
  el.append(head);

  const bars = document.createElement('div');
  bars.className = 'dp-bars';
  bars.append(hpTrack(p.hp, p.maxHp), manaLine(p.mana));
  el.append(bars);

  const counts = document.createElement('div');
  counts.className = 'dp-stats';
  counts.append(seg(null, null, `Deck ${p.deckCount}`), seg(null, null, `Burned ${p.burnedCount}`));
  el.append(counts);

  const chips = [];
  for (const d of p.dots || []) {
    const ic = ['fire', 'water', 'electric'].includes(d.element) ? d.element : null;
    chips.push(statusChip('poison', ic, `${d.element} ${d.damage}/rd · ${d.roundsLeft} left`));
  }
  if (isYou && p.disruptedNextRound) {
    chips.push(statusChip('poison', 'disrupt', 'attack disrupted next round'));
  }
  if (chips.length) {
    const box = document.createElement('div');
    box.className = 'dp-status';
    box.append(...chips);
    el.append(box);
  }

  if (isYou && stats) {
    const s = document.createElement('div');
    s.className = 'dp-stats';
    s.append(
      seg(null, null, `Atk ${stats.attackMin}–${stats.attackMax}`),
      seg(null, null, `Def ${stats.defense}`),
      seg('fire', 'fire', `${stats.fireAtkMin}–${stats.fireAtkMax}`),
      seg('water', 'water', `${stats.waterAtkMin}–${stats.waterAtkMax}`),
      seg('elec', 'electric', `${stats.electricAtkMin}–${stats.electricAtkMax}`),
    );
    el.append(s);
  }

  if (!isYou && duelState.phase !== 'ended') {
    const st = document.createElement('div');
    st.className = 'dp-ready' + (p.submitted ? '' : ' waiting');
    st.textContent = p.submitted ? 'Ready ✓' : 'Choosing…';
    el.append(st);
  }
}

function duelCard(cardId, opts = {}) {
  return gameCard(cardId, opts);
}

// ---- Combat log: colour by outcome + inline icons on the numbers ---------
function logLineClass(text) {
  const t = text.toLowerCase();
  if (/lingering wound|is afflicted/.test(t)) return 'dot';
  if (/cancels|disrupt|was cancelled|nothing to cancel/.test(t)) return 'block';
  if (/drains|heals/.test(t)) return 'heal';
  if (/damage \(hp|hits .* for/.test(t)) return 'dmg';
  if (/: \+|braces/.test(t)) return 'buff';
  if (/: -\d/.test(t)) return 'debuff';
  if (/burned|no card|not implemented|unknown behaviour|is down/.test(t)) return 'dim';
  return '';
}

function mi(colorKey, iconName, text) {
  const s = document.createElement('span');
  s.className = `mi ${colorKey}`;
  if (iconName) s.append(icon(iconName, 12));
  s.append(document.createTextNode((iconName ? ' ' : '') + text));
  return s;
}

function logLine(text) {
  const li = document.createElement('li');
  li.className = logLineClass(text);

  const re =
    /(\d+)\s+(physical|fire|water|electric)\s+damage|\(HP\s+(\d+)\)|(drains|heals)\s+(\d+)(\s+HP)?/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) li.append(document.createTextNode(text.slice(last, m.index)));
    if (m[2]) {
      li.append(mi(m[2], m[2], `${m[1]} ${m[2]}`), document.createTextNode(' damage'));
    } else if (m[3]) {
      li.append(document.createTextNode('('), mi('hp', 'heart', m[3]), document.createTextNode(')'));
    } else {
      li.append(
        document.createTextNode(m[4] + ' '),
        mi('heal', 'heal', m[5] + (m[6] ? ' HP' : '')),
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) li.append(document.createTextNode(text.slice(last)));
  return li;
}

function note(text) {
  const p = document.createElement('p');
  p.className = 'hint';
  p.textContent = text;
  return p;
}

function renderDuel() {
  const v = duelState;
  if (!v) return;
  duelRoundEl.textContent =
    v.phase === 'ended' ? 'Duel over' : `Round ${v.round} / ${v.totalRounds}`;
  tickDuelTimer();

  renderPlayerPanel(duelOppoEl, v.opponent, false);
  renderPlayerPanel(duelYouEl, v.you, true, v.you.stats);

  duelLogEl.replaceChildren();
  for (const r of v.log) {
    const h = document.createElement('li');
    h.className = 'turn';
    h.textContent = `Round ${r.round}`;
    duelLogEl.append(h);
    for (const line of r.entries) duelLogEl.append(logLine(line));
  }
  duelLogEl.scrollTop = duelLogEl.scrollHeight;

  renderAction();
}

function renderAction() {
  const v = duelState;
  duelActionEl.replaceChildren();

  if (v.phase === 'ended') {
    let result = 'Draw.';
    if (v.winner === v.you.userId) result = 'You win!';
    else if (v.winner && v.winner !== 'draw') result = 'You lose.';
    const reason = { hp: '', left: ' (opponent left)', rounds: ' (by HP after 15 rounds)' }[v.endReason] || '';
    const h = document.createElement('h3');
    h.textContent = result + reason;
    const back = document.createElement('button');
    back.className = 'btn discord';
    back.textContent = 'Back to lobby';
    back.addEventListener('click', backToLobby);
    duelActionEl.append(h, back);
    return;
  }

  if (v.you.submitted) {
    duelActionEl.append(note('Waiting for opponent…'));
    return;
  }

  // opening 5-card plan
  if (v.round === 1 && Object.keys(v.you.plan).length === 0) {
    renderPlanBuilder();
    return;
  }

  // queue one card for the far slot (rounds 6..15)
  if (v.slotToFill !== null) {
    duelActionEl.append(note(`Choose your card for round ${v.slotToFill}`));
    const hand = document.createElement('div');
    hand.className = 'hand';
    for (const id of handOrder(v.you.hand)) {
      const count = v.you.hand.filter((x) => x === id).length;
      hand.append(
        duelCard(id, {
          onClick: () => socket.emit('duel:card', { round: v.slotToFill, cardId: id }),
          sub: count > 1 ? `×${count}` : '',
        }),
      );
    }
    if (!v.you.hand.length) hand.append(note('No cards left in hand.'));
    duelActionEl.append(hand);
    return;
  }

  // rounds 11-15: nothing to plan
  const cont = document.createElement('button');
  cont.className = 'btn discord';
  cont.textContent = 'Continue';
  cont.addEventListener('click', () => socket.emit('duel:ready'));
  duelActionEl.append(note('Nothing to plan this round.'), cont);
}

function renderPlanBuilder() {
  const v = duelState;
  const wrap = document.createElement('div');
  wrap.className = 'plan-builder';

  const slots = document.createElement('div');
  slots.className = 'plan-slots';
  planSlots.forEach((cardId, i) => {
    const slot = document.createElement('button');
    slot.type = 'button';
    slot.className = 'plan-slot';

    const r = document.createElement('div');
    r.className = 'ps-r';
    r.textContent = `Round ${i + 1}`;
    const nm = document.createElement('div');
    nm.className = 'ps-name';
    slot.append(r, nm);

    if (cardId) {
      const c = cardCatalog.get(cardId);
      slot.dataset.type = c.type;
      nm.append(icon(c.type, 12), document.createTextNode(c.name));
      slot.title = `${c.name} — ${typeName(c.type)}, ${c.manaCost} MP\n${c.description}`;
    } else {
      nm.textContent = 'Empty';
    }

    slot.addEventListener('click', () => {
      planSlots[i] = null;
      renderAction();
    });
    slots.append(slot);
  });

  const used = tally(planSlots.filter(Boolean));
  const hand = document.createElement('div');
  hand.className = 'hand';
  for (const id of handOrder(v.you.hand)) {
    const have = v.you.hand.filter((x) => x === id).length;
    const left = have - (used.get(id) || 0);
    hand.append(
      duelCard(id, {
        onClick: () => {
          const idx = planSlots.indexOf(null);
          if (idx !== -1 && left > 0) {
            planSlots[idx] = id;
            renderAction();
          }
        },
        disabled: left <= 0,
        sub: `${left} left`,
      }),
    );
  }

  const lock = document.createElement('button');
  lock.className = 'btn discord';
  lock.textContent = 'Lock in plan';
  lock.disabled = planSlots.some((x) => !x);
  lock.addEventListener('click', () => socket.emit('duel:plan', { cards: planSlots }));

  wrap.append(
    note('Plan your first 5 rounds. Your opponent will not see them. Click a card to place it, click a slot to clear it.'),
    slots,
    hand,
    lock,
  );
  duelActionEl.append(wrap);
}

init();
