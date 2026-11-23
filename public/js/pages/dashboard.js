import { get, getEnvelope } from '../api.js';
import { h, mount, money, num, dateTime, localDayKey, weekdayShort, todayIso, pageHead, tabs, statusPill, spinner, emptyState, table, load, barChart } from '../dom.js';
import { state, can } from '../state.js';
import { rangeFor, PERIODS, stat, optional } from '../util.js';

// Last 7 real calendar days (business timezone), oldest first, today last --
// every bar is an actual sum of that day's completed sales, never estimated.
async function salesTrendSeries() {
  const todayKey = todayIso();
  const today = new Date(`${todayKey}T12:00:00Z`);
  const days = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(today); d.setUTCDate(d.getUTCDate() - i); days.push(d.toISOString().slice(0, 10)); }
  const from = days[0];
  const env = await getEnvelope('/reports/sales', { from, to: `${todayKey}T23:59:59.999Z` });
  const totals = Object.fromEntries(days.map((d) => [d, 0]));
  for (const sale of env.data) {
    const key = localDayKey(sale.date);
    if (key in totals) totals[key] += Number(sale.total) || 0;
  }
  return days.map((d) => ({ label: weekdayShort(d), value: Math.round(totals[d] * 100) / 100 }));
}

export async function render({ navigate }) {
  const root = h('div', {});
  root.append(pageHead(`Hello, ${state.user.email.split('@')[0]}`, `${state.business.name} · ${state.user.role}`,
    can('sale.write') && h('a', { class: 'btn primary', href: '#/pos' }, 'New sale')));

  if (can('finance.read')) {
    const host = h('div', {});
    let period = 'month';
    const draw = () => load(host, async () => {
      const f = await get('/finance/summary', rangeFor(period));
      return h('div', {}, h('div', { class: 'grid stats' },
        stat('Net revenue', money(f.netRevenue), `${f.salesCount} sales · before tax`, 'blue', '◎'),
        stat('Cost of goods sold', money(f.netCogs), 'FIFO batch cost', 'amber', '▤'),
        stat('Gross profit', money(f.grossProfit), 'Revenue − COGS', f.grossProfit < 0 ? 'bad' : 'teal', '◆'),
        stat('Operating expenses', money(f.operatingExpenses), undefined, 'rose', '−'),
        stat('Net profit', money(f.netProfit), 'Gross profit − expenses', f.netProfit < 0 ? 'bad' : 'accent', '✓'),
        stat('Tax held', money(f.netTaxHeld), 'Collected for the tax authority, not revenue', 'purple', '%')));
    });
    root.append(tabs(PERIODS, period, (p) => { period = p; draw(); }), host);
    draw();
  }

  if (can('sale.read')) {
    const chartCard = h('div', { class: 'card chart-card' });
    root.append(h('div', { class: 'login-gap' }), chartCard);
    load(chartCard, async () => {
      const series = await salesTrendSeries();
      return h('div', {}, h('h2', {}, 'Sales — last 7 days'), barChart(series, { barColor: 'var(--accent)', formatValue: (v) => money(v, false) }));
    });
  }

  const lower = h('div', { class: 'grid two' });
  root.append(h('div', { class: 'login-gap' }), lower);

  if (can('sale.read')) {
    const box = h('div', { class: 'card flush' });
    lower.append(box);
    load(box, async () => {
      const env = await getEnvelope('/sales', { page: 1, pageSize: 6 });
      const pending = env.data.filter((s) => s.payment && s.payment.status === 'PENDING');
      return h('div', {}, h('div', { class: 'row between', }, h('h2', { class: 'card-title' }, 'Recent sales'), h('a', { href: '#/sales' }, 'View all')),
        pending.length ? h('div', { class: 'alert warn' }, `${pending.length} recent sale(s) have a non-cash payment still PENDING confirmation.`) : null,
        env.data.length === 0 ? emptyState('No sales yet', 'Completed sales will appear here.') :
          h('div', { class: 'list-rows' }, env.data.map((s) => h('a', { class: 'item', href: `#/sales/${s.id}` },
            h('div', { class: 'grow' }, h('div', { class: 'semibold' }, money(s.total)), h('div', { class: 'muted' }, `${dateTime(s.createdAt)} · ${s.paymentMethod}`)),
            statusPill(s.payment ? s.payment.status : s.status)))));
    });
  }

  if (can('inventory.read')) {
    const box = h('div', { class: 'card flush' });
    lower.append(box);
    load(box, async () => {
      const env = await getEnvelope('/reports/inventory');
      const low = env.data.filter((r) => r.currentStock <= state.business.lowStockThreshold).sort((a, b) => a.currentStock - b.currentStock).slice(0, 8);
      return h('div', {}, h('div', { class: 'row between' }, h('h2', { class: 'card-title' }, 'Low stock'), h('a', { href: '#/inventory' }, 'Inventory')),
        low.length === 0 ? emptyState('Stock levels look healthy', `Nothing at or below ${state.business.lowStockThreshold} units.`) :
          h('div', { class: 'list-rows' }, low.map((r) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'semibold' }, r.name), h('div', { class: 'muted mono' }, r.sku)),
            h('span', { class: `pill ${r.currentStock <= 0 ? 'bad' : 'warn'}` }, `${num(r.currentStock)} left`)))));
    });
  }

  if (can('payment.reconcile')) {
    const box = h('div', { class: 'card' });
    lower.append(box);
    optional(() => get('/payments/unreconciled')).then((rows) => {
      if (rows && rows.length) mount(box, h('h2', {}, 'Payments needing attention'), h('div', { class: 'alert warn' }, `${rows.length} provider-confirmed payment(s) are not attached to a sale.`), h('a', { class: 'btn', href: '#/payments' }, 'Review payments'));
      else box.remove();
    });
  }
  return root;
}
