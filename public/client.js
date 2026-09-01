'use strict';

// Don't connect the socket until we know the player is logged in.
const socket = io({ autoConnect: false });

const loginView = document.getElementById('login-view');
const setupView = document.getElementById('setup-view');
const appView = document.getElementById('app-view');
const setupIntroEl = document.getElementById('setup-intro');
const setupCancelBtn = document.getElementById('setup-cancel');
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
const devToolsEl = document.getElementById('dev-tools');
const levelNoteEl = document.getElementById('level-note');
const changeClassBtn = document.getElementById('change-class');
const equipSlotsEl = document.getElementById('equip-slots');
const bagCountEl = document.getElementById('bag-count');
const bagHintEl = document.getElementById('bag-hint');
const bagListEl = document.getElementById('bag-list');
const generateItemBtn = document.getElementById('generate-item');

const tabsNav = document.querySelector('.tabs');
const tabPanels = {
  character: document.getElementById('tab-character'),
  deck: document.getElementById('tab-deck'),
  map: document.getElementById('tab-map'),
  chat: document.getElementById('tab-chat'),
};
const deckCountEl = document.getElementById('deck-count');
const deckHintEl = document.getElementById('deck-hint');
const deckDistEl = document.getElementById('deck-dist');
const deckListEl = document.getElementById('deck-list');
const poolListEl = document.getElementById('pool-list');
const poolSortEl = document.getElementById('pool-sort');
const deckResetBtn = document.getElementById('deck-reset');

const locationListEl = document.getElementById('location-list');
const mapHereEl = document.getElementById('map-here');
const practiceNoteEl = document.getElementById('practice-note');

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
let poolSort = 'type';   // 'type' | 'name' | 'mana'

// map state
let locations = null;        // [{ id, name, blurb, enemyLevels, requirements }]
let currentLocationId = null; // location the player is currently in, or null

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
  const repick = !!(user.character && user.character.classId);
  setupIntroEl.textContent = repick
    ? 'Pick a new class. Your deck resets to that class’s starter if it no longer fits.'
    : `Welcome, ${user.displayName}. Choose your class:`;
  setupCancelBtn.hidden = !repick;

  const res = await fetch('/api/classes');
  const { classes } = await res.json();

  classGrid.replaceChildren();
  for (const cls of classes) {
    const card = document.createElement('button');
    card.className = 'class-card';
    card.type = 'button';
    if (repick && cls.id === user.character.classId) card.classList.add('is-current');

    const title = document.createElement('h3');
    title.textContent = cls.name;
    const desc = document.createElement('p');
    desc.textContent = cls.blurb;

    card.append(title, desc);
    card.addEventListener('click', () => chooseClass(cls.id));
    classGrid.appendChild(card);
  }
}

setupCancelBtn.addEventListener('click', () => showApp(currentUser));

async function chooseClass(classId) {
  for (const b of classGrid.querySelectorAll('button')) b.disabled = true;

  try {
    const res = await fetch('/api/character/class', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classId }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || 'request failed');
    }
    const { character } = await res.json();
    currentUser.character = character;
    showApp(currentUser);
  } catch (err) {
    console.error(err);
    for (const b of classGrid.querySelectorAll('button')) b.disabled = false;
    alert(
      err.message === 'class_locked'
        ? 'Changing class is a dev-only tool.'
        : 'Could not select that class. Please try again.',
    );
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

  // Dev-only tools: change class / set level by hand / generate items.
  devToolsEl.hidden = !user.isDev;
  levelNoteEl.hidden = !user.isDev;
  generateItemBtn.hidden = !user.isDev;

  if (user.character) {
    currentLocationId = user.character.locationId || null;
    if (!statDefs) statDefs = await fetch('/api/stats/definitions').then((r) => r.json());
    levelInput.value = user.character.level;
    renderSheet(user.character);
    renderEquipment(user.character);
    loadDeck().catch((err) => console.error(err));
  }
}

changeClassBtn.addEventListener('click', () => showSetup(currentUser));

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
  if (name === 'deck') requestAnimationFrame(fitDeckLayout);
  if (name === 'map') loadMap().catch((err) => console.error(err));
}

/**
 * On wide screens the deck editor fills the viewport (fixed headers, scrolling
 * card lists). Its height is "everything below where it starts", which we can
 * only know once it's on screen.
 */
function fitDeckLayout() {
  const layout = document.querySelector('.deck-layout');
  if (!layout || tabPanels.deck.hidden || window.innerWidth < 980) {
    if (layout) layout.style.removeProperty('--deck-h');
    return;
  }
  // absolute offset of the layout from the top of the document, plus the
  // .wrap bottom padding, so the page itself doesn't scroll
  const offset = layout.getBoundingClientRect().top + window.scrollY;
  layout.style.setProperty('--deck-h', `calc(100vh - ${Math.round(offset)}px - 48px)`);
}

window.addEventListener('resize', () => {
  if (!tabPanels.deck.hidden) fitDeckLayout();
});

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

// ---- Card preview: what a card will actually deal/reduce/heal -------------
// `stats` is the acting player's live stats (attackMin/Max per element) --
// duelState.you.stats in a duel, else the character sheet's resolved stats.
// The chip number is the RAW roll (attack × scale). The opponent's defense
// and any Mitigate are applied when the card resolves — they aren't known
// outside a duel and change round to round inside one — so they only appear
// in the formula text, not the number.
const elName = (el) => el.charAt(0).toUpperCase() + el.slice(1);

