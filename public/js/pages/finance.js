import { get, getEnvelope } from '../api.js';
import { h, mount, money, num, dateTime, dateOnly, pageHead, tabs, field, select, button, table, pill, statusPill, load, spinner, emptyState } from '../dom.js';
import { rangeFor, PERIODS, stat, toCsv, downloadText, loadAllProducts, productMap, productLabel } from '../util.js';

export async function render() {
  const host = h('div', {}); let tab = 'summary'; let period = 'month';
  const periodTabs = () => tabs(PERIODS, period, (p) => { period = p; views[tab](); });
  const exportBtn = (name, rows, cols) => button('Export CSV', { onClick: () => downloadText(`${name}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows, cols)) });
  const views = {
    summary: () => load(host, async () => {
      const f = await get('/finance/summary', rangeFor(period));
      const line = (label, value, strong) => h('div', { class: 'row between' }, h('span', { class: strong ? 'semibold' : '' }, label), h('span', { class: `num ${strong ? 'bold' : ''}` }, value));
      return h('div', {}, periodTabs(), h('div', { class: 'grid stats' }, stat('Net revenue', money(f.netRevenue), 'Before tax, after returns', 'blue', '◎'), stat('Collected cash', money(f.collectedCash), f.pendingPayments ? `${money(f.pendingPayments)} sold but not yet confirmed` : 'Confirmed payments, net of refunds', 'teal', '◉'), stat('Gross profit', money(f.grossProfit), '', f.grossProfit < 0 ? 'bad' : 'amber', '◆'), stat('Net profit', money(f.netProfit), '', f.netProfit < 0 ? 'bad' : 'accent', '✓')),
        h('div', { class: 'login-gap' }), h('div', { class: 'card' }, h('h2', {}, 'How the profit is built'), line('Gross revenue (before tax)', money(f.grossRevenue)), line('− Returns', money(f.returnsRevenue)), line('= Net revenue', money(f.netRevenue), true), h('hr'), line('Cost of goods sold (FIFO)', money(f.grossCogs)), line('− COGS returned to stock', money(f.returnsCogs)), line('= Net COGS', money(f.netCogs), true), h('hr'), line('Gross profit', money(f.grossProfit), true), line('− Operating expenses', money(f.operatingExpenses)), line('Net profit', money(f.netProfit), true), h('hr'), line('Tax collected', money(f.taxCollected)), line('Tax returned', money(f.taxReturned)), line('Tax held for the authority', money(f.netTaxHeld), true)),
        h('p', { class: 'muted' }, 'Stock age is an inventory measure, not a profit measure. Profit = revenue − COGS − expenses.'));
    }),
    sales: () => load(host, async () => {
      const env = await getEnvelope('/reports/sales', rangeFor(period)); const rows = env.data;
      return reportTable('sales', rows, [{ label: 'Date', render: (r) => dateTime(r.date), value: (r) => r.date }, { label: 'Sale', render: (r) => h('a', { class: 'mono', href: `#/sales/${r.saleId}` }, r.saleId.slice(-10)), value: (r) => r.saleId }, { label: 'Method', render: (r) => r.paymentMethod, value: (r) => r.paymentMethod }, { label: 'Total', right: true, render: (r) => money(r.total), value: (r) => r.total }, { label: 'COGS', right: true, render: (r) => money(r.cogs), value: (r) => r.cogs }, { label: 'Profit', right: true, render: (r) => money(r.grossProfit), value: (r) => r.grossProfit }], env, `Revenue (incl. tax): ${money(env.summary.totalRevenue)}`);
    }),
    purchases: () => load(host, async () => {
      const env = await getEnvelope('/reports/purchases', rangeFor(period)); const rows = env.data;
      return reportTable('purchases', rows, [{ label: 'Date', render: (r) => dateTime(r.date), value: (r) => r.date }, { label: 'Order', render: (r) => h('a', { class: 'mono', href: `#/purchases/${r.purchaseId}` }, r.purchaseId.slice(-10)), value: (r) => r.purchaseId }, { label: 'Status', render: (r) => statusPill(r.status), value: (r) => r.status }, { label: 'Total', right: true, render: (r) => money(r.total), value: (r) => r.total }], env, `Total spend: ${money(env.summary.totalSpend)}`);
    }),
    returns: () => load(host, async () => {
      const env = await getEnvelope('/reports/returns', rangeFor(period)); const rows = env.data;
      return reportTable('returns', rows, [{ label: 'Date', render: (r) => dateTime(r.date), value: (r) => r.date }, { label: 'Return', render: (r) => h('a', { class: 'mono', href: `#/returns/${r.returnId}` }, r.returnId.slice(-10)), value: (r) => r.returnId }, { label: 'Sale', render: (r) => h('span', { class: 'mono' }, r.saleId.slice(-10)), value: (r) => r.saleId }, { label: 'Value', right: true, render: (r) => money(r.total), value: (r) => r.total }], env, `Total returned: ${money(env.summary.totalReturned)}`);
    }),
    products: () => load(host, async () => {
      const products = await loadAllProducts(); const sel = select(products.map((p) => [p.id, p.name])); const out = h('div', {});
      const go = async () => { if (!sel.value) return; mount(out, spinner()); try { const [perf, vel, trend] = await Promise.all([get('/analytics/product-performance', { productId: sel.value }), get('/analytics/velocity', { productId: sel.value }), get('/analytics/demand-trend', { productId: sel.value })]);
        mount(out, h('div', { class: 'grid stats' }, stat('Units sold', num(perf.unitsSold), undefined, 'blue', '▣'), stat('Revenue', money(perf.revenue), undefined, 'teal', '◎'), stat('Gross profit', money(perf.grossProfit), `Margin ${perf.grossMarginPercent === null || perf.grossMarginPercent === undefined ? '—' : num(perf.grossMarginPercent) + '%'}`, 'amber', '◆'), stat('In stock', num(perf.currentStock), `Sells ~${num(vel.velocityPerDay)} / day`, 'purple', '▤')), h('div', { class: 'card' }, h('h2', {}, 'Demand'), h('p', {}, `Last ${vel.periodDays} days: ${num(trend.currentPeriodUnits)} units vs ${num(trend.previousPeriodUnits)} in the period before. ` + (trend.insufficientData ? 'Not enough history yet to call a trend.' : `Change: ${num(trend.growthPercent)}%.`)))); } catch (e) { mount(out, h('div', { class: 'alert bad' }, e.detail || e.message)); } };
      sel.addEventListener('change', go); setTimeout(go, 0);
      return h('div', {}, field('Product', sel), out);
    }),
  };
  function reportTable(name, rows, cols, env, summaryText) {
    const csvCols = cols.map((c) => ({ label: c.label, value: c.value }));
    return h('div', {}, periodTabs(), h('div', { class: 'row between' }, h('span', { class: 'muted' }, `${rows.length} record(s)${summaryText ? ' · ' + summaryText : ''}`), exportBtn(name, rows, csvCols)), h('div', { class: 'card flush' }, table(cols, rows, { empty: 'No records in this period.', caption: name })));
  }
  const root = h('div', {}, pageHead('Finance & reports', 'Calculated by the server from transaction-level data'), tabs([['summary', 'Profit & loss'], ['sales', 'Sales'], ['purchases', 'Purchases'], ['returns', 'Returns'], ['products', 'Product performance']], tab, (t) => { tab = t; views[t](); }), host);
  views.summary(); return root;
}
