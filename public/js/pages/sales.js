import { get, getEnvelope, post, fetchBlobUrl, errorMessage } from '../api.js';
import { h, mount, money, num, dateTime, pageHead, input, field, select, textarea, button, formModal, table, pill, statusPill, load, toast, emptyState, spinner } from '../dom.js';
import { state, can } from '../state.js';

export async function render({ params, navigate }) {
  if (params[0]) return saleDocument(params[0], navigate);
  const host = h('div', {}); let page = 1;
  const draw = () => load(host, async () => {
    const env = await getEnvelope('/sales', { page, pageSize: 25 });
    const { total, pageSize } = env.meta;
    return h('div', { class: 'card flush' }, table([
      { label: 'Sale', render: (s) => h('div', {}, h('div', { class: 'semibold mono' }, s.id.slice(-10)), h('div', { class: 'muted' }, dateTime(s.createdAt))) },
      { label: 'Items', right: true, render: (s) => s.items.length }, { label: 'Total', right: true, render: (s) => money(s.total) },
      { label: 'Method', render: (s) => s.paymentMethod }, { label: 'Payment', render: (s) => statusPill(s.payment ? s.payment.status : s.status) },
    ], env.data, { onRowClick: (s) => navigate(`sales/${s.id}`), empty: 'No sales yet.', caption: 'Sales' }),
    total > pageSize ? h('div', { class: 'pager' }, h('span', { class: 'muted' }, `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`), button('Previous', { disabled: page === 1, onClick: () => { page -= 1; draw(); } }), button('Next', { disabled: page * pageSize >= total, onClick: () => { page += 1; draw(); } })) : null);
  });
  const root = h('div', {}, pageHead('Sales', 'Completed sales and their receipts', can('sale.write') && h('a', { class: 'btn primary', href: '#/pos' }, 'New sale')), host);
  draw(); return root;
}