/** Human name for a stat id, from the stat definitions (falls back to the id). */
function statLabel(id) {
  if (statDefs && statDefs.groups) {
    for (const g of statDefs.groups) {
      const s = g.stats.find((x) => x.id === id);
      if (s) return s.name;
    }
  }
  return id;
}

const whenLabel = (dur) =>
  dur === 'duel' ? 'the rest of the duel' : dur === 'nextRound' ? 'next round' : 'this round';

function previewParts(card, stats) {
  const parts = [];
  for (const b of card.behaviour || []) {
    if (b.kind === 'damage') {
      if (!stats) continue;
      const el = b.element || 'physical';
      const lo = el === 'physical' ? stats.attackMin : stats[`${el}AtkMin`] || 0;
      const hi = el === 'physical' ? stats.attackMax : stats[`${el}AtkMax`] || 0;
      const scale = typeof b.scale === 'number' ? b.scale : 1;
      const rlo = Math.round(lo * scale);
      const rhi = Math.round(hi * scale);
      const atkWord = el === 'physical' ? 'Attack' : `${elName(el)} Attack`;
      const defWord = el === 'physical' ? 'Defense' : `${elName(el)} Defense`;
      parts.push({
        kind: 'dmg',
        el,
        label: `${elName(el)} damage`,
        text: `${rlo}–${rhi}`,
        formula:
          `${elName(el)} damage: your ${atkWord} (${Math.round(lo)}–${Math.round(hi)}) × ${scale} scale ` +
          `= ${rlo}–${rhi}, then minus the target's ${defWord} (and any Mitigate) when it resolves`,
      });
      if (b.lifesteal) {
        const pct = Math.round(b.lifesteal * 100);
        parts.push({
          kind: 'lifesteal',
          label: 'Lifesteal',
          text: `${pct}%`,
          formula: `Lifesteal: heals you for ${pct}% of the damage this hit actually deals (after the target's defense)`,
        });
      }
    } else if (b.kind === 'dot') {
      const el = b.element || 'physical';
      const per = Math.max(0, Math.round(b.damage || 0));
      const dur = Math.max(1, Math.round(b.duration || 1));
      parts.push({
        kind: 'dot',
        el,
        label: `${elName(el)} DoT`,
        text: `${per}/rd × ${dur}`,
        formula:
          `${elName(el)} damage over time: ${per} flat at the start of each of the next ${dur} rounds ` +
          `(${per * dur} total) — ignores Defense and Mitigate`,
      });
    } else if (b.kind === 'heal') {
      const amt = Math.max(0, Math.round(b.amount || 0));
      const who = b.target === 'opponent' ? 'the opponent' : 'you';
      parts.push({
        kind: 'heal',
        label: b.target === 'opponent' ? 'Heal opponent' : 'Heal',
        text: `+${amt}`,
        formula: `Heal: restores ${amt} HP flat to ${who} (does not scale with stats), capped at max HP`,
      });
    } else if (b.kind === 'mitigate') {
      const bits = [];
      const words = [];
      if (b.flat) { bits.push(`-${b.flat}`); words.push(`${b.flat} flat`); }
      if (b.percent) {
        const eff = Math.min(90, b.percent); // engine caps stacked percent mitigation at 90%
        bits.push(`-${eff}%`);
        words.push(b.percent > 90 ? `${eff}% (card lists ${b.percent}%, capped)` : `${b.percent}%`);
      }
      if (bits.length) {
        parts.push({
          kind: 'mitigate',
          label: 'Reduce dmg',
          text: bits.join(' '),
          formula: `Mitigate: incoming damage this round is reduced by ${words.join(' and ')}`,
        });
      }
    } else if (b.kind === 'modifyStat') {
      const sign = b.amount >= 0 ? '+' : '';
      const name = statLabel(b.stat);
      const short = name.replace(/\bAttack\b ?/g, '').trim() || name;
      const who = b.target === 'opponent' ? "the opponent's" : 'your';
      const when = whenLabel(b.duration);
      parts.push({
        kind: b.amount >= 0 ? 'buff' : 'debuff',
        label: `${name} ${sign}${b.amount}`,
        text: `${short} ${sign}${b.amount}`,
        formula:
          `${sign}${b.amount} to ${who} ${name}, applies ${when}` +
          (b.duration === 'nextRound' ? ' — play it the round before you attack' : ''),
      });
    }
  }
  return parts;
}

/** The acting player's live stats, for computing card previews. */
function statsForPreview() {
  if (duelState && duelState.you) return duelState.you.stats;
  return currentUser && currentUser.character ? currentUser.character.stats : null;
}

function previewChip(part) {
  const s = document.createElement('span');
  s.className = 'pchip';
  let iconName = null;
  let colorVar = 'var(--muted)';
  if (part.kind === 'dmg' || part.kind === 'dot') {
    iconName = part.el;
    colorVar = `var(--el-${part.el})`;
  } else if (part.kind === 'heal') {
    iconName = 'heal';
    colorVar = 'var(--good)';
  } else if (part.kind === 'lifesteal') {
    iconName = 'heart';
    colorVar = 'var(--hp)';
  } else if (part.kind === 'mitigate') {
    iconName = 'defensive';
    colorVar = 'var(--t-defensive)';
  } else if (part.kind === 'buff' || part.kind === 'debuff') {
    iconName = 'bonus';
    colorVar = part.kind === 'buff' ? 'var(--t-bonus)' : 'var(--t-physicalAttack)';
  }
  s.style.setProperty('--c', colorVar);
  if (iconName) s.append(icon(iconName, 10));
  s.append(document.createTextNode(part.text));
  s.title = part.formula || `${part.label}: ${part.text}`;
  return s;
}

