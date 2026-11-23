import { auth, get, post, request, ApiError, errorMessage } from './api.js';
import { h, mount, clear, setFormat, toast, spinner, errorState, field, input, select, button, load } from './dom.js';
import { state, setMe, can, canAny } from './state.js';

const root = document.getElementById('root');

// ---------- theme (light / dark / auto-follow-system) ----------
// Persisted in localStorage (a plain display preference, not session data --
// sessionStorage is reserved for the auth token). Applied immediately on
// load, before anything else paints, so there is no flash of the wrong theme.
const THEME_KEY = 'xr.theme';
function applyTheme(mode) {
  if (mode === 'light' || mode === 'dark') document.documentElement.dataset.theme = mode;
  else delete document.documentElement.dataset.theme; // 'auto': follow prefers-color-scheme
}
function currentTheme() { try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch { return 'auto'; } }
function setTheme(mode) {
  try { localStorage.setItem(THEME_KEY, mode); } catch { /* storage unavailable: applies for this page view only */ }
  applyTheme(mode);
}
applyTheme(currentTheme());

function themeToggle() {
  const modes = [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']];
  const wrap = h('div', { class: 'theme-toggle', role: 'group', 'aria-label': 'Theme' });
  const paint = () => {
    const active = currentTheme();
    mount(wrap, modes.map(([id, label]) => h('button', { type: 'button', 'aria-pressed': String(id === active), onClick: () => { setTheme(id); paint(); } }, label)));
  };
  paint();
  return wrap;
}

// ---------- navigation registry (lazy-loaded page modules) ----------
const NAV = [
  { group: 'Sell', items: [
    { id: 'dashboard', label: 'Dashboard', ico: '◧', module: './pages/dashboard.js' },
    { id: 'pos', label: 'Point of sale', ico: '⌗', perm: 'sale.write', module: './pages/pos.js' },
    { id: 'sales', label: 'Sales', ico: '☰', perm: 'sale.read', module: './pages/sales.js' },
    { id: 'returns', label: 'Returns & refunds', ico: '↺', perm: 'return.read', module: './pages/returns.js' },
    { id: 'customers', label: 'Customers', ico: '☺', perm: 'customer.read', module: './pages/customers.js' },
  ] },
  { group: 'Stock', items: [
    { id: 'products', label: 'Products', ico: '▣', perm: 'product.read', module: './pages/products.js' },
    { id: 'inventory', label: 'Inventory', ico: '▤', perm: 'inventory.read', module: './pages/inventory.js' },
    { id: 'purchases', label: 'Purchases', ico: '⇩', perm: 'purchase.read', module: './pages/purchases.js' },
  ] },
  { group: 'Money', items: [
    { id: 'expenses', label: 'Expenses', ico: '−', perm: 'expense.read', module: './pages/expenses.js' },
    { id: 'finance', label: 'Finance & reports', ico: '∑', perm: 'finance.read', module: './pages/finance.js' },
    { id: 'payments', label: 'Payments', ico: '◉', perm: 'payment.read', module: './pages/payments.js' },
  ] },
  { group: 'Admin', items: [
    { id: 'team', label: 'Team', ico: '☻', perm: 'user.read', module: './pages/team.js' },
    { id: 'settings', label: 'Business', ico: '⚙', module: './pages/settings.js' },
    { id: 'account', label: 'My account', ico: '◍', module: './pages/account.js' },
  ] },
];
const allItems = () => NAV.flatMap((g) => g.items);
const visible = (it) => !it.perm || can(it.perm);

// ---------- global handlers ----------
auth.onUnauthorized = () => {
  if (!state.user) return;
  auth.token = null; state.user = null;
  renderLogin('Your session has ended. Please sign in again.');
};
function syncOnline() { document.getElementById('offline-banner').hidden = navigator.onLine; }
window.addEventListener('online', syncOnline); window.addEventListener('offline', syncOnline); syncOnline();

// ---------- login ----------
function renderLogin(notice) {
  state.user = null;
  const err = h('div', { role: 'alert' });
  const email = input({ type: 'email', autocomplete: 'username', required: true, name: 'email' });
  const password = input({ type: 'password', autocomplete: 'current-password', required: true, name: 'password' });
  let businessId = null;
  const bizHost = h('div', {});
  const submit = button('Sign in', { kind: 'primary block', type: 'submit' });
  const form = h('form', { class: 'card login-card', novalidate: true, onSubmit: async (e) => {
    e.preventDefault(); clear(err);
    if (!email.value.trim() || !password.value) { mount(err, h('div', { class: 'alert bad' }, 'Enter your email and password.')); return; }
    submit.disabled = true;
    try {
      const body = { email: email.value.trim(), password: password.value };
      if (businessId) body.businessId = businessId.value;
      const { data } = await request('POST', '/auth/login', { body, auth: false });
      auth.token = data.sessionId;
      await boot();
    } catch (ex) {
      if (ex instanceof ApiError && ex.code === 'BUSINESS_SELECTION_REQUIRED') {
        businessId = select(ex.extra.businesses.map((b) => [b.id, b.name]));
        mount(bizHost, field('Which business?', businessId, { hint: 'These credentials exist in more than one business.' }));
        mount(err, h('div', { class: 'alert info' }, 'Choose a business, then sign in again.'));
      } else mount(err, h('div', { class: 'alert bad' }, errorMessage(ex)));
    } finally { submit.disabled = false; }
  } },
  h('div', { class: 'brandmark' }, 'XR'), h('h1', {}, 'Sign in'), h('div', { class: 'muted' }, 'XR Business Management & POS'),
  h('div', { class: 'login-gap' }), notice && h('div', { class: 'alert warn' }, notice), err,
  field('Email', email), field('Password', password), bizHost, submit);
  mount(root, h('main', { class: 'login', id: 'main' }, form));
  email.focus();
}

// ---------- forced password change (temporary password) ----------
function renderForcedPasswordChange() {
  const err = h('div', { role: 'alert' });
  const cur = input({ type: 'password', autocomplete: 'current-password', required: true });
  const next = input({ type: 'password', autocomplete: 'new-password', required: true, minlength: 8 });
  const again = input({ type: 'password', autocomplete: 'new-password', required: true });
  const form = h('form', { class: 'card login-card', onSubmit: async (e) => {
    e.preventDefault(); clear(err);
    if (next.value !== again.value) { mount(err, h('div', { class: 'alert bad' }, 'The new passwords do not match.')); return; }
    try { await post('/auth/change-password', { currentPassword: cur.value, newPassword: next.value }); toast('Password changed', 'ok'); await boot(); }
    catch (ex) { mount(err, h('div', { class: 'alert bad' }, errorMessage(ex))); }
  } }, h('h1', {}, 'Choose a new password'), h('p', { class: 'muted' }, 'You signed in with a temporary password. Set your own to continue.'), err,
  field('Temporary password', cur), field('New password', next, { hint: 'At least 8 characters.' }), field('Repeat new password', again), button('Save and continue', { kind: 'primary block', type: 'submit' }));
  mount(root, h('main', { class: 'login', id: 'main' }, form, h('div', { class: 'row' }, button('Sign out instead', { kind: 'ghost', onClick: signOut }))));
}

async function signOut() {
  try { await request('POST', '/auth/logout'); } catch { /* the token is dropped locally regardless */ }
  auth.token = null; state.user = null; location.hash = '';
  renderLogin();
}

// ---------- shell ----------
let shellEls = null;
function renderShell() {
  const nav = h('nav', { class: 'nav', 'aria-label': 'Main' }, NAV.map((g) => {
    const items = g.items.filter(visible);
    return items.length ? h('div', { class: 'nav-group' }, h('div', { class: 'nav-title' }, g.group), items.map((it) => h('a', { href: `#/${it.id}`, dataset: { id: it.id } }, h('span', { class: 'ico', 'aria-hidden': 'true' }, it.ico), it.label))) : null;
  }));
  const initials = (state.user.email || '?').slice(0, 2).toUpperCase();
  const sidebar = h('aside', { class: 'sidebar', id: 'sidebar' },
    h('div', { class: 'brand' }, h('div', { class: 'brandmark' }, 'XR'), h('div', {}, h('div', { class: 'brand-name' }, state.business.name), h('div', { class: 'brand-sub' }, 'Business & POS'))),
    nav,
    h('div', { class: 'sidebar-foot' }, themeToggle(), h('div', { class: 'usercard' }, h('div', { class: 'avatar', 'aria-hidden': 'true' }, initials), h('div', { class: 'who' }, h('div', { class: 'semibold' }, state.user.email), h('div', { class: 'muted' }, state.user.role))),
      button('Sign out', { kind: 'ghost small', onClick: signOut })));
  const shell = h('div', { class: 'shell' });
  const scrim = h('div', { class: 'scrim', hidden: true, onClick: () => closeNav() });
  function openNav() { shell.classList.add('nav-open'); scrim.hidden = false; }
  const topbar = h('div', { class: 'topbar' }, h('button', { class: 'btn small', type: 'button', 'aria-label': 'Open menu', 'aria-controls': 'sidebar', onClick: openNav }, '☰ Menu'), h('div', { class: 'semibold', id: 'topbar-title' }, state.business.name));

  // Phone-sized screens also get a fixed bottom tab bar (the sidebar drawer
  // behind "☰ Menu" still has every destination) -- the first few
  // permission-visible items the person can reach with a thumb, in the same
  // priority order as the sidebar, plus a "More" tab for everything else.
  const bottomItems = allItems().filter(visible).slice(0, 4);
  const bottomNav = h('nav', { class: 'bottom-nav', 'aria-label': 'Quick navigation' },
    bottomItems.map((it) => h('a', { href: `#/${it.id}`, dataset: { id: it.id } }, h('span', { class: 'ico', 'aria-hidden': 'true' }, it.ico), h('span', { class: 'bottom-nav-label' }, it.label))),
    h('button', { type: 'button', 'aria-label': 'More', 'aria-controls': 'sidebar', onClick: openNav }, h('span', { class: 'ico', 'aria-hidden': 'true' }, '⋯'), h('span', { class: 'bottom-nav-label' }, 'More')));

  const main = h('main', { class: 'main', id: 'main', tabindex: -1 });
  const page = h('div', { class: 'page' });
  main.append(page);
  shell.append(sidebar, h('div', { class: 'main-col' }, topbar, main, bottomNav), scrim);
  function closeNav() { shell.classList.remove('nav-open'); scrim.hidden = true; }
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) closeNav(); });
  mount(root, shell);
  shellEls = { page, nav, bottomNav, main, closeNav };
  window.removeEventListener('hashchange', route); window.addEventListener('hashchange', route);
  route();
}

