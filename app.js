const FEEDBACK_KEY = 'events_pwa_feedback';
const STATUS_PRIORITY = ['favorite', 'attended', 'skip'];

let EVENTS = [];
let GENERATED_AT = null;

const view = {
  screen: 'browse', // 'browse' | 'datenight'
  search: '',
  filter: 'All events',
  sort: 'Date',
  selectedEvent: null,
};

// ── Feedback (localStorage, phone-local only) ──────────────────────────────

function loadFeedback() {
  try {
    const raw = JSON.parse(localStorage.getItem(FEEDBACK_KEY));
    return { skip: [], attended: [], favorite: [], ...raw };
  } catch {
    return { skip: [], attended: [], favorite: [] };
  }
}

function saveFeedback(fb) {
  localStorage.setItem(FEEDBACK_KEY, JSON.stringify(fb));
}

function getStatus(title, fb) {
  const tl = title.toLowerCase();
  for (const key of STATUS_PRIORITY) {
    if ((fb[key] || []).some((t) => t.toLowerCase() === tl)) return key;
  }
  return null;
}

function setStatus(title, status) {
  const fb = loadFeedback();
  const tl = title.toLowerCase();
  for (const key of ['skip', 'attended', 'favorite']) {
    fb[key] = (fb[key] || []).filter((t) => t.toLowerCase() !== tl);
  }
  if (status) {
    fb[status] = fb[status] || [];
    fb[status].push(tl);
  }
  saveFeedback(fb);
}

// ── Formatting helpers (mirror dashboard.py) ────────────────────────────────