/**
 * Multi-line native tooltip: name/type/cost, the flavour line, then one line
 * per effect spelling out how its number is calculated.
 */
function cardTooltip(card, stats) {
  const lines = [`${card.name} — ${typeName(card.type)}, ${card.manaCost} MP`, card.description];
  for (const p of previewParts(card, stats)) lines.push(`• ${p.formula || `${p.label}: ${p.text}`}`);
  return lines.join('\n');
}

function renderDeck() {
  const counts = tally(deck);
  const total = deck.length;

  // keep the card lists where they were after a +/- rebuild
  const deckScroll = deckListEl.scrollTop;
  const poolScroll = poolListEl.scrollTop;

  deckCountEl.textContent = `${total} / ${deckLimits.max}`;
  deckCountEl.classList.toggle('warn', total > deckLimits.max || total < deckLimits.min);
  deckHintEl.textContent =
    total < deckLimits.min
      ? `At least ${deckLimits.min} cards needed to duel (${deckLimits.min - total} more). Up to ${deckLimits.maxCopies} copies of a card.`
      : `Up to ${deckLimits.max} cards, ${deckLimits.maxCopies} copies of a card.`;

  // per-type distribution strip
  const byType = new Map();
  for (const [id, n] of counts) {
    const c = cardCatalog.get(id);
    if (c) byType.set(c.type, (byType.get(c.type) || 0) + n);
  }
  deckDistEl.replaceChildren();
  for (const t of cardTypes) {
    const n = byType.get(t.id) || 0;
    const chip = document.createElement('span');
    chip.className = n ? 'dchip' : 'dchip empty';
    chip.style.setProperty('--c', `var(--t-${t.id})`);
    chip.append(icon(t.id, 12), document.createTextNode(`${t.name} ${n}`));
    chip.title = `${n} ${t.name} card${n === 1 ? '' : 's'} in your deck`;
    deckDistEl.appendChild(chip);
  }

  // My deck: grouped by type (priority order), non-empty groups only
  deckListEl.replaceChildren();
  if (!total) {
    const p = document.createElement('p');
    p.className = 'empty-note';
    p.textContent = 'Your deck is empty. Add cards from the pool below.';
    deckListEl.appendChild(p);
  } else {
    for (const t of cardTypes) {
      const ids = [...counts.keys()]
        .filter((id) => cardCatalog.get(id) && cardCatalog.get(id).type === t.id)
        .sort((a, b) => cardCatalog.get(a).name.localeCompare(cardCatalog.get(b).name));
      if (!ids.length) continue;
      const nCards = ids.reduce((s, id) => s + counts.get(id), 0);
      const grid = document.createElement('div');
      grid.className = 'card-grid';
      for (const id of ids) {
        grid.appendChild(gameCard(cardCatalog.get(id), { controls: 'deck', count: counts.get(id) }));
      }
      deckListEl.appendChild(typeGroup(t, cardWord(nCards), grid));
    }
  }

  // Card pool: the whole catalog, sorted per the toggle. Cards your class
  // cannot use are shown but locked (you can look, not add) and sort last.
  poolListEl.replaceChildren();
  const pool = [...cardCatalog.values()];
  const byUsable = (a, b) => Number(b.usable) - Number(a.usable);
  if (poolSort === 'type') {
    for (const t of cardTypes) {
      const cards = pool
        .filter((c) => c.type === t.id)
        .sort((a, b) => byUsable(a, b) || a.name.localeCompare(b.name));
      if (!cards.length) continue;
      const grid = document.createElement('div');
      grid.className = 'card-grid';
      for (const c of cards) {
        grid.appendChild(gameCard(c, { controls: 'pool', count: counts.get(c.id) || 0 }));
      }
      poolListEl.appendChild(typeGroup(t, cardWord(cards.length), grid));
    }
  } else {
    const sorted = [...pool].sort(
      poolSort === 'mana'
        ? (a, b) => byUsable(a, b) || a.manaCost - b.manaCost || a.name.localeCompare(b.name)
        : (a, b) => byUsable(a, b) || a.name.localeCompare(b.name),
    );
    const grid = document.createElement('div');
    grid.className = 'card-grid';
    for (const c of sorted) {
      grid.appendChild(gameCard(c, { controls: 'pool', count: counts.get(c.id) || 0 }));
    }
    poolListEl.appendChild(grid);
  }

  deckListEl.scrollTop = deckScroll;
  poolListEl.scrollTop = poolScroll;
}

const cardWord = (n) => `${n} card${n === 1 ? '' : 's'}`;

