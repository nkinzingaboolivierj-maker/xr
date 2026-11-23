// Tiny DOM toolkit. Everything is built with createElement/textContent -- never
// innerHTML -- so server data can't inject markup (XSS), and the strict CSP
// (no inline script/style) holds.
import { errorMessage } from './api.js';

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (['value', 'checked', 'disabled', 'selected', 'hidden', 'indeterminate'].includes(k)) el[k] = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const mount = (el, ...kids) => { clear(el); append(el, kids); return el; };

// ---------- formatting (business currency / timezone set once after /me) ----------
const fmt = { currency: 'RWF', timeZone: 'Africa/Kigali' };
export function setFormat({ currency, timezone }) { if (currency) fmt.currency = currency; if (timezone) fmt.timeZone = timezone; }
export const currencyCode = () => fmt.currency;
export function money(n, withCode = true) {
  const v = Number(n || 0);
  const digits = fmt.currency === 'RWF' || fmt.currency === 'UGX' || fmt.currency === 'JPY' ? 0 : 2;
  const s = v.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(v) ? 0 : digits, maximumFractionDigits: Math.max(digits, Number.isInteger(v) ? 0 : 2) });
  return withCode ? `${s} ${fmt.currency}` : s;
}
export const num = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });
export function dateTime(iso) { if (!iso) return '—'; try { return new Date(iso).toLocaleString('en-GB', { timeZone: fmt.timeZone, dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso; } }
export function dateOnly(iso) { if (!iso) return '—'; try { return new Date(iso).toLocaleDateString('en-GB', { timeZone: fmt.timeZone, dateStyle: 'medium' }); } catch { return iso; } }
export const todayIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: fmt.timeZone }); // YYYY-MM-DD
// Local-day key (YYYY-MM-DD, business timezone) for grouping records by day -- same rule as todayIso, for any timestamp.
export function localDayKey(iso) { try { return new Date(iso).toLocaleDateString('sv-SE', { timeZone: fmt.timeZone }); } catch { return iso; } }
// dayKey is a plain YYYY-MM-DD business-local calendar day (from localDayKey).
// Anchored at UTC noon and read back out in UTC, so the weekday is derived
// purely from those Y/M/D digits -- no second, ambiguous timezone conversion.
export function weekdayShort(dayKey) { try { return new Date(dayKey + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }); } catch { return dayKey; } }

// ---------- components ----------
export function pill(text, tone = '') { return h('span', { class: `pill ${tone}` }, text); }

// A small colored-circle initials avatar next to a name, for table rows
// (customers, staff). The color is picked deterministically from the name
// itself -- decorative only, never implying anything about the record.
const AVATAR_TONES = ['accent', 'blue', 'purple', 'amber', 'teal', 'rose'];
function toneForName(name) {
  const s = String(name || '');
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}
export function nameAvatar(name, sub) {
  const initials = String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  return h('div', { class: 'name-with-avatar' },
    h('div', { class: `avatar sm tone-${toneForName(name)}`, 'aria-hidden': 'true' }, initials),
    h('div', {}, h('div', { class: 'semibold' }, name || '—'), sub && h('div', { class: 'muted' }, sub)));
}
export function statusPill(status) {
  const s = String(status || '').toLowerCase();
  const tone = ['completed', 'received', 'success', 'sent', 'active', 'ok', 'cash', 'verified', 'provider_verified'].includes(s) ? 'ok'
    : ['draft', 'pending', 'initiated', 'queued', 'retrying', 'manual'].includes(s) ? 'warn'
      : ['failed', 'cancelled', 'expired', 'inactive', 'voided'].includes(s) ? 'bad' : 'info';
  return pill(String(status || '—').replace(/_/g, ' '), tone);
}
export function field(label, input, { hint, error } = {}) {
  const id = input.id || `f-${Math.random().toString(36).slice(2, 8)}`;
  if (!input.id) input.id = id;
  if (error) input.setAttribute('aria-invalid', 'true');
  if (hint) input.setAttribute('aria-describedby', `${id}-hint`);
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint && h('div', { class: 'hint', id: `${id}-hint` }, hint), error && h('div', { class: 'error', role: 'alert' }, error));
}
export const input = (attrs) => h('input', { class: 'input', ...attrs });
export const textarea = (attrs) => h('textarea', { class: 'input', ...attrs });
export function select(options, { value, ...attrs } = {}) {
  const el = h('select', { class: 'input', ...attrs }, options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v }, l); }));
  if (value !== undefined) el.value = value;
  return el;
}
export function button(label, { kind = '', onClick, ...attrs } = {}) {
  return h('button', { type: 'button', class: `btn ${kind}`, onClick, ...attrs }, label);
}