let navToken = 0;
async function route() {
  if (!state.user || !shellEls) return;
  const id = (location.hash.replace(/^#\//, '').split('/')[0]) || 'dashboard';
  const item = allItems().find((i) => i.id === id && visible(i)) || allItems()[0];
  if (item.id !== id) { location.hash = `#/${item.id}`; return; }
  const my = ++navToken;
  shellEls.nav.querySelectorAll('a').forEach((a) => { if (a.dataset.id === item.id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  shellEls.bottomNav.querySelectorAll('a').forEach((a) => { if (a.dataset.id === item.id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  document.title = `${item.label} · XR`;
  const page = shellEls.page;
  mount(page, spinner());
  try {
    // A failed dynamic import is cached by the browser for that exact URL, so after a failure the retry uses a fresh URL.
    const mod = await import(item.bust ? `${item.module}?r=${item.bust}` : item.module).catch((e) => { item.bust = Date.now(); throw e; });
    if (my !== navToken) return; // user navigated away while the module loaded
    const node = await mod.render({ navigate: (to) => { location.hash = `#/${to}`; }, params: location.hash.split('/').slice(2) });
    if (my !== navToken) return;
    mount(page, node);
    shellEls.main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  } catch (err) {
    if (my !== navToken) return;
    const failure = err instanceof ApiError ? err
      : navigator.onLine ? new ApiError({ code: 'LOAD_FAILED', detail: 'This screen failed to load.' })
        : new ApiError({ code: 'NETWORK', detail: 'You appear to be offline. Check your connection and try again.' });
    mount(page, errorState(failure, route));
  }
}

// ---------- boot ----------
async function boot() {
  if (!auth.token) { renderLogin(); return; }
  mount(root, spinner('Starting…'));
  try {
    const me = await get('/me');
    setMe(me);
    setFormat({ currency: me.business.currency, timezone: me.business.timezone });
    if (me.mustChangePassword) { renderForcedPasswordChange(); return; }
    renderShell();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) { auth.token = null; renderLogin(); return; }
    mount(root, h('div', { class: 'login' }, h('div', { class: 'card login-card' }, errorState(err, boot))));
  }
}
boot();