function typeGroup(type, countText, gridEl) {
  const wrap = document.createElement('div');
  wrap.className = 'type-group';
  wrap.dataset.type = type.id;
  const h = document.createElement('h4');
  h.append(icon(type.id, 15), document.createTextNode(type.name));
  const c = document.createElement('span');
  c.className = 'tg-count';
  c.textContent = countText;
  h.appendChild(c);
  wrap.append(h, gridEl);
  return wrap;
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

  if (card) {
    const parts = previewParts(card, statsForPreview());
    if (parts.length) {
      const prow = document.createElement('div');
      prow.className = 'gcard__preview';
      prow.append(...parts.map(previewChip));
      body.append(prow);
    }
  }

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
      const locked = card && card.usable === false;
      if (locked) el.classList.add('is-locked');
      if (n) {
        const c = document.createElement('span');
        c.className = 'count';
        c.textContent = `×${n}`;
        ctr.append(c);
      }
      const add = miniButton(locked ? 'Locked' : 'Add', () => setCardCount(id, n + 1));
      add.disabled = locked || n >= deckLimits.maxCopies || atMax;
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

  if (card) el.title = cardTooltip(card, statsForPreview());

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

poolSortEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-sort]');
  if (!btn) return;
  poolSort = btn.dataset.sort;
  for (const b of poolSortEl.querySelectorAll('button')) {
    b.classList.toggle('is-active', b === btn);
  }
  renderDeck();
});

// ---- Map --------------------------------------------------------------
async function loadMap() {
  if (!locations) {
    const j = await fetch('/api/locations').then((r) => r.json());
    locations = j.locations || [];
  }
  renderMap();
}

function renderMap() {
  if (!locations) return;

  const here = locations.find((l) => l.id === currentLocationId) || null;
  mapHereEl.hidden = !here;
  if (here) mapHereEl.textContent = `You are in: ${here.name}`;

  locationListEl.replaceChildren();
  for (const loc of locations) {
    const inHere = loc.id === currentLocationId;
    const card = document.createElement('div');
    card.className = 'location-card' + (inHere ? ' is-here' : '');

    const h = document.createElement('h3');
    h.textContent = loc.name;

    const lvl = document.createElement('span');
    lvl.className = 'pill';
    lvl.textContent = `Enemies Lvl ${loc.enemyLevels.min}–${loc.enemyLevels.max}`;
    h.append(lvl);

    const blurb = document.createElement('p');
    blurb.textContent = loc.blurb;

    const actions = document.createElement('div');
    actions.className = 'location-actions';
    if (inHere) {
      const seek = document.createElement('button');
      seek.className = 'btn discord';
      seek.textContent = 'Search for an enemy';
      seek.addEventListener('click', () => {
        duelReturnTab = 'map';
        socket.emit('location:seek');
      });
      const leave = document.createElement('button');
      leave.className = 'btn ghost';
      leave.textContent = 'Leave';
      leave.addEventListener('click', () => socket.emit('location:leave'));
      actions.append(seek, leave);
    } else {
      const enter = document.createElement('button');
      enter.className = 'btn';
      enter.textContent = 'Travel here';
      enter.addEventListener('click', () => socket.emit('location:enter', { locationId: loc.id }));
      actions.append(enter);
    }

    const note = document.createElement('p');
    note.className = 'hint location-note';

    card.append(h, blurb, actions, note);
    locationListEl.append(card);
  }
}

function mapNote(text) {
  const el = locationListEl.querySelector('.is-here .location-note')
    || locationListEl.querySelector('.location-note');
  if (el) el.textContent = text;
}

socket.on('location:state', ({ locationId }) => {
  currentLocationId = locationId || null;
  if (!tabPanels.map.hidden) renderMap();
});

socket.on('location:error', ({ error }) => {
  const map = {
    no_class: 'Pick a class first.',
    unknown_location: 'That place does not exist.',
    not_in_location: 'Travel to a location first.',
    already_in_duel: 'You are already in a duel.',
    deck_not_duel_legal: `Your deck needs at least ${deckLimits ? deckLimits.min : 15} cards to fight. Edit it on the Deck tab.`,
  };
  mapNote(map[error] || `Map error: ${error}`);
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
      const val = character.stats[stat.id] ?? 0;
      const base = (character.baseStats && character.baseStats[stat.id]) ?? val;
      dd.textContent = val;
      if (val > base) { dd.classList.add('geared'); dd.title = `${base} base + ${val - base} from gear`; }
      else if (val < base) { dd.classList.add('nerfed'); dd.title = `${base} base − ${base - val} from gear`; }
      dl.append(dt, dd);
    }
    box.appendChild(dl);
    statGroupsEl.appendChild(box);
  }
}

// ---- Equipment (Character tab) -----------------------------------------
const SLOT_ORDER = ['weapon', 'helmet', 'armor', 'boots', 'ring'];
const SLOT_LABELS = {
  weapon: 'Weapon', helmet: 'Helmet', armor: 'Armor', boots: 'Boots', ring: 'Ring',
};

const bagItemByUid = (character, uid) =>
  (character.bag || []).find((i) => i.uid === uid) || null;

function clientCanEquip(character, item) {
  const okClass = item.classes === 'all' || item.classes.includes(character.classId);
  const okLevel = (character.level || 1) >= ((item.requirements && item.requirements.level) || 1);
  return { okClass, okLevel, ok: okClass && okLevel };
}

const SLOT_ART = {
  weapon: 'physicalAttack', helmet: 'defensive', armor: 'defensive',
  boots: 'dexterity', ring: 'special',
};

/** An element glyph tucked inside a shield outline — for elemental DEFENSE. */
function shieldElementIcon(el, size = 12) {
  const wrap = document.createElement('span');
  wrap.className = 'sh-ico';
  wrap.style.color = `var(--el-${el})`;
  wrap.append(icon('defensive', size));
  const inner = icon(el, Math.round(size * 0.58));
  inner.classList.add('sh-inner');
  wrap.append(inner);
  return wrap;
}

