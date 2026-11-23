import { get, getEnvelope } from './api.js';
import { h, money, dateTime } from './dom.js';

export async function loadAllProducts() {
  const out = []; let page = 1;
  for (;;) {
    const env = await getEnvelope('/products', { page, pageSize: 200 });
    out.push(...env.data);
    if (out.length >= env.meta.total || env.data.length === 0 || page >= 25) break;
    page += 1;
  }
  return out;
}
export const productMap = (list) => new Map(list.map((p) => [p.id, p]));

// Date range helpers. `to` is end-of-day so the final day is included.
export function rangeFor(period) {
  const d = (date) => date.toLocaleDateString('sv-SE');
  const now = new Date(); const start = new Date(now);
  if (period === 'today') { /* start = today */ }
  else if (period === '7d') start.setDate(now.getDate() - 6);
  else if (period === '30d') start.setDate(now.getDate() - 29);
  else if (period === 'month') start.setDate(1);
  else return {};
  return { from: d(start), to: `${d(now)}T23:59:59.999Z` };
}
export const PERIODS = [['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month'], ['all', 'All time']];

// CSV export. Cells starting with = + - @ are prefixed so spreadsheet apps never evaluate them as formulas.
export function toCsv(rows, columns) {
  const esc = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(c.value(r))).join(','))].join('\n');
}
export function downloadText(filename, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = h('a', { href: url, download: filename }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// `icon` is a short glyph shown in a small colored chip (purely decorative --
// never a stand-in for data the server hasn't computed, e.g. no fabricated
// trend arrows). `tone` picks the chip color via a CSS class (never inline
// style: the strict CSP has no style-src 'unsafe-inline', so an inline
// style="" attribute would be silently dropped by the browser).
const STAT_TONE_CLASSES = ['accent', 'blue', 'purple', 'amber', 'teal', 'rose'];
export function stat(label, value, hint, tone, icon) {
  const toneClass = tone === 'bad' ? 'rose' : (STAT_TONE_CLASSES.includes(tone) ? tone : 'accent');
  return h('div', { class: 'card stat' },
    icon && h('div', { class: `stat-icon tone-${toneClass}`, 'aria-hidden': 'true' }, icon),
    h('div', { class: 'stat-body' },
      h('div', { class: 'label' }, label),
      h('div', { class: `value ${tone === 'bad' ? 'danger-text' : ''}` }, value),
      hint && h('div', { class: 'hint' }, hint)));
}

// Safe wrapper for optional dashboard sections: 403/failed section is simply hidden.
export async function optional(fn) { try { return await fn(); } catch { return null; } }
export const productLabel = (map, id) => (map.get(id) ? map.get(id).name : id);
export { money, dateTime, get };