export function spinner(text = 'Loading…') { return h('div', { class: 'state', role: 'status' }, h('div', { class: 'spinner' }), h('div', {}, text)); }
export function emptyState(title, text, action) { return h('div', { class: 'state' }, h('div', { class: 'big' }, title), text && h('div', {}, text), action && h('div', { class: 'row', style: undefined }, action)); }
export function errorState(err, retry) {
  const unauthorized = err && err.status === 401;
  return h('div', { class: 'state', role: 'alert' },
    h('div', { class: 'big' }, err && err.isNetwork ? 'You appear to be offline' : err && err.status === 403 ? 'Not allowed' : 'Something went wrong'),
    h('div', {}, errorMessage(err)),
    !unauthorized && retry && h('div', { class: 'row' }, button('Try again', { kind: 'primary', onClick: retry })));
}

// Runs `fn` into `container`, showing loading -> content or error(+retry).
export async function load(container, fn) {
  const run = async () => {
    mount(container, spinner());
    try { const node = await fn(); mount(container, node); }
    catch (err) { if (err && err.name === 'AbortError') return; mount(container, errorState(err, run)); }
  };
  await run();
}

export function table(columns, rows, { onRowClick, empty = 'Nothing here yet.', caption } = {}) {
  if (!rows || rows.length === 0) return emptyState(empty);
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    caption && h('caption', { class: 'sr-only' }, caption),
    h('thead', {}, h('tr', {}, columns.map((c) => h('th', { scope: 'col', class: c.right ? 'right' : '' }, c.label)))),
    h('tbody', {}, rows.map((r) => h('tr', onRowClick ? { class: 'clickable', tabindex: 0, onClick: () => onRowClick(r), onKeydown: (e) => { if (e.key === 'Enter') onRowClick(r); } } : {},
      columns.map((c) => h('td', { class: c.right ? 'right num' : '' }, c.render ? c.render(r) : r[c.key])))))));
}

// A small, dependency-free SVG bar chart. `series` is [{label, value}] --
// always real numbers the caller fetched, never fabricated. SVG presentation
// attributes (fill=, not style=) are used throughout, so this works under
// the strict CSP (style-src 'self', no inline style="") without any CSS.
const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  return el;
}
export function barChart(series, { height = 160, barColor = 'var(--accent)', formatValue = (v) => String(v) } = {}) {
  const width = 600; // viewBox units; scales to container via CSS (width:100%)
  const padL = 4; const padR = 4; const padTop = 18; const padBottom = 22;
  const plotH = height - padTop - padBottom;
  const max = Math.max(1, ...series.map((s) => s.value));
  const n = Math.max(1, series.length);
  const slot = (width - padL - padR) / n;
  const barW = Math.max(4, slot * 0.56);

  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Chart', class: 'bar-chart' });
  if (series.length === 0 || max === 0) {
    const empty = svgEl('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', class: 'bar-chart-empty' });
    empty.textContent = 'No data yet';
    svg.append(empty);
    return svg;
  }
  svg.append(svgEl('line', { x1: padL, y1: height - padBottom, x2: width - padR, y2: height - padBottom, class: 'bar-chart-axis' }));
  series.forEach((s, i) => {
    const x = padL + i * slot + (slot - barW) / 2;
    const h_ = Math.max(1, (s.value / max) * plotH);
    const y = height - padBottom - h_;
    const group = svgEl('g', {});
    group.append(svgEl('rect', { x, y, width: barW, height: h_, rx: Math.min(4, barW / 3), fill: barColor }));
    const valueLabel = svgEl('text', { x: x + barW / 2, y: y - 5, 'text-anchor': 'middle', class: 'bar-chart-value' });
    valueLabel.textContent = s.value > 0 ? formatValue(s.value) : '';
    group.append(valueLabel);
    const axisLabel = svgEl('text', { x: x + barW / 2, y: height - 6, 'text-anchor': 'middle', class: 'bar-chart-label' });
    axisLabel.textContent = s.label;
    group.append(axisLabel);
    svg.append(group);
  });
  return svg;
}