/** stat id -> how to label + icon it on an item. */
function statMeta(statId) {
  const M = {
    attackMin: { icon: 'physicalAttack', label: 'Min Attack' },
    attackMax: { icon: 'physicalAttack', label: 'Max Attack' },
    defense: { icon: 'defensive', label: 'Defense' },
    health: { icon: 'heart', label: 'Health' },
    mana: { icon: 'mana', label: 'Mana' },
    strength: { icon: 'strength', label: 'Strength' },
    vitality: { icon: 'vitality', label: 'Vitality' },
    intelligence: { icon: 'intelligence', label: 'Intelligence' },
    dexterity: { icon: 'dexterity', label: 'Dexterity' },
    fireAtkMin: { el: 'fire', label: 'Fire Attack' },
    fireAtkMax: { el: 'fire', label: 'Fire Attack' },
    waterAtkMin: { el: 'water', label: 'Water Attack' },
    waterAtkMax: { el: 'water', label: 'Water Attack' },
    electricAtkMin: { el: 'electric', label: 'Electric Attack' },
    electricAtkMax: { el: 'electric', label: 'Electric Attack' },
    fireDef: { shieldEl: 'fire', label: 'Fire Defense' },
    waterDef: { shieldEl: 'water', label: 'Water Defense' },
    electricDef: { shieldEl: 'electric', label: 'Electric Defense' },
  };
  return M[statId] || { label: statLabel(statId) };
}

function statMetaIcon(meta, size = 12) {
  if (meta.shieldEl) return shieldElementIcon(meta.shieldEl, size);
  if (meta.el) {
    const ic = icon(meta.el, size);
    ic.style.color = `var(--el-${meta.el})`;
    return ic;
  }
  return meta.icon ? icon(meta.icon, size) : null;
}

function itemStatRow(meta, valueText, isBonus) {
  const row = document.createElement('div');
  row.className = 'istat' + (isBonus ? ' istat--bonus' : '');
  const l = document.createElement('span');
  l.className = 'istat-l';
  const ic = statMetaIcon(meta);
  if (ic) l.append(ic);
  l.append(document.createTextNode(meta.label));
  const v = document.createElement('span');
  v.className = 'istat-v';
  v.textContent = valueText;
  if (isBonus) row.title = 'Random bonus';
  row.append(l, v);
  return row;
}

/** Vertical list of an item's stats: attack pairs as ranges, then bonuses. */
function itemStatList(item) {
  const wrap = document.createElement('div');
  wrap.className = 'istats';
  const stats = { ...(item.stats || {}) };

  const PAIRS = [
    ['attackMin', 'attackMax', { icon: 'physicalAttack', label: 'Attack' }],
    ['fireAtkMin', 'fireAtkMax', { el: 'fire', label: 'Fire Attack' }],
    ['waterAtkMin', 'waterAtkMax', { el: 'water', label: 'Water Attack' }],
    ['electricAtkMin', 'electricAtkMax', { el: 'electric', label: 'Electric Attack' }],
  ];
  for (const [mn, mx, meta] of PAIRS) {
    if (mn in stats || mx in stats) {
      const lo = stats[mn] ?? stats[mx];
      const hi = stats[mx] ?? stats[mn];
      wrap.append(itemStatRow(meta, `${lo}–${hi}`, false));
      delete stats[mn];
      delete stats[mx];
    }
  }
  for (const [stat, amt] of Object.entries(stats)) {
    wrap.append(itemStatRow(statMeta(stat), `+${amt}`, false));
  }
  for (const b of item.bonuses || []) {
    wrap.append(itemStatRow(statMeta(b.stat), `+${b.amount}`, true));
  }
  return wrap;
}

function itemArt(slot) {
  const box = document.createElement('div');
  box.className = 'ic-art';
  box.append(icon(SLOT_ART[slot] || 'special', 30));
  return box;
}

function durabilityBar(item) {
  const d = item.durability || { current: 0, max: 100 };
  const pct = d.max ? Math.max(0, Math.min(100, (d.current / d.max) * 100)) : 0;
  const wrap = document.createElement('div');
  wrap.className = 'dura';
  const label = document.createElement('span');
  label.className = 'dura-label';
  label.textContent = d.current <= 0 ? 'Broken' : `${d.current}/${d.max}`;
  const track = document.createElement('div');
  track.className = 'dura-track';
  const fill = document.createElement('div');
  fill.className = 'dura-fill' + (d.current <= 0 ? ' broken' : pct < 25 ? ' low' : '');
  fill.style.width = `${pct}%`;
  track.append(fill);
  wrap.append(label, track);
  return wrap;
}