function fmtDateRange(e) {
  if (!e.date) return 'Check availability';
  const start = new Date(`${e.date}T00:00:00`);
  const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (e.end_date && e.end_date !== e.date) {
    const end = new Date(`${e.end_date}T00:00:00`);
    const endStr = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${startStr} – ${endStr}`;
  }
  return start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtPrice(e) {
  if (e.price_min == null) return '';
  let s = `$${Math.round(e.price_min)}`;
  if (e.price_max) s += ` – $${Math.round(e.price_max)}`;
  return s;
}

function priceSymbols(level) {
  return level ? '$'.repeat(level) : '';
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ── Init ─────────────────────────────────────────────────────────────────

async function init() {
  const app = document.getElementById('app');
  try {
    const res = await fetch('data.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    EVENTS = data.events || [];
    GENERATED_AT = data.generated_at || null;
  } catch (err) {
    app.innerHTML = `<div class="empty-state">
      <p>Couldn't load event data.</p>
      <p class="muted">Connect to the internet at least once after installing, then reopen the app.</p>
    </div>`;
    return;
  }

  app.addEventListener('click', onAppClick);
  render();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
}

function onAppClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id, status } = el.dataset;

  if (action === 'status') {
    const event = EVENTS.find((ev) => ev.id === id);
    const fb = loadFeedback();
    const current = getStatus(event.title, fb);
    setStatus(event.title, current === status ? null : status);
    updateList();
  } else if (action === 'clear') {
    const event = EVENTS.find((ev) => ev.id === id);
    setStatus(event.title, null);
    updateList();
  } else if (action === 'plan') {
    view.selectedEvent = EVENTS.find((ev) => ev.id === id);
    view.screen = 'datenight';
    render();
  } else if (action === 'back') {
    view.screen = 'browse';
    render();
  }
}

// ── Render: top-level screen dispatch ───────────────────────────────────────

function render() {
  const app = document.getElementById('app');
  app.innerHTML = view.screen === 'browse' ? browseShellHtml() : dateNightHtml();
  attachScreenListeners();
  if (view.screen === 'browse') updateList();
}

function attachScreenListeners() {
  if (view.screen !== 'browse') return;
  const searchEl = document.getElementById('search');
  const filterEl = document.getElementById('view-filter');
  const sortEl = document.getElementById('sort-by');
  searchEl.addEventListener('input', (e) => { view.search = e.target.value; updateList(); });
  filterEl.addEventListener('change', (e) => { view.filter = e.target.value; updateList(); });
  sortEl.addEventListener('change', (e) => { view.sort = e.target.value; updateList(); });
}

// ── Browse & Rate ────────────────────────────────────────────────────────

function browseShellHtml() {
  const updated = GENERATED_AT
    ? new Date(GENERATED_AT).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;
  return `
    <header class="app-header">
      <h1>🌃 Date Night NYC</h1>
      ${updated ? `<p class="muted small">Data current as of ${updated}</p>` : ''}
    </header>
    <div class="controls">
      <input id="search" type="search" placeholder="Filter by title..." value="${escapeHtml(view.search)}">
      <select id="view-filter">
        ${['All events', 'Favorites', 'Unrated'].map((o) => `<option ${o === view.filter ? 'selected' : ''}>${o}</option>`).join('')}
      </select>
      <select id="sort-by">
        ${['Date', 'Category', 'Source'].map((o) => `<option ${o === view.sort ? 'selected' : ''}>${o}</option>`).join('')}
      </select>
    </div>
    <p id="result-count" class="muted small"></p>
    <div id="event-list"></div>
  `;
}

function getFilteredSortedEvents() {
  const fb = loadFeedback();
  const favSet = new Set((fb.favorite || []).map((t) => t.toLowerCase()));
  const attSet = new Set((fb.attended || []).map((t) => t.toLowerCase()));
  const skipSet = new Set((fb.skip || []).map((t) => t.toLowerCase()));
  const ratedSet = new Set([...favSet, ...attSet, ...skipSet]);

  let filtered = EVENTS;
  if (view.search) {
    const q = view.search.toLowerCase();
    filtered = filtered.filter((e) => e.title.toLowerCase().includes(q));
  }
  if (view.filter === 'Favorites') {
    filtered = filtered.filter((e) => favSet.has(e.title.toLowerCase()));
  } else if (view.filter === 'Unrated') {
    filtered = filtered.filter((e) => !ratedSet.has(e.title.toLowerCase()));
  }

  const favKey = (e) => (favSet.has(e.title.toLowerCase()) ? 0 : 1);
  let keyFn;
  if (view.sort === 'Category') keyFn = (e) => [favKey(e), e.category || '', e.date || ''];
  else if (view.sort === 'Source') keyFn = (e) => [favKey(e), e.source || '', e.date || ''];
  else keyFn = (e) => [favKey(e), e.date || ''];

  return [...filtered].sort((a, b) => {
    const ka = keyFn(a), kb = keyFn(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] < kb[i]) return -1;
      if (ka[i] > kb[i]) return 1;
    }
    return 0;
  });
}

function updateList() {
  const listEl = document.getElementById('event-list');
  const countEl = document.getElementById('result-count');
  if (!listEl) return;
  const fb = loadFeedback();
  const filtered = getFilteredSortedEvents();

  countEl.textContent = `${filtered.length} event${filtered.length !== 1 ? 's' : ''}`;
  if (!filtered.length) {
    listEl.innerHTML = '<p class="empty-state">No events match your filter.</p>';
    return;
  }
  listEl.innerHTML = filtered.map((e) => eventCardHtml(e, getStatus(e.title, fb))).join('');
}

function eventCardHtml(e, status) {
  const prefix = status === 'favorite' ? '❤️ ' : status === 'attended' ? '✓ ' : status === 'skip' ? '⊘ ' : '';
  const venueCity = e.venue ? `${e.venue}, ${e.city}` : e.city;
  const tags = [fmtDateRange(e)];
  if (e.category) tags.push(titleCase(e.category));
  const price = fmtPrice(e);
  if (price) tags.push(price);
  if (e.source) tags.push(titleCase(e.source));

  return `
    <div class="card">
      <div class="card-info">
        <p class="card-title">${prefix}${escapeHtml(e.title)}</p>
        <p class="muted small">📍 ${escapeHtml(venueCity)} &nbsp;·&nbsp; ${tags.map(escapeHtml).join(' &nbsp;·&nbsp; ')}</p>
        ${e.url ? `<a class="link" href="${escapeHtml(e.url)}" target="_blank" rel="noopener">View ↗</a>` : ''}
      </div>
      <div class="card-actions">
        <div class="btn-row">
          <button data-action="status" data-id="${e.id}" data-status="skip" class="btn ${status === 'skip' ? 'btn-active' : ''}" title="Skip">⊘</button>
          <button data-action="status" data-id="${e.id}" data-status="attended" class="btn ${status === 'attended' ? 'btn-active' : ''}" title="Attended">✓</button>
          <button data-action="status" data-id="${e.id}" data-status="favorite" class="btn ${status === 'favorite' ? 'btn-active' : ''}" title="Favorite">❤️</button>
          <button data-action="clear" data-id="${e.id}" class="btn" title="Clear" ${status ? '' : 'disabled'}>×</button>
        </div>
        <button data-action="plan" data-id="${e.id}" class="btn btn-block">🗓 Plan date night</button>
      </div>
    </div>
  `;
}

function titleCase(s) {
  return s.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
}

// ── Date Night (read-only) ──────────────────────────────────────────────

function dateNightHtml() {
  const e = view.selectedEvent;
  const venueCity = e.venue ? `${e.venue}, ${e.city}` : e.city;
  const restaurants = e.restaurants || [];

  const dateInput = e.date
    ? `<input type="date" id="dn-date" value="${e.date}" min="${e.date}" max="${e.end_date || e.date}">`
    : '<p class="muted small">Check availability</p>';

  return `
    <header class="app-header">
      <button data-action="back" class="btn-link">← Back</button>
      <h1>Date Night</h1>
    </header>
    <div class="card">
      <p class="card-title">${escapeHtml(e.title)}</p>
      <p class="muted small">📍 ${escapeHtml(venueCity)}</p>
      ${e.description ? `<p class="small">${escapeHtml(e.description)}</p>` : ''}
      ${e.url ? `<a class="link" href="${escapeHtml(e.url)}" target="_blank" rel="noopener">View event ↗</a>` : ''}
    </div>
    <label class="field-label" for="dn-date">Your date</label>
    ${dateInput}
    <h2 class="section-heading">🍽️ Nearby restaurants</h2>
    ${restaurants.length
      ? restaurants.map(restaurantCardHtml).join('')
      : '<p class="empty-state">No restaurant suggestions available for this event.</p>'}
  `;
}

function restaurantCardHtml(r) {
  const meta = [];
  if (r.rating != null) meta.push(`★ ${r.rating}`);
  const priceSym = priceSymbols(r.price_level);
  if (priceSym) meta.push(priceSym);
  if (r.cuisine && r.cuisine.length) meta.push(r.cuisine.join(' '));
  if (r.address) meta.push(r.address);

  return `
    <div class="card restaurant-card">
      ${r.photo_url ? `<img class="restaurant-photo" src="${escapeHtml(r.photo_url)}" alt="${escapeHtml(r.name)}" loading="lazy">` : ''}
      <div class="card-info">
        <p class="card-title">${escapeHtml(r.name)}</p>
        ${meta.length ? `<p class="muted small">${meta.map(escapeHtml).join(' &nbsp;·&nbsp; ')}</p>` : ''}
        ${r.description ? `<p class="small">${escapeHtml(r.description)}</p>` : ''}
        ${r.url ? `<a class="link" href="${escapeHtml(r.url)}" target="_blank" rel="noopener">View on Maps ↗</a>` : ''}
      </div>
    </div>
  `;
}

init();
