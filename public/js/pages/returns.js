import { get, post } from '../api.js';
import { h, mount, money, num, dateTime, pageHead, tabs, input, field, select, button, formModal, table, pill, statusPill, load, toast, errorState } from '../dom.js';
import { can } from '../state.js';

export async function render({ params, navigate }) {
  if (params[0]) return detail(params[0], navigate);
  const host = h('div', {}); let tab = 'returns';
  const views = {
    returns: () => load(host, async () => { const rows = await get('/returns');
      return h('div', { class: 'card flush' }, table([{ label: 'Return', render: (r) => h('div', {}, h('div', { class: 'semibold mono' }, r.id.slice(-10)), h('div', { class: 'muted' }, dateTime(r.createdAt))) }, { label: 'Sale', render: (r) => h('span', { class: 'mono' }, r.saleId.slice(-10)) }, { label: 'Value', right: true, render: (r) => money(r.total) }, { label: 'Refunded', right: true, render: (r) => money(r.refundedAmount) }, { label: 'Remaining', right: true, render: (r) => (r.refundableRemaining > 0 ? pill(money(r.refundableRemaining), 'warn') : pill('Settled', 'ok')) }], rows, { onRowClick: (r) => navigate(`returns/${r.id}`), empty: 'No returns yet. Start one from a sale.', caption: 'Returns' })); }),
    refunds: () => load(host, async () => { const rows = await get('/refunds');
      return h('div', { class: 'card flush' }, table([{ label: 'When', render: (r) => dateTime(r.createdAt) }, { label: 'Return', render: (r) => h('span', { class: 'mono' }, r.returnId.slice(-10)) }, { label: 'Method', key: 'method' }, { label: 'Amount', right: true, render: (r) => money(r.amount) }], rows, { empty: 'No refunds yet.', caption: 'Refunds' })); }),
  };
  const root = h('div', {}, pageHead('Returns & refunds', 'Stock goes back, money goes out — both audited'), tabs([['returns', 'Returns'], ['refunds', 'Refunds']], tab, (t) => { tab = t; views[t](); }), host);
  views.returns(); return root;
}

async function detail(id, navigate) {
  const root = h('div', {});
  await load(root, async () => {
    const r = await get(`/returns/${id}`);
    const refund = () => formModal({ title: 'Refund customer', submitLabel: 'Record refund', build: () => {
      const amount = input({ type: 'number', min: 0, step: 'any', value: r.refundableRemaining, required: true }); const method = select([['Cash', 'Cash'], ['MobileMoney', 'Mobile Money'], ['Card', 'Card']]);
      return { fields: h('div', { class: 'form-grid' }, field('Amount', amount, { hint: `At most ${money(r.refundableRemaining)} can still be refunded.` }), field('Method', method)), collect: () => { if (!(Number(amount.value) > 0)) throw new Error('Enter an amount above zero.'); return { returnId: id, amount: Number(amount.value), method: method.value }; } };
    }, submit: async (b) => { await post('/refunds', b); toast('Refund recorded', 'ok'); navigate('returns'); setTimeout(() => navigate(`returns/${id}`), 0); } });
    return h('div', {}, pageHead(`Return ${r.id.slice(-10)}`, dateTime(r.createdAt), button('← Back', { onClick: () => navigate('returns') }), r.refundableRemaining > 0 && can('refund.write') && button('Refund customer', { kind: 'primary', onClick: refund })),
      h('div', { class: 'grid stats' }, h('div', { class: 'card stat' }, h('div', { class: 'label' }, 'Return value'), h('div', { class: 'value' }, money(r.total))), h('div', { class: 'card stat' }, h('div', { class: 'label' }, 'Refunded'), h('div', { class: 'value' }, money(r.refundedAmount))), h('div', { class: 'card stat' }, h('div', { class: 'label' }, 'Still refundable'), h('div', { class: 'value' }, money(r.refundableRemaining)))),
      h('div', { class: 'login-gap' }), h('div', { class: 'card flush' }, table([{ label: 'Item', render: (i) => i.productName || i.saleItemId }, { label: 'Qty', right: true, render: (i) => num(i.quantity) }, { label: 'Condition', render: (i) => i.condition || '—' }, { label: 'Value', right: true, render: (i) => money(i.lineTotal) }], r.items, { caption: 'Returned items' })),
      h('p', { class: 'muted' }, h('a', { href: `#/sales/${r.saleId}` }, 'View original sale')));
  });
  return root;
}