export function pageHead(title, sub, ...actions) {
  return h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, title), sub && h('div', { class: 'sub' }, sub)), h('div', { class: 'actions' }, actions));
}
export function tabs(items, active, onChange) {
  const wrap = h('div', { class: 'tabs', role: 'tablist' });
  const render = (cur) => mount(wrap, items.map(([id, label]) => h('button', { class: 'tab', role: 'tab', 'aria-selected': String(id === cur), onClick: () => { onChange(id); render(id); } }, label)));
  render(active);
  return wrap;
}

// ---------- toasts / modal / confirm ----------
export function toast(message, kind = '') {
  const host = document.getElementById('toasts');
  const el = h('div', { class: `toast ${kind}`, role: kind === 'bad' ? 'alert' : 'status' }, message);
  while (host.children.length >= 3) host.firstChild.remove(); // never stack a wall of toasts
  host.append(el);
  setTimeout(() => el.remove(), kind === 'bad' ? 7000 : 3800);
}

export function modal({ title, body, actions = [], wide = false, onClose }) {
  const previous = document.activeElement;
  const overlay = h('div', { class: 'overlay', onMousedown: (e) => { if (e.target === overlay) close(); } });
  const dialog = h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Close', onClick: () => close() }, '✕')),
    h('div', { class: 'modal-body' }, body),
    actions.length ? h('div', { class: 'modal-foot' }, actions) : null);
  overlay.append(dialog);
  function key(e) {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') { // keep focus inside the dialog
      const f = dialog.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]');
      if (!f.length) return;
      const first = f[0]; const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  function close() { document.removeEventListener('keydown', key); overlay.remove(); if (previous && previous.focus) previous.focus(); if (onClose) onClose(); }
  document.addEventListener('keydown', key);
  document.body.append(overlay);
  const firstField = dialog.querySelector('input,select,textarea') || dialog.querySelector('.modal-foot .btn') || dialog.querySelector('.btn');
  if (firstField) firstField.focus();
  return { close, dialog };
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let m;
    const done = (v) => { resolve(v); m.close(); }; // resolve FIRST: close() fires onClose, which resolves false
    m = modal({ title, body: h('p', {}, message), onClose: () => resolve(false),
      actions: [button('Cancel', { onClick: () => done(false) }), button(confirmLabel, { kind: danger ? 'danger' : 'primary', onClick: () => done(true) })] });
  });
}

// A form modal: `build()` returns {fields: Node, collect: () => payload}. `submit(payload)` may throw; its message is shown inline.
export function formModal({ title, build, submit, submitLabel = 'Save', wide = false }) {
  const { fields, collect } = build();
  const errBox = h('div', { role: 'alert' });
  let m; let busy = false;
  const saveBtn = button(submitLabel, { kind: 'primary', onClick: go });
  async function go() {
    if (busy) return;
    let payload;
    try { payload = collect(); } catch (e) { mount(errBox, h('div', { class: 'alert bad' }, e.message)); return; }
    busy = true; saveBtn.disabled = true; clear(errBox);
    try { await submit(payload); m.close(); }
    catch (e) { mount(errBox, h('div', { class: 'alert bad' }, errorMessage(e))); busy = false; saveBtn.disabled = false; }
  }
  const form = h('form', { onSubmit: (e) => { e.preventDefault(); go(); } }, errBox, fields, h('button', { type: 'submit', class: 'sr-only', tabindex: -1 }, 'Submit'));
  m = modal({ title, wide, body: form, actions: [button('Cancel', { onClick: () => m.close() }), saveBtn] });
  return m;
}

export function copyText(text) { return navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('Clipboard unavailable')); }
export function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