function renderEquipment(character) {
  // -- slots --
  equipSlotsEl.replaceChildren();
  const equipment = character.equipment || {};
  for (const slot of SLOT_ORDER) {
    const item = equipment[slot] ? bagItemByUid(character, equipment[slot]) : null;
    const el = document.createElement('div');
    el.className = 'equip-slot' + (item ? '' : ' empty');
    el.dataset.slot = slot;

    const head = document.createElement('div');
    head.className = 'es-slot';
    head.textContent = SLOT_LABELS[slot];
    el.append(head);

    if (item) {
      const name = document.createElement('div');
      name.className = 'es-name';
      name.textContent = item.name;
      el.append(name, itemStatList(item), durabilityBar(item));
      el.append(miniButton('Unequip', () =>
        equipmentAction('/api/equipment/unequip', { slot })));
    } else {
      const empty = document.createElement('div');
      empty.className = 'es-empty';
      empty.textContent = 'Empty';
      el.append(empty);
    }
    equipSlotsEl.append(el);
  }

  // -- bag --
  const bag = character.bag || [];
  const bagMax = character.bagMax || 30;
  bagCountEl.textContent = `${bag.length} / ${bagMax}`;
  bagCountEl.classList.toggle('warn', bag.length >= bagMax);

  bagListEl.replaceChildren();
  if (!bag.length) {
    const p = document.createElement('p');
    p.className = 'empty-note';
    p.textContent = currentUser && currentUser.isDev
      ? 'Bag is empty. Use "Generate item" to roll one.'
      : 'Bag is empty.';
    bagListEl.append(p);
    return;
  }
  const equipped = new Set(Object.values(equipment).filter(Boolean));
  for (const item of bag) bagListEl.append(bagCard(character, item, equipped));
}

function bagCard(character, item, equippedUids) {
  const el = document.createElement('div');
  el.className = 'item-card';
  el.dataset.slot = item.slot;
  const isEquipped = equippedUids.has(item.uid);
  if (isEquipped) el.classList.add('is-equipped');

  const head = document.createElement('div');
  head.className = 'ic-head';
  const name = document.createElement('span');
  name.className = 'ic-name';
  name.textContent = item.name;
  const slot = document.createElement('span');
  slot.className = 'ic-slot';
  slot.textContent = SLOT_LABELS[item.slot] || item.slot;
  head.append(name, slot);
  el.append(head, itemArt(item.slot));

  if (isEquipped) {
    const w = document.createElement('div');
    w.className = 'ic-worn';
    w.textContent = 'Equipped';
    el.append(w);
  }

  const chk = clientCanEquip(character, item);
  const lvlNeed = (item.requirements && item.requirements.level) || 1;
  const req = document.createElement('div');
  req.className = 'ic-req';
  const cls = document.createElement('span');
  cls.textContent = item.classes === 'all' ? 'Any class' : item.classes.map(cap).join(' · ');
  if (!chk.okClass) cls.className = 'unmet';
  req.append(cls);
  if (lvlNeed > 1) {
    const lv = document.createElement('span');
    lv.textContent = `Lvl ${lvlNeed}`;
    if (!chk.okLevel) lv.className = 'unmet';
    req.append(lv);
  }
  el.append(req, itemStatList(item), durabilityBar(item));

  const actions = document.createElement('div');
  actions.className = 'ic-actions';
  if (isEquipped) {
    actions.append(miniButton('Unequip', () =>
      equipmentAction('/api/equipment/unequip', { slot: item.slot })));
  } else {
    const eq = miniButton('Equip', () =>
      equipmentAction('/api/equipment/equip', { uid: item.uid }));
    eq.disabled = !chk.ok;
    if (!chk.ok) eq.title = !chk.okClass ? 'Your class can’t use this' : `Requires level ${lvlNeed}`;
    actions.append(eq);
  }
  const drop = miniButton('Drop', () => {
    if (confirm(`Drop ${item.name}? This can’t be undone.`)) {
      equipmentAction('/api/items/drop', { uid: item.uid });
    }
  });
  actions.append(drop);
  el.append(actions);
  return el;
}

function equipErrorText(error) {
  return {
    wrong_class: 'Your class can’t wear that item.',
    level_too_low: 'Your level is too low for that item.',
    bag_full: 'Your bag is full (30 items). Drop something first.',
    not_in_bag: 'That item isn’t in your bag.',
    not_dev: 'Generating items is a dev-only tool.',
    no_class: 'Pick a class first.',
  }[error] || `Could not do that${error ? `: ${error}` : ''}.`;
}

function applyCharacterUpdate(character) {
  currentUser.character = character;
  bagHintEl.hidden = true;
  levelInput.value = character.level;
  renderSheet(character);
  renderEquipment(character);
}

async function equipmentAction(url, body) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      bagHintEl.hidden = false;
      bagHintEl.textContent = equipErrorText(e.error);
      return;
    }
    applyCharacterUpdate((await res.json()).character);
  } catch (err) {
    console.error(err);
  }
}

generateItemBtn.addEventListener('click', () => equipmentAction('/api/items/generate', {}));

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
const PLAN_AHEAD = 5; // rounds planned ahead (matches the server)
let duelState = null;
let duelReturnTab = 'chat'; // tab to show after leaving a duel
let planSlots = [null, null, null, null, null];
let pendingCard = null; // card chosen for the far slot, not yet accepted

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
  duelReturnTab = 'chat';
  socket.emit('duel:find');
});