async function saleDocument(id, navigate) {
  const root = h('div', {});
  await load(root, async () => {
    const [sale, r] = await Promise.all([get(`/sales/${id}`), get(`/documents/receipt/${id}`)]);
    const costs = can('finance.read'); const b = r.business;
    const pdf = async () => { try { window.open(await fetchBlobUrl(`/documents/receipt/${id}/pdf`), '_blank', 'noopener'); } catch (e) { toast(errorMessage(e), 'bad'); } };
    const confirmPay = () => formModal({ title: 'Confirm payment', submitLabel: 'Confirm payment', build: () => { const ref = input({ required: true, placeholder: 'Transaction ID' }); return { fields: field('Payment reference', ref, { hint: 'Recorded with your name in the audit log.' }), collect: () => { if (!ref.value.trim()) throw new Error('A reference is required.'); return { reference: ref.value.trim() }; } }; }, submit: async (body) => { await post(`/sales/${id}/confirm-payment`, body); toast('Payment confirmed', 'ok'); navigate('sales'); setTimeout(() => navigate(`sales/${id}`), 0); } });
    const whatsapp = () => formModal({ title: 'Send receipt on WhatsApp', submitLabel: 'Queue message', build: () => { const phone = input({ type: 'tel', required: true, placeholder: '07…', value: (r.customer && r.customer.phone) || '' }); return { fields: field('Phone number', phone, { hint: 'Sent in the background; a delivery problem never affects the sale.' }), collect: () => { if (!phone.value.trim()) throw new Error('Phone number is required.'); return { recipientPhone: phone.value.trim() }; } }; }, submit: async (body) => { await post(`/sales/${id}/send-receipt`, body); toast('Receipt queued. Check Notifications for its delivery status.', 'ok'); } });
    const returnIt = () => returnDialog(sale, navigate);
    const returnable = can('return.write') && sale.items.length > 0;
    return h('div', {}, pageHead(`Receipt ${r.receiptNumber.slice(-10)}`, dateTime(r.issuedAt), button('← Back', { onClick: () => navigate('sales') }), button('PDF', { onClick: pdf }), button('Print', { onClick: () => window.print() }),
      can('sale.read') && button('WhatsApp', { onClick: whatsapp }), returnable && button('Return items', { onClick: returnIt }),
      sale.payment && sale.payment.status === 'PENDING' && can('payment.write') && sale.paymentMethod !== 'Cash' && button('Confirm payment', { kind: 'primary', onClick: confirmPay })),
    sale.payment && sale.payment.status === 'PENDING' ? h('div', { class: 'alert warn' }, 'Payment is PENDING: no one has confirmed the money was received yet.') : null,
    h('div', { class: 'doc' }, h('h2', {}, b.name), h('div', { class: 'center muted' }, [b.address, b.phone && `Tel ${b.phone}`, b.taxId && `TIN ${b.taxId}`].filter(Boolean).join(' · ')), h('div', { class: 'login-gap' }),
      h('div', { class: 'meta' }, h('div', { class: 'box' }, h('h3', {}, 'Customer'), r.customer.name, r.customer.phone ? h('div', { class: 'muted' }, r.customer.phone) : null),
        h('div', { class: 'box' }, h('h3', {}, 'Payment'), h('div', {}, r.paymentMethod, ' ', statusPill(r.paymentStatus)), r.paymentConfirmation ? h('div', { class: 'muted' }, `Confirmed: ${r.paymentConfirmation.replace('_', ' ').toLowerCase()}`) : null, r.paymentReference ? h('div', { class: 'mono' }, r.paymentReference) : null)),
      h('table', {}, h('thead', {}, h('tr', {}, ['Item', 'Qty', 'Price', 'Amount'].map((t, i) => h('th', { class: i ? 'right' : '' }, t)))), h('tbody', {}, r.items.map((it) => h('tr', {}, h('td', {}, it.productName, it.lineDiscountAmount ? h('div', { class: 'muted' }, `discount − ${money(it.lineDiscountAmount, false)}`) : null), h('td', { class: 'right num' }, num(it.quantity)), h('td', { class: 'right num' }, money(it.unitPrice, false)), h('td', { class: 'right num' }, money(it.lineTotal, false)))))),
      h('div', { class: 'sum' }, h('div', {}, h('span', {}, 'Subtotal'), h('span', { class: 'num' }, money(r.subtotal, false))), r.discountAmount ? h('div', {}, h('span', {}, 'Discount'), h('span', { class: 'num' }, `− ${money(r.discountAmount, false)}`)) : null,
        r.taxRate ? h('div', {}, h('span', {}, `Tax ${r.taxRate}%`), h('span', { class: 'num' }, money(r.taxAmount, false))) : null, h('div', { class: 'total' }, h('span', {}, `Total (${r.currency})`), h('span', { class: 'num' }, money(r.total, false))),
        r.paymentMethod === 'Cash' ? h('div', {}, h('span', {}, 'Cash received'), h('span', { class: 'num' }, money(r.cashReceived, false))) : null, r.paymentMethod === 'Cash' ? h('div', {}, h('span', {}, 'Change'), h('span', { class: 'num' }, money(r.changeDue, false))) : null)),
    costs ? h('div', { class: 'card no-print' }, h('h2', {}, 'Profitability (managers only)'), h('dl', { class: 'kv' }, h('dt', {}, 'Cost of goods (FIFO)'), h('dd', {}, money(sale.cogs)), h('dt', {}, 'Gross profit'), h('dd', {}, money(sale.grossProfit)))) : null,
    sale.priceOverrides && sale.priceOverrides.length ? h('div', { class: 'card no-print' }, h('h2', {}, 'Price overrides'), h('ul', {}, sale.priceOverrides.map((o) => h('li', {}, `${money(o.originalPrice)} → ${money(o.overridePrice)} — ${o.reason}`)))) : null);
  });
  return root;
}

function returnDialog(sale, navigate) {
  formModal({ title: 'Return items', wide: true, submitLabel: 'Create return',
    build: () => {
      const rows = sale.items.map((it) => ({ it, qty: input({ type: 'number', min: 0, max: it.quantity, step: 'any', value: 0, 'aria-label': `Quantity to return of ${it.productName}` }), cond: select([['good', 'Resellable'], ['damaged', 'Damaged']]) }));
      const reason = input({ placeholder: 'Reason for the return (optional)' });
      return { fields: h('div', {}, h('p', { class: 'muted' }, 'Refundable value is what the customer actually paid (after discounts, including tax), calculated by the server.'), rows.map((r) => h('div', { class: 'form-grid' }, h('div', { class: 'field' }, h('div', { class: 'label' }, r.it.productName), h('div', { class: 'hint' }, `Sold: ${num(r.it.quantity)}`)), field('Return qty', r.qty), field('Condition', r.cond))), field('Reason', reason)),
        collect: () => { const items = rows.filter((r) => Number(r.qty.value) > 0).map((r) => ({ saleItemId: r.it.id, quantity: Number(r.qty.value), condition: r.cond.value, reason: reason.value.trim() || undefined })); if (!items.length) throw new Error('Enter a quantity for at least one item.'); return { saleId: sale.id, items }; } };
    },
    submit: async (body) => { const ret = await post('/returns', body); toast('Return created', 'ok'); navigate(`returns/${ret.id}`); },
  });
}