practiceDuelBtn.addEventListener('click', () => {
  ensureCatalog().catch(() => {});
  practiceNoteEl.textContent = '';
  duelReturnTab = 'map';
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
  selectTab(duelReturnTab);
  duelReturnTab = 'chat';
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
  pendingCard = null;
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
  pendingCard = null; // new round, fresh pick
  renderDuel();
});
socket.on('duel:end', ({ view }) => {
  duelState = view;
  renderDuel();
});
socket.on('duel:error', ({ error }) => {
  duelSearchEl.hidden = true;
  findDuelBtn.hidden = false;
  // practice is launched from the Map tab; matchmaking from Chat
  if (duelReturnTab === 'map') practiceNoteEl.textContent = duelErrorText(error);
  else duelCtaNote.textContent = duelErrorText(error);
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

/** One <dl> row. delta compares a live value to its base (you only). */
function statRow(dl, { label, iconName, shieldEl, elClass, value, base }) {
  const dt = document.createElement('dt');
  if (elClass) dt.className = elClass;
  if (shieldEl) dt.append(shieldElementIcon(shieldEl, 12), document.createTextNode(' ' + label));
  else if (iconName) dt.append(icon(iconName, 12), document.createTextNode(' ' + label));
  else dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value;
  if (typeof base === 'number' && typeof value === 'number') {
    if (value > base) dd.className = 'buffed';
    else if (value < base) dd.className = 'nerfed';
  }
  dl.append(dt, dd);
}

function statGroup(title, build) {
  const g = document.createElement('div');
  g.className = 'dp-group';
  const h = document.createElement('h5');
  h.textContent = title;
  const dl = document.createElement('dl');
  build(dl);
  g.append(h, dl);
  return g;
}

const hasElementalAttack = (st) =>
  ((st && st.fireAtkMax) || 0) + ((st && st.waterAtkMax) || 0) + ((st && st.electricAtkMax) || 0) > 0;

function renderPlayerPanel(el, p, isYou, showElementalDef) {
  el.replaceChildren();
  const st = p.stats || p.baseStats || {};
  const base = p.baseStats || {};

  const head = document.createElement('div');
  head.className = 'dp-head';
  head.textContent = p.name;
  const sub = document.createElement('span');
  sub.className = 'dp-sub';
  sub.textContent = `${cap(p.classId)} · Level ${p.level}`;
  head.append(sub);
  el.append(head);

  const bars = document.createElement('div');
  bars.className = 'dp-bars';
  bars.append(hpTrack(p.hp, p.maxHp), manaLine(p.mana));
  el.append(bars);

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

  el.append(
    statGroup('Combat', (dl) => {
      statRow(dl, { label: 'Attack', iconName: 'physical', value: `${st.attackMin}–${st.attackMax}` });
      statRow(dl, { label: 'Defense', iconName: 'defensive', value: st.defense, base: base.defense });
    }),
  );

  if (hasElementalAttack(st)) {
    el.append(
      statGroup('Elemental attack', (dl) => {
        statRow(dl, { label: 'Fire', iconName: 'fire', elClass: 'fire', value: `${st.fireAtkMin}–${st.fireAtkMax}` });
        statRow(dl, { label: 'Water', iconName: 'water', elClass: 'water', value: `${st.waterAtkMin}–${st.waterAtkMax}` });
        statRow(dl, { label: 'Electric', iconName: 'electric', elClass: 'elec', value: `${st.electricAtkMin}–${st.electricAtkMax}` });
      }),
    );
  }

  // Elemental defense is shown for both sides whenever elemental damage could
  // land this duel (either fighter has an elemental attack).
  if (showElementalDef) {
    el.append(
      statGroup('Elemental defense', (dl) => {
        statRow(dl, { label: 'Fire', shieldEl: 'fire', elClass: 'fire', value: st.fireDef, base: base.fireDef });
        statRow(dl, { label: 'Water', shieldEl: 'water', elClass: 'water', value: st.waterDef, base: base.waterDef });
        statRow(dl, { label: 'Electric', shieldEl: 'electric', elClass: 'elec', value: st.electricDef, base: base.electricDef });
      }),
    );
  }

  el.append(
    statGroup('General', (dl) => {
      statRow(dl, { label: 'Strength', iconName: 'strength', value: base.strength });
      statRow(dl, { label: 'Vitality', iconName: 'vitality', value: base.vitality });
      statRow(dl, { label: 'Intelligence', iconName: 'intelligence', value: base.intelligence });
      statRow(dl, { label: 'Dexterity', iconName: 'dexterity', value: base.dexterity });
    }),
  );

  const meta = document.createElement('div');
  meta.className = 'dp-meta';
  meta.append(seg(null, null, `Deck ${p.deckCount}`), seg(null, null, `Burned ${p.burnedCount}`));
  el.append(meta);

  if (isYou) el.append(queuedPlays());

  if (!isYou && duelState.phase !== 'ended') {
    const r = document.createElement('div');
    r.className = 'dp-ready' + (p.submitted ? '' : ' waiting');
    r.textContent = p.submitted ? 'Ready ✓' : 'Choosing…';
    el.append(r);
  }
}

/** Your queued cards for this round and the rounds ahead — the combo pipeline. */
function queuedPlays() {
  const v = duelState;
  const wrap = document.createElement('div');
  wrap.className = 'dp-queue';
  const h = document.createElement('h5');
  h.textContent = 'Queued plays';
  wrap.append(h);

  const ol = document.createElement('ol');
  const last = Math.min(v.totalRounds, v.round + PLAN_AHEAD - 1);
  for (let r = v.round; r <= last; r++) {
    const cid = r === v.slotToFill && pendingCard ? pendingCard : v.you.plan[r];
    const li = document.createElement('li');
    if (r === v.round) li.classList.add('now');
    const rr = document.createElement('span');
    rr.className = 'qr';
    rr.textContent = r === v.round ? `R${r} now` : `R${r}`;
    const nm = document.createElement('span');
    nm.className = 'qn';
    if (cid) {
      const c = cardCatalog.get(cid);
      li.dataset.type = c.type;
      nm.append(icon(c.type, 12), document.createTextNode(c.name));
      li.title = cardTooltip(c, v.you.stats);
    } else {
      li.classList.add('empty');
      nm.textContent = r === v.slotToFill ? 'choosing…' : '—';
    }
    const cc = document.createElement('span');
    cc.className = 'qc';
    if (cid) cc.textContent = `${cardCatalog.get(cid).manaCost}`;
    li.append(rr, nm, cc);
    ol.append(li);
  }
  wrap.append(ol);
  return wrap;
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

  const elementalInPlay =
    hasElementalAttack(v.you.stats) ||
    hasElementalAttack(v.opponent.stats || v.opponent.baseStats);
  renderPlayerPanel(duelOppoEl, v.opponent, false, elementalInPlay);
  renderPlayerPanel(duelYouEl, v.you, true, elementalInPlay);

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
    const box = document.createElement('div');
    box.append(note(`Pick your card for round ${v.slotToFill}, then Accept.`));
    box.append(manaPlanStrip(projectMana(v, pendingCard)));

    if (pendingCard) {
      const picked = document.createElement('div');
      picked.className = 'picked-wrap';
      picked.append(gameCard(pendingCard, {}));
      box.append(picked);

      const row = document.createElement('div');
      row.className = 'accept-row';
      const accept = document.createElement('button');
      accept.className = 'btn discord';
      accept.textContent = 'Accept';
      accept.addEventListener('click', () =>
        socket.emit('duel:card', { round: v.slotToFill, cardId: pendingCard }),
      );
      const change = document.createElement('button');
      change.className = 'btn ghost';
      change.textContent = 'Change';
      change.addEventListener('click', () => {
        pendingCard = null;
        renderDuel();
      });
      row.append(accept, change);
      box.append(row);
    } else {
      const hand = document.createElement('div');
      hand.className = 'hand';
      for (const id of handOrder(v.you.hand)) {
        const count = v.you.hand.filter((x) => x === id).length;
        hand.append(
          duelCard(id, {
            onClick: () => {
              pendingCard = id;
              renderDuel();
            },
            sub: count > 1 ? `×${count}` : '',
          }),
        );
      }
      if (!v.you.hand.length) hand.append(note('No cards left in hand.'));
      box.append(hand);
    }
    duelActionEl.append(box);
    return;
  }

  // rounds 11-15: nothing to plan
  const box = document.createElement('div');
  box.append(manaPlanStrip(projectMana(v, null)));
  const cont = document.createElement('button');
  cont.className = 'btn discord';
  cont.textContent = 'Continue';
  cont.addEventListener('click', () => socket.emit('duel:ready'));
  box.append(note('Nothing to plan this round.'), cont);
  duelActionEl.append(box);
}

/** Projected end-of-round mana for the planning window, current round first. */
function projectMana(v, slotCardId) {
  const rows = [];
  let m = v.you.mana;
  const end = v.slotToFill == null ? v.round : v.slotToFill;
  for (let r = v.round; r <= end; r++) {
    m += v.manaPerRound;
    let cid = v.you.plan[r];
    if (r === v.slotToFill) cid = slotCardId;
    let cost = 0;
    let burn = false;
    if (cid) {
      cost = cardCatalog.get(cid).manaCost;
      if (m >= cost) m -= cost;
      else burn = true;
    }
    rows.push({ round: r, cid, cost, burn, endMana: m, isPick: r === v.slotToFill });
  }
  return rows;
}

function projectManaOpening(v) {
  const rows = [];
  let m = v.you.mana;
  for (let i = 0; i < PLAN_AHEAD; i++) {
    m += v.manaPerRound;
    const cid = planSlots[i];
    let cost = 0;
    let burn = false;
    if (cid) {
      cost = cardCatalog.get(cid).manaCost;
      if (m >= cost) m -= cost;
      else burn = true;
    }
    rows.push({ round: i + 1, cid, cost, burn, endMana: m, isPick: false });
  }
  return rows;
}

function manaPlanStrip(rows) {
  const wrap = document.createElement('div');
  wrap.className = 'mana-plan';
  for (const row of rows) {
    const mp = document.createElement('div');
    mp.className = 'mp' + (row.isPick ? ' pick' : '') + (row.burn ? ' burn' : '');
    mp.title = row.burn ? 'Not enough mana — this card would burn with no effect' : '';
    const r = document.createElement('div');
    r.className = 'mp-r';
    r.textContent = row.isPick ? `R${row.round} · pick` : `R${row.round}`;
    const val = document.createElement('div');
    val.className = 'mp-v';
    val.append(icon('mana', 11), document.createTextNode(String(row.endMana)));
    mp.append(r, val);
    if (row.cid && (row.cost > 0 || row.burn)) {
      const c = document.createElement('div');
      c.className = 'mp-c';
      c.textContent = row.burn ? `−${row.cost} ✗` : `−${row.cost}`;
      mp.append(c);
    }
    wrap.append(mp);
  }
  return wrap;
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
      slot.title = cardTooltip(c, v.you.stats);
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
  lock.textContent = 'Accept plan';
  lock.disabled = planSlots.some((x) => !x);
  lock.addEventListener('click', () => socket.emit('duel:plan', { cards: planSlots }));

  wrap.append(
    note('Plan your first 5 rounds. Your opponent will not see them. Click a card to place it, click a slot to clear it.'),
    slots,
    manaPlanStrip(projectManaOpening(v)),
    hand,
    lock,
  );
  duelActionEl.append(wrap);
}

init();
